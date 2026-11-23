# KernelForge

AI-oriented operating-system experimentation workbench. Current development combines a deterministic scheduler simulator, risk-aware policy experiments, a read-only Linux scheduler observer candidate, and an offline trace viewer.

## Current status

- **Simulator:** FCFS, RR, MLFQ, synthetic context-switch/migration overhead, deterministic workloads, snapshots, and paired benchmark suites.
- **Risk-aware scheduler research:** experimental only. MLFQ remains the default baseline; the adaptive controller has not demonstrated general superiority.
- **Linux observer:** eBPF/libbpf source candidate for sched_wakeup, sched_wakeup_new, sched_switch, and sched_process_exit. It is read-only and does not patch or alter scheduling.
- **Trace analysis:** JSONL analyzer and offline HTML timeline viewer.
- **Not implemented/validated:** real kernel hotpatch/livepatch, AI-generated kernel patch execution, QEMU isolation integration, and validated performance improvements on real Linux.

## Reproduce tests

Node.js 18+ and Python 3.10+; no third-party Python packages are required.

    make test

This runs the simulator verification suites, trace-viewer fixtures, and Python trace-analyzer tests. Individual simulator entry points include test.mjs and test-v2.mjs through test-v5.mjs.

## Build the Linux observer

Requires a Linux kernel exposing BTF at /sys/kernel/btf/vmlinux, tp_btf support for the selected scheduler tracepoints, clang/LLVM with BPF target, bpftool, libbpf development files, and permission to load BPF programs.

    bash scripts/check_linux_env.sh
    make check-deps
    make

The current development environment has not successfully compiled or attached this observer. See [Linux observer build and validation](docs/linux-observer.md) and [V0.6 validation status](docs/v0.6-validation.md).

Capture a trace on an isolated Linux VM or suitable WSL kernel:

    sudo ./build/kernelforge-observer > trace.jsonl
    python3 tools/analyze_trace.py trace.jsonl

## Offline visualization

Open web/trace-viewer.html in a modern browser and import the JSONL file. The built-in demo is synthetic and explicitly labeled. The viewer reconstructs approximate per-CPU execution slices from adjacent switch events; first/last intervals may be partial and continuity gaps are surfaced. See [trace viewer semantics](docs/trace-viewer.md).

## Simulator model boundaries

The simulator is a single virtual CPU with integer ticks and alternating CPU/I/O bursts. Its context-switch and migration costs are synthetic parameters, not measured hardware latencies. Results from generated workloads do not establish real Linux performance or general algorithm superiority. See the versioned experiment reports under docs/.

## Safety boundary

The Linux observer is read-only. Do not enable scheduler changes, kernel modules, livepatch, or AI-generated kernel code until build, verifier, attach, loss accounting, observer-overhead, and independent trace-comparison tests pass on a disposable Linux environment.
