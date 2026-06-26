import type { RemoteType } from "@aiengjobs/shared";

export interface LocationInfo {
  remoteType?: RemoteType;
  country?: string;
  city?: string;
}

const US_STATE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

const COUNTRY_HINTS: [RegExp, string][] = [
  [/\b(united states|u\.?s\.?a?\.?|usa)\b/i, "US"],
  [/\b(united kingdom|u\.?k\.?|england|scotland|wales|london)\b/i, "GB"],
  [/\b(canada|toronto|vancouver|montreal)\b/i, "CA"],
  [/\b(germany|berlin|munich|münchen)\b/i, "DE"],
  [/\b(france|paris)\b/i, "FR"],
  [/\b(netherlands|amsterdam)\b/i, "NL"],
  [/\b(ireland|dublin)\b/i, "IE"],
  [/\b(india|bangalore|bengaluru|mumbai)\b/i, "IN"],
  [/\b(singapore)\b/i, "SG"],
  [/\b(australia|sydney|melbourne)\b/i, "AU"],
];

function inferCountry(loc: string): string | undefined {
  for (const [re, code] of COUNTRY_HINTS) if (re.test(loc)) return code;
  if (US_STATE.test(loc)) return "US";
  return undefined;
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
    else if (remoteHint === true || /\bremote\b/.test(lower)) remoteType = "remote";
    else if (loc) remoteType = "onsite";
  }

  const country = loc ? inferCountry(loc) : undefined;
  const firstSegment = loc.split(/[,|/]/)[0]?.trim();
  const city =
    firstSegment && !/remote|hybrid|onsite|anywhere|global/i.test(firstSegment)
      ? firstSegment
      : undefined;

  return { remoteType, country, city };
}
