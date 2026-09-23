#!/usr/bin/env python3
# Checks FileSender credentials with a read-only signed call (GET /user/@me),
# using the same signing as filesender.py call().
# Usage: FS_APIKEY=... python3 tools/auth_check.py <base_url> <remote_user>
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def flatten(d):
    return sorted(k + "=" + v for k, v in d.items() if v is not None)


def main():
    if len(sys.argv) != 3 or not os.environ.get("FS_APIKEY"):
        sys.exit(
            "usage: FS_APIKEY=... python3 tools/auth_check.py <base_url> <remote_user>"
        )
    base_url = sys.argv[1].rstrip("/")
    if not base_url.endswith("/rest.php"):
        base_url += "/rest.php"
    username = sys.argv[2]
    apikey = os.environ["FS_APIKEY"].strip()
    path = "/user/@me"

    data = {"remote_user": username, "timestamp": str(round(time.time()))}
    host_path = base_url.replace("https://", "", 1).replace("http://", "", 1) + path
    signed = ("get&" + host_path + "?" + "&".join(flatten(data))).encode("ascii")
    data["signature"] = hmac.new(
        bytearray(map(ord, apikey)), signed, hashlib.sha1
    ).hexdigest()
    query = "&".join(
        urllib.parse.quote(k) + "=" + urllib.parse.quote(v)
        for k, v in (item.split("=", 1) for item in flatten(data))
    )
    url = base_url + path + "?" + query

    print("signed :", signed.decode())
    print("apikey :", apikey[:4] + "…" + apikey[-2:], f"({len(apikey)})")
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read() or b"null")
            print("HTTP", r.status, "OK")
            if isinstance(body, dict):
                for k in ("id", "saml_user_identification_uid", "email", "name"):
                    if k in body:
                        print(" ", k, "=", body[k])
            else:
                print(body)
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode(errors="replace")[:500])
        sys.exit(1)


main()
