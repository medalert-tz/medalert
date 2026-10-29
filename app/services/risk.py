"""Adherence-risk prediction.

The presentation calls for "an AI model [that] detects adherence patterns to identify
patients at risk of missing doses". There is no training data yet (roadmap: data pipeline
in Q1, model validation in Q2), so v0 is a transparent, hand-weighted logistic score.
Any trained model can replace it by implementing `RiskModel.predict`.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Protocol


@dataclass
class AdherenceFeatures:
    doses_resolved_7d: int          # taken + missed in the last 7 days
    miss_rate_7d: float             # missed / resolved (0 if none resolved)
    consecutive_misses: int         # current run of missed doses, most recent first
    hours_since_device_seen: float | None  # None = no device paired / never seen
    days_of_supply_left: float | None      # None = nothing dispensed / unknown

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RiskResult:
    score: float
    level: str          # low | medium | high
    factors: list[str]  # human-readable reasons, for the nurse
    model_version: str


class RiskModel(Protocol):
    version: str

    def predict(self, f: AdherenceFeatures) -> RiskResult: ...


def level_for(score: float, threshold: float) -> str:
    if score >= threshold:
        return "high"
    if score >= threshold / 2:
        return "medium"
    return "low"


class HeuristicRiskModel:
    """Baseline logistic score. Weights are hand-set placeholders to be replaced by
    coefficients learned from external datasets and pilot data."""

    version = "heuristic-v0"

    INTERCEPT = -2.5
    W_MISS_RATE = 4.0
    W_CONSECUTIVE = 0.8          # per consecutive miss, capped at 5
    W_DEVICE_SILENT = 0.03       # per hour since device last synced, capped at 72h
    W_SUPPLY_OUT = 1.0           # when supply is about to run out

    def __init__(self, threshold: float = 0.6):
        self.threshold = threshold

    def predict(self, f: AdherenceFeatures) -> RiskResult:
        z = self.INTERCEPT
        factors: list[str] = []

        if f.doses_resolved_7d:
            z += self.W_MISS_RATE * f.miss_rate_7d
            if f.miss_rate_7d > 0:
                factors.append(
                    f"Missed {round(f.miss_rate_7d * 100)}% of doses in the last 7 days"
                )
        else:
            factors.append("Not enough dose history yet")

        if f.consecutive_misses:
            z += self.W_CONSECUTIVE * min(f.consecutive_misses, 5)
            factors.append(f"{f.consecutive_misses} missed dose(s) in a row")

        if f.hours_since_device_seen is None:
            factors.append("No device data received")
        elif f.hours_since_device_seen >= 24:
            z += self.W_DEVICE_SILENT * min(f.hours_since_device_seen, 72)
            factors.append(f"Device silent for {round(f.hours_since_device_seen)} h")

        if f.days_of_supply_left is not None and f.days_of_supply_left <= 1:
            z += self.W_SUPPLY_OUT
            factors.append("Medication supply runs out within a day")

        score = 1 / (1 + math.exp(-z))
        return RiskResult(
            score=round(score, 3),
            level=level_for(score, self.threshold),
            factors=factors,
            model_version=self.version,
        )
