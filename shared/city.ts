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
   tasmania,australian capital territory,northern territory`
    .split(",")
    .map((s) => s.trim().toLowerCase()),
);

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
 * only thing that survives the strip.
 */
const COUNTRY_ALPHA3: ReadonlySet<string> = new Set(
  `usa,can,gbr,irl,deu,fra,nld,esp,ita,prt,pol,che,aut,bel,dnk,nor,swe,fin,
   cze,grc,rou,hun,bgr,hrv,srb,svk,svn,ltu,lva,est,ukr,tur,isr,are,sau,egy,
   zaf,nga,ken,ind,pak,chn,hkg,twn,jpn,kor,sgp,mys,tha,vnm,idn,phl,aus,nzl,
   bra,mex,arg,col,chl,per,ury`
    .split(",")
    .map((s) => s.trim()),
);

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

  // "Chicago; New York" / "London | Paris" / "SF or NYC" → the first one wins.
  // Hyphens are NOT separators: "Kitchener-Waterloo" is one place.
  s = s.split(/[;|]|\s\/\s|\s+or\s+/i)[0]!.trim();

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
  if (strippedCode && s.includes("-")) s = s.split("-")[0]!.trim();

  // Trailing building/site detail: "London - The River Building HQ",
  // "Hyderabad - Phoenix Equinox Tower 2". Spaced hyphen only, so
  // "Kitchener-Waterloo" survives.
  s = s.split(/\s[-–—]\s/)[0]!.trim();

  // Parentheticals and street addresses: "Freiburg (Germany)", "Atlanta 1050 Techwood Drive".
  s = s
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+\d{2,}\s+.*$/, "")
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

  // Anything still carrying digits, or absurdly long, isn't a city name.
  if (/\d/.test(s) || s.length > 40) return undefined;

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
  if (s.length === 3 && COUNTRY_ALPHA3.has(key)) return undefined;

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
