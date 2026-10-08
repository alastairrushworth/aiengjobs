// City-name canonicalization, shared by the engine (ingest + export) and the
// site (location landing pages).
//
// Two reasons this has to be strict rather than cosmetic:
//   1. `city` becomes `addressLocality` in the JobPosting structured data, so a
//      junk value ("null", "Headquarters", "USA") is a wrong fact published to
//      Google, not just an ugly string.
//   2. Location landing pages are keyed on the canonical name, so "New York" /
//      "New York City" / "New York Office" splitting three ways both fragments
//      the pages and understates every count on them.

/**
 * Country, multi-country region and first-level subdivision names that feeds —
 * and the LLM extractor — routinely drop into the city slot. Never a city.
 *
 * Canadian and Australian subdivisions sit alongside the US states because the
 * enterprise feeds write them the same way: "Ontario, CAN", "Remote, Ontario,
 * Canada", "Alberta; British Columbia; Manitoba; …". Seven live roles carried
 * one of those as their addressLocality.
 *
 * The last line are countries that only reached the board once location.ts
 * learned to place them; "Costa Rica" and "Uruguay" had each been published as
 * a city in their own right. "Georgia" is a US state and a country and never a
 * city, and it had become one twice over: Equifax's "USA - Georgia - Alpharetta"
 * and Salesforce's "Georgia - Atlanta" both stored the city Georgia.
 *
 * Note which names are *missing*, and keep them missing. "Washington" is not
 * here because Washington DC is a city; "Victoria" and "New Brunswick" are not
 * here because both name real cities elsewhere and neither has ever appeared in
 * the city slot on this board. A subdivision only earns a place once it is
 * demonstrably being used as one.
 */
export const NON_CITY: ReadonlySet<string> = new Set(
  `united states,usa,us,u.s.,u.s.a.,united kingdom,uk,u.k.,england,scotland,wales,
   canada,germany,france,netherlands,ireland,india,australia,japan,korea,south korea,
   china,taiwan,switzerland,sweden,spain,italy,poland,portugal,brazil,mexico,
   united arab emirates,uae,israel,austria,belgium,denmark,norway,finland,
   czech republic,czechia,greece,romania,hungary,new zealand,south africa,argentina,
   colombia,chile,turkey,türkiye,vietnam,thailand,indonesia,philippines,malaysia,
   estonia,ukraine,serbia,croatia,bulgaria,slovakia,slovenia,lithuania,latvia,
   nigeria,kenya,egypt,saudi arabia,pakistan,cyprus,malta,luxembourg,iceland,
   europe,emea,apac,latam,namer,noram,north america,south america,americas,asia,
   asia pacific,africa,oceania,worldwide,international,global,anywhere,
   amer,amers,nam,eu,eea,uki,anz,mena,dach,benelux,nordics,apj,japac,sea,
   remote,fully remote,distributed,
   alabama,alaska,arizona,arkansas,california,colorado,connecticut,delaware,florida,
   hawaii,idaho,illinois,indiana,iowa,kansas,kentucky,louisiana,maine,maryland,
   massachusetts,michigan,minnesota,mississippi,missouri,montana,nebraska,nevada,
   new hampshire,new jersey,new mexico,new york state,north carolina,north dakota,
   ohio,oklahoma,oregon,pennsylvania,rhode island,south carolina,south dakota,
   tennessee,texas,utah,vermont,virginia,west virginia,wisconsin,wyoming,
   ontario,quebec,québec,british columbia,alberta,manitoba,saskatchewan,
   nova scotia,newfoundland and labrador,prince edward island,
   yukon,nunavut,northwest territories,
   new south wales,queensland,western australia,south australia,
   tasmania,australian capital territory,northern territory,
   maharashtra,karnataka,haryana,tamil nadu,telangana,gujarat,west bengal,
   uttar pradesh,republic of ireland,
   kazakhstan,azerbaijan,qatar,oman,algeria,ecuador,peru,uruguay,costa rica,
   georgia`
    .split(",")
    .map((s) => s.trim().toLowerCase()),
);

/**
 * Subdivisions that are also, on their own, a city on this board — so they
 * cannot go in NON_CITY, but still need peeling off the end of "Jersey City
 * New Jersey United States" and "New York New York United States". Only ever
 * consulted for a trailing run with something in front of it (see
 * stripTrailingRegions), so "New York" alone is untouched.
 */
const TRAILING_ONLY_REGION: ReadonlySet<string> = new Set(["new york", "washington"]);

/**
 * Peel country and subdivision names off the end of a city string.
 *
 * Workday feeds write "Pune Maharashtra India" and "Irving Texas United
 * States" — City State Country with every separator dropped — and each such
 * value became its own city, its own landing page (/ai-jobs-pune-maharashtra-
 * india/ beside /ai-jobs-pune/) and its own addressLocality. Longest suffix
 * first, so "United States" is taken as one name and never leaves "United"
 * behind; and a suffix is only removed while at least one word would remain,
 * so a bare country still reaches the NON_CITY check and is rejected there.
 */
function stripTrailingRegions(s: string): string {
  let words = s.split(/\s+/);
  for (;;) {
    let stripped = false;
    for (const n of [3, 2, 1]) {
      if (words.length <= n) continue;
      const tail = words.slice(-n).join(" ").toLowerCase();
      if (NON_CITY.has(tail) || TRAILING_ONLY_REGION.has(tail)) {
        words = words.slice(0, -n);
        stripped = true;
        break;
      }
    }
    if (!stripped) return words.join(" ");
  }
}

/**
 * Multi-country regions that feeds put in the location slot ("EMEA", "AMER",
 * "Europe"). They name a hiring territory, not a workplace, so a role located
 * only there isn't on-site anywhere — see parseLocation. Deliberately excludes
 * single countries and US states, which are real (if coarse) onsite locations.
 */
export const MULTI_COUNTRY_REGION: ReadonlySet<string> = new Set(
  `europe,emea,apac,latam,namer,noram,north america,south america,americas,asia,
   asia pacific,africa,oceania,worldwide,international,global,anywhere,
   amer,amers,nam,eu,eea,uki,anz,mena,dach,benelux,nordics,apj,japac`
    .split(",")
    .map((s) => s.trim().toLowerCase()),
);

// Placeholders that mean "we don't know". The literal strings "null"/"undefined"
// show up because the LLM extractor stringifies a missing value.
const PLACEHOLDER = new Set([
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "-",
  "--",
  "tbd",
  "unknown",
  "various",
  "multiple",
  "multiple locations",
  "headquarters",
  "hq",
  "head office",
  "home office",
  "remote",
  "hybrid",
  "onsite",
  "on-site",
  "field",
  "virtual",
  // Observed in the live snapshot reaching `city`, and from there into
  // <title> ("· Any location") and the job page's Location fact. Two of them
  // also collided a pair of pages onto one title, because jobTitle.ts
  // disambiguates on city and these are the same non-answer for both.
  "any location",
  "in-office",
  "office",
  "main office",
  // "Main (Hybrid)" reduces to "Main" once the parenthetical is stripped.
  // Frankfurt am Main is unaffected — it keys on the whole string.
  "main",
  "remote office",
  "us and canada offices",
  "home or",
  "home",
  "flexible",
  "anywhere",
]);

// Deliberate merges. Values are the display form; keys are lowercased.
// Metro-area strings collapse onto their principal city — "Bay Area" as an
// addressLocality is meaningless to Google, whereas "San Francisco" is both true
// enough and what people actually search for.
const ALIASES: Record<string, string> = {
  "new york city": "New York",
  nyc: "New York",
  ny: "New York",
  "new york, ny": "New York",
  manhattan: "New York",
  "bay area": "San Francisco",
  "sf bay area": "San Francisco",
  "san francisco bay area": "San Francisco",
  sf: "San Francisco",
  "south san francisco": "San Francisco",
  bengaluru: "Bangalore",
  gurugram: "Gurgaon",
  "washington dc": "Washington",
  "washington d.c.": "Washington",
  "washington, dc": "Washington",
  "washington, d.c.": "Washington",
  zürich: "Zurich",
  münchen: "Munich",
  köln: "Cologne",
  montréal: "Montreal",
  "kraków": "Krakow",
  "tel aviv-yafo": "Tel Aviv",
  "tel-aviv": "Tel Aviv",
  bombay: "Mumbai",
  "st. louis": "Saint Louis",
  "greater london": "London",
  "central london": "London",
  // Airport and business-park shorthands feeds use in place of the city, and
  // the local-script name of one. Each was reaching addressLocality verbatim:
  // "Tlv" on five roles, "Rtp" on three, "新北市" on one.
  tlv: "Tel Aviv",
  rtp: "Research Triangle Park",
  新北市: "New Taipei",
  // Districts and business parks written where the city should be. Each named
  // the city on its own (RELX "Farringdon" x6, Barclays "Canary Wharf, 1
  // Churchill Place" x3, WeRide "One-north"), so the role had no country and
  // published no JobPosting. "Shanghai_Tianshan" is RELX's City_Site code; the
  // underscore can't be split generally because "SAN-Santa_Fe" uses it for a
  // space.
  farringdon: "London",
  "canary wharf": "London",
  "one-north": "Singapore",
  shanghai_tianshan: "Shanghai",
};

// Country / region prefixes feeds bolt on: "India - Bangalore", "UK - London".
const PREFIX_WORDS =
  "us|usa|u\\.s\\.|uk|u\\.k\\.|india|canada|germany|france|ireland|japan|china|" +
  "singapore|australia|netherlands|spain|italy|poland|brazil|mexico|israel|" +
  "switzerland|sweden|emea|apac|amer|namer|latam|europe|remote";

/**
 * Abbreviations that open a real place name. They look exactly like the ISO
 * codes the loop below strips — "ST. LOUIS" is `[A-Z]{2}` then a dot — so
 * without this they'd be eaten and "Saint Louis" would become "Louis".
 */
const PLACE_ABBREV: ReadonlySet<string> = new Set(["st", "ste", "mt", "mtn", "ft", "pt", "sta"]);

/**
 * A named building left where a city should be: "Divyasree Technopolis",
 * "London The Stanley Building". Rejected rather than salvaged — picking which
 * leading word is the city is how "Cape Town Building" becomes "Cape". The
 * role keeps its country, so it still gets a JobPosting; it just doesn't claim
 * a locality we'd be making up.
 *
 * "area" is here for "Bengaluru-EPIP Industrial Area". The metro-area strings
 * that also end in it ("Bay Area", "San Francisco Bay Area") never reach this
 * test — they're resolved by the alias table on the way in.
 */
const BUILDING_TAIL = /^(?:building|towers?[a-z0-9]*|plaza|technopolis|campus|area)$/i;

/**
 * ISO-3166 alpha-3 codes for the countries this board sees, as the *only*
 * three-letter tokens that are never a city.
 *
 * A blanket "three letters isn't a city" rule would be wrong — Ulm is on the
 * board — so the exclusion has to be a closed list, exactly like the state and
 * province names above. These arrive when an enterprise feed writes
 * "CAN - Ontario - Toronto" or "IND - NonGBS-Pune-Kharadi" and the code is the
 * only thing that survives the strip. Mapped to ISO alpha-2 because
 * location.ts also reads them as the country they spell ("Ontario, CAN").
 */
export const COUNTRY_ALPHA3: Readonly<Record<string, string>> = Object.fromEntries(
  `usa:US,can:CA,gbr:GB,irl:IE,deu:DE,fra:FR,nld:NL,esp:ES,ita:IT,prt:PT,pol:PL,
   che:CH,aut:AT,bel:BE,dnk:DK,nor:NO,swe:SE,fin:FI,cze:CZ,grc:GR,rou:RO,hun:HU,
   bgr:BG,hrv:HR,srb:RS,svk:SK,svn:SI,ltu:LT,lva:LV,est:EE,ukr:UA,tur:TR,isr:IL,
   are:AE,sau:SA,egy:EG,zaf:ZA,nga:NG,ken:KE,ind:IN,pak:PK,chn:CN,hkg:HK,twn:TW,
   jpn:JP,kor:KR,sgp:SG,mys:MY,tha:TH,vnm:VN,idn:ID,phl:PH,aus:AU,nzl:NZ,bra:BR,
   mex:MX,arg:AR,col:CO,chl:CL,per:PE,ury:UY`
    .split(",")
    .map((p) => p.trim().split(":") as [string, string]),
);

/**
 * A lowercase letter run straight into two or more capitals — "NonGBS". That is
 * an acronym glued onto a word, which is how in-house tags are spelled and how
 * no place name is: the mixed-case names that do occur ("McLean", "DeKalb",
 * "LaGrange") put a single capital after the lowercase. On the 2026-10-08
 * snapshot exactly one stored city and one location string matched it, both
 * "NonGBS". Rejecting it outright, not just skipping it, is what lets relocate
 * repair the stored value: a city the current rules reject is replaced.
 */
const INTERNAL_TAG = /\p{Ll}\p{Lu}{2,}/u;

const stripDiacritics = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "");

/** Title-case a token run, preserving intentional mixed case (McLean, DeKalb). */
function titleCase(s: string): string {
  // Only reshape strings that carry no case signal of their own — ALL CAPS or
  // all lowercase. Anything mixed is assumed already correct.
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'/])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Clean an ATS/LLM-supplied city string down to a canonical city name, or
 * `undefined` when the value isn't a city at all.
 */
export function canonicalCity(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;

  // Decoration an ATS bolted on the front: "*hq", "•London".
  s = s.replace(/^[*#•·]+\s*/, "").trim();

  // Resolve the whole string before any stripping touches it. Two reasons:
  // "ST. LOUIS" would have its "ST." read as a location code by the loop
  // below, and "In-Office" would have its "-Office" read as site detail and
  // come back as "In" — both are answered outright by the tables.
  const early = ALIASES[s.toLowerCase()];
  if (early) return early;
  if (PLACEHOLDER.has(s.toLowerCase())) return undefined;

  // "Chicago; New York" / "London | Paris" / "SF or NYC" / "London & San
  // Francisco" / "United States and Canada" → the first one wins. Hyphens are
  // NOT separators: "Kitchener-Waterloo" is one place.
  s = s.split(/[;|&]|\s\/\s|\s+(?:or|and)\s+/i)[0]!.trim();

  s = s.replace(new RegExp(`^(?:${PREFIX_WORDS})\\s*[-–—:]\\s*`, "i"), "");

  // Leading location codes, however many are stacked and whatever separates
  // them: "US-CA-Menlo Park", "IND-Bangalore-TowerE", "USA.VA.Reston",
  // "IND:AP:Hyderabad", "NLD Amsterdam", "GA Atlanta 1050 …". Workday and
  // Oracle feeds emit COUNTRY-REGION-SITE codes and the city is somewhere in
  // the middle, so this loops rather than matching one fixed shape.
  //
  // Two guards: a code that is itself a known city stays put ("SF Office" —
  // stripping it threw the city away and left the building word behind), and
  // PLACE_ABBREV covers the ones that open a real name.
  let strippedCode = false;
  for (;;) {
    const m = s.match(/^([A-Z]{2,3})(?:\s*[-.:]\s*|\s+(?=\p{Lu}\p{Ll}))/u);
    if (!m) break;
    const code = m[1]!.toLowerCase();
    if (ALIASES[code] || PLACE_ABBREV.has(code)) break;
    s = s.slice(m[0].length).trim();
    strippedCode = true;
  }

  // What follows a location code is "City-Site": "Bangalore-TowerE",
  // "Taguig City-CitiPlaza", "Sydney-Blue-Street", "Pune-Equifax Analytics-PEC".
  // Gated on having actually stripped a code, because that's the only signal
  // that separates a structured feed value from a genuine hyphenated name —
  // "Kitchener-Waterloo" and "Tel Aviv-Yafo" never reach this line.
  //
  // The city is the first part that isn't an internal business-unit tag:
  // Smith+Nephew writes "IND - NonGBS-Pune-Kharadi", and taking the first part
  // published "NonGBS" as the city. A lowercase letter followed by a run of
  // capitals is the tag's shape (see INTERNAL_TAG) and no city's.
  if (strippedCode && s.includes("-")) {
    const parts = s.split("-").map((p) => p.trim());
    s = parts.find((p) => !INTERNAL_TAG.test(p)) ?? parts[0]!;
  }

  // Trailing building/site detail: "London - The River Building HQ",
  // "Hyderabad - Phoenix Equinox Tower 2". Spaced hyphen only, so
  // "Kitchener-Waterloo" survives.
  s = s.split(/\s[-–—]\s/)[0]!.trim();

  // Parentheticals and street addresses: "Freiburg (Germany)", "Atlanta 1050 Techwood Drive".
  s = s
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+\d{2,}\s+.*$/, "")
    // A Workday site number after an otherwise clean name: "BANGALORE 05",
    // "PUNE 05", "CORK 01" — Cadence roles whose city the digit check below
    // threw away. Exactly two digits closing an all-capitals, letters-only
    // name (the site-code convention), so "DLF CYBERCITY 12B" and street
    // numbers are still rejected there.
    .replace(/^(\p{Lu}[\p{Lu}\s.'’-]*?)\s+\d{2}$/u, "$1")
    // Trailing site word, however it's attached: "New York Office",
    // "Bengaluru-HQ", "Montreal-HQ". The hyphen form arrives without a space,
    // so the spaced-hyphen split above never sees it.
    .replace(/(?:[,\-–—]\s*|\s+)(office|campus|site|hq|head\s?office|headquarters)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!s) return undefined;

  const key = s.toLowerCase();
  if (PLACEHOLDER.has(key)) return undefined;

  // A building name where a city should be — see BUILDING_TAIL.
  if (BUILDING_TAIL.test(s.split(/\s+/).pop()!)) return undefined;

  const aliased = ALIASES[key];
  if (aliased) return aliased;

  if (NON_CITY.has(key)) return undefined;

  // "Pune Maharashtra India" → "Pune". After the whole-string checks, so a
  // value that IS a country or state has already been rejected outright.
  s = stripTrailingRegions(s);
  if (NON_CITY.has(s.toLowerCase())) return undefined;

  // Anything still carrying digits, or absurdly long, isn't a city name.
  if (/\d/.test(s) || s.length > 40) return undefined;
  if (INTERNAL_TAG.test(s)) return undefined;

  // Short leftovers that are codes rather than places. The alias table has
  // already had its say by this point, so "SF", "NY" and "TLV" are long gone;
  // what reaches here is what the loop above could not strip because the code
  // was the *whole* value — "CN", "AU", "SG", "VA", "DC", "CAN", "IND", each of
  // which was published as a JobPosting addressLocality.
  //
  // The same rule location.ts already applies on its own path ("two-letter
  // leftovers are state, province and timezone codes far more often than
  // cities"), moved here so that re-canonicalizing a stored value gets it too —
  // which is what lets exportSnapshot clean rows written by an older engine
  // without a migration.
  //
  // No city is one character either. That is what "N/A" reduces to:
  // parseLocation splits the raw location on "/" before this function ever sees
  // it, so the "n/a" entry in PLACEHOLDER never gets a chance and the leading
  // "N" arrived at addressLocality as a place name.
  if (s.length < 3) return undefined;
  if (s.length === 3 && COUNTRY_ALPHA3[key]) return undefined;

  const cased = titleCase(s);
  // Re-check aliases after casing so "SAN FRANCISCO BAY AREA" lands too.
  return ALIASES[cased.toLowerCase()] ?? cased;
}

/**
 * Does the alias table vouch for this string as a city? Lets callers accept a
 * short token they'd otherwise have to reject as a state or timezone code —
 * "SF" is a city, "CA" and "EST" are not.
 */
export function isKnownCityAlias(s: string): boolean {
  return Boolean(ALIASES[s.trim().toLowerCase()]);
}

/** URL slug for a canonical city name: "São Paulo" → "sao-paulo". */
export function citySlug(city: string): string {
  return stripDiacritics(city)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
