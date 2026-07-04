import { fetchRetry } from "./fetch.ts";
import { FX_CURRENCIES, FX_FALLBACK_TO_USD as FX_FALLBACK } from "@aiengjobs/shared/fx";

export { FX_CURRENCIES };

/**
 * Live currency → USD multipliers (e.g. GBP ≈ 1.27) for {@link FX_CURRENCIES},
 * pulled at snapshot time. Uses the free, keyless open.er-api.com feed (USD-based)
 * and inverts its USD→CUR quotes. Falls back to {@link FX_FALLBACK} on any error.
 */
export async function fetchFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetchRetry("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    if (data.result !== "success" || !data.rates) throw new Error("bad payload");

    const out: Record<string, number> = {};
    for (const cur of FX_CURRENCIES) {
      const perUsd = data.rates[cur]; // units of CUR per 1 USD
      out[cur] =
        cur === "USD"
          ? 1
          : perUsd
            ? Number((1 / perUsd).toFixed(4))
            : FX_FALLBACK[cur];
    }
    return out;
  } catch (err) {
    console.warn(`FX fetch failed, using fallback rates: ${(err as Error).message}`);
    return { ...FX_FALLBACK };
  }
}
