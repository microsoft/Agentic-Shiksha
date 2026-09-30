"""Compatibility alias for the canonical agent harness runtime."""

import sys

from harness import runtime as _runtime
from harness.runtime import GeneralAgent as GeneralAgent
from harness.runtime import get_general_agent as get_general_agent
from harness.runtime import with_suggested_queries as with_suggested_queries


def __getattr__(name: str):
    return getattr(_runtime, name)


sys.modules[__name__] = _runtime
