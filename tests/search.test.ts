import { describe, expect, it } from "vitest";
import type { JobEntry } from "../site/src/lib/jobEntry.ts";
import {
  EMPTY_STATE,
  QUERY_TRIM,
  SENIOR_PLUS,
  activeFilters,
  buildTerms,
  buildTests,
  filterJobs,
  isFiltering,
  parseState,
  relaxations,
  searchBlob,
  toParams,
  without,
  type FilterState,
} from "../site/src/lib/search.ts";

/**
 * The listing filter used to live inside a `<script>` in JobFilters.astro,
 * where nothing could test it — and it was wrong. The query compiled to a
 * single regex tested against the job's fields concatenated, so the terms had
 * to appear adjacently and in order in that concatenation. Against the live
 * board "senior rag" matched 0 of 152 roles, "remote python" 0 of 159 and
 * "staff ai engineer" 13 of 107: an ordinary two-word search returned an empty
 * screen. Most of what follows exists to keep that from coming back.
 */

let n = 0;
const job = (over: Partial<JobEntry> & { t: string }): JobEntry => ({
  slug: `job-${n++}`,
  c: "Acme",
  l: "",
  s: "",
  p: "",
  ag: 1,
  r: "",
  rm: "",
  sl: "",
  sn: "",
  co: "",
  ci: "",
  sk: [],
  lg: "",
  ...over,
});

const state = (over: Partial<FilterState> = {}): FilterState => ({ ...EMPTY_STATE, ...over });
const slugs = (jobs: JobEntry[]) => jobs.map((j) => j.slug);

describe("multi-word queries", () => {
  const seniorRag = job({ t: "Senior Engineer", sk: ["RAG", "Python"], sl: "Senior" });
  const jobs = [
    seniorRag,
    job({ t: "Junior Engineer", sk: ["RAG"] }),
    job({ t: "Senior Engineer", sk: ["Go"] }),
  ];

  it("requires every term, in any field and any order", () => {
    expect(slugs(filterJobs(jobs, state({ q: "senior rag" })))).toEqual([seniorRag.slug]);
    // Order is not adjacency: the old matcher needed the words to be neighbours
    // in the concatenated blob, which is why this returned nothing.
    expect(slugs(filterJobs(jobs, state({ q: "rag senior" })))).toEqual([seniorRag.slug]);
  });

  it("matches a term across different fields", () => {
    const j = job({ t: "ML Engineer", c: "Anthropic", ci: "London", sk: ["PyTorch"] });
    expect(filterJobs([j], state({ q: "anthropic london pytorch" }))).toHaveLength(1);
  });

  it("still anchors each term to a word start", () => {
    const trust = job({ t: "Engineer", c: "Trustpilot" });
    const rust = job({ t: "Engineer", sk: ["Rust"] });
    expect(slugs(filterJobs([trust, rust], state({ q: "rust" })))).toEqual([rust.slug]);
  });

  it("does not anchor terms that start with punctuation", () => {
    const cpp = job({ t: "Systems Engineer", sk: ["C++"] });
    const dotnet = job({ t: ".NET Engineer" });
    expect(filterJobs([cpp], state({ q: "c++" }))).toHaveLength(1);
    expect(filterJobs([dotnet], state({ q: ".net" }))).toHaveLength(1);
  });

  it("matches plurals in both directions", () => {
    const singular = job({ t: "Agent Engineer" });
    expect(filterJobs([singular], state({ q: "agents" }))).toHaveLength(1);
    const plural = job({ t: "Agents Platform Engineer" });
    expect(filterJobs([plural], state({ q: "agent" }))).toHaveLength(1);
  });

  it("resolves aliases", () => {
    const ny = job({ t: "Engineer", ci: "New York" });
    const k8s = job({ t: "Engineer", sk: ["Kubernetes"] });
    const ml = job({ t: "Machine Learning Engineer" });
    expect(filterJobs([ny], state({ q: "nyc" }))).toHaveLength(1);
    expect(filterJobs([k8s], state({ q: "k8s" }))).toHaveLength(1);
    expect(filterJobs([ml], state({ q: "ml" }))).toHaveLength(1);
  });

  it("treats an empty query as no query", () => {
    expect(buildTerms("   ")).toEqual([]);
    expect(filterJobs(jobs, state({ q: "  " }))).toHaveLength(jobs.length);
  });
});

describe("searchBlob", () => {
  it("covers the fields the filter bar can't ask about", () => {
    const j = job({
      t: "Engineer",
      c: "Acme",
      l: "Bengaluru, India",
      ci: "Bangalore",
      sl: "Staff",
      r: "Hybrid",
      sk: ["RAG"],
    });
    const blob = searchBlob(j);
    for (const part of ["engineer", "acme", "bangalore", "staff", "hybrid", "rag"]) {
      expect(blob).toContain(part);
    }
  });
});

describe("relevance ordering", () => {
  it("puts title matches above company and skill matches", () => {
    const inTitle = job({ t: "Python Engineer" });
    const inCompany = job({ t: "Engineer", c: "Python Labs" });
    const inSkill = job({ t: "Engineer", sk: ["Python"] });
    // Incoming order is newest-first and deliberately the reverse of the answer.
    const ranked = filterJobs([inSkill, inCompany, inTitle], state({ q: "python" }));
    expect(slugs(ranked)).toEqual([inTitle.slug, inCompany.slug, inSkill.slug]);
  });

  it("keeps newest-first among equally relevant roles", () => {
    const newer = job({ t: "RAG Engineer" });
    const older = job({ t: "RAG Engineer" });
    expect(slugs(filterJobs([newer, older], state({ q: "rag" })))).toEqual([
      newer.slug,
      older.slug,
    ]);
  });

  it("leaves the order alone when there is no query", () => {
    const a = job({ t: "B", sk: ["RAG"] });
    const b = job({ t: "A", sk: ["RAG"] });
    expect(slugs(filterJobs([a, b], state({ skills: ["RAG"] })))).toEqual([a.slug, b.slug]);
  });
});

describe("filters", () => {
  const remote = job({ t: "A", rm: "remote", ci: "London", co: "GB", s: "$1k", ag: 3, sn: "staff" });
  const hybrid = job({ t: "B", rm: "hybrid", ci: "London", co: "GB", ag: 40, sn: "junior" });
  const onsite = job({ t: "C", rm: "onsite", ci: "Berlin", co: "DE", s: "$2k", ag: 200, sn: "senior" });
  const jobs = [remote, hybrid, onsite];

  it("filters by work type, which text search only ever approximated", () => {
    expect(slugs(filterJobs(jobs, state({ work: "remote" })))).toEqual([remote.slug]);
  });

  it("filters by city", () => {
    expect(slugs(filterJobs(jobs, state({ city: "London" })))).toEqual([remote.slug, hybrid.slug]);
  });

  it("filters by age in days", () => {
    expect(slugs(filterJobs(jobs, state({ since: "7" })))).toEqual([remote.slug]);
    expect(slugs(filterJobs(jobs, state({ since: "30" })))).toEqual([remote.slug]);
  });

  it("ANDs multiple skills", () => {
    const both = job({ t: "A", sk: ["RAG", "Python"] });
    const one = job({ t: "B", sk: ["RAG"] });
    expect(slugs(filterJobs([both, one], state({ skills: ["RAG", "Python"] })))).toEqual([
      both.slug,
    ]);
  });

  it("expands the grouped seniority to the whole band", () => {
    expect(slugs(filterJobs(jobs, state({ level: SENIOR_PLUS })))).toEqual([
      remote.slug,
      onsite.slug,
    ]);
    expect(slugs(filterJobs(jobs, state({ level: "senior" })))).toEqual([onsite.slug]);
  });

  it("combines every clause", () => {
    const s = state({ work: "remote", city: "London", level: SENIOR_PLUS });
    expect(slugs(filterJobs(jobs, s))).toEqual([remote.slug]);
  });

  it("keys one clause per control, so counts can drop exactly one", () => {
    // updateCounts() in JobFilters.astro drops the clause whose key matches the
    // select's id; a rename here silently stops excluding a select's own value.
    expect(Object.keys(buildTests(EMPTY_STATE)).sort()).toEqual(
      ["city", "country", "level", "q", "since", "skill", "work"].sort(),
    );
  });
});

describe("URL state", () => {
  it("round-trips", () => {
    const s = state({
      q: "senior rag",
      level: SENIOR_PLUS,
      country: "GB",
      city: "London",
      work: "remote",
      since: "7",
      skills: ["RAG", "Python"],
    });
    expect(parseState(toParams(s))).toEqual(s);
  });

  it("drops values that name nothing rather than filtering to zero", () => {
    const s = parseState(new URLSearchParams("work=wherever&since=soon&level=wizard"));
    expect([s.work, s.since, s.level]).toEqual(["", "", ""]);
  });

  it("ignores the retired sort param", () => {
    expect(isFiltering(parseState(new URLSearchParams("sort=pay")))).toBe(false);
  });

  it("accepts a single skill or a list", () => {
    expect(parseState(new URLSearchParams("skill=RAG")).skills).toEqual(["RAG"]);
    expect(parseState(new URLSearchParams("skill=RAG,Python")).skills).toEqual(["RAG", "Python"]);
  });

  it("omits everything unset", () => {
    expect(toParams(EMPTY_STATE).toString()).toBe("");
  });
});

describe("removing filters", () => {
  const full = state({ q: "senior rag", work: "remote", skills: ["RAG", "Python"] });

  it("lists each active filter separately", () => {
    expect(activeFilters(full)).toEqual([
      { key: "q", value: "senior rag" },
      { key: "work", value: "remote" },
      { key: "skill", value: "RAG" },
      { key: "skill", value: "Python" },
    ]);
  });

  it("removes one skill without removing the others", () => {
    expect(without(full, "skill", "RAG").skills).toEqual(["Python"]);
  });

  it("trims the last query word", () => {
    expect(without(full, QUERY_TRIM).q).toBe("senior");
  });
});

describe("zero-result recovery", () => {
  const jobs = [
    job({ t: "Senior RAG Engineer", rm: "onsite" }),
    job({ t: "Junior Python Engineer", rm: "remote" }),
  ];

  it("only offers relaxations that actually return something", () => {
    const dead = state({ q: "senior rag", work: "remote" });
    expect(filterJobs(jobs, dead)).toHaveLength(0);
    const out = relaxations(jobs, dead);
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) {
      expect(r.count).toBeGreaterThan(0);
      expect(filterJobs(jobs, r.state)).toHaveLength(r.count);
    }
  });

  it("ranks the roomiest way out first", () => {
    const out = relaxations(jobs, state({ q: "senior rag", work: "remote" }));
    expect(out[0]!.count).toBeGreaterThanOrEqual(out[out.length - 1]!.count);
  });

  it("offers dropping the last word of a multi-word query", () => {
    const out = relaxations(jobs, state({ q: "senior rag python" }));
    expect(out.some((r) => r.key === QUERY_TRIM)).toBe(true);
  });

  it("returns nothing when the board itself is empty", () => {
    expect(relaxations([], state({ q: "rag" }))).toEqual([]);
  });
});
