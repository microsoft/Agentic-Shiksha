"""Pure validation and draft-only migration of shared pedagogical graphs."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping

from backend.schemas.learner_memory import (
    CurriculumEdge,
    CurriculumGraph,
    CurriculumNode,
    CurriculumProvenance,
    EdgeRelation,
    EvidencePolarity,
    NodeType,
    PolicySet,
    ProblemOption,
    TaskType,
    opaque_key,
)


class GraphValidationError(ValueError):
    pass


_ENDPOINT_TYPES = {
    EdgeRelation.HAS_THRESHOLD: (NodeType.COURSE, NodeType.TC),
    EdgeRelation.PREREQUISITE_OF: (NodeType.TC, NodeType.TC),
    EdgeRelation.ASSOCIATED_WITH: (NodeType.MISCONCEPTION, NodeType.TC),
    EdgeRelation.ASSESSED_BY: (NodeType.TC, NodeType.CONCEPT_INVENTORY),
    EdgeRelation.CONTAINS: (NodeType.CONCEPT_INVENTORY, NodeType.PROBLEM),
    EdgeRelation.HAS_PROBLEM: (NodeType.TC, NodeType.PROBLEM),
    EdgeRelation.TESTS: (NodeType.PROBLEM, NodeType.TC),
    EdgeRelation.DIAGNOSES: (NodeType.PROBLEM, NodeType.MISCONCEPTION),
    EdgeRelation.HAS_TRANSFER_PROBE: (NodeType.TC, NodeType.PROBLEM),
}


def _validate_dag(graph: CurriculumGraph) -> None:
    adjacency: dict[str, list[str]] = {
        node.id: [] for node in graph.nodes if node.type == NodeType.TC
    }
    for edge in graph.edges:
        if edge.relation == EdgeRelation.PREREQUISITE_OF:
            adjacency[edge.source_id].append(edge.target_id)
    complete: set[str] = set()
    for root in sorted(adjacency):
        if root in complete:
            continue
        path = [root]
        positions = {root: 0}
        stack = [(root, iter(sorted(adjacency[root])))]
        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                complete.add(node)
                del positions[node]
                path.pop()
                stack.pop()
            elif child in positions:
                cycle = path[positions[child]:] + [child]
                raise GraphValidationError(f"Prerequisite cycle: {' -> '.join(cycle)}")
            elif child not in complete:
                positions[child] = len(path)
                path.append(child)
                stack.append((child, iter(sorted(adjacency[child]))))


def _validate_problem_binding(edge: CurriculumEdge, problem: CurriculumNode) -> None:
    for field in ("problem_version", "rubric_version", "assessment_version"):
        if getattr(edge, field) != getattr(problem, field) or getattr(edge, field) is None:
            raise GraphValidationError(f"Edge {edge.id} has an invalid {field} for {problem.id}")


def validate_graph(graph: CurriculumGraph) -> CurriculumGraph:
    """Validate the entire version, including publication gates, without mutating it."""
    graph = CurriculumGraph.model_validate(graph.model_dump(mode="python"))
    policies = PolicySet.model_validate(graph.policies.model_dump(mode="python"))
    nodes: dict[str, CurriculumNode] = {}
    for node in graph.nodes:
        if not node.id.strip() or not node.name.strip():
            raise GraphValidationError("Node IDs and names must not be blank")
        if node.id in nodes:
            raise GraphValidationError(f"Duplicate node ID: {node.id}")
        nodes[node.id] = node
    edge_ids: set[str] = set()
    logical_edges: set[tuple[str, str, EdgeRelation, str | None]] = set()
    for edge in graph.edges:
        logical = (edge.source_id, edge.target_id, edge.relation, edge.transfer_condition_id)
        if edge.id in edge_ids or logical in logical_edges:
            raise GraphValidationError(f"Duplicate edge: {edge.source_id} {edge.relation} {edge.target_id}")
        edge_ids.add(edge.id)
        logical_edges.add(logical)
        if edge.source_id not in nodes or edge.target_id not in nodes:
            raise GraphValidationError(f"Dangling endpoint on edge {edge.id}")
        source, target = nodes[edge.source_id], nodes[edge.target_id]
        if (source.type, target.type) != _ENDPOINT_TYPES[edge.relation]:
            raise GraphValidationError(
                f"Invalid endpoints for {edge.relation}: {source.id}({source.type}) -> "
                f"{target.id}({target.type})"
            )
        if edge.required_for_crossing is not None and edge.relation not in (
            EdgeRelation.ASSOCIATED_WITH, EdgeRelation.HAS_TRANSFER_PROBE,
        ):
            raise GraphValidationError("Only misconception and transfer mappings have crossing requirements")
        if edge.transfer_condition_id is not None and edge.relation != EdgeRelation.HAS_TRANSFER_PROBE:
            raise GraphValidationError("Transfer condition IDs belong only to transfer edges")
        if edge.reviewed and edge.relation == EdgeRelation.DIAGNOSES:
            _validate_problem_binding(edge, source)
            if edge.diagnostic_strength is None:
                raise GraphValidationError(f"Reviewed diagnostic {edge.id} needs catalog strength")
            if edge.evidence_if_correct == edge.evidence_if_incorrect == EvidencePolarity.NO_INFERENCE:
                raise GraphValidationError(f"Reviewed diagnostic {edge.id} needs explicit outcome semantics")
        if edge.reviewed and edge.relation == EdgeRelation.HAS_TRANSFER_PROBE:
            _validate_problem_binding(edge, target)
    _validate_dag(graph)
    if not graph.published_ready:
        return graph
    active_tcs = [node for node in graph.nodes if node.type == NodeType.TC and node.active]
    if not active_tcs:
        raise GraphValidationError("Published graph must contain an active TC")
    for tc in active_tcs:
        if tc.crossing_policy_version != policies.threshold_policy_version:
            raise GraphValidationError(f"TC {tc.id} must pin the reviewed crossing policy version")
        associations = [
            edge for edge in graph.edges
            if edge.relation == EdgeRelation.ASSOCIATED_WITH and edge.target_id == tc.id
        ]
        if any(
            not edge.reviewed or edge.required_for_crossing is None
            or edge.threshold_relevance is None for edge in associations
        ):
            raise GraphValidationError(f"TC {tc.id} has unreviewed or incomplete misconception mappings")
        required = [edge for edge in associations if edge.required_for_crossing is True]
        if not required:
            raise GraphValidationError(f"TC {tc.id} needs a nonempty reviewed required misconception set")
        for association in required:
            misconception = nodes[association.source_id]
            if not misconception.active:
                raise GraphValidationError(f"Required misconception {misconception.id} is retired")
            families = {
                nodes[edge.source_id].family_id
                for edge in graph.edges
                if edge.relation == EdgeRelation.DIAGNOSES
                and edge.target_id == misconception.id and edge.reviewed
                and nodes[edge.source_id].active and nodes[edge.source_id].diagnostic_approved
                and (edge.diagnostic_strength or 0) >= policies.min_catalog_diagnostic_strength
                and (nodes[edge.source_id].catalog_diagnostic_reliability or 0)
                >= policies.min_catalog_diagnostic_strength
                and edge.evidence_if_correct == EvidencePolarity.CONTRADICTS
            }
            needed_families = policies.min_clearance_families
            if policies.require_distinct_families:
                needed_families = max(
                    needed_families, policies.min_clearance_independent_probes,
                    policies.min_clearance_contexts,
                )
            if len(families) < needed_families:
                raise GraphValidationError(
                    f"Required misconception {misconception.id} lacks independent reviewed clearing families"
                )
        transfers = [
            edge for edge in graph.edges
            if edge.relation == EdgeRelation.HAS_TRANSFER_PROBE and edge.source_id == tc.id
        ]
        if any(edge.required_for_crossing is None or not edge.reviewed for edge in transfers):
            raise GraphValidationError(f"TC {tc.id} has unreviewed transfer requirements")
        required_transfers = [edge for edge in transfers if edge.required_for_crossing is True]
        if policies.require_transfer_for_crossing and not required_transfers:
            raise GraphValidationError(f"TC {tc.id} needs a reviewed required transfer condition")
        condition_ids: set[str] = set()
        for edge in required_transfers:
            problem = nodes[edge.target_id]
            if not problem.active or not problem.transfer_approved:
                raise GraphValidationError(f"Transfer problem {problem.id} is retired or unapproved")
            condition_id = edge.transfer_condition_id or problem.id
            if condition_id in condition_ids:
                raise GraphValidationError(f"Duplicate transfer condition {condition_id} for {tc.id}")
            condition_ids.add(condition_id)
    return graph


def prerequisite_ids(graph: CurriculumGraph, tc_id: str) -> list[str]:
    """Return transitive prerequisite IDs; numbering and module order are irrelevant."""
    parents: dict[str, set[str]] = {}
    for edge in graph.edges:
        if edge.relation == EdgeRelation.PREREQUISITE_OF:
            parents.setdefault(edge.target_id, set()).add(edge.source_id)
    found: set[str] = set()
    pending = list(parents.get(tc_id, ()))
    while pending:
        current = pending.pop()
        if current not in found and current != tc_id:
            found.add(current)
            pending.extend(parents.get(current, ()))
    return sorted(found)


def _text(value: object, *keys: str) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, Mapping):
        for key in keys:
            text = value.get(key)
            if isinstance(text, str) and text.strip():
                return text.strip()
    return ""


def import_legacy_curriculum(
    payload: Mapping[str, object],
    tenant_id: str,
    institute_id: str,
    course_id: str,
    curriculum_id: str | None = None,
    version: str = "legacy-draft-v1",
    *,
    course_name: str | None = None,
    reviewed_aliases: Mapping[str, str] | None = None,
) -> CurriculumGraph:
    """Import examples and exact labels, never legacy progress or inferred prerequisites.

    Generated questions, answer keys, mappings, and families remain unreviewed. Only
    explicit caller-provided aliases preserve a previously reviewed entity identity.
    """
    if not isinstance(payload, Mapping):
        raise GraphValidationError("Legacy curriculum must be an object")
    curriculum_id = curriculum_id or opaque_key("curriculum", tenant_id, course_id)
    aliases = dict(reviewed_aliases or {})
    content_hash = hashlib.sha256(
        json.dumps(dict(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    provenance = CurriculumProvenance(
        source="LEGACY_IMPORT", source_content_hash=content_hash,
        review_note="Draft import; diagnostic reliability and crossing mappings need teacher review.",
    )
    course_node_id = opaque_key("course", tenant_id, curriculum_id)
    name = course_name or _text(payload.get("course_name")) or course_id
    nodes = [CurriculumNode(type=NodeType.COURSE, id=course_node_id, name=name, provenance=provenance)]
    edges: list[CurriculumEdge] = []
    known: dict[str, CurriculumNode] = {course_node_id: nodes[0]}

    def add_node(node: CurriculumNode) -> None:
        existing = known.get(node.id)
        if existing is not None:
            if existing != node or node.id not in aliases.values():
                raise GraphValidationError(f"Duplicate legacy entity ID: {node.id}")
            return
        known[node.id] = node
        nodes.append(node)

    concepts = payload.get("all_threshold_concepts", [])
    if not isinstance(concepts, list):
        raise GraphValidationError("all_threshold_concepts must be an array")
    for entry in concepts:
        tc_name = _text(entry, "name", "title", "threshold_concept")
        if not tc_name:
            raise GraphValidationError("Legacy threshold concepts need an exact nonempty name")
        detail = payload.get(tc_name, entry if isinstance(entry, Mapping) else {})
        if not isinstance(detail, Mapping):
            raise GraphValidationError(f"Legacy detail for {tc_name} must be an object")
        tc_id = aliases.get(tc_name) or _text(entry, "id", "tc_id")
        if isinstance(entry, str):
            tc_id = aliases.get(tc_name)
        tc_id = tc_id or opaque_key("tc", tenant_id, curriculum_id, tc_name)
        tc_provenance = provenance.model_copy(update={
            "reviewed_aliases": (tc_name,) if tc_name in aliases else (),
        })
        add_node(CurriculumNode(
            type=NodeType.TC, id=tc_id, name=tc_name,
            description=_text(detail.get("description")) or _text(detail.get("definition")),
            provenance=tc_provenance,
        ))
        edges.append(CurriculumEdge(
            source_id=course_node_id, target_id=tc_id, relation=EdgeRelation.HAS_THRESHOLD,
            provenance=provenance,
        ))
        misconception_ids: dict[str, str] = {}
        misconceptions = detail.get("misconceptions", [])
        if not isinstance(misconceptions, list):
            raise GraphValidationError(f"Misconceptions for {tc_name} must be an array")
        for item in misconceptions:
            label = _text(item, "misconception", "name", "description")
            if not label:
                raise GraphValidationError(f"Empty misconception for {tc_name}")
            misconception_id = aliases.get(label) or opaque_key("m", curriculum_id, tc_id, label)
            misconception_ids[label] = misconception_id
            add_node(CurriculumNode(
                type=NodeType.MISCONCEPTION, id=misconception_id, name=label[:256],
                description=_text(item, "why_wrong", "description") or label,
                provenance=provenance.model_copy(update={
                    "reviewed_aliases": (label,) if label in aliases else (),
                }),
            ))
            edges.append(CurriculumEdge(
                source_id=misconception_id, target_id=tc_id,
                relation=EdgeRelation.ASSOCIATED_WITH, provenance=provenance,
            ))
        questions = detail.get("concept_inventory_questions", [])
        if not isinstance(questions, list):
            raise GraphValidationError(f"Inventory questions for {tc_name} must be an array")
        if not questions:
            continue
        inventory_id = opaque_key("inventory", curriculum_id, tc_id)
        add_node(CurriculumNode(
            type=NodeType.CONCEPT_INVENTORY, id=inventory_id, name=f"{tc_name[:230]} inventory",
            inventory_version=version, assessment_intent="Unreviewed generated examples",
            provenance=provenance,
        ))
        edges.append(CurriculumEdge(
            source_id=tc_id, target_id=inventory_id, relation=EdgeRelation.ASSESSED_BY,
            provenance=provenance,
        ))
        for index, question in enumerate(questions):
            if not isinstance(question, Mapping) or not _text(question.get("question")):
                raise GraphValidationError(f"Invalid inventory question for {tc_name}")
            prompt = _text(question.get("question"))
            problem_id = opaque_key("problem", curriculum_id, tc_id, prompt)
            raw_options = question.get("options", [])
            if not isinstance(raw_options, list) or any(not isinstance(x, str) for x in raw_options):
                raise GraphValidationError("Legacy example options must be a list of strings")
            options = tuple(
                ProblemOption(key=str(position), text=text) for position, text in enumerate(raw_options)
            )
            correct = question.get("correct")
            correct_key = None
            if isinstance(correct, int) and not isinstance(correct, bool):
                if correct < 0 or correct >= len(options):
                    raise GraphValidationError(f"Legacy answer index is out of range for {problem_id}")
                correct_key = str(correct)
            add_node(CurriculumNode(
                type=NodeType.PROBLEM, id=problem_id, name=f"{tc_name[:225]} example {index + 1}",
                prompt=prompt, options=options, correct_key=correct_key,
                problem_version=version, family_id=opaque_key("family", tc_id, prompt),
                task_type=TaskType.MULTIPLE_CHOICE, provenance=provenance,
            ))
            edges.extend((
                CurriculumEdge(source_id=inventory_id, target_id=problem_id, relation=EdgeRelation.CONTAINS,
                               order=index, provenance=provenance),
                CurriculumEdge(source_id=tc_id, target_id=problem_id, relation=EdgeRelation.HAS_PROBLEM,
                               provenance=provenance),
                CurriculumEdge(source_id=problem_id, target_id=tc_id, relation=EdgeRelation.TESTS,
                               provenance=provenance),
            ))
            target = misconception_ids.get(_text(question.get("targets_misconception")))
            if target is not None:
                edges.append(CurriculumEdge(
                    source_id=problem_id, target_id=target, relation=EdgeRelation.DIAGNOSES,
                    provenance=provenance,
                ))
    return validate_graph(CurriculumGraph(
        tenant_id=tenant_id, curriculum_id=curriculum_id, version=version,
        institute_ids=(institute_id,), course_ids=(course_id,), course_name=name,
        nodes=tuple(nodes), edges=tuple(edges), provenance=provenance,
    ))
