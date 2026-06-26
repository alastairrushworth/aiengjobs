import type { Job, RemoteType, Seniority } from "@aiengjobs/shared";

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
