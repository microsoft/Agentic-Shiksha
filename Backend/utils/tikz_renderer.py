"""
TikZ Renderer — Compile TikZ source to base64 PNG.

Pipeline:
  TikZ LaTeX source → tempdir/.tex → pdflatex → .pdf → PyMuPDF → PNG → base64

Dependencies:
  - pdflatex  (MiKTeX on Windows / texlive on Linux)
  - PyMuPDF   (pip install PyMuPDF)
"""

import base64
import logging
import os
import re
import shutil
import subprocess
import tempfile
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── LaTeX preamble with EKALAIVA colour palette ─────────────────────

TIKZ_PREAMBLE = r"""\documentclass[border=12pt,tikz]{standalone}
\usepackage[utf8]{inputenc}
\usepackage{tikz}
\usepackage{amsmath,amssymb}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\usetikzlibrary{
  arrows.meta,
  shadows.blur,
  positioning,
  calc,
  decorations.pathmorphing,
  decorations.markings,
  patterns,
  backgrounds,
  automata,
  chains,
  matrix,
  fit,
  shapes.geometric,
  shapes.multipart,
  shapes.gates.logic.US
}
\usepackage[siunitx,americanvoltages,americancurrents]{circuitikz}

% ── Colour palette (matches EKALAIVA design system) ──
\definecolor{ekblue}{HTML}{3B82F6}
\definecolor{ekgreen}{HTML}{22C55E}
\definecolor{ekorange}{HTML}{F97316}
\definecolor{ekred}{HTML}{EF4444}
\definecolor{ekpurple}{HTML}{A855F7}
\definecolor{ekcyan}{HTML}{06B6D4}
\definecolor{ekgrey}{HTML}{9CA3AF}
\definecolor{ekdark}{HTML}{1E293B}
\definecolor{ekbg}{HTML}{F8FAFC}
\definecolor{ekfg}{HTML}{0F172A}

% Common declaration-style text helper emitted by diagram models.
\providecommand{\subtitle}{\sffamily\scriptsize\color{ekdark!65}}

\begin{document}
"""

TIKZ_POSTAMBLE = r"""
\end{document}
"""

TIKZ_PICTURE_OPEN = r"""\begin{tikzpicture}[
  font=\sffamily,
  background rectangle/.style={fill=ekbg},
  show background rectangle,
  block/.style={
    rectangle, rounded corners=4pt,
    minimum width=2cm, minimum height=0.8cm,
    draw=ekdark!70, line width=0.5mm,
    text=white, font=\sffamily\bfseries,
    blur shadow={shadow blur steps=5,
                 shadow xshift=0.8pt, shadow yshift=-0.8pt,
                 shadow opacity=30}
  },
  connector/.style={
    -{Stealth[length=3mm, width=2mm]},
    line width=0.6mm
  },
  connector label/.style={
    font=\sffamily\bfseries\footnotesize,
    fill=ekbg, fill opacity=0.85, text opacity=1,
    inner sep=2pt, rounded corners=1pt
  },
]
"""

TIKZ_PICTURE_CLOSE = r"""
\end{tikzpicture}
"""

# ── Colour name map ──────────────────────────────────────────────────

COLOUR_MAP = {
    "red": "ekred",
    "blue": "ekblue",
    "green": "ekgreen",
    "orange": "ekorange",
    "purple": "ekpurple",
    "cyan": "ekcyan",
    "grey": "ekgrey",
    "gray": "ekgrey",
    "dark": "ekdark",
}


# ── Helpers ──────────────────────────────────────────────────────────

def _find_pdflatex() -> Optional[str]:
    """Locate pdflatex on the system PATH."""
    return shutil.which("pdflatex")


def latex_escape(text: str) -> str:
    """Escape special LaTeX characters in plain text."""
    for old, new in [
        ("\\", r"\textbackslash{}"),
        ("{", r"\{"),
        ("}", r"\}"),
        ("&", r"\&"),
        ("%", r"\%"),
        ("$", r"\$"),
        ("#", r"\#"),
        ("_", r"\_"),
        ("~", r"\textasciitilde{}"),
        ("^", r"\textasciicircum{}"),
    ]:
        text = text.replace(old, new)
    return text


def colour(name: str) -> str:
    """Map a friendly colour name to its TikZ colour."""
    return COLOUR_MAP.get(str(name).lower(), "ekdark")


def fontsize_cmd(size: int) -> str:
    """Map a numeric font-size to a LaTeX size command."""
    if size >= 20:
        return r"\LARGE"
    if size >= 16:
        return r"\Large"
    if size >= 14:
        return r"\large"
    return ""


# ── Core renderer ────────────────────────────────────────────────────

# Models occasionally emit exotic Unicode spaces. They look like a normal space
# but LaTeX keeps them inside the token, so `fill=ekpurple<NBSP>` fails with
# "Undefined color `ekpurple '" — invisible to the model, so retries repeat it.
_UNICODE_SPACES = "\u00a0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000"
_ZERO_WIDTH = "\u200b\u200c\u200d\ufeff"
_WHITESPACE_FIXES = {ord(ch): " " for ch in _UNICODE_SPACES}
_WHITESPACE_FIXES.update({ord(ch): None for ch in _ZERO_WIDTH})
_DOUBLE_BACKSLASH_AMPERSAND = re.compile(r"(?<!\\)\\\\&")


def sanitize_tikz_source(tikz_body: str) -> str:
    """Normalise invisible Unicode whitespace that breaks LaTeX token parsing."""
    return tikz_body.translate(_WHITESPACE_FIXES)


def _repair_misplaced_ampersands(tikz_body: str) -> str:
    """Collapse a model's ``\\\\&`` typo to the LaTeX literal ``\\&``."""
    return _DOUBLE_BACKSLASH_AMPERSAND.sub(lambda _match: r"\&", tikz_body)


def _format_latex_error(log_text: str, full_tex: str) -> str:
    """Turn a pdflatex log into an error naming the offending source line.

    LaTeX reports the location on a following `l.<n>` line; without it the
    caller only sees the message and cannot tell which construct is at fault.
    """
    log_lines = log_text.splitlines()
    tex_lines = full_tex.splitlines()
    preamble_offset = TIKZ_PREAMBLE.count("\n")

    reports: List[str] = []
    for i, line in enumerate(log_lines):
        if not line.startswith("!"):
            continue

        location = None
        detail_lines: List[str] = []
        for probe in log_lines[i + 1:i + 12]:
            match = re.match(r"^l\.(\d+)", probe)
            if match:
                location = int(match.group(1))
                break
            detail = probe.strip()
            if detail:
                detail_lines.append(detail[:240])

        report = line.strip()
        if detail_lines:
            report += "\n  detail: " + "\n          ".join(detail_lines[:4])
        if location is not None:
            body_line = location - preamble_offset
            report += f"\n  at line {body_line} of your TikZ code:"
            for n in range(max(1, location - 2), min(len(tex_lines), location + 2) + 1):
                marker = ">" if n == location else " "
                report += f"\n  {marker} {n - preamble_offset:>4} | {tex_lines[n - 1]}"
        reports.append(report)

        if len(reports) == 2:
            break

    if not reports:
        return "pdflatex compilation failed (no error detail in log)"
    return "pdflatex compilation failed:\n" + "\n".join(reports)


def render_tikz_to_base64(tikz_body: str, dpi: int = 250) -> str:
    """
    Wrap *tikz_body* in a standalone document, compile with pdflatex,
    convert to PNG via PyMuPDF, and return a base64 string.

    *tikz_body* should be everything between \\begin{document} and
    \\end{document}  (one or more tikzpicture / pgfplots environments).
    """
    sanitized_body = sanitize_tikz_source(tikz_body)
    full_tex = TIKZ_PREAMBLE + sanitized_body + TIKZ_POSTAMBLE

    pdflatex = _find_pdflatex()
    if not pdflatex:
        raise RuntimeError(
            "pdflatex not found. Install TeX Live (Linux) or MiKTeX (Windows)."
        )

    with tempfile.TemporaryDirectory(prefix="tikz_") as tmpdir:
        tex_path = os.path.join(tmpdir, "diagram.tex")
        pdf_path = os.path.join(tmpdir, "diagram.pdf")

        def compile_tex(source: str) -> None:
            with open(tex_path, "w", encoding="utf-8") as fh:
                fh.write(source)
            try:
                subprocess.run(
                    [pdflatex, "-interaction=nonstopmode", "-halt-on-error", "diagram.tex"],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    cwd=tmpdir,
                )
            except subprocess.TimeoutExpired:
                raise RuntimeError("pdflatex timed out (120 s)")

        compile_tex(full_tex)

        if not os.path.exists(pdf_path):
            log_path = os.path.join(tmpdir, "diagram.log")
            if os.path.exists(log_path):
                with open(log_path, encoding="utf-8", errors="replace") as lf:
                    first_error = _format_latex_error(lf.read(), full_tex)

                repaired_body = _repair_misplaced_ampersands(sanitized_body)
                if (
                    "Misplaced alignment tab character &" in first_error
                    and repaired_body != sanitized_body
                ):
                    logger.warning(
                        "[TikZ Renderer] Correcting malformed \\\\& escape and recompiling"
                    )
                    full_tex = TIKZ_PREAMBLE + repaired_body + TIKZ_POSTAMBLE
                    compile_tex(full_tex)
                    if os.path.exists(pdf_path):
                        logger.info("[TikZ Renderer] Ampersand repair compiled successfully")
                    else:
                        with open(log_path, encoding="utf-8", errors="replace") as lf:
                            raise RuntimeError(_format_latex_error(lf.read(), full_tex))
                else:
                    raise RuntimeError(first_error)
            if not os.path.exists(pdf_path):
                raise RuntimeError("pdflatex compilation failed")

        # PDF → PNG via PyMuPDF
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise RuntimeError("PyMuPDF not installed.  pip install PyMuPDF")

        doc = fitz.open(pdf_path)
        page = doc[0]
        zoom = dpi / 72
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        png_bytes = pix.tobytes("png")
        doc.close()

        return base64.b64encode(png_bytes).decode()
