export type AgentCapabilities = {
  documents: boolean;
  quizzes: boolean;
  flashcards: boolean;
  challenges: boolean;
  images: boolean;
};

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  documents: true,
  quizzes: true,
  flashcards: true,
  challenges: true,
  images: true,
};
