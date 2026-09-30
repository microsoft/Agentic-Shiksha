import { randomUuid } from "../../lib/secureId";

export type CompanionAttachment = { name: string; size: number; kind: "document" | "image" | "material" };
export type CompanionMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  changes?: string[];
  skipped?: string[];
  attachments?: CompanionAttachment[];
  imageUrls?: string[];
};
export type CompanionConversation = {
  id: string;
  draftId: string;
  title: string;
  updatedAt: number;
  messages: CompanionMessage[];
};

const HISTORY_LIMIT = 1024 * 1024;

export function companionHistoryKey(userId: string) {
  return `ekalaiva.course-companion.history.v1:${encodeURIComponent(userId)}`;
}

export function newCompanionConversation(draftId: string): CompanionConversation {
  return { id: randomUuid(), draftId, title: "New conversation", updatedAt: Date.now(), messages: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readCompanionHistory(storage: Pick<Storage, "getItem">, userId: string): CompanionConversation[] {
  const raw = storage.getItem(companionHistoryKey(userId));
  if (!raw) return [];
  if (raw.length > HISTORY_LIMIT) throw new Error("Saved chat history is too large to open safely.");
  const payload: unknown = JSON.parse(raw);
  if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.conversations) || payload.conversations.length > 30) {
    throw new Error("Saved chat history could not be read.");
  }
  return payload.conversations.map((conversation: unknown) => {
    if (!isRecord(conversation) || typeof conversation.id !== "string" || typeof conversation.draftId !== "string"
      || typeof conversation.title !== "string" || typeof conversation.updatedAt !== "number"
      || !Array.isArray(conversation.messages) || conversation.messages.length > 100) {
      throw new Error("Saved chat history could not be read.");
    }
    const messages: CompanionMessage[] = conversation.messages.map((message: unknown) => {
      if (!isRecord(message) || !["user", "assistant"].includes(String(message.role))
        || typeof message.text !== "string" || message.text.length > 18000 || typeof message.createdAt !== "number") {
        throw new Error("Saved chat history could not be read.");
      }
      const result: CompanionMessage = { role: message.role as CompanionMessage["role"], text: message.text, createdAt: message.createdAt };
      for (const field of ["changes", "skipped"] as const) {
        if (Array.isArray(message[field])) result[field] = message[field].filter((value): value is string => typeof value === "string").slice(0, 10);
      }
      if (Array.isArray(message.attachments)) {
        result.attachments = message.attachments.filter(isRecord).filter(attachment =>
          typeof attachment.name === "string" && attachment.name.length <= 255 && typeof attachment.size === "number"
          && ["document", "image", "material"].includes(String(attachment.kind)),
        ).slice(0, 10).map(attachment => ({
          name: attachment.name as string, size: attachment.size as number, kind: attachment.kind as CompanionAttachment["kind"],
        }));
      }
      return result;
    });
    return { id: conversation.id, draftId: conversation.draftId, title: conversation.title.slice(0, 100), updatedAt: conversation.updatedAt, messages };
  });
}

export function writeCompanionHistory(storage: Pick<Storage, "setItem">, userId: string, conversations: CompanionConversation[]) {
  const populated = conversations.filter(conversation => conversation.messages.length > 0);
  if (populated.length > 30 || populated.some(conversation => conversation.messages.length > 100)) {
    throw new Error("Chat history is full. Delete an older conversation to save more.");
  }
  const content = JSON.stringify({ version: 1, conversations: populated.map(conversation => ({
    id: conversation.id, draftId: conversation.draftId, title: conversation.title, updatedAt: conversation.updatedAt,
    messages: conversation.messages.map(message => ({
      role: message.role, text: message.text, createdAt: message.createdAt,
      changes: message.changes, skipped: message.skipped,
      attachments: message.attachments?.map(attachment => ({ name: attachment.name, size: attachment.size, kind: attachment.kind })),
    })),
  })) });
  if (content.length > HISTORY_LIMIT) throw new Error("Chat history storage is full. Delete an older conversation to save more.");
  storage.setItem(companionHistoryKey(userId), content);
}