import { LLM_MODEL, OPENAI_API_KEY } from "../config.ts";

export function llmEnabled(): boolean {
  return OPENAI_API_KEY.length > 0;
}

/**
 * Call OpenAI (GPT-5.4-nano by default) expecting a JSON object response.
 * Returns null on any failure or when no API key is configured, so every caller
 * degrades gracefully to its heuristic path (lets the pipeline run key-less locally).
 */
export async function llmJSON(
  system: string,
  user: string,
): Promise<Record<string, unknown> | null> {
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
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[llm] HTTP ${res.status}: ${body.slice(0, 160)}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as Record<string, unknown>;
  } catch (e) {
    console.warn(`[llm] error: ${(e as Error).message}`);
    return null;
  }
}
