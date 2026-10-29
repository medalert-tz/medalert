"""Reading a photo of a paper prescription with Claude.

Used by patients whose hospital isn't on MediAlert yet. The result is only a draft:
the patient checks and edits every medicine and time before anything is saved.
The photo is sent to Anthropic for reading and is not stored by MediAlert.
"""
from __future__ import annotations

import re

import httpx

from app.config import Settings

API_URL = "https://api.anthropic.com/v1/messages"
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class VisionUnavailable(Exception):
    """No ANTHROPIC_API_KEY configured."""


class VisionFailed(Exception):
    """The reading service returned an error."""


PROMPT = """You are helping a patient in Tanzania turn a photo of a paper prescription into a medication schedule.

Read the prescription (it may be handwritten, in English or Swahili) and call record_prescription.

Rules:
- Only list medicines that are actually written on it. Never guess a drug name you can't read; if a name is unclear, give your best reading, set confidence "low" and say what is unclear in note.
- dose_instructions: how much to take, e.g. "1 tablet", "2 puffs", "10 ml", plus any instruction like "after food".
- times: suggest local clock times (24h HH:MM) from the frequency:
  OD/once daily -> 08:00; BD/BID/twice daily -> 08:00, 20:00; TDS/TID/three times -> 07:00, 14:00, 21:00;
  QID/four times -> 07:00, 12:00, 17:00, 22:00; nocte/at night -> 21:00; mane/morning -> 08:00.
  If it is PRN/as needed, leave times empty and say so in note.
- duration_days: number of days if written (e.g. "x 5/7" = 5 days, "x 2/52" = 14 days); null if ongoing or not written.
- If the image is not a prescription or can't be read, set is_prescription false and explain in warnings.
- Add a warning for anything the patient should confirm with their pharmacist or doctor."""

TOOL = {
    "name": "record_prescription",
    "description": "Record the medicines read from the prescription photo.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_prescription": {"type": "boolean"},
            "medicines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "drug_name": {"type": "string", "description": "Name and strength, e.g. 'Amoxicillin 500mg'"},
                        "dose_instructions": {"type": "string"},
                        "times": {"type": "array", "items": {"type": "string"}},
                        "duration_days": {"type": ["integer", "null"]},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                        "note": {"type": "string"},
                    },
                    "required": ["drug_name", "times", "confidence"],
                },
            },
            "warnings": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["is_prescription", "medicines", "warnings"],
    },
}


def call_anthropic(image_base64: str, media_type: str, settings: Settings) -> dict:
    """Send the photo to Claude and return the tool input. Separate so tests can replace it."""
    try:
        r = httpx.post(
            API_URL,
            headers={
                "x-api-key": settings.anthropic_api_key or "",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.vision_model,
                "max_tokens": 2000,
                "tools": [TOOL],
                "tool_choice": {"type": "tool", "name": "record_prescription"},
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
                            {"type": "text", "text": PROMPT},
                        ],
                    }
                ],
            },
            timeout=60,
        )
    except httpx.HTTPError as e:
        raise VisionFailed(f"Could not reach the reading service: {e.__class__.__name__}") from e
    if r.status_code != 200:
        raise VisionFailed(f"Reading service error ({r.status_code})")
    for block in r.json().get("content", []):
        if block.get("type") == "tool_use":
            return block.get("input", {})
    raise VisionFailed("The reading service gave no result")


def clean(result: dict) -> dict:
    """Keep only well-formed values; the patient reviews everything anyway."""
    medicines = []
    for m in result.get("medicines") or []:
        name = str(m.get("drug_name") or "").strip()[:120]
        if not name:
            continue
        times = sorted({t for t in (m.get("times") or []) if isinstance(t, str) and _HHMM.match(t)})[:6]
        days = m.get("duration_days")
        medicines.append(
            {
                "drug_name": name,
                "dose_instructions": (str(m.get("dose_instructions") or "").strip()[:200] or None),
                "times": times,
                "duration_days": days if isinstance(days, int) and 1 <= days <= 3650 else None,
                "confidence": m.get("confidence") if m.get("confidence") in {"high", "medium", "low"} else "low",
                "note": (str(m.get("note") or "").strip()[:300] or None),
            }
        )
    warnings = [str(w)[:300] for w in (result.get("warnings") or []) if str(w).strip()][:10]
    return {"is_prescription": bool(result.get("is_prescription")), "medicines": medicines, "warnings": warnings}


def read_prescription(image_base64: str, media_type: str, settings: Settings) -> dict:
    if not settings.anthropic_api_key:
        raise VisionUnavailable
    return clean(call_anthropic(image_base64, media_type, settings))
