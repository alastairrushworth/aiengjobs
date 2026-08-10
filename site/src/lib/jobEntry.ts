/**
 * The per-job record the client-side filter works on.
 *
 * Written by `lib/jobsPayload.ts` at build time, served as `/jobs-data.json`
 * (and one per landing), read by `lib/search.ts` and the script in
 * `components/JobFilters.astro`. It lived in two places until this module
 * existed — the builder's interface and a hand-copied one inside the client
 * script — which is exactly the kind of pair that drifts silently: a field
 * added to the payload and not to the client is invisible until a filter
 * quietly matches nothing.
 *
 * Keys are terse because this ships once per visitor and the shape repeats
 * ~2,000 times.
 */
export interface JobEntry {
  slug: string;
  t: string; // title
  c: string; // company name
  l: string; // raw location line, as the feed wrote it
  s: string; // formatted salary ("" when unpublished)
  p: string; // relative posted stamp, "today" / "3d ago" ("" when undated)
  r: string; // work-type label ("Remote")
  rm: string; // work-type id, the filter value ("remote")
  sl: string; // seniority label ("Senior")
  sn: string; // seniority id, the filter value ("senior")
  co: string; // country code (filter value)
  ci: string; // canonical city ("" when the feed gave none)
  sk: string[]; // canonical skills
  /** Logo filename ("" when we have none — the card falls back to a monogram).
   *  Repeated per job rather than shipped as a company→file map: ~300 distinct
   *  values across the payload compress to almost nothing, and it keeps the
   *  client renderer a straight field read. */
  lg: string;
  /** Lazily-built lowercase search blob. Client-only — never serialized. */
  q?: string;
}
