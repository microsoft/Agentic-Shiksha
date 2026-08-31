# tikzgeom

Deterministic geometry gates for LLM-generated TikZ. Vendored from the `tikzgeom`
reference implementation.

Nothing in this package calls a model. It turns a compiled diagram into a scene and
reports numbers, so diagram quality can be judged by measurement rather than by asking
another model whether the picture looks right.

| Module | Purpose |
| --- | --- |
| [model.py](model.py) | Geometry primitives and the `SceneGeometry` data model. |
| [extract.py](extract.py) | Builds a `SceneGeometry` from a PDF plus its `.geom` sidecar. |
| [checks.py](checks.py) | Tier 0 gates (binary, blocking) and Tier 1 metrics (continuous, ranked). |
| [report.py](report.py) | Issues, ranking, and the JSON gate report. |
| [cli.py](cli.py) | Compile-and-check, usable as a library call or a CLI. |
| [geomdump.tex](geomdump.tex) | LaTeX instrumentation that writes the `.geom` sidecar during compilation. |

```bash
python -m tikzgeom build diagram.tex
python -m tikzgeom check out.pdf --geom out.geom --log out.log
```

## Design rules worth preserving

- **Two sources of truth, deliberately.** Node boxes come from the `.geom` sidecar
  written by `geomdump.tex`; other geometry is recovered from the PDF. They are kept
  separate rather than merged, so a disagreement is visible instead of silently averaged.
- **Every issue carries a measurement.** A finding reads `spatial_layout: 8/10` with the
  number that produced it, not a bare verdict. Reports that cannot be traced back to a
  computed value are not actionable.

Called from [../tikz_geometry.py](../tikz_geometry.py), which runs these gates in shadow
mode against an instrumented copy of the diagram in an isolated temp directory.
