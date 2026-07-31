import type { Job, RemoteType, Seniority } from "@aiengjobs/shared";
import { SENIORITIES } from "@aiengjobs/shared";
import { decodeEntities } from "@aiengjobs/shared/text";
import { FX_FALLBACK_TO_USD } from "@aiengjobs/shared/fx";

// Re-export so pages keep a single import site for text cleanup.
export { decodeEntities };

/**
 * Only http(s) URLs may be rendered into an href — apply links and company
 * domains come from third-party feeds, which could carry javascript: URLs.
 * Returns null for anything else so callers can skip the link entirely.
 */
export function safeUrl(u?: string | null): string | null {
  if (!u) return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

export type SalaryFields = Pick<
  Job,
  "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
>;

const PERIOD_TO_YEAR: Record<string, number> = {
  year: 1, month: 12, day: 260, hour: 2080,
};
// Outside this annualized band a "salary" is almost certainly a parse error
// (e.g. an equity/valuation number), so we neither rank nor display it.
const SALARY_FLOOR_USD = 10_000;
const SALARY_CEILING_USD = 2_000_000;
// Sub-annual periods get a tighter ceiling than annual ones. A mislabelled
// period is the common failure — an annual "€68k–86k" tagged as monthly
// annualizes to €1.05M and takes the top slot on "highest salary", above every
// genuine top-of-market range. Real monthly/hourly/daily pay doesn't reach
// $750k/yr, so gating those separately lets the annual ceiling stay loose
// enough for the $850k US research roles that are legitimately in the data.
const SUBANNUAL_CEILING_USD = 750_000;

/**
 * Currency → USD multiplier, preferring the snapshot's live rates and falling
 * back to the static table. Returns null when we have no rate for the currency:
 * silently assuming 1:1 inflates a CZK/BRL/JPY range by 5–150×, which then tops
 * the "highest salary" sort and drags the stats-page medians up with it.
 * An unconvertible salary is treated as unpriced, never as a huge one.
 */
function fxToUsd(
  currency: string | undefined,
  fxRates?: Record<string, number>,
): number | null {
  const cur = (currency ?? "USD").toUpperCase();
  if (cur === "USD") return 1;
  return fxRates?.[cur] ?? FX_FALLBACK_TO_USD[cur] ?? null;
}

export function formatSalary(
  job: SalaryFields,
  fxRates?: Record<string, number>,
): string | null {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = job;
  // One gate for everything: if the role isn't priced for comparison, it isn't
  // priced for display either (see salaryMidpointUsd).
  if (salaryMidpointUsd(job, fxRates) === null) return null;

  const cur = salaryCurrency ?? "USD";
  const sym = cur === "USD" ? "$" : cur === "GBP" ? "£" : cur === "EUR" ? "€" : `${cur} `;
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

  const range =
    salaryMin && salaryMax
      ? `${k(salaryMin)}–${k(salaryMax)}`
      : k((salaryMin ?? salaryMax)!);
  const per = !salaryPeriod || salaryPeriod === "year" ? "/yr" : `/${salaryPeriod}`;
  return `${sym}${range}${per}`;
}

// Salary sort key: highest annual pay first; unpriced, unconvertible and
// implausible roles sink to the bottom (0).
export function salaryRank(job: SalaryFields, fxRates?: Record<string, number>): number {
  return salaryMidpointUsd(job, fxRates) ?? 0;
}

/**
 * Annualized USD *midpoint* of a pay range (mean of min & max, or the lone bound
 * when only one is given). Returns null when there's no usable salary, no FX
 * rate for its currency, or the figure looks like a parse error. Pass `fxRates`
 * (the snapshot's live rates) to convert local currencies; falls back to the
 * shared static table when a rate is missing.
 *
 * This is the single gate for every pay decision on the site — display, sorting
 * and the salary/stats aggregates all derive from it, so a role is either priced
 * everywhere or nowhere. It used to be three separate checks, two of which gated
 * on the *top* of the range: a role could then be selected onto "Roles with
 * published pay" (and sorted to the top of it) while its card showed no pay.
 */
export function salaryMidpointUsd(
  job: SalaryFields,
  fxRates?: Record<string, number>,
): number | null {
  const { salaryMin, salaryMax } = job;
  if (!salaryMin && !salaryMax) return null;
  const fx = fxToUsd(job.salaryCurrency, fxRates);
  if (fx === null) return null; // unknown currency — unpriced, not 1:1 with USD
  const lo = salaryMin ?? salaryMax!;
  const hi = salaryMax ?? salaryMin!;
  const period = job.salaryPeriod ?? "year";
  const perYear = PERIOD_TO_YEAR[period] ?? 1;
  const annual = ((lo + hi) / 2) * perYear * fx;
  if (annual < SALARY_FLOOR_USD || annual > SALARY_CEILING_USD) return null;
  if (period !== "year" && annual > SUBANNUAL_CEILING_USD) return null;
  return annual;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** "$123k" — display formatting for annual USD figures. */
export const kUsd = (n: number) => `$${Math.round(n / 1000)}k`;

const COUNTRY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/** Readable country name for an ISO code ("US" → "United States"). */
export function countryName(code?: string): string | undefined {
  if (!code) return undefined;
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

const DAY_MS = 86_400_000;

/** Relative posted-date stamp: "today", "3d ago", "2w ago", "4mo ago", "1y ago".
 *  Relative to the snapshot's generatedAt (the site rebuilds nightly). */
export function postedAgo(postedAt: string | undefined, generatedAt: string): string | null {
  if (!postedAt) return null;
  const posted = Date.parse(postedAt);
  const gen = Date.parse(generatedAt);
  if (!Number.isFinite(posted) || !Number.isFinite(gen)) return null;
  const days = Math.max(0, Math.floor((gen - posted) / DAY_MS));
  if (days === 0) return "today";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** "New" = the employer posted it within the last 7 days (postedAt is the only
 *  trustworthy freshness signal — everything re-ingests nightly). */
export function isNewJob(postedAt: string | undefined, generatedAt: string): boolean {
  if (!postedAt) return false;
  const posted = Date.parse(postedAt);
  const gen = Date.parse(generatedAt);
  if (!Number.isFinite(posted) || !Number.isFinite(gen)) return false;
  return gen - posted <= 7 * DAY_MS;
}

const REMOTE_LABELS: Record<RemoteType, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

export function remoteLabel(t?: RemoteType): string | null {
  return t ? REMOTE_LABELS[t] : null;
}

const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  staff: "Staff",
  principal: "Principal",
  lead: "Lead",
  manager: "Manager",
};

export function seniorityLabel(s?: Seniority): string | null {
  return s ? SENIORITY_LABELS[s] : null;
}

/** Seniority ids + labels in ladder order — drives filter options and stats. */
export const SENIORITY_OPTIONS = SENIORITIES.map((id) => ({
  id,
  label: SENIORITY_LABELS[id],
}));

/**
 * Bucket a job into a generic, browsable role family (AI Engineer, Software
 * Engineer, Research, …) by inspecting its title. Order matters — the more
 * specific families are tested first so e.g. "data scientist" never falls
 * through to the generic scientist → Research rule.
 */
export function roleType(job: Pick<Job, "title" | "normalizedTitle">): string {
  const t = ` ${(job.normalizedTitle || job.title || "").toLowerCase()} `;
  if (/data scien/.test(t)) return "Data Scientist";
  if (/data engineer|analytics engineer/.test(t)) return "Data Engineer";
  if (
    /research scien|research engineer|\bresearcher\b|applied scientist|\bscientist\b|member of (technical staff|engineering)|pre.?training|post.?training/.test(
      t,
    )
  )
    return "Research";
  if (/machine learning|\bml\b|mlops|deep learning|\bnlp\b/.test(t)) return "ML Engineer";
  if (
    /\bai engineer|applied ai|forward deployed|solutions? engineer|solutions? architect|ai architect|deployed engineer|genai|generative ai|\bagent|\bllm|\bgpt\b|prompt/.test(
      t,
    )
  )
    return "AI Engineer";
  if (
    /software engineer|\bswe\b|backend|frontend|full.?stack|infrastructure|platform engineer|\bsre\b|site reliability|devops|production engineer/.test(
      t,
    )
  )
    return "Software Engineer";
  if (/\bmanager\b|\blead\b|head of|\bdirector\b|\bvp\b|strateg/.test(t)) return "Management";
  return "Other";
}
