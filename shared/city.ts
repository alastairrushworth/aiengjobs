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
 * Country, multi-country region and US state names that feeds — and the LLM
 * extractor — routinely drop into the city slot. Never a city.
 */
export const NON_CITY: ReadonlySet<string> = new Set(
  `united states,usa,us,u.s.,u.s.a.,united kingdom,uk,u.k.,england,scotland,wales,
   canada,germany,france,netherlands,ireland,india,australia,japan,korea,south korea,
   china,taiwan,switzerland,sweden,spain,italy,poland,portugal,brazil,mexico,
   united arab emirates,uae,israel,austria,belgium,denmark,norway,finland,
   czech republic,czechia,greece,romania,hungary,new zealand,south africa,argentina,
   colombia,chile,turkey,türkiye,vietnam,thailand,indonesia,philippines,malaysia,
   estonia,ukraine,serbia,croatia,bulgaria,slovakia,slovenia,lithuania,latvia,
   nigeria,kenya,egypt,saudi arabia,pakistan,
   europe,emea,apac,latam,namer,noram,north america,south america,americas,asia,
   asia pacific,africa,oceania,worldwide,international,global,anywhere,
   alabama,alaska,arizona,arkansas,california,colorado,connecticut,delaware,florida,
   hawaii,idaho,illinois,indiana,iowa,kansas,kentucky,louisiana,maine,maryland,
   massachusetts,michigan,minnesota,mississippi,missouri,montana,nebraska,nevada,
   new hampshire,new jersey,new mexico,new york state,north carolina,north dakota,
   ohio,oklahoma,oregon,pennsylvania,rhode island,south carolina,south dakota,
   tennessee,texas,utah,vermont,virginia,west virginia,wisconsin,wyoming`
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
]);

// Deliberate merges. Values are the display form; keys are lowercased.
// Metro-area strings collapse onto their principal city — "Bay Area" as an
// addressLocality is meaningless to Google, whereas "San Francisco" is both true
// enough and what people actually search for.
const ALIASES: Record<string, string> = {
  "new york city": "New York",
  nyc: "New York",
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
};

// Country / region prefixes feeds bolt on: "India - Bangalore", "UK - London".
const PREFIX_WORDS =
  "us|usa|u\\.s\\.|uk|u\\.k\\.|india|canada|germany|france|ireland|japan|china|" +
  "singapore|australia|netherlands|spain|italy|poland|brazil|mexico|israel|" +
  "switzerland|sweden|emea|apac|amer|namer|latam|europe|remote";

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

  // "Chicago; New York" / "London | Paris" → the first one wins. Hyphens are NOT
  // separators: "Kitchener-Waterloo" is one place.
  s = s.split(/[;|]|\s\/\s/)[0]!.trim();

  // Leading location codes: "US-CA-Menlo Park", "UK - London", "India - Bangalore".
  s = s
    .replace(/^[A-Z]{2}-[A-Z]{2}-\s*/, "")
    .replace(new RegExp(`^(?:${PREFIX_WORDS})\\s*[-–—:]\\s*`, "i"), "")
    .replace(/^[A-Z]{2}\s+(?=\p{Lu}\p{Ll})/u, ""); // "GA Atlanta 1050 …"

  // Trailing building/site detail: "London - The River Building HQ",
  // "Hyderabad - Phoenix Equinox Tower 2". Spaced hyphen only, so
  // "Kitchener-Waterloo" survives.
  s = s.split(/\s[-–—]\s/)[0]!.trim();

  // Parentheticals and street addresses: "Freiburg (Germany)", "Atlanta 1050 Techwood Drive".
  s = s
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+\d{2,}\s+.*$/, "")
    .replace(/,?\s+(office|campus|site|hq|headquarters)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!s) return undefined;

  const key = s.toLowerCase();
  if (PLACEHOLDER.has(key)) return undefined;

  const aliased = ALIASES[key];
  if (aliased) return aliased;

  if (NON_CITY.has(key)) return undefined;

  // Anything still carrying digits, or absurdly long, isn't a city name.
  if (/\d/.test(s) || s.length > 40) return undefined;

  const cased = titleCase(s);
  // Re-check aliases after casing so "SAN FRANCISCO BAY AREA" lands too.
  return ALIASES[cased.toLowerCase()] ?? cased;
}

/** URL slug for a canonical city name: "São Paulo" → "sao-paulo". */
export function citySlug(city: string): string {
  return stripDiacritics(city)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
