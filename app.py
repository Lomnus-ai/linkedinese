"""FastAPI web app for linkedin_translator.

Run locally:
    uv sync
    uv run uvicorn app:app --reload
"""

import json
import os
from pathlib import Path
from typing import AsyncIterator, Literal

from anthropic import APIError, AsyncAnthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

load_dotenv()

if not os.environ.get("ANTHROPIC_API_KEY"):
    raise RuntimeError("ANTHROPIC_API_KEY not set (check .env)")

PROJECT = Path(__file__).resolve().parent
STATIC = PROJECT / "static"

Direction = Literal["en_to_linkedin", "linkedin_to_en"]

PROMPT_FILES: dict[Direction, str] = {
    "en_to_linkedin": "prompt_en_to_linkedin.md",
    "linkedin_to_en": "prompt_linkedin_to_en.md",
}

MODELS: dict[Direction, list[dict[str, str]]] = {
    "en_to_linkedin": [
        {"id": "claude-sonnet-4-6", "label": "Sonnet 4.6 (default)"},
        {"id": "claude-opus-4-7", "label": "Opus 4.7"},
        {"id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5"},
    ],
    "linkedin_to_en": [
        {"id": "claude-opus-4-7", "label": "Opus 4.7 (default)"},
        {"id": "claude-sonnet-4-6", "label": "Sonnet 4.6"},
        {"id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5"},
    ],
}

DEFAULT_MODELS: dict[Direction, str] = {
    "en_to_linkedin": "claude-sonnet-4-6",
    "linkedin_to_en": "claude-opus-4-7",
}

def load_prompt(direction: Direction) -> str:
    return (PROJECT / PROMPT_FILES[direction]).read_text()


client = AsyncAnthropic()
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="LinkedIn Translator")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


class TranslateRequest(BaseModel):
    direction: Direction
    text: str = Field(..., min_length=1, max_length=10_000)
    model: str | None = None


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/config")
async def get_config() -> dict:
    return {
        "models": MODELS,
        "defaults": DEFAULT_MODELS,
        "directions": [
            {"id": "en_to_linkedin", "label": "English → LinkedIn Speak"},
            {"id": "linkedin_to_en", "label": "LinkedIn Speak → English"},
        ],
        "rate_limit": "10 requests / minute per IP",
    }


def _resolve_model(direction: Direction, model: str | None) -> str:
    if not model:
        return DEFAULT_MODELS[direction]
    valid = {m["id"] for m in MODELS[direction]}
    if model not in valid:
        raise HTTPException(
            status_code=400,
            detail=f"model '{model}' not allowed for direction '{direction}'",
        )
    return model


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _stream_translation(
    direction: Direction, text: str, model: str
) -> AsyncIterator[str]:
    system_prompt = load_prompt(direction)
    try:
        async with client.messages.stream(
            model=model,
            max_tokens=1024,
            system=[{
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": text}],
        ) as stream:
            async for chunk in stream.text_stream:
                yield _sse({"type": "text", "text": chunk})
        yield _sse({"type": "done"})
    except APIError as e:
        yield _sse({"type": "error", "message": f"Anthropic API error: {e}"})
    except Exception as e:
        yield _sse({"type": "error", "message": f"Server error: {e}"})


@app.post("/api/translate")
@limiter.limit("10/minute")
async def translate(request: Request, body: TranslateRequest) -> StreamingResponse:
    model = _resolve_model(body.direction, body.model)
    return StreamingResponse(
        _stream_translation(body.direction, body.text.strip(), model),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.mount("/static", StaticFiles(directory=STATIC), name="static")
