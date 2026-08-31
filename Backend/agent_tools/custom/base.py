"""Abstract base class for custom function tools.

Every custom tool subclasses :class:`CustomTool`, sets ``name`` (matching its
``definition.json`` key), and implements :meth:`execute`. Subclasses may
override :meth:`output` to customise the confirmation string that is sent back
to the model after the tool runs.

Each tool package exposes a single shared instance so call sites read as
``add_document_tool.execute(args)`` and ``add_document_tool.output(result, args)``
instead of the old ``handle_add_document`` / ``get_tool_output_message`` pair.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict


class CustomTool(ABC):
    """Uniform interface for a custom function tool.

    Attributes:
        name: The tool's identifier, matching its ``definition.json`` key.
    """

    name: str = ""

    @abstractmethod
    def execute(self, arguments: Dict[str, Any], **context: Any) -> Any:
        """Run the tool.

        Args:
            arguments: The tool-call arguments (already parsed from JSON).
            context: Optional extra context (e.g. ``agent_name``, ``user_id``)
                that some tools need. Tools that don't need it ignore it.

        Returns:
            The tool's result payload (typically a dict; some data tools
            return a plain string).
        """

    def output(self, result: Any, arguments: Dict[str, Any]) -> str:
        """Return the message sent back to the model after execution.

        The default confirms success. Override to derive a richer message
        from ``result`` (and, if needed, the original ``arguments``).
        """
        return f"Tool '{self.name}' executed successfully."
