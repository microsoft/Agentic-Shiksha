import type { QuizQuestion } from "@/features/chat/QuizBlock";
import type { SlideDeck } from "@/lib/slides";
import type { Asset, AssetCategory } from "@/lib/types";

export type InventoryAnswer = {
  question?: string;
  options?: string[];
  selected?: number[];
  correct?: number[];
  selectedOptions?: string[];
  correctOptions?: string[];
  reason?: string;
  isCorrect?: boolean;
  explanation?: string;
};

export type AssetPayload = {
  type?: string;
  circuitId?: string;
  slidesId?: string;
  deck?: SlideDeck;
  agentId?: string;
  recordType?: string;
  assessmentType?: "concept_inventory" | "practice_quiz";
  title?: string;
  submittedAt?: string;
  score?: number;
  totalQuestions?: number;
  answers?: InventoryAnswer[];
  quizId?: string;
  assessmentInstanceId?: string;
  curriculumVersion?: string;
  serverGraded?: boolean;
  thresholdConcept?: string;
  challengeId?: string;
  questions?: QuizQuestion[];
  description?: string;
  difficulty?: string;
  hints?: string[];
  solution?: string;
  challengeType?: string;
  firstAttempt?: AssetPayload;
  quiz?: AssetPayload;
};

export function parseAssetPayload(content: string): AssetPayload | null {
  const trimmed = (content || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === "object" ? (value as AssetPayload) : null;
  } catch {
    return null;
  }
}

export function isConceptInventoryContent(content: string): boolean {
  const parsed = parseAssetPayload(content);
  if (!parsed) return false;
  return Boolean(
    parsed.recordType === "concept_inventory_first_attempt"
      || parsed.assessmentType === "concept_inventory"
      || parsed.quiz?.assessmentType === "concept_inventory"
      || parsed.firstAttempt?.recordType === "concept_inventory_first_attempt"
      || parsed.firstAttempt?.assessmentType === "concept_inventory",
  );
}

export function getAssetCategory(asset: Pick<Asset, "type" | "content" | "category">): AssetCategory {
  const payloadType = asset.type === "json" ? parseAssetPayload(asset.content)?.type : undefined;
  if (payloadType === "slides") return "presentation";
  if (payloadType === "circuit" || payloadType === "simulation") return "simulation";
  return asset.category;
}