// Currencies converted to USD across the board. Keep in sync with the salary
// parser (comp.ts emits USD/GBP/EUR) plus the structured-comp currencies the
// ATS connectors can surface — Ashby/Workday pass through whatever the employer
// configured, so this list is deliberately wider than what the text parser
// emits. A currency missing here is treated as *unpriced* rather than assumed
// 1:1 with USD, which would inflate a CZK/BRL/JPY range by 5–150× and float it
// to the top of every pay ranking (see site/src/lib/format.ts).
export const FX_CURRENCIES = [
  "USD", "GBP", "EUR", "CAD", "AUD", "SGD", "INR", "CHF", "SEK",
  "CZK", "PLN", "BRL", "DKK", "NOK", "JPY", "MXN", "ILS", "NZD", "HKD", "ZAR",
] as const;

// Static approximate rates (currency → USD multiplier). The engine uses these
// when the live FX fetch fails; the site uses them when a snapshot predates
// live rates or is missing a currency. Refresh occasionally if rates drift.
export const FX_FALLBACK_TO_USD: Record<string, number> = {
  USD: 1, GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66, SGD: 0.74, INR: 0.012,
  CHF: 1.12, SEK: 0.095, CZK: 0.043, PLN: 0.25, BRL: 0.18, DKK: 0.145,
  NOK: 0.092, JPY: 0.0065, MXN: 0.055, ILS: 0.27, NZD: 0.59, HKD: 0.128,
  ZAR: 0.055,
};
