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
  const t = text.replace(/,/g, "");

  let currency = "USD";
  if (/£|gbp/i.test(t)) currency = "GBP";
  else if (/€|eur/i.test(t)) currency = "EUR";
  else if (/\$|usd/i.test(t)) currency = "USD";

  // Numbers, optionally with a K/M suffix. Ignore anything below 1000 (e.g. "401k" plan refs handled by suffix).
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([kKmM])?/g)]
    .map((m) => {
      let n = parseFloat(m[1]);
      const suf = m[2]?.toLowerCase();
      if (suf === "k") n *= 1_000;
      else if (suf === "m") n *= 1_000_000;
      return n;
    })
    .filter((n) => n >= 1000);

  if (nums.length === 0) return null;

  let period: SalaryPeriod = "year";
  if (/\b(hour|hourly|\/\s*hr|per hour)\b/i.test(t)) period = "hour";
  else if (/\b(month|monthly|\/\s*mo)\b/i.test(t)) period = "month";
  else if (/\b(day|daily|\/\s*day)\b/i.test(t)) period = "day";

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return {
    salaryMin: min,
    salaryMax: max === min ? undefined : max,
    salaryCurrency: currency,
    salaryPeriod: period,
  };
}
