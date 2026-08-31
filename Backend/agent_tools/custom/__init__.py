"""Custom function tools.

Each tool lives in its own subpackage (``<tool>/definition.json`` +
``<tool>/__init__.py``) and subclasses :class:`CustomTool`, exposing a uniform
``execute(arguments, **context)`` / ``output(result, arguments)`` interface.

Only the classes are exported. Tools are stateless, so a consumer constructs
each one once and shares that instance for the process lifetime::

    from agent_tools.custom import AddDocumentTool

    add_document_tool = AddDocumentTool()
    add_document_tool.execute({"title": "...", "content": "..."})

Note: this package imports every tool eagerly, and Python always runs this
``__init__`` before any submodule. So ``import agent_tools.custom.add_document``
still loads all 10 tools -- and the TikZ tool pulls in ``openai`` and
``azure.ai.projects``, which dominates the ~6s import cost. Make these
re-exports lazy (PEP 562 ``__getattr__``) if that ever matters.
"""

from agent_tools.custom.base import CustomTool

from agent_tools.custom.add_document import AddDocumentTool
from agent_tools.custom.add_message import AddMessageTool
from agent_tools.custom.add_quiz import AddQuizTool
from agent_tools.custom.add_flashcard import AddFlashcardTool
from agent_tools.custom.add_challenge import AddChallengeTool
from agent_tools.custom.add_tikz_diagram import AddTikzDiagramTool
from agent_tools.custom.generate_image import GenerateImageTool
from agent_tools.custom.ask_clarification import AskClarificationTool
from agent_tools.custom.suggest_next_queries import SuggestNextQueriesTool
from agent_tools.custom.declare_plan import DeclarePlanTool
from agent_tools.custom.get_threshold_concepts import GetThresholdConceptsTool
from agent_tools.custom.update_topic_progress import UpdateTopicProgressTool
from agent_tools.custom.logging_agent_tools import (
    ListAllStudentsTool,
    GetStudentProgressTool,
    GetAgentOverviewTool,
    ListAgentsTool,
)

__all__ = [
    "CustomTool",
    # Content tools
    "AddDocumentTool",
    "AddMessageTool",
    "AddQuizTool",
    "AddFlashcardTool",
    "AddChallengeTool",
    "AddTikzDiagramTool",
    "GenerateImageTool",
    # Conversational UI tools
    "AskClarificationTool",
    "SuggestNextQueriesTool",
    # Planning / progress tools
    "DeclarePlanTool",
    "GetThresholdConceptsTool",
    "UpdateTopicProgressTool",
    # Read-only analytics tools for the logging agent
    "ListAllStudentsTool",
    "GetStudentProgressTool",
    "GetAgentOverviewTool",
    "ListAgentsTool",
]
