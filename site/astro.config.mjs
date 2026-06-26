import { defineConfig } from "astro/config";

// Project Pages site is served under /aiengjobs/. The `base` is threaded
// through internal links via src/lib/url.ts; switching to a custom domain
// later means setting base back to "/" and updating `site`.
export default defineConfig({
  site: "https://alastairrushworth.github.io",
  base: "/aiengjobs",
  output: "static",
  trailingSlash: "ignore",
});
