/**
 * Serialize structured data for a JSON-LD <script> body.
 *
 * JSON.stringify escapes quotes but NOT `<`, `>` or `&` — so an untrusted string
 * (job titles and company names come straight from third-party ATS feeds) that
 * contains `</script>` would close the inline script early and execute injected
 * markup. Escape those characters to \uXXXX, which is valid JSON and inert HTML.
 * Every `set:html` JSON-LD block must go through this helper.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
