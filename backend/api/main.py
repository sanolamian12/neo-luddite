"""
Seam A — FastAPI service exposing POST /api/chat (docs API 계약 §2.4).

Run (from backend/):
    pip install -r requirements-api.txt
    cp .env.example .env   # fill UPSTAGE_API_KEY
    uvicorn api.main:app --reload --port 8787

Frontend calls this via NEXT_PUBLIC_API_BASE or a Next.js rewrite proxy.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# load backend/.env before anything reads UPSTAGE_API_KEY
load_dotenv(os.path.join(os.path.dirname(__file__), os.pardir, ".env"))

from api import pipeline  # noqa: E402  (import after load_dotenv)
from api.schema import ChatRequest, ChatResponse  # noqa: E402

app = FastAPI(title="Neo-Luddite Seam A — /api/chat", version="0.1.0")

# dev CORS: Next.js dev server. Tighten for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "seam-a", "model": os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3")}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if req.occupation == "clinic":
        return pipeline.run_clinic(req.conversationId, req.history, req.userInput.text)
    return pipeline.run_coming_occupation(req.conversationId, req.history, req.occupation)
