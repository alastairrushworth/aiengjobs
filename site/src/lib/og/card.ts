import type { Job } from "@aiengjobs/shared";
import type { SkillCluster } from "@aiengjobs/shared/taxonomy";
import { formatSalary, remoteLabel, seniorityLabel } from "../format.ts";
import type { El } from "./render.ts";
import {
  CONTENT_WIDTH,
  estWidth,
  fitChips,
  fitTitle,
  shortLocation,
  splitPay,
} from "./text.ts";

/**
 * The board's own palette, from site/src/styles/global.css.
 *
 * Copied rather than imported: this is a PNG generator, so there is no
 * stylesheet in scope and no custom properties to resolve. Keep it in step with
 * :root — a card that drifts from the site it links to reads as someone else's.
 */
const C = {
  bg: "#0b0c10",
  surface: "#14161d",
  border: "#272b36",
  text: "#e7e9ee",
  muted: "#9aa1b1",
  accent: "#7c5cff",
  green: "#38d39f",
  /** The plate a logo sits on. Marks are overwhelmingly dark-on-transparent —
   *  True Anomaly's is solid black — so on the card's own ground they simply
   *  disappear. The site solves this the same way (see .company-logo). */
  plate: "#f1f2f6",
} as const;

const PAD = 56;

/** The brand mark from Base.astro, as an image satori can place. */
const BRAND_MARK =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<path d="M19.207 8.12 A10 10 0 1 0 19.207 23.88" fill="none" stroke="${C.text}" ` +
      `stroke-width="2.9" stroke-linecap="round" opacity="0.55"/>` +
      `<circle cx="26" cy="16" r="4.4" fill="${C.accent}"/></svg>`,
  ).toString("base64");

const row = (style: Record<string, string | number>, children: (El | string | false | null)[]): El => ({
  type: "div",
  props: { style: { display: "flex", flexDirection: "row", ...style }, children },
});

const col = (style: Record<string, string | number>, children: (El | string | false | null)[]): El => ({
  type: "div",
  props: { style: { display: "flex", flexDirection: "column", ...style }, children },
});

const text = (style: Record<string, string | number>, content: string): El => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children: content },
});

/** The wordmark row both cards open with. */
const brandRow = (trailing: El | null): El =>
  row({ alignItems: "center", justifyContent: "space-between" }, [
    row({ alignItems: "center" }, [
      { type: "img", props: { src: BRAND_MARK, width: 30, height: 30 } },
      text({ fontSize: 22, fontWeight: 800, marginLeft: 10 }, "frontierroles"),
      text({ fontSize: 22, fontWeight: 800, color: C.accent }, "."),
      text({ fontSize: 22, fontWeight: 800 }, "com"),
    ]),
    trailing,
  ]);

/** The pill in the top-right: remote status when there is one, else a place. */
function pill(job: Job): El | null {
  const remote = job.remoteType === "remote" || job.remoteType === "hybrid";
  const label = remote ? remoteLabel(job.remoteType) : shortLocation(job);
  if (!label) return null;
  return text(
    {
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      padding: "9px 18px",
      borderRadius: 999,
      border: `1px solid ${job.remoteType === "remote" ? "rgba(56,211,159,0.34)" : C.border}`,
      backgroundColor: job.remoteType === "remote" ? "rgba(56,211,159,0.09)" : C.surface,
      color: job.remoteType === "remote" ? C.green : C.muted,
    },
    label,
  );
}

/** Location and seniority under the company name — the card's fine print. */
function subLine(job: Job): string | null {
  const bits = [shortLocation(job), seniorityLabel(job.seniority)].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

export interface CardInput {
  job: Job;
  /** Data URI for the company logo, or null to draw the monogram instead. */
  logoUri: string | null;
  fxRates?: Record<string, number>;
}

/**
 * The share card for one role: what a link to /jobs/<slug>/ turns into when
 * someone posts it.
 *
 * Pay is the loudest element on purpose. It is the board's whole pitch, and in a
 * timeline a number stops a scroll where a job title does not — so where a role
 * publishes one it gets the weight, and where it doesn't the row simply belongs
 * to the skills instead. Nothing here announces an absence: a card that says
 * "salary not stated" advertises the wrong thing.
 */
export function jobCard({ job, logoUri, fxRates }: CardInput): El {
  const title = fitTitle(job.title);
  const pay = formatSalary(job, fxRates);
  const payParts = pay ? splitPay(pay) : null;
  const sub = subLine(job);

  // Chips share the bottom row with the salary, so they get what it leaves.
  const payWidth = pay ? estWidth(pay, 40, 0.62) : 0;
  const chips = fitChips(job.skills, CONTENT_WIDTH - payWidth - (pay ? 40 : 0));

  return col(
    {
      width: "100%",
      height: "100%",
      padding: PAD,
      // Flat, deliberately. The site's own ground carries a faint radial wash and
      // the card had one to match, but a smooth gradient is the one thing PNG
      // cannot compress: it took the average card from 37KB to 66KB, which over
      // a build is ~50MB of published bytes for a gradation nobody resolves at
      // the size an unfurl renders.
      backgroundColor: C.bg,
      color: C.text,
      fontFamily: "Inter",
    },
    [
      brandRow(pill(job)),

      // The title takes the whole middle and centres in it, rather than sitting
      // under the brand row with the slack below. Facts stay pinned to the
      // bottom edge either way, so a one-line title and a three-line one agree
      // on where the company row sits — but a short title now reads as centred
      // instead of as a card with a hole in it.
      col({ flexGrow: 1, justifyContent: "center", paddingTop: 28, paddingBottom: 28 }, [
        text(
          {
            fontSize: title.fontSize,
            fontWeight: 800,
            lineHeight: 1.11,
            letterSpacing: "-0.026em",
          },
          title.text,
        ),
      ]),

      row({ alignItems: "center", marginBottom: 30 }, [
        logoUri
          ? {
              type: "img",
              props: {
                src: logoUri,
                width: 60,
                height: 60,
                style: { borderRadius: 12, backgroundColor: C.plate, objectFit: "contain" },
              },
            }
          : text(
              {
                width: 60,
                height: 60,
                borderRadius: 12,
                backgroundColor: C.surface,
                border: `1px solid ${C.border}`,
                color: C.muted,
                fontSize: 28,
                fontWeight: 800,
                alignItems: "center",
                justifyContent: "center",
              },
              job.companyName.trim().slice(0, 1).toUpperCase() || "?",
            ),
        col({ marginLeft: 18 }, [
          text({ fontSize: 27, fontWeight: 600, letterSpacing: "-0.008em" }, job.companyName),
          sub && text({ fontSize: 20, color: C.muted, marginTop: 4 }, sub),
        ]),
      ]),

      { type: "div", props: { style: { display: "flex", height: 1, backgroundColor: C.border } } },

      row({ alignItems: "center", justifyContent: "space-between", marginTop: 28 }, [
        payParts
          ? row({ alignItems: "baseline" }, [
              text(
                { fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", color: C.green },
                payParts.amount,
              ),
              payParts.period &&
                text({ fontSize: 20, fontWeight: 400, color: C.muted, marginLeft: 6 }, payParts.period),
            ])
          : null,
        row(
          {},
          chips.map((skill, i) =>
            text(
              {
                fontSize: 19,
                fontWeight: 400,
                color: C.muted,
                backgroundColor: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 9,
                padding: "8px 14px",
                // No leading margin: fitChips budgets a gap only *between*
                // chips, so one here would spend 10px it never accounted for.
                marginLeft: i ? 10 : 0,
              },
              skill,
            ),
          ),
        ),
      ]),
    ],
  );
}

/**
 * The fallback card for a whole cluster, used by roles too old for one of their
 * own (see lib/og/policy.ts).
 *
 * Deliberately carries no counts or dates. It is generated once and then cached
 * by whichever platform fetched it, for as long as that platform feels like —
 * so anything on it that could go out of date would, silently, on someone
 * else's timeline.
 */
export function clusterCard(cluster: SkillCluster): El {
  return col(
    {
      width: "100%",
      height: "100%",
      padding: PAD,
      backgroundColor: C.bg,
      color: C.text,
      fontFamily: "Inter",
    },
    [
      brandRow(null),

      col({ flexGrow: 1, justifyContent: "center", paddingTop: 28, paddingBottom: 28 }, [
        text(
          { fontSize: 58, fontWeight: 800, lineHeight: 1.11, letterSpacing: "-0.026em" },
          cluster.label,
        ),
        text({ fontSize: 27, fontWeight: 400, color: C.muted, marginTop: 18 }, "AI engineering roles"),
      ]),

      { type: "div", props: { style: { display: "flex", height: 1, backgroundColor: C.border } } },

      row({ alignItems: "center", marginTop: 28 }, [
        text({ fontSize: 22, fontWeight: 600, color: C.green }, "First-party listings"),
        text({ fontSize: 22, fontWeight: 400, color: C.muted, marginLeft: 10 }, "· straight from the employer's ATS"),
      ]),
    ],
  );
}
