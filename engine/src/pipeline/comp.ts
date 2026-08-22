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
  // Strip 401(k) plan references before number extraction — a bare "401k"
  // would otherwise parse as $401,000.
  const t = text.replace(/,/g, "").replace(/\b401\s*\(?k\)?\b/gi, "");

  // No default. `ingest.ts` states the rule this has to keep: "an unlabelled
  // number isn't a salary… feeds that omit the currency are usually the non-USD
  // ones (a Graphcore posting shipped a bare 260400-352200, which is PLN —
  // ~$70k shown as $260k). Drop the pay rather than guess at it."
  //
  // Defaulting to USD here quietly opted this path out of that rule, and
  // pay()'s `&& src.salaryCurrency` guard could never fire for it. "CHF
  // 150,000" and "₹4,000,000" were stored as USD; so was "CA$120,000", because
  // the bare `$` test matched it.
  //
  // The dollar variants are tested before plain `$` for the same reason.
  const currency = /£|\bgbp\b/i.test(t)
    ? "GBP"
    : /€|\beur\b/i.test(t)
      ? "EUR"
      : /CA\$|\bcad\b/i.test(t)
        ? "CAD"
        : /A\$|\baud\b/i.test(t)
          ? "AUD"
          : /NZ\$|\bnzd\b/i.test(t)
            ? "NZD"
            : /S\$|\bsgd\b/i.test(t)
              ? "SGD"
              : /HK\$|\bhkd\b/i.test(t)
                ? "HKD"
                : /R\$|\bbrl\b/i.test(t)
                  ? "BRL"
                  : /\bchf\b/i.test(t)
                    ? "CHF"
                    : /₹|\binr\b/i.test(t)
                      ? "INR"
                      : /¥|\bjpy\b/i.test(t)
                        ? "JPY"
                        : /\bpln\b/i.test(t)
                          ? "PLN"
                          : /\$|\busd\b/i.test(t)
                            ? "USD"
                            : null;
  if (!currency) return null;

  // Detect the pay period first — it decides which figures are plausible
  // (an hourly rate like "$45 – $55 per hour" is well under 1000).
  let period: SalaryPeriod = "year";
  if (/\b(hour|hourly|\/\s*hr|per hour)\b/i.test(t)) period = "hour";
  else if (/\b(month|monthly|\/\s*mo)\b/i.test(t)) period = "month";
  else if (/\b(day|daily|\/\s*day)\b/i.test(t)) period = "day";

  // Numbers, optionally with a K/M suffix.
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([kKmM])?/g)].map((m) => scale(m[1], m[2]));
  return withinBounds(nums, currency, period);
}

/** "165" + "K" → 165000. */
function scale(digits: string, suffix?: string): number {
  const n = parseFloat(digits);
  const s = suffix?.toLowerCase();
  return s === "k" ? n * 1_000 : s === "m" ? n * 1_000_000 : n;
}

// Plausible bounds per period; figures outside are plan refs / noise.
const BOUNDS: Record<SalaryPeriod, [number, number]> = {
  year: [10_000, 5_000_000],
  month: [1_000, 200_000],
  day: [100, 20_000],
  hour: [10, 1_500],
};

/** Narrow a set of candidate figures to a range, or null if none are plausible. */
function withinBounds(
  nums: number[],
  currency: string,
  period: SalaryPeriod,
): ParsedSalary | null {
  const [lo, hi] = BOUNDS[period];
  const ok = nums.filter((n) => n >= lo && n <= hi);
  if (ok.length === 0) return null;
  const min = Math.min(...ok);
  const max = Math.max(...ok);
  return {
    salaryMin: min,
    salaryMax: max === min ? undefined : max,
    salaryCurrency: currency,
    salaryPeriod: period,
  };
}

/** Phrases that mark the start of a stretch of text about pay. */
const PAY_CONTEXT_RE =
  /\b(?:salary|salaries|compensation|base pay|pay range|pay scale|pay band|hiring range|expected pay|target pay|remuneration)\b/gi;

/** How far past a pay keyword to keep looking for figures. Cisco-style Workday
 *  posts put the range four lines below "salary ranges … are listed below:". */
const PAY_WINDOW_CHARS = 400;

/**
 * What marks a number in a description as an amount of money.
 *
 * The optional letters in front of the symbol are what let the *second* bound
 * of "CA$120,000 - CA$150,000" be recognised. Without them the range pattern
 * matched `$120000`, then needed a digit where the "C" of the closing `CA$`
 * was, backtracked, found no second bound, and fell through to the lone-figure
 * path — which sees two amounts and gives up. The whole band was dropped, so
 * every Canadian advert that labelled its currency *correctly* published no pay
 * at all. Which spelling it is, is detectCurrency's job; this only decides that
 * the digits beside it are money.
 */
const MONEY = "(?:(?:CA|NZ|HK|US|A|S|R)?[$£€]|\\b(?:USD|GBP|EUR|CAD|AUD|NZD|SGD|HKD|BRL)\\s*)";
const FIGURE = "\\s?(\\d+(?:\\.\\d+)?)\\s*([kKmM])?";

/** Only figures carrying a currency marker count — see parseSalaryFromDescription. */
const CURRENCY_AMOUNT_RE = new RegExp(`${MONEY}${FIGURE}`, "g");

/** Two currency figures joined by a dash or "to" — an explicitly stated band. */
const CURRENCY_RANGE_RE = new RegExp(
  `${MONEY}${FIGURE}\\s*(?:-|–|—|\\bto\\b)\\s*${MONEY}?${FIGURE}`,
);

/**
 * A stricter period detector than parseSalaryText's. Over 400 characters of
 * description, a bare "day" matches "from day one" and a bare "month" matches
 * "in your first month" — either would drag an annual range into the wrong
 * bounds. Requires the figure to be explicitly rated per unit.
 */
function ratedPeriod(t: string): SalaryPeriod {
  if (/\bper\s+hour\b|\bhourly\b|\/\s*hr\b/i.test(t)) return "hour";
  if (/\bper\s+month\b|\bmonthly\b|\/\s*mo\b/i.test(t)) return "month";
  if (/\bper\s+day\b|\bdaily\b|\/\s*day\b/i.test(t)) return "day";
  return "year";
}

/**
 * Salary stated in the body of a description — the fallback, used whenever the
 * feed itself is silent on pay. US pay-transparency law
 * makes this common on Workday/Greenhouse posts ("The applicable full salary
 * ranges for this position … $199,700.00 - $292,800.00"), and missing it puts
 * "Not published" on a page that visibly publishes a range.
 *
 * Deliberately narrow, because a description is mostly *not* about pay. It only
 * reads a window following an explicit pay keyword; only counts figures
 * carrying a currency marker (bare numbers are far more often headcounts,
 * years, percentages or funding rounds); and takes an explicitly *stated* band
 * rather than pooling every figure it finds. Pooling was tried first and merged
 * unrelated amounts — a relocation bonus and a top-of-band salary in the same
 * window produced "$23,000–$336,000".
 *
 * `country` is the ISO-2 the location pipeline derived for the role, and it is
 * consulted for one thing only: deciding which dollar a bare `$` is. See
 * BARE_DOLLAR_BY_COUNTRY.
 */
export function parseSalaryFromDescription(
  text?: string | null,
  country?: string | null,
): ParsedSalary | null {
  if (!text) return null;
  const clean = text.replace(/,/g, "").replace(/\b401\s*\(?k\)?\b/gi, "");
  // A post can say "competitive salary" long before it states a range, so try
  // every pay keyword and keep the first window that yields plausible figures.
  for (const kw of clean.matchAll(PAY_CONTEXT_RE)) {
    const window = clean.slice(kw.index, kw.index + PAY_WINDOW_CHARS);
    const currency = detectCurrency(window, country);
    if (!currency) continue; // two currencies in one window — see detectCurrency
    const period = ratedPeriod(window);

    const range = CURRENCY_RANGE_RE.exec(window);
    if (range) {
      const parsed = withinBounds(
        [scale(range[1], range[2]), scale(range[3], range[4])],
        currency,
        period,
      );
      // Some employers publish one template band across every level and
      // location (Anduril posts "$23,000 — $336,000" under "Salary Range").
      // It's genuinely what they wrote, but a 15× span tells a reader nothing,
      // so treat it as unpriced rather than print it as a salary.
      if (parsed && !isImplausiblySpanned(parsed)) return parsed;
      continue;
    }

    // No stated band. A lone figure ("The base salary for this role is
    // $180,000") is usable, but only when it's unambiguous — if the window
    // holds several amounts we can't tell which one is the wage.
    const amounts = [...window.matchAll(CURRENCY_AMOUNT_RE)];
    if (amounts.length !== 1) continue;
    const parsed = withinBounds([scale(amounts[0][1], amounts[0][2])], currency, period);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * What a bare `$` means, per country, where the local currency is *also*
 * written with a plain dollar sign.
 *
 * Only these. A `$` in a British, French or German advert is a deliberate USD
 * quote — those markets write £ and €, so the symbol carries information — and
 * on the live board those roles (Perplexity in London, OpenAI in Paris, Cohere
 * in the UK) really are quoted in dollars. A `$` in a Canadian or Singaporean
 * advert carries none: it is the local convention, and reading it as USD is how
 * 42 Canadian and 4 Singaporean roles came to be published ~38% over their real
 * value, on the cards, in the /stats medians and in the JobPosting baseSalary.
 */
const BARE_DOLLAR_BY_COUNTRY: Record<string, string> = {
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  SG: "SGD",
  HK: "HKD",
};

/**
 * The currency a role's own country would quote in — the tie-break when an
 * advert names more than one. Wider than BARE_DOLLAR_BY_COUNTRY on purpose:
 * that one answers "which dollar", this one answers "which of the currencies
 * this advert actually mentions is the local one".
 *
 * Only the currencies this parser can emit at all. A country absent here has no
 * vote, which is the safe default.
 */
const LOCAL_CURRENCY: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  SG: "SGD",
  HK: "HKD",
  BR: "BRL",
  // The euro area, as it appears on this board.
  AT: "EUR", BE: "EUR", DE: "EUR", EE: "EUR", ES: "EUR", FI: "EUR", FR: "EUR",
  GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR", LT: "EUR", LV: "EUR", LU: "EUR",
  MT: "EUR", NL: "EUR", PT: "EUR", SI: "EUR", SK: "EUR", CY: "EUR",
};

/**
 * Currencies a pay window names outright.
 *
 * Two traps are baked into these patterns. The word boundaries: `/€|eur/i`
 * without one matched "Europe", which is how a San Francisco role and a Black
 * Forest Labs advert that literally says "$180,000 USD" both came to be
 * labelled EUR. And the lookbehinds: `A$` occurs inside `CA$` and `S$` inside
 * `US$`, so without them Docker's "Canada: CA$243,250" reads as *two*
 * currencies at once and the advert is discarded as ambiguous.
 *
 * The bare `$` is deliberately not on this list — it names nothing.
 */
const EXPLICIT_CURRENCIES: [RegExp, string][] = [
  [/£|\bgbp\b/i, "GBP"],
  [/€|\beur\b/i, "EUR"],
  [/(?<![A-Za-z])CA\$|\bcad\b/i, "CAD"],
  [/(?<![A-Za-z])A\$|\baud\b/i, "AUD"],
  [/(?<![A-Za-z])NZ\$|\bnzd\b/i, "NZD"],
  [/(?<![A-Za-z])S\$|\bsgd\b/i, "SGD"],
  [/(?<![A-Za-z])HK\$|\bhkd\b/i, "HKD"],
  [/(?<![A-Za-z])R\$|\bbrl\b/i, "BRL"],
  [/(?<![A-Za-z])US\$|\busd\b/i, "USD"],
];

/**
 * The currency a pay window is quoted in, or null when it can't be told.
 *
 * In order:
 *
 *  - Exactly one currency named outright: that one, whatever the country says.
 *    Serve Robotics writes "Canada - ALL: $177k - $215k CAD" on a US-located
 *    posting and means it.
 *  - Several named, one of which is the role's own: that one. These adverts are
 *    common and they quote the local band first, which is also the band the
 *    range pattern grabs — EnCharge's "$180,000 to $240,000 USD ($175,000 to
 *    $245,000 CAD)" on a US role is 180–240k USD.
 *  - Several named, none of them local: **null**. Whichever currency won an
 *    arbitrary ordering, the figures would belong to the other one about half
 *    the time. A wrong salary is worse than no salary — the same call
 *    location.ts makes about a wrong city — so the window is abandoned and the
 *    loop tries the next one.
 *  - Nothing but a bare `$`: the country decides, per BARE_DOLLAR_BY_COUNTRY,
 *    falling back to USD.
 */
function detectCurrency(t: string, country?: string | null): string | null {
  const local = country ? LOCAL_CURRENCY[country.toUpperCase()] : undefined;
  const named = EXPLICIT_CURRENCIES.filter(([re]) => re.test(t)).map(([, code]) => code);
  if (named.length === 1) return named[0]!;
  if (named.length > 1) return local && named.includes(local) ? local : null;
  return (country && BARE_DOLLAR_BY_COUNTRY[country.toUpperCase()]) || "USD";
}

/**
 * Widest top-to-bottom ratio a stated band can have and still mean something.
 * Genuine multi-level bands reach ~3–4× (Cohere posts $110k–$370k); past 6×
 * it's a template covering every level the company hires at.
 */
const MAX_RANGE_SPAN = 6;

function isImplausiblySpanned(s: ParsedSalary): boolean {
  return Boolean(s.salaryMin && s.salaryMax && s.salaryMax / s.salaryMin > MAX_RANGE_SPAN);
}
