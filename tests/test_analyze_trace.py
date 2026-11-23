import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "tools" / "analyze_trace.py"
SPEC = importlib.util.spec_from_file_location("analyze_trace", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AnalyzeTraceTests(unittest.TestCase):
    def test_latency_percentiles_and_cpu_counts(self):
        records = [
            {"type": "wakeup", "pid": 7},
            {"type": "switch", "cpu": 0, "pid": 7, "wake_latency_ns": 10},
            {"type": "switch", "cpu": 0, "pid": 8, "wake_latency_ns": 20},
            {"type": "switch", "cpu": 1, "pid": 7, "wake_latency_ns": None},
            {"type": "summary", "events": 4, "dropped": 1, "map_update_failures": 2},
        ]
        result = MODULE.analyze_records(records)
        self.assertEqual(result["matched_wakeup_to_run_samples"], 2)
        self.assertEqual(result["wakeup_to_run_latency_ns"]["p50"], 10)
        self.assertEqual(result["wakeup_to_run_latency_ns"]["p99"], 20)
        self.assertEqual(result["switches_by_cpu"], {"0": 2, "1": 1})
        self.assertEqual(result["ring_buffer_dropped"], 1)
        self.assertEqual(result["wakeup_map_update_failures"], 2)
        self.assertIn("Incomplete trace", result["warning"])

    def test_empty_trace(self):
        result = MODULE.analyze_records([])
        self.assertIsNone(result["wakeup_to_run_latency_ns"]["p50"])
        self.assertIsNone(result["estimated_drop_fraction"])
        self.assertEqual(result["observed_event_records"], 0)

    def test_unmatched_switch_is_not_zero_latency(self):
        result = MODULE.analyze_records([
            {"type": "switch", "cpu": 0, "pid": 3, "wake_latency_ns": None}
        ])
        self.assertEqual(result["matched_wakeup_to_run_samples"], 0)
        self.assertIsNone(result["wakeup_to_run_latency_ns"]["max"])


if __name__ == "__main__":
    unittest.main()
