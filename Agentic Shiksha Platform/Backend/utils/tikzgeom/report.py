"""Issues, ranking, and the JSON gate report.

Design rules that matter more than the code:

  * Every issue carries a *measurement*. "spatial_layout: 8/10" is unactionable;
    "latent is 92% covered by textenc (847 bp^2)" is a repair instruction.
  * Every issue carries a *proposed edit*. The polisher should not have to
    invent the fix, only apply and verify it.
  * Feedback is capped (default 3). Forty-five flagged lines is not a signal,
    it is a shrug, and an edit agent handed forty-five items will make forty-five
    shallow changes and fix nothing.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

SEVERITY_ORDER = {"blocking": 0, "major": 1, "minor": 2}
SEVERITY_WEIGHT = {"blocking": 0.30, "major": 0.12, "minor": 0.04}


@dataclass
class Issue:
    kind: str
    tier: int
    severity: str  # blocking | major | minor
    evidence: str  # one sentence, contains the number
    fix: str  # a concrete edit the polisher can apply
    nodes: List[str] = field(default_factory=list)
    edges: List[str] = field(default_factory=list)
    measurement: Dict[str, float] = field(default_factory=dict)
    rank_value: float = 0.0  # bigger == worse, used for ordering within severity
    also: int = 0  # how many further issues of this same kind exist

    @property
    def id(self) -> str:
        key = ",".join(self.nodes + self.edges) or "-"
        return f"{self.kind}:{key}"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d.pop("rank_value", None)
        d["id"] = self.id
        d["measurement"] = {k: round(v, 3) for k, v in self.measurement.items()}
        return d


def rank_issues(issues: List[Issue]) -> List[Issue]:
    return sorted(
        issues,
        key=lambda i: (SEVERITY_ORDER.get(i.severity, 3), i.tier, -i.rank_value),
    )


@dataclass
class GateReport:
    passed: bool = False
    geometry_score: float = 0.0
    gates: Dict[str, bool] = field(default_factory=dict)
    metrics: Dict[str, float] = field(default_factory=dict)
    issues: List[Issue] = field(default_factory=list)
    scene: Dict[str, Any] = field(default_factory=dict)
    max_feedback: int = 3

    # -- derived -----------------------------------------------------------
    @property
    def blocking(self) -> List[Issue]:
        return [i for i in self.issues if i.severity == "blocking"]

    def top(self, k: Optional[int] = None) -> List[Issue]:
        """Highest-ranked issue of each DISTINCT kind.

        Without the diversity constraint one noisy check floods the whole
        budget -- thirteen text collisions crowd out the fact that a node is
        invisible. The polisher gets one representative repair per class.
        """
        k = k or self.max_feedback
        counts = Counter(i.kind for i in self.issues)
        out: List[Issue] = []
        seen: set = set()
        for i in rank_issues(self.issues):
            if i.kind in seen:
                continue
            seen.add(i.kind)
            i.also = counts[i.kind] - 1
            out.append(i)
            if len(out) >= k:
                break
        return out

    def finalize(self) -> "GateReport":
        self.issues = rank_issues(self.issues)
        self.passed = all(self.gates.values()) and not self.blocking
        penalty = sum(SEVERITY_WEIGHT.get(i.severity, 0.05) for i in self.issues)
        self.geometry_score = round(max(0.0, 1.0 - penalty), 3)
        return self

    # -- serialisation -----------------------------------------------------
    def to_dict(self, full: bool = True) -> Dict[str, Any]:
        items = self.issues if full else self.top()
        return {
            "passed": self.passed,
            "geometry_score": self.geometry_score,
            "gates": self.gates,
            "metrics": {k: round(v, 4) for k, v in self.metrics.items()},
            "issue_count": len(self.issues),
            "issues": [i.to_dict() for i in items],
            "scene": self.scene,
        }

    def to_json(self, full: bool = True, indent: int = 2) -> str:
        return json.dumps(self.to_dict(full=full), indent=indent)

    def to_feedback(self) -> Dict[str, Any]:
        """Compact payload for the polisher agent: verdict + <=N repairs."""
        return {
            "verdict": "PASS" if self.passed else "FAIL",
            "geometry_score": self.geometry_score,
            "failed_gates": [k for k, v in self.gates.items() if not v],
            "repairs": [
                {
                    "target": i.nodes + i.edges,
                    "problem": i.evidence,
                    "apply": i.fix,
                    "same_kind_elsewhere": i.also,
                }
                for i in self.top()
            ],
        }

    def to_text(self) -> str:
        lines = [
            f"verdict: {'PASS' if self.passed else 'FAIL'}   "
            f"geometry_score: {self.geometry_score}",
            "",
            "gates:",
        ]
        for k, v in self.gates.items():
            lines.append(f"  [{'ok' if v else 'FAIL'}] {k}")
        lines.append("")
        lines.append(f"metrics:")
        for k, v in self.metrics.items():
            lines.append(f"  {k:<28} {v:.3f}")
        lines.append("")
        lines.append(f"issues ({len(self.issues)} total, showing top {self.max_feedback}):")
        for n, i in enumerate(self.top(), 1):
            extra = f"  (+{i.also} more of this kind)" if i.also else ""
            lines.append(f"  {n}. [{i.severity}] {i.kind}{extra}")
            lines.append(f"     {i.evidence}")
            lines.append(f"     fix: {i.fix}")
        return "\n".join(lines)
