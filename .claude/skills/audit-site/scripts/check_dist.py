#!/usr/bin/env python3
"""Sweep a built site/dist and report what a crawler would trip over.

    python3 -I .claude/skills/audit-site/scripts/check_dist.py site/dist

Hard issues (exit 1): broken internal links, sitemap ≠ indexable self-canonical
pages, a canonical pointing at a missing/noindexed page or a chain, JSON-LD
that doesn't parse, JobPosting markup on a noindexed or duplicate page, a
JobPosting whose validThrough outlives the 90-day age-out, a page without
exactly one <h1>, duplicate titles/descriptions among indexable pages, an RSS
feed that doesn't parse or lists a noindexed page.

Everything else is printed as context for the report (sizes, node counts,
title lengths, JobPosting field gaps). Stdlib only, ~15s on ~7.5k pages.
"""
import collections
import datetime as dt
import glob
import json
import os
import re
import sys
from html.parser import HTMLParser
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET

SITE = "https://frontierroles.com"
MAX_JOB_AGE_DAYS = 90  # shared/indexable.ts
SITEMAP_JOB_MAX_AGE_DAYS = 30  # site/src/lib/sitemap.ts — older roles are indexable but unlisted


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.jsonld, self.headings = [], [], []
        self.meta, self.canon, self.prevnext = {}, None, {}
        self.title, self.nodes = "", 0
        self._in_title = self._in_ld = False
        self._ld = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.nodes += 1
        if tag == "title":
            self._in_title = True
        elif tag == "meta" and (a.get("name") or a.get("property")):
            self.meta.setdefault(a.get("name") or a.get("property"), []).append(a.get("content"))
        elif tag == "link":
            rel = a.get("rel", "")
            if rel == "canonical":
                self.canon = a.get("href")
            if rel in ("prev", "next"):
                self.prevnext[rel] = a.get("href")
            if a.get("href"):
                self.links.append(a["href"])
        elif tag == "a" and a.get("href") is not None:
            self.links.append(a["href"])
        elif tag in ("img", "script") and a.get("src"):
            self.links.append(a["src"])
        if re.fullmatch(r"h[1-6]", tag):
            self.headings.append(int(tag[1]))
        if tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld, self._ld = True, ""

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag == "script" and self._in_ld:
            self._in_ld = False
            self.jsonld.append(self._ld)

    def handle_data(self, d):
        if self._in_title:
            self.title += d
        if self._in_ld:
            self._ld += d


def main(dist):
    files = set()
    for root, _, fs in os.walk(dist):
        for f in fs:
            files.add("/" + os.path.relpath(os.path.join(root, f), dist))

    def resolves(path):
        path = unquote(path)
        p = path.rstrip("/")
        return path in files or f"{p}/index.html" in files or (path == "/" and "/index.html" in files)

    hard = collections.defaultdict(list)
    pages, nlinks = {}, 0
    for f in sorted(x for x in files if x.endswith(".html")):
        p = Page()
        p.feed(open(dist + f, encoding="utf-8").read())
        route = f[: -len("index.html")] if f.endswith("/index.html") else f
        for href in p.links:
            u = urlparse(href)
            # Fragment-only (#main), external, protocol-relative and mailto: are not ours.
            if href.startswith(("#", "mailto:", "tel:", "data:", "//")) or (u.scheme and u.netloc != "frontierroles.com"):
                continue
            if not u.scheme and not href.startswith("/"):
                hard["relative href (unexpected)"].append(f"{route} → {href}")
                continue
            nlinks += 1
            if u.path and not resolves(u.path):
                hard["broken internal link"].append(f"{route} → {u.path}")
        lds = []
        for raw in p.jsonld:
            try:
                lds.append(json.loads(raw))
            except ValueError as e:
                hard["JSON-LD parse error"].append(f"{route}: {e}")
        pages[route] = dict(
            title=p.title, desc=(p.meta.get("description") or [None])[0],
            noindex=bool(p.meta.get("robots")), canon=p.canon, prevnext=p.prevnext,
            h1=p.headings.count(1), jsonld=lds, nodes=p.nodes,
            size=os.path.getsize(dist + f),
        )

    for r, p in pages.items():
        if p["h1"] != 1:
            hard["h1 count != 1"].append(f"{r} ({p['h1']})")
        c = (p["canon"] or "").replace(SITE, "")
        if r != "/404.html" and c != r:
            t = pages.get(c)
            if not t:
                hard["canonical target missing"].append(f"{r} → {c}")
            elif t["noindex"]:
                hard["canonical target noindexed"].append(f"{r} → {c}")
            elif t["canon"] != p["canon"]:
                hard["canonical chain"].append(f"{r} → {c} → {t['canon']}")
        for rel, href in p["prevnext"].items():
            if not href.endswith("/") or href.replace(SITE, "") not in pages:
                hard[f"bad rel={rel}"].append(f"{r} → {href}")

    indexable = {SITE + r for r, p in pages.items() if not p["noindex"] and p["canon"] == SITE + r}
    for field in ("title", "desc"):
        seen = collections.defaultdict(list)
        for r, p in pages.items():
            if SITE + r in indexable:
                seen[p[field]].append(r)
        for v, rs in seen.items():
            if len(rs) > 1:
                hard[f"duplicate {field}"].append(f"{v!r}: {rs[:3]}")

    # sitemap.xml is an index (lib/sitemap.ts); follow it to the files it names.
    # A flat urlset still works, so an older build checks the same way.
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    root = ET.parse(f"{dist}/sitemap.xml").getroot()
    if root.tag.endswith("sitemapindex"):
        sitemap_files = [f"{dist}/{urlparse(s.find('s:loc', ns).text).path.lstrip('/')}" for s in root]
    else:
        sitemap_files = [f"{dist}/sitemap.xml"]
    locs, lastmods = set(), []
    for f in sitemap_files:
        for u in ET.parse(f).getroot():
            locs.add(u.find("s:loc", ns).text)
            lm = u.find("s:lastmod", ns)
            if lm is not None:
                lastmods.append(lm.text)
    # The export moment, as near as the sitemap states it: the newest lastmod is
    # the snapshot's date, and the export happened some hours into it, so the
    # end of that day is the bound that errs towards excusing rather than
    # failing a page on the window's edge (see the age test below).
    today = (
        dt.datetime.fromisoformat(max(lastmods)).replace(tzinfo=dt.timezone.utc) + dt.timedelta(days=1)
        if lastmods
        else None
    )
    for u in sorted(locs - indexable):
        hard["sitemap URL not indexable"].append(u)
    unlisted_old = 0
    for u in sorted(indexable - locs):
        r = u.replace(SITE, "")
        if r.startswith("/jobs/"):
            # Job pages past the sitemap window are indexable and linked but
            # deliberately unlisted. The page's own JobPosting dates it; a
            # role without one (no resolvable country) can't be dated here, so
            # it gets the benefit of the doubt rather than a false failure.
            jp = next((b for b in pages[r]["jsonld"] if b.get("@type") == "JobPosting"), None)
            if jp is None:
                unlisted_old += 1
                continue
            posted = dt.datetime.fromisoformat(jp["datePosted"].replace("Z", "+00:00"))
            if posted.tzinfo is None:
                posted = posted.replace(tzinfo=dt.timezone.utc)
            # The sitemap measures fractional days against the export's
            # timestamp; this only knows its date, so the bound is loose by up
            # to a day on purpose — a role the sitemap dropped at 30.2 days
            # must not fail here for reading as 29 whole days before midnight.
            if today and (today - posted).days >= SITEMAP_JOB_MAX_AGE_DAYS:
                unlisted_old += 1
                continue
        hard["indexable page missing from sitemap"].append(u)

    jp_total, no_locality = 0, 0
    for r, p in pages.items():
        for b in p["jsonld"]:
            if b.get("@type") != "JobPosting":
                continue
            jp_total += 1
            if p["noindex"] or p["canon"] != SITE + r:
                hard["JobPosting on noindexed/duplicate page"].append(r)
            missing = [k for k in ("title", "description", "datePosted", "hiringOrganization", "validThrough") if not b.get(k)]
            if missing:
                hard["JobPosting missing required field"].append(f"{r}: {missing}")
                continue
            posted = dt.datetime.fromisoformat(b["datePosted"].replace("Z", "+00:00"))
            if posted.tzinfo is None:
                posted = posted.replace(tzinfo=dt.timezone.utc)
            valid = dt.datetime.fromisoformat(b["validThrough"].replace("Z", "+00:00"))
            if valid > posted + dt.timedelta(days=MAX_JOB_AGE_DAYS, seconds=1):
                hard["validThrough past the 90-day age-out"].append(r)
            loc = b.get("jobLocation")
            if loc and not loc["address"].get("addressLocality"):
                no_locality += 1

    feeds = glob.glob(f"{dist}/**/rss.xml", recursive=True)
    items = 0
    for f in feeds:
        try:
            for it in ET.parse(f).getroot().iter("item"):
                items += 1
                r = it.find("link").text.replace(SITE, "")
                if r not in pages or pages[r]["noindex"]:
                    hard["feed item not an indexable page"].append(f"{f}: {r}")
        except ET.ParseError as e:
            hard["feed does not parse"].append(f"{f}: {e}")

    kinds = collections.Counter()
    for r in pages:
        k = r.split("/")[1] if r.count("/") > 1 else r
        kinds["job" if k == "jobs" else "company" if k == "companies" else "landing/other"] += 1
    biggest = sorted(((p["size"], p["nodes"], r) for r, p in pages.items()), reverse=True)[:3]
    print(f"pages {len(pages)} ({dict(kinds)}) · files {len(files)}")
    print(
        f"internal links checked {nlinks} · sitemap URLs {len(locs)} in {len(sitemap_files)} file(s)"
        f" · indexable {len(indexable)} · indexable job pages past the sitemap window {unlisted_old}"
    )
    print(f"JobPostings {jp_total} · without addressLocality {no_locality} · feeds {len(feeds)} with {items} items")
    print("largest pages:", ", ".join(f"{r} {s // 1024}KB/{n} nodes" for s, n, r in biggest))
    if hard:
        for k, v in hard.items():
            print(f"FAIL {k}: {len(v)}")
            for x in v[:5]:
                print(f"     {x}")
        return 1
    print("OK — no hard issues")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "site/dist"))
