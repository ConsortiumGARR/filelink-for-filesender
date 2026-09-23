#!/usr/bin/env python3
# Encryption reference: a copy of the filesender.py logic (generate_key,
# encrypt_chunk_aesgcm, per-file iv/aead). Generates the vectors used by
# test/crypto-test.html to check src/lib/fscrypto.js. Needs the `cryptography`
# package. Derived from FileSender's filesender.py (BSD 3-Clause, see NOTICE.md).
import base64
import hashlib
from math import ceil

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PASSWORD = "Test-Password_123!"
SALT = "dGVzdC1zYWx0LTEyMzQ1Njc4"
ITERATIONS = 1000  # low for tests; real values come from the instance config
IV_LEN = 16
CHUNK_SIZE = 16
IV_BYTES = bytes(range(1, IV_LEN - 4 + 1))


# from filesender.py: file_transfer_object["iv"] / ["aead"]
def file_params(size):
    iv = base64.b64encode(IV_BYTES).decode("ascii")
    aead_string = "{"
    aead_string += '"aeadversion":1,'
    aead_string += '"chunkcount":' + str(ceil(size / CHUNK_SIZE)) + ","
    aead_string += '"chunksize":' + str(CHUNK_SIZE) + ","
    aead_string += '"iv":' + '"' + iv + '"' + ","
    aead_string += '"aeadterminator":1'
    aead_string += "}"
    return iv, aead_string


# from filesender.py: generate_key
def generate_key():
    return hashlib.pbkdf2_hmac(
        "SHA256", PASSWORD.encode("ascii"), SALT.encode("ascii"), ITERATIONS, 256 // 8
    )


# from filesender.py: encrypt_chunk_aesgcm
def encrypt_chunk(key, data, chunkid, aead):
    cipher = AESGCM(key)
    fulliv = IV_BYTES + chunkid.to_bytes(4, byteorder="little")
    return fulliv + cipher.encrypt(fulliv, data, aead.encode("ascii"))


def vectors():
    plain = bytes((i * 7 + 3) % 256 for i in range(40))
    iv, aead = file_params(len(plain))
    key = generate_key()
    chunks = []
    for offset in range(0, len(plain), CHUNK_SIZE):
        data = plain[offset : offset + CHUNK_SIZE]
        chunks.append(
            {
                "index": offset // CHUNK_SIZE,
                "plain": base64.b64encode(data).decode("ascii"),
                "expected": base64.b64encode(
                    encrypt_chunk(key, data, offset // CHUNK_SIZE, aead)
                ).decode("ascii"),
            }
        )
    return {
        "password": PASSWORD,
        "salt": SALT,
        "iterations": ITERATIONS,
        "ivLength": IV_LEN,
        "chunkSize": CHUNK_SIZE,
        "size": len(plain),
        "ivBytes": base64.b64encode(IV_BYTES).decode("ascii"),
        "expectedIv": iv,
        "expectedAead": aead,
        "chunks": chunks,
    }


if __name__ == "__main__":
    import json

    print(json.dumps(vectors(), indent=2))
