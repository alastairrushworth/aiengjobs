import { describe, expect, it } from "vitest";
import { parseLocation } from "../engine/src/pipeline/location.ts";

describe("parseLocation", () => {
  it("treats a bare multi-country region as remote, not on-site", () => {
    // These name a hiring territory, not a workplace; defaulting them to
    // "onsite" put an On-site badge on roles whose location is "Europe".
    for (const raw of ["Europe", "AMER", "NAMER", "Americas", "North America", "EMEA"]) {
      expect(parseLocation(raw).remoteType).toBe("remote");
    }
  });

  it("still treats a country or city as on-site", () => {
    expect(parseLocation("Spain").remoteType).toBe("onsite");
    expect(parseLocation("San Francisco").remoteType).toBe("onsite");
  });

  it("resolves countries from city and country names", () => {
    expect(parseLocation("Spain").country).toBe("ES");
    expect(parseLocation("San Francisco").country).toBe("US");
    expect(parseLocation("Remote - US").country).toBe("US");
  });

  it("leaves country unset when the feed gives no usable signal", () => {
    for (const raw of ["Remote", "Europe", "AMER", ""]) {
      expect(parseLocation(raw).country).toBeUndefined();
    }
  });
});
