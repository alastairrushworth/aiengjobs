import { USER_AGENT } from "./html.ts";

// Currencies we convert to USD on the site. Keep in sync with the salary parser
// (comp.ts emits USD/GBP/EUR) plus the structured-comp currencies ATS connectors
// can surface.
export const FX_CURRENCIES = [
  "USD", "GBP", "EUR", "CAD", "AUD", "SGD", "INR", "CHF", "SEK",
] as const;

// Static fallback (approximate) used when the live fetch fails, so a network blip
// never breaks the nightly snapshot. Refresh occasionally if rates drift.
const FX_FALLBACK: Record<string, number> = {
  USD: 1, GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66, SGD: 0.74, INR: 0.012,
  CHF: 1.12, SEK: 0.095,
};

/**
 * Live currency → USD multipliers (e.g. GBP ≈ 1.27) for {@link FX_CURRENCIES},
 * pulled at snapshot time. Uses the free, keyless open.er-api.com feed (USD-based)
 * and inverts its USD→CUR quotes. Falls back to {@link FX_FALLBACK} on any error.
 */
export async function fetchFxRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { "User-Agent": USER_AGENT },
    });
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
