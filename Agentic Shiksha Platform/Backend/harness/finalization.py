"""Finish a reply by recording its tool outputs, never by generating another."""

import logging
from collections.abc import Callable, Generator, Iterator

from harness.events import RuntimeEvent
from harness.state import ToolOutput
from harness.telemetry import TurnTelemetry

logger = logging.getLogger("base_agents.general_agent")


def record_final_outputs(
    write_items: Callable,
    conversation_id: str,
    outputs: list[ToolOutput],
) -> Generator[RuntimeEvent, None, bool]:
    try:
        for offset in range(0, len(outputs), 20):
            write_items(conversation_id, items=outputs[offset:offset + 20])
    except Exception:
        logger.exception("Error recording final tool outputs")
        yield RuntimeEvent(
            "error", "Unable to save the completed reply. Please try again.", conversation_id
        )
        return False
    return True


def completion_events(telemetry: TurnTelemetry, conversation_id: str) -> Iterator[RuntimeEvent]:
    yield from telemetry.events(conversation_id)
    yield RuntimeEvent("done", "", conversation_id)
