#!/usr/bin/env python3
"""Summarize KernelForge scheduler-observer JSONL traces using only the stdlib."""
import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(q * len(ordered) + 0.999999) - 1))
    return ordered[index]


def analyze_records(records):
    event_counts = Counter()
    cpu_switches = Counter()
    latency_by_pid = defaultdict(list)
    latencies = []
    summary = {"events": 0, "dropped": 0, "map_update_failures": 0}

    for record in records:
        kind = record.get("type")
        if kind == "summary":
            summary["events"] += int(record.get("events", 0))
            summary["dropped"] += int(record.get("dropped", 0))
            summary["map_update_failures"] += int(record.get("map_update_failures", 0))
            continue
        event_counts[kind] += 1
        if kind == "switch":
            cpu_switches[str(record.get("cpu", "unknown"))] += 1
            latency = record.get("wake_latency_ns")
            if latency is not None:
                latency = int(latency)
                if latency >= 0:
                    latencies.append(latency)
                    latency_by_pid[str(record.get("pid", "unknown"))].append(latency)

    observed = sum(event_counts.values())
    dropped = summary["dropped"]
    return {
        "event_counts": dict(event_counts),
        "switches_by_cpu": dict(cpu_switches),
        "ring_buffer_dropped": dropped,
        "wakeup_map_update_failures": summary["map_update_failures"],
        "summary_reported_events": summary["events"],
        "observed_event_records": observed,
        "estimated_drop_fraction": (dropped / (dropped + observed)) if dropped + observed else None,
        "matched_wakeup_to_run_samples": len(latencies),
        "wakeup_to_run_latency_ns": {
            "p50": percentile(latencies, 0.50),
            "p95": percentile(latencies, 0.95),
            "p99": percentile(latencies, 0.99),
            "max": max(latencies) if latencies else None,
        },
        "worst_pid_p95_ns": sorted(
            (
                {"pid": pid, "samples": len(values), "p95_ns": percentile(values, 0.95)}
                for pid, values in latency_by_pid.items()
            ),
            key=lambda item: item["p95_ns"],
            reverse=True,
        )[:10],
        "warning": (
            "Incomplete trace: ring-buffer drops or wakeup-map update failures were reported."
            if dropped or summary["map_update_failures"] else
            "No ring-buffer drops reported; this does not prove system-wide trace completeness."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path, help="JSONL file emitted by kernelforge-observer")
    args = parser.parse_args()
    records = []
    with args.trace.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                parser.error(f"invalid JSON at line {line_number}: {exc}")
    print(json.dumps(analyze_records(records), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
