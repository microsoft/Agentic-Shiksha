"""Shadow-mode geometry checking for generated TikZ diagrams.

Compiles an *instrumented* copy of the diagram in an isolated temp directory and
runs the vendored ``tikzgeom`` gates over it. Deliberately separate from the
render path: instrumentation can never break the image the student sees, and any
failure here degrades to ``None`` rather than losing a diagram.

Enable with ``TIKZ_GEOMETRY_CHECK=1``.
"""

import logging
import os
import re
import subprocess
import tempfile
from typing import Any, Dict, Optional

from utils.tikz_renderer import (
    TIKZ_POSTAMBLE,
    TIKZ_PREAMBLE,
    _find_pdflatex,
    sanitize_tikz_source,
)

logger = logging.getLogger(__name__)

_GEOMDUMP_PATH = os.path.join(os.path.dirname(__file__), "tikzgeom", "geomdump.tex")

# pgf reports its own anchors, so node ids and extents are exact rather than
# reverse-engineered from the PDF's anonymous rectangles.
_BEGIN_PICTURE = re.compile(r"\\begin\{tikzpicture\}(\s*\[)?")


def geometry_check_enabled() -> bool:
    """Shadow mode is on by default; set TIKZ_GEOMETRY_CHECK=0 to skip the extra compile."""
    return os.getenv("TIKZ_GEOMETRY_CHECK", "1").strip().lower() not in {"0", "false", "no"}


def _instrument(tikz_body: str) -> Optional[str]:
    """Add the ``gdump`` style and the per-picture calibration call."""
    if "\\begin{tikzpicture}" not in tikz_body:
        return None

    def _add_style(match: re.Match) -> str:
        # `[` present means the picture already has options to merge into.
        return r"\begin{tikzpicture}[gdump," if match.group(1) else r"\begin{tikzpicture}[gdump]"

    instrumented = _BEGIN_PICTURE.sub(_add_style, tikz_body)
    # \GeomPicture must be the last thing inside each picture.
    instrumented = instrumented.replace(
        r"\end{tikzpicture}", "\\GeomPicture\n\\end{tikzpicture}"
    )
    return instrumented


def check_tikz_geometry(tikz_body: str, timeout: int = 120) -> Optional[Dict[str, Any]]:
    """Return a geometry report for *tikz_body*, or None if it could not be produced."""
    if not os.path.exists(_GEOMDUMP_PATH):
        logger.warning("[TikZ Geometry] geomdump.tex missing, skipping check")
        return None

    pdflatex = _find_pdflatex()
    if not pdflatex:
        return None

    instrumented = _instrument(sanitize_tikz_source(tikz_body))
    if instrumented is None:
        return None

    try:
        from utils.tikzgeom.cli import check
    except Exception as exc:
        logger.warning(f"[TikZ Geometry] tikzgeom unavailable: {exc}")
        return None

    try:
        with open(_GEOMDUMP_PATH, encoding="utf-8") as fh:
            geomdump = fh.read()

        full_tex = (
            TIKZ_PREAMBLE.replace(
                "\\begin{document}", geomdump + "\n\\begin{document}\n\\GeomOpen"
            )
            + instrumented
            + "\n\\GeomClose"
            + TIKZ_POSTAMBLE
        )

        with tempfile.TemporaryDirectory(prefix="tikzgeom_") as tmpdir:
            tex_path = os.path.join(tmpdir, "diagram.tex")
            with open(tex_path, "w", encoding="utf-8") as fh:
                fh.write(full_tex)

            subprocess.run(
                [pdflatex, "-interaction=nonstopmode", "diagram.tex"],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=tmpdir,
            )

            pdf_path = os.path.join(tmpdir, "diagram.pdf")
            if not os.path.exists(pdf_path):
                logger.info("[TikZ Geometry] instrumented copy did not compile, skipping")
                return None

            geom_path = os.path.join(tmpdir, "diagram.geom")
            log_path = os.path.join(tmpdir, "diagram.log")
            report = check(
                pdf_path,
                geom_path if os.path.exists(geom_path) else None,
                log_path if os.path.exists(log_path) else None,
            )

        payload = report.to_feedback()
        payload["geometry_score"] = report.geometry_score
        payload["passed"] = report.passed
        payload["metrics"] = {k: round(v, 4) for k, v in report.metrics.items()}
        return payload
    except Exception as exc:
        logger.warning(f"[TikZ Geometry] check failed: {exc}")
        return None
