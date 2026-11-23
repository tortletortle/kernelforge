# Offline scheduler trace viewer

Open web/trace-viewer.html directly in a modern browser. No server, package manager, or third-party dependency is required.

1. Start the read-only observer and capture a JSONL file as described in linux-observer.md.
2. Open the HTML file locally.
3. Import the captured JSONL.
4. Filter by PID or process name to inspect CPU execution slices and per-process wake-to-run latency.

The built-in demo button loads synthetic events for UI smoke testing. The banner explicitly marks this data as synthetic. It is not measured Linux output.

## Reconstruction semantics

Each sched_switch record identifies the task switched out (prev_pid) and switched in (pid) on a CPU. For each CPU, the viewer closes the previously observed running interval and starts a new interval for the incoming task. The first and final intervals may be partial because capture begins/ends mid-execution. A mismatch between the previously observed PID and the current prev_pid is marked as a continuity gap; it may indicate a dropped event or incomplete capture.

The viewer does not infer blocked time, I/O service time, scheduler class, or exact CPU utilization. Wake-to-run latency is shown only when the observer matched a prior wakeup timestamp. If the final collector summary is missing, drop counters are shown as unknown rather than zero.

The reconstruction is an observational timeline, not a replay of the Linux scheduler and not a control interface.
