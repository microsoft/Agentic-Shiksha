import json
import unittest
from unittest.mock import patch

from azure.cosmos.exceptions import CosmosResourceExistsError, CosmosResourceNotFoundError

from azure_services.persistence import cosmos_db


class FakeAssetsContainer:
    def __init__(self) -> None:
        self.items = {}
        self.replace_calls = 0
        self.delete_calls = 0

    def create_item(self, body):
        key = (body["userId"], body["id"])
        if key in self.items:
            raise CosmosResourceExistsError(status_code=409, message="Conflict")
        self.items[key] = dict(body)

    def read_item(self, item, partition_key):
        key = (partition_key, item)
        if key not in self.items:
            raise CosmosResourceNotFoundError(status_code=404, message="Not found")
        return dict(self.items[key])

    def replace_item(self, item, body):
        self.replace_calls += 1
        self.items[(body["userId"], item)] = dict(body)
        return dict(body)

    def delete_item(self, item, partition_key):
        self.delete_calls += 1
        del self.items[(partition_key, item)]

    def query_items(self, query, parameters, partition_key):
        thread_id = next(
            parameter["value"]
            for parameter in parameters
            if parameter["name"] == "@threadId"
        )
        return [
            {"id": item["id"], "immutable": item.get("immutable", False)}
            for (user_id, _), item in self.items.items()
            if user_id == partition_key and item.get("threadId") == thread_id
        ]


class FakeThreadDataContainer:
    def __init__(self, messages=None) -> None:
        self.messages = messages or []
        self.deleted = []

    def query_items(self, **_kwargs):
        return list(self.messages)

    def delete_item(self, item, partition_key):
        self.deleted.append((partition_key, item))


class FirstQuizAttemptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.container = FakeAssetsContainer()
        self.container_patch = patch.object(
            cosmos_db,
            "_get_assets_container",
            return_value=self.container,
        )
        self.container_patch.start()

    def tearDown(self) -> None:
        self.container_patch.stop()

    @staticmethod
    def attempt(reason: str):
        return {
            "score": 1,
            "totalQuestions": 1,
            "answers": [{"question": "Why?", "reason": reason}],
        }

    def test_conflicting_submit_returns_original_first_attempt(self) -> None:
        first, first_created = cosmos_db.create_first_quiz_attempt(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            title="Concept Inventory",
            attempt=self.attempt("original reasoning"),
        )
        second, second_created = cosmos_db.create_first_quiz_attempt(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            title="Concept Inventory",
            attempt=self.attempt("replacement reasoning"),
        )

        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(
            json.loads(second["content"])["answers"][0]["reason"],
            "original reasoning",
        )
        self.assertEqual(len(self.container.items), 1)

    def test_quiz_attempt_and_feedback_share_one_asset(self) -> None:
        generated = cosmos_db.upsert_quiz_asset(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            title="Concept Inventory",
            assessment_type="concept_inventory",
            threshold_concept="Conservation across representations",
            questions=[{
                "question": "Why?",
                "options": ["Because", "Otherwise"],
                "correct": 0,
                "explanation": "Because is correct.",
                "targetsMisconception": "Changing the representation changes the conserved quantity.",
            }],
            thread_id="thread-1",
        )
        submitted, created = cosmos_db.create_first_quiz_attempt(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            title="Concept Inventory",
            attempt=self.attempt("reasoning"),
            thread_id="thread-1",
        )
        with_feedback = cosmos_db.append_quiz_agent_feedback(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            feedback="Your reasoning identifies the key misconception.",
        )
        later_attempt, later_created = cosmos_db.create_first_quiz_attempt(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            title="Concept Inventory",
            attempt=self.attempt("replacement reasoning"),
            thread_id="thread-1",
        )
        later_feedback = cosmos_db.append_quiz_agent_feedback(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            feedback="Replacement feedback.",
        )

        self.assertTrue(created)
        self.assertFalse(later_created)
        self.assertEqual(generated["id"], submitted["id"])
        self.assertEqual(submitted["id"], with_feedback["id"])
        self.assertEqual(with_feedback["id"], later_attempt["id"])
        self.assertEqual(len(self.container.items), 1)
        content = json.loads(later_feedback["content"])
        self.assertEqual(content["quiz"]["assessmentType"], "concept_inventory")
        self.assertEqual(
            content["quiz"]["thresholdConcept"],
            "Conservation across representations",
        )
        self.assertEqual(
            content["quiz"]["questions"][0]["targetsMisconception"],
            "Changing the representation changes the conserved quantity.",
        )
        self.assertEqual(content["quiz"]["questions"][0]["question"], "Why?")
        self.assertEqual(content["firstAttempt"]["answers"][0]["reason"], "reasoning")
        self.assertEqual(
            content["agentFeedback"]["content"],
            "Your reasoning identifies the key misconception.",
        )

    def test_first_attempt_cannot_be_updated_or_deleted(self) -> None:
        asset, _ = cosmos_db.create_first_quiz_attempt(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            title="Concept Inventory",
            attempt=self.attempt("reasoning"),
        )

        updated = cosmos_db.update_asset(
            asset["id"],
            "student-1",
            {"content": "changed"},
        )
        deleted = cosmos_db.delete_asset(asset["id"], "student-1")

        self.assertIsNone(updated)
        self.assertFalse(deleted)
        self.assertEqual(self.container.replace_calls, 0)
        self.assertEqual(self.container.delete_calls, 0)
        self.assertEqual(len(self.container.items), 1)

    def test_thread_deletion_preserves_first_attempt(self) -> None:
        first_attempt, _ = cosmos_db.create_first_quiz_attempt(
            user_id="student-1",
            agent_id="course-1",
            quiz_id="quiz-1",
            title="Concept Inventory",
            attempt=self.attempt("reasoning"),
            thread_id="thread-1",
        )
        ordinary_asset = {
            "id": "ordinary-asset",
            "userId": "student-1",
            "threadId": "thread-1",
            "immutable": False,
        }
        self.container.items[("student-1", ordinary_asset["id"])] = ordinary_asset
        threads = FakeThreadDataContainer()
        messages = FakeThreadDataContainer([{"id": "message-1"}])

        with patch.object(cosmos_db, "_get_containers", return_value=(threads, messages)):
            deleted = cosmos_db.delete_thread("thread-1", "student-1")

        self.assertTrue(deleted)
        self.assertIn(("student-1", first_attempt["id"]), self.container.items)
        self.assertNotIn(("student-1", ordinary_asset["id"]), self.container.items)
        self.assertEqual(messages.deleted, [("student-1", "message-1")])
        self.assertEqual(threads.deleted, [("student-1", "thread-1")])


if __name__ == "__main__":
    unittest.main()