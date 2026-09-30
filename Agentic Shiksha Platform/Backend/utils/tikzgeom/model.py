"""Geometry primitives and the scene-geometry data model.

Frame convention (everything below uses it):
    PDF page points, origin at TOP-LEFT, x grows right, y grows DOWN.
    This matches PyMuPDF. LaTeX-local coordinates (y up) are converted
    once, in extract.py, and never leak past that boundary.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

Point = Tuple[float, float]

EPS = 1e-9
# TeX points per mm
PT_PER_MM = 72.27 / 25.4


# --------------------------------------------------------------------------
# Box
# --------------------------------------------------------------------------


@dataclass
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    def __post_init__(self) -> None:
        if self.x0 > self.x1:
            self.x0, self.x1 = self.x1, self.x0
        if self.y0 > self.y1:
            self.y0, self.y1 = self.y1, self.y0

    # -- basics ------------------------------------------------------------
    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    @property
    def center(self) -> Point:
        return ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)

    def as_tuple(self) -> Tuple[float, float, float, float]:
        return (self.x0, self.y0, self.x1, self.y1)

    def rounded(self, nd: int = 2) -> Tuple[float, float, float, float]:
        return tuple(round(v, nd) for v in self.as_tuple())  # type: ignore[return-value]

    # -- set ops -----------------------------------------------------------
    def intersect(self, other: "Box") -> Optional["Box"]:
        x0 = max(self.x0, other.x0)
        y0 = max(self.y0, other.y0)
        x1 = min(self.x1, other.x1)
        y1 = min(self.y1, other.y1)
        if x1 - x0 <= EPS or y1 - y0 <= EPS:
            return None
        return Box(x0, y0, x1, y1)

    def inter_area(self, other: "Box") -> float:
        b = self.intersect(other)
        return b.area if b else 0.0

    def iou(self, other: "Box") -> float:
        inter = self.inter_area(other)
        union = self.area + other.area - inter
        return inter / union if union > EPS else 0.0

    def overlap_frac(self, other: "Box") -> float:
        """Fraction of *self* covered by other."""
        return self.inter_area(other) / self.area if self.area > EPS else 0.0

    def union(self, other: "Box") -> "Box":
        return Box(
            min(self.x0, other.x0),
            min(self.y0, other.y0),
            max(self.x1, other.x1),
            max(self.y1, other.y1),
        )

    def contains(self, other: "Box", tol: float = 0.0) -> bool:
        return (
            self.x0 - tol <= other.x0
            and self.y0 - tol <= other.y0
            and self.x1 + tol >= other.x1
            and self.y1 + tol >= other.y1
        )

    def contains_point(self, p: Point, tol: float = 0.0) -> bool:
        return (
            self.x0 - tol <= p[0] <= self.x1 + tol
            and self.y0 - tol <= p[1] <= self.y1 + tol
        )

    def expand(self, d: float) -> "Box":
        return Box(self.x0 - d, self.y0 - d, self.x1 + d, self.y1 + d)

    # -- distances ---------------------------------------------------------
    def dist_to_point(self, p: Point) -> float:
        """0 inside, otherwise Euclidean distance to the boundary."""
        dx = max(self.x0 - p[0], 0.0, p[0] - self.x1)
        dy = max(self.y0 - p[1], 0.0, p[1] - self.y1)
        return math.hypot(dx, dy)

    def signed_dist_to_point(self, p: Point) -> float:
        """Negative when the point is INSIDE (depth below the boundary)."""
        if not self.contains_point(p):
            return self.dist_to_point(p)
        return -min(
            p[0] - self.x0, self.x1 - p[0], p[1] - self.y0, self.y1 - p[1]
        )

    def gap_to(self, other: "Box") -> float:
        """Closest distance between the two rectangles (0 if they touch)."""
        dx = max(self.x0 - other.x1, other.x0 - self.x1, 0.0)
        dy = max(self.y0 - other.y1, other.y0 - self.y1, 0.0)
        return math.hypot(dx, dy)

    def edges(self) -> List[Tuple[Point, Point]]:
        a = (self.x0, self.y0)
        b = (self.x1, self.y0)
        c = (self.x1, self.y1)
        d = (self.x0, self.y1)
        return [(a, b), (b, c), (c, d), (d, a)]


def bbox_of(points: Sequence[Point]) -> Box:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return Box(min(xs), min(ys), max(xs), max(ys))


def union_all(boxes: Sequence[Box]) -> Optional[Box]:
    if not boxes:
        return None
    out = boxes[0]
    for b in boxes[1:]:
        out = out.union(b)
    return out


# --------------------------------------------------------------------------
# Segment / polyline geometry
# --------------------------------------------------------------------------


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_seg(a: Point, b: Point, p: Point) -> bool:
    return (
        min(a[0], b[0]) - EPS <= p[0] <= max(a[0], b[0]) + EPS
        and min(a[1], b[1]) - EPS <= p[1] <= max(a[1], b[1]) + EPS
    )


def seg_intersect(a: Point, b: Point, c: Point, d: Point) -> Optional[Point]:
    """Proper or improper segment intersection; returns a point or None."""
    d1, d2 = _orient(c, d, a), _orient(c, d, b)
    d3, d4 = _orient(a, b, c), _orient(a, b, d)
    if ((d1 > EPS and d2 < -EPS) or (d1 < -EPS and d2 > EPS)) and (
        (d3 > EPS and d4 < -EPS) or (d3 < -EPS and d4 > EPS)
    ):
        denom = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])
        if abs(denom) < EPS:
            return None
        t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / denom
        return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
    for da, (p, q, r) in ((d1, (c, d, a)), (d2, (c, d, b)), (d3, (a, b, c)), (d4, (a, b, d))):
        if abs(da) < EPS and _on_seg(p, q, r):
            return r
    return None


def seg_crosses_box(a: Point, b: Point, box: Box) -> bool:
    """True if the segment enters/touches the box interior."""
    if box.contains_point(a) or box.contains_point(b):
        return True
    return any(seg_intersect(a, b, e[0], e[1]) is not None for e in box.edges())


def polyline_length(pts: Sequence[Point]) -> float:
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def polyline_crosses_box(pts: Sequence[Point], box: Box) -> bool:
    return any(seg_crosses_box(pts[i], pts[i + 1], box) for i in range(len(pts) - 1))


def polyline_box_penetration(pts: Sequence[Point], box: Box) -> float:
    """Approximate length of the polyline lying inside the box (sampled)."""
    inside = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        seg = math.dist(a, b)
        if seg < EPS:
            continue
        n = max(4, int(seg / 2.0))
        hits = sum(
            1
            for k in range(n)
            if box.contains_point(
                (
                    a[0] + (b[0] - a[0]) * (k + 0.5) / n,
                    a[1] + (b[1] - a[1]) * (k + 0.5) / n,
                )
            )
        )
        inside += seg * hits / n
    return inside


def polyline_intersections(p: Sequence[Point], q: Sequence[Point]) -> List[Point]:
    out: List[Point] = []
    for i in range(len(p) - 1):
        for j in range(len(q) - 1):
            hit = seg_intersect(p[i], p[i + 1], q[j], q[j + 1])
            if hit is not None:
                out.append(hit)
    return out


def bezier_points(p0: Point, p1: Point, p2: Point, p3: Point, n: int = 8) -> List[Point]:
    pts = []
    for k in range(1, n + 1):
        t = k / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


# --------------------------------------------------------------------------
# Scene model
# --------------------------------------------------------------------------


@dataclass
class TextSpan:
    text: str
    box: Box
    size: float = 0.0
    font: str = ""
    owner: Optional[str] = None  # node id this label belongs to, if any

    @property
    def is_blank(self) -> bool:
        return not self.text.strip()


@dataclass
class NodeGeom:
    id: str
    box: Box
    shape: str = "rect"
    is_group: bool = False  # container (fit / background): containment is legal
    label: str = ""
    label_boxes: List[Box] = field(default_factory=list)
    declared: bool = True
    rendered: bool = True
    source_line: Optional[int] = None
    z: int = 0          # paint order: higher is drawn later, i.e. on top
    filled: bool = False  # has an opaque fill -> can actually hide things
    stroked: bool = False  # has a visible border -> outline collisions matter

    @property
    def degree(self) -> int:
        return self._degree

    _degree: int = 0


@dataclass
class EdgeGeom:
    src: Optional[str]
    dst: Optional[str]
    points: List[Point] = field(default_factory=list)
    declared: bool = True
    matched: bool = True  # was a drawn polyline found for a declared edge?
    tip: Optional[Point] = None  # arrowhead tip, if one was detected
    label: str = ""
    drawn_src: Optional[str] = None  # where the path actually starts
    drawn_dst: Optional[str] = None  # where the path actually lands

    @property
    def key(self) -> str:
        return f"{self.src or '?'}->{self.dst or '?'}"


@dataclass
class SceneGeometry:
    nodes: Dict[str, NodeGeom] = field(default_factory=dict)
    edges: List[EdgeGeom] = field(default_factory=list)
    spans: List[TextSpan] = field(default_factory=list)
    page: Box = field(default_factory=lambda: Box(0, 0, 0, 0))
    ink: Box = field(default_factory=lambda: Box(0, 0, 0, 0))
    source: str = ""
    mode: str = "geomdump"  # "geomdump" (exact) | "inferred" (fallback)
    warnings: List[str] = field(default_factory=list)
    log_issues: List[str] = field(default_factory=list)

    # -- convenience -------------------------------------------------------
    def node(self, nid: str) -> Optional[NodeGeom]:
        return self.nodes.get(nid)

    @property
    def content_nodes(self) -> List[NodeGeom]:
        return [n for n in self.nodes.values() if not n.is_group and n.rendered]

    def compute_degrees(self) -> None:
        for n in self.nodes.values():
            n._degree = 0
        for e in self.edges:
            for nid in (e.src, e.dst):
                if nid and nid in self.nodes:
                    self.nodes[nid]._degree += 1

    def summary(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "mode": self.mode,
            "page_pt": self.page.rounded(),
            "ink_pt": self.ink.rounded(),
            "n_nodes": len(self.nodes),
            "n_groups": sum(1 for n in self.nodes.values() if n.is_group),
            "n_edges": len(self.edges),
            "n_spans": len(self.spans),
            "warnings": self.warnings,
        }
