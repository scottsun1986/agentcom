"""GBrainKG (LLMWiki) knowledge base client.

Talks to the demo-environment deployment over its Open-API
(X-App-Id / X-App-Secret headers). All calls are fail-soft: on network
errors the platform falls back to the local KnbDocument store so demos
never blank out."""

import logging
import time
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger("agentcom.gbrainkg")

_settings = get_settings()

_status_cache: dict[str, Any] = {"ts": 0.0, "data": None}
_STATUS_TTL = 30.0


def _base_url() -> str:
    return (_settings.gbrainkg_url or "").rstrip("/")


def _headers() -> dict[str, str]:
    return {
        "X-App-Id": _settings.gbrainkg_app_id or "",
        "X-App-Secret": _settings.gbrainkg_app_secret or "",
    }


def _configured() -> bool:
    return bool(_base_url() and _settings.gbrainkg_app_id and _settings.gbrainkg_app_secret)


async def probe() -> dict:
    """Connectivity + credential probe with short TTL cache."""
    now = time.time()
    if _status_cache["data"] and now - _status_cache["ts"] < _STATUS_TTL:
        return _status_cache["data"]
    if not _configured():
        data = {"reachable": False, "mode": "local", "reason": "未配置 GBrainKG 凭据（GBRAINKG_APP_ID/SECRET）"}
        _status_cache.update(ts=now, data=data)
        return data
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(f"{_base_url()}/open-api/v1/knowledge-bases", headers=_headers())
        if 200 <= r.status_code < 300:
            payload = r.json()
            kbs = payload.get("data") or []
            data = {
                "reachable": True,
                "mode": "hybrid",
                "base_url": _base_url(),
                "kb_count": len(kbs),
                "document_count": sum(int(k.get("document_count") or 0) for k in kbs),
                "knowledge_bases": [
                    {"id": k.get("id"), "name": k.get("name"), "type": k.get("type"),
                     "document_count": k.get("document_count")} for k in kbs
                ],
            }
        else:
            data = {"reachable": False, "mode": "local", "reason": f"HTTP {r.status_code}"}
    except Exception as e:  # noqa: BLE001 — fail-soft by design
        data = {"reachable": False, "mode": "local", "reason": f"{type(e).__name__}: {e}"}
    _status_cache.update(ts=now, data=data)
    return data


def invalidate_status_cache() -> None:
    _status_cache.update(ts=0.0, data=None)


async def list_knowledge_bases() -> list[dict]:
    status = await probe()
    return status.get("knowledge_bases") or []


async def search(query: str, top_k: int = 8, kb_ids: list[str] | None = None) -> list[dict]:
    """Hybrid semantic+keyword search. Returns [] on any failure (caller falls back)."""
    if not _configured() or not (query or "").strip():
        return []
    body: dict[str, Any] = {"query": query.strip(), "top_k": max(1, min(int(top_k or 8), 30))}
    if kb_ids:
        body["kb_ids"] = kb_ids
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(f"{_base_url()}/open-api/v1/search",
                                  json=body, headers=_headers())
        if r.status_code < 200 or r.status_code >= 300:  # NestJS POST 成功返回 201
            logger.warning("gbrainkg search HTTP %s: %s", r.status_code, r.text[:200])
            return []
        results = (r.json().get("data") or {}).get("results") or []
    except Exception as e:  # noqa: BLE001
        logger.warning("gbrainkg search failed: %s", e)
        return []
    out = []
    for hit in results:
        out.append({
            "doc_id": hit.get("documentId"),
            "chunk_id": hit.get("chunkId"),
            "kb_id": hit.get("kbId"),
            "title": hit.get("title") or "未命名文档",
            "score": round(float(hit.get("score") or 0.0), 6),
            "evidence": (hit.get("evidence") or "")[:800],
            "page_no": hit.get("pageNo"),
            "version": hit.get("version"),
            "source": "gbrainkg",
        })
    return out


def aggregate_documents(results: list[dict]) -> list[dict]:
    """Collapse chunk-level hits into document-level entries (best chunk kept)."""
    docs: dict[str, dict] = {}
    for hit in results or []:
        did = hit.get("doc_id") or hit.get("title")
        if did not in docs or (hit.get("score") or 0) > (docs[did].get("score") or 0):
            merged = dict(docs.get(did) or {})
            merged.update({
                "doc_id": did,
                "title": hit.get("title"),
                "kb_id": hit.get("kb_id"),
                "score": hit.get("score"),
                "evidence": hit.get("evidence"),
                "page_no": hit.get("page_no"),
                "source": hit.get("source", "gbrainkg"),
            })
            chunk_count = (docs.get(did) or {}).get("chunk_count", 0) + 1
            merged["chunk_count"] = chunk_count
            docs[did] = merged
        else:
            docs[did]["chunk_count"] = docs[did].get("chunk_count", 1) + 1
    return sorted(docs.values(), key=lambda d: d.get("score") or 0, reverse=True)
