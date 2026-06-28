import type { Job, RemoteType, Seniority } from "@aiengjobs/shared";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

/**
 * Decode HTML entities (&nbsp;, &amp;, &#39;, …) that survive in snapshot text,
 * and fold non-breaking spaces to ordinary ones. Defensive: the engine also
 * decodes at ingest, but this keeps already-captured listings rendering cleanly.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
      if (e[0] === "#") {
        const code =
          e[1] === "x" || e[1] === "X"
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return NAMED_ENTITIES[e] ?? m;
    })
    .replace(/\u00a0/g, " ");
}

type SalaryFields = Pick<
  Job,
  "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
>;

// Normalizes pay period + currency to a comparable annual USD figure — used both
// to rank roles and to sanity-check parses. Jobs without salary are 0.
const FX_TO_USD: Record<string, number> = {
  USD: 1, GBP: 1.27, EUR: 1.08, CAD: 0.73, AUD: 0.66, SGD: 0.74, INR: 0.012,
};
const PERIOD_TO_YEAR: Record<string, number> = {
  year: 1, month: 12, day: 260, hour: 2080,
};
// Above this annualized figure a "salary" is almost certainly a parse error
// (e.g. an equity/valuation number), so we neither rank nor display it.
const SALARY_CEILING_USD = 2_000_000;

function annualUsd(job: SalaryFields): number {
  const base = job.salaryMax ?? job.salaryMin;
  if (!base) return 0;
  const fx = FX_TO_USD[(job.salaryCurrency ?? "USD").toUpperCase()] ?? 1;
  const perYear = PERIOD_TO_YEAR[job.salaryPeriod ?? "year"] ?? 1;
  return base * perYear * fx;
}

export function formatSalary(job: SalaryFields): string | null {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = job;
  if (!salaryMin && !salaryMax) return null;
  if (annualUsd(job) > SALARY_CEILING_USD) return null; // implausible parse — hide

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

// Invisible home-page ranking: highest annual pay first; implausible parses and
// no-salary roles sink to the bottom (0).
export function salaryRank(job: SalaryFields): number {
  const annual = annualUsd(job);
  return annual > SALARY_CEILING_USD ? 0 : annual;
}

// Annualized USD *midpoint* of a pay range (mean of min & max, or the lone bound
// when only one is given). Returns null when there's no usable salary or the
// figure looks like a parse error. Used by the stats page for like-for-like
// company/skill pay comparisons — hence midpoint rather than top-of-range.
// Pass `fxRates` (the snapshot's live rates) to convert local currencies; falls
// back to the static table per-currency when a rate is missing.
const SALARY_FLOOR_USD = 10_000;
export function salaryMidpointUsd(
  job: SalaryFields,
  fxRates?: Record<string, number>,
): number | null {
  const { salaryMin, salaryMax } = job;
  if (!salaryMin && !salaryMax) return null;
  const lo = salaryMin ?? salaryMax!;
  const hi = salaryMax ?? salaryMin!;
  const cur = (job.salaryCurrency ?? "USD").toUpperCase();
  const fx = fxRates?.[cur] ?? FX_TO_USD[cur] ?? 1;
  const perYear = PERIOD_TO_YEAR[job.salaryPeriod ?? "year"] ?? 1;
  const annual = ((lo + hi) / 2) * perYear * fx;
  if (annual < SALARY_FLOOR_USD || annual > SALARY_CEILING_USD) return null;
  return annual;
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
