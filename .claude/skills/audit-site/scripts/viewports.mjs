// Render pages at real viewports in headless Chrome and report horizontal
// overflow (with the elements causing it), sub-24px tap targets, input font
// sizes and JS exceptions. The §8 fallback for when claude-in-chrome isn't
// connected; Node 24's built-in WebSocket, no dependencies.
//
//   python3 -m http.server 4329 --bind 127.0.0.1 --directory site/dist &
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//     --remote-debugging-port=9333 --user-data-dir=<scratch>/chrome --hide-scrollbars &
//   node viewports.mjs <shots-dir> '["/","/ai-agent-jobs/2/"]' '[320,360,768,1680]' '["/@360"]'
//
// The last argument names page@width pairs to screenshot into <shots-dir>.
// BASE / DEVTOOLS override the two ports.
import fs from "node:fs";
const [,, outDir, pagesArg, widthsArg, shotsArg] = process.argv;
const BASE = process.env.BASE ?? "http://127.0.0.1:4329";
const DEVTOOLS = process.env.DEVTOOLS ?? "http://127.0.0.1:9333";
const pages = JSON.parse(pagesArg), widths = JSON.parse(widthsArg), shotPairs = new Set(JSON.parse(shotsArg||"[]"));
const tgt = await (await fetch(`${DEVTOOLS}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else listeners.forEach((l) => l(d)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable"); await send("Runtime.enable");
const errors = [];
listeners.push((d) => { if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description?.slice(0,200)); });
const probe = `(() => {
  const W = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const offenders = [];
  if (sw > W) for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > W + 1 && getComputedStyle(el).position !== "fixed") {
      let p = el.parentElement, clipped = false;
      while (p) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { clipped = true; break; } p = p.parentElement; }
      if (!clipped) offenders.push((el.tagName + "." + [...el.classList].join(".")).slice(0,60) + " r=" + Math.round(r.right) + " '" + (el.textContent||"").trim().slice(0,40) + "'");
    }
  }
  const small = [];
  for (const el of document.querySelectorAll("a, button, select, input, summary")) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (!r.width || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
    if (el.classList.contains("skip-link")) continue;
    if (r.height < 24 || r.width < 24) small.push((el.tagName + "." + [...el.classList].join(".")).slice(0,40) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " '" + (el.textContent||"").trim().slice(0,20) + "'");
  }
  const inputs = [...document.querySelectorAll("input, select")].filter(e => e.getBoundingClientRect().width).map(e => (e.id||e.tagName) + ":" + getComputedStyle(e).fontSize);
  const agg = Object.fromEntries(small.map((s) => [s, 1]));
  return JSON.stringify({ W, sw, offenders: offenders.slice(0, 8), smallTargets: Object.entries(agg).slice(0, 12), inputs, h: document.documentElement.scrollHeight });
})()`;
const results = {};
for (const p of pages) for (const w of widths) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 850, deviceScaleFactor: 1, mobile: w < 800 });
  const loaded = new Promise((r) => { const l = (d) => { if (d.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(l), 1); r(); } }; listeners.push(l); });
  await send("Page.navigate", { url: BASE + p });
  await loaded; await new Promise((r) => setTimeout(r, 400));
  const res = await send("Runtime.evaluate", { expression: probe, returnByValue: true });
  results[p + " @" + w] = JSON.parse(res.result.result.value);
  if (shotPairs.has(p + "@" + w)) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${outDir}/${p.replace(/[^a-z0-9]+/gi, "_").slice(0,60)}_${w}.png`, Buffer.from(shot.result.data, "base64"));
  }
}
console.log(JSON.stringify({ results, errors }, null, 1));
ws.close(); await fetch(`${DEVTOOLS}/json/close/${tgt.id}`);
