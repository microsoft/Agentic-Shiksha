"""PDF + .geom sidecar  ->  SceneGeometry.

Two sources of truth, deliberately:

  * node boxes come from the .geom sidecar written by geomdump.tex. These are
    pgf's own anchors, so they are exact and carry the real node ids. No
    guessing which rectangle is which.
  * edge polylines come from the PDF's vector paths, then get matched to nodes
    by endpoint proximity. Edges are visually unambiguous (open stroked paths),
    so this is reliable, and it also catches edges that were declared but never
    actually drawn.

If no .geom is available the extractor degrades to "inferred" mode: closed
stroked paths become anonymous nodes. Usable, but node ids are synthetic and
the group/orphan checks get weaker.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from .model import (
    Box,
    EdgeGeom,
    NodeGeom,
    Point,
    SceneGeometry,
    TextSpan,
    bbox_of,
    bezier_points,
    polyline_length,
    union_all,
)

try:
    import fitz  # PyMuPDF
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyMuPDF is required:  pip install pymupdf") from exc


# TeX point -> PDF big point
TEX_PT_TO_BP = 72.0 / 72.27

# A filled path smaller than this (bp^2) that sits near a line end is an arrowhead
ARROWHEAD_MAX_AREA = 60.0
ARROWHEAD_MAX_DIST = 6.0
# Endpoint within this distance of a node boundary counts as "attached"
ENDPOINT_SNAP = 10.0


# --------------------------------------------------------------------------
# .geom sidecar
# --------------------------------------------------------------------------

_DIM = re.compile(r"^(-?[\d.]+)pt$")


def _dim(tok: str) -> float:
    m = _DIM.match(tok.strip())
    if not m:
        raise ValueError(f"bad dimension in .geom: {tok!r}")
    return float(m.group(1))


@dataclass
class GeomDump:
    """Raw contents of a .geom file, still in picture-local pt (y up)."""

    nodes: Dict[str, Tuple[float, float, float, float]] = field(default_factory=dict)
    order: List[str] = field(default_factory=list)
    edges: List[Tuple[str, str, str]] = field(default_factory=list)
    groups: Set[str] = field(default_factory=set)
    shapes: Dict[str, str] = field(default_factory=dict)
    picture: Optional[Tuple[float, float, float, float]] = None


def parse_geom(path: str) -> GeomDump:
    dump = GeomDump()
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line:
                continue
            parts = line.split("|")
            kind = parts[0].strip()
            try:
                if kind == "NODE" and len(parts) >= 6:
                    nid = parts[1].strip()
                    vals = [_dim(v) for v in parts[2:] if v.strip()]
                    xs = vals[0::2]
                    ys = vals[1::2]
                    box = (min(xs), min(ys), max(xs), max(ys))
                    if nid == "__picture__":
                        dump.picture = box
                    else:
                        if nid not in dump.nodes:
                            dump.order.append(nid)
                        dump.nodes[nid] = box  # last write wins (late anchors)
                elif kind == "EDGE" and len(parts) >= 3:
                    label = parts[3].strip() if len(parts) > 3 else ""
                    dump.edges.append((parts[1].strip(), parts[2].strip(), label))
                elif kind == "GROUP" and len(parts) >= 2:
                    dump.groups.add(parts[1].strip())
                elif kind == "SHAPE" and len(parts) >= 3:
                    dump.shapes[parts[1].strip()] = parts[2].strip()
            except ValueError:
                continue
    return dump


class Calibration:
    """Maps picture-local pt (y up, picture origin) -> PDF page bp (y down)."""

    def __init__(self, picture_local: Tuple[float, float, float, float], page: Box):
        self.px0, self.py0, self.px1, self.py1 = picture_local
        self.s = TEX_PT_TO_BP
        pic_w = (self.px1 - self.px0) * self.s
        pic_h = (self.py1 - self.py0) * self.s
        # standalone centres the picture inside a uniform border
        self.bx = (page.width - pic_w) / 2.0
        self.by = (page.height - pic_h) / 2.0
        self.page = page
        self.residual = max(abs(self.bx), abs(self.by))

    def point(self, x: float, y: float) -> Point:
        return ((x - self.px0) * self.s + self.bx, (self.py1 - y) * self.s + self.by)

    def box(self, b: Tuple[float, float, float, float]) -> Box:
        x0, y0, x1, y1 = b
        p0 = self.point(x0, y1)  # local top-left
        p1 = self.point(x1, y0)  # local bottom-right
        return Box(p0[0], p0[1], p1[0], p1[1])


# --------------------------------------------------------------------------
# PDF side
# --------------------------------------------------------------------------


@dataclass
class RawPath:
    points: List[Point]
    closed: bool
    stroked: bool
    filled: bool
    box: Box
    width: float = 0.0
    is_rect: bool = False
    fill_opacity: float = 1.0


def _flatten_items(items: Sequence[Any]) -> Tuple[List[Point], bool]:
    """Flatten PyMuPDF drawing items into a point sequence."""
    pts: List[Point] = []
    is_rect = False

    def push(p) -> None:
        t = (float(p[0]), float(p[1]))
        if not pts or math.dist(pts[-1], t) > 1e-6:
            pts.append(t)

    for it in items:
        op = it[0]
        if op == "l":
            push(it[1])
            push(it[2])
        elif op == "c":
            push(it[1])
            for q in bezier_points(
                (it[1][0], it[1][1]),
                (it[2][0], it[2][1]),
                (it[3][0], it[3][1]),
                (it[4][0], it[4][1]),
                n=8,
            ):
                push(q)
        elif op == "re":
            r = it[1]
            is_rect = True
            for q in (
                (r.x0, r.y0),
                (r.x1, r.y0),
                (r.x1, r.y1),
                (r.x0, r.y1),
                (r.x0, r.y0),
            ):
                push(q)
        elif op == "qu":
            q = it[1]
            for p in (q.ul, q.ur, q.lr, q.ll, q.ul):
                push(p)
    return pts, is_rect


def read_paths(page) -> List[RawPath]:
    out: List[RawPath] = []
    for d in page.get_drawings():
        pts, is_rect = _flatten_items(d.get("items", []))
        if len(pts) < 2:
            continue
        typ = d.get("type", "")
        closed = bool(d.get("closePath")) or is_rect or (
            math.dist(pts[0], pts[-1]) < 0.75 and len(pts) > 2
        )
        out.append(
            RawPath(
                points=pts,
                closed=closed,
                stroked="s" in typ,
                filled="f" in typ,
                box=bbox_of(pts),
                width=float(d.get("width") or 0.0),
                is_rect=is_rect,
                fill_opacity=(
                    1.0 if d.get("fill_opacity") is None else float(d["fill_opacity"])
                ),
            )
        )
    return out


def read_spans(page) -> List[TextSpan]:
    spans: List[TextSpan] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for sp in line.get("spans", []):
                text = sp.get("text", "")
                if not text.strip():
                    continue
                b = sp["bbox"]
                spans.append(
                    TextSpan(
                        text=text,
                        box=Box(b[0], b[1], b[2], b[3]),
                        size=float(sp.get("size", 0.0)),
                        font=sp.get("font", ""),
                    )
                )
    return spans


# --------------------------------------------------------------------------
# Edge reconstruction
# --------------------------------------------------------------------------


def _polyline_candidates(paths: Sequence[RawPath]) -> List[RawPath]:
    return [
        p
        for p in paths
        if p.stroked and not p.closed and len(p.points) >= 2 and p.box.area >= 0.0
    ]


def _arrowhead_candidates(paths: Sequence[RawPath]) -> List[RawPath]:
    return [
        p
        for p in paths
        if p.filled and p.closed and not p.is_rect and p.box.area <= ARROWHEAD_MAX_AREA
    ]


def _attach_tip(poly: List[Point], heads: Sequence[RawPath]) -> Optional[Point]:
    """Find the arrowhead sitting on the end of this polyline and return its tip."""
    end = poly[-1]
    prev = poly[-2] if len(poly) > 1 else poly[-1]
    dx, dy = end[0] - prev[0], end[1] - prev[1]
    norm = math.hypot(dx, dy) or 1.0
    dx, dy = dx / norm, dy / norm
    best: Optional[RawPath] = None
    best_d = ARROWHEAD_MAX_DIST
    for h in heads:
        d = h.box.dist_to_point(end)
        if d < best_d:
            best, best_d = h, d
    if best is None:
        return None
    return max(best.points, key=lambda p: (p[0] - end[0]) * dx + (p[1] - end[1]) * dy)


def _nearest_node(
    p: Point, nodes: Dict[str, NodeGeom], snap: float = ENDPOINT_SNAP
) -> Optional[str]:
    best, best_d = None, snap
    for nid, n in nodes.items():
        if n.is_group:
            continue
        d = n.box.dist_to_point(p)
        if d < best_d:
            best, best_d = nid, d
    if best is not None:
        return best
    # endpoint may be *inside* a node (a common defect) -- catch that too
    inside = [
        (n.box.area, nid)
        for nid, n in nodes.items()
        if not n.is_group and n.box.contains_point(p)
    ]
    return min(inside)[1] if inside else None


def _endpoint_cost(pt: Point, nid: Optional[str], nodes: Dict[str, NodeGeom]) -> float:
    if nid is None or nid not in nodes:
        return 1e6
    return nodes[nid].box.dist_to_point(pt)


def build_edges(
    paths: Sequence[RawPath],
    nodes: Dict[str, NodeGeom],
    declared: Sequence[Tuple[str, str, str]],
) -> Tuple[List[EdgeGeom], List[str]]:
    heads = _arrowhead_candidates(paths)
    polys: List[Tuple[List[Point], Optional[Point]]] = []
    for p in _polyline_candidates(paths):
        pts = p.points
        # filter by LENGTH, never by bbox area: an axis-aligned arrow has a
        # zero-area bounding box and is still a perfectly good edge.
        if polyline_length(pts) < 2.0:
            continue
        polys.append((list(pts), _attach_tip(pts, heads)))

    warnings: List[str] = []
    out: List[EdgeGeom] = []
    used: Set[int] = set()

    # Pass 1: every DECLARED edge claims its closest unused polyline. Using the
    # declaration as a prior avoids mislabelling an arrow that lands inside a
    # region node as pointing at whatever small node happens to sit there.
    for s_id, d_id, label in declared:
        best_i, best_cost, best_rev = None, 60.0, False
        for i, (pts, tip) in enumerate(polys):
            if i in used:
                continue
            end = tip or pts[-1]
            fwd = _endpoint_cost(pts[0], s_id, nodes) + _endpoint_cost(end, d_id, nodes)
            rev = _endpoint_cost(end, s_id, nodes) + _endpoint_cost(pts[0], d_id, nodes)
            cost, is_rev = (fwd, False) if fwd <= rev else (rev, True)
            if cost < best_cost:
                best_i, best_cost, best_rev = i, cost, is_rev
        if best_i is None:
            out.append(
                EdgeGeom(src=s_id, dst=d_id, points=[], declared=True,
                         matched=False, label=label)
            )
            warnings.append(f"declared edge {s_id}->{d_id} has no matching drawn path")
            continue
        used.add(best_i)
        pts, tip = polys[best_i]
        if best_rev:
            pts = list(reversed(pts))
            tip = None
        e = EdgeGeom(src=s_id, dst=d_id, points=pts, declared=True,
                     matched=True, tip=tip, label=label)
        e.drawn_src = _nearest_node(pts[0], nodes)
        e.drawn_dst = _nearest_node(tip or pts[-1], nodes)
        out.append(e)

    # Pass 2: leftover polylines were drawn but never declared.
    for i, (pts, tip) in enumerate(polys):
        if i in used:
            continue
        src = _nearest_node(pts[0], nodes)
        dst = _nearest_node(tip or pts[-1], nodes)
        if src is None and dst is None:
            continue  # decorative rule, not an edge
        e = EdgeGeom(src=src, dst=dst, points=pts, declared=not declared,
                     matched=True, tip=tip)
        e.drawn_src, e.drawn_dst = src, dst
        out.append(e)
    return out, warnings


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------


def _assign_labels(nodes: Dict[str, NodeGeom], spans: Sequence[TextSpan]) -> None:
    for sp in spans:
        c = sp.box.center
        owners = [
            (n.box.area, nid)
            for nid, n in nodes.items()
            if n.box.contains_point(c, tol=0.5)
        ]
        if not owners:
            continue
        nid = min(owners)[1]  # smallest containing node wins
        sp.owner = nid
        nodes[nid].label_boxes.append(sp.box)
        nodes[nid].label = (nodes[nid].label + " " + sp.text).strip()


def annotate_paint(nodes: Dict[str, NodeGeom], paths: Sequence[RawPath],
                   order: Sequence[str], tol: float = 2.5) -> None:
    """Assign paint order and detect which nodes actually have fill / border."""
    for z, nid in enumerate(order):
        if nid in nodes:
            nodes[nid].z = z
    for nid, n in nodes.items():
        for p in paths:
            b = p.box
            if (
                abs(b.x0 - n.box.x0) <= tol and abs(b.y0 - n.box.y0) <= tol
                and abs(b.x1 - n.box.x1) <= tol and abs(b.y1 - n.box.y1) <= tol
            ):
                if p.filled and p.fill_opacity >= 0.9:
                    n.filled = True
                if p.stroked:
                    n.stroked = True


def _infer_nodes(paths: Sequence[RawPath]) -> Dict[str, NodeGeom]:
    nodes: Dict[str, NodeGeom] = {}
    i = 0
    for p in paths:
        if not p.closed or p.box.area < 12.0:
            continue
        if not (p.stroked or p.filled):
            continue
        nid = f"#{i}"
        nodes[nid] = NodeGeom(
            id=nid, box=p.box, shape="rect" if p.is_rect else "closed", declared=False
        )
        i += 1
    return nodes


def build_scene(pdf_path: str, geom_path: Optional[str] = None, page_index: int = 0) -> SceneGeometry:
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    page_box = Box(page.rect.x0, page.rect.y0, page.rect.x1, page.rect.y1)

    spans = read_spans(page)
    paths = read_paths(page)

    scene = SceneGeometry(page=page_box, source=pdf_path)

    dump: Optional[GeomDump] = None
    if geom_path:
        try:
            dump = parse_geom(geom_path)
        except OSError:
            scene.warnings.append(f"could not read {geom_path}; falling back to inference")

    if dump and dump.nodes and dump.picture:
        cal = Calibration(dump.picture, page_box)
        if cal.residual > 40:
            scene.warnings.append(
                f"calibration border {cal.residual:.1f}bp looks large; "
                "is the picture centred on the page?"
            )
        for nid in dump.order:
            scene.nodes[nid] = NodeGeom(
                id=nid,
                box=cal.box(dump.nodes[nid]),
                shape=dump.shapes.get(nid, "rect"),
                is_group=nid in dump.groups,
                declared=True,
            )
        scene.mode = "geomdump"
    else:
        scene.nodes = _infer_nodes(paths)
        scene.mode = "inferred"
        scene.warnings.append(
            "no .geom sidecar: node ids are synthetic and group/orphan checks are weak"
        )

    annotate_paint(scene.nodes, paths, dump.order if dump else list(scene.nodes))
    _assign_labels(scene.nodes, spans)
    scene.spans = spans

    coords = [
        nid
        for nid, n in scene.nodes.items()
        if n.box.area < 0.5 and not n.label_boxes
    ]
    for nid in coords:
        del scene.nodes[nid]
    if coords:
        scene.warnings.append(
            f"ignored {len(coords)} zero-size node(s) treated as \\coordinate: "
            + ", ".join(coords[:8])
        )

    declared_edges = dump.edges if dump else []
    scene.edges, edge_warnings = build_edges(paths, scene.nodes, declared_edges)
    scene.warnings.extend(edge_warnings)
    scene.compute_degrees()

    ink_boxes = [sp.box for sp in spans] + [p.box for p in paths]
    scene.ink = union_all(ink_boxes) or page_box
    return scene


# --------------------------------------------------------------------------
# LaTeX log
# --------------------------------------------------------------------------

_OVERFULL = re.compile(r"Overfull \\[hv]box \(([\d.]+)pt too (?:wide|high)\)")


def read_log(log_path: str, overfull_pt: float = 5.0) -> List[str]:
    """Return human-readable problems found in the LaTeX log."""
    issues: List[str] = []
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return issues
    for m in _OVERFULL.finditer(text):
        if float(m.group(1)) >= overfull_pt:
            issues.append(f"{m.group(0)}")
    for pat, msg in (
        (r"Package pgf Warning: ([^\n]+)", "pgf warning: {}"),
        (r"LaTeX Warning: Reference `([^']+)' on page", "undefined reference: {}"),
    ):
        for m in re.finditer(pat, text):
            issues.append(msg.format(m.group(1)))
    return issues
