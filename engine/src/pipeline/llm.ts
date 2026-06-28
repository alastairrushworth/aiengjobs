import { LLM_MODEL, OPENAI_API_KEY } from "../config.ts";

export function llmEnabled(): boolean {
  return OPENAI_API_KEY.length > 0;
}

type ChatBody = Record<string, unknown>;

/**
 * Shared OpenAI chat-completions call (GPT-5.4-nano by default). Returns the
 * parsed JSON object from the assistant message, or null on any failure / when
 * no API key is configured — so every caller degrades gracefully to heuristics.
 */
async function chatJSON(body: ChatBody): Promise<Record<string, unknown> | null> {
  if (!llmEnabled()) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        // Classify/extract are mechanical tasks — no reasoning needed. "none"
        // keeps reasoning_tokens at 0 (cheapest, fastest on GPT-5.x-nano).
        reasoning_effort: "none",
        ...body,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[llm] HTTP ${res.status}: ${errBody.slice(0, 160)}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; refusal?: string } }[];
    };
    const msg = data.choices?.[0]?.message;
    if (msg?.refusal || !msg?.content) return null;
    return JSON.parse(msg.content) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[llm] error: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Call the model with a strict JSON Schema (Structured Outputs). The response is
 * guaranteed to match `schema` (enums enforced server-side), so callers can use
 * the fields without defensive re-validation.
 */
export function llmStructured(
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  return chatJSON({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
  });
}
