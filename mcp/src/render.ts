/**
 * Turning results into markdown.
 *
 * This exists because of how a model reads a tool result. When a job arrives as
 * a JSON object of fifteen equal-looking keys, `applyUrl` is one of them, and a
 * model summarising twenty of those into prose keeps what reads as content —
 * title, company, location, pay — and drops what reads as plumbing. The apply
 * link was being dropped every time.
 *
 * The fix is structural rather than instructional: make the title *be* the link.
 * A model can't reproduce the role without carrying its URL, because there is no
 * longer a version of the title that doesn't have one. Telling the model to
 * include links in the tool description helps a little; this stops the question
 * arising.
 *
 * Note what is deliberately NOT done here: no instruction is embedded in the
 * rendered output. Tool results are the same channel employer-authored job
 * descriptions arrive on, and a model that obeys "always show the apply link"
 * from that channel is a model that obeys worse things from it. Instructions go
 * in the tool description, which is ours and can't be spoofed. This file only
 * shapes data.
 */

import type { JobDetail, McpJob } from "./board.js";
import type { CompanyResult, SearchResult, StatsResult } from "./tools.js";

const DAY_MS = 86_400_000;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
  SGD: "S$",
  INR: "₹",
  JPY: "¥",
  CHF: "CHF ",
  ILS: "₪",
};

const PERIOD_SUFFIX: Record<string, string> = {
  hour: "/hr",
  day: "/day",
  month: "/mo",
  year: "",
};

/**
 * 180000 -> "180k", 1_500_000 -> "1.5m", 90 -> "90".
 *
 * The sub-1000 case is not hypothetical: hourly and daily rates come through
 * here too, and rounding those to thousands renders a $90–120/hr contract as
 * "$0k–$0k/hr".
 */
function short(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}m`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n)}`;
}

/**
 * Pay in the currency it was actually posted in. The USD figure stays in the
 * structured payload for comparison — showing "$216k" for a role advertised in
 * rupees is a conversion, not what the employer said.
 */
export function formatSalary(job: McpJob): string | null {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = job;
  if (salaryMin == null && salaryMax == null) return null;

  const symbol = salaryCurrency ? (CURRENCY_SYMBOLS[salaryCurrency] ?? `${salaryCurrency} `) : "";
  const suffix = PERIOD_SUFFIX[salaryPeriod ?? "year"] ?? "";

  if (salaryMin != null && salaryMax != null && salaryMin !== salaryMax) {
    return `${symbol}${short(salaryMin)}–${symbol}${short(salaryMax)}${suffix}`;
  }
  return `${symbol}${short((salaryMin ?? salaryMax)!)}${suffix}`;
}

/** Age measured against the snapshot, not wall-clock — the board is a nightly export. */
export function postedAgo(postedAt: string | null, generatedAt: string): string | null {
  if (!postedAt) return null;
  const posted = Date.parse(postedAt);
  const gen = Date.parse(generatedAt);
  if (!Number.isFinite(posted) || !Number.isFinite(gen)) return null;

  const days = Math.max(0, Math.floor((gen - posted) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** `]` in a title would otherwise close the link early. */
const escapeLinkText = (s: string) => s.replace(/([[\]])/g, "\\$1");

/**
 * Angle brackets around every destination. Apply URLs routinely carry parens and
 * commas from ATS query strings, and a bare `)` ends the link at the wrong place.
 */
const link = (text: string, url: string) => `[${escapeLinkText(text)}](<${url}>)`;

const REMOTE_LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One role as two lines: a linked title, then the facts someone triages on.
 * The slug rides along so a follow-up get_job doesn't need another search.
 */
export function renderJobRow(job: McpJob, generatedAt: string): string {
  const facts = [
    job.location,
    job.seniority ? titleCase(job.seniority) : null,
    job.remote ? REMOTE_LABEL[job.remote] : null,
    formatSalary(job),
    postedAgo(job.postedAt, generatedAt),
  ].filter(Boolean);

  return (
    `**${link(job.title, job.applyUrl)}** — ${job.company}\n` +
    `${facts.join(" · ")} · \`${job.slug}\``
  );
}

/** Header stating what the data is. Facts only — no instructions to the model. */
function provenance(generatedAt: string): string {
  return `_Source: frontierroles.com, snapshot ${generatedAt.slice(0, 10)}. Links go directly to the employer's own posting._`;
}

export function renderSearch(result: SearchResult): string {
  if (!result.jobs.length) {
    return (
      `No open roles match.\n\n` +
      `${result.total === 0 ? "Try fewer filters, or call list_skills to check skill and cluster names." : ""}\n` +
      provenance(result.generatedAt)
    );
  }

  const from = result.offset + 1;
  const to = result.offset + result.returned;
  const range = result.total > result.returned ? ` Showing ${from}–${to}.` : "";

  return [
    `**${result.total} open role${result.total === 1 ? "" : "s"} match.**${range}`,
    "",
    result.jobs.map((j) => renderJobRow(j, result.generatedAt)).join("\n\n"),
    "",
    provenance(result.generatedAt),
  ].join("\n");
}

export function renderJob(detail: JobDetail): string {
  const facts = [
    detail.location,
    detail.seniority ? titleCase(detail.seniority) : null,
    detail.remote ? REMOTE_LABEL[detail.remote] : null,
    formatSalary(detail),
    postedAgo(detail.postedAt, detail.generatedAt),
  ].filter(Boolean);

  const parts = [
    `# ${detail.title}`,
    `**${detail.company}**${detail.companyDomain ? ` · ${detail.companyDomain}` : ""}`,
    facts.join(" · "),
    "",
    `**${link("Apply on the employer's site", detail.applyUrl)}** · ${link("view on frontierroles", detail.jobUrl)}`,
  ];

  if (detail.skills.length) parts.push("", `Skills: ${detail.skills.join(", ")}`);
  if (detail.description) parts.push("", "---", "", detail.description);

  return parts.join("\n");
}

export function renderCompany(result: CompanyResult): string {
  return [
    `**${result.company}** — ${result.openRoles} open role${result.openRoles === 1 ? "" : "s"}`,
    "",
    result.jobs.map((j) => renderJobRow(j, result.generatedAt)).join("\n\n"),
    "",
    provenance(result.generatedAt),
  ].join("\n");
}

const usd = (n: number | null) => (n == null ? "—" : `$${short(n)}`);

/** A table, because this is aggregate data a model should reproduce as a table. */
export function renderStats(result: StatsResult): string {
  const header =
    `**${result.totalJobs} role${result.totalJobs === 1 ? "" : "s"} by ${result.dimension}.** ` +
    `${result.pricedJobs} publish pay (median ${usd(result.medianSalaryUsd)}).`;

  const rows = result.buckets.map(
    (b) => `| ${b.key} | ${b.jobs} | ${usd(b.medianSalaryUsd)} | ${b.pricedJobs} |`,
  );

  return [
    header,
    "",
    `| ${result.dimension} | roles | median pay | priced |`,
    "|---|---:|---:|---:|",
    ...rows,
    "",
    `_Pay is the annualised midpoint in USD across roles that publish it; roles without published pay are excluded from the median, not counted as zero. Snapshot ${result.generatedAt.slice(0, 10)}._`,
  ].join("\n");
}

/**
 * The machine-readable half of a search result.
 *
 * Trimmed rather than the full record: with the markdown carrying presentation,
 * this only needs what a follow-up call or a client-side filter would use.
 * Dropping the four redundant salary fields and companySlug takes a 20-role
 * response down by roughly a third.
 */
export function compactJob(job: McpJob): Record<string, unknown> {
  return {
    slug: job.slug,
    title: job.title,
    company: job.company,
    applyUrl: job.applyUrl,
    location: job.location,
    country: job.country,
    remote: job.remote,
    seniority: job.seniority,
    salaryUsd: job.salaryUsd,
    skills: job.skills,
    clusters: job.clusters,
    postedAt: job.postedAt,
  };
}
