#!/usr/bin/env python3
# Static checks: translations (same keys in every locale, no missing or unused
# key, declared placeholders), valid manifest JSON, and every file referenced by
# the manifest exists in src/. JS syntax is checked separately, in
# test/static/syntax.test.js (Node, no gi/JavaScriptCore needed here).
# Usage: python3 test/static/static_check.py
import glob
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JS = sorted(
    os.path.relpath(p, ROOT)
    for p in glob.glob(os.path.join(ROOT, "src", "**", "*.js"), recursive=True)
)
HTML = sorted(
    os.path.relpath(p, ROOT)
    for p in glob.glob(os.path.join(ROOT, "src", "**", "*.html"), recursive=True)
)
KEY_RE = re.compile(r"'((?:opt|mgmt|err|ntf|reuse|ext|cleanup)[A-Z]?\w*)'")
problems = []


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


manifest = json.loads(read("src/manifest.json"))
locales = {}
for p in sorted(glob.glob(os.path.join(ROOT, "src", "_locales", "*", "messages.json"))):
    locales[os.path.basename(os.path.dirname(p))] = json.load(open(p, encoding="utf-8"))
base = locales.get(manifest.get("default_locale", "en"), {})
for lang, msgs in locales.items():
    if set(msgs) != set(base):
        problems.append(
            f"locale {lang}: keys differ from default ({sorted(set(msgs) ^ set(base))})"
        )
    for k, v in msgs.items():
        for tok in re.findall(r"\$(\w+)\$", v["message"]):
            if tok.lower() not in v.get("placeholders", {}):
                problems.append(f"locale {lang}: {k} uses ${tok}$ without placeholder")

src = "".join(read(f) for f in JS)
html = "".join(read(f) for f in HTML)
used = set(KEY_RE.findall(src)) | set(re.findall(r'data-i18n="(\w+)"', html))
used |= set(re.findall(r"__MSG_(\w+)__", read("src/manifest.json")))
used |= set(re.findall(r"\bt\(\s*'(\w+)'", src))
used = {
    k
    for k in used
    if k in base or re.match(r"(opt|mgmt|err|ntf|reuse|cleanup)[A-Z]", k)
}
missing = sorted(used - set(base))
unused = sorted(set(base) - used)
if missing:
    problems.append(f"i18n keys used but missing: {missing}")
if unused:
    problems.append(f"i18n keys never used: {unused}")

referenced = list(manifest["background"]["scripts"])
referenced += list(manifest.get("icons", {}).values())
referenced.append(manifest["cloud_file"]["management_url"])
background = "".join(read("src/" + s) for s in manifest["background"]["scripts"])
referenced += re.findall(r"openPopup\(\s*'([\w./-]+\.html)", background)
referenced += re.findall(r"service_icon: '([\w./-]+)'", background)
for page in HTML:
    base_dir = os.path.dirname(os.path.relpath(page, "src"))
    for ref in re.findall(r'(?:src|href)="([\w./-]+\.(?:js|css))"', read(page)):
        referenced.append(os.path.normpath(os.path.join(base_dir, ref)))
for f in referenced:
    if not os.path.exists(os.path.join(ROOT, "src", f)):
        problems.append(f"missing file referenced from the extension: src/{f}")

for p in problems:
    print("FAIL", p)
print("RESULT:", "ALL PASS" if not problems else f"{len(problems)} FAILED")
raise SystemExit(1 if problems else 0)
