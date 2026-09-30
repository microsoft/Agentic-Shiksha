import type { CurriculumGraph, CurriculumPolicy, GraphNodeType, GraphRelation } from "@/lib/learnerMemoryApi";

export const NODE_TYPES: GraphNodeType[] = ["COURSE", "TC", "MISCONCEPTION", "CONCEPT_INVENTORY", "PROBLEM", "CURRICULUM_VERSION"];
export const RELATIONS: Record<GraphRelation, [GraphNodeType, GraphNodeType]> = {
  HAS_THRESHOLD: ["COURSE", "TC"], PREREQUISITE_OF: ["TC", "TC"],
  ASSOCIATED_WITH: ["MISCONCEPTION", "TC"], ASSESSED_BY: ["TC", "CONCEPT_INVENTORY"],
  CONTAINS: ["CONCEPT_INVENTORY", "PROBLEM"], HAS_PROBLEM: ["TC", "PROBLEM"],
  TESTS: ["PROBLEM", "TC"], DIAGNOSES: ["PROBLEM", "MISCONCEPTION"],
  HAS_TRANSFER_PROBE: ["TC", "PROBLEM"],
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256;

export function validatePolicy(policy: CurriculumPolicy): string[] {
  const errors: string[] = [];
  if (!identifier(policy.version)) errors.push("Policy version is required.");
  for (const [name, value] of Object.entries(policy)) {
    if ((name.startsWith("require_") || name === "teacher_reviewed") && typeof value !== "boolean") errors.push(`${name} must be a boolean.`);
    if (name.startsWith("min_") && typeof value !== "number") errors.push(`${name} must be a number.`);
    if (/confidence|strength|quality|rubric_score|coverage/.test(name) && typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > 1)) errors.push(`${name} must be between 0 and 1.`);
    if (/independent|_contexts$|_families$/.test(name) && typeof value === "number" && (!Number.isInteger(value) || value < 1 || value > 20)) errors.push(`${name} must be an integer from 1 to 20.`);
    if (name.endsWith("_days") && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 3650)) errors.push(`${name} must be an integer from 1 to 3650.`);
  }
  for (const name of ["min_clearance_independent_probes", "min_clearance_contexts", "min_clearance_families", "min_mastery_independent_demonstrations", "min_struggle_independent_failures"]) {
    if (policy[name] !== undefined && (typeof policy[name] !== "number" || policy[name] < 2)) errors.push(`${name} requires at least two independent demonstrations.`);
  }
  if (policy.required_misconception_coverage !== undefined && policy.required_misconception_coverage !== 1) errors.push("Required misconception coverage must remain 1 (all required mappings).");
  if (policy.require_reasoning_for_clearance !== undefined && policy.require_reasoning_for_clearance !== true) errors.push("Clearance must require reasoning.");
  if (policy.confidence_calibrated !== undefined && policy.confidence_calibrated !== false) errors.push("Confidence is uncalibrated; it must not be presented as a probability.");
  if (Array.isArray(policy.qualifying_assistance) && policy.qualifying_assistance.some(value => value === "UNKNOWN" || value === "ANSWER_REVEALED")) errors.push("Unknown assistance or revealed answers cannot qualify.");
  for (const name of ["qualifying_sources", "qualifying_answer_key_sources", "qualifying_assistance"]) {
    const values = policy[name];
    if (values !== undefined && (!Array.isArray(values) || values.length === 0 || !values.every(value => typeof value === "string"))) errors.push(`${name} must be a nonempty array of source identifiers.`);
  }
  if (Array.isArray(policy.qualifying_answer_key_sources) && policy.qualifying_answer_key_sources.includes("NONE")) errors.push("An unknown answer-key source cannot qualify.");
  if (policy.teacher_reviewed && (!identifier(policy.reviewed_by) || typeof policy.reviewed_at !== "string" || !Number.isFinite(Date.parse(policy.reviewed_at)))) errors.push("Reviewed policy requires a reviewer and a valid review timestamp.");
  if (typeof policy.recent_support_window_days === "number" && typeof policy.evidence_max_age_days === "number" && policy.recent_support_window_days > policy.evidence_max_age_days) errors.push("The recent support window must fit inside the evidence age window.");
  if (typeof policy.min_clearance_confidence === "number" && typeof policy.min_strong_observation_confidence === "number"
    && policy.min_clearance_confidence < policy.min_strong_observation_confidence) errors.push("Clearance confidence cannot be weaker than support confidence.");
  return errors;
}

export function parsePolicy(text: string): CurriculumPolicy {
  const value: unknown = JSON.parse(text);
  if (!record(value) || !identifier(value.version)) throw new Error("Policy JSON must be an object with a stable version.");
  const policy = value as CurriculumPolicy;
  const errors = validatePolicy(policy);
  if (errors.length) throw new Error(errors.join(" "));
  return policy;
}

export function parseGraph(text: string): CurriculumGraph {
  const value: unknown = JSON.parse(text);
  if (!record(value) || !identifier(value.tenant_id) || !identifier(value.curriculum_id) || !identifier(value.version)
    || !identifier(value.course_name) || !Array.isArray(value.institute_ids) || !value.institute_ids.every(identifier)
    || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !record(value.policies)
    || !value.nodes.every(node => record(node) && identifier(node.id) && identifier(node.name) && NODE_TYPES.includes(node.type as GraphNodeType))
    || !value.edges.every(edge => record(edge) && identifier(edge.source_id) && identifier(edge.target_id)
      && typeof edge.relation === "string" && Object.hasOwn(RELATIONS, edge.relation)
      && (edge.required_for_crossing === undefined || edge.required_for_crossing === null || typeof edge.required_for_crossing === "boolean"))) {
    throw new Error("Graph JSON requires scope, curriculum/version, course name, typed nodes, edges and policies.");
  }
  const graph = value as CurriculumGraph;
  graph.policies = parsePolicy(JSON.stringify(value.policies));
  return graph;
}

export function validateGraph(graph: CurriculumGraph, publishing = false): string[] {
  const errors = validatePolicy(graph.policies);
  if (![graph.tenant_id, graph.curriculum_id, graph.version, graph.course_name].every(identifier) || !graph.institute_ids.length || !graph.institute_ids.every(identifier)) errors.push("Course, curriculum/version and approved tenant/institute scope are required.");
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  if (nodes.size !== graph.nodes.length) errors.push("Node IDs must be unique.");
  if (graph.nodes.length > 5000 || graph.edges.length > 30000) errors.push("This graph exceeds the supported publication limits.");
  for (const node of graph.nodes) {
    if (!identifier(node.id) || !identifier(node.name)) errors.push("Every node needs a stable ID and a name.");
    if (!NODE_TYPES.includes(node.type)) errors.push(`Unknown node type for ${node.id}.`);
    if (node.curriculum_version && node.curriculum_version !== graph.version) errors.push(`${node.id} is bound to another graph version.`);
    if ((node.diagnostic_approved || node.transfer_approved) && (!node.problem_version || !node.family_id || !node.rubric_id || !node.rubric_version || !node.assessment_version || !(node.prompt || node.content_ref) || !node.rubric_dimensions?.length)) errors.push(`Approved problem ${node.id} requires frozen task, family, assessment and rubric definitions.`);
  }
  const prerequisites = new Map<string, string[]>();
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    const expected = RELATIONS[edge.relation];
    if (!expected || nodes.get(edge.source_id)?.type !== expected[0] || nodes.get(edge.target_id)?.type !== expected[1]) errors.push(`Invalid ${edge.relation} endpoints: ${edge.source_id} → ${edge.target_id}.`);
    const id = edge.id || `${edge.source_id}:${edge.relation}:${edge.target_id}:${edge.transfer_condition_id || ""}`;
    if (edgeIds.has(id)) errors.push(`Duplicate edge: ${id}.`);
    edgeIds.add(id);
    if (edge.required_for_crossing !== undefined && edge.required_for_crossing !== null
      && !["ASSOCIATED_WITH", "HAS_TRANSFER_PROBE"].includes(edge.relation)) {
      errors.push(`Only misconception and transfer mappings may set required_for_crossing: ${id}.`);
    }
    if (edge.transfer_condition_id != null && edge.relation !== "HAS_TRANSFER_PROBE") errors.push(`Only a transfer mapping may set transfer_condition_id: ${id}.`);
    if (edge.relation === "PREREQUISITE_OF") prerequisites.set(edge.source_id, [...(prerequisites.get(edge.source_id) || []), edge.target_id]);
    if ((edge.relation === "ASSOCIATED_WITH" || edge.relation === "HAS_TRANSFER_PROBE") && typeof edge.required_for_crossing !== "boolean") errors.push(`Set required_for_crossing explicitly for ${edge.source_id} → ${edge.target_id}.`);
    if (edge.diagnostic_strength != null && (!Number.isFinite(edge.diagnostic_strength) || edge.diagnostic_strength < 0 || edge.diagnostic_strength > 1)) errors.push(`Diagnostic strength for ${id} must be between 0 and 1.`);
    if (publishing && edge.relation === "HAS_TRANSFER_PROBE" && edge.required_for_crossing
      && (!nodes.get(edge.target_id)?.transfer_approved || !edge.assessment_version)) errors.push(`Required transfer ${edge.target_id} needs review and an assessment version.`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) { errors.push(`Prerequisite cycle: ${[...path, id].join(" → ")}.`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of prerequisites.get(id) || []) visit(target, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of prerequisites.keys()) visit(id, []);
  if (publishing) {
    if (!graph.policies.teacher_reviewed) errors.push("Review the policy before publishing.");
    for (const node of graph.nodes.filter(node => node.type === "TC" && node.active !== false)) {
      if (!graph.edges.some(edge => edge.relation === "ASSOCIATED_WITH" && edge.target_id === node.id && edge.required_for_crossing)) errors.push(`${node.id} has no required misconception mappings; it cannot cross vacuously.`);
    }
  }
  return [...new Set(errors)];
}
