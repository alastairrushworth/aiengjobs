// Currencies converted to USD across the board. Keep in sync with the salary
// parser (comp.ts emits USD/GBP/EUR) plus the structured-comp currencies the
// ATS connectors can surface.
export const FX_CURRENCIES = [
  "USD", "GBP", "EUR", "CAD", "AUD", "SGD", "INR", "CHF", "SEK",
] as const;

// Static approximate rates (currency → USD multiplier). The engine uses these
// when the live FX fetch fails; the site uses them when a snapshot predates
// live rates or is missing a currency. Refresh occasionally if rates drift.
export const FX_FALLBACK_TO_USD: Record<string, number> = {
  USD: 1, GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66, SGD: 0.74, INR: 0.012,
  CHF: 1.12, SEK: 0.095,
};
