"""Tier 0 gates (binary, blocking) and Tier 1 metrics (continuous, ranked).

Nothing in here calls a model. Every finding is a number computed from the
compiled artefact, which is why it is trustworthy enough to gate on. The VLM's
job starts *after* this file returns PASS, and is limited to semantics:
is the relationship correct, is the abstraction faithful, is it readable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations
from typing import Dict, List, Optional, Sequence, Tuple

from .model import (
    Box,
    EdgeGeom,
    NodeGeom,
    PT_PER_MM,
    SceneGeometry,
    polyline_box_penetration,
    polyline_crosses_box,
    polyline_intersections,
    polyline_length,
)
from .report import GateReport, Issue


@dataclass
class CheckConfig:
    # Tier 0
    min_font_pt: float = 6.0
    text_collision_tol: float = 0.4  # bp of kerning slop before it counts
    clip_tol: float = 0.5
    label_overflow_tol: float = 0.5
    overfull_pt: float = 5.0
    # Tier 1
    node_overlap_tol: float = 1.0  # bp^2 below this is rounding, not overlap
    hidden_frac: float = 0.85  # covered above this == node effectively lost
    arrow_landing_tol: float = 3.0  # bp
    align_tol: float = 1.0 * PT_PER_MM  # 1 mm
    min_node_gap: float = 4.0  # bp
    max_occlusion_ratio: float = 0.02
    max_feedback: int = 3


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _fmt(v: float, unit: str = "bp") -> str:
    return f"{v:.1f}{unit}"


def _pair_key(a: str, b: str) -> Tuple[str, str]:
    return (a, b) if a <= b else (b, a)


def _containing_groups(scene: SceneGeometry, nid: str) -> List[str]:
    n = scene.nodes.get(nid)
    if n is None:
        return []
    return [
        g.id
        for g in scene.nodes.values()
        if g.is_group and g.id != nid and g.box.contains(n.box, tol=1.0)
    ]


# --------------------------------------------------------------------------
# Tier 0 -- hard gates
# --------------------------------------------------------------------------


def gate_compile(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    issues = [
        Issue(
            kind="latex_log",
            tier=0,
            severity="major",
            evidence=msg,
            fix="Resolve the LaTeX warning; a box that overflows in the log is "
            "usually a label too wide for its node -- widen the node "
            "(`text width=`) or shorten the label.",
            rank_value=1.0,
        )
        for msg in scene.log_issues
    ]
    return (not issues), issues


def gate_no_clipping(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    issues: List[Issue] = []
    page, ink = scene.page, scene.ink
    over = {
        "left": page.x0 - ink.x0,
        "top": page.y0 - ink.y0,
        "right": ink.x1 - page.x1,
        "bottom": ink.y1 - page.y1,
    }
    worst = max(over.values())
    if worst > cfg.clip_tol:
        sides = ", ".join(f"{k} {_fmt(v)}" for k, v in over.items() if v > cfg.clip_tol)
        issues.append(
            Issue(
                kind="content_clipped",
                tier=0,
                severity="blocking",
                evidence=f"Drawing extends past the page: {sides}.",
                fix="Increase the standalone `border=` or shrink the layout. "
                "Never fix this by cropping -- content is being lost.",
                measurement=dict(over),
                rank_value=worst,
            )
        )
    for n in scene.nodes.values():
        if not page.contains(n.box, tol=cfg.clip_tol):
            d = max(
                page.x0 - n.box.x0, page.y0 - n.box.y0,
                n.box.x1 - page.x1, n.box.y1 - page.y1,
            )
            issues.append(
                Issue(
                    kind="node_clipped",
                    tier=0,
                    severity="blocking",
                    evidence=f"Node `{n.id}` extends {_fmt(d)} beyond the page.",
                    fix=f"Move `{n.id}` inside the canvas using `positioning` "
                    f"(e.g. `below=1cm of <anchor>`), or enlarge the border.",
                    nodes=[n.id],
                    measurement={"overflow_bp": d},
                    rank_value=d,
                )
            )
    return (not issues), issues


def gate_text_collision(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    issues: List[Issue] = []
    spans = [s for s in scene.spans if not s.is_blank]
    for a, b in combinations(spans, 2):
        area = a.box.inter_area(b.box)
        if area <= cfg.text_collision_tol:
            continue
        # same-line kerning artefacts: tiny slivers on a shared baseline
        if abs(a.box.y0 - b.box.y0) < 0.3 and area < 1.5:
            continue
        issues.append(
            Issue(
                kind="text_overlap",
                tier=0,
                severity="blocking",
                evidence=f'Text "{a.text.strip()[:28]}" overlaps '
                f'"{b.text.strip()[:28]}" over {_fmt(area, "bp²")}.',
                fix="Separate the two labels: move one node, add `text width` "
                "with wrapping, or place the edge label with `sloped, above`.",
                nodes=list(dict.fromkeys(x for x in (a.owner, b.owner) if x)),
                measurement={"overlap_bp2": area},
                rank_value=area,
            )
        )
    return (not issues), issues


def gate_nodes_rendered(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    issues: List[Issue] = []
    for n in scene.nodes.values():
        if n.box.area <= 0.5:
            issues.append(
                Issue(
                    kind="node_missing",
                    tier=0,
                    severity="blocking",
                    evidence=f"Node `{n.id}` was declared but has zero area "
                    "(it never rendered).",
                    fix=f"Check that `{n.id}` is drawn before it is referenced and "
                    "that its style is not `opacity=0` / `draw=none, text=none`.",
                    nodes=[n.id],
                    rank_value=10.0,
                )
            )
    return (not issues), issues


def gate_no_orphans(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    """Only structural nodes (with a border or fill) need a connection.

    A bare text annotation is allowed to float; a drawn box that connects to
    nothing is a dangling claim.
    """
    if scene.mode != "geomdump" or not scene.edges:
        return True, []
    orphans = [
        n
        for n in scene.nodes.values()
        if not n.is_group
        and n.degree == 0
        and (n.stroked or n.filled)
        and not _containing_groups(scene, n.id)
    ]
    if not orphans:
        return True, []
    names = ", ".join(f"`{n.id}`" for n in orphans[:6])
    more = f" (+{len(orphans)-6} more)" if len(orphans) > 6 else ""
    return False, [
        Issue(
            kind="orphan_node",
            tier=0,
            severity="major",
            evidence=f"{len(orphans)} drawn node(s) have no edge and no containing "
            f"group: {names}{more}.",
            fix="Connect each to the element it illustrates, or wrap the related "
            "ones in a `fit` group node so the grouping is explicit rather than "
            "implied by proximity.",
            nodes=[n.id for n in orphans],
            measurement={"count": float(len(orphans))},
            rank_value=float(len(orphans)),
        )
    ]


def gate_min_font(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    issues: List[Issue] = []
    small = [s for s in scene.spans if 0 < s.size < cfg.min_font_pt]
    if small:
        worst = min(s.size for s in small)
        issues.append(
            Issue(
                kind="font_too_small",
                tier=0,
                severity="major",
                evidence=f"{len(small)} text span(s) below {cfg.min_font_pt}pt "
                f"(smallest {worst:.1f}pt), e.g. \"{small[0].text.strip()[:24]}\".",
                fix="Raise the font size or reduce global `scale=`; shrinking text "
                "to make a crowded layout fit hides the real layout problem.",
                nodes=[s.owner for s in small if s.owner][:4],
                measurement={"min_pt": worst, "count": float(len(small))},
                rank_value=cfg.min_font_pt - worst,
            )
        )
    return (not issues), issues


def gate_label_containment(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    issues: List[Issue] = []
    for n in scene.nodes.values():
        if n.is_group:
            continue
        for lb in n.label_boxes:
            if n.box.contains(lb, tol=cfg.label_overflow_tol):
                continue
            d = max(
                n.box.x0 - lb.x0, n.box.y0 - lb.y0, lb.x1 - n.box.x1, lb.y1 - n.box.y1
            )
            issues.append(
                Issue(
                    kind="label_overflow",
                    tier=0,
                    severity="major",
                    evidence=f"Label of `{n.id}` spills {_fmt(d)} outside its shape.",
                    fix=f"Give `{n.id}` `text width=<w>, align=center` or add "
                    "`inner sep`; do not let text escape its container.",
                    nodes=[n.id],
                    measurement={"overflow_bp": d},
                    rank_value=d,
                )
            )
    return (not issues), issues


def gate_edges_drawn(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    issues = [
        Issue(
            kind="edge_not_drawn",
            tier=0,
            severity="blocking",
            evidence=f"Edge `{e.src}` -> `{e.dst}` was declared but no path was found.",
            fix=f"Add the missing `\\draw ({e.src}) -- ({e.dst});` or drop the "
            "declaration from the scene graph so the two stay in sync.",
            edges=[e.key],
            rank_value=5.0,
        )
        for e in scene.edges
        if e.declared and not e.matched
    ]
    return (not issues), issues


def gate_edge_endpoints(scene: SceneGeometry, cfg: CheckConfig) -> Tuple[bool, List[Issue]]:
    """The drawn path must land on the node the scene graph says it lands on."""
    issues: List[Issue] = []
    for e in scene.edges:
        if not e.declared or not e.matched:
            continue
        for role, want, got in (
            ("starts at", e.src, e.drawn_src),
            ("lands on", e.dst, e.drawn_dst),
        ):
            if not want or not got or want == got:
                continue
            wb, gb = scene.nodes.get(want), scene.nodes.get(got)
            if wb and gb and wb.box.inter_area(gb.box) > 0:
                continue  # nested/overlapping targets: ambiguous, not wrong
            issues.append(
                Issue(
                    kind="edge_endpoint_mismatch",
                    tier=0,
                    severity="blocking",
                    evidence=f"Edge declared `{e.src}`->`{e.dst}` actually {role} "
                    f"`{got}`, not `{want}`.",
                    fix=f"Replace the literal coordinate with the node name: "
                    f"`\\draw[-Stealth] ({e.src}) -- ({e.dst});`.",
                    edges=[e.key],
                    nodes=[want, got],
                    rank_value=8.0,
                )
            )
    return (not issues), issues


TIER0_GATES = [
    ("compiles_clean", gate_compile),
    ("no_clipping", gate_no_clipping),
    ("no_text_collision", gate_text_collision),
    ("all_nodes_rendered", gate_nodes_rendered),
    ("no_orphan_nodes", gate_no_orphans),
    ("min_font_size", gate_min_font),
    ("labels_contained", gate_label_containment),
    ("declared_edges_drawn", gate_edges_drawn),
    ("edge_endpoints_correct", gate_edge_endpoints),
]


# --------------------------------------------------------------------------
# Tier 1 -- continuous metrics
# --------------------------------------------------------------------------


def metric_occlusion(
    scene: SceneGeometry, cfg: CheckConfig
) -> Tuple[Dict[str, float], List[Issue]]:
    """Occlusion is a paint-order question, not a bbox question.

    A label deliberately placed inside a region node is not a defect. A node
    painted *before* an opaque fill that covers it has been deleted from the
    figure while remaining in the source -- which is exactly the bug that a
    self-scoring discriminator rates 9/10 on completeness.
    """
    issues: List[Issue] = []
    nodes = [n for n in scene.nodes.values() if not n.is_group and n.box.area > 0]
    total_area = sum(n.box.area for n in nodes) or 1.0
    overlap_total = 0.0

    for a, b in combinations(nodes, 2):
        area = a.box.inter_area(b.box)
        if area <= cfg.node_overlap_tol:
            continue
        lower, upper = (a, b) if a.z <= b.z else (b, a)  # upper is painted later
        covered = area / lower.box.area if lower.box.area > 0 else 0.0

        if upper.filled and covered >= cfg.hidden_frac:
            overlap_total += area
            issues.append(
                Issue(
                    kind="node_occluded",
                    tier=0,
                    severity="blocking",
                    evidence=f"`{lower.id}` is {covered*100:.0f}% covered by the "
                    f"opaque fill of `{upper.id}` ({_fmt(area, 'bp²')}); it is "
                    "present in the source but invisible in the render.",
                    fix=f"Give `{lower.id}` its own slot instead of an absolute "
                    f"coordinate: `\\node (...) [below=1.2cm of {upper.id}] {{...}}`. "
                    f"If `{lower.id}` is meant to sit inside `{upper.id}`, draw it "
                    "afterwards or move the fill to the `background` layer.",
                    nodes=[lower.id, upper.id],
                    measurement={"overlap_bp2": area, "covered_frac": covered},
                    rank_value=2000 + area,
                )
            )
        elif upper.filled and covered >= 0.15:
            overlap_total += area
            issues.append(
                Issue(
                    kind="node_partially_hidden",
                    tier=1,
                    severity="major",
                    evidence=f"`{lower.id}` is {covered*100:.0f}% obscured by "
                    f"`{upper.id}` ({_fmt(area, 'bp²')}).",
                    fix=f"Separate them with `positioning`, or move `{upper.id}`'s "
                    "fill onto the `background` layer with `\\begin{scope}[on "
                    "background layer]`.",
                    nodes=[lower.id, upper.id],
                    measurement={"overlap_bp2": area, "covered_frac": covered},
                    rank_value=1000 + area,
                )
            )
        elif lower.stroked and upper.stroked:
            overlap_total += area
            issues.append(
                Issue(
                    kind="node_overlap",
                    tier=1,
                    severity="major",
                    evidence=f"Borders of `{a.id}` and `{b.id}` intersect over "
                    f"{_fmt(area, 'bp²')}.",
                    fix=f"Increase separation between `{a.id}` and `{b.id}` "
                    "(raise `node distance`, or place one `right=1.5cm of` the "
                    "other).",
                    nodes=[a.id, b.id],
                    measurement={"overlap_bp2": area},
                    rank_value=area,
                )
            )

    return (
        {"occlusion_ratio": overlap_total / total_area,
         "occlusion_area_bp2": overlap_total},
        issues,
    )


def metric_edge_node_crossings(
    scene: SceneGeometry, cfg: CheckConfig
) -> Tuple[Dict[str, float], List[Issue]]:
    """The single best predictor of 'this looks like spaghetti'."""
    issues: List[Issue] = []
    count = 0
    for e in scene.edges:
        if len(e.points) < 2:
            continue
        exempt = {e.src, e.dst} | set(
            g for nid in (e.src, e.dst) if nid for g in _containing_groups(scene, nid)
        )
        for n in scene.nodes.values():
            if n.is_group or n.id in exempt or n.box.area <= 0:
                continue
            if not polyline_crosses_box(e.points, n.box):
                continue
            pen = polyline_box_penetration(e.points, n.box)
            if pen < 0.75:
                continue
            count += 1
            issues.append(
                Issue(
                    kind="edge_crosses_node",
                    tier=1,
                    severity="major",
                    evidence=f"Edge `{e.key}` runs {_fmt(pen)} through unrelated "
                    f"node `{n.id}`.",
                    fix=f"Route around `{n.id}`: use `to[out=<a>,in=<b>]` or an "
                    f"`-|`/`|-` orthogonal path, or move `{n.id}` out of the "
                    "corridor between the endpoints.",
                    nodes=[n.id],
                    edges=[e.key],
                    measurement={"penetration_bp": pen},
                    rank_value=pen,
                )
            )
    return {"edge_node_crossings": float(count)}, issues


def metric_edge_edge_crossings(
    scene: SceneGeometry, cfg: CheckConfig
) -> Tuple[Dict[str, float], List[Issue]]:
    issues: List[Issue] = []
    drawn = [e for e in scene.edges if len(e.points) >= 2]
    count = 0
    for a, b in combinations(drawn, 2):
        if {a.src, a.dst} & {b.src, b.dst}:
            continue  # sharing an endpoint is not a crossing
        hits = polyline_intersections(a.points, b.points)
        if hits:
            count += len(hits)
            issues.append(
                Issue(
                    kind="edge_crossing",
                    tier=1,
                    severity="minor",
                    evidence=f"Edges `{a.key}` and `{b.key}` cross "
                    f"{len(hits)} time(s).",
                    fix="Reorder the nodes so the two edges do not have to cross "
                    "(swap sibling ranks), or bend one edge.",
                    edges=[a.key, b.key],
                    measurement={"crossings": float(len(hits))},
                    rank_value=float(len(hits)),
                )
            )
    return {"edge_edge_crossings": float(count)}, issues


def metric_arrow_landing(
    scene: SceneGeometry, cfg: CheckConfig
) -> Tuple[Dict[str, float], List[Issue]]:
    issues: List[Issue] = []
    worst = 0.0
    for e in scene.edges:
        if not e.points or not e.dst or e.dst not in scene.nodes:
            continue
        target = scene.nodes[e.dst]
        tip = e.tip or e.points[-1]
        d = target.box.signed_dist_to_point(tip)
        worst = max(worst, abs(d))
        if d < -cfg.arrow_landing_tol:
            issues.append(
                Issue(
                    kind="arrow_overshoot",
                    tier=1,
                    severity="major",
                    evidence=f"Arrow `{e.key}` terminates {_fmt(-d)} *inside* "
                    f"`{e.dst}` instead of at its boundary.",
                    fix=f"Draw to the node, not to a coordinate: "
                    f"`\\draw[-Stealth] ({e.src}) -- ({e.dst});` lets pgf clip at "
                    "the shape border. Remove the hard-coded end point.",
                    edges=[e.key],
                    nodes=[e.dst],
                    measurement={"landing_bp": d},
                    rank_value=-d,
                )
            )
        elif d > cfg.arrow_landing_tol:
            issues.append(
                Issue(
                    kind="arrow_short",
                    tier=1,
                    severity="minor",
                    evidence=f"Arrow `{e.key}` stops {_fmt(d)} short of `{e.dst}`; "
                    "the connection reads as ambiguous.",
                    fix=f"Terminate at `({e.dst})` (optionally with `shorten >=2pt`) "
                    "rather than at a literal coordinate.",
                    edges=[e.key],
                    nodes=[e.dst],
                    measurement={"landing_bp": d},
                    rank_value=d,
                )
            )
    return {"max_arrow_landing_err_bp": worst}, issues


def metric_alignment(
    scene: SceneGeometry, cfg: CheckConfig
) -> Tuple[Dict[str, float], List[Issue]]:
    nodes = [n for n in scene.nodes.values() if not n.is_group and n.box.area > 0]
    if len(nodes) < 2:
        return {"alignment_score": 1.0}, []

    def clustered(vals: Sequence[float]) -> int:
        used = [False] * len(vals)
        aligned = 0
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vals[order[j + 1]] - vals[order[i]] <= cfg.align_tol:
                j += 1
            size = j - i + 1
            if size >= 2:
                aligned += size
            i = j + 1
        return aligned

    xs = [n.box.center[0] for n in nodes]
    ys = [n.box.center[1] for n in nodes]
    score = max(clustered(xs), clustered(ys)) / len(nodes)
    issues: List[Issue] = []
    if score < 0.5:
        issues.append(
            Issue(
                kind="weak_alignment",
                tier=1,
                severity="minor",
                evidence=f"Only {score*100:.0f}% of nodes share a row or column "
                "axis; the layout reads as hand-scattered.",
                fix="Place nodes with `positioning` relative to a shared anchor, or "
                "lay the graph out with `matrix of nodes` / Graphviz ranks so "
                "centres line up exactly.",
                measurement={"alignment_score": score},
                rank_value=0.5 - score,
            )
        )
    return {"alignment_score": score}, issues


def metric_spacing(
    scene: SceneGeometry, cfg: CheckConfig
) -> Tuple[Dict[str, float], List[Issue]]:
    nodes = [n for n in scene.nodes.values() if not n.is_group and n.box.area > 0]
    issues: List[Issue] = []
    min_gap = math.inf
    tight: List[Tuple[str, str, float]] = []
    for a, b in combinations(nodes, 2):
        gap = a.box.gap_to(b.box)
        if gap <= 0:
            continue  # already reported as overlap
        min_gap = min(min_gap, gap)
        if gap < cfg.min_node_gap:
            tight.append((a.id, b.id, gap))
    if tight:
        tight.sort(key=lambda t: t[2])
        a, b, g = tight[0]
        issues.append(
            Issue(
                kind="crowding",
                tier=1,
                severity="minor",
                evidence=f"{len(tight)} node pair(s) sit closer than "
                f"{cfg.min_node_gap:.0f}bp; tightest is `{a}`/`{b}` at {_fmt(g)}.",
                fix="Increase `node distance` globally rather than nudging "
                "individual nodes -- local nudges reintroduce collisions.",
                nodes=[a, b],
                measurement={"min_gap_bp": g, "pairs": float(len(tight))},
                rank_value=cfg.min_node_gap - g,
            )
        )
    return {"min_node_gap_bp": 0.0 if min_gap is math.inf else min_gap}, issues


def metric_canvas_balance(
    scene: SceneGeometry, cfg: CheckConfig
) -> Tuple[Dict[str, float], List[Issue]]:
    page = scene.page
    if page.area <= 0:
        return {"canvas_fill": 0.0, "quadrant_cv": 0.0}, []
    fill = scene.ink.area / page.area
    cells = [0.0] * 9
    boxes = [n.box for n in scene.nodes.values() if not n.is_group] + [
        s.box for s in scene.spans
    ]
    for b in boxes:
        cx, cy = b.center
        gx = min(2, max(0, int((cx - page.x0) / (page.width / 3))))
        gy = min(2, max(0, int((cy - page.y0) / (page.height / 3))))
        cells[gy * 3 + gx] += b.area
    total = sum(cells) or 1.0
    mean = total / 9
    cv = math.sqrt(sum((c - mean) ** 2 for c in cells) / 9) / mean if mean else 0.0
    issues: List[Issue] = []
    if fill < 0.25:
        issues.append(
            Issue(
                kind="sparse_canvas",
                tier=1,
                severity="minor",
                evidence=f"Content fills only {fill*100:.0f}% of the canvas.",
                fix="Tighten the border or scale the picture up; large empty "
                "margins waste resolution when the figure is embedded.",
                measurement={"canvas_fill": fill},
                rank_value=0.25 - fill,
            )
        )
    if cv > 1.6:
        issues.append(
            Issue(
                kind="unbalanced_layout",
                tier=1,
                severity="minor",
                evidence=f"Ink is concentrated in a few regions "
                f"(3x3 coefficient of variation {cv:.2f}).",
                fix="Redistribute: give the crowded region more space and pull "
                "isolated elements toward the empty cells.",
                measurement={"quadrant_cv": cv},
                rank_value=cv,
            )
        )
    return {"canvas_fill": fill, "quadrant_cv": cv}, issues


TIER1_METRICS = [
    metric_occlusion,
    metric_edge_node_crossings,
    metric_edge_edge_crossings,
    metric_arrow_landing,
    metric_alignment,
    metric_spacing,
    metric_canvas_balance,
]


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------


def run_checks(scene: SceneGeometry, cfg: Optional[CheckConfig] = None) -> GateReport:
    cfg = cfg or CheckConfig()
    report = GateReport(max_feedback=cfg.max_feedback)

    for name, fn in TIER0_GATES:
        ok, issues = fn(scene, cfg)
        report.gates[name] = ok
        report.issues.extend(issues)

    for fn in TIER1_METRICS:
        metrics, issues = fn(scene, cfg)
        report.metrics.update(metrics)
        report.issues.extend(issues)

    report.gates["occlusion_within_budget"] = (
        report.metrics.get("occlusion_ratio", 0.0) <= cfg.max_occlusion_ratio
    )
    report.gates["no_edge_node_crossings"] = (
        report.metrics.get("edge_node_crossings", 0.0) == 0
    )
    report.gates["all_nodes_visible"] = not any(
        i.kind == "node_occluded" for i in report.issues
    )

    report.scene = scene.summary()
    return report.finalize()
