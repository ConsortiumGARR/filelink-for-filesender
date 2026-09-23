#!/usr/bin/env python3
# Reference signer: faithful copy of the signing logic in filesender.py `call()`.
# Used to generate ground-truth vectors for the JS port (src/lib/filesender.js).
# Standard library only. Run: python3 test/reference.py
# Derived from FileSender's filesender.py (BSD 3-Clause, see NOTICE.md).
import base64
import hashlib
import hmac
import json
import urllib.parse

# --- fixed inputs ---------------------------------------------------------
BASE_URL = "https://filesender.example.org/rest.php"
USERNAME = "john.doe@example.org"
APIKEY = "deadbeefcafebabe1234567890abcdef"
TIMESTAMP = 1700000000  # fixed so signatures are deterministic


# verbatim from filesender.py (flatten)
def flatten(d, parent_key=""):
    items = []
    for k, v in d.items():
        new_key = parent_key + "[" + k + "]" if parent_key else k
        if isinstance(v, dict):
            items.extend(flatten(v, new_key))
        elif v is not None:
            items.append(new_key + "=" + v)
    items.sort()
    return items


# signing block copied from filesender.py call(), parameterized
def sign(
    method, path, data, content=None, rawContent=None, content_type="application/json"
):
    data = dict(data)
    data["remote_user"] = USERNAME
    data["timestamp"] = str(TIMESTAMP)
    signed = bytes(
        method
        + "&"
        + BASE_URL.replace("https://", "", 1).replace("http://", "", 1)
        + path
        + "?"
        + ("&".join(flatten(data))),
        "ascii",
    )

    inputcontent = None
    if content is not None and content_type == "application/json":
        inputcontent = json.dumps(content, separators=(",", ":"))
        signed += bytes("&" + inputcontent, "ascii")
    elif rawContent is not None:
        inputcontent = rawContent
        signed += bytes("&", "ascii")
        signed += inputcontent

    bkey = bytearray()
    bkey.extend(map(ord, APIKEY))
    data["signature"] = hmac.new(bkey, signed, hashlib.sha1).hexdigest()

    flatdata_encoded = []
    for item in flatten(data):
        key, value = item.split("=", 1)
        flatdata_encoded.append(
            urllib.parse.quote(key) + "=" + urllib.parse.quote(value)
        )
    url = BASE_URL + path + "?" + ("&".join(flatdata_encoded))
    return signed, data["signature"], url, inputcontent


def vec(
    name,
    method,
    path,
    data,
    content=None,
    rawContent=None,
    content_type="application/json",
):
    signed, signature, url, _body = sign(
        method, path, data, content, rawContent, content_type
    )
    return {
        "name": name,
        "method": method,
        "path": path,
        "data": data,
        "content": content,
        "rawContent": (
            base64.b64encode(rawContent).decode("ascii")
            if rawContent is not None
            else None
        ),
        "contentType": content_type,
        "expectedSignedB64": base64.b64encode(signed).decode("ascii"),
        "expectedSignature": signature,
        "expectedUrl": url,
    }


CASES = [
    # 1. GET with a token param, no body
    vec(
        "get-files-tokens",
        "get",
        "/transfer/fileidsextended",
        {"token": "tok-abc123"},
        None,
        None,
    ),
    # 2. POST /transfer with unicode filename + emoji (tests ensure_ascii escaping)
    vec(
        "post-transfer-unicode",
        "post",
        "/transfer",
        {},
        {
            "from": USERNAME,
            "files": [{"name": "file-\u00e8-\u00f1-\U0001f600.pdf", "size": 123456}],
            "recipients": ["jane.roe@example.org"],
            "subject": "Subject with \u00e8 and \u00f1",
            "message": "Hello, large attachment",
            "expires": 1700086400,
            "aup_checked": 1,
            "options": {"get_a_link": 0},
        },
        None,
    ),
    # 3. PUT chunk, raw binary body incl. zero + high bytes
    vec(
        "put-chunk-binary",
        "put",
        "/file/123/chunk/0",
        {"key": "puid0123456789abcdef", "roundtriptoken": "rt_0123456789abcdef"},
        None,
        bytes([0x00, 0x01, 0x02, 0x03, 0x7F, 0x80, 0xFF, 0xFE]),
        "application/octet-stream",
    ),
    # 4. PUT file complete
    vec(
        "put-file-complete",
        "put",
        "/file/123",
        {"key": "puid0123456789abcdef", "roundtriptoken": "rt_0123456789abcdef"},
        {"complete": True},
        None,
    ),
    # 5. PUT transfer complete (key only, no roundtriptoken)
    vec(
        "put-transfer-complete",
        "put",
        "/transfer/55",
        {"key": "puid0123456789abcdef"},
        {"complete": True},
        None,
    ),
    # 6. DELETE transfer, no body
    vec(
        "delete-transfer",
        "delete",
        "/transfer/55",
        {"key": "puid0123456789abcdef"},
        None,
        None,
    ),
]


if __name__ == "__main__":
    print(
        json.dumps(
            {
                "baseUrl": BASE_URL,
                "username": USERNAME,
                "apikey": APIKEY,
                "timestamp": TIMESTAMP,
                "cases": CASES,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
