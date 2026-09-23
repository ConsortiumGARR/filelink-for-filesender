#!/usr/bin/env python3
# Generates test/sign-test.html (self-contained) and test/vectors.json
# from the ground-truth vectors in reference.py, inlining the current
# src/lib/filesender.js so the page always exercises the live library.
# Run: python3 test/gen.py
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import crypto_reference  # noqa: E402

import reference  # noqa: E402

vectors = {
    "baseUrl": reference.BASE_URL,
    "username": reference.USERNAME,
    "apikey": reference.APIKEY,
    "timestamp": reference.TIMESTAMP,
    "cases": reference.CASES,
}

with open(os.path.join(HERE, "sign-test.tpl.html"), encoding="utf-8") as f:
    html = f.read()
with open(
    os.path.join(HERE, "..", "src", "lib", "filesender.js"), encoding="utf-8"
) as f:
    lib = f.read()

payload = json.dumps(vectors, ensure_ascii=False).replace("</", "<\\/")
lib_safe = lib.replace("</script", "<\\/script")

out = html.replace("__VECTORS__", payload).replace("__LIB__", lib_safe)
with open(os.path.join(HERE, "sign-test.html"), "w", encoding="utf-8") as f:
    f.write(out)

with open(os.path.join(HERE, "vectors.json"), "w", encoding="utf-8") as f:
    json.dump(vectors, f, ensure_ascii=False, indent=2)

print(f"wrote sign-test.html and vectors.json ({len(reference.CASES)} cases)")


with open(os.path.join(HERE, "crypto-test.tpl.html"), encoding="utf-8") as f:
    chtml = f.read()
with open(os.path.join(HERE, "..", "src", "lib", "fscrypto.js"), encoding="utf-8") as f:
    clib = f.read().replace("</script", "<\\/script")
cpayload = json.dumps(crypto_reference.vectors()).replace("</", "<\\/")
with open(os.path.join(HERE, "crypto-test.html"), "w", encoding="utf-8") as f:
    f.write(chtml.replace("__VECTORS__", cpayload).replace("__LIB__", clib))
print("wrote crypto-test.html")
