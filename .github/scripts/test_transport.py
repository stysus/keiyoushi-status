#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["beautifulsoup4[lxml]", "curl_cffi", "publicsuffixlist", "yarl"]
# ///
#
# Self-check for the transport helpers. No network: it only exercises the
# retry-classification, Retry-After parsing, and per-host limiter.
#
# Run via: .github/scripts/test_transport.py

from __future__ import annotations

import math

import transport

retry_after = transport._retry_after_seconds  # noqa: SLF001
host_semaphore = transport._host_semaphore  # noqa: SLF001


def main() -> None:
    assert transport.is_retryable_status(500)
    assert transport.is_retryable_status(429)
    assert not transport.is_retryable_status(403)
    assert not transport.is_retryable_status(404)

    # Review Focus 2: absurd Retry-After is capped
    assert math.isclose(retry_after({"retry-after": "99999"}), 5.0)
    assert math.isclose(retry_after({"retry-after": "2"}), 2.0)
    assert retry_after({}) is None
    assert retry_after({"retry-after": "soon"}) is None

    # Review Focus 5: same host -> same semaphore, distinct hosts -> distinct
    assert host_semaphore("a.test") is host_semaphore("a.test")
    assert host_semaphore("a.test") is not host_semaphore("b.test")
    assert host_semaphore("a.test")._value == 3  # noqa: SLF001

    print("transport selftest OK")


if __name__ == "__main__":
    main()
