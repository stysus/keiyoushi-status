"""Operational tier taxonomy shared by the pipeline.

The single source of truth for how a status maps to an operational tier.
Dependency-free (stdlib only) so the lightweight history and guard scripts can
import it without pulling the transport stack, and so the guard can never drift
away from the history snapshot it checks.

Run:
    .github/scripts/test_tiers.py
"""

from __future__ import annotations

from enum import StrEnum


class Tier(StrEnum):
    OK = "ok"
    CHALLENGE = "challenge"
    DEGRADED = "degraded"
    OFFLINE = "offline"


_OPERATIONAL = frozenset({Tier.OK, Tier.CHALLENGE})


def tier_of(status: str, subcategory: str = "") -> Tier:
    """Classify a status (and optional subcategory) into an operational tier.

    Returns:
        The tier: ok, challenge, degraded, or offline.
    """
    if status == "ok":
        return Tier.OK
    if status in {"iuam", "waf"} or (status == "redirect" and "same authority" in subcategory.lower()):
        return Tier.CHALLENGE
    if status in {"rate_limited", "warning"}:
        return Tier.DEGRADED
    return Tier.OFFLINE


def is_operational(tier: Tier) -> bool:
    """Report whether a tier counts as operational.

    Returns:
        True for the ok and challenge tiers.
    """
    return tier in _OPERATIONAL
