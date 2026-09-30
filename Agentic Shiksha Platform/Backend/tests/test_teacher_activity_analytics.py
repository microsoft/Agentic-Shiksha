"""Tests for teacher learning-activity analytics."""

import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from teacher_dashboard import cosmos_queries as cq  # noqa: E402
from teacher_dashboard.cosmos_queries import (  # noqa: E402
    _aggregate_activity_events,
    _threshold_crossing_events,
)


class TeacherActivityAnalyticsTests(unittest.TestCase):
    def test_staff_activity_is_removed_before_aggregation(self) -> None:
        class _Users:
            def query_items(self, **_kwargs):
                return [
                    {"id": "teacher-a", "role": "teacher"},
                    {"id": "student-a", "role": "student"},
                ]

        original = cq._users_container
        cq._users_container = _Users()
        try:
            events = cq._exclude_staff_activity(
                [
                    {"userId": "teacher-a", "occurredAt": "2026-07-01T09:00:00Z"},
                    {"userId": "student-a", "occurredAt": "2026-07-01T10:00:00Z"},
                ]
            )
        finally:
            cq._users_container = original

        self.assertEqual([event["userId"] for event in events], ["student-a"])

    def test_threshold_projection_counts_only_learned_dated_concepts(self) -> None:
        events = _threshold_crossing_events(
            "course-a",
            [
                {
                    "id": "student-a_course-a_state",
                    "threshold_concepts": {
                        "Crossed": {
                            "status": "learned",
                            "last_updated": "2026-07-02T09:00:00Z",
                        },
                        "Still learning": {
                            "status": "in_progress",
                            "last_updated": "2026-07-02T10:00:00Z",
                        },
                        "Legacy without date": {"status": "learned"},
                    },
                }
            ],
        )

        self.assertEqual(
            events,
            [
                {
                    "occurredAt": "2026-07-02T09:00:00Z",
                    "userId": "student-a",
                    "agentId": "course-a",
                }
            ],
        )

    def test_daily_activity_series_counts_events_students_and_courses(self) -> None:
        events = [
            {
                "occurredAt": "2026-07-01T09:00:00Z",
                "userId": "student-a",
                "agentId": "course-a",
            },
            {
                "occurredAt": "2026-07-02T09:00:00Z",
                "userId": "student-a",
                "agentId": "course-a",
            },
            {
                "occurredAt": "2026-07-02T10:00:00Z",
                "userId": "student-b",
                "agentId": "course-b",
            },
            {
                "occurredAt": "2026-06-30T10:00:00Z",
                "userId": "outside-range",
                "agentId": "course-a",
            },
        ]

        result = _aggregate_activity_events(
            events,
            date(2026, 7, 1),
            date(2026, 7, 3),
            "day",
            "threshold_crossings",
        )

        self.assertEqual(result["metric"], "threshold_crossings")
        self.assertEqual(result["totalEvents"], 3)
        self.assertEqual(result["activeStudents"], 2)
        self.assertEqual(result["activeCourses"], 2)
        self.assertEqual(result["activeDays"], 2)
        self.assertEqual([point["count"] for point in result["series"]], [1, 2, 0])
        self.assertEqual(
            [point["cumulativeCount"] for point in result["series"]],
            [1, 3, 3],
        )
        self.assertTrue(result["distributionSuppressed"])

    def test_week_activity_buckets_use_partial_range_edges(self) -> None:
        result = _aggregate_activity_events(
            [
                {"occurredAt": "2026-07-01T09:00:00Z", "userId": "student-a"},
                {"occurredAt": "2026-07-06T09:00:00Z", "userId": "student-a"},
            ],
            date(2026, 7, 1),
            date(2026, 7, 12),
            "week",
            "assets_created",
        )

        self.assertEqual(
            [(point["periodStart"], point["periodEnd"]) for point in result["series"]],
            [("2026-07-01", "2026-07-05"), ("2026-07-06", "2026-07-12")],
        )
        self.assertEqual([point["count"] for point in result["series"]], [1, 1])


if __name__ == "__main__":
    unittest.main()