// Prefix an internal path with the configured base path ("/" today, since the
// site sits at its domain apex — kept for the day it doesn't).
// Astro exposes the base as import.meta.env.BASE_URL (with a trailing slash).
const BASE = import.meta.env.BASE_URL;

export function url(path = "/"): string {
  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  const p = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}` || "/";
}
