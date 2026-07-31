import { defineConfig } from "astro/config";

// Served at the apex of its own domain (GitHub Pages custom domain; the CNAME
// file ships from site/public). `base` is still threaded through internal links
// via src/lib/url.ts, so the indirection survives if the site ever moves under a
// path again. The old alastairrushworth.com/aiengjobs/* URLs 301 here.
export default defineConfig({
  site: "https://frontierroles.com",
  base: "/",
  output: "static",
  trailingSlash: "ignore",
});
