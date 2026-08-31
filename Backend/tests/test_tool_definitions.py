"""Contract tests for the tool definition registry.

These tests are the single strongest guardrail against tool/definition drift.
They run before deploy (no live services required) and assert, for every JSON
under ``agent_tools/custom/<tool>/``:

  * the file is valid JSON,
  * it validates against :class:`utils.tool_definitions.ToolDefinition`,
  * its declared ``name`` matches the file stem,
  * its ``parameters`` is a well-formed JSON-Schema ``object`` whose
    ``required`` entries all exist in ``properties``.

They also assert that every tool module that ships a handler exposes both the
``*_TOOL_DEFINITION`` constant and a matching :class:`CustomTool` instance with
``execute``/``output``, so a handler can never exist without its definition
(or vice versa).
"""

import importlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.tool_definitions import (  # noqa: E402
    CUSTOM_TOOLS_DIR,
    ToolDefinition,
    iter_definition_names,
    load_tool_definition,
)
from agent_tools.custom.base import CustomTool  # noqa: E402

# Tool packages under ``agent_tools.custom`` that ship an executable handler,
# mapped to the (definition constant, CustomTool subclass) names they must
# expose. If you add a tool, add it here so the contract is enforced.
HANDLER_MODULES = {
    "agent_tools.custom.add_document": ("ADD_DOCUMENT_TOOL_DEFINITION", "AddDocumentTool"),
    "agent_tools.custom.add_message": ("ADD_MESSAGE_TOOL_DEFINITION", "AddMessageTool"),
    "agent_tools.custom.add_quiz": ("ADD_QUIZ_TOOL_DEFINITION", "AddQuizTool"),
    "agent_tools.custom.add_flashcard": ("ADD_FLASHCARD_TOOL_DEFINITION", "AddFlashcardTool"),
    "agent_tools.custom.add_challenge": ("ADD_CHALLENGE_TOOL_DEFINITION", "AddChallengeTool"),
    "agent_tools.custom.add_tikz_diagram": (
        "ADD_TIKZ_DIAGRAM_TOOL_DEFINITION",
        "AddTikzDiagramTool",
    ),
    "agent_tools.custom.generate_image": (
        "GENERATE_IMAGE_TOOL_DEFINITION",
        "GenerateImageTool",
    ),
    "agent_tools.custom.declare_plan": ("DECLARE_PLAN_TOOL_DEFINITION", "DeclarePlanTool"),
    "agent_tools.custom.get_threshold_concepts": (
        "GET_THRESHOLD_CONCEPTS_TOOL_DEFINITION",
        "GetThresholdConceptsTool",
    ),
    "agent_tools.custom.update_topic_progress": (
        "UPDATE_TOPIC_PROGRESS_TOOL_DEFINITION",
        "UpdateTopicProgressTool",
    ),
}


def _all_definition_names():
    return iter_definition_names()


class ToolDefinitionContractTests(unittest.TestCase):
    def test_definitions_directory_exists_and_not_empty(self) -> None:
        self.assertTrue(
            CUSTOM_TOOLS_DIR.is_dir(),
            f"Missing custom tools directory: {CUSTOM_TOOLS_DIR}",
        )
        self.assertGreater(len(_all_definition_names()), 0, "No tool definitions found")

    def test_every_definition_is_valid_json(self) -> None:
        for name in _all_definition_names():
            with self.subTest(tool=name):
                # load_tool_definition parses + validates; JSON errors surface here.
                try:
                    load_tool_definition(name)
                except json.JSONDecodeError as exc:  # pragma: no cover - failure path
                    self.fail(f"{name} is not valid JSON: {exc}")

    def test_every_definition_matches_contract(self) -> None:
        for name in _all_definition_names():
            with self.subTest(tool=name):
                # load_tool_definition validates on load and enforces name matching.
                definition = load_tool_definition(name)
                self.assertIsInstance(definition, dict)
                # Revalidate explicitly for a clear per-tool failure message.
                model = ToolDefinition.model_validate(definition)
                self.assertEqual(
                    model.name,
                    name,
                    f"{name} declares name={model.name!r}, expected {name!r}",
                )

    def test_every_definition_uses_the_flat_shape(self) -> None:
        """All definitions must be flat: ``name``/``description``/``parameters``
        at the top level, not nested under a ``function`` wrapper.

        Consumers such as ``AgentToolBuilder._add_function_tools`` subscript the
        definition directly (``definition["name"]``), so a nested definition
        would raise ``KeyError`` even though it validates.
        """
        for name in _all_definition_names():
            with self.subTest(tool=name):
                definition = load_tool_definition(name)
                self.assertNotIn(
                    "function",
                    definition,
                    f"{name} uses the nested Chat-API shape; flatten it so "
                    f"consumers can read definition['name'] directly",
                )
                for key in ("name", "description", "parameters"):
                    self.assertIn(
                        key,
                        definition,
                        f"{name} is missing top-level {key!r}",
                    )

    def test_handler_modules_expose_definition_and_handler(self) -> None:
        for module_path, (const_name, tool_attr) in HANDLER_MODULES.items():
            with self.subTest(module=module_path):
                module = importlib.import_module(module_path)
                self.assertTrue(
                    hasattr(module, const_name),
                    f"{module_path} is missing definition constant {const_name}",
                )
                tool_cls = getattr(module, tool_attr, None)
                self.assertTrue(
                    isinstance(tool_cls, type) and issubclass(tool_cls, CustomTool),
                    f"{module_path}.{tool_attr} must be a CustomTool subclass",
                )
                self.assertTrue(
                    callable(getattr(tool_cls, "execute", None)),
                    f"{module_path}.{tool_attr} is missing a callable execute()",
                )
                self.assertTrue(
                    callable(getattr(tool_cls, "output", None)),
                    f"{module_path}.{tool_attr} is missing a callable output()",
                )
                # Must be concrete: no leftover abstract methods.
                self.assertFalse(
                    getattr(tool_cls, "__abstractmethods__", frozenset()),
                    f"{module_path}.{tool_attr} is abstract and cannot be instantiated",
                )

    def test_tool_name_matches_its_definition(self) -> None:
        for module_path, (const_name, tool_attr) in HANDLER_MODULES.items():
            with self.subTest(module=module_path):
                module = importlib.import_module(module_path)
                tool_cls = getattr(module, tool_attr)
                definition = getattr(module, const_name)
                self.assertEqual(
                    tool_cls.name,
                    definition["name"],
                    f"{module_path}.{tool_attr}.name={tool_cls.name!r} does not match "
                    f"{const_name}['name']={definition['name']!r}",
                )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
