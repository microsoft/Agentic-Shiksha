export interface ParsedChatResponse {
  title: string | null;
  response: string;
}

export function chatFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("(401)") || lower.includes("sign in required")) {
    return "Your session has expired, so this message wasn't sent. Please sign in again to continue \u2014 your conversations are saved.";
  }
  if (lower.includes("no assistant found") || lower.includes("resource not found") || lower.includes("404")) {
    return "This agent no longer exists. Please refresh the page or switch modes to update.";
  }
  return `Error: ${message}`;
}

export function parseChatResponse(text: string): ParsedChatResponse {
  try {
    let jsonText = text.trim();
    const codeFenceMatch = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeFenceMatch) {
      jsonText = codeFenceMatch[1].trim();
    } else if (jsonText.toLowerCase().startsWith("json")) {
      jsonText = jsonText.replace(/^json\s*/i, "").trim();
    }

    if (jsonText.startsWith("{")) {
      let braceCount = 0;
      let jsonEndIndex = -1;
      let inString = false;
      let escapeNext = false;

      for (let index = 0; index < jsonText.length; index += 1) {
        const character = jsonText[index];
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (character === "\\" && inString) {
          escapeNext = true;
          continue;
        }
        if (character === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (character === "{") {
          braceCount += 1;
        } else if (character === "}") {
          braceCount -= 1;
          if (braceCount === 0) {
            jsonEndIndex = index;
            break;
          }
        }
      }

      if (jsonEndIndex > 0) {
        const jsonPart = jsonText.substring(0, jsonEndIndex + 1);
        const remainingText = jsonText.substring(jsonEndIndex + 1).trim();
        try {
          const parsed: unknown = JSON.parse(jsonPart);
          if (
            typeof parsed === "object"
            && parsed !== null
            && "response" in parsed
            && typeof parsed.response === "string"
          ) {
            const title = "title" in parsed && typeof parsed.title === "string"
              ? parsed.title
              : null;
            return {
              title,
              response: remainingText
                ? `${parsed.response}\n\n${remainingText}`
                : parsed.response,
            };
          }
        } catch {
          // Fall back to the exact model output below.
        }
      }
    }
  } catch {
    // Fall back to the exact model output below.
  }

  return { title: null, response: text };
}
