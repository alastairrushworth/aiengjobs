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
  if (!/^https?:\/\//i.test(t)) return null;
  // Upgrade http to https rather than sending an applicant somewhere plaintext
  // off a board whose pitch is first-party trust. Eight apply URLs arrive this
  // way today (block.xyz, squarespace.com, stability.ai) and every one of them
  // 301s to https anyway — this just skips the hop and the insecure moment.
  return t.replace(/^http:\/\//i, "https://");
}

/**
 * A company's bare domain ("openai.com") as an https URL, or null if it isn't
 * a plausible hostname. Seed data rather than ATS input, but it reaches both a
 * rendered href (companies/[slug]) and a schema.org `sameAs` (jobs/[slug]), and
 * those two used to validate it differently — the job page not at all, so a
 * malformed value became a broken sameAs in the markup.
 */
export function companyUrl(domain?: string | null): string | null {
  if (!domain) return null;
  const d = domain.trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? `https://${d}` : null;
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

// isNewJob() lived here and answered "posted within 7 days", for the green
// "New" badge on job cards. Cards now carry postedAgo()'s dated stamp instead —
// on a newest-first list the flag was true of all 50 visible cards and so said
// nothing — and nothing else ever asked the question.

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

/* The role-family bucketer that used to live here is gone with the Role type
   filter it existed to feed: title-regex families were a guess the clusters
   already answer better, and the job page, the payload and the search blob all
   carried the guess forward. Clusters (job.clusters) are the browsable grouping
   now — see lib/landings. */
