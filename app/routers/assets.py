"""Fixed assets & consumables endpoints (PRD 4.2 closed loops):
one-code-per-item ledger, requisition audit that drives asset status,
maintenance repair / scrapping, mobile stocktake scanning, straight-line
depreciation estimate and low-stock consumable requisition deduction."""

import uuid
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    Uuid,
    delete,
    func,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.config import BUSINESS_TZ
from app.core.deps import Principal, apply_data_scope, require_auth, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.database import Base, get_db
from app.models.assets import (
    AstCategory,
    AstConsumable,
    AstConsumableRequisition,
    AstItemCard,
    AstRequisition,
    AstStocktakePlan,
)
from app.models.extras import AstMaintenanceLog
from app.models.system import SysDept, SysUser

router = APIRouter(prefix="/api/assets", tags=["固定资产与耗材"])

# ---------------- constants ----------------

STATUS_LABELS = {
    "IN_STOCK": "在库", "IN_USE": "在用", "BORROWED": "借用中",
    "IN_REPAIR": "维修中", "SCRAPPED": "已报废",
}
ASSET_STATUSES = set(STATUS_LABELS)

REQ_TYPE_LABELS = {
    "CLAIM": "领用", "RETURN": "归还", "BORROW": "借用",
    "TRANSFER": "调拨", "SCRAP": "报废",
}
REQ_TYPES = set(REQ_TYPE_LABELS)

AUDIT_STATUS_LABELS = {"PENDING": "待审批", "APPROVED": "已通过", "REJECTED": "已驳回"}
LOG_STATUS_LABELS = {"IN_REPAIR": "维修中", "FIXED": "已修复", "SCRAPPED": "已报废"}
PLAN_STATUS_LABELS = {"DRAFT": "草稿", "IN_PROGRESS": "进行中", "COMPLETED": "已完成"}

DEPRECIATION_YEARS = 5  # 平均年限法折旧年限


# NOTE: 盘点扫码流水表。DEV_SPEC 禁止修改 app/models/，而“重复扫码不重复计数”需要持久化
# 扫码明细，故该表定义在路由文件内并挂到同一 Base.metadata，init_db() 的 create_all 会一并建表。
class AstStocktakeScanRecord(Base):
    """One scan hit of an asset inside a stocktake plan (dedup guard)."""

    __tablename__ = "ast_stocktake_scan_record"
    __table_args__ = (UniqueConstraint("plan_id", "asset_id", name="uq_ast_scan"),)

    scan_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ast_stocktake_plan.plan_id", ondelete="CASCADE"), index=True
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ast_item_card.asset_id", ondelete="CASCADE"), index=True
    )
    asset_code: Mapped[str] = mapped_column(String(64), nullable=False)
    scanned_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True
    )
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


# ---------------- helpers ----------------

def parse_uuid(value: Any, label: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, f"{label}格式无效")


def parse_date(value: Any, label: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        raise ApiError(400, f"{label}格式无效，应为 YYYY-MM-DD")


async def gen_serial_code(db: AsyncSession, col, prefix: str) -> str:
    """Generate a `<prefix>-00001` style sequential code (max existing suffix + 1)."""
    rows = (await db.execute(select(col).where(col.like(f"{prefix}-%")))).scalars().all()
    mx = 0
    for c in rows:
        try:
            mx = max(mx, int(str(c).rsplit("-", 1)[-1]))
        except ValueError:
            continue
    return f"{prefix}-{mx + 1:05d}"


def current_year() -> int:
    return datetime.now(BUSINESS_TZ).year


def today() -> date:
    return datetime.now(BUSINESS_TZ).date()


async def load_name_maps(db: AsyncSession) -> dict:
    """Batch-load small org/category tables into id->name maps (avoids async lazy load)."""
    cats = (await db.execute(select(AstCategory))).scalars().all()
    depts = (await db.execute(select(SysDept))).scalars().all()
    users = (await db.execute(select(SysUser))).scalars().all()
    return {
        "cat": {c.category_id: c.category_name for c in cats},
        "dept": {d.dept_id: d.dept_name for d in depts},
        "user": {u.user_id: u.nick_name for u in users},
    }


async def load_asset_map(db: AsyncSession, asset_ids: list) -> dict:
    ids = {a for a in asset_ids if a}
    if not ids:
        return {}
    rows = (await db.execute(select(AstItemCard).where(AstItemCard.asset_id.in_(ids)))).scalars().all()
    return {a.asset_id: a for a in rows}


def monthly_depreciation(price: float) -> float:
    """平均年限法：月折旧额 = 原值 / (5 年 * 12 月)。"""
    return round(float(price or 0) / (DEPRECIATION_YEARS * 12), 2)


def elapsed_months(purchase_date: date | None, y: int, m: int) -> int:
    if purchase_date is None:
        return 0
    n = (y - purchase_date.year) * 12 + (m - purchase_date.month)
    return max(0, min(n, DEPRECIATION_YEARS * 12))


def asset_current_value(price: float, purchase_date: date | None, y: int, m: int) -> float:
    return round(max(float(price or 0) - monthly_depreciation(price) * elapsed_months(purchase_date, y, m), 0.0), 2)


# ---------------- serializers ----------------

def serialize_asset(a: AstItemCard, maps: dict) -> dict:
    return {
        "asset_id": str(a.asset_id),
        "asset_code": a.asset_code,
        "name": a.name,
        "category_id": str(a.category_id) if a.category_id else None,
        "category_name": maps["cat"].get(a.category_id),
        "model": a.model,
        "spec": a.spec,
        "brand": a.brand,
        "price": a.price,
        "current_value": a.current_value,
        "purchase_date": a.purchase_date.isoformat() if a.purchase_date else None,
        "location": a.location,
        "dept_id": str(a.dept_id) if a.dept_id else None,
        "dept_name": maps["dept"].get(a.dept_id),
        "custodian_user_id": str(a.custodian_user_id) if a.custodian_user_id else None,
        "custodian_name": maps["user"].get(a.custodian_user_id),
        "status": a.status,
        "status_label": STATUS_LABELS.get(a.status, a.status),
        "qr_code_url": a.qr_code_url,
        "notes": a.notes,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def serialize_req(r: AstRequisition, maps: dict, asset_map: dict) -> dict:
    asset = asset_map.get(r.asset_id)
    return {
        "req_id": str(r.req_id),
        "req_no": r.req_no,
        "req_type": r.req_type,
        "req_type_label": REQ_TYPE_LABELS.get(r.req_type, r.req_type),
        "asset_id": str(r.asset_id),
        "asset_code": asset.asset_code if asset else None,
        "asset_name": asset.name if asset else None,
        "user_id": str(r.user_id),
        "user_name": maps["user"].get(r.user_id),
        "dept_id": str(r.dept_id) if r.dept_id else None,
        "dept_name": maps["dept"].get(r.dept_id),
        "target_dept_id": str(r.target_dept_id) if r.target_dept_id else None,
        "target_dept_name": maps["dept"].get(r.target_dept_id),
        "target_user_id": str(r.target_user_id) if r.target_user_id else None,
        "target_user_name": maps["user"].get(r.target_user_id),
        "expected_return_date": r.expected_return_date.isoformat() if r.expected_return_date else None,
        "actual_return_date": r.actual_return_date.isoformat() if r.actual_return_date else None,
        "reason": r.reason,
        "audit_status": r.audit_status,
        "audit_status_label": AUDIT_STATUS_LABELS.get(r.audit_status, r.audit_status),
        "approver_id": str(r.approver_id) if r.approver_id else None,
        "approver_name": maps["user"].get(r.approver_id),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def serialize_log(lg: AstMaintenanceLog, maps: dict, asset_map: dict) -> dict:
    asset = asset_map.get(lg.asset_id)
    return {
        "log_id": str(lg.log_id),
        "asset_id": str(lg.asset_id),
        "asset_code": asset.asset_code if asset else None,
        "asset_name": asset.name if asset else None,
        "fault_desc": lg.fault_desc,
        "vendor": lg.vendor,
        "cost": lg.cost,
        "status": lg.status,
        "status_label": LOG_STATUS_LABELS.get(lg.status, lg.status),
        "reported_by": lg.reported_by,
        "created_at": lg.created_at.isoformat() if lg.created_at else None,
    }


def serialize_plan(pl: AstStocktakePlan, maps: dict) -> dict:
    return {
        "plan_id": str(pl.plan_id),
        "plan_no": pl.plan_no,
        "title": pl.title,
        "scope_dept_id": str(pl.scope_dept_id) if pl.scope_dept_id else None,
        "scope_dept_name": maps["dept"].get(pl.scope_dept_id),
        "status": pl.status,
        "status_label": PLAN_STATUS_LABELS.get(pl.status, pl.status),
        "total_count": pl.total_count,
        "verified_count": pl.verified_count,
        "surplus_count": pl.surplus_count,
        "loss_count": pl.loss_count,
        "progress": round(pl.verified_count / max(1, pl.total_count) * 100, 1),
        "created_at": pl.created_at.isoformat() if pl.created_at else None,
    }


def serialize_consumable(c: AstConsumable) -> dict:
    return {
        "item_id": str(c.item_id),
        "item_code": c.item_code,
        "name": c.name,
        "category": c.category,
        "spec": c.spec,
        "unit": c.unit,
        "stock_count": c.stock_count,
        "min_stock": c.min_stock,
        "unit_price": c.unit_price,
        "low_stock": c.stock_count <= c.min_stock,
    }


def serialize_consumable_req(cr: AstConsumableRequisition, maps: dict, item_map: dict) -> dict:
    item = item_map.get(cr.item_id)
    return {
        "req_id": str(cr.req_id),
        "item_id": str(cr.item_id),
        "item_name": item.name if item else None,
        "item_code": item.item_code if item else None,
        "unit": item.unit if item else None,
        "user_id": str(cr.user_id),
        "user_name": maps["user"].get(cr.user_id),
        "dept_id": str(cr.dept_id) if cr.dept_id else None,
        "dept_name": maps["dept"].get(cr.dept_id),
        "quantity": cr.quantity,
        "purpose": cr.purpose,
        "status": cr.status,
        "status_label": AUDIT_STATUS_LABELS.get(cr.status, cr.status),
        "created_at": cr.created_at.isoformat() if cr.created_at else None,
    }


# ---------------- overview / categories ----------------

@router.get("/overview")
async def assets_overview(
    p: Principal = Depends(require_perms("assets:overview:list")),
    db: AsyncSession = Depends(get_db),
):
    """资产全景看板：总值、在用率、闲置率、待维修数、本月折旧估算、耗材预警。"""
    assets = (await db.execute(select(AstItemCard))).scalars().all()
    usable = [a for a in assets if a.status != "SCRAPPED"]
    base = max(1, len(usable))
    y, m = current_year(), datetime.now(BUSINESS_TZ).month
    month_dep = sum(monthly_depreciation(a.price) for a in usable)
    low_stock = (await db.execute(
        select(func.count()).select_from(AstConsumable).where(AstConsumable.stock_count <= AstConsumable.min_stock)
    )).scalar()
    consumable_total = (await db.execute(select(func.count()).select_from(AstConsumable))).scalar()
    status_counts = {s: sum(1 for a in assets if a.status == s) for s in STATUS_LABELS}
    return ok({
        "total_assets": len(assets),
        "total_value": round(sum(a.price for a in usable), 2),
        # 在用率 = IN_USE 占非报废资产比；闲置率 = IN_STOCK 占比
        "in_use_rate": round(status_counts["IN_USE"] / base * 100, 1),
        "idle_rate": round(status_counts["IN_STOCK"] / base * 100, 1),
        "in_repair_count": status_counts["IN_REPAIR"],
        "month_depreciation": round(month_dep, 2),
        "month": f"{y}-{m:02d}",
        "consumable_alert": low_stock,
        "consumable_total": consumable_total,
        "status_counts": status_counts,
    })


@router.get("/categories")
async def list_categories(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AstCategory).order_by(AstCategory.order_num, AstCategory.category_code)
    )).scalars().all()
    return ok([{
        "category_id": str(c.category_id),
        "category_code": c.category_code,
        "category_name": c.category_name,
        "parent_id": str(c.parent_id) if c.parent_id else None,
        "order_num": c.order_num,
    } for c in rows])


# ---------------- fixed asset ledger ----------------

@router.get("/ledger")
async def list_ledger(
    p: Principal = Depends(require_perms("assets:ledger:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, status: str | None = None,
    dept_id: str | None = None, category_id: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AstItemCard).order_by(AstItemCard.created_at.desc())
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(or_(AstItemCard.name.ilike(kw), AstItemCard.asset_code.ilike(kw)))
    if status:
        stmt = stmt.where(AstItemCard.status == status)
    if dept_id:
        stmt = stmt.where(AstItemCard.dept_id == parse_uuid(dept_id, "部门ID"))
    if category_id:
        stmt = stmt.where(AstItemCard.category_id == parse_uuid(category_id, "分类ID"))
    # 数据权限：按资产归属部门 / 保管人过滤（RuoYi 5 级）
    stmt = await apply_data_scope(stmt, p, AstItemCard.dept_id, AstItemCard.custodian_user_id, db)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    maps = await load_name_maps(db)
    return page([serialize_asset(a, maps) for a in rows], total)


async def _apply_asset_fields(a: AstItemCard, body: dict, db: AsyncSession, with_code: bool = False) -> None:
    """Whitelisted field assignment with existence validation for FK fields."""
    if "name" in body:
        if not str(body.get("name") or "").strip():
            raise ApiError(400, "资产名称不能为空")
        a.name = str(body["name"]).strip()
    if with_code and body.get("asset_code"):
        a.asset_code = str(body["asset_code"]).strip()
    if "category_id" in body:
        if body["category_id"]:
            cid = parse_uuid(body["category_id"], "分类ID")
            if not await db.get(AstCategory, cid):
                raise ApiError(400, "资产分类不存在")
            a.category_id = cid
        else:
            a.category_id = None
    if "dept_id" in body:
        a.dept_id = parse_uuid(body["dept_id"], "部门ID") if body["dept_id"] else None
    if "custodian_user_id" in body:
        a.custodian_user_id = parse_uuid(body["custodian_user_id"], "保管人ID") if body["custodian_user_id"] else None
    for f in ("model", "spec", "brand", "location", "qr_code_url", "notes"):
        if f in body:
            setattr(a, f, body[f])
    if "price" in body:
        a.price = float(body["price"] or 0)
    if "current_value" in body:
        a.current_value = float(body["current_value"] or 0)
    if "purchase_date" in body:
        a.purchase_date = parse_date(body["purchase_date"], "购置日期") if body["purchase_date"] else None
    if "status" in body:
        if body["status"] not in ASSET_STATUSES:
            raise ApiError(400, "资产状态无效")
        a.status = body["status"]


@router.post("/ledger")
async def create_asset(
    body: dict,
    p: Principal = Depends(require_perms("assets:ledger:add")),
    db: AsyncSession = Depends(get_db),
):
    name = str(body.get("name") or "").strip()
    if not name:
        raise ApiError(400, "资产名称不能为空")
    price = float(body.get("price") or 0)
    asset_code = str(body.get("asset_code") or "").strip()
    if asset_code:
        dup = (await db.execute(
            select(AstItemCard.asset_id).where(AstItemCard.asset_code == asset_code)
        )).scalar_one_or_none()
        if dup:
            raise ApiError(400, f"资产编码 {asset_code} 已存在")
    else:
        # 自动生成 ZC-<年份>-XXXXX 一物一码
        asset_code = await gen_serial_code(db, AstItemCard.asset_code, f"ZC-{current_year()}")

    category_id = parse_uuid(body["category_id"], "分类ID") if body.get("category_id") else None
    if category_id and not await db.get(AstCategory, category_id):
        raise ApiError(400, "资产分类不存在")
    dept_id = parse_uuid(body["dept_id"], "部门ID") if body.get("dept_id") else None
    if dept_id and not await db.get(SysDept, dept_id):
        raise ApiError(400, "所属部门不存在")
    custodian_id = parse_uuid(body["custodian_user_id"], "保管人ID") if body.get("custodian_user_id") else None
    if custodian_id and not await db.get(SysUser, custodian_id):
        raise ApiError(400, "保管人不存在")

    a = AstItemCard(
        asset_code=asset_code, name=name, category_id=category_id, dept_id=dept_id,
        custodian_user_id=custodian_id, price=price,
        current_value=float(body.get("current_value", price)),
        purchase_date=parse_date(body["purchase_date"], "购置日期") if body.get("purchase_date") else None,
        location=body.get("location"), qr_code_url=body.get("qr_code_url"), notes=body.get("notes"),
    )
    await _apply_asset_fields(a, {"model": body.get("model"), "spec": body.get("spec"), "brand": body.get("brand")}, db)
    if body.get("status"):
        if body["status"] not in ASSET_STATUSES:
            raise ApiError(400, "资产状态无效")
        a.status = body["status"]
    db.add(a)
    await db.flush()
    maps = await load_name_maps(db)
    return ok(serialize_asset(a, maps), "资产卡片已创建")


@router.put("/ledger/{asset_id}")
async def update_asset(
    asset_id: str, body: dict,
    p: Principal = Depends(require_perms("assets:ledger:edit")),
    db: AsyncSession = Depends(get_db),
):
    a = await db.get(AstItemCard, parse_uuid(asset_id, "资产ID"))
    if not a:
        raise ApiError(404, "资产不存在")
    if body.get("asset_code") and body["asset_code"] != a.asset_code:
        dup = (await db.execute(
            select(AstItemCard.asset_id).where(
                AstItemCard.asset_code == body["asset_code"], AstItemCard.asset_id != a.asset_id
            )
        )).scalar_one_or_none()
        if dup:
            raise ApiError(400, f"资产编码 {body['asset_code']} 已存在")
    await _apply_asset_fields(a, body, db, with_code=True)
    maps = await load_name_maps(db)
    return ok(serialize_asset(a, maps), "资产卡片已更新")


@router.delete("/ledger/{asset_id}")
async def delete_asset(
    asset_id: str,
    p: Principal = Depends(require_perms("assets:ledger:del")),
    db: AsyncSession = Depends(get_db),
):
    aid = parse_uuid(asset_id, "资产ID")
    a = await db.get(AstItemCard, aid)
    if not a:
        raise ApiError(404, "资产不存在")
    # 核心删除语句，让数据库层 FK ON DELETE CASCADE 清理领用/维修/扫码子记录
    await db.execute(delete(AstItemCard).where(AstItemCard.asset_id == aid))
    return ok(None, "资产卡片已删除")


# ---------------- requisitions (claim / return / borrow / transfer / scrap) ----------------

@router.get("/requisitions")
async def list_requisitions(
    p: Principal = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
    req_type: str | None = None, audit_status: str | None = None,
    asset_id: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AstRequisition).order_by(AstRequisition.created_at.desc())
    if req_type:
        stmt = stmt.where(AstRequisition.req_type == req_type)
    if audit_status:
        stmt = stmt.where(AstRequisition.audit_status == audit_status)
    if asset_id:
        stmt = stmt.where(AstRequisition.asset_id == parse_uuid(asset_id, "资产ID"))
    # 数据权限：申请人本人 / 本部门
    stmt = await apply_data_scope(stmt, p, AstRequisition.dept_id, AstRequisition.user_id, db)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    maps = await load_name_maps(db)
    asset_map = await load_asset_map(db, [r.asset_id for r in rows])
    return page([serialize_req(r, maps, asset_map) for r in rows], total)


@router.post("/requisitions")
async def create_requisition(
    body: dict,
    p: Principal = Depends(require_perms("assets:requisition:add")),
    db: AsyncSession = Depends(get_db),
):
    req_type = body.get("req_type")
    if req_type not in REQ_TYPES:
        raise ApiError(400, "申请类型无效")
    if not str(body.get("reason") or "").strip():
        raise ApiError(400, "请填写申请事由")
    asset = await db.get(AstItemCard, parse_uuid(body.get("asset_id"), "资产ID"))
    if not asset:
        raise ApiError(404, "资产不存在")
    req = AstRequisition(
        req_no=await gen_serial_code(db, AstRequisition.req_no, f"LY-{current_year()}"),
        req_type=req_type, asset_id=asset.asset_id,
        user_id=p.user_id, dept_id=p.dept_id,
        target_dept_id=parse_uuid(body["target_dept_id"], "目标部门ID") if body.get("target_dept_id") else None,
        target_user_id=parse_uuid(body["target_user_id"], "目标保管人ID") if body.get("target_user_id") else None,
        expected_return_date=parse_date(body["expected_return_date"], "预计归还日期") if body.get("expected_return_date") else None,
        reason=str(body["reason"]).strip(),
    )
    db.add(req)
    await db.flush()
    maps = await load_name_maps(db)
    asset_map = await load_asset_map(db, [req.asset_id])
    return ok(serialize_req(req, maps, asset_map), "申请已提交")


@router.post("/requisitions/{req_id}/audit")
async def audit_requisition(
    req_id: str, body: dict,
    p: Principal = Depends(require_perms("assets:requisition:audit")),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(AstRequisition, parse_uuid(req_id, "申请ID"))
    if not req:
        raise ApiError(404, "申请单不存在")
    if req.audit_status != "PENDING":
        raise ApiError(400, "该申请已审批完成")
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    req.audit_status = "APPROVED" if action == "APPROVE" else "REJECTED"
    req.approver_id = p.user_id
    if action == "APPROVE":
        asset = await db.get(AstItemCard, req.asset_id)
        if not asset:
            raise ApiError(404, "关联资产不存在")
        # 审批闭环：单据类型驱动资产状态联动
        if req.req_type == "CLAIM":
            asset.status = "IN_USE"
            asset.custodian_user_id = req.user_id
            dept_id = req.dept_id
            if dept_id is None:
                applicant = await db.get(SysUser, req.user_id)
                dept_id = applicant.dept_id if applicant else None
            if dept_id:
                asset.dept_id = dept_id
        elif req.req_type == "RETURN":
            asset.status = "IN_STOCK"
            req.actual_return_date = today()
        elif req.req_type == "TRANSFER":
            if not req.target_dept_id:
                raise ApiError(400, "调拨申请缺少目标部门，无法通过审批")
            asset.dept_id = req.target_dept_id
            if req.target_user_id:
                asset.custodian_user_id = req.target_user_id
        elif req.req_type == "SCRAP":
            asset.status = "SCRAPPED"
        elif req.req_type == "BORROW":
            asset.status = "BORROWED"
    maps = await load_name_maps(db)
    asset_map = await load_asset_map(db, [req.asset_id])
    return ok(serialize_req(req, maps, asset_map), "审批完成")


@router.post("/requisitions/{req_id}/return")
async def return_borrowed_asset(
    req_id: str,
    p: Principal = Depends(require_perms("assets:requisition:add")),
    db: AsyncSession = Depends(get_db),
):
    """借用归还：原借用单写实际归还日期，并新增一条已完成的 RETURN 归还单。"""
    req = await db.get(AstRequisition, parse_uuid(req_id, "申请ID"))
    if not req:
        raise ApiError(404, "申请单不存在")
    if req.req_type != "BORROW":
        raise ApiError(400, "仅借用单可执行归还操作")
    if req.audit_status != "APPROVED":
        raise ApiError(400, "借用单尚未审批通过")
    if req.actual_return_date:
        raise ApiError(400, "该借用单已归还")
    ret_date = today()
    req.actual_return_date = ret_date
    asset = await db.get(AstItemCard, req.asset_id)
    if asset:
        asset.status = "IN_STOCK"
    ret = AstRequisition(
        req_no=await gen_serial_code(db, AstRequisition.req_no, f"LY-{current_year()}"),
        req_type="RETURN", asset_id=req.asset_id, user_id=req.user_id, dept_id=req.dept_id,
        reason=f"借用归还（原单 {req.req_no}）", audit_status="APPROVED", approver_id=p.user_id,
        actual_return_date=ret_date,
    )
    db.add(ret)
    await db.flush()
    maps = await load_name_maps(db)
    asset_map = await load_asset_map(db, [ret.asset_id])
    return ok(serialize_req(ret, maps, asset_map), "归还登记完成")


# ---------------- maintenance ----------------

@router.get("/maintenance")
async def list_maintenance(
    p: Principal = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
    asset_id: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    # 维修日志以资产为主归属，无申请人字段，暂不叠加数据权限过滤
    stmt = select(AstMaintenanceLog).order_by(AstMaintenanceLog.created_at.desc())
    if asset_id:
        stmt = stmt.where(AstMaintenanceLog.asset_id == parse_uuid(asset_id, "资产ID"))
    if status:
        stmt = stmt.where(AstMaintenanceLog.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    maps = await load_name_maps(db)
    asset_map = await load_asset_map(db, [lg.asset_id for lg in rows])
    return page([serialize_log(lg, maps, asset_map) for lg in rows], total)


@router.post("/maintenance")
async def report_fault(
    body: dict,
    p: Principal = Depends(require_perms("assets:maintenance:add")),
    db: AsyncSession = Depends(get_db),
):
    if not str(body.get("fault_desc") or "").strip():
        raise ApiError(400, "请填写故障描述")
    asset = await db.get(AstItemCard, parse_uuid(body.get("asset_id"), "资产ID"))
    if not asset:
        raise ApiError(404, "资产不存在")
    log = AstMaintenanceLog(
        asset_id=asset.asset_id, fault_desc=str(body["fault_desc"]).strip(),
        vendor=body.get("vendor"), reported_by=p.display_name,
    )
    asset.status = "IN_REPAIR"
    db.add(log)
    await db.flush()
    maps = await load_name_maps(db)
    asset_map = await load_asset_map(db, [log.asset_id])
    return ok(serialize_log(log, maps, asset_map), "报修登记成功")


@router.post("/maintenance/{log_id}/complete")
async def complete_maintenance(
    log_id: str, body: dict,
    p: Principal = Depends(require_perms("assets:maintenance:add")),
    db: AsyncSession = Depends(get_db),
):
    log = await db.get(AstMaintenanceLog, parse_uuid(log_id, "维修单ID"))
    if not log:
        raise ApiError(404, "维修单不存在")
    if log.status == "FIXED":
        raise ApiError(400, "该维修单已完结")
    log.cost = float(body.get("cost") or 0)
    # 完成时可指定 result=SCRAPPED 判定报废；若维修单已标记报废则保持资产报废状态
    if log.status == "SCRAPPED" or body.get("result") == "SCRAPPED":
        log.status = "SCRAPPED"
        asset = await db.get(AstItemCard, log.asset_id)
        if asset:
            asset.status = "SCRAPPED"
    else:
        log.status = "FIXED"
        asset = await db.get(AstItemCard, log.asset_id)
        if asset:
            asset.status = "IN_STOCK"
    maps = await load_name_maps(db)
    asset_map = await load_asset_map(db, [log.asset_id])
    return ok(serialize_log(log, maps, asset_map), "维修单已完结")


# ---------------- stocktake ----------------

def _scope_assets_stmt(plan: AstStocktakePlan):
    stmt = select(AstItemCard).where(AstItemCard.status != "SCRAPPED")
    if plan.scope_dept_id:
        stmt = stmt.where(AstItemCard.dept_id == plan.scope_dept_id)
    return stmt


@router.get("/stocktake")
async def list_stocktakes(
    p: Principal = Depends(require_perms("assets:stocktake:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AstStocktakePlan).order_by(AstStocktakePlan.created_at.desc())
    if status:
        stmt = stmt.where(AstStocktakePlan.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    maps = await load_name_maps(db)
    return page([serialize_plan(pl, maps) for pl in rows], total)


@router.post("/stocktake")
async def create_stocktake(
    body: dict,
    p: Principal = Depends(require_perms("assets:stocktake:add")),
    db: AsyncSession = Depends(get_db),
):
    title = str(body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "请填写盘点任务名称")
    scope_dept_id = parse_uuid(body["scope_dept_id"], "部门ID") if body.get("scope_dept_id") else None
    if scope_dept_id and not await db.get(SysDept, scope_dept_id):
        raise ApiError(400, "盘点范围部门不存在")
    plan = AstStocktakePlan(
        plan_no=await gen_serial_code(db, AstStocktakePlan.plan_no, f"PD-{current_year()}"),
        title=title, scope_dept_id=scope_dept_id, status="IN_PROGRESS",
    )
    # 盘点基数 = 范围内非报废资产数（无范围部门即全盘）
    plan.total_count = (await db.execute(
        select(func.count()).select_from(_scope_assets_stmt(plan).subquery())
    )).scalar()
    db.add(plan)
    await db.flush()
    maps = await load_name_maps(db)
    return ok(serialize_plan(plan, maps), "盘点任务已创建")


@router.post("/stocktake/{plan_id}/scan")
async def stocktake_scan(
    plan_id: str, body: dict,
    p: Principal = Depends(require_perms("assets:stocktake:scan")),
    db: AsyncSession = Depends(get_db),
):
    asset_code = str(body.get("asset_code") or "").strip()
    if not asset_code:
        raise ApiError(400, "请提供资产编码")
    plan = await db.get(AstStocktakePlan, parse_uuid(plan_id, "盘点计划ID"))
    if not plan:
        raise ApiError(404, "盘点计划不存在")
    if plan.status != "IN_PROGRESS":
        raise ApiError(400, "盘点计划已结束，无法扫码")

    asset = (await db.execute(
        select(AstItemCard).where(AstItemCard.asset_code == asset_code)
    )).scalar_one_or_none()
    if not asset:
        return ok({"status": "not_found", "matched": False, "asset_code": asset_code,
                   "verified_count": plan.verified_count, "total_count": plan.total_count},
                  "未找到该编码的资产卡片")
    if plan.scope_dept_id and asset.dept_id != plan.scope_dept_id:
        return ok({"status": "out_of_scope", "matched": False,
                   "asset_code": asset.asset_code, "asset_name": asset.name,
                   "verified_count": plan.verified_count, "total_count": plan.total_count},
                  "该资产不在本次盘点范围内")
    dup = (await db.execute(
        select(AstStocktakeScanRecord).where(
            AstStocktakeScanRecord.plan_id == plan.plan_id,
            AstStocktakeScanRecord.asset_id == asset.asset_id,
        )
    )).scalar_one_or_none()
    if dup:
        # 重复扫码不重复计数
        return ok({"status": "duplicate", "matched": False,
                   "asset_code": asset.asset_code, "asset_name": asset.name,
                   "verified_count": plan.verified_count, "total_count": plan.total_count},
                  "该资产本次盘点已核验过")
    db.add(AstStocktakeScanRecord(
        plan_id=plan.plan_id, asset_id=asset.asset_id,
        asset_code=asset.asset_code, scanned_by=p.user_id,
    ))
    plan.verified_count += 1
    maps = await load_name_maps(db)
    return ok({
        "status": "matched", "matched": True,
        "asset_code": asset.asset_code, "asset_name": asset.name,
        "dept_name": maps["dept"].get(asset.dept_id),
        "location": asset.location,
        "verified_count": plan.verified_count, "total_count": plan.total_count,
        "progress": round(plan.verified_count / max(1, plan.total_count) * 100, 1),
    }, "扫码核验成功")


@router.post("/stocktake/{plan_id}/complete")
async def complete_stocktake(
    plan_id: str,
    p: Principal = Depends(require_perms("assets:stocktake:add")),
    db: AsyncSession = Depends(get_db),
):
    plan = await db.get(AstStocktakePlan, parse_uuid(plan_id, "盘点计划ID"))
    if not plan:
        raise ApiError(404, "盘点计划不存在")
    if plan.status == "COMPLETED":
        raise ApiError(400, "盘点计划已完成")
    loss_count = max(0, plan.total_count - plan.verified_count)  # 简化：盘亏 = 应盘 - 已盘
    plan.status = "COMPLETED"
    plan.loss_count = loss_count

    # 差异报告：范围资产 - 已扫码 = 未盘（疑似盘亏）
    scope_assets = (await db.execute(_scope_assets_stmt(plan))).scalars().all()
    scanned_ids = set((await db.execute(
        select(AstStocktakeScanRecord.asset_id).where(AstStocktakeScanRecord.plan_id == plan.plan_id)
    )).scalars().all())
    maps = await load_name_maps(db)
    unverified = [{
        "asset_id": str(a.asset_id), "asset_code": a.asset_code, "name": a.name,
        "dept_name": maps["dept"].get(a.dept_id), "location": a.location,
    } for a in scope_assets if a.asset_id not in scanned_ids]
    report = {
        "plan_id": str(plan.plan_id), "plan_no": plan.plan_no, "title": plan.title,
        "status": plan.status,
        "scope_dept_id": str(plan.scope_dept_id) if plan.scope_dept_id else None,
        "scope_dept_name": maps["dept"].get(plan.scope_dept_id),
        "total_count": plan.total_count, "verified_count": plan.verified_count,
        "surplus_count": plan.surplus_count, "loss_count": plan.loss_count,
        "loss_rate": round(plan.loss_count / max(1, plan.total_count) * 100, 1),
        "unverified": unverified,
    }
    return ok(report, "盘点已完成")


# ---------------- depreciation ----------------

@router.get("/depreciation")
async def depreciation_report(
    p: Principal = Depends(require_perms("assets:ledger:list")),
    db: AsyncSession = Depends(get_db),
    month: str | None = None,
):
    """按平均年限法（5 年）估算月折旧与净值，按分类汇总并附逐条资产明细。"""
    if month:
        try:
            y, m = (int(x) for x in month.split("-"))
            if not 1 <= m <= 12:
                raise ValueError
        except (ValueError, TypeError):
            raise ApiError(400, "month 格式无效，应为 YYYY-MM")
    else:
        tznow = datetime.now(BUSINESS_TZ)
        y, m = tznow.year, tznow.month

    stmt = select(AstItemCard).where(AstItemCard.status != "SCRAPPED")
    # 数据权限与台账保持一致
    stmt = await apply_data_scope(stmt, p, AstItemCard.dept_id, AstItemCard.custodian_user_id, db)
    assets = (await db.execute(stmt.order_by(AstItemCard.asset_code))).scalars().all()
    maps = await load_name_maps(db)

    categories: dict[str, dict] = {}
    items = []
    for a in assets:
        dep = monthly_depreciation(a.price)
        cv = asset_current_value(a.price, a.purchase_date, y, m)
        cat_name = maps["cat"].get(a.category_id) or "未分类"
        agg = categories.setdefault(cat_name, {
            "category_name": cat_name, "count": 0,
            "total_price": 0.0, "monthly_depreciation": 0.0, "current_value": 0.0,
        })
        agg["count"] += 1
        agg["total_price"] += float(a.price or 0)
        agg["monthly_depreciation"] += dep
        agg["current_value"] += cv
        items.append({
            "asset_id": str(a.asset_id), "asset_code": a.asset_code, "name": a.name,
            "category_name": cat_name,
            "price": a.price, "purchase_date": a.purchase_date.isoformat() if a.purchase_date else None,
            "monthly_depreciation": dep, "current_value": cv,
        })
    for agg in categories.values():
        for k in ("total_price", "monthly_depreciation", "current_value"):
            agg[k] = round(agg[k], 2)
    return ok({
        "month": f"{y}-{m:02d}",
        "method": f"平均年限法（{DEPRECIATION_YEARS} 年）",
        "summary": {
            "total_price": round(sum(float(a.price or 0) for a in assets), 2),
            "total_monthly_depreciation": round(sum(monthly_depreciation(a.price) for a in assets), 2),
            "total_current_value": round(sum(asset_current_value(a.price, a.purchase_date, y, m) for a in assets), 2),
        },
        "categories": sorted(categories.values(), key=lambda x: x["category_name"]),
        "items": items,
    })


# ---------------- consumables ----------------

@router.get("/consumables")
async def list_consumables(
    p: Principal = Depends(require_perms("assets:consumable:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, category: str | None = None,
    low_stock: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AstConsumable).order_by(AstConsumable.item_code)
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(or_(AstConsumable.name.ilike(kw), AstConsumable.item_code.ilike(kw)))
    if category:
        stmt = stmt.where(AstConsumable.category == category)
    if low_stock in ("true", "1", "True"):
        stmt = stmt.where(AstConsumable.stock_count <= AstConsumable.min_stock)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([serialize_consumable(c) for c in rows], total)


@router.post("/consumables")
async def create_consumable(
    body: dict,
    p: Principal = Depends(require_perms("assets:consumable:add")),
    db: AsyncSession = Depends(get_db),
):
    name = str(body.get("name") or "").strip()
    if not name:
        raise ApiError(400, "耗材名称不能为空")
    item_code = str(body.get("item_code") or "").strip()
    if item_code:
        dup = (await db.execute(
            select(AstConsumable.item_id).where(AstConsumable.item_code == item_code)
        )).scalar_one_or_none()
        if dup:
            raise ApiError(400, f"耗材编码 {item_code} 已存在")
    else:
        item_code = await gen_serial_code(db, AstConsumable.item_code, f"HC-{current_year()}")
    c = AstConsumable(
        item_code=item_code, name=name,
        category=body.get("category", "办公文具"), spec=body.get("spec"),
        unit=body.get("unit", "件"), stock_count=int(body.get("stock_count") or 0),
        min_stock=int(body.get("min_stock") or 10), unit_price=float(body.get("unit_price") or 0),
    )
    db.add(c)
    await db.flush()
    return ok(serialize_consumable(c), "耗材目录已新增")


@router.put("/consumables/{item_id}")
async def update_consumable(
    item_id: str, body: dict,
    p: Principal = Depends(require_perms("assets:consumable:add")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(AstConsumable, parse_uuid(item_id, "耗材ID"))
    if not c:
        raise ApiError(404, "耗材不存在")
    if "name" in body:
        if not str(body.get("name") or "").strip():
            raise ApiError(400, "耗材名称不能为空")
        c.name = str(body["name"]).strip()
    if "item_code" in body and body["item_code"] and body["item_code"] != c.item_code:
        dup = (await db.execute(
            select(AstConsumable.item_id).where(
                AstConsumable.item_code == body["item_code"], AstConsumable.item_id != c.item_id
            )
        )).scalar_one_or_none()
        if dup:
            raise ApiError(400, f"耗材编码 {body['item_code']} 已存在")
        c.item_code = str(body["item_code"]).strip()
    for f in ("category", "spec", "unit"):
        if f in body:
            setattr(c, f, body[f])
    if "stock_count" in body:
        c.stock_count = int(body["stock_count"] or 0)
    if "min_stock" in body:
        c.min_stock = int(body["min_stock"] or 0)
    if "unit_price" in body:
        c.unit_price = float(body["unit_price"] or 0)
    return ok(serialize_consumable(c), "耗材目录已更新")


@router.get("/consumables/requisitions")
async def list_consumable_requisitions(
    p: Principal = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
    status: str | None = None, item_id: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AstConsumableRequisition).order_by(AstConsumableRequisition.created_at.desc())
    if status:
        stmt = stmt.where(AstConsumableRequisition.status == status)
    if item_id:
        stmt = stmt.where(AstConsumableRequisition.item_id == parse_uuid(item_id, "耗材ID"))
    # 数据权限：领用人本人 / 本部门
    stmt = await apply_data_scope(stmt, p, AstConsumableRequisition.dept_id, AstConsumableRequisition.user_id, db)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    maps = await load_name_maps(db)
    items = (await db.execute(select(AstConsumable))).scalars().all()
    item_map = {c.item_id: c for c in items}
    return page([serialize_consumable_req(cr, maps, item_map) for cr in rows], total)


@router.post("/consumables/requisitions")
async def create_consumable_requisition(
    body: dict,
    p: Principal = Depends(require_perms("assets:consumable:add")),
    db: AsyncSession = Depends(get_db),
):
    quantity = int(body.get("quantity") or 0)
    if quantity < 1:
        raise ApiError(400, "领用数量必须大于 0")
    if not str(body.get("purpose") or "").strip():
        raise ApiError(400, "请填写领用用途")
    item = await db.get(AstConsumable, parse_uuid(body.get("item_id"), "耗材ID"))
    if not item:
        raise ApiError(404, "耗材不存在")
    cr = AstConsumableRequisition(
        item_id=item.item_id, user_id=p.user_id, dept_id=p.dept_id,
        quantity=quantity, purpose=str(body["purpose"]).strip(),
    )
    db.add(cr)
    await db.flush()
    maps = await load_name_maps(db)
    item_map = {item.item_id: item}
    return ok(serialize_consumable_req(cr, maps, item_map), "耗材领用申请已提交")


@router.post("/consumables/requisitions/{req_id}/audit")
async def audit_consumable_requisition(
    req_id: str, body: dict,
    p: Principal = Depends(require_perms("assets:consumable:audit")),
    db: AsyncSession = Depends(get_db),
):
    cr = await db.get(AstConsumableRequisition, parse_uuid(req_id, "领用申请ID"))
    if not cr:
        raise ApiError(404, "领用申请不存在")
    if cr.status != "PENDING":
        raise ApiError(400, "该申请已审批完成")
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    if action == "APPROVE":
        item = await db.get(AstConsumable, cr.item_id)
        if not item:
            raise ApiError(404, "耗材不存在")
        if item.stock_count < cr.quantity:
            raise ApiError(400, f"库存不足：当前库存 {item.stock_count} {item.unit}，需领用 {cr.quantity} {item.unit}")
        # 审批通过即核减库存（闭环）
        item.stock_count -= cr.quantity
    cr.status = "APPROVED" if action == "APPROVE" else "REJECTED"
    maps = await load_name_maps(db)
    items = (await db.execute(select(AstConsumable).where(AstConsumable.item_id == cr.item_id))).scalars().all()
    item_map = {c.item_id: c for c in items}
    return ok(serialize_consumable_req(cr, maps, item_map), "审批完成")
