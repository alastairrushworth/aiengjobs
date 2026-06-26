// Prefix an internal path with the configured base path (e.g. "/aiengjobs").
// Astro exposes the base as import.meta.env.BASE_URL (with a trailing slash).
const BASE = import.meta.env.BASE_URL;

export function url(path = "/"): string {
  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  const p = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}` || "/";
}
