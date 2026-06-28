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

export function formatSalary(
  job: Pick<Job, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">,
): string | null {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = job;
  if (!salaryMin && !salaryMax) return null;

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
