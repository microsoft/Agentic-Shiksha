"""Tests for server-side topic-progress inference."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from azure_services.persistence.progress_inference import (  # noqa: E402
    MAX_TOPICS_PER_TURN,
    find_taught_topics,
)


def _topics(**statuses):
    return {name: {"status": status} for name, status in statuses.items()}


class FindTaughtTopicsTests(unittest.TestCase):
    def test_matches_a_curriculum_topic_named_in_the_turn(self) -> None:
        topics = _topics(**{
            "Introduction to Machine Learning": "not_started",
            "Support Vector Machines": "not_started",
        })
        found = find_taught_topics(topics, "Let's begin with introduction to machine learning.")
        self.assertEqual(found, ["Introduction to Machine Learning"])

    def test_ignores_topics_that_are_already_underway(self) -> None:
        for status in ("in_progress", "learned"):
            with self.subTest(status=status):
                topics = _topics(**{"Process Scheduling": status})
                self.assertEqual(find_taught_topics(topics, "process scheduling explained"), [])

    def test_short_topic_names_are_not_matched(self) -> None:
        topics = _topics(**{"I/O": "not_started", "Sets": "not_started"})
        self.assertEqual(find_taught_topics(topics, "we used sets for I/O work"), [])

    def test_generic_single_word_topics_are_never_inferred(self) -> None:
        """Real curricula contain topics named "simple"/"process"/"Protocol"."""
        topics = _topics(**{
            "simple": "not_started",
            "process": "not_started",
            "Protocol": "not_started",
            "Aliasing": "not_started",
        })
        text = "this is a simple process using the protocol, watch for aliasing"
        self.assertEqual(find_taught_topics(topics, text), [])

    def test_partial_words_do_not_count_as_a_match(self) -> None:
        topics = _topics(**{"Kernel Threads": "not_started"})
        self.assertEqual(find_taught_topics(topics, "these kernel threadsafe wrappers"), [])

    def test_punctuation_and_case_are_normalised(self) -> None:
        topics = _topics(**{"Depth-First Search": "not_started"})
        found = find_taught_topics(topics, "Now, DEPTH FIRST SEARCH: how it works")
        self.assertEqual(found, ["Depth-First Search"])

    def test_prefers_the_most_specific_topic_and_caps_the_count(self) -> None:
        topics = _topics(**{
            "Linear Regression": "not_started",
            "Regularised Linear Regression": "not_started",
            "Logistic Regression": "not_started",
            "Gradient Descent": "not_started",
        })
        text = ("regularised linear regression, linear regression, "
                "logistic regression and gradient descent")
        found = find_taught_topics(topics, text)
        self.assertLessEqual(len(found), MAX_TOPICS_PER_TURN)
        self.assertEqual(found[0], "Regularised Linear Regression")

    def test_empty_inputs_are_safe(self) -> None:
        self.assertEqual(find_taught_topics({}, "anything"), [])
        self.assertEqual(find_taught_topics(_topics(**{"Recursion": "not_started"}), ""), [])


if __name__ == "__main__":
    unittest.main()
