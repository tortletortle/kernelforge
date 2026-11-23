#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_tracing.h>
#include "kf_event.h"

char LICENSE[] SEC("license") = "GPL";

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 32768);
    __type(key, __u32);
    __type(value, __u64);
} wakeup_ts SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u64);
} dropped SEC(".maps");

static __always_inline void count_drop(void)
{
    __u32 key = 0;
    __u64 *count = bpf_map_lookup_elem(&dropped, &key);
    if (count)
        (*count)++;
}

static __always_inline void emit_wakeup(struct task_struct *task, __u32 flags)
{
    if (!task)
        return;

    __u64 now = bpf_ktime_get_ns();
    __u32 pid = BPF_CORE_READ(task, pid);
    struct kf_event *event;

    if (pid == 0)
        return;

    bpf_map_update_elem(&wakeup_ts, &pid, &now, BPF_ANY);
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        count_drop();
        return;
    }

    __builtin_memset(event, 0, sizeof(*event));
    event->ts_ns = now;
    event->schema_version = KF_SCHEMA_VERSION;
    event->type = KF_EVENT_WAKEUP;
    event->cpu = bpf_get_smp_processor_id();
    event->pid = pid;
    event->tgid = BPF_CORE_READ(task, tgid);
    event->prio = BPF_CORE_READ(task, prio);
    event->flags = flags;
    BPF_CORE_READ_STR_INTO(event->comm, task, comm);
    bpf_ringbuf_submit(event, 0);
}

SEC("tp_btf/sched_wakeup")
int BPF_PROG(on_sched_wakeup, struct task_struct *task)
{
    emit_wakeup(task, 0);
    return 0;
}

SEC("tp_btf/sched_wakeup_new")
int BPF_PROG(on_sched_wakeup_new, struct task_struct *task)
{
    emit_wakeup(task, KF_FLAG_WAKEUP_NEW);
    return 0;
}

SEC("tp_btf/sched_switch")
int BPF_PROG(on_sched_switch,
             bool preempt,
             struct task_struct *prev,
             struct task_struct *next,
             unsigned int prev_state)
{
    struct kf_event *event;
    __u64 now = bpf_ktime_get_ns();
    __u32 next_pid;
    __u64 *wake_time;

    (void)preempt;
    if (!prev || !next)
        return 0;

    next_pid = BPF_CORE_READ(next, pid);
    event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        count_drop();
        return 0;
    }

    __builtin_memset(event, 0, sizeof(*event));
    event->ts_ns = now;
    event->schema_version = KF_SCHEMA_VERSION;
    event->type = KF_EVENT_SWITCH;
    event->cpu = bpf_get_smp_processor_id();
    event->pid = next_pid;
    event->tgid = BPF_CORE_READ(next, tgid);
    event->prev_pid = BPF_CORE_READ(prev, pid);
    event->prev_tgid = BPF_CORE_READ(prev, tgid);
    event->prio = BPF_CORE_READ(next, prio);
    event->prev_state = prev_state;
    BPF_CORE_READ_STR_INTO(event->comm, next, comm);

    wake_time = bpf_map_lookup_elem(&wakeup_ts, &next_pid);
    if (wake_time) {
        if (now >= *wake_time) {
            event->wake_latency_ns = now - *wake_time;
            event->flags |= KF_FLAG_WAKE_MATCHED;
        }
        bpf_map_delete_elem(&wakeup_ts, &next_pid);
    }

    bpf_ringbuf_submit(event, 0);
    return 0;
}
