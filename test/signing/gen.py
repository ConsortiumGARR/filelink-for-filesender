#!/usr/bin/env python3
# Writes test/signing/vectors.json from the ground-truth vectors in reference.py.
# Not committed: check.sh regenerates it before every run, so signing.test.js always
# tests against the current reference.py, never a stale copy.
# Run: python3 test/signing/gen.py
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reference  # noqa: E402

vectors = {
    "baseUrl": reference.BASE_URL,
    "username": reference.USERNAME,
    "apikey": reference.APIKEY,
    "timestamp": reference.TIMESTAMP,
    "cases": reference.CASES,
}

with open(os.path.join(HERE, "vectors.json"), "w", encoding="utf-8") as f:
    json.dump(vectors, f, ensure_ascii=False, indent=2)

print(f"wrote vectors.json ({len(reference.CASES)} cases)")
