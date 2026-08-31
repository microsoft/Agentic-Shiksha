import type { QuizQuestion } from "@/features/chat/QuizBlock";

export type InventoryAnswer = {
  question?: string;
  selectedOptions?: string[];
  correctOptions?: string[];
  reason?: string;
  isCorrect?: boolean;
  explanation?: string;
};

export type AssetPayload = {
  recordType?: string;
  assessmentType?: "concept_inventory" | "practice_quiz";
  title?: string;
  submittedAt?: string;
  score?: number;
  totalQuestions?: number;
  answers?: InventoryAnswer[];
  quizId?: string;
  flashcardId?: string;
  challengeId?: string;
  questions?: QuizQuestion[];
  cards?: Array<{ front: string; back: string }>;
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