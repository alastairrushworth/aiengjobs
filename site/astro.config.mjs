import { defineConfig } from "astro/config";

// Served under alastairrushworth.com/aiengjobs/ (the account's custom domain;
// github.io 301-redirects there). `base` is threaded through internal links via
// src/lib/url.ts. A dedicated domain later means dropping base to "/" + new `site`.
export default defineConfig({
  site: "https://alastairrushworth.com",
  base: "/aiengjobs",
  output: "static",
  trailingSlash: "ignore",
});
