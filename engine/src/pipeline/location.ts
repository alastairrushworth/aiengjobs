import type { RemoteType } from "@aiengjobs/shared";

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
  [/\b(united kingdom|u\.?k\.?|england|scotland|wales|london|manchester|edinburgh|bristol|oxford)\b/i, "GB"],
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

// Country and multi-country region names that feeds put in the location slot —
// never a city (drives the site's jobLocation/addressLocality markup, so a
// wrong "city" like "Sweden" or "Europe" ends up in Google's structured data).
const NON_CITY = new Set(
  `united states,usa,us,u.s.,u.s.a.,united kingdom,uk,u.k.,england,scotland,wales,
   canada,germany,france,netherlands,ireland,india,australia,japan,korea,south korea,
   china,taiwan,switzerland,sweden,spain,italy,poland,portugal,brazil,mexico,
   united arab emirates,uae,israel,austria,belgium,denmark,norway,finland,
   czech republic,czechia,greece,romania,hungary,new zealand,south africa,argentina,
   colombia,chile,turkey,türkiye,vietnam,thailand,indonesia,philippines,malaysia,
   estonia,ukraine,serbia,croatia,bulgaria,slovakia,slovenia,lithuania,latvia,
   nigeria,kenya,egypt,saudi arabia,pakistan,
   europe,emea,apac,latam,north america,south america,americas,asia,asia pacific,
   africa,oceania,worldwide,international,
   alabama,alaska,arizona,arkansas,california,colorado,connecticut,delaware,florida,
   hawaii,idaho,illinois,indiana,iowa,kansas,kentucky,louisiana,maine,maryland,
   massachusetts,michigan,minnesota,mississippi,missouri,montana,nebraska,nevada,
   new hampshire,new jersey,new mexico,new york state,north carolina,north dakota,
   ohio,oklahoma,oregon,pennsylvania,rhode island,south carolina,south dakota,
   tennessee,texas,utah,vermont,virginia,west virginia,wisconsin,wyoming`
    .split(",")
    .map((s) => s.trim().toLowerCase()),
);

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
    else if (remoteHint === true || /\bremote\b/.test(lower)) remoteType = "remote";
    else if (loc) remoteType = "onsite";
  }

  const country = loc ? inferCountry(loc) : undefined;
  const firstSegment = loc.split(/[,|/]/)[0]?.trim();
  const city =
    firstSegment &&
    !/remote|hybrid|onsite|anywhere|global/i.test(firstSegment) &&
    !NON_CITY.has(firstSegment.toLowerCase())
      ? firstSegment
      : undefined;

  return { remoteType, country, city };
}
