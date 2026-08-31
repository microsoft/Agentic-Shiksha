"""Compile + check, as a library call and as a CLI.

    python -m tikzgeom check  out.pdf --geom out.geom --log out.log
    python -m tikzgeom build  diagram.tex --outdir build --json report.json
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from typing import Optional

from .checks import CheckConfig, run_checks
from .extract import build_scene, read_log
from .report import GateReport

HERE = os.path.dirname(os.path.abspath(__file__))
PREAMBLE = os.path.join(HERE, "geomdump.tex")


@dataclass
class BuildResult:
    ok: bool
    pdf: Optional[str]
    geom: Optional[str]
    log: Optional[str]
    returncode: int
    stderr: str = ""


def compile_tikz(
    tex_path: str,
    outdir: str = "build",
    engine: str = "pdflatex",
    timeout: int = 120,
) -> BuildResult:
    """Compile a standalone TikZ file, keeping the .geom sidecar."""
    os.makedirs(outdir, exist_ok=True)
    tex_dir = os.path.dirname(os.path.abspath(tex_path)) or "."
    job = os.path.splitext(os.path.basename(tex_path))[0]

    # make geomdump.tex resolvable from the source directory
    texinputs = os.pathsep.join([tex_dir, HERE, os.environ.get("TEXINPUTS", "")])
    env = {**os.environ, "TEXINPUTS": texinputs + os.pathsep}

    cmd = [
        engine,
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        f"-output-directory={os.path.abspath(outdir)}",
        os.path.abspath(tex_path),
    ]
    try:
        proc = subprocess.run(
            cmd, cwd=tex_dir, env=env, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        return BuildResult(False, None, None, None, -1, "LaTeX timed out")

    pdf = os.path.join(outdir, job + ".pdf")
    geom = os.path.join(outdir, job + ".geom")
    log = os.path.join(outdir, job + ".log")
    ok = proc.returncode == 0 and os.path.exists(pdf)
    return BuildResult(
        ok=ok,
        pdf=pdf if os.path.exists(pdf) else None,
        geom=geom if os.path.exists(geom) else None,
        log=log if os.path.exists(log) else None,
        returncode=proc.returncode,
        stderr=(proc.stdout or "")[-4000:] if not ok else "",
    )


def check(
    pdf: str,
    geom: Optional[str] = None,
    log: Optional[str] = None,
    cfg: Optional[CheckConfig] = None,
) -> GateReport:
    cfg = cfg or CheckConfig()
    scene = build_scene(pdf, geom)
    if log:
        scene.log_issues = read_log(log, cfg.overfull_pt)
    return run_checks(scene, cfg)


def build_and_check(
    tex_path: str, outdir: str = "build", cfg: Optional[CheckConfig] = None
) -> tuple[BuildResult, Optional[GateReport]]:
    res = compile_tikz(tex_path, outdir)
    if not res.ok or not res.pdf:
        return res, None
    return res, check(res.pdf, res.geom, res.log, cfg)


# --------------------------------------------------------------------------


def _emit(report: GateReport, args) -> int:
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            fh.write(report.to_json(full=True))
    if args.feedback:
        print(json.dumps(report.to_feedback(), indent=2))
    elif args.quiet:
        print(json.dumps({"passed": report.passed, "score": report.geometry_score}))
    else:
        print(report.to_text())
    return 0 if report.passed else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="tikzgeom", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", help="write the full report to this path")
    common.add_argument(
        "--feedback", action="store_true", help="print the compact polisher payload"
    )
    common.add_argument("--quiet", action="store_true")
    common.add_argument("--max-feedback", type=int, default=3)
    common.add_argument("--min-font", type=float, default=6.0)

    c = sub.add_parser("check", parents=[common], help="check an existing PDF")
    c.add_argument("pdf")
    c.add_argument("--geom")
    c.add_argument("--log")

    b = sub.add_parser("build", parents=[common], help="compile a .tex then check it")
    b.add_argument("tex")
    b.add_argument("--outdir", default="build")

    args = ap.parse_args(argv)
    cfg = CheckConfig(max_feedback=args.max_feedback, min_font_pt=args.min_font)

    if args.cmd == "check":
        return _emit(check(args.pdf, args.geom, args.log, cfg), args)

    res, report = build_and_check(args.tex, args.outdir, cfg)
    if report is None:
        print(
            json.dumps(
                {
                    "passed": False,
                    "gate": "compiles_clean",
                    "returncode": res.returncode,
                    "stderr_tail": res.stderr[-1200:],
                },
                indent=2,
            )
        )
        return 2
    return _emit(report, args)


if __name__ == "__main__":
    sys.exit(main())
