"""Optional capabilities are validated, forwarded, saved, and enforced on tools."""

import ast
import importlib.util
import logging
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Literal, Optional
from unittest.mock import AsyncMock, Mock, patch

from pydantic import BaseModel, Field, ValidationError

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.schemas.agent_capabilities import AgentCapabilities, CAPABILITY_TOOLS
from utils.tool_definitions import load_tool_definition


def _load_creation_module():
    # Load the real module without the unrelated azure_services package startup.
    spec = importlib.util.spec_from_file_location(
        "capability_agent_creation", ROOT / "azure_services" / "agents" / "agent_creation.py"
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ, {
        "AZURE_BING_CONNECTION_ID": "test-bing-connection",
        "AZURE_BING_CUSTOM_SEARCH_CONNECTION_ID": "test-custom-search-connection",
    }):
        spec.loader.exec_module(module)
    return module


def _load_creation_boundaries():
    # Isolate these existing monolith functions from startup and live cloud clients.
    source = ROOT / "backend" / "main.py"
    names = {
        "AsyncAgentCreateRequest",
        "AgentSetupDetails",
        "_path2_create_agent",
        "_background_save_metadata",
        "create_agent_async",
        "AgentsClientAdapter",
    }
    tree = ast.parse(source.read_text(encoding="utf-8"))
    nodes = [node for node in tree.body if getattr(node, "name", None) in names]
    for node in nodes:
        node.decorator_list = []
    namespace = {
        "BaseModel": BaseModel, "Field": Field, "AgentCapabilities": AgentCapabilities,
        "Any": Any, "Dict": Dict, "List": List, "Literal": Literal, "Optional": Optional,
        "BackgroundTasks": object, "logger": logging.getLogger(__name__), "os": os,
        "AGENT_MODEL_DEPLOYMENT": "test-model", "ALLOWED_DEPLOYMENTS": {"test-model"},
        "scrub": lambda value: value,
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), namespace)
    return namespace


class CapabilityValidationTests(unittest.TestCase):
    def test_defaults_preserve_every_optional_tool(self):
        self.assertEqual(AgentCapabilities().disabled_tools, set())
        self.assertTrue(all(AgentCapabilities().model_dump().values()))

    def test_partial_settings_preserve_other_defaults(self):
        capabilities = AgentCapabilities(quizzes=False)
        self.assertEqual(capabilities.disabled_tools, {"add_quiz"})
        self.assertTrue(capabilities.documents)

    def test_invalid_settings_are_rejected(self):
        for value in ("false", 0, None, [], {}):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                AgentCapabilities(quizzes=value)
        with self.assertRaises(ValidationError):
            AgentCapabilities(unknown=True)

    def test_request_and_setup_keep_disabled_values(self):
        boundaries = _load_creation_boundaries()
        request = boundaries["AsyncAgentCreateRequest"](
            kind="course", name="course-test", courseName="Test",
            capabilities={"images": False},
        )
        self.assertEqual(request.capabilities.disabled_tools, {"generate_image"})
        legacy = boundaries["AsyncAgentCreateRequest"](
            kind="course", name="course-test", courseName="Test",
        )
        self.assertEqual(legacy.capabilities.disabled_tools, set())
        setup = boundaries["AgentSetupDetails"](
            agentId="course-test", agentKind="course", courseName="Test",
            courseLevel="Undergraduate", courseDuration="One semester",
            additionalContext="Course details", capabilities=request.capabilities,
        )
        self.assertFalse(setup.model_dump()["capabilities"]["images"])


class CapabilityToolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.creation = _load_creation_module()

    def build_tools(self, capabilities=None):
        builder = self.creation.AgentToolBuilder(agent_name="course-test")
        with patch.object(
            builder, "_load_tool_definition",
            side_effect=lambda spec: load_tool_definition(spec.split(":")[0].rsplit(".", 1)[1]),
        ), patch.object(self.creation, "build_memory_search_tool", return_value=None):
            return builder.build(
                include_web_search=False, include_custom_search=False,
                custom_search_instance_name=None, search_index_name=None,
                search_index_filter=None, search_connection_id=None,
                memory_store_name=None, memory_scope="test-user", memory_update_delay=300,
                capabilities=capabilities,
            )

    def test_each_disabled_capability_removes_only_its_tool(self):
        defaults = {tool.name for tool in self.build_tools()}
        self.assertTrue(set(CAPABILITY_TOOLS.values()).issubset(defaults))
        for capability, tool_name in CAPABILITY_TOOLS.items():
            with self.subTest(capability=capability):
                selected = AgentCapabilities(**{capability: False})
                names = {tool.name for tool in self.build_tools(selected)}
                self.assertEqual(names, defaults - {tool_name})

    def test_disable_all_keeps_core_tools(self):
        selected = AgentCapabilities(**dict.fromkeys(CAPABILITY_TOOLS, False))
        names = {tool.name for tool in self.build_tools(selected)}
        self.assertEqual(names, {
            "add_message", "get_threshold_concepts", "update_topic_progress",
            "declare_plan", "ask_clarification", "suggest_next_queries",
        })

    def test_creator_sends_filtered_tools_to_foundry(self):
        creator = self.creation.AgentCreator.__new__(self.creation.AgentCreator)
        creator.model_deployment = "test-model"
        creator.project_client = SimpleNamespace(agents=SimpleNamespace(
            create_version=Mock(return_value=SimpleNamespace(name="course-test", version="1")),
        ))
        selected = AgentCapabilities(images=False, quizzes=False)
        tools = self.build_tools(selected)
        with patch.object(self.creation.AgentToolBuilder, "build", return_value=tools) as build:
            creator.create_agent(
                "course-test", "Course instructions", capabilities=selected, save_to_config=False,
            )
        self.assertIs(build.call_args.kwargs["capabilities"], selected)
        definition = creator.project_client.agents.create_version.call_args.kwargs["definition"]
        self.assertFalse({"generate_image", "add_quiz"} & {tool.name for tool in definition.tools})

    def test_disabled_outputs_leave_hosted_tools_unchanged(self):
        selected = AgentCapabilities(**dict.fromkeys(CAPABILITY_TOOLS, False))
        hosted = [object(), object(), object(), object()]
        with patch.object(self.creation, "build_bing_grounding_tool", return_value=hosted[0]), \
                patch.object(self.creation, "build_bing_custom_search_tool", return_value=hosted[1]), \
                patch.object(self.creation, "build_memory_search_tool", return_value=hosted[2]), \
                patch.object(self.creation, "build_azure_ai_search_tool", return_value=hosted[3]), \
                patch.object(self.creation.AgentToolBuilder, "_load_tool_definition",
                             side_effect=lambda spec: load_tool_definition(spec.split(":")[0].rsplit(".", 1)[1])):
            tools = self.creation.AgentToolBuilder(agent_name="course-test").build(
                include_web_search=True, include_custom_search=True,
                custom_search_instance_name="test-instance", search_index_name="test-index",
                search_index_filter="test-filter", search_connection_id="test-connection",
                memory_store_name="test-memory", memory_scope="test-user", memory_update_delay=300,
                capabilities=selected,
            )
        self.assertEqual(tools[:4], hosted)
        self.assertFalse(set(CAPABILITY_TOOLS.values()) & {tool.name for tool in tools[4:]})

    def test_instruction_edits_preserve_disabled_tools(self):
        tools = self.build_tools(AgentCapabilities(quizzes=False, images=False))
        boundaries = _load_creation_boundaries()
        boundaries["AgentObjectWrapper"] = lambda value: value
        operations = SimpleNamespace(
            get=Mock(return_value=SimpleNamespace(
                versions={"latest": SimpleNamespace(definition=SimpleNamespace(tools=tools))},
            )),
            update=Mock(),
        )
        adapter = boundaries["AgentsClientAdapter"](operations)
        adapter.update_agent("course-test", instructions="Updated course", model="test-model")
        self.assertEqual(operations.update.call_args.kwargs["body"]["definition"]["tools"], tools)

    def test_metadata_and_setup_save_identical_selections(self):
        boundaries = _load_creation_boundaries()
        boundaries["create_agent_metadata"] = Mock()
        boundaries["_save_setup_json"] = Mock()
        selected = AgentCapabilities(images=False, challenges=False)
        boundaries["_background_save_metadata"](
            agent_id="course-test", agent_name="course-test", session_uuid="test-session",
            kb_scope="course", index_name=None, created_by_id="test-teacher",
            description="Test", model="test-model", course_name="Test",
            course_level="Undergraduate", course_duration="One semester",
            agent_kind="course", conversation_starters=[], additional_context="",
            agent_image_url=None, knowledge_attached=False, capabilities=selected,
        )
        metadata = boundaries["create_agent_metadata"].call_args.kwargs["metadata"]
        setup = boundaries["_save_setup_json"].call_args.args[1]
        self.assertEqual(metadata["capabilities"], selected.model_dump())
        self.assertEqual(setup["capabilities"], selected.model_dump())


class CapabilityForwardingTests(unittest.IsolatedAsyncioTestCase):
    async def test_manager_layers_forward_capabilities(self):
        selected = AgentCapabilities(challenges=False)
        cases = [
            ("custom_agents/learning_agent_manager.py", "LearningAgentManager", "create_or_get", "create_agent"),
            ("base_agents/agent_manager.py", "BaseAgentManager", "create_agent", "agent_creator"),
        ]
        for relative_path, class_name, method_name, callee in cases:
            with self.subTest(manager=class_name):
                source = ROOT / relative_path
                tree = ast.parse(source.read_text(encoding="utf-8"))
                cls = next(node for node in tree.body if getattr(node, "name", None) == class_name)
                method = next(node for node in cls.body if getattr(node, "name", None) == method_name)
                create = AsyncMock(return_value="course-test")
                namespace = {
                    "Optional": Optional, "List": List, "Callable": Callable,
                    "AgentCapabilities": AgentCapabilities, "agent_creator": create,
                }
                exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)
                manager = SimpleNamespace(
                    create_agent=create, _get_agent_id_local=Mock(return_value=None),
                    _find_agent_remote_by_name=AsyncMock(return_value=None),
                    before_create=AsyncMock(), after_create=AsyncMock(),
                    project_endpoint="https://example.invalid", config_path="unused.json",
                    credential_factory=None,
                )
                result = await namespace[method_name](
                    manager, agent_name="course-test", instructions="Course instructions",
                    model_deployment="test-model", capabilities=selected,
                )
                self.assertEqual(result, "course-test")
                self.assertIs(create.call_args.kwargs["capabilities"], selected, callee)

    async def test_async_creator_forwards_capabilities(self):
        creation = _load_creation_module()
        selected = AgentCapabilities(documents=False)
        creator = Mock(create_agent=Mock(return_value=("course-test", "1")))
        with patch.object(creation, "AgentCreator", return_value=creator):
            result = await creation.agent_creator(
                project_endpoint="https://example.invalid", model_deployment="test-model",
                agent_name="course-test", instructions="Course instructions", capabilities=selected,
            )
        self.assertEqual(result, "course-test")
        self.assertIs(creator.create_agent.call_args.kwargs["capabilities"], selected)

    async def test_generated_agent_receives_selected_capabilities(self):
        boundaries = _load_creation_boundaries()
        manager = SimpleNamespace(create_or_get=AsyncMock(return_value="course-test"))
        boundaries.update({
            "call_meta_agent_for_prompt": AsyncMock(return_value=("Test", "Course prompt", [])),
            "unify_agent_prompts": Mock(return_value="Unified instructions"),
            "sanitize_agent_name": lambda name: name,
            "learning_agent_manager": lambda: manager,
            "create_memory_store_for_agent": Mock(return_value={"name": "test-memory"}),
        })
        selected = AgentCapabilities(flashcards=False)
        await boundaries["_path2_create_agent"](
            agent_kind="course", name="course-test", user_description="Test",
            course_name="Test", course_level="Undergraduate", course_duration="One semester",
            additional_context="", model="test-model", created_by_id="test-teacher",
            capabilities=selected,
        )
        self.assertIs(manager.create_or_get.call_args.kwargs["capabilities"], selected)

    async def test_endpoint_forwards_and_persists_capabilities(self):
        boundaries = _load_creation_boundaries()
        boundaries["_path2_create_agent"] = AsyncMock(return_value={
            "agent_id": "course-test", "name": "course-test", "description": "Test",
            "conversation_starters": [],
        })
        persistence = SimpleNamespace(_generate_manage_code=lambda: "ABC123")
        tasks = SimpleNamespace(add_task=Mock())
        request = boundaries["AsyncAgentCreateRequest"](
            kind="course", name="course-test", courseName="Test",
            capabilities={"documents": False},
        )
        with patch.dict(os.environ, {"AZURE_AI_SEARCH_CONNECTION_ID": "test-search"}), patch.dict(
            sys.modules, {"azure_services.persistence.cosmos_db": persistence},
        ):
            result = await boundaries["create_agent_async"](request, tasks)
        self.assertEqual(result["agent_id"], "course-test")
        self.assertIs(
            boundaries["_path2_create_agent"].call_args.kwargs["capabilities"],
            request.capabilities,
        )
        self.assertIs(tasks.add_task.call_args.kwargs["capabilities"], request.capabilities)


if __name__ == "__main__":
    unittest.main()
