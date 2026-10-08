import type { RemoteType } from "@aiengjobs/shared";
import {
  canonicalCity,
  COUNTRY_ALPHA3,
  isKnownCityAlias,
  MULTI_COUNTRY_REGION,
  NON_CITY,
} from "@aiengjobs/shared/city";
import { cityRegion, divisionOf, inferRegion } from "./region.ts";

export interface LocationInfo {
  remoteType?: RemoteType;
  country?: string;
  region?: string;
  city?: string;
}

const US_STATE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

// Full US state names (feeds often write "Remote-Utah" or "California").
// "Georgia" is deliberately absent — ambiguous with the country.
const US_STATE_NAMES =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;

// First match wins, so more specific phrases go before substrings that could
// collide (e.g. "new zealand" before the US_STATE_NAMES "new …" states is not
// needed — those are separate checks — but "south korea" must precede "korea"-
// only never appears since both map to KR anyway).
const COUNTRY_HINTS: [RegExp, string][] = [
  [/\b(united states|u\.?s\.?a?\.?|usa)\b/i, "US"],
  [
    /\b(san francisco|new york|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|palo alto|menlo park|mountain view|sunnyvale|cupertino|san jose|san diego|san mateo|redwood city|oakland|berkeley|santa clara|bellevue|kirkland|redmond|washington,? d\.?c\.?|portland|philadelphia|phoenix|dallas|houston|salt lake city|pittsburgh|minneapolis|nashville|raleigh|durham|ann arbor|boulder|irvine|pasadena|culver city|brooklyn|manhattan|lehi|alpharetta|ames)\b/i,
    "US",
  ],
  // Belfast, Glasgow, Leeds and Cardiff are peers of the cities already listed
  // and were simply missing; each cost its roles their JobPosting. Birmingham
  // and Cambridge stay out on purpose — Alabama and Massachusetts have both.
  // Halifax (Nova Scotia), Markham (Ontario) and Sault Ste. Marie (Michigan)
  // stay out of every list for the same reason.
  [
    /\b(united kingdom|u\.?k\.?|england|scotland|wales|northern ireland|london|manchester|edinburgh|bristol|oxford|belfast|glasgow|leeds|cardiff|nottingham|knutsford)\b/i,
    "GB",
  ],
  [/\b(canada|toronto|vancouver|montr[eé]al|ottawa|calgary|waterloo|quebec)\b/i, "CA"],
  [/\b(germany|berlin|munich|münchen|frankfurt|hamburg|cologne|köln|stuttgart|bochum|karlsruhe)\b/i, "DE"],
  [/\b(france|paris|lyon|toulouse|grenoble|nantes)\b/i, "FR"],
  [/\b(netherlands|amsterdam|rotterdam|utrecht|eindhoven|the hague)\b/i, "NL"],
  [/\b(ireland|dublin|cork)\b/i, "IE"],
  // "DLF Cybercity" is the developer's IT park brand; there are several, all in
  // India, so it places the country though never the city.
  [/\b(india|bangalore|bengaluru|mumbai|delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida|mohali|dlf cyber ?city)\b/i, "IN"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(australia|sydney|melbourne|brisbane|perth|canberra)\b/i, "AU"],
  [/\b(japan|tokyo|osaka|kyoto)\b/i, "JP"],
  [/\b(south korea|korea|seoul)\b/i, "KR"],
  [/\b(china|beijing|shanghai|shenzhen|hangzhou|guangzhou)\b/i, "CN"],
  [/\b(hong kong)\b/i, "HK"],
  [/\b(taiwan|taipei)\b/i, "TW"],
  [/\b(switzerland|zurich|zürich|geneva|basel|lausanne)\b/i, "CH"],
  [/\b(sweden|stockholm|gothenburg)\b/i, "SE"],
  [/\b(spain|madrid|barcelona|valencia)\b/i, "ES"],
  [/\b(italy|milan|rome|turin)\b/i, "IT"],
  [/\b(poland|warsaw|krak[oó]w|wroc[lł]aw|gda[nń]sk)\b/i, "PL"],
  [/\b(portugal|lisbon|porto)\b/i, "PT"],
  [/\b(brazil|s[aã]o paulo|rio de janeiro|belo horizonte|campinas)\b/i, "BR"],
  // Lookbehind so "New Mexico" (the US state) doesn't match.
  [/\bmexico city\b|\b(?<!new )mexico\b/i, "MX"],
  [/\b(united arab emirates|uae|dubai|abu dhabi)\b/i, "AE"],
  [/\b(israel|tel aviv|jerusalem|herzliya)\b/i, "IL"],
  [/\b(austria|vienna)\b/i, "AT"],
  [/\b(belgium|brussels|antwerp|ghent)\b/i, "BE"],
  [/\b(denmark|copenhagen)\b/i, "DK"],
  [/\b(norway|oslo)\b/i, "NO"],
  [/\b(finland|helsinki)\b/i, "FI"],
  [/\b(czech republic|czechia|prague|brno)\b/i, "CZ"],
  [/\b(greece|athens|thessaloniki|kato scholari)\b/i, "GR"],
  [/\b(romania|bucharest|cluj)\b/i, "RO"],
  [/\b(hungary|budapest)\b/i, "HU"],
  [/\b(new zealand|auckland|wellington)\b/i, "NZ"],
  [/\b(south africa|cape town|johannesburg)\b/i, "ZA"],
  [/\b(argentina|buenos aires)\b/i, "AR"],
  // Bogotá sits outside the \b group: without the u flag "á" is not a word
  // character, so a trailing \b after it never matched and "Bogotá" alone
  // went without a country.
  [/\b(colombia|medell[ií]n)\b|\bbogot[aá](?![a-z])/i, "CO"],
  [/\b(chile|santiago)\b/i, "CL"],
  [/\b(turkey|t[uü]rkiye|istanbul|ankara)\b/i, "TR"],
  [/\b(vietnam|ho chi minh|hanoi)\b/i, "VN"],
  [/\b(thailand|bangkok)\b/i, "TH"],
  [/\b(indonesia|jakarta)\b/i, "ID"],
  [/\b(philippines|manila|taguig)\b/i, "PH"],
  [/\b(malaysia|kuala lumpur)\b/i, "MY"],
  [/\b(estonia|tallinn)\b/i, "EE"],
  [/\b(ukraine|kyiv|kiev|lviv)\b/i, "UA"],
  [/\b(serbia|belgrade|beograd)\b/i, "RS"],
  [/\b(croatia|zagreb)\b/i, "HR"],
  [/\b(bulgaria|sofia)\b/i, "BG"],
  [/\b(slovakia|bratislava)\b/i, "SK"],
  [/\b(slovenia|ljubljana)\b/i, "SI"],
  [/\b(lithuania|vilnius)\b/i, "LT"],
  [/\b(latvia|riga)\b/i, "LV"],
  [/\b(nigeria|lagos)\b/i, "NG"],
  [/\b(kenya|nairobi)\b/i, "KE"],
  [/\b(egypt|cairo)\b/i, "EG"],
  [/\b(saudi arabia|riyadh)\b/i, "SA"],
  [/\b(pakistan|karachi|lahore|islamabad)\b/i, "PK"],
  // Each of these was a live role with no country, and so no JobPosting:
  // "Almaty, Kazakhstan", "Baku", "Doha, Qatar", "Quito, Ecuador", "Lima,
  // Peru". Lima itself stays out — Ohio has one — the country name carries it.
  [/\b(kazakhstan|almaty|astana)\b/i, "KZ"],
  [/\b(azerbaijan|baku)\b/i, "AZ"],
  // Georgia the country, by its cities only — the bare word is a US state far
  // more often on this board, so it stays out of every hint (see
  // US_STATE_NAMES). With the city placing the country, "Georgia - Tbilisi"
  // reads broad → narrow like any other.
  [/\b(tbilisi|batumi|kutaisi)\b/i, "GE"],
  [/\b(qatar|doha)\b/i, "QA"],
  [/\b(oman|muscat)\b/i, "OM"],
  [/\b(algeria|algiers)\b/i, "DZ"],
  [/\b(ecuador|quito)\b/i, "EC"],
  [/\b(peru)\b/i, "PE"],
  [/\b(uruguay|montevideo)\b/i, "UY"],
  [/\b(costa rica)\b/i, "CR"],
  [/\b(cyprus|nicosia|limassol)\b/i, "CY"],
];

/**
 * An ISO alpha-3 code standing as its own token — "Ontario, CAN", "Mohali,
 * IND", "PHL-Taguig City-CitiPlaza", "VNM.Da Nang", "Remote AUS". Workday and
 * Oracle tenants lead with them, and canonicalCity already strips them as
 * codes; this reads the country they spell. Capitals only, because "can",
 * "are" and "per" are English words, and never EST, which on this board is
 * always the timezone ("Remote - EST").
 */
function alpha3Country(loc: string): string | undefined {
  for (const m of loc.matchAll(/(?<![\p{L}\d])([A-Z]{3})(?![\p{L}\d])/gu)) {
    const code = m[1]!.toLowerCase();
    if (code !== "est" && Object.hasOwn(COUNTRY_ALPHA3, code)) return COUNTRY_ALPHA3[code];
  }
  return undefined;
}

function inferCountry(loc: string): string | undefined {
  for (const [re, code] of COUNTRY_HINTS) if (re.test(loc)) return code;
  // Before the state check: an explicit country code outranks a two-letter
  // token that might be a state.
  const alpha3 = alpha3Country(loc);
  if (alpha3) return alpha3;
  if (US_STATE.test(loc) || US_STATE_NAMES.test(loc)) return "US";
  return undefined;
}

// The "never a city" vocabulary now lives in @aiengjobs/shared/city, so the
// export path and the site's location pages apply exactly the same rules.

/**
 * Separate the work-policy word feeds mix into the location slot from the place
 * name beside it: "Hybrid - Lisbon" → "Lisbon", "San Carlos - Hybrid" → "San
 * Carlos", "San Francisco (Remote)" → "San Francisco".
 *
 * This used to be a blunt reject — any segment *containing* a policy word
 * yielded no city — which threw away the place sitting next to it. With no
 * city, region or country the site can't emit a valid JobPosting, so those
 * roles were invisible to Google for Jobs.
 *
 * The rules below are deliberately narrow, and everything they extract has to
 * survive PLACE_SHAPE/NOT_A_PLACE before it counts. A blunt strip is tempting
 * and much shorter, but on this corpus it turned "Remote job" into the city
 * "Job", "Remote - EST" into "Est", "Remote-Friendly (Travel-Required) | …"
 * into "Friendly" and "Remote - CA" into "Ca". A wrong city is worse than no
 * city: it reaches the JobPosting's addressLocality, the city filter, and —
 * given twelve of them — its own landing page. When the shape is anything but
 * unambiguous, emit nothing, exactly as before.
 */
const POLICY = "remote|hybrid|on[\\s-]?site|virtual|wfh|work from home";
/** "Hybrid - Lisbon", "Remote: Singapore". Spaced dash or a colon only — the
 *  same rule canonicalCity uses, so "PL-Poland-Remote" and "Kitchener-Waterloo"
 *  aren't torn apart at a hyphen that belongs to the name. */
const POLICY_LEAD = new RegExp(`^(?:${POLICY})\\s*(?::|\\s[-–—])\\s*(.+)$`, "i");
/** "San Carlos - Hybrid", "New York — Remote" */
const POLICY_TRAIL = new RegExp(`^(.+?)\\s*(?::|[-–—]\\s)\\s*(?:${POLICY})$`, "i");
/** "San Francisco (Hybrid)" */
const POLICY_PAREN = new RegExp(`^(.+?)\\s*\\((?:${POLICY})\\)$`, "i");
/** "Hybrid London", "Hybrid SF" — no separator, so the tail must be one clean run. */
const POLICY_BARE = new RegExp(`^(?:${POLICY})\\s+([\\p{L}][\\p{L}\\p{M}\\s'’-]{1,30})$`, "iu");
/** Nothing but a policy word — genuinely carries no location. */
const POLICY_ONLY = new RegExp(`^(?:${POLICY})$`, "i");
/**
 * The synonyms feeds use for "remote". `remoteType` only ever tested for
 * "hybrid" and "remote", so a role located "Virtual" fell through to the
 * `else if (loc)` branch and came out **onsite** — a fully-virtual role
 * badged On-site on its card and in its Work type fact, and pushed down the
 * JobPosting path that then wants a jobLocation it has no way to supply.
 * POLICY above already knows these words; this is the same list minus the two
 * that were already handled.
 */
const REMOTE_SYNONYM = /\b(?:virtual|wfh|work from home|telecommute)\b/i;
/** A policy word, or a "could be anywhere" word, loose in a segment we couldn't
 *  parse into <policy> + <place>. Whatever else the segment says, it isn't
 *  naming one city. */
const LOOSE_NON_PLACE = new RegExp(
  `\\b(?:${POLICY}|anywhere|global|worldwide|distributed|nationwide)\\b`,
  "i",
);

/** Letters, spaces and the punctuation real place names use. No digits, parens,
 *  ampersands, commas or slashes — those mean a list or an address, not a city. */
const PLACE_SHAPE = /^[\p{L}][\p{L}\p{M}\s.'’-]{1,38}$/u;
/** Connectives, hedges and timezone codes that survive a strip looking like a
 *  place name but aren't one. */
const NOT_A_PLACE =
  /\b(or|and|in|the|all|any|anywhere|select|friendly|only|preferred|metro|locations?|jobs?|home|based|offsite|other|time|zones?|est|pst|cst|mst|gmt|utc|eu|apac|emea)\b/i;

function isPlausiblePlace(s: string): boolean {
  if (!PLACE_SHAPE.test(s) || NOT_A_PLACE.test(s)) return false;
  // Two-letter leftovers are state, province and timezone codes far more often
  // than cities — allowed only where the shared alias table vouches for one.
  // Dots don't earn an abbreviation the extra length: "U.S" is the country.
  const bare = s.replace(/\./g, "").trim();
  return bare.length > 2 || isKnownCityAlias(bare);
}

/** The place name in a segment, or "" when the segment names no place. */
function placeSegment(segment: string): string {
  for (const re of [POLICY_LEAD, POLICY_TRAIL, POLICY_PAREN, POLICY_BARE]) {
    const m = segment.match(re);
    if (!m) continue;
    const rest = m[1]!.trim();
    return isPlausiblePlace(rest) ? rest : "";
  }
  if (POLICY_ONLY.test(segment)) return "";
  // No policy word in a shape we recognise. Hand the segment through untouched
  // — canonicalCity applies NON_CITY and the placeholder rules — unless a
  // policy or catch-all word is still loose inside it. That's the old blunt
  // guard, and it's still the right answer for "Remote-Friendly (Travel
  // Required) …" and "Anywhere in the US".
  return LOOSE_NON_PLACE.test(segment) ? "" : segment;
}

/**
 * Broad → narrow: the place a location names *after* its country and division.
 *
 * Most feeds write "City, State, Country", which the first-segment rule below
 * reads correctly. Enterprise Workday and Oracle tenants write it the other way
 * round — "Washington - Seattle Campus", "Canada, BC, Vancouver", "USA - Georgia
 * - Alpharetta - 30005", "AMER - Canada - Ontario - Toronto - University Ave",
 * "India (Bengaluru)" — and the first segment is then a state or a country. On
 * the 2026-10-08 board that left "California - San Francisco" (18 open roles)
 * and "Canada, BC, Vancouver" (14) with no addressLocality and, worse,
 * published the state as the city: Expedia's and Salesforce's Seattle and Bellevue roles
 * were filed under Washington, DC, and Equifax's Alpharetta roles under a city
 * called Georgia.
 *
 * "Take the last segment" is not the fix: it reads "Colombia, Huila, Colombia"
 * as Colombia and "135 W 26th Street, New York, NY 10001" as a ZIP code. So this
 * fires only when every segment in front of the place is *recognised* as
 * broader — a country, a country code, a multi-country region, or a division of
 * the country the string is already known to be in — and nothing recognised as
 * broader comes after it, which is what rejects the City-Region-Country lists.
 *
 * Names that are both a division and a city on this board ("Washington", "New
 * York", "Delhi", "NY") count as the broader side only before a
 * spaced dash, the Workday "State - City" separator. Before a comma they are far
 * more often the first city of a list — "New York, London, Chicago",
 * "Washington, DC" — and reading past them there would throw that city away.
 *
 * Returns the place segment and the segment immediately broader than it (where
 * the division is read from), or undefined when the shape isn't this one and
 * the first-segment rule should answer instead.
 */
function narrowestPlace(
  loc: string,
  country: string | undefined,
): { place: string; broader: string } | undefined {
  // A list ("Canada, BC, Vancouver; USA, WA, Seattle") is read on its first
  // entry, like everywhere else.
  const entry = loc.split(/[;|/]/)[0]!.trim();

  const paren = entry.match(/^([^()]+?)\s*\(([^()]+)\)$/);
  const dashed = /\s[-–—]\s/.test(entry);
  const segments = paren
    ? [paren[1]!, paren[2]!]
    : entry.split(dashed ? /\s+[-–—]\s+/ : /\s*,\s*/).map((s) => s.trim());
  if (segments.length < 2) return undefined;
  const ambiguousOk = dashed && !paren;

  let i = 0;
  while (i < segments.length && broaderSide(segments[i]!, country, ambiguousOk)) i++;
  if (i === 0 || i === segments.length) return undefined;
  const broader = segments.slice(0, i);

  // "CN - Shanghai", "VA - Reston", "IND - NonGBS-Pune-Kharadi": nothing but
  // codes before a dash is the shape canonicalCity's code loop already reads,
  // with the City-Site split this segment-wise view would lose.
  if (dashed && broader.every(isCode)) return undefined;
  // "Americas (US time zones)" is a hedge, not a place inside the Americas.
  if (paren && MULTI_COUNTRY_REGION.has(broader[0]!.toLowerCase().trim())) return undefined;

  const place = segments[i]!;
  if (broaderSide(place, country, true)) return undefined;
  if (!isPlausiblePlace(place) || LOOSE_NON_PLACE.test(place)) return undefined;
  if (segments.slice(i + 1).some((s) => broaderSide(s, country, true))) return undefined;

  // A nest, not a list: "US, UK, Singapore, Remote" is three countries side by
  // side, and Singapore is not a city inside the UK. Every segment that names a
  // country on its own must name the same one.
  const named = new Set([...broader, place].map(inferCountry).filter(Boolean));
  if (named.size > 1) return undefined;

  return { place, broader: broader[i - 1]! };
}

/** A code as feeds write one — "CA", "BC", "CAN" — never "Ca". */
const isCode = (segment: string): boolean =>
  segment.length <= 3 && segment === segment.toUpperCase();

/** Catch-all words that NON_CITY holds but that don't name a territory a place
 *  can sit inside. "Anywhere, US" names no place, and "Remote - London" is
 *  placeSegment's job. */
const NOT_BROADER: ReadonlySet<string> = new Set([
  "remote",
  "fully remote",
  "distributed",
  "worldwide",
  "international",
  "global",
  "anywhere",
]);

/** Is this segment a country, country code, multi-country region or division
 *  of `country` — i.e. something a city sits inside? */
function broaderSide(segment: string, country: string | undefined, ambiguousOk: boolean): boolean {
  const key = segment.toLowerCase().trim();
  if (NOT_BROADER.has(key)) return false;
  // Codes only count when written as codes — see isCode.
  const code = isCode(segment);
  const known =
    NON_CITY.has(key) ||
    NON_CITY.has(key.replace(/\./g, "")) ||
    (code && Object.hasOwn(COUNTRY_ALPHA3, key)) ||
    ((code || segment.length > 3) && divisionOf(segment, country) !== undefined);
  if (!known) return false;
  // Also a city in its own right — see narrowestPlace.
  return ambiguousOk || canonicalCity(segment) === undefined;
}

/** Classify remote policy + best-effort country/city from the raw location string. */
export function parseLocation(
  locationRaw?: string,
  declaredRemote?: RemoteType,
  remoteHint?: boolean,
): LocationInfo {
  const loc = (locationRaw ?? "").trim();
  const lower = loc.toLowerCase();

  let remoteType: RemoteType | undefined = declaredRemote;
  if (!remoteType) {
    if (/\bhybrid\b/.test(lower)) remoteType = "hybrid";
    else if (remoteHint === true || /\bremote\b/.test(lower) || REMOTE_SYNONYM.test(lower))
      remoteType = "remote";
    // "Europe", "AMER", "EMEA" name a hiring territory, not a workplace — a
    // role listed only there isn't on-site anywhere, so don't badge it as such.
    else if (MULTI_COUNTRY_REGION.has(lower)) remoteType = "remote";
    else if (loc) remoteType = "onsite";
  }

  const statedCountry = loc ? inferCountry(loc) : undefined;
  // Broad → narrow first, because where it fires the first segment is the
  // state or the country, and reading that as the city is the bug it exists
  // to prevent. A place it finds but canonicalCity rejects — a building name
  // after "USA - Texas -" — yields no city rather than falling back to the
  // state in front of it.
  const narrow = loc ? narrowestPlace(loc, statedCountry) : undefined;
  const city = narrow ? canonicalCity(narrow.place) : firstSegmentCity(loc);
  // The raw string first, then the canonicalized city as a fallback. Feeds
  // routinely write the location as an office name or an in-house abbreviation
  // ("sf", "SF Office", "NYC Office") that the hint table cannot match, but
  // which canonicalCity has already resolved to "San Francisco" / "New York" by
  // this point. The fallback runs only where the raw string yielded nothing, so
  // it can supply a country the feed omitted but never overturn one it stated.
  const country = statedCountry ?? (city ? inferCountry(city) : undefined);
  // Last, because it reads both of the above: a division is only meaningful
  // against a known country, and the city is the fallback when the feed writes
  // nothing but a place name. In the broad → narrow shape the division is the
  // segment in front of the city, not after it.
  const region = !loc
    ? undefined
    : narrow
      ? (divisionOf(narrow.broader, country) ?? cityRegion(country, city))
      : inferRegion(loc, country, city);

  return { remoteType, country, region, city };
}

/**
 * The city the first segment names, read as "City, State, Country" — the
 * reading parseLocation falls back to when the string isn't broad → narrow.
 * Exported for relocate, which uses it to recognise a stored city that an older
 * engine derived this way.
 */
export function firstSegmentCity(locationRaw?: string): string | undefined {
  const firstSegment = (locationRaw ?? "").trim().split(/[,|/]/)[0]?.trim();
  return firstSegment ? canonicalCity(placeSegment(firstSegment)) : undefined;
}
