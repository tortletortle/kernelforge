#ifndef KERNELFORGE_EVENT_H
#define KERNELFORGE_EVENT_H
#include <linux/types.h>
#define KF_SCHEMA_VERSION 1
#define KF_COMM_LEN 16
enum kf_event_type { KF_EVENT_WAKEUP = 1, KF_EVENT_SWITCH = 2 };
enum kf_event_flags { KF_FLAG_WAKE_MATCHED = 1U << 0, KF_FLAG_WAKEUP_NEW = 1U << 1 };
struct kf_event {
    __u64 ts_ns;
    __u64 wake_latency_ns;
    __u32 schema_version;
    __u32 type;
    __u32 cpu;
    __u32 pid;
    __u32 tgid;
    __u32 prev_pid;
    __u32 prev_tgid;
    __u32 prio;
    __u32 prev_state;
    __u32 flags;
    char comm[KF_COMM_LEN];
};
#endif
