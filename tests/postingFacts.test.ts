import { describe, expect, it } from "vitest";
import { postingFacts, type FactId } from "../site/src/lib/postingFacts.ts";

/** The value of one fact, or undefined when the rules stayed silent. */
const read = (text: string, id: FactId): string | undefined =>
  postingFacts(text).facts.find((f) => f.id === id)?.value;

// Every phrasing below is lifted from a live posting. The rules were tuned
// against the corpus rather than against imagined adverts, and these are the
// cases that tuning turned up — the wrong answers as much as the right ones.

describe("postingFacts: experience", () => {
  it("reads the headline ask from the bullet that opens with it", () => {
    const text = "Qualifications\n• 10+ years of software engineering experience in backend systems\n• 3+ years in ML";
    expect(read(text, "experience")).toBe("10+ years");
    expect(postingFacts(text).minYears).toBe(10);
  });

  it("keeps a range as a range", () => {
    expect(read("• 8-12 years of software engineering experience", "experience")).toBe("8–12 years");
  });

  it("does not mistake the company's age for a requirement", () => {
    expect(read("For 10 years, Scale has provided the high-quality data that powers AI.", "experience")).toBeUndefined();
    expect(
      read("With over 25 years of experience and a team of 5,000 professionals, we accelerate change.", "experience"),
    ).toBeUndefined();
    expect(read("Before founding Sierra, Clay spent 18 years at Google.", "experience")).toBeUndefined();
    expect(read("We’ve been innovating fearlessly for 40 years.", "experience")).toBeUndefined();
  });

  it("still reads 'at least N years', which shares a preposition with the history phrasings", () => {
    expect(read("You have at least 3 years of experience with SQL.", "experience")).toBe("3+ years");
  });

  it("gives the span for a degree ladder, and no single minimum for the markup", () => {
    const text =
      "• 12 years of experience with a Bachelor’s degree; or 8 years and a Master’s degree; or a PhD with 5 years experience.";
    expect(read(text, "experience")).toBe("5–12 years, depending on degree");
    expect(postingFacts(text).minYears).toBeUndefined();
  });

  it("marks a figure that only appears under a preferred heading", () => {
    const text = "Nice to have\n• 5+ years of experience as a Machine Learning Engineer";
    expect(read(text, "experience")).toBe("5+ years preferred");
    expect(postingFacts(text).minYears).toBeUndefined();
  });

  it("prefers the required figure over an earlier preferred one", () => {
    const text = "Preferred\n• 8+ years of experience in research\nRequirements\n• 4+ years of relevant work experience.";
    expect(read(text, "experience")).toBe("4+ years");
  });
});

describe("postingFacts: education", () => {
  it("lists the accepted levels and notes when experience can stand in", () => {
    const text = "• An MS, PhD, or equivalent practical experience in Computer Science";
    expect(read(text, "education")).toBe("Master's or PhD, or equivalent experience");
  });

  it("separates what is required from what is preferred in one sentence", () => {
    const text = "• Bachelor's degree in Computer Science, with a Master's degree or PhD preferred";
    expect(read(text, "education")).toBe("Bachelor's; Master's or PhD preferred");
    expect(postingFacts(text).requiredDegree).toBe("bachelor");
  });

  it("attaches the equivalence to the requirement it relaxes", () => {
    const text =
      "• Bachelor's degree in a STEM discipline, or equivalent experience\nPreferred Qualifications\n• Master's degree in Computer Science";
    expect(read(text, "education")).toBe("Bachelor's, or equivalent experience; Master's preferred");
  });

  it("treats 'Highly recommended:' as a preference", () => {
    expect(read("• Highly recommended: Master’s or PhD in Computer Science", "education")).toBe(
      "Master's or PhD preferred",
    );
  });

  it("says so when the role is for people still studying, and claims no credential", () => {
    const text = "• Currently enrolled in a PhD program in Computer Science or a related field.";
    expect(read(text, "education")).toBe("Studying for a PhD");
    expect(postingFacts(text).requiredDegree).toBeUndefined();
  });

  it("ignores abbreviations that aren't degrees", () => {
    expect(read("• Experience with MS Teams and MS SQL Server", "education")).toBeUndefined();
    expect(read("• Latency under 50 ms at the 99th percentile", "education")).toBeUndefined();
  });
});

describe("postingFacts: visa sponsorship", () => {
  it("reads a plain yes", () => {
    expect(read("Visa sponsorship: Yes, we sponsor visas.", "visa")).toBe("Offered");
    expect(read("Visa and work permit sponsorship is available for this role.", "visa")).toBe("Offered");
  });

  it("reads a plain no", () => {
    expect(read("This position is not eligible for employment-based immigration sponsorship.", "visa")).toBe(
      "Not offered",
    );
    expect(read("We are unable to provide visa sponsorship or support visa transfers.", "visa")).toBe("Not offered");
    expect(
      read(
        "Applicants must be authorized to work in the U.S. without the need for employment-based visa sponsorship now or in the future.",
        "visa",
      ),
    ).toBe("Not offered");
  });

  it("does not read a caveat on a yes as a refusal", () => {
    // Anthropic's boilerplate. "aren't able to successfully sponsor" once
    // matched the negative pattern and reported the opposite of the truth.
    const text =
      "Visa sponsorship: We do sponsor visas! However, we aren't able to successfully sponsor visas for every role and every candidate.";
    expect(read(text, "visa")).toBe("Offered, case by case");
  });

  it("reports 'will consider' as considered, not offered", () => {
    expect(
      read("Capital One will consider sponsoring a new qualified applicant for employment authorization for this position.", "visa"),
    ).toBe("Considered");
  });

  it("stays silent when a template says both", () => {
    const text =
      "Visa sponsorship is available for senior roles.\nFor contract roles we will not sponsor visas.";
    expect(read(text, "visa")).toBeUndefined();
  });

  it("ignores the other kind of sponsor", () => {
    expect(
      read("The mission has a named executive sponsor and committed funding.", "visa"),
    ).toBeUndefined();
  });
});

describe("postingFacts: eligibility and clearance", () => {
  it("reads an export-control requirement", () => {
    const text =
      "To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident (aka green card holder).";
    expect(read(text, "citizenship")).toBe("US citizen or permanent resident required");
  });

  it("does not read conditional boilerplate as a requirement", () => {
    const text =
      "Should the position require, and Kodiak determines that a candidate’s U.S. person status necessitate an export license, the candidate may be barred.";
    expect(read(text, "citizenship")).toBeUndefined();
  });

  it("does not read the equal-opportunity statement as a requirement", () => {
    const text = "All applicants are considered without regard to citizenship; U.S. citizen or not, you must apply online.";
    expect(read(text, "citizenship")).toBeUndefined();
  });

  it("distinguishes holding a clearance from being able to get one", () => {
    expect(read("• Active TS/SCI clearance or equivalent.", "clearance")).toBe("TS/SCI clearance required");
    expect(read("• Eligible to obtain and maintain an active U.S. Top Secret clearance.", "clearance")).toBe(
      "Must be able to obtain Top Secret clearance",
    );
    expect(read("This role may require a security clearance at the TS/SCI level.", "clearance")).toBe(
      "May require a security clearance",
    );
  });

  it("ignores clearances that aren't security clearances", () => {
    expect(read("• Own customs clearance workflows for our logistics product.", "clearance")).toBeUndefined();
  });
});

describe("postingFacts: office and travel", () => {
  it("reads days in the office, in digits or words", () => {
    expect(read("We use a hybrid work model of 3 days in the office per week.", "office")).toBe("3 days a week");
    expect(read("We work in-person five days a week in our San Francisco office.", "office")).toBe("5 days a week");
    expect(read("This role requires working from our Palo Alto office 2-3 days a week.", "office")).toBe(
      "2–3 days a week",
    );
  });

  it("takes the office half of a split, not the home half", () => {
    expect(read("Hybrid working model with 3 days in the office and 2 days working remotely.", "office")).toBe(
      "3 days a week",
    );
  });

  it("reads a share of time, but not when the sentence is about travel", () => {
    expect(read("We expect all staff to be in one of our offices at least 25% of the time.", "office")).toBe(
      "25% of the time",
    );
    expect(read("Must be willing to travel up to 25% of the time to visit our offices.", "office")).toBeUndefined();
  });

  it("says 'up to' only when the posting sets a ceiling", () => {
    expect(read("Must be able to travel up to 50% annually.", "travel")).toBe("Up to 50% of the time");
    expect(read("You're excited to travel ~25% of the time, embedded with customer engineers.", "travel")).toBe(
      "About 25% of the time",
    );
    expect(read("• Travel: 10-20%, mostly domestic.", "travel")).toBe("10–20% of the time");
  });

  it("does not read the travel industry, or an HR form, as a travel requirement", () => {
    expect(read("As a global travel company powered by passionate people, we help travelers.", "travel")).toBeUndefined();
    expect(read("Travel: Travel Required (Yes/No): No", "travel")).toBeUndefined();
  });
});

describe("postingFacts: the rest", () => {
  it("reads equity as pay, not as a value", () => {
    expect(read("Competitive compensation with equity.", "extras")).toBe("Equity");
    expect(read("We are committed to diversity, equity and inclusion.", "extras")).toBeUndefined();
    expect(read("Experience covering private equity clients.", "extras")).toBeUndefined();
  });

  it("drops a company-wide 'may be eligible' template", () => {
    expect(
      read("In addition to base salary, this role may be eligible for bonus, equity, and/or commission programs.", "extras"),
    ).toBeUndefined();
  });

  it("joins what it finds in a fixed order", () => {
    const text = "• Annual bonus of up to 15%\n• Meaningful equity\n• A sign-on bonus for senior hires";
    expect(read(text, "extras")).toBe("Equity · Bonus · Sign-on bonus");
  });

  it("reads relocation offers and refusals, and drops hedged benefits lists", () => {
    expect(read("We offer relocation assistance to new employees.", "relocation")).toBe("Support offered");
    expect(read("No relocation will be provided.", "relocation")).toBe("Not offered");
    expect(
      read("Benefits may include healthcare coverage, parental leave and relocation support.", "relocation"),
    ).toBeUndefined();
  });

  it("reads an on-call duty but not a product that mentions on-call", () => {
    expect(read("• Participate in the team’s on-call rotation.", "oncall")).toBe("Part of the rotation");
    expect(read("• Cutting mean-time-to-insight for on-call engineers at our customers.", "oncall")).toBeUndefined();
  });

  it("lists a language only when it narrows the field", () => {
    expect(read("• Fluent in both English and Dutch", "languages")).toBe("English, Dutch");
    expect(read("• Fluent in English, with excellent written communication", "languages")).toBeUndefined();
    expect(read("Nice to have\n• French proficiency", "languages")).toBe("French (a plus)");
  });

  it("returns nothing for a missing description", () => {
    expect(postingFacts(undefined)).toEqual({ facts: [] });
    expect(postingFacts("")).toEqual({ facts: [] });
  });

  it("keeps the sentence each fact came from", () => {
    const fact = postingFacts("About us.\n• 5+ years of relevant work experience.\n• Python.").facts[0]!;
    expect(fact.evidence).toBe("5+ years of relevant work experience.");
  });

  it("only offers experience-in-place-of-education alongside a required degree", () => {
    const withDegree = postingFacts("• Bachelor's degree in Computer Science or equivalent experience");
    expect(withDegree.experienceInPlaceOfEducation).toBe(true);
    const preferredOnly = postingFacts("Preferred\n• Master's degree or equivalent experience");
    expect(preferredOnly.experienceInPlaceOfEducation).toBeUndefined();
  });
});
