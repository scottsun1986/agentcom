"""Knowledge base endpoints (GBrainKG integration with local fallback):
- doc CRUD with view counter; stats; keyword scoring search;
- knowledge graph slicing (category/doc/keyword nodes); connectivity probe."""

import uuid
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUSINESS_TZ, get_settings
from app.core.deps import Principal, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.database import get_db
from app.models.extras import KnbDocument

router = APIRouter(prefix="/api/knowledge", tags=["智能知识库"])

DOC_CATEGORIES = ["政策法规", "制度规程", "讲话汇编", "成果档案"]
SEARCH_WEIGHTS = {"title": 5, "keywords": 3, "content": 1}
SNIPPET_RADIUS = 40  # 命中片段前后各 40 字


def _parse_uuid(value, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, f"无效的{label}")


def _parse_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ApiError(400, "publish_date 格式应为 YYYY-MM-DD")


def serialize_doc(d: KnbDocument, include_content: bool = False) -> dict:
    data = {
        "doc_id": str(d.doc_id),
        "title": d.title,
        "category": d.category,
        "doc_no": d.doc_no,
        "source_org": d.source_org,
        "publish_date": d.publish_date.isoformat() if d.publish_date else None,
        "keywords": d.keywords,
        "view_count": d.view_count,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }
    if include_content:
        data["content"] = d.content
    else:
        data["content_preview"] = (d.content or "")[:120]
    return data


# ---------------- 统计看板 ----------------

@router.get("/stats")
async def knowledge_stats(
    p: Principal = Depends(require_perms("knowledge:doc:list")),
    db: AsyncSession = Depends(get_db),
):
    total = (await db.execute(select(func.count()).select_from(KnbDocument))).scalar()
    cat_rows = (await db.execute(
        select(KnbDocument.category, func.count()).group_by(KnbDocument.category)
    )).all()
    known = {c: 0 for c in DOC_CATEGORIES}
    for cat, cnt in cat_rows:
        known[cat] = cnt
    now = datetime.now(BUSINESS_TZ)
    week_start = datetime.combine(
        now.date() - timedelta(days=now.weekday()), time.min, tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)
    week_new = (await db.execute(
        select(func.count()).select_from(KnbDocument).where(KnbDocument.created_at >= week_start)
    )).scalar()
    hot = (await db.execute(
        select(KnbDocument).order_by(KnbDocument.view_count.desc()).limit(5)
    )).scalars().all()
    return ok({
        "total": total,
        "categories": [{"category": c, "count": n} for c, n in known.items()],
        "week_new": week_new,
        "hot": [{
            "doc_id": str(d.doc_id), "title": d.title,
            "category": d.category, "view_count": d.view_count,
        } for d in hot],
    })


# ---------------- 政企文档库 CRUD ----------------

@router.get("/documents")
async def list_documents(
    p: Principal = Depends(require_perms("knowledge:doc:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, category: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(KnbDocument).order_by(KnbDocument.created_at.desc())
    if category:
        stmt = stmt.where(KnbDocument.category == category)
    if keyword:
        kw = f"%{keyword.strip()}%"
        stmt = stmt.where(
            KnbDocument.title.ilike(kw)
            | KnbDocument.keywords.ilike(kw)
            | KnbDocument.doc_no.ilike(kw)
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([serialize_doc(d) for d in rows], total)


@router.post("/documents")
async def add_document(
    body: dict,
    p: Principal = Depends(require_perms("knowledge:doc:add")),
    db: AsyncSession = Depends(get_db),
):
    title = (body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "文档标题不能为空")
    category = (body.get("category") or "政策法规").strip()
    doc = KnbDocument(
        title=title,
        category=category,
        doc_no=(body.get("doc_no") or "").strip() or None,
        source_org=(body.get("source_org") or "").strip() or None,
        publish_date=_parse_date(body.get("publish_date")),
        content=body.get("content") or "",
        keywords=(body.get("keywords") or "").strip() or None,
    )
    db.add(doc)
    await db.flush()
    return ok(serialize_doc(doc, include_content=True), "文档已入库")


@router.put("/documents/{doc_id}")
async def edit_document(
    doc_id: str, body: dict,
    p: Principal = Depends(require_perms("knowledge:doc:edit")),
    db: AsyncSession = Depends(get_db),
):
    doc = await db.get(KnbDocument, _parse_uuid(doc_id, "文档ID"))
    if not doc:
        raise ApiError(404, "文档不存在")
    if "title" in body:
        title = (body.get("title") or "").strip()
        if not title:
            raise ApiError(400, "文档标题不能为空")
        doc.title = title
    if "category" in body and body.get("category"):
        doc.category = str(body["category"]).strip()
    for f in ("doc_no", "source_org", "keywords"):
        if f in body:
            setattr(doc, f, (str(body.get(f) or "").strip() or None))
    if "content" in body:
        doc.content = body.get("content") or ""
    if "publish_date" in body:
        doc.publish_date = _parse_date(body.get("publish_date"))
    await db.flush()
    return ok(serialize_doc(doc, include_content=True), "文档已更新")


@router.delete("/documents/{doc_id}")
async def del_document(
    doc_id: str,
    p: Principal = Depends(require_perms("knowledge:doc:del")),
    db: AsyncSession = Depends(get_db),
):
    doc = await db.get(KnbDocument, _parse_uuid(doc_id, "文档ID"))
    if not doc:
        raise ApiError(404, "文档不存在")
    await db.delete(doc)
    await db.flush()
    return ok(None, "删除成功")


@router.get("/documents/{doc_id}")
async def get_document(
    doc_id: str,
    p: Principal = Depends(require_perms("knowledge:doc:list")),
    db: AsyncSession = Depends(get_db),
):
    doc = await db.get(KnbDocument, _parse_uuid(doc_id, "文档ID"))
    if not doc:
        raise ApiError(404, "文档不存在")
    doc.view_count = (doc.view_count or 0) + 1
    await db.flush()
    return ok(serialize_doc(doc, include_content=True))


# ---------------- 关键词打分检索 ----------------

def _make_snippet(text: str, q_lower: str) -> str:
    """命中片段：命中词前后各 40 字，截断处补省略号。"""
    pos = text.lower().find(q_lower)
    if pos < 0:
        return text[:80]
    start = max(0, pos - SNIPPET_RADIUS)
    end = min(len(text), pos + len(q_lower) + SNIPPET_RADIUS)
    frag = text[start:end]
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{frag}{suffix}"


@router.get("/search")
async def search_documents(
    p: Principal = Depends(require_perms("knowledge:search:list")),
    db: AsyncSession = Depends(get_db),
    q: str = "", top_k: int = 10, category: str | None = None,
):
    """关键词打分检索：title 命中*5 + keywords 命中*3 + content 命中*1；无命中返回空列表。"""
    q_lower = (q or "").strip().lower()
    if not q_lower:
        return ok([])
    stmt = select(KnbDocument)
    if category:
        stmt = stmt.where(KnbDocument.category == category)
    docs = (await db.execute(stmt)).scalars().all()

    results = []
    for d in docs:
        title = (d.title or "").lower()
        keywords = (d.keywords or "").lower()
        content = (d.content or "").lower()
        score = (
            title.count(q_lower) * SEARCH_WEIGHTS["title"]
            + keywords.count(q_lower) * SEARCH_WEIGHTS["keywords"]
            + content.count(q_lower) * SEARCH_WEIGHTS["content"]
        )
        if score <= 0:
            continue
        # snippet 优先取正文命中，其次关键词、标题
        if q_lower in content:
            snippet = _make_snippet(d.content, q_lower)
        elif q_lower in keywords:
            snippet = _make_snippet(d.keywords, q_lower)
        else:
            snippet = _make_snippet(d.title, q_lower)
        results.append({
            "doc_id": str(d.doc_id),
            "title": d.title,
            "category": d.category,
            "score": score,
            "snippet": snippet,
            "publish_date": d.publish_date.isoformat() if d.publish_date else None,
        })
    results.sort(key=lambda x: (-x["score"], x["title"]))
    top_k = top_k if top_k and top_k > 0 else 10
    return ok(results[:top_k])


# ---------------- 知识图谱切片 ----------------

@router.get("/graph")
async def knowledge_graph(
    p: Principal = Depends(require_perms("knowledge:doc:list")),
    db: AsyncSession = Depends(get_db),
):
    """图谱：category→doc、doc→keyword 边；keywords 逗号拆分，取出现≥2次的前 20 个。"""
    docs = (await db.execute(select(KnbDocument))).scalars().all()

    kw_counter: Counter = Counter()
    doc_keywords: list[tuple[KnbDocument, list[str]]] = []
    for d in docs:
        kws = [k.strip() for k in str(d.keywords or "").replace("，", ",").split(",") if k.strip()]
        doc_keywords.append((d, kws))
        for k in set(kws):  # 同一文档内重复关键词只计一次
            kw_counter[k] += 1
    top_kws = {k for k, c in kw_counter.most_common(20) if c >= 2}

    nodes = []
    edges = []
    seen_cats: list[str] = []
    for d, kws in doc_keywords:
        if d.category not in seen_cats:
            seen_cats.append(d.category)
        doc_node_id = f"doc:{d.doc_id}"
        nodes.append({"id": doc_node_id, "label": d.title, "type": "doc"})
        edges.append({"source": f"cat:{d.category}", "target": doc_node_id})
        for k in kws:
            if k in top_kws:
                edges.append({"source": doc_node_id, "target": f"kw:{k}"})
    for cat in seen_cats:
        nodes.append({"id": f"cat:{cat}", "label": cat, "type": "category"})
    for k in sorted(top_kws):
        nodes.append({"id": f"kw:{k}", "label": k, "type": "keyword"})
    return ok({"nodes": nodes, "edges": edges})


# ---------------- GBrainKG 连通性探测 ----------------

@router.post("/sync/gbrainkg")
async def sync_gbrainkg(p: Principal = Depends(require_perms("knowledge:search:list"))):
    """探测 GBrainKG 服务可达性：可达用 hybrid 混合检索，不可达静默回退 local，绝不抛错。"""
    url = get_settings().gbrainkg_url
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(url)
        reachable = resp.status_code < 500
    except Exception:  # 连接拒绝/超时/DNS 失败等一律视为不可达
        reachable = False
    if reachable:
        return ok({"reachable": True, "mode": "hybrid"}, "GBrainKG 连接正常")
    return ok({"reachable": False, "mode": "local"}, "GBrainKG 不可达，已切换本地知识库模式")
