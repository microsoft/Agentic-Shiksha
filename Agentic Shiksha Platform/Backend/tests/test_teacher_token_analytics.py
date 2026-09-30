"""Tests for privacy-preserving teacher token analytics."""

import json
import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from teacher_dashboard.cosmos_queries import (  # noqa: E402
    _aggregate_token_usage,
    build_token_usage_event,
    merge_token_usage_sources,
)
from teacher_dashboard.token_stats import build_stream_usage_events  # noqa: E402


class TeacherTokenAnalyticsTests(unittest.TestCase):
    def test_stream_rounds_use_response_ids_for_idempotency(self) -> None:
        events = build_stream_usage_events(
            agent_id="course-a",
            student_user_id="student-a",
            conversation_id="conversation-a",
            usage_event_id="message-group-a",
            created_at="2026-07-31T10:00:00+00:00",
            usage={
                "input_tokens": 270,
                "output_tokens": 30,
                "total_tokens": 300,
                "per_round": [
                    {
                        "response_id": "resp_1",
                        "input_tokens": 90,
                        "output_tokens": 10,
                    },
                    {
                        "response_id": "resp_2",
                        "input_tokens": 180,
                        "output_tokens": 20,
                    },
                ],
            },
        )

        self.assertEqual(len(events), 2)
        self.assertEqual([event["sourceEventId"] for event in events], ["resp_1", "resp_2"])
        self.assertEqual(sum(event["totalTokens"] for event in events), 300)
        self.assertTrue(all(event["studentUserId"] == "student-a" for event in events))

    def test_usage_event_is_deterministic_and_isolated_from_chat_partitions(self) -> None:
        values = {
            "agent_id": "course-a",
            "source_event_id": "resp_123",
            "created_at": "2026-07-31T10:00:00+00:00",
            "input_tokens": 90,
            "output_tokens": 10,
            "total_tokens": 100,
            "source": "stream",
            "student_user_id": "student-a",
            "conversation_id": "conversation-a",
        }

        first = build_token_usage_event(**values)
        second = build_token_usage_event(**values)

        self.assertEqual(first, second)
        self.assertEqual(first["userId"], "__token_usage__:course-a")
        self.assertEqual(first["recordType"], "token_usage_event")
        self.assertEqual(first["studentUserId"], "student-a")
        self.assertEqual(
            first["inputTokens"] + first["outputTokens"], first["totalTokens"]
        )

    def test_daily_series_is_cumulative_and_reports_tracking_coverage(self) -> None:
        messages = [
            {"createdAt": "2026-07-01T09:00:00Z", "inputTokens": 80, "outputTokens": 20, "totalTokens": 100, "userId": "student-a"},
            {"createdAt": "2026-07-02T09:00:00Z", "inputTokens": 40, "outputTokens": 10, "totalTokens": 50, "userId": "student-a"},
            {"createdAt": "2026-07-02T10:00:00Z", "inputTokens": 120, "outputTokens": 30, "totalTokens": 150, "userId": "student-b"},
            {"createdAt": "2026-07-02T11:00:00Z", "userId": "student-b"},
        ]

        result = _aggregate_token_usage(
            messages,
            date(2026, 7, 1),
            date(2026, 7, 3),
            "day",
        )

        self.assertEqual(result["totalInputTokens"], 240)
        self.assertEqual(result["totalOutputTokens"], 60)
        self.assertEqual(result["totalTokens"], 300)
        self.assertEqual(result["trackedResponses"], 3)
        self.assertEqual(result["totalResponses"], 4)
        self.assertEqual(result["activeStudents"], 2)
        self.assertEqual(result["coveragePct"], 75.0)
        self.assertEqual(
            [point["cumulativeTokens"] for point in result["series"]],
            [100, 300, 300],
        )
        self.assertEqual(
            [point["cumulativeInputTokens"] for point in result["series"]],
            [80, 240, 240],
        )
        self.assertEqual(
            [point["cumulativeOutputTokens"] for point in result["series"]],
            [20, 60, 60],
        )
        self.assertEqual(
            [point["totalTokens"] for point in result["dailySeries"]],
            [100, 200, 0],
        )
        self.assertTrue(result["distributionSuppressed"])

    def test_week_buckets_align_to_monday_with_partial_range_edges(self) -> None:
        messages = [
            {"createdAt": "2026-07-01T09:00:00Z", "totalTokens": 40, "userId": "student-a"},
            {"createdAt": "2026-07-06T09:00:00Z", "totalTokens": 60, "userId": "student-a"},
        ]

        result = _aggregate_token_usage(
            messages,
            date(2026, 7, 1),
            date(2026, 7, 12),
            "week",
        )

        self.assertEqual(
            [(point["periodStart"], point["periodEnd"]) for point in result["series"]],
            [("2026-07-01", "2026-07-05"), ("2026-07-06", "2026-07-12")],
        )
        self.assertEqual([point["totalTokens"] for point in result["series"]], [40, 60])
        self.assertEqual(
            [point["totalTokens"] for point in result["dailySeries"]],
            [40, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0],
        )

    def test_distribution_exposes_only_relative_aggregate_bands(self) -> None:
        totals = [10, 20, 100, 200, 200]
        messages = [
            {
                "createdAt": "2026-07-01T09:00:00Z",
                "totalTokens": total,
                "userId": f"private-student-{index}",
            }
            for index, total in enumerate(totals)
        ]

        result = _aggregate_token_usage(
            messages,
            date(2026, 7, 1),
            date(2026, 7, 1),
            "day",
        )

        self.assertFalse(result["distributionSuppressed"])
        self.assertEqual(
            [band["studentCount"] for band in result["distribution"]],
            [2, 1, 2],
        )
        for band in result["distribution"]:
            self.assertEqual(
                set(band),
                {"key", "label", "studentCount", "studentPercentage"},
            )
        serialized = json.dumps(result)
        self.assertNotIn("private-student", serialized)
        self.assertNotIn("studentTokens", serialized)

    def test_foundry_totals_preserve_cosmos_student_attribution(self) -> None:
        cosmos_result = _aggregate_token_usage(
            [
                {"createdAt": "2026-07-01T09:00:00Z", "userId": "student-a"},
                {"createdAt": "2026-07-01T10:00:00Z", "userId": "student-b"},
            ],
            date(2026, 7, 1),
            date(2026, 7, 1),
            "day",
        )
        foundry_result = _aggregate_token_usage(
            [
                {
                    "createdAt": "2026-07-01T09:30:00Z",
                    "inputTokens": 900,
                    "outputTokens": 100,
                    "totalTokens": 1000,
                }
            ],
            date(2026, 7, 1),
            date(2026, 7, 1),
            "day",
        )
        foundry_result["usageSource"] = "foundry"

        result = merge_token_usage_sources(cosmos_result, foundry_result)

        self.assertEqual(result["usageSource"], "foundry")
        self.assertEqual(result["sourceResponses"], 1)
        self.assertEqual(result["totalInputTokens"], 900)
        self.assertEqual(result["totalOutputTokens"], 100)
        self.assertEqual(result["totalTokens"], 1000)
        self.assertEqual(result["activeStudents"], 2)
        self.assertEqual(result["trackedResponses"], 0)
        self.assertEqual(result["totalResponses"], 2)
        self.assertEqual(result["coveragePct"], 0)
        self.assertTrue(result["distributionSuppressed"])


if __name__ == "__main__":
    unittest.main()