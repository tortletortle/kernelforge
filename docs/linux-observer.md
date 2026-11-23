# Linux scheduler observer (read-only eBPF prototype)

## Scope and safety

This is the first real-kernel observation path for KernelForge. It attaches read-only BPF tracing programs to the sched_wakeup, sched_wakeup_new and sched_switch tracepoints using tp_btf. It records wakeup and context-switch events into a ring buffer. A user-space collector emits JSON Lines; the analyzer calculates wake-to-run latency distributions.

It does not change scheduling policy, patch kernel code, load a kernel module, or implement livepatch. No scheduler optimization is enabled. The simulator remains separate from real Linux observations.

The measured interval is from the observed wakeup tracepoint to the next observed switch-in for that task. It is a runnable-wait proxy, not pure run-queue wait in every kernel path: wakeups can be remote, events can be lost, and a task may be switched for reasons not represented by this minimal prototype. wake_latency_ns is null when no matching wakeup record is present. Ring-buffer drops are counted, but zero drops do not prove complete system-wide observability.

## Requirements

- Linux kernel with BTF at /sys/kernel/btf/vmlinux, BPF syscall support, and BTF tracepoint (tp_btf) attach support for the selected scheduler tracepoints.
- clang/LLVM with BPF target, bpftool, a C compiler, pkg-config, libbpf development headers/library.
- Permission to load and attach BPF programs. Depending on kernel and distribution, this may require root or capabilities such as CAP_BPF and CAP_PERFMON; lockdown, LSM policy, kernel config, and container restrictions may still prevent attachment.
- The Makefile currently targets x86_64 and aarch64 Linux.

## Ubuntu / WSL2 dependencies

On Ubuntu 24.04, install the userspace toolchain:

    sudo apt update
    sudo apt install -y clang llvm bpftool libbpf-dev libelf-dev zlib1g-dev build-essential pkg-config python3

Then run the environment check. WSL2 kernels do not all expose the BTF data required by CO-RE; if /sys/kernel/btf/vmlinux is absent, stop here. Do not generate vmlinux.h from a different kernel and assume it matches the running WSL kernel. Use a Linux VM/kernel with BTF enabled or build/configure a WSL kernel that provides BTF.

## Build

    bash scripts/check_linux_env.sh
    make check-deps
    make

The build creates build/vmlinux.h from the running kernel BTF, compiles the CO-RE BPF object, generates a libbpf skeleton, and builds build/kernelforge-observer.

If tp_btf attach is unavailable, do not silently substitute a different event source: record the kernel version/config and implement a separately validated tracepoint fallback.

## Capture

Run on an isolated test machine or disposable VM first:

    sudo ./build/kernelforge-observer > trace.jsonl

Generate a controlled workload in another terminal. Stop the collector with Ctrl-C. Analyze:

    python3 tools/analyze_trace.py trace.jsonl
    python3 -m unittest discover -s tests -v

The collector writes event records to stdout and diagnostics to stderr. The final JSONL summary includes emitted events, ring-buffer reservation failures, and wakeup-map update failures.

## Validation protocol

1. Record kernel release, architecture, kernel config, BTF availability, libbpf version, and exact build command.
2. Capture an idle baseline for 60 seconds.
3. Run a fixed CPU-bound workload and an I/O-wakeup workload for at least 60 seconds each; keep workload parameters and CPU affinity fixed.
4. Repeat each condition at least 5 times. Do not compare runs with ring-buffer drops.
5. Report matched wake-to-run sample count, p50/p95/p99/max, per-CPU switch counts, event count, dropped count, and CPU utilization measured independently.
6. Compare against perf sched or ftrace trace output on the same workload. Document event-definition differences; do not assume identical semantics.
7. Measure observer overhead by paired runs with tracing disabled/enabled. Report throughput and latency deltas; do not claim zero overhead.
8. Preserve raw JSONL traces and analyzer version with each result.

## Known limitations

- The prototype keeps one wakeup timestamp per host PID; repeated wakeups overwrite the prior timestamp. A sched_process_exit hook removes the entry when the task exits.
- PID reuse and namespace interpretation still require validation on the target kernel.
- BPF ring-buffer drops and wakeup-map update failures are counted separately in the final summary.
- No per-task run-time accounting, scheduler class identification, cgroup attribution, CPU migration analysis, or trace clock conversion yet.
- tp_btf availability is kernel/configuration dependent; a successful source build is not proof of successful attach.
- This source has not yet been built or executed against the user's Linux host. Treat it as an implementation candidate pending compilation and runtime validation.
