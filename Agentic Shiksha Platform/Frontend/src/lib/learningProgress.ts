export type TopicProgressStatus = "not_started" | "in_progress" | "learned";

export type CoveredTopic = {
  name: string;
  status: "in_progress" | "learned";
};

export type TopicProgressSummary = {
  total: number;
  learned: number;
  inProgress: number;
  notStarted: number;
  percent: number;
  coveredTopics: CoveredTopic[];
};

export function normaliseTopicStatus(status?: string): TopicProgressStatus {
  return status === "learned" || status === "in_progress" ? status : "not_started";
}

export function summarizeTopicProgress(
  topics: Readonly<Record<string, { status?: TopicProgressStatus }>> | null | undefined,
): TopicProgressSummary | null {
  if (topics == null) return null;
  const entries = Object.entries(topics);
  const coveredTopics: CoveredTopic[] = [];
  let learned = 0;
  let inProgress = 0;
  for (const [name, entry] of entries) {
    const status = normaliseTopicStatus(entry.status);
    if (status === "learned") learned += 1;
    if (status === "in_progress") inProgress += 1;
    if (status !== "not_started") coveredTopics.push({ name, status });
  }
  coveredTopics.sort((a, b) => a.status === b.status
    ? a.name.localeCompare(b.name)
    : a.status === "learned" ? -1 : 1);
  return {
    total: entries.length, learned, inProgress,
    notStarted: entries.length - learned - inProgress,
    percent: entries.length ? Math.round(learned / entries.length * 100) : 0,
    coveredTopics,
  };
}
