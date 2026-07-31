export const USER_AGENT =
  "aiengjobs-bot/0.1 (+https://frontierroles.com)";

// Entity decoding + tag stripping live in shared/ so the engine (ingest) and
// the site (render) can never drift apart.
export { decodeEntities, stripHtml } from "@aiengjobs/shared/text";
