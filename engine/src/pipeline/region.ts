/**
 * addressRegion for the JobPosting's PostalAddress — the first-level
 * administrative division ("CA", "Karnataka", "ON").
 *
 * Google lists it as recommended rather than required, and Search Console
 * reported it missing on every address the site published, because nothing ever
 * wrote the column it comes from. It is worth having: US job seekers search by
 * state, and the state is the difference between "an engineer in California"
 * and "an engineer somewhere in America".
 *
 * Only closed, verifiable lists appear below. A positional rule — "the segment
 * between the city and the country is the region" — was measured against the
 * live board and rejected: it reaches 38% of postings but reads "San Francisco,
 * CA - Hybrid" as "Ca - Hybrid", "Prague, Czech Republic" as "Czech Republic"
 * and "AMER - Canada - Ontario - Offsite/Home" as "Home". A wrong region is
 * worse than no region, exactly as with the city, so anything not on a list
 * yields nothing.
 */

/** Codes are canonical; names map onto them so "CALIFORNIA" and "California"
 *  both store "CA". Consulted only once the country is known to be US, which is
 *  why "georgia" is safe here and deliberately absent from the country hints. */
const US_STATES: Record<string, string> = Object.fromEntries(
  `alabama:AL,alaska:AK,arizona:AZ,arkansas:AR,california:CA,colorado:CO,
   connecticut:CT,delaware:DE,florida:FL,georgia:GA,hawaii:HI,idaho:ID,
   illinois:IL,indiana:IN,iowa:IA,kansas:KS,kentucky:KY,louisiana:LA,maine:ME,
   maryland:MD,massachusetts:MA,michigan:MI,minnesota:MN,mississippi:MS,
   missouri:MO,montana:MT,nebraska:NE,nevada:NV,new hampshire:NH,new jersey:NJ,
   new mexico:NM,new york:NY,north carolina:NC,north dakota:ND,ohio:OH,
   oklahoma:OK,oregon:OR,pennsylvania:PA,rhode island:RI,south carolina:SC,
   south dakota:SD,tennessee:TN,texas:TX,utah:UT,vermont:VT,virginia:VA,
   washington:WA,west virginia:WV,wisconsin:WI,wyoming:WY,
   district of columbia:DC,washington dc:DC`
    .split(",")
    .map((p) => p.trim().split(":") as [string, string]),
);

const CA_PROVINCES: Record<string, string> = Object.fromEntries(
  `ontario:ON,quebec:QC,québec:QC,british columbia:BC,alberta:AB,manitoba:MB,
   saskatchewan:SK,nova scotia:NS,new brunswick:NB,
   newfoundland and labrador:NL,prince edward island:PE`
    .split(",")
    .map((p) => p.trim().split(":") as [string, string]),
);

const AU_STATES: Record<string, string> = Object.fromEntries(
  `new south wales:NSW,victoria:VIC,queensland:QLD,western australia:WA,
   south australia:SA,tasmania:TAS,australian capital territory:ACT,
   northern territory:NT`
    .split(",")
    .map((p) => p.trim().split(":") as [string, string]),
);

/** Indian states are written out in full, so the name is the canonical form. */
const IN_STATES: Record<string, string> = Object.fromEntries(
  [
    "Karnataka", "Telangana", "Maharashtra", "Tamil Nadu", "Uttar Pradesh",
    "Haryana", "Delhi", "Gujarat", "West Bengal", "Kerala", "Punjab",
    "Rajasthan", "Andhra Pradesh", "Madhya Pradesh", "Odisha", "Bihar",
    "Assam", "Chandigarh", "Goa", "Jharkhand", "Uttarakhand",
    "Himachal Pradesh",
  ].map((n) => [n.toLowerCase(), n]),
);

const DIVISIONS: Record<string, Record<string, string>> = {
  US: US_STATES,
  CA: CA_PROVINCES,
  AU: AU_STATES,
  IN: IN_STATES,
};

/** The codes a country's divisions use, for matching "CA"/"NSW" directly. */
const CODES: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(DIVISIONS).map(([c, m]) => [c, new Set(Object.values(m))]),
);

/**
 * The cities already enumerated in location.ts's COUNTRY_HINTS, annotated with
 * the division they sit in. This is an annotation of a list the pipeline
 * already curates, not a new gazetteer — and it is what lifts coverage from a
 * third of on-site roles to two thirds, because feeds very often write nothing
 * but the city ("Menlo Park", "Hybrid Austin", "Pune").
 */
const CITY_REGION: Record<string, Record<string, string>> = {
  US: {
    "san francisco": "CA", "new york": "NY", seattle: "WA", austin: "TX",
    boston: "MA", chicago: "IL", "los angeles": "CA", denver: "CO",
    atlanta: "GA", miami: "FL", "palo alto": "CA", "menlo park": "CA",
    "mountain view": "CA", sunnyvale: "CA", cupertino: "CA", "san jose": "CA",
    "san diego": "CA", "san mateo": "CA", "redwood city": "CA", oakland: "CA",
    berkeley: "CA", "santa clara": "CA", bellevue: "WA", kirkland: "WA",
    redmond: "WA", portland: "OR", philadelphia: "PA", phoenix: "AZ",
    dallas: "TX", houston: "TX", "salt lake city": "UT", pittsburgh: "PA",
    minneapolis: "MN", nashville: "TN", raleigh: "NC", durham: "NC",
    "ann arbor": "MI", boulder: "CO", irvine: "CA", pasadena: "CA",
    "culver city": "CA", brooklyn: "NY", manhattan: "NY",
  },
  CA: {
    toronto: "ON", vancouver: "BC", montréal: "QC", montreal: "QC",
    ottawa: "ON", calgary: "AB", waterloo: "ON", quebec: "QC",
  },
  AU: {
    sydney: "NSW", melbourne: "VIC", brisbane: "QLD", perth: "WA",
    canberra: "ACT",
  },
  IN: {
    bangalore: "Karnataka", bengaluru: "Karnataka", mumbai: "Maharashtra",
    delhi: "Delhi", hyderabad: "Telangana", pune: "Maharashtra",
    chennai: "Tamil Nadu", gurgaon: "Haryana", gurugram: "Haryana",
    noida: "Uttar Pradesh",
  },
};

/**
 * The division named right after the city, or the one the city itself implies.
 *
 * Only the segment immediately following the city is considered. Scanning every
 * segment looks more thorough and is worse: "San Francisco, CA; New York, NY"
 * ends on NY while addressLocality says San Francisco, and an address whose
 * locality and region disagree is a worse answer than a missing region. That
 * mistake showed up on 31 live postings before the scan was narrowed.
 *
 * `city` is the canonicalized city parseLocation has already resolved, and
 * `country` the one it has already inferred — regions are only ever read
 * against a known country, so "IN" is Indiana in the US and never India.
 */
export function inferRegion(
  locationRaw: string,
  country?: string,
  city?: string,
): string | undefined {
  if (!country) return undefined;
  const divisions = DIVISIONS[country];
  if (!divisions) return undefined;
  const cities = CITY_REGION[country] ?? {};

  const segment = locationRaw.split(/[,|/]/)[1]?.trim();
  if (segment) {
    const bare = segment.toLowerCase().replace(/\./g, "").trim();
    // A second city in a list ("Chicago, New York, London") is not this city's
    // region. The city table is the only place we can recognise one.
    if (!cities[bare]) {
      const upper = segment.toUpperCase();
      if (upper.length <= 3 && CODES[country]!.has(upper)) return upper;
      if (divisions[bare]) return divisions[bare];
    }
  }

  return city ? cities[city.toLowerCase()] : undefined;
}
