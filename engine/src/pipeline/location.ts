import type { RemoteType } from "@aiengjobs/shared";
import {
  canonicalCity,
  isKnownCityAlias,
  MULTI_COUNTRY_REGION,
} from "@aiengjobs/shared/city";

export interface LocationInfo {
  remoteType?: RemoteType;
  country?: string;
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
    /\b(san francisco|new york|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|palo alto|menlo park|mountain view|sunnyvale|cupertino|san jose|san diego|san mateo|redwood city|oakland|berkeley|santa clara|bellevue|kirkland|redmond|washington,? d\.?c\.?|portland|philadelphia|phoenix|dallas|houston|salt lake city|pittsburgh|minneapolis|nashville|raleigh|durham|ann arbor|boulder|irvine|pasadena|culver city|brooklyn|manhattan)\b/i,
    "US",
  ],
  // Belfast, Glasgow, Leeds and Cardiff are peers of the cities already listed
  // and were simply missing; each cost its roles their JobPosting. Birmingham
  // and Cambridge stay out on purpose — Alabama and Massachusetts have both.
  [
    /\b(united kingdom|u\.?k\.?|england|scotland|wales|northern ireland|london|manchester|edinburgh|bristol|oxford|belfast|glasgow|leeds|cardiff)\b/i,
    "GB",
  ],
  [/\b(canada|toronto|vancouver|montr[eé]al|ottawa|calgary|waterloo|quebec)\b/i, "CA"],
  [/\b(germany|berlin|munich|münchen|frankfurt|hamburg|cologne|köln|stuttgart)\b/i, "DE"],
  [/\b(france|paris|lyon|toulouse|grenoble)\b/i, "FR"],
  [/\b(netherlands|amsterdam|rotterdam|utrecht|eindhoven|the hague)\b/i, "NL"],
  [/\b(ireland|dublin|cork)\b/i, "IE"],
  [/\b(india|bangalore|bengaluru|mumbai|delhi|hyderabad|pune|chennai|gurgaon|gurugram|noida)\b/i, "IN"],
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
  [/\b(brazil|s[aã]o paulo|rio de janeiro)\b/i, "BR"],
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
  [/\b(greece|athens)\b/i, "GR"],
  [/\b(romania|bucharest|cluj)\b/i, "RO"],
  [/\b(hungary|budapest)\b/i, "HU"],
  [/\b(new zealand|auckland|wellington)\b/i, "NZ"],
  [/\b(south africa|cape town|johannesburg)\b/i, "ZA"],
  [/\b(argentina|buenos aires)\b/i, "AR"],
  [/\b(colombia|bogot[aá]|medell[ií]n)\b/i, "CO"],
  [/\b(chile|santiago)\b/i, "CL"],
  [/\b(turkey|t[uü]rkiye|istanbul|ankara)\b/i, "TR"],
  [/\b(vietnam|ho chi minh|hanoi)\b/i, "VN"],
  [/\b(thailand|bangkok)\b/i, "TH"],
  [/\b(indonesia|jakarta)\b/i, "ID"],
  [/\b(philippines|manila)\b/i, "PH"],
  [/\b(malaysia|kuala lumpur)\b/i, "MY"],
  [/\b(estonia|tallinn)\b/i, "EE"],
  [/\b(ukraine|kyiv|kiev|lviv)\b/i, "UA"],
  [/\b(serbia|belgrade)\b/i, "RS"],
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
];

function inferCountry(loc: string): string | undefined {
  for (const [re, code] of COUNTRY_HINTS) if (re.test(loc)) return code;
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
  /\b(or|and|in|the|all|any|anywhere|select|friendly|only|preferred|metro|locations?|jobs?|est|pst|cst|mst|gmt|utc|eu|apac|emea)\b/i;

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

  const firstSegment = loc.split(/[,|/]/)[0]?.trim();
  const city = firstSegment ? canonicalCity(placeSegment(firstSegment)) : undefined;
  // The raw string first, then the canonicalized city as a fallback. Feeds
  // routinely write the location as an office name or an in-house abbreviation
  // ("sf", "SF Office", "NYC Office") that the hint table cannot match, but
  // which canonicalCity has already resolved to "San Francisco" / "New York" by
  // this point. The fallback runs only where the raw string yielded nothing, so
  // it can supply a country the feed omitted but never overturn one it stated.
  const country = (loc ? inferCountry(loc) : undefined) ?? (city ? inferCountry(city) : undefined);

  return { remoteType, country, city };
}
