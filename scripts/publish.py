#!/usr/bin/env python3
"""Validate a Dispatch edition and publish it into data/.

Usage:
    python3 scripts/publish.py path/to/draft.json      # validate + publish
    python3 scripts/publish.py --check path/to/draft.json   # validate only
    python3 scripts/publish.py --reindex                # rebuild index.json + latest.json

Publishing writes:
    data/editions/YYYY-MM-DD.json   the edition
    data/latest.json                copy of the newest edition
    data/index.json                 list of all editions, newest first

Exits non-zero and prints every problem if the draft is invalid.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EDITIONS = DATA / "editions"

SECTIONS = {"World", "Tech & Business"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def words(text):
    return len(str(text).split())


def check_text(errors, where, value, max_words=None, min_words=1):
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{where}: must be a non-empty string")
        return
    n = words(value)
    if n < min_words:
        errors.append(f"{where}: too short ({n} words)")
    if max_words and n > max_words:
        errors.append(f"{where}: too long ({n} words, max {max_words})")
    if "<" in value and ">" in value:
        errors.append(f"{where}: must be plain text, no HTML")


def check_url(errors, where, url):
    try:
        p = urlparse(url)
    except Exception:
        p = None
    if not p or p.scheme != "https" or not p.netloc:
        errors.append(f"{where}: must be a full https:// URL (got {url!r})")


def validate(ed):
    errors = []
    if not isinstance(ed, dict):
        return ["edition must be a JSON object"]

    d = ed.get("date")
    if not isinstance(d, str) or not DATE_RE.match(d):
        errors.append("date: must be YYYY-MM-DD")
    else:
        try:
            date.fromisoformat(d)
        except ValueError:
            errors.append("date: not a real date")

    if not isinstance(ed.get("published"), str) or "T" not in ed.get("published", ""):
        errors.append("published: must be an ISO timestamp like 2026-11-14T08:00:00+02:00")

    check_text(errors, "summary", ed.get("summary"), max_words=30, min_words=8)

    stories = ed.get("stories")
    if not isinstance(stories, list) or not (6 <= len(stories) <= 14):
        errors.append("stories: need between 6 and 14 stories")
        stories = stories if isinstance(stories, list) else []

    ids = set()
    counts = {s: 0 for s in SECTIONS}
    for i, s in enumerate(stories):
        w = f"stories[{i}]"
        if not isinstance(s, dict):
            errors.append(f"{w}: must be an object")
            continue
        sid = s.get("id")
        if not isinstance(sid, str) or not ID_RE.match(sid):
            errors.append(f"{w}.id: lowercase words joined by hyphens, e.g. 'iran-talks'")
        elif sid in ids:
            errors.append(f"{w}.id: duplicate id {sid!r}")
        else:
            ids.add(sid)
        w = f"stories[{i}] ({sid})"
        if s.get("section") not in SECTIONS:
            errors.append(f"{w}.section: must be one of {sorted(SECTIONS)}")
        else:
            counts[s["section"]] += 1
        check_text(errors, f"{w}.region", s.get("region"), max_words=4)
        check_text(errors, f"{w}.headline", s.get("headline"), max_words=13, min_words=4)
        check_text(errors, f"{w}.dek", s.get("dek"), max_words=18, min_words=5)
        for key, lo, hi, maxw in (("what", 2, 3, 28), ("background", 1, 1, 45)):
            items = s.get(key)
            if not isinstance(items, list) or not (lo <= len(items) <= hi):
                errors.append(f"{w}.{key}: need {lo}-{hi} item(s)" if lo != hi else f"{w}.{key}: need exactly {lo} item")
                continue
            for j, p in enumerate(items):
                check_text(errors, f"{w}.{key}[{j}]", p, max_words=maxw, min_words=6)
        check_text(errors, f"{w}.why", s.get("why"), max_words=30, min_words=6)
        check_text(errors, f"{w}.say", s.get("say"), max_words=22, min_words=5)
        body = [s.get("dek"), s.get("why"), s.get("say")] + list(s.get("what") or []) + list(s.get("background") or [])
        total = sum(words(x) for x in body if isinstance(x, str))
        if total > 170:
            errors.append(f"{w}: story is {total} words; keep it under 170 (cut filler, not facts)")
        terms = s.get("terms", [])
        if not isinstance(terms, list) or len(terms) > 2:
            errors.append(f"{w}.terms: list of at most 2")
        else:
            for j, t in enumerate(terms):
                if not isinstance(t, dict):
                    errors.append(f"{w}.terms[{j}]: must be an object")
                    continue
                check_text(errors, f"{w}.terms[{j}].term", t.get("term"), max_words=5)
                check_text(errors, f"{w}.terms[{j}].def", t.get("def"), max_words=22, min_words=4)
        srcs = s.get("sources")
        if not isinstance(srcs, list) or len(srcs) < 2:
            errors.append(f"{w}.sources: need at least 2 sources")
        else:
            for j, src in enumerate(srcs):
                if not isinstance(src, dict):
                    errors.append(f"{w}.sources[{j}]: must be an object")
                    continue
                check_text(errors, f"{w}.sources[{j}].name", src.get("name"), max_words=8)
                check_url(errors, f"{w}.sources[{j}].url", src.get("url"))

    if stories and counts["World"] < 4:
        errors.append("stories: need at least 4 World stories")
    if stories and counts["Tech & Business"] < 2:
        errors.append("stories: need at least 2 Tech & Business stories")

    briefs = ed.get("briefs", [])
    if not isinstance(briefs, list) or len(briefs) > 6:
        errors.append("briefs: list of at most 6")
    else:
        for i, b in enumerate(briefs):
            if not isinstance(b, dict):
                errors.append(f"briefs[{i}]: must be an object")
                continue
            check_text(errors, f"briefs[{i}].text", b.get("text"), max_words=30, min_words=5)
            src = b.get("source")
            if not isinstance(src, dict):
                errors.append(f"briefs[{i}].source: must be an object with name and url")
            else:
                check_text(errors, f"briefs[{i}].source.name", src.get("name"), max_words=8)
                check_url(errors, f"briefs[{i}].source.url", src.get("url"))

    quiz = ed.get("quiz")
    if not isinstance(quiz, list) or not (3 <= len(quiz) <= 6):
        errors.append("quiz: need 3-6 questions")
    else:
        for i, q in enumerate(quiz):
            w = f"quiz[{i}]"
            if not isinstance(q, dict):
                errors.append(f"{w}: must be an object")
                continue
            check_text(errors, f"{w}.q", q.get("q"), max_words=30, min_words=4)
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) != 4:
                errors.append(f"{w}.options: need exactly 4 options")
            else:
                for j, o in enumerate(opts):
                    check_text(errors, f"{w}.options[{j}]", o, max_words=14)
                if len(set(opts)) != 4:
                    errors.append(f"{w}.options: options must all differ")
            a = q.get("answer")
            if not isinstance(a, int) or not (0 <= a <= 3):
                errors.append(f"{w}.answer: index 0-3 of the correct option")
            check_text(errors, f"{w}.explain", q.get("explain"), max_words=40, min_words=4)
            if q.get("story") not in ids:
                errors.append(f"{w}.story: must be the id of a story in this edition")
    return errors


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def reindex():
    entries = []
    for p in sorted(EDITIONS.glob("*.json"), reverse=True):
        ed = load(p)
        entries.append({
            "date": ed["date"],
            "summary": ed["summary"],
            "stories": len(ed["stories"]),
            "lead": ed["stories"][0]["headline"],
        })
    if not entries:
        sys.exit("no editions found")
    write_json(DATA / "index.json", {"editions": entries})
    newest = load(EDITIONS / f"{entries[0]['date']}.json")
    write_json(DATA / "latest.json", newest)
    return entries


def main(argv):
    if argv[:1] == ["--reindex"]:
        entries = reindex()
        print(f"Reindexed {len(entries)} editions; latest is {entries[0]['date']}.")
        return 0
    check_only = False
    if argv[:1] == ["--check"]:
        check_only = True
        argv = argv[1:]
    if len(argv) != 1:
        print(__doc__)
        return 2
    try:
        ed = load(argv[0])
    except (OSError, json.JSONDecodeError) as e:
        print(f"Could not read {argv[0]}: {e}")
        return 1
    errors = validate(ed)
    if errors:
        print(f"INVALID: {len(errors)} problem(s):")
        for e in errors:
            print(f"  - {e}")
        return 1
    if check_only:
        print(f"OK: {ed['date']} with {len(ed['stories'])} stories, {len(ed.get('briefs', []))} briefs, {len(ed['quiz'])} quiz questions.")
        return 0
    write_json(EDITIONS / f"{ed['date']}.json", ed)
    entries = reindex()
    print(f"Published {ed['date']} ({len(ed['stories'])} stories). {len(entries)} editions in archive; latest is {entries[0]['date']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
