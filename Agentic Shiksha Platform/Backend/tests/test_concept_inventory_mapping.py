import unittest
from unittest.mock import patch

from agent_tools.custom.add_quiz import AddQuizTool
from agent_tools.custom.get_threshold_concepts import _resolve_threshold_concepts


class ConceptInventoryMappingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.curriculum = {
            "all_threshold_concepts": ["Conservation across representations"],
            "Conservation across representations": {
                "misconceptions": [
                    {
                        "misconception": "Changing the representation changes the conserved quantity.",
                        "why_wrong": "Only the representation changed.",
                    }
                ],
                "concept_inventory_questions": [],
            },
        }

    def test_concept_inventory_preserves_valid_teacher_only_mapping(self) -> None:
        tool = AddQuizTool()
        with patch(
            "agent_tools.custom.add_quiz._get_full_course_curriculum",
            return_value=self.curriculum,
        ):
            result = tool.execute(
                {
                    "assessment_type": "concept_inventory",
                    "threshold_concept": "Conservation across representations",
                    "title": "Quick check",
                    "questions": [{
                        "question": "A diagram changes form. What remains invariant?",
                        "options": ["The conserved quantity", "Nothing"],
                        "correct": 0,
                        "explanation": "Track the quantity rather than its visual form.",
                        "targets_misconception": "Changing the representation changes the conserved quantity.",
                    }],
                },
                agent_name="course-1",
            )

        self.assertEqual(result["assessmentType"], "concept_inventory")
        self.assertEqual(
            result["thresholdConcept"],
            "Conservation across representations",
        )
        self.assertEqual(
            result["questions"][0]["targetsMisconception"],
            "Changing the representation changes the conserved quantity.",
        )

    def test_concept_inventory_ships_unmapped_question_without_fabricating(self) -> None:
        """An unmatched misconception must not cost the student the whole quiz."""
        tool = AddQuizTool()
        with patch(
            "agent_tools.custom.add_quiz._get_full_course_curriculum",
            return_value=self.curriculum,
        ):
            result = tool.execute(
                {
                    "assessment_type": "concept_inventory",
                    "threshold_concept": "Conservation across representations",
                    "title": "Quick check",
                    "questions": [
                        {
                            "question": "What remains invariant?",
                            "options": ["Quantity", "Nothing"],
                            "correct": 0,
                            "targets_misconception": "Changing the representation changes the conserved quantity.",
                        },
                        {
                            "question": "What else?",
                            "options": ["Quantity", "Nothing"],
                            "correct": 0,
                            "targets_misconception": "Any unrelated wrong belief.",
                        },
                    ],
                },
                agent_name="course-1",
            )

        self.assertEqual(len(result["questions"]), 2)
        self.assertEqual(
            result["questions"][0]["targetsMisconception"],
            "Changing the representation changes the conserved quantity.",
        )
        # Nothing invented is stored against the unmatched question.
        self.assertNotIn("targetsMisconception", result["questions"][1])
        self.assertIn("Question(s) 2", tool.output(result, {}))

    def test_concept_inventory_accepts_index_and_partial_misconception(self) -> None:
        tool = AddQuizTool()
        for target in ("1", "Changing the representation"):
            with self.subTest(target=target):
                with patch(
                    "agent_tools.custom.add_quiz._get_full_course_curriculum",
                    return_value=self.curriculum,
                ):
                    result = tool.execute(
                        {
                            "assessment_type": "concept_inventory",
                            "threshold_concept": "Conservation across representations",
                            "title": "Quick check",
                            "questions": [{
                                "question": "What remains invariant?",
                                "options": ["Quantity", "Nothing"],
                                "correct": 0,
                                "targets_misconception": target,
                            }],
                        },
                        agent_name="course-1",
                    )
                self.assertEqual(
                    result["questions"][0]["targetsMisconception"],
                    "Changing the representation changes the conserved quantity.",
                )

    def test_state_aware_tool_returns_private_misconception_bank(self) -> None:
        state = {
            "topics": {},
            "objectives": {},
            "threshold_concepts": {
                "Conservation across representations": {
                    "status": "not_started",
                    "misconceptions_addressed": [],
                }
            },
        }
        with (
            patch(
                "azure_services.persistence.cosmos_db.get_learning_state",
                return_value=state,
            ),
            patch(
                "azure_services.persistence.cosmos_db.get_progress_summary",
                return_value={"overall": {}},
            ),
            patch(
                "agent_tools.custom.get_threshold_concepts._get_full_course_curriculum",
                return_value=self.curriculum,
            ),
        ):
            result = _resolve_threshold_concepts(
                {},
                agent_name="course-1",
                user_id="student-1",
            )

        concept = result["threshold_concepts"]["Conservation across representations"]
        self.assertEqual(
            concept["misconceptions"][0]["misconception"],
            "Changing the representation changes the conserved quantity.",
        )


if __name__ == "__main__":
    unittest.main()