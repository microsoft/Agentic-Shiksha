"""Deterministic geometry gates for LLM-generated TikZ.

Vendored from the ``tikzgeom`` reference implementation. It turns a compiled
diagram into a scene graph with real coordinates, then runs binary gates and
continuous metrics over it — measuring what a vision model can only opine about
(occluded nodes, clipped ink, colliding text, arrows landing inside shapes).

``__init__`` and ``__main__`` are ours; the remaining modules are as delivered.
"""

from .model import *  # noqa: F401,F403
from .report import GateReport, Issue, rank_issues  # noqa: F401
from .checks import CheckConfig, run_checks  # noqa: F401
from .extract import build_scene, read_log  # noqa: F401
from .cli import BuildResult, build_and_check, check, compile_tikz, main  # noqa: F401
