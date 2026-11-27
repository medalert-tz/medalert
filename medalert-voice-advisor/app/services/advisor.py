"""Voice health advisor on the watch: short, safe answers from a free LLM (Groq).

The browser turns the patient's speech into text and reads the answer aloud; this
module only sends text. It gives general guidance and never changes a prescription.
"""
from __future__ import annotations

import httpx

from app.config import Settings

API_URL = "https://api.groq.com/openai/v1/chat/completions"

SYSTEM_PROMPT = """You are MediPal, MediAlert's AI health advisor on a smartwatch. You are NOT a real doctor and cannot diagnose or prescribe.
Rules:
- Answer in at most 2 short sentences (under 45 words total). Plain spoken language, no lists, no markdown.
- Give general, safe guidance about medicines, side effects, adherence and when to see a clinician.
- Never tell the user to stop, skip or change a prescribed dose; tell them to ask their clinician or pharmacist.
- If the question suggests an emergency (trouble breathing, swelling of face/throat, chest pain, severe rash, fainting), tell them to seek urgent medical care right now."""

LANG_RULE = {
    "en": "Reply in English.",
    "sw": "Jibu kwa Kiswahili sanifu rahisi pekee (Reply ONLY in simple, natural Swahili).",
}


class AdvisorUnavailable(Exception):
    """No GROQ_API_KEY configured."""


class AdvisorBusy(Exception):
    """The free quota is used up for now (HTTP 429)."""


class AdvisorFailed(Exception):
    """The AI service returned an error."""


def build_system_prompt(lang: str, context: str) -> str:
    base = f"{SYSTEM_PROMPT}\n{LANG_RULE.get(lang, LANG_RULE['en'])}"
    if context:
        base += f"\nPatient context (from their prescriptions): {context}"
    return base


def call_groq(messages: list[dict], settings: Settings) -> str:
    """Send the chat to Groq and return the reply text. Separate so tests can replace it."""
    try:
        r = httpx.post(
            API_URL,
            headers={"authorization": f"Bearer {settings.groq_api_key or ''}", "content-type": "application/json"},
            json={
                "model": settings.advisor_model,
                "temperature": 0.4,
                "reasoning_effort": "low",
                "max_tokens": 400,
                "messages": messages,
            },
            timeout=30,
        )
    except httpx.HTTPError as e:
        raise AdvisorFailed(f"Could not reach the AI service: {e.__class__.__name__}") from e
    if r.status_code == 429:
        raise AdvisorBusy("The free AI quota is busy")
    if r.status_code != 200:
        raise AdvisorFailed(f"AI service error ({r.status_code})")
    choices = r.json().get("choices") or [{}]
    reply = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not reply:
        raise AdvisorFailed("The AI service gave an empty reply")
    return reply


def ask(messages: list[dict], lang: str, context: str, settings: Settings) -> str:
    if not settings.groq_api_key:
        raise AdvisorUnavailable()
    chat = [{"role": "system", "content": build_system_prompt(lang, context)}, *messages]
    return call_groq(chat, settings)
