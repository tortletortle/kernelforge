# KernelForge

AI-oriented operating system experimentation workbench (v0.1 core).

## Reproduce

Node.js 18+; no dependencies.

```sh
node test.mjs
```

The entry point runs 83 verification scenarios: two exact timing fixtures, twenty seeded workloads under FCFS/RR/MLFQ and a runtime RR→MLFQ→RR policy change (ticks 120 and 240), plus a determinism check. Each workload contains 60 jobs. Invariants are checked after each simulated tick and policy migration. The tests compare accounted CPU work, turnaround decomposition and completion.

## Scope

Single virtual CPU; integer tick time; alternating CPU and I/O bursts; concurrent independent I/O delays; no actual CPU context-switch cost. Context switch counter counts consecutive busy ticks running different jobs (not idle transitions). MLFQ uses quanta 2/4/8 and periodic priority boosts every 24 ticks. Switching policies resets policy-specific priority and quantum metadata while preserving job work and accumulated waiting. Switching back is not a state rollback. P99 uses nearest-rank per workload and results average these per-workload quantiles.

This is not a real Linux kernel, eBPF program or livepatch engine. No claims about real Linux performance or global superiority are supported. AI-assisted diagnosis, front end, snapshots, Linux/QEMU integration and realistic overhead measurements remain future work.

## Next milestone

Separate workload generator and benchmark harness; add workload families, load sweeps, overhead modeling, state snapshots, randomized switching and adversarial cases before introducing visual or real-kernel integration.
