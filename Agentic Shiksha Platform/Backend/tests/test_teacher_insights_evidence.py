"""Contracts for teacher-scoped, multi-source learning evidence."""

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from teacher_dashboard import cosmos_queries as cq  # noqa: E402
from teacher_dashboard import logging_agent_tools as tools  # noqa: E402


class TeacherInsightsEvidenceTests(unittest.TestCase):
    def test_chat_turns_follow_stored_retry_and_edit_semantics(self) -> None:
        threads = [{"id": "thread-1", "title": "Attention"}]
        messages = [
            {
                "role": "user",
                "content": "Why two sources?",
                "createdAt": "2026-07-31T12:00:00Z",
                "threadId": "thread-1",
                "messageGroupId": "turn-1",
                "retryNumber": 0,
            },
            {
                "role": "assistant",
                "content": "First answer.",
                "createdAt": "2026-07-31T12:00:05Z",
                "threadId": "thread-1",
                "messageGroupId": "turn-1",
                "retryNumber": 0,
            },
            {
                "role": "assistant",
                "content": "Regenerated answer.",
                "createdAt": "2026-07-31T12:00:20Z",
                "threadId": "thread-1",
                "messageGroupId": "turn-1",
                "retryNumber": 1,
            },
            {
                "role": "user",
                "content": "Earlier question.",
                "createdAt": "2026-07-30T09:00:00Z",
                "threadId": "thread-1",
                "messageGroupId": "turn-0",
                "retryNumber": 0,
            },
        ]

        class _Container:
            def __init__(self, items):
                self._items = items

            def query_items(self, **_kwargs):
                return list(self._items)

        with (
            patch.object(cq, "_threads", return_value=_Container(threads)),
            patch.object(cq, "_messages", return_value=_Container(messages)),
        ):
            chat = cq._student_chat_evidence("student-a", "course-a")

        self.assertEqual(chat["thread_count"], 1)
        self.assertEqual(chat["student_message_count"], 2)
        self.assertEqual(chat["tutor_reply_count"], 2)

        # Newest turn first, retry collapsed to the reply the student actually saw.
        latest = chat["recent_turns"][0]
        self.assertEqual(latest["untrusted_student_text"], "Why two sources?")
        self.assertEqual(latest["untrusted_tutor_reply"], "Regenerated answer.")
        self.assertTrue(latest["was_retried_or_edited"])
        self.assertEqual(latest["thread_title"], "Attention")

        # A turn with no reply is still reported rather than dropped.
        self.assertEqual(chat["recent_turns"][1]["untrusted_tutor_reply"], "")

    def test_student_evidence_combines_progress_assessments_assets_and_chat(self) -> None:
        state = {
            "overall": {"total": 2, "learned": 1, "in_progress": 1},
            "topics": {
                "Attention": {
                    "status": "learned",
                    "module": "Transformers",
                    "latest_summary": "Explained why attention routes information.",
                    "last_updated": "2026-07-31T10:00:00Z",
                },
                "Tokenization": {"status": "not_started"},
            },
            "threshold_concepts": {
                "Representation learning": {
                    "status": "in_progress",
                    "misconceptions_addressed": ["Embeddings are fixed labels"],
                    "latest_summary": "Distinguished labels from learned representations.",
                    "last_updated": "2026-07-31T11:00:00Z",
                }
            },
        }
        inventories = [{"title": "Inventory", "score": 1, "total_questions": 2}]
        assets = [{"title": "Concept map", "untrusted_content_excerpt": "map"}]
        chat = {
            "thread_count": 1,
            "student_message_count": 3,
            "tutor_reply_count": 3,
            "recent_turns": [
                {
                    "observed_at": "2026-07-31T12:00:00Z",
                    "thread_title": "Attention",
                    "untrusted_student_text": "Why does cross-attention use two sources?",
                    "untrusted_tutor_reply": "Queries come from one stream, keys and values from the other.",
                    "was_retried_or_edited": False,
                }
            ],
        }

        with (
            patch.object(cq, "get_user_profile", return_value={"displayName": "Student A"}),
            patch.object(cq, "get_learning_state", return_value=state),
            patch.object(cq, "_student_asset_evidence", return_value=(inventories, assets)),
            patch.object(cq, "_student_chat_evidence", return_value=chat),
        ):
            result = cq.student_learning_evidence("student-a", "course-a")

        self.assertEqual(result["display_name"], "Student A")
        self.assertEqual(result["progress"]["topics"]["learned"], 1)
        self.assertEqual(
            result["progress"]["threshold_concepts"]["concepts"][0]["status"],
            "in_progress",
        )
        self.assertEqual(result["concept_inventory_first_attempts"], inventories)
        self.assertEqual(result["recent_assets"], assets)
        self.assertEqual(result["recent_chat_signals"], chat)
        self.assertEqual(result["evidence_coverage"]["chat_turns_reviewed"], 1)

    def test_concept_inventory_attempts_are_structured_and_asset_text_is_bounded(self) -> None:
        attempt = {
            "score": 1,
            "totalQuestions": 2,
            "percentage": 50,
            "answers": [
                {
                    "question": "Which representation changes with training?",
                    "selectedOptions": ["A label"],
                    "correctOptions": ["An embedding"],
                    "reason": "I thought both were fixed.",
                    "isCorrect": False,
                }
            ],
        }
        records = [
            {
                "recordType": "concept_inventory_first_attempt",
                "title": "Representation inventory",
                "createdAt": "2026-07-31T10:00:00Z",
                "content": json.dumps(attempt),
            },
            {
                "title": "Long reflection",
                "category": "summary",
                "type": "markdown",
                "createdAt": "2026-07-31T11:00:00Z",
                "content": "x" * 1200,
            },
        ]
        with patch(
            "azure_services.persistence.cosmos_db.list_user_assets",
            return_value=records,
        ):
            inventories, assets = cq._student_asset_evidence("student-a", "course-a")

        self.assertEqual(inventories[0]["percentage"], 50)
        self.assertEqual(
            inventories[0]["wrong_answer_evidence"][0]["expected"],
            ["An embedding"],
        )
        self.assertLessEqual(len(assets[0]["untrusted_content_excerpt"]), 701)

    def test_scoped_dispatch_rejects_other_students_and_courses(self) -> None:
        scope = {
            "allowed_agent_ids": ["course-a"],
            "target_student_ids": ["student-a"],
            "selected_mode": True,
            "evidence_bundle": {"students": [{"display_name": "Student A"}]},
        }

        evidence = json.loads(tools.execute_scoped_tool("get_learning_evidence", {}, scope))
        other_student = json.loads(
            tools.execute_scoped_tool(
                "get_student_progress",
                {"agent_id": "course-a", "user_id": "student-b"},
                scope,
            )
        )
        other_course = json.loads(
            tools.execute_scoped_tool(
                "get_agent_overview", {"agent_id": "course-b"}, scope
            )
        )

        self.assertEqual(evidence["students"][0]["display_name"], "Student A")
        self.assertIn("outside", other_student["error"])
        self.assertIn("outside", other_course["error"])

    def test_model_bundle_strips_raw_user_ids_and_marks_compaction(self) -> None:
        with patch.object(
            cq,
            "student_learning_evidence",
            side_effect=lambda user_id, agent_id, **kwargs: {
                "user_id": user_id,
                "display_name": f"Student {user_id}",
                "evidence_coverage": {},
            },
        ):
            result = cq.learning_evidence_bundle(
                "course-a",
                [f"student-{index}" for index in range(10)],
            )

        self.assertEqual(result["detail_level"], "compact")
        self.assertFalse(result["truncated"])
        self.assertTrue(all("user_id" not in student for student in result["students"]))
        self.assertEqual(result["students"][0]["student_ref"], "S1")

    def test_catalog_keeps_distinct_student_refs_when_names_match(self) -> None:
        def evidence_for(_user_id, _agent_id, **_kwargs):
            return {
                "user_id": _user_id,
                "display_name": "Same pseudonym",
                "progress": {
                    "topics": {"observed": []},
                    "threshold_concepts": {
                        "concepts": [
                            {
                                "concept": "Representation learning",
                                "last_updated": "2026-07-31T10:00:00Z",
                            }
                        ]
                    },
                },
                "concept_inventory_first_attempts": [],
                "recent_assets": [],
                "evidence_coverage": {},
            }

        with patch.object(cq, "student_learning_evidence", side_effect=evidence_for):
            result = cq.learning_evidence_bundle(
                "course-a",
                ["student-a", "student-b"],
            )

        self.assertEqual(
            [item["student_ref"] for item in result["evidence_catalog"]],
            ["S1", "S2"],
        )
        self.assertEqual(
            [item["student"] for item in result["evidence_catalog"]],
            ["Same pseudonym", "Same pseudonym"],
        )

    def test_citations_resolve_only_catalogued_non_chat_evidence(self) -> None:
        bundle = {
            "chat_signals_reviewed": True,
            "evidence_catalog": [
                {
                    "ref": "S1-TC1",
                    "kind": "threshold_concept",
                    "label": "Representation learning",
                    "student": "Student A",
                    "observed_at": "2026-07-31T10:00:00Z",
                },
                {
                    "ref": "S1-AS1",
                    "kind": "asset",
                    "label": "Concept map",
                    "student": "Student A",
                    "observed_at": "2026-07-31T11:00:00Z",
                },
            ],
        }

        result = tools.resolve_evidence_citations(
            "The concept is progressing [[S1-TC1]] and the map supports it "
            "[[S1-AS1]]. Ignore [[CHAT-1]] and unknown [[S9-TC9]].",
            bundle,
        )

        self.assertEqual(
            [citation["ref"] for citation in result["citations"]],
            ["S1-TC1", "S1-AS1"],
        )
        self.assertTrue(result["chatSignalsReviewed"])
        self.assertTrue(all(citation["kind"] != "chat" for citation in result["citations"]))


if __name__ == "__main__":
    unittest.main()