#!/usr/bin/env python3
# Writes test/crypto/vectors.json from the ground-truth vectors in
# crypto_reference.py. Not committed: check.sh regenerates it before every run, so
# crypto.test.js always tests against the current crypto_reference.py.
# Run: python3 test/crypto/gen.py
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import crypto_reference  # noqa: E402

with open(os.path.join(HERE, "vectors.json"), "w", encoding="utf-8") as f:
    json.dump(crypto_reference.vectors(), f, ensure_ascii=False, indent=2)

print("wrote vectors.json")
