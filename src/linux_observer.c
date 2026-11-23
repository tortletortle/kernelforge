#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <bpf/bpf.h>
#include <bpf/libbpf.h>
#include "kf_event.h"
#include "kernelforge.skel.h"

static volatile sig_atomic_t exiting;
static unsigned long long event_count;

static void handle_signal(int signo)
{
    (void)signo;
    exiting = 1;
}

static void print_json_string(const char *value, size_t length)
{
    putchar('"');
    for (size_t i = 0; i < length && value[i] != '\0'; i++) {
        unsigned char ch = (unsigned char)value[i];
        switch (ch) {
        case '"': fputs("\\\"", stdout); break;
        case '\\': fputs("\\\\", stdout); break;
        case '\b': fputs("\\b", stdout); break;
        case '\f': fputs("\\f", stdout); break;
        case '\n': fputs("\\n", stdout); break;
        case '\r': fputs("\\r", stdout); break;
        case '\t': fputs("\\t", stdout); break;
        default:
            if (ch < 0x20) printf("\\u%04x", ch);
            else putchar(ch);
        }
    }
    putchar('"');
}

static int handle_event(void *ctx, void *data, size_t data_sz)
{
    const struct kf_event *event = data;
    const char *type;
    (void)ctx;

    if (data_sz < sizeof(*event)) {
        fprintf(stderr, "Ignoring undersized ring-buffer record (%zu bytes)\n", data_sz);
        return 0;
    }
    if (event->schema_version != KF_SCHEMA_VERSION)
        return 0;

    type = event->type == KF_EVENT_WAKEUP ? "wakeup" :
           event->type == KF_EVENT_SWITCH ? "switch" : "unknown";

    printf("{\"schema_version\":%u,\"type\":\"%s\",\"ts_ns\":%llu,"
           "\"cpu\":%u,\"pid\":%u,\"tgid\":%u,\"prio\":%u,"
           "\"prev_pid\":%u,\"prev_tgid\":%u,\"prev_state\":%u,"
           "\"wake_latency_ns\":",
           event->schema_version, type,
           (unsigned long long)event->ts_ns, event->cpu,
           event->pid, event->tgid, event->prio,
           event->prev_pid, event->prev_tgid, event->prev_state);

    if (event->flags & KF_FLAG_WAKE_MATCHED)
        printf("%llu", (unsigned long long)event->wake_latency_ns);
    else
        fputs("null", stdout);

    printf(",\"flags\":%u,\"comm\":", event->flags);
    print_json_string(event->comm, sizeof(event->comm));
    fputs("}\n", stdout);
    event_count++;
    return 0;
}

static unsigned long long read_dropped(struct kernelforge_bpf *skel)
{
    int cpu_count = libbpf_num_possible_cpus();
    unsigned int key = 0;
    unsigned long long total = 0;
    __u64 *per_cpu;

    if (cpu_count <= 0)
        return 0;
    per_cpu = calloc((size_t)cpu_count, sizeof(*per_cpu));
    if (!per_cpu)
        return 0;

    if (bpf_map_lookup_elem(bpf_map__fd(skel->maps.dropped), &key, per_cpu) == 0) {
        for (int i = 0; i < cpu_count; i++)
            total += per_cpu[i];
    }
    free(per_cpu);
    return total;
}

int main(void)
{
    struct kernelforge_bpf *skel = NULL;
    struct ring_buffer *ring = NULL;
    int err = 0;

    setvbuf(stdout, NULL, _IOLBF, 0);
    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    skel = kernelforge_bpf__open();
    if (!skel) {
        fprintf(stderr, "Failed to open BPF skeleton\n");
        return 1;
    }

    err = kernelforge_bpf__load(skel);
    if (err) {
        fprintf(stderr, "BPF load failed: %s (%d)\n", strerror(-err), err);
        goto cleanup;
    }

    err = kernelforge_bpf__attach(skel);
    if (err) {
        fprintf(stderr, "BPF attach failed: %s (%d)\n", strerror(-err), err);
        goto cleanup;
    }

    ring = ring_buffer__new(bpf_map__fd(skel->maps.events), handle_event, NULL, NULL);
    if (!ring) {
        err = -errno;
        fprintf(stderr, "Ring-buffer setup failed: %s\n", strerror(errno));
        goto cleanup;
    }

    fprintf(stderr, "KernelForge observer attached. Press Ctrl-C to stop.\n");
    while (!exiting) {
        err = ring_buffer__poll(ring, 250);
        if (err == -EINTR) {
            err = 0;
            break;
        }
        if (err < 0) {
            fprintf(stderr, "Ring-buffer poll failed: %s (%d)\n", strerror(-err), err);
            break;
        }
    }

    printf("{\"type\":\"summary\",\"events\":%llu,\"dropped\":%llu}\n",
           event_count, read_dropped(skel));

cleanup:
    if (ring)
        ring_buffer__free(ring);
    if (skel)
        kernelforge_bpf__destroy(skel);
    return err ? 1 : 0;
}
