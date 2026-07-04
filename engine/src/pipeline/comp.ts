import type { SalaryPeriod } from "@aiengjobs/shared";

export interface ParsedSalary {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: SalaryPeriod;
}

// Parse a salary summary string, e.g. "$165K - $330K", "£90,000–£120,000",
// "€80k per year". Prefer structured ATS comp (Ashby) over description regex.
export function parseSalaryText(text?: string | null): ParsedSalary | null {
  if (!text) return null;
  // Strip 401(k) plan references before number extraction — a bare "401k"
  // would otherwise parse as $401,000.
  const t = text.replace(/,/g, "").replace(/\b401\s*\(?k\)?\b/gi, "");

  let currency = "USD";
  if (/£|gbp/i.test(t)) currency = "GBP";
  else if (/€|eur/i.test(t)) currency = "EUR";
  else if (/\$|usd/i.test(t)) currency = "USD";

  // Detect the pay period first — it decides which figures are plausible
  // (an hourly rate like "$45 – $55 per hour" is well under 1000).
  let period: SalaryPeriod = "year";
  if (/\b(hour|hourly|\/\s*hr|per hour)\b/i.test(t)) period = "hour";
  else if (/\b(month|monthly|\/\s*mo)\b/i.test(t)) period = "month";
  else if (/\b(day|daily|\/\s*day)\b/i.test(t)) period = "day";

  // Plausible bounds per period; figures outside are plan refs / noise.
  const BOUNDS: Record<SalaryPeriod, [number, number]> = {
    year: [10_000, 5_000_000],
    month: [1_000, 200_000],
    day: [100, 20_000],
    hour: [10, 1_500],
  };
  const [lo, hi] = BOUNDS[period];

  // Numbers, optionally with a K/M suffix.
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([kKmM])?/g)]
    .map((m) => {
      let n = parseFloat(m[1]);
      const suf = m[2]?.toLowerCase();
      if (suf === "k") n *= 1_000;
      else if (suf === "m") n *= 1_000_000;
      return n;
    })
    .filter((n) => n >= lo && n <= hi);

  if (nums.length === 0) return null;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return {
    salaryMin: min,
    salaryMax: max === min ? undefined : max,
    salaryCurrency: currency,
    salaryPeriod: period,
  };
}
