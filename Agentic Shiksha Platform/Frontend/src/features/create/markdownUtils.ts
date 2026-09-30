// features/create/markdownUtils.ts

import type React from "react";
import type { ChatMsg } from "@/features/chat/ChatPane";

export type GeneratedDoc = {
  id: string;
  title: string;
  content: string;
  hasExplicitTitle?: boolean; // true if FILE_TITLE comment was provided
  messageGroupId?: string; // Links doc to the message group for refresh functionality
  isStreaming?: boolean; // true when document is being "typed" progressively
};

type MarkdownFenceExtraction = {
  before: string;
  content: string;
  after: string;
} | null;

export type BuilderChatMsg = ChatMsg & {
  generatedDocId?: string;
  generatedDocTitle?: string;
};

/**
 * Extract ALL JSON document blocks from a reply.
 * Format: [DOCUMENT]{"title": "...", "content": "..."}[/DOCUMENT]
 * Returns array of parsed documents and the remaining text (before/between/after).
 */
export function extractJsonDocuments(raw: string): {
  documents: Array<{ title: string; content: string }>;
  textParts: string[];
} | null {
  // Try with closing tag first: [DOCUMENT] ... [/DOCUMENT]
  const regexWithClose = /\[DOCUMENT\]\s*([\s\S]*?)\s*\[\/DOCUMENT\]/gi;
  const documents: Array<{ title: string; content: string }> = [];
  const textParts: string[] = [];
  
  let lastIndex = 0;
  let match;
  
  while ((match = regexWithClose.exec(raw)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.title && parsed.content) {
        // Add text before this document
        const textBefore = raw.slice(lastIndex, match.index).trim();
        if (textBefore) textParts.push(textBefore);
        
        documents.push({
          title: cleanTitle(parsed.title),
          content: parsed.content,
        });
        
        lastIndex = match.index + match[0].length;
      }
    } catch {
      // Skip invalid JSON, continue searching
    }
  }
  
  // If no documents found with closing tag, try without closing tag (agent may have omitted it)
  if (documents.length === 0) {
    const regexNoClose = /\[DOCUMENT\]\s*(\{[\s\S]*)/i;
    const matchNoClose = regexNoClose.exec(raw);
    if (matchNoClose) {
      try {
        // Find the JSON object - look for matching braces
        const jsonStart = matchNoClose[1];
        let braceCount = 0;
        let jsonEnd = 0;
        let inString = false;
        let escape = false;
        
        for (let i = 0; i < jsonStart.length; i++) {
          const char = jsonStart[i];
          
          if (escape) {
            escape = false;
            continue;
          }
          
          if (char === '\\' && inString) {
            escape = true;
            continue;
          }
          
          if (char === '"' && !escape) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
        }
        
        if (jsonEnd > 0) {
          const jsonStr = jsonStart.slice(0, jsonEnd);
          const parsed = JSON.parse(jsonStr);
          if (parsed.title && parsed.content) {
            const textBefore = raw.slice(0, matchNoClose.index).trim();
            if (textBefore) textParts.push(textBefore);
            
            documents.push({
              title: cleanTitle(parsed.title),
              content: parsed.content,
            });
            
            // Text after the JSON (skip [/DOCUMENT] if present)
            const afterJson = jsonStart.slice(jsonEnd).replace(/^\s*\[\/DOCUMENT\]/i, '').trim();
            if (afterJson) textParts.push(afterJson);
          }
        }
      } catch {
        // JSON parsing failed
      }
    }
  } else {
    // Add any remaining text after the last document
    const textAfter = raw.slice(lastIndex).trim();
    if (textAfter) textParts.push(textAfter);
  }
  
  if (documents.length === 0) return null;
  
  return { documents, textParts };
}

/**
 * Extract single JSON document block (legacy, for backward compatibility).
 * Format: [DOCUMENT]{"title": "...", "content": "..."}[/DOCUMENT]
 */
export function extractJsonDocument(raw: string): {
  before: string;
  title: string;
  content: string;
  after: string;
} | null {
  const result = extractJsonDocuments(raw);
  if (!result || result.documents.length === 0) return null;
  
  const doc = result.documents[0];
  return {
    before: result.textParts[0] || '',
    title: doc.title,
    content: doc.content,
    after: result.textParts.slice(1).join('\n\n') || '',
  };
}

/**
 * Extract the FIRST ```markdown ... ``` fenced block from a reply, if any.
 * Returns text before, inner markdown content, and text after.
 * Also checks for FILE_TITLE comment outside of fences.
 */
export function extractMarkdownFence(raw: string): MarkdownFenceExtraction {
  const regex = /```(?:markdown)?\s*([\s\S]*?)```/i;
  const match = regex.exec(raw);
  if (!match) return null;
  let content = match[1] ?? "";
  const before = raw.slice(0, match.index);
  const after = raw.slice(match.index + match[0].length);
  
  // Check if FILE_TITLE is in the 'before' text (LLM sometimes puts it outside the fence)
  const fileTitleInBefore = before.match(/<!--\s*FILE_TITLE:\s*(.+?)\s*-->/i);
  if (fileTitleInBefore && !content.includes('<!-- FILE_TITLE:')) {
    // Prepend the FILE_TITLE to the content
    content = fileTitleInBefore[0] + '\n' + content;
  }
  
  return { before: before.replace(/<!--\s*FILE_TITLE:\s*.+?\s*-->/i, '').trim(), content, after };
}

/**
 * Clean a title string - only allow alphanumeric and basic special characters
 */
function cleanTitle(rawTitle: string): string {
  return rawTitle
    // Remove markdown bold/italic markers
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/__/g, '')
    // Remove heading markers
    .replace(/^#+\s*/, '')
    // Remove all emojis and special unicode (keep only basic ASCII + common punctuation)
    .replace(/[^\x20-\x7E]/g, '')
    // Only allow alphanumeric, spaces, and these special chars: - | _ . , ( ) : &
    .replace(/[^a-zA-Z0-9\s\-|_.,():&]/g, '')
    // Clean up extra spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * From inner markdown content, extract it as a GeneratedDoc.
 * Recognizes any markdown document that has either:
 * - A FILE_TITLE comment
 * - At least one heading (# or ##)
 */
export function extractGeneratedDocFromMarkdown(
  markdownContent: string
): GeneratedDoc | null {
  const text = markdownContent.trim();
  if (!text) return null;

  // Check if this looks like a document (has FILE_TITLE comment OR has a heading)
  const hasFileTitleComment = /<!--\s*FILE_TITLE:/i.test(text);
  const hasHeading = /^#+\s+.+/m.test(text);
  
  if (!hasFileTitleComment && !hasHeading) return null;

  // First, try to extract FILE_TITLE from comment: <!-- FILE_TITLE: ... -->
  const fileTitleMatch = text.match(/<!--\s*FILE_TITLE:\s*(.+?)\s*-->/i);
  let title: string;
  let contentWithoutFileTitle = text;
  let hasExplicitTitle = false;

  if (fileTitleMatch && fileTitleMatch[1]) {
    // Use the explicit file title from the comment, clean it
    title = cleanTitle(fileTitleMatch[1]);
    hasExplicitTitle = true;
    // Remove the FILE_TITLE comment from the content
    contentWithoutFileTitle = text.replace(/<!--\s*FILE_TITLE:\s*.+?\s*-->\s*/i, '').trim();
  } else {
    // Fallback: extract from first heading and clean it
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const firstHeadingLine = lines.find((l) => /^#+\s+/.test(l));
    const rawTitle = firstHeadingLine?.replace(/^#+\s+/, "").trim() || "Generated Document";
    title = cleanTitle(rawTitle);
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content: contentWithoutFileTitle,
    hasExplicitTitle,
  };
}

/**
 * Handle an assistant reply:
 * Handle an assistant reply:
 * - First try JSON document format: [DOCUMENT]{"title":"...","content":"..."}[/DOCUMENT]
 * - If it contains ```markdown ...``` with a doc → create a GeneratedDoc,
 *   show a short text message, and attach generatedDocId.
 * - If it contains ```markdown ...``` but NOT a doc → strip the fences and
 *   show the inner markdown rendered normally.
 * - If it has no fenced markdown → show as plain text.
 */
export function pushAssistantReplyWithOptionalDoc(
  rawReply: string,
  setMessages: React.Dispatch<React.SetStateAction<BuilderChatMsg[]>>,
  setDocs: React.Dispatch<React.SetStateAction<GeneratedDoc[]>>,
  options?: { replaceLastAssistant?: boolean }
) {
  const replaceLastAssistant = options?.replaceLastAssistant ?? false;

  const upsertAssistantMessage = (build: () => BuilderChatMsg) => {
    setMessages((prev) => {
      const newMsg = build();
      if (!replaceLastAssistant) return [...prev, newMsg];

      // replace last assistant message, or append if none
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          idx = i;
          break;
        }
      }
      if (idx === -1) return [...prev, newMsg];
      const next = [...prev];
      next[idx] = newMsg;
      return next;
    });
  };

  // Try JSON document format first: [DOCUMENT]{"title":"...","content":"..."}[/DOCUMENT]
  // Supports multiple documents in a single response
  const jsonDocs = extractJsonDocuments(rawReply);
  if (jsonDocs && jsonDocs.documents.length > 0) {
    const createdDocs: GeneratedDoc[] = jsonDocs.documents.map((d) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: d.title,
      content: d.content,
      hasExplicitTitle: true,
    }));
    
    setDocs((prev) => [...prev, ...createdDocs]);

    // Combine all text parts for the chat message
    const summary = jsonDocs.textParts.join("\n\n").trim() ||
      `Generated ${createdDocs.length} document${createdDocs.length > 1 ? 's' : ''}: ${createdDocs.map(d => d.title).join(', ')}`;

    // Attach the first document to the message (UI will show document card)
    upsertAssistantMessage(() => ({
      role: "assistant",
      content: summary,
      generatedDocId: createdDocs[0].id,
      generatedDocTitle: createdDocs[0].title,
    }));

    return;
  }

  // Fallback: try markdown fence format
  const fence = extractMarkdownFence(rawReply);

  if (fence) {
    const doc = extractGeneratedDocFromMarkdown(fence.content);

    if (doc) {
      setDocs((prev) => [...prev, doc]);

      const summaryParts: string[] = [];
      const before = fence.before.trim();
      const after = fence.after.trim();
      if (before) summaryParts.push(before);
      if (after) summaryParts.push(after);

      const summary =
        summaryParts.join("\n\n").trim() ||
        `Generated document: ${doc.title}`;

      upsertAssistantMessage(() => ({
        role: "assistant",
        content: summary,
        generatedDocId: doc.id,
        generatedDocTitle: doc.title,
      }));

      return;
    }

    // Not a Threshold Concepts .md → render inline, strip fences
    const cleaned = `${fence.before}${fence.content}${fence.after}`.trim();
    upsertAssistantMessage(() => ({
      role: "assistant",
      content: cleaned || rawReply,
    }));
    return;
  }

  // No fenced markdown at all
  upsertAssistantMessage(() => ({
    role: "assistant",
    content: rawReply,
  }));
}