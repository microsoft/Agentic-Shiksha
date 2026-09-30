import type { QuizContent, QuizQuestion } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : record(value) ? Object.values(value) : [];
}

/** Both SSE arrays and A2UI indexed maps must preserve the public assessment identity. */
export function parseQuizContent(value: unknown, fallbackId = ""): QuizContent | null {
  if (!record(value)) return null;
  const assessmentInstanceId = typeof value.assessmentInstanceId === "string" && value.assessmentInstanceId
    ? value.assessmentInstanceId : undefined;
  const quizId = assessmentInstanceId
    || (typeof value.quizId === "string" ? value.quizId : fallbackId);
  const questions: QuizQuestion[] = [];
  for (const item of values(value.questions)) {
    if (!record(item) || typeof item.question !== "string") return null;
    const options = values(item.options);
    if (!options.length || !options.every((option): option is string => typeof option === "string")) return null;
    const correct = typeof item.correct === "number" ? item.correct
      : Array.isArray(item.correct) && item.correct.every((index): index is number => Number.isInteger(index))
        ? item.correct : undefined;
    questions.push({
      question: item.question,
      options,
      ...(Array.isArray(item.optionKeys) && item.optionKeys.every((key): key is string => typeof key === "string") && { optionKeys: item.optionKeys }),
      ...(typeof item.problemId === "string" && { problemId: item.problemId }),
      ...(typeof item.multiple === "boolean" && { multiple: item.multiple }),
      ...(!assessmentInstanceId && correct !== undefined && { correct }),
      ...(!assessmentInstanceId && typeof item.explanation === "string" && { explanation: item.explanation }),
      ...(!assessmentInstanceId && typeof item.targetsMisconception === "string" && { targetsMisconception: item.targetsMisconception }),
    });
  }
  if (!questions.length && assessmentInstanceId) return null;
  return {
    quizId,
    ...(assessmentInstanceId && { assessmentInstanceId, serverGraded: true }),
    ...(typeof value.curriculumVersion === "string" && { curriculumVersion: value.curriculumVersion }),
    title: typeof value.title === "string" ? value.title : "Quiz",
    ...((value.assessmentType === "concept_inventory" || value.assessmentType === "practice_quiz") && { assessmentType: value.assessmentType }),
    ...(typeof value.thresholdConcept === "string" && { thresholdConcept: value.thresholdConcept }),
    questions,
  };
}
