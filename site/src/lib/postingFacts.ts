/**
 * The handful of facts a candidate scans a posting for, read out of the
 * employer's description by rule.
 *
 * The description on a job page is the employer's text, and Google already has
 * it from the employer — on a typical page it is ~80% of what's visible, which
 * is how a board gets filed as a copy of its sources. What the board can add
 * without inventing anything is a reading of that text: how much experience is
 * being asked for, whether a visa is on offer, how many days are in the office.
 * Those answers are buried in paragraph nine of a 6,000-character advert, and
 * nobody else lifts them out.
 *
 * Rules, not a model, on purpose: this runs over every listed role on every
 * build at no cost, and a rule can be read, tested and corrected.
 *
 * Precision over recall, everywhere. A missing row costs nothing — the full
 * description is right underneath. A wrong row ("Visa sponsorship: not
 * offered" on a role that offers it) costs an application. So every rule wants
 * its cue *and* its context in the same sentence, anything hedged or
 * contradictory is dropped rather than resolved, and the rules were tuned
 * against the live corpus rather than against imagined phrasings. Each fact
 * keeps the sentence it came from so a test (or a sceptic) can check the claim.
 */

export type FactId =
  | "experience"
  | "education"
  | "visa"
  | "citizenship"
  | "clearance"
  | "office"
  | "travel"
  | "extras"
  | "relocation"
  | "oncall"
  | "languages";

export interface PostingFact {
  id: FactId;
  label: string;
  value: string;
  /** The sentence the value was read from. Not rendered — it is the audit trail. */
  evidence: string;
}

export interface PostingFacts {
  facts: PostingFact[];
  /**
   * Minimum years asked for, when the posting states one plainly as a
   * requirement. Absent for "preferred" figures and degree ladders ("12 years
   * with a BS, 8 with an MS"), where no single number is true — this feeds the
   * JobPosting markup, which has room for exactly one.
   */
  minYears?: number;
  /** Highest degree level stated as a requirement, for the markup. */
  requiredDegree?: DegreeLevel;
  /** The posting says experience can stand in for the degree. */
  experienceInPlaceOfEducation?: boolean;
}

export type DegreeLevel = "bachelor" | "master" | "phd";

interface Sentence {
  text: string;
  /** First sentence of a bulleted line — where requirements are usually stated. */
  bullet: boolean;
  /** Under a "Preferred / Nice to have / Bonus" heading. */
  preferred: boolean;
}

const BULLET_RE = /^\s*(?:[•·▪◦‣*]|[-–—](?=\s))\s*/;
const PREFERRED_HEADING_RE =
  /\b(prefer|nice[- ]to[- ]have|good[- ]to[- ]have|bonus|a plus\b|pluses|desir|ideal|stand out|extra credit|not required)/i;
// A heading that starts a new section and so ends a "preferred" one.
const HEADING_MAX_CHARS = 70;
const PREFERRED_INLINE_RE =
  /\b(preferred|ideally|recommended|nice[- ]to[- ]have|a plus\b|is a bonus|bonus points|desirable|not required)\b/i;

/**
 * The description as sentences, each knowing whether it sits in a bullet and
 * whether it sits under a "preferred" heading. The snapshot's text keeps the
 * advert's line structure (see stripHtml), which is what makes headings
 * recoverable at all: a short unbulleted line that doesn't end a sentence.
 */
function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let preferred = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = BULLET_RE.test(line);
    const body = line.replace(BULLET_RE, "").trim();
    if (!body) continue;
    const isHeading = !bullet && body.length <= HEADING_MAX_CHARS && !/[.!?]$/.test(body);
    if (isHeading) preferred = PREFERRED_HEADING_RE.test(body);
    // Split on sentence ends, but not inside "U.S." / "e.g." / "Ph.D." — the
    // lookbehind wants a lowercase letter, digit or bracket before the stop.
    const parts = body.split(/(?<=[a-z0-9)\]’'"%][.!?])\s+(?=[A-Z(“"])/);
    parts.forEach((p, i) => {
      const s = p.trim();
      if (s) out.push({ text: s, bullet: bullet && i === 0, preferred });
    });
  }
  return out;
}

const isPreferred = (s: Sentence): boolean => s.preferred || PREFERRED_INLINE_RE.test(s.text);

// --- Experience ---------------------------------------------------------------

const YEARS_RE =
  /(?<![\d$£€.,])(\d{1,2})\s*\+?(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b(?!\s*old)/gi;
/** Nobody asks for more than this; bigger numbers are the company's age. */
const MAX_PLAUSIBLE_YEARS = 20;
// "For 10 years, Scale has…", "spent 18 years at Google", "over the past 5 years".
const HISTORY_BEFORE_RE =
  /\b(?:for|spent|spending|over|past|last|nearly|almost|after|within|in)\s+(?:the\s+)?(?:over\s+|more than\s+|nearly\s+|past\s+|last\s+|first\s+|next\s+)*$/i;
const DEGREE_WORD_RE = /\b(bachelor|master|ph\.?\s?d|doctorate|degree|\bB\.?S\b|\bM\.?S\b)/i;

interface YearsMention {
  lo: number;
  hi?: number;
  sentence: Sentence;
}

function yearsMentions(s: Sentence): YearsMention[] {
  // "With over 25 years of experience and 5,000 staff, we…" is the company.
  if (/^with\b/i.test(s.text) && !s.bullet) return [];
  const found: YearsMention[] = [];
  for (const m of s.text.matchAll(YEARS_RE)) {
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : undefined;
    if (lo === 0 || lo > MAX_PLAUSIBLE_YEARS || (hi !== undefined && (hi <= lo || hi > 25))) continue;
    const before = s.text.slice(0, m.index);
    const after = s.text.slice(m.index + m[0].length, m.index + m[0].length + 110);
    // "at least 3 years" is a requirement even though "at least" isn't in the
    // history list; the list is only the phrasings that introduce a duration.
    if (HISTORY_BEFORE_RE.test(before) && !/\b(?:at least|minimum(?: of)?|min\.?)\s+$/i.test(before)) {
      continue;
    }
    const opensBullet = s.bullet && before.replace(/[^a-z]/gi, "").length <= 24;
    const saysExperience = /\b(experience|exp\b|expertise|background|track record)/i.test(after);
    const experienceBefore = /\bexperience\b[^.]{0,25}$/i.test(before); // "Total experience 9+ years"
    if (!opensBullet && !saysExperience && !experienceBefore) continue;
    found.push({ lo, hi, sentence: s });
  }
  return found;
}

const yearsValue = (m: { lo: number; hi?: number }): string =>
  m.hi !== undefined ? `${m.lo}–${m.hi} years` : `${m.lo}+ years`;

function experienceFact(all: Sentence[]): { fact?: PostingFact; minYears?: number } {
  let firstPreferred: YearsMention | undefined;
  for (const s of all) {
    const found = yearsMentions(s);
    if (found.length === 0) continue;
    if (isPreferred(s)) {
      firstPreferred ??= found[0];
      continue;
    }
    // "12 years with a Bachelor's; or 8 and a Master's; or a PhD with 5" — one
    // requirement stated three ways. No single figure is the truth, so give the
    // span and say what it turns on.
    if (found.length >= 2 && DEGREE_WORD_RE.test(s.text)) {
      const lo = Math.min(...found.map((f) => f.lo));
      const hi = Math.max(...found.map((f) => f.lo));
      if (hi > lo) {
        return {
          fact: {
            id: "experience",
            label: "Experience",
            value: `${lo}–${hi} years, depending on degree`,
            evidence: s.text,
          },
        };
      }
    }
    // The first plain statement is the headline ask; later ones qualify it
    // ("10+ years of software engineering, including 7+ in ML").
    const first = found[0]!;
    return {
      fact: { id: "experience", label: "Experience", value: yearsValue(first), evidence: s.text },
      minYears: first.lo,
    };
  }
  if (firstPreferred) {
    return {
      fact: {
        id: "experience",
        label: "Experience",
        value: `${yearsValue(firstPreferred)} preferred`,
        evidence: firstPreferred.sentence.text,
      },
    };
  }
  return {};
}

// --- Education ----------------------------------------------------------------

// Abbreviations are case-sensitive and must not be a product ("MS Teams") or a
// unit ("50 ms"): they only count in a sentence that is visibly about degrees.
const DEGREE_CONTEXT_RE =
  /\b(degree|diploma|in (?:computer|a related|an? (?:quantitative|technical|stem|relevant|engineering)|engineering|mathematics|statistics|physics|machine learning)|related (?:technical |quantitative )?(?:field|discipline)|equivalent|program(?:me)?\b|student|graduate)/i;
const LEVEL_RES: [DegreeLevel, RegExp][] = [
  ["phd", /\b(?:Ph\.?\s?D|PHD|phd|[Dd]octorate|[Dd]octoral)\b/],
  [
    "master",
    /\b(?:[Mm]aster(?:'s|’s|s)?\b|M\.?S\.?c?\.?(?![A-Za-z])(?!\s*(?:Office|Excel|Teams|SQL|Word|Azure|Dynamics|Power|Access|Fabric))|M\.?Eng\b|MBA\b|[Aa]dvanced degree|[Gg]raduate degree|[Pp]ostgraduate)/,
  ],
  [
    "bachelor",
    /\b(?:[Bb]achelor(?:'s|’s|s)?\b|B\.?S\.?c?\.?(?![A-Za-z])|B\.?Tech\b|B\.?Eng\b|[Uu]ndergraduates?\b|[Uu]niversity degree|[Cc]ollege degree)/,
  ],
];
const EQUIVALENT_RE =
  /\b(equivalent (?:\w+ ){0,2}(?:experience|track record)|or equivalent|in lieu of (?:a |the )?degree|instead of a degree|equivalent proven|or have\b[^.]{0,40}\bexperience)/i;
const STUDENT_RE = /\b(currently (?:enrolled|pursuing|studying)|pursuing an?|enrolled in|students?\b|candidates? in)/i;

const LEVEL_LABEL: Record<DegreeLevel, string> = {
  bachelor: "Bachelor's",
  master: "Master's",
  phd: "PhD",
};
const LEVEL_ORDER: DegreeLevel[] = ["bachelor", "master", "phd"];

const joinOr = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

function educationFact(all: Sentence[]): {
  fact?: PostingFact;
  requiredDegree?: DegreeLevel;
  equivalent?: boolean;
} {
  const required = new Set<DegreeLevel>();
  const preferred = new Set<DegreeLevel>();
  let equivalent = false;
  let student = false;
  let evidence: string | undefined;
  for (const s of all) {
    if (!DEGREE_CONTEXT_RE.test(s.text)) continue;
    const levels = LEVEL_RES.filter(([, re]) => re.test(s.text)).map(([l]) => l);
    if (levels.length === 0) continue;
    evidence ??= s.text;
    if (EQUIVALENT_RE.test(s.text)) equivalent = true;
    if (STUDENT_RE.test(s.text)) student = true;
    // A leading label governs the whole line: "Highly recommended: Master's or
    // PhD" prefers both, not just the one standing next to the colon.
    const labelled = /^(?:\w+\s+){0,2}(?:recommended|preferred|nice to have|ideally|bonus|desirable)\s*[:–—-]/i.test(
      s.text,
    );
    // "Bachelor's required, PhD preferred" in one sentence: the word sits next
    // to the level it governs, so look at what follows each level.
    for (const level of levels) {
      const re = LEVEL_RES.find(([l]) => l === level)![1];
      const at = s.text.search(re);
      const tail = s.text.slice(at, at + 60);
      const pref =
        s.preferred ||
        labelled ||
        /\b(preferred|recommended|a plus|is a bonus|desirable|ideally)\b/i.test(tail);
      (pref ? preferred : required).add(level);
    }
  }
  for (const l of required) preferred.delete(l);
  if (required.size === 0 && preferred.size === 0) return {};

  const names = (set: Set<DegreeLevel>) => LEVEL_ORDER.filter((l) => set.has(l)).map((l) => LEVEL_LABEL[l]);
  const bits: string[] = [];
  if (required.size > 0) {
    // The equivalence belongs to the requirement it relaxes, so it is said
    // there — "Bachelor's or equivalent experience; Master's preferred".
    const asked = joinOr(names(required));
    bits.push(
      student ? `Studying for a ${asked}` : equivalent ? `${asked}, or equivalent experience` : asked,
    );
  }
  if (preferred.size > 0) bits.push(`${joinOr(names(preferred))} preferred`);
  const value = bits.join("; ");

  // The markup wants the *minimum* credential — the lowest level listed as an
  // acceptable requirement — and only when the role isn't aimed at students.
  const lowest = LEVEL_ORDER.find((l) => required.has(l));
  return {
    fact: { id: "education", label: "Education", value, evidence: evidence! },
    ...(lowest && !student ? { requiredDegree: lowest } : {}),
    equivalent,
  };
}

// --- Visa sponsorship -----------------------------------------------------------

// "Executive sponsorship" and "sponsor of the mission" are everywhere in
// customer-facing roles; only sentences about immigration count.
const VISA_CONTEXT_RE =
  /\b(visas?|immigration|work (?:authori[sz]ation|permit)|employment authori[sz]ation|h-?1b|right to work)\b/i;
const VISA_HEDGE_RE =
  /\b(case[- ]by[- ]case|may not be able|dependent on|depends on|can(?:'|’)?t guarantee|cannot guarantee|(?:aren(?:'|’)t|not) able to successfully|for (?:certain|some|select|eligible) (?:roles|positions|candidates)|may be (?:available|offered|considered))\b/i;
const VISA_NO_RE =
  /\b(?:(?:not|no|unable to|cannot|can(?:'|’)t|won(?:'|’)t|will not|does not|doesn(?:'|’)t|do not|don(?:'|’)t)\b[^.;]{0,70}\bsponsor|sponsorship (?:is )?(?:not|unavailable)|not eligible for[^.;]{0,60}sponsorship|without (?:requiring |the need for |needing |any )?[^.;]{0,60}sponsorship|requir(?:e|ing) (?:visa )?sponsorship[^.;]{0,80}not be considered)/i;
const VISA_YES_RE =
  /\b(?:we (?:do |can |will )?sponsor|sponsorship(?: and [a-z ]{0,30})?(?: is| are)? (?:available|offered|provided|supported|possible)|sponsorship:\s*(?:yes|available)|(?:will|can|able to|open to|happy to|willing to) (?:consider )?sponsor|consider sponsoring|(?:provide|provides|offer|offers) (?:visa |immigration )?sponsorship|sponsor (?:work )?visas|support for (?:relocation and )?visas)/i;

function visaFact(all: Sentence[]): PostingFact | undefined {
  let yes: string | undefined;
  let no: string | undefined;
  let hedge: string | undefined;
  for (const s of all) {
    if (!/sponsor/i.test(s.text) || !VISA_CONTEXT_RE.test(s.text)) continue;
    // Hedged first: "we aren't able to successfully sponsor every candidate" is
    // a caveat on a yes, and would otherwise read as a refusal.
    if (VISA_HEDGE_RE.test(s.text)) hedge ??= s.text;
    else if (VISA_NO_RE.test(s.text)) no ??= s.text;
    else if (VISA_YES_RE.test(s.text)) yes ??= s.text;
  }
  // A posting that says both is a template with a per-role switch we can't see.
  if (yes && no) return undefined;
  const make = (value: string, evidence: string): PostingFact => ({
    id: "visa",
    label: "Visa sponsorship",
    value,
    evidence,
  });
  if (no) return make("Not offered", no);
  if (yes) {
    // "Will consider sponsoring" is an open door, not a promise.
    if (/\bconsider\b/i.test(yes)) return make("Considered", yes);
    return make(hedge ? "Offered, case by case" : "Offered", yes);
  }
  // Only a caveat, no plain statement either way: all that can honestly be
  // said is that it isn't a given.
  if (hedge) return make("Not guaranteed", hedge);
  return undefined;
}

// --- Citizenship and clearance ----------------------------------------------------

function citizenshipFact(all: Sentence[]): PostingFact | undefined {
  for (const s of all) {
    const t = s.text;
    if (isPreferred(s)) continue;
    if (!/\b(must|required|requires?|eligib|only|need to be)\b/i.test(t)) continue;
    // Equal-opportunity boilerplate lists citizenship among protected traits.
    if (/\b(without regard|regardless of|protected|discriminat)/i.test(t)) continue;
    // "Should the position require… and Kodiak determines that a candidate's
    // U.S. person status necessitates an export licence…" describes a process,
    // not a condition of applying.
    if (/^(?:should|if)\b|\b(may (?:be )?requir|might requir|necessitate|determines? that)/i.test(t)) continue;
    const person = /\bu\.?s\.? person\b|green card|permanent resident/i.test(t);
    const citizen = /\bu\.?s\.? citizen(?:ship)?\b/i.test(t);
    if (!person && !citizen) continue;
    return {
      id: "citizenship",
      label: "Work eligibility",
      value: person ? "US citizen or permanent resident required" : "US citizenship required",
      evidence: t,
    };
  }
  return undefined;
}

const CLEARANCE_RE =
  /\b(?:(TS\/SCI|TS|top secret(?:\/SCI| SCI)?|secret|DV|SC)\s+)?(?:security\s+)?clearance\b|\b(TS\/SCI)\b/i;

function clearanceFact(all: Sentence[]): PostingFact | undefined {
  for (const s of all) {
    const m = CLEARANCE_RE.exec(s.text);
    if (!m) continue;
    // "customs clearance", "clearance of technical debt".
    if (!/\b(security|secret|ts\/sci|government|dod|sc clearance|dv clearance)\b/i.test(s.text)) continue;
    const levelRaw = (m[1] ?? m[2] ?? "").toLowerCase();
    const level = levelRaw.startsWith("ts") || levelRaw.startsWith("top")
      ? /sci/i.test(levelRaw) || /\bsci\b/i.test(s.text)
        ? "TS/SCI"
        : "Top Secret"
      : levelRaw === "secret"
        ? "Secret"
        : levelRaw
          ? levelRaw.toUpperCase()
          : "Security";
    const plus = isPreferred(s) || /\b(is a plus|a plus|preferred|advantage)\b/i.test(s.text);
    const eligible = /\b(obtain|eligib\w*|ability to|able to|willing(?:ness)? to)\b/i.test(s.text);
    const maybe = /\bmay (?:be )?requir/i.test(s.text);
    const value = maybe
      ? `May require ${level === "Security" ? "a security" : level} clearance`
      : plus && !eligible
      ? `${level} clearance a plus`
      : eligible
        ? `Must be able to obtain ${level === "Security" ? "a security" : level} clearance`
        : `${level === "Security" ? "Security" : level} clearance required`;
    return { id: "clearance", label: "Clearance", value, evidence: s.text };
  }
  return undefined;
}

// --- In-office expectation -----------------------------------------------------

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const NUM = "(\\d|one|two|three|four|five)";
const DAYS_PER_WEEK_RE = new RegExp(
  `\\b${NUM}(?:\\s*(?:-|–|to|or)\\s*${NUM})?\\s*\\+?\\s*days?\\s*(?:\\/|a|per|each)\\s*week\\b`,
  "i",
);
const DAYS_IN_OFFICE_RE = new RegExp(
  `\\b${NUM}(?:\\s*(?:-|–|to|or)\\s*${NUM})?\\s*\\+?\\s*days?\\s*(?:in|at|from)\\s*(?:the |our |an? )?office`,
  "i",
);
const OFFICE_CONTEXT_RE = /\b(office|on-?site|in[- ]person|hybrid|headquarters|\bHQ\b)/i;

function officeFact(all: Sentence[]): PostingFact | undefined {
  const toNum = (x: string) => WORD_NUM[x.toLowerCase()] ?? Number(x);
  for (const s of all) {
    const t = s.text;
    if (!OFFICE_CONTEXT_RE.test(t)) continue;
    const m = DAYS_IN_OFFICE_RE.exec(t) ?? DAYS_PER_WEEK_RE.exec(t);
    if (m) {
      // "2 days at home" in the same sentence as "3 days in the office": the
      // office regex is tried first, and a bare days-per-week figure next to
      // "home"/"remote" is the wrong half of the split.
      const near = t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
      if (!DAYS_IN_OFFICE_RE.test(t) && /\b(home|remote(?:ly)?)\b/i.test(near) && !/\boffice|on-?site|in[- ]person/i.test(near)) {
        continue;
      }
      const lo = toNum(m[1]!);
      const hi = m[2] ? toNum(m[2]) : undefined;
      if (lo < 1 || lo > 5) continue;
      const n = hi && hi > lo ? `${lo}–${hi}` : `${lo}`;
      return {
        id: "office",
        label: "In the office",
        value: `${n} day${n === "1" ? "" : "s"} a week`,
        evidence: t,
      };
    }
    const pct = /\b(\d{2})\s*% of the time\b/i.exec(t);
    if (pct && !/\btravel/i.test(t) && /\boffice/i.test(t)) {
      return { id: "office", label: "In the office", value: `${pct[1]}% of the time`, evidence: t };
    }
  }
  return undefined;
}

// --- Travel ---------------------------------------------------------------------

const TRAVEL_PCT_RE = /(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*%/;
const TRAVEL_REQUIRED_RE =
  /\b(?:(?:willing(?:ness)?|ability|able|open|excited|comfortable|expected|required|must be willing) to travel|travel (?:is |will be )?(?:required|expected)(?!\s*\(yes\/no\))|occasional travel|frequent travel|regular travel)\b/i;

function travelFact(all: Sentence[]): PostingFact | undefined {
  let soft: PostingFact | undefined;
  for (const s of all) {
    const t = s.text;
    if (!/\btravel/i.test(t)) continue;
    // The travel *industry*, and benefits that mention it.
    if (/\btravel (?:company|industry|advertis|assistance|insurance|stipend|tech|platform|booking|agen)/i.test(t)) continue;
    if (/\btravel limitations\b/i.test(t)) continue;
    const pct = TRAVEL_PCT_RE.exec(t);
    if (pct && /\btravel/i.test(t.slice(Math.max(0, pct.index - 90), pct.index + 60))) {
      const lo = Number(pct[1]);
      const hi = pct[2] ? Number(pct[2]) : undefined;
      if (lo <= 90) {
        const ceiling = /\b(up to|less than|no more than|max(?:imum)?|under)\b|[<≤]/i.test(
          t.slice(Math.max(0, pct.index - 25), pct.index),
        );
        const value =
          hi && hi > lo
            ? `${lo}–${hi}% of the time`
            : `${ceiling ? "Up to" : "About"} ${lo}% of the time`;
        return { id: "travel", label: "Travel", value, evidence: t };
      }
    }
    if (!soft && !isPreferred(s) && TRAVEL_REQUIRED_RE.test(t)) {
      const often = /\b(frequent|regular|extensive)\b/i.test(t);
      soft = {
        id: "travel",
        label: "Travel",
        value: often ? "Regular travel expected" : "Some travel expected",
        evidence: t,
      };
    }
  }
  return soft;
}

// --- Extra pay --------------------------------------------------------------------

// "Equity" is a compensation word and a diversity word, and adverts use both.
const EQUITY_RE = /\b(equity|stock options?|share options?|RSUs?|restricted stock|ESPP|employee stock)\b/i;
const EQUITY_NOT_PAY_RE =
  /\b(?:diversity|inclusion|belonging|pay|health|private|racial|gender|social|brand|growth)\W+(?:and\s+|&\s+)?equity\b|\bequity\W+(?:and\s+|&\s+|,\s*)?(?:inclusion|diversity|belonging|research|firms?|funds?|investors?|markets?|trading|derivatives)\b/i;
const BONUS_RE =
  /\b(?:(?:annual|performance|discretionary|target|yearly|company|cash|incentive|variable)\s+bonus|bonus (?:plan|program(?:me)?|eligib\w+|potential|target|scheme|opportunity)|eligible for (?:an? |the )?[^.;]{0,30}bonus)\b/i;
const SIGN_ON_RE = /\b(?:sign[- ]?on|signing)\s+(?:bonus|payments?)\b/i;

function extrasFact(all: Sentence[]): PostingFact | undefined {
  const found = new Map<string, string>();
  for (const s of all) {
    const t = s.text;
    // "This role may be eligible for bonus, equity and/or commission" is a
    // company-wide template that says nothing about this role.
    if (/\bmay (?:be eligible|include|also include|be offered|be provided)\b/i.test(t)) continue;
    if (!found.has("Equity") && EQUITY_RE.test(t) && !EQUITY_NOT_PAY_RE.test(t)) found.set("Equity", t);
    if (!found.has("Bonus") && BONUS_RE.test(t) && !/\breferral bonus\b/i.test(t)) found.set("Bonus", t);
    if (!found.has("Sign-on bonus") && SIGN_ON_RE.test(t)) found.set("Sign-on bonus", t);
  }
  if (found.size === 0) return undefined;
  const order = ["Equity", "Bonus", "Sign-on bonus"].filter((k) => found.has(k));
  return {
    id: "extras",
    label: "Extra pay",
    value: order.join(" · "),
    evidence: found.get(order[0]!)!,
  };
}

// --- Relocation, on-call, languages ---------------------------------------------------

const RELOCATION_YES_RE =
  /\b(?:relocation (?:assistance|support|package|stipend|bonus|benefits?|allowance|reimbursement)|relocation (?:is )?(?:provided|supported|available|offered)|(?:offer|offers|provide|provides) relocation|support for relocation)\b/i;
const RELOCATION_NO_RE =
  /\b(?:no relocation|relocation (?:is |assistance is |support is )?not (?:offered|provided|available)|not eligible for relocation|without relocation)\b/i;

function relocationFact(all: Sentence[]): PostingFact | undefined {
  let yes: string | undefined;
  let no: string | undefined;
  for (const s of all) {
    const t = s.text;
    if (!/\brelocat/i.test(t)) continue;
    if (RELOCATION_NO_RE.test(t)) no ??= t;
    // "Benefits may include relocation…" is a company-wide template, not an
    // offer on this role.
    else if (RELOCATION_YES_RE.test(t) && !/\bmay (?:be|include)\b|\bdepend/i.test(t)) yes ??= t;
  }
  if (yes && no) return undefined;
  if (no) return { id: "relocation", label: "Relocation", value: "Not offered", evidence: no };
  if (yes) return { id: "relocation", label: "Relocation", value: "Support offered", evidence: yes };
  return undefined;
}

const ONCALL_RE =
  /\bon[- ]call (?:rotations?|rota|shifts?|duty|duties|schedule|escalation|support|responsibilit\w+)|\bparticipat\w+ in (?:the |an? |our )?(?:team(?:'|’)?s? )?on[- ]call\b|\bon[- ]call for (?:the |what |your |services|systems)/i;

function oncallFact(all: Sentence[]): PostingFact | undefined {
  for (const s of all) {
    if (!ONCALL_RE.test(s.text)) continue;
    if (/\bno on[- ]call\b/i.test(s.text)) {
      return { id: "oncall", label: "On-call", value: "No on-call", evidence: s.text };
    }
    return { id: "oncall", label: "On-call", value: "Part of the rotation", evidence: s.text };
  }
  return undefined;
}

const LANGS =
  "German|French|Japanese|Spanish|Mandarin|Chinese|Korean|Portuguese|Italian|Dutch|Hebrew|Arabic|Hindi|Polish|Swedish|Danish|Norwegian|Finnish|Turkish|Czech|Cantonese";
const LANG_RE = new RegExp(
  `\\b(?:fluen(?:t|cy)|proficien(?:t|cy)|native|business[- ]level|professional(?: working)?)\\s+(?:level\\s+)?(?:in\\s+|of\\s+)?(?:both\\s+)?(?:written and spoken\\s+|spoken and written\\s+)?((?:English|${LANGS})(?:(?:\\s*(?:,|and|&|or|\\/)\\s*)(?:English|${LANGS}))*)|\\b(${LANGS})(?:[- ]speaking| language)? (?:fluency|proficiency|skills|speaker)\\b`,
  "i",
);

function languagesFact(all: Sentence[]): PostingFact | undefined {
  for (const s of all) {
    const m = LANG_RE.exec(s.text);
    if (!m) continue;
    const names = [...new Set((m[1] ?? m[2] ?? "").match(new RegExp(`English|${LANGS}`, "gi")) ?? [])].map(
      (n) => n[0]!.toUpperCase() + n.slice(1).toLowerCase(),
    );
    // English on its own is the default on an English-language posting — only
    // worth a row alongside a language that actually narrows the field.
    if (!names.some((n) => n !== "English")) continue;
    const suffix = isPreferred(s) || /\b(a plus|preferred|nice to have|bonus)\b/i.test(s.text) ? " (a plus)" : "";
    return {
      id: "languages",
      label: "Languages",
      value: names.join(", ") + suffix,
      evidence: s.text,
    };
  }
  return undefined;
}

/** Everything the rules can read out of one description, in display order. */
export function postingFacts(descriptionText: string | undefined): PostingFacts {
  if (!descriptionText) return { facts: [] };
  const all = sentences(descriptionText);
  const experience = experienceFact(all);
  const education = educationFact(all);
  const facts = [
    experience.fact,
    education.fact,
    visaFact(all),
    citizenshipFact(all),
    clearanceFact(all),
    officeFact(all),
    travelFact(all),
    extrasFact(all),
    relocationFact(all),
    oncallFact(all),
    languagesFact(all),
  ].filter((f): f is PostingFact => f !== undefined);
  return {
    facts,
    ...(experience.minYears !== undefined ? { minYears: experience.minYears } : {}),
    ...(education.requiredDegree ? { requiredDegree: education.requiredDegree } : {}),
    ...(education.requiredDegree && education.equivalent ? { experienceInPlaceOfEducation: true } : {}),
  };
}
