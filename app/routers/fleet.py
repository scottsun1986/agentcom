"""Official vehicle (fleet) management endpoints, full closed loop:
application -> dept audit -> admin audit -> dispatch -> trip return,
plus vehicle/driver ledgers, maintenance warnings and fuel audit."""

import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUSINESS_TZ
from app.core.deps import Principal, require_auth, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.database import get_db
from app.models.extras import FltFuelLog, FltMaintenanceLog
from app.models.fleet import FltApplication, FltDriver, FltTripDispatch, FltVehicle
from app.models.system import SysDept, SysUser

router = APIRouter(prefix="/api/fleet", tags=["公务用车管理"])

DESIGNATED_STATIONS = ["中石化XX加油站", "中石油XX加油站", "机关定点加油站"]
FUEL_THRESHOLD = 15.0  # 百公里油耗异常阈值（L/100km）
WARNING_DAYS = 30      # 维保/年审/保险临期预警窗口（天）

VEHICLE_STATUS_LABELS = {
    "AVAILABLE": "待命", "DISPATCHED": "出车中", "MAINTENANCE": "维保送修", "SCRAPPED": "已报废",
}
QUOTA_TYPE_LABELS = {
    "GENERAL_OFFICIAL": "一般公务用车", "EMERGENCY": "机要通信/应急保障", "SPECIAL": "调研接待用车",
}
DRIVER_STATUS_LABELS = {"ON_DUTY": "在岗待命", "DISPATCHED": "出车中", "OFF_DUTY": "离岗休假"}
APP_STATUS_LABELS = {
    "DEPT_PENDING": "待部门审批", "ADMIN_PENDING": "待车管科审批", "APPROVED": "已批准待派车",
    "DISPATCHED": "已派车", "COMPLETED": "已完成", "REJECTED": "已驳回",
}
TRIP_TYPE_LABELS = {"LEADERSHIP_RESEARCH": "领导调研", "OFFICIAL_BUSINESS": "公务出行", "EMERGENCY": "应急保障"}
DISPATCH_STATUS_LABELS = {"DISPATCHED": "出车中", "RETURNED": "已归队", "SETTLED": "已结算"}
LOG_TYPE_LABELS = {"MAINTENANCE": "定期保养", "INSURANCE": "保险续保", "INSPECTION": "安全年审", "REPAIR": "维修送修"}


def parse_uuid(value, msg: str = "标识格式无效") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, msg)


def parse_dt(value, label: str) -> datetime:
    try:
        return datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        raise ApiError(400, f"{label}格式无效，应为 ISO 时间")


def parse_date(value, label: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        raise ApiError(400, f"{label}格式无效，应为 YYYY-MM-DD")


# ---------------- batch id->name/object maps (avoid async lazy-load MissingGreenlet) ----------------

async def dept_and_children(dept_id, db: AsyncSession) -> list:
    from app.models.system import SysDept as _SysDept
    if not dept_id:
        return []
    rows = (await db.execute(
        select(_SysDept.dept_id).where(_SysDept.ancestors.contains(str(dept_id)), _SysDept.del_flag == "0")
    )).scalars().all()
    return [dept_id, *rows]


async def user_name_map(db: AsyncSession, user_ids) -> dict:
    ids = {i for i in user_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(
        select(SysUser.user_id, SysUser.nick_name).where(SysUser.user_id.in_(ids))
    )).all()
    return {r[0]: r[1] for r in rows}


async def dept_name_map(db: AsyncSession, dept_ids) -> dict:
    ids = {i for i in dept_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(
        select(SysDept.dept_id, SysDept.dept_name).where(SysDept.dept_id.in_(ids))
    )).all()
    return {r[0]: r[1] for r in rows}


async def vehicle_map(db: AsyncSession, vehicle_ids) -> dict:
    ids = {i for i in vehicle_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(FltVehicle).where(FltVehicle.vehicle_id.in_(ids)))).scalars().all()
    return {v.vehicle_id: v for v in rows}


async def driver_map(db: AsyncSession, driver_ids) -> dict:
    ids = {i for i in driver_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(FltDriver).where(FltDriver.driver_id.in_(ids)))).scalars().all()
    return {d.driver_id: d for d in rows}


async def application_map(db: AsyncSession, app_ids) -> dict:
    ids = {i for i in app_ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(FltApplication).where(FltApplication.app_id.in_(ids)))).scalars().all()
    return {a.app_id: a for a in rows}


# ---------------- serializers ----------------

def serialize_vehicle(v: FltVehicle) -> dict:
    return {
        "vehicle_id": str(v.vehicle_id),
        "plate_no": v.plate_no,
        "brand_model": v.brand_model,
        "seat_count": v.seat_count,
        "quota_type": v.quota_type,
        "quota_type_label": QUOTA_TYPE_LABELS.get(v.quota_type, v.quota_type),
        "current_mileage": v.current_mileage,
        "status": v.status,
        "status_label": VEHICLE_STATUS_LABELS.get(v.status, v.status),
        "designated_parking_spot": v.designated_parking_spot,
        "fuel_card_no": v.fuel_card_no,
        "insurance_expire_date": v.insurance_expire_date.isoformat() if v.insurance_expire_date else None,
        "annual_inspection_date": v.annual_inspection_date.isoformat() if v.annual_inspection_date else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def serialize_driver(d: FltDriver, users: dict | None = None) -> dict:
    return {
        "driver_id": str(d.driver_id),
        "user_id": str(d.user_id) if d.user_id else None,
        "user_name": users.get(d.user_id) if users else None,
        "name": d.name,
        "phone": d.phone,
        "license_type": d.license_type,
        "status": d.status,
        "status_label": DRIVER_STATUS_LABELS.get(d.status, d.status),
        "safe_mileage": d.safe_mileage,
    }


def serialize_application(a: FltApplication, users: dict, depts: dict, plate_map: dict | None = None) -> dict:
    return {
        "app_id": str(a.app_id),
        "applicant_id": str(a.applicant_id),
        "applicant_name": users.get(a.applicant_id),
        "dept_id": str(a.dept_id) if a.dept_id else None,
        "dept_name": depts.get(a.dept_id),
        "purpose": a.purpose,
        "trip_type": a.trip_type,
        "trip_type_label": TRIP_TYPE_LABELS.get(a.trip_type, a.trip_type),
        "origin": a.origin,
        "destination": a.destination,
        "route_plan": a.route_plan,
        "passenger_count": a.passenger_count,
        "leader_name": a.leader_name,
        "start_time": a.start_time.isoformat(),
        "end_time": a.end_time.isoformat(),
        "status": a.status,
        "status_label": APP_STATUS_LABELS.get(a.status, a.status),
        "plate_no": (plate_map or {}).get(a.app_id),
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def serialize_dispatch(
    d: FltTripDispatch,
    vehicles: dict, drivers: dict, apps: dict, users: dict,
) -> dict:
    v = vehicles.get(d.vehicle_id)
    dr = drivers.get(d.driver_id)
    a = apps.get(d.app_id)
    trip_mileage = None
    if d.status in ("RETURNED", "SETTLED"):
        trip_mileage = round((d.end_mileage or 0) - (d.start_mileage or 0), 1)
    return {
        "dispatch_id": str(d.dispatch_id),
        "app_id": str(d.app_id),
        "vehicle_id": str(d.vehicle_id),
        "plate_no": v.plate_no if v else None,
        "brand_model": v.brand_model if v else None,
        "driver_id": str(d.driver_id),
        "driver_name": dr.name if dr else None,
        "driver_phone": dr.phone if dr else None,
        "applicant_name": users.get(a.applicant_id) if a else None,
        "purpose": a.purpose if a else None,
        "origin": a.origin if a else None,
        "destination": a.destination if a else None,
        "route_plan": a.route_plan if a else None,
        "plan_start_time": a.start_time.isoformat() if a and a.start_time else None,
        "plan_end_time": a.end_time.isoformat() if a and a.end_time else None,
        "start_mileage": d.start_mileage,
        "end_mileage": d.end_mileage if d.status in ("RETURNED", "SETTLED") else None,
        "trip_mileage": trip_mileage,
        "toll_cost": d.toll_cost if d.status in ("RETURNED", "SETTLED") else None,
        "fuel_cost": d.fuel_cost if d.status in ("RETURNED", "SETTLED") else None,
        "actual_return_time": d.actual_return_time.isoformat() if d.actual_return_time else None,
        "status": d.status,
        "status_label": DISPATCH_STATUS_LABELS.get(d.status, d.status),
        "notes": d.notes,
    }


def serialize_maintenance(m: FltMaintenanceLog, vehicles: dict) -> dict:
    v = vehicles.get(m.vehicle_id)
    return {
        "log_id": str(m.log_id),
        "vehicle_id": str(m.vehicle_id),
        "plate_no": v.plate_no if v else None,
        "log_type": m.log_type,
        "log_type_label": LOG_TYPE_LABELS.get(m.log_type, m.log_type),
        "mileage_at_service": m.mileage_at_service,
        "cost": m.cost,
        "vendor": m.vendor,
        "next_due_date": m.next_due_date.isoformat() if m.next_due_date else None,
        "next_due_mileage": m.next_due_mileage,
        "notes": m.notes,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def serialize_fuel(f: FltFuelLog, vehicles: dict) -> dict:
    v = vehicles.get(f.vehicle_id)
    return {
        "fuel_id": str(f.fuel_id),
        "vehicle_id": str(f.vehicle_id),
        "plate_no": v.plate_no if v else None,
        "fuel_date": f.fuel_date.isoformat() if f.fuel_date else None,
        "station": f.station,
        "liters": f.liters,
        "cost": f.cost,
        "mileage_at_fuel": f.mileage_at_fuel,
        "is_abnormal": f.is_abnormal,
        "abnormal_reason": f.abnormal_reason,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


# ---------------- dashboard ----------------

@router.get("/dashboard")
async def fleet_dashboard(
    p: Principal = Depends(require_perms("fleet:dashboard:list")),
    db: AsyncSession = Depends(get_db),
):
    tznow = datetime.now(BUSINESS_TZ)
    today = tznow.date()
    month_start = today.replace(day=1)
    next_month = date(today.year + (today.month == 12), (today.month % 12) + 1, 1)
    m_start = datetime.combine(month_start, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    m_end = datetime.combine(next_month, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)

    total = (await db.execute(select(func.count()).select_from(FltVehicle))).scalar()
    status_rows = (await db.execute(
        select(FltVehicle.status, func.count()).group_by(FltVehicle.status)
    )).all()
    status_counts = {s: c for s, c in status_rows}

    # 本月出车次数与总里程：以已归队（RETURNED）派车单的实际归还时间归集
    trip_count, total_mileage = (await db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(FltTripDispatch.end_mileage - FltTripDispatch.start_mileage), 0.0),
        ).where(
            FltTripDispatch.status == "RETURNED",
            FltTripDispatch.actual_return_time >= m_start,
            FltTripDispatch.actual_return_time < m_end,
        )
    )).one()

    # 本月定点加油成本汇总
    fuel_cost, fuel_liters = (await db.execute(
        select(func.coalesce(func.sum(FltFuelLog.cost), 0.0), func.coalesce(func.sum(FltFuelLog.liters), 0.0))
        .where(FltFuelLog.fuel_date >= month_start, FltFuelLog.fuel_date < next_month)
    )).one()

    warn_deadline = today + timedelta(days=WARNING_DAYS)
    insurance_cnt = (await db.execute(
        select(func.count()).select_from(FltVehicle).where(
            FltVehicle.insurance_expire_date.is_not(None),
            FltVehicle.insurance_expire_date <= warn_deadline,
        )
    )).scalar()
    inspection_cnt = (await db.execute(
        select(func.count()).select_from(FltVehicle).where(
            FltVehicle.annual_inspection_date.is_not(None),
            FltVehicle.annual_inspection_date <= warn_deadline,
        )
    )).scalar()
    maintenance_cnt = (await db.execute(
        select(func.count(func.distinct(FltMaintenanceLog.vehicle_id))).where(
            FltMaintenanceLog.next_due_date.is_not(None),
            FltMaintenanceLog.next_due_date <= warn_deadline,
        )
    )).scalar()

    return ok({
        "month": f"{today.year}-{today.month:02d}",
        "vehicle_total": total,
        "status_counts": {
            "AVAILABLE": status_counts.get("AVAILABLE", 0),
            "DISPATCHED": status_counts.get("DISPATCHED", 0),
            "MAINTENANCE": status_counts.get("MAINTENANCE", 0),
        },
        "month_trips": {"count": trip_count, "total_mileage": round(float(total_mileage or 0), 1)},
        "month_fuel": {"cost": round(float(fuel_cost or 0), 2), "liters": round(float(fuel_liters or 0), 1)},
        "warnings": {
            "maintenance": maintenance_cnt,
            "annual_inspection": inspection_cnt,
            "insurance": insurance_cnt,
        },
    })


# ---------------- vehicles (one car one file) ----------------

@router.get("/vehicles")
async def list_vehicles(
    p: Principal = Depends(require_perms("fleet:vehicle:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None, quota_type: str | None = None, keyword: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(FltVehicle).order_by(FltVehicle.created_at.desc())
    if status:
        stmt = stmt.where(FltVehicle.status == status)
    if quota_type:
        stmt = stmt.where(FltVehicle.quota_type == quota_type)
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(or_(FltVehicle.plate_no.ilike(kw), FltVehicle.brand_model.ilike(kw)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([serialize_vehicle(v) for v in rows], total)


async def _apply_vehicle_fields(v: FltVehicle, body: dict) -> None:
    if body.get("plate_no"):
        v.plate_no = str(body["plate_no"]).strip()
    if body.get("brand_model"):
        v.brand_model = str(body["brand_model"]).strip()
    if "seat_count" in body and body["seat_count"] is not None:
        v.seat_count = int(body["seat_count"])
    if "quota_type" in body and body["quota_type"]:
        v.quota_type = body["quota_type"]
    if "current_mileage" in body and body["current_mileage"] is not None:
        v.current_mileage = float(body["current_mileage"])
    if "designated_parking_spot" in body:
        v.designated_parking_spot = body["designated_parking_spot"]
    if "fuel_card_no" in body:
        v.fuel_card_no = body["fuel_card_no"]
    if "insurance_expire_date" in body:
        v.insurance_expire_date = parse_date(body["insurance_expire_date"], "保险到期日") if body["insurance_expire_date"] else None
    if "annual_inspection_date" in body:
        v.annual_inspection_date = parse_date(body["annual_inspection_date"], "年审日期") if body["annual_inspection_date"] else None


@router.post("/vehicles")
async def create_vehicle(
    body: dict,
    p: Principal = Depends(require_perms("fleet:vehicle:add")),
    db: AsyncSession = Depends(get_db),
):
    plate_no = str(body.get("plate_no") or "").strip()
    brand_model = str(body.get("brand_model") or "").strip()
    if not plate_no or not brand_model:
        raise ApiError(400, "车牌号码与品牌型号为必填项")
    dup = (await db.execute(select(FltVehicle.vehicle_id).where(FltVehicle.plate_no == plate_no))).scalar_one_or_none()
    if dup:
        raise ApiError(400, f"车牌号 {plate_no} 已存在，一车一档不可重复建档")
    v = FltVehicle(plate_no=plate_no, brand_model=brand_model)
    await _apply_vehicle_fields(v, body)
    db.add(v)
    await db.flush()
    return ok(serialize_vehicle(v), "车辆建档成功")


@router.put("/vehicles/{vehicle_id}")
async def update_vehicle(
    vehicle_id: str, body: dict,
    p: Principal = Depends(require_perms("fleet:vehicle:edit")),
    db: AsyncSession = Depends(get_db),
):
    v = await db.get(FltVehicle, parse_uuid(vehicle_id, "车辆ID格式无效"))
    if not v:
        raise ApiError(404, "车辆不存在")
    if body.get("plate_no") and str(body["plate_no"]).strip() != v.plate_no:
        dup = (await db.execute(
            select(FltVehicle.vehicle_id).where(
                FltVehicle.plate_no == str(body["plate_no"]).strip(), FltVehicle.vehicle_id != v.vehicle_id
            )
        )).scalar_one_or_none()
        if dup:
            raise ApiError(400, f"车牌号 {str(body['plate_no']).strip()} 已存在")
    await _apply_vehicle_fields(v, body)
    return ok(serialize_vehicle(v), "车辆信息已更新")


@router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(
    vehicle_id: str,
    p: Principal = Depends(require_perms("fleet:vehicle:del")),
    db: AsyncSession = Depends(get_db),
):
    vid = parse_uuid(vehicle_id, "车辆ID格式无效")
    v = await db.get(FltVehicle, vid)
    if not v:
        raise ApiError(404, "车辆不存在")
    if v.status == "DISPATCHED":
        raise ApiError(400, "该车辆出车中，不可删除档案")
    # 依赖数据库层 FK ON DELETE CASCADE 清理派车单/维保/加油子记录
    await db.execute(delete(FltVehicle).where(FltVehicle.vehicle_id == vid))
    return ok(None, "车辆档案已删除")


# ---------------- drivers ----------------

@router.get("/drivers")
async def list_drivers(
    p: Principal = Depends(require_perms("fleet:driver:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None, keyword: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(FltDriver).order_by(FltDriver.name)
    if status:
        stmt = stmt.where(FltDriver.status == status)
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(or_(FltDriver.name.ilike(kw), FltDriver.phone.ilike(kw)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    users = await user_name_map(db, {d.user_id for d in rows})
    return page([serialize_driver(d, users) for d in rows], total)


@router.post("/drivers")
async def create_driver(
    body: dict,
    p: Principal = Depends(require_perms("fleet:driver:add")),
    db: AsyncSession = Depends(get_db),
):
    name = str(body.get("name") or "").strip()
    phone = str(body.get("phone") or "").strip()
    if not name or not phone:
        raise ApiError(400, "驾驶员姓名与联系电话为必填项")
    d = FltDriver(
        name=name,
        phone=phone,
        license_type=body.get("license_type", "A1"),
        status=body.get("status", "ON_DUTY") or "ON_DUTY",
        safe_mileage=float(body.get("safe_mileage") or 0.0),
        user_id=parse_uuid(body["user_id"], "关联用户ID格式无效") if body.get("user_id") else None,
    )
    if d.status not in DRIVER_STATUS_LABELS:
        raise ApiError(400, "驾驶员状态无效")
    db.add(d)
    await db.flush()
    return ok(serialize_driver(d), "驾驶员档案已创建")


@router.put("/drivers/{driver_id}")
async def update_driver(
    driver_id: str, body: dict,
    p: Principal = Depends(require_perms("fleet:driver:edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(FltDriver, parse_uuid(driver_id, "驾驶员ID格式无效"))
    if not d:
        raise ApiError(404, "驾驶员不存在")
    if "name" in body and str(body["name"]).strip():
        d.name = str(body["name"]).strip()
    if "phone" in body and str(body["phone"]).strip():
        d.phone = str(body["phone"]).strip()
    if "license_type" in body and body["license_type"]:
        d.license_type = body["license_type"]
    if "safe_mileage" in body and body["safe_mileage"] is not None:
        d.safe_mileage = float(body["safe_mileage"])
    if "user_id" in body:
        d.user_id = parse_uuid(body["user_id"], "关联用户ID格式无效") if body["user_id"] else None
    # 排班状态请走 POST /drivers/{id}/status；DISPATCHED 由派车流程联动维护，此处不允许手工改
    return ok(serialize_driver(d), "驾驶员信息已更新")


@router.post("/drivers/{driver_id}/status")
async def switch_driver_status(
    driver_id: str, body: dict,
    p: Principal = Depends(require_perms("fleet:driver:edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(FltDriver, parse_uuid(driver_id, "驾驶员ID格式无效"))
    if not d:
        raise ApiError(404, "驾驶员不存在")
    status = body.get("status", "")
    if status not in ("ON_DUTY", "OFF_DUTY"):
        raise ApiError(400, "排班状态仅支持 ON_DUTY / OFF_DUTY（出车中状态由派车流程自动维护）")
    if d.status == "DISPATCHED" and status == "OFF_DUTY":
        raise ApiError(400, "该驾驶员出车中，归队核销后方可调整排班")
    d.status = status
    return ok(serialize_driver(d), "排班状态已切换")


# ---------------- applications (two-step audit) ----------------

@router.get("/applications")
async def list_applications(
    p: Principal = Depends(require_perms("fleet:application:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None, keyword: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(FltApplication).order_by(FltApplication.created_at.desc())
    # 数据权限：按申请人归属过滤（RuoYi 5 级）
    from app.core.deps import DataScope as DS
    if p.auth_kind == "user" and not p.is_admin:
        if p.data_scope == DS.SELF.value:
            stmt = stmt.where(FltApplication.applicant_id == p.user_id)
        elif p.data_scope == DS.DEPT.value:
            stmt = stmt.where(FltApplication.applicant_id.in_(select(SysUser.user_id).where(SysUser.dept_id == p.dept_id)))
        elif p.data_scope == DS.DEPT_AND_CHILD.value:
            ids = await dept_and_children(p.dept_id, db)
            stmt = stmt.where(FltApplication.applicant_id.in_(select(SysUser.user_id).where(SysUser.dept_id.in_(ids))))
    if status:
        stmt = stmt.where(FltApplication.status == status)
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(or_(FltApplication.purpose.ilike(kw), FltApplication.destination.ilike(kw)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    users = await user_name_map(db, {a.applicant_id for a in rows})
    depts = await dept_name_map(db, {a.dept_id for a in rows})
    # 批量取派车单，建立 app_id -> 车牌号 映射补充展示
    plate_map: dict = {}
    if rows:
        drows = (await db.execute(
            select(FltTripDispatch).where(FltTripDispatch.app_id.in_({a.app_id for a in rows}))
        )).scalars().all()
        vmap = await vehicle_map(db, {d.vehicle_id for d in drows})
        plate_map = {d.app_id: vmap[d.vehicle_id].plate_no for d in drows if d.vehicle_id in vmap}
    return page([serialize_application(a, users, depts, plate_map) for a in rows], total)


@router.post("/applications")
async def create_application(
    body: dict,
    p: Principal = Depends(require_perms("fleet:application:add")),
    db: AsyncSession = Depends(get_db),
):
    purpose = str(body.get("purpose") or "").strip()
    destination = str(body.get("destination") or "").strip()
    if not purpose or not destination:
        raise ApiError(400, "用车事由与目的地为必填项")
    start_time = parse_dt(body["start_time"], "用车开始时间")
    end_time = parse_dt(body["end_time"], "用车结束时间")
    if end_time <= start_time:
        raise ApiError(400, "结束时间必须晚于开始时间")
    trip_type = body.get("trip_type", "OFFICIAL_BUSINESS")
    if trip_type not in TRIP_TYPE_LABELS:
        raise ApiError(400, "用车类型无效")
    a = FltApplication(
        applicant_id=p.user_id,
        dept_id=p.dept_id,
        purpose=purpose,
        trip_type=trip_type,
        origin=str(body.get("origin") or "机关大院"),
        destination=destination,
        route_plan=body.get("route_plan"),
        passenger_count=int(body.get("passenger_count") or 1),
        leader_name=body.get("leader_name"),
        start_time=start_time,
        end_time=end_time,
        status="DEPT_PENDING",
    )
    db.add(a)
    await db.flush()
    users = await user_name_map(db, {a.applicant_id})
    depts = await dept_name_map(db, {a.dept_id})
    return ok(serialize_application(a, users, depts), "用车申请已提交，等待部门负责人审批")


@router.post("/applications/{app_id}/audit")
async def audit_application(
    app_id: str, body: dict,
    p: Principal = Depends(require_perms("fleet:application:audit")),
    db: AsyncSession = Depends(get_db),
):
    a = await db.get(FltApplication, parse_uuid(app_id, "申请ID格式无效"))
    if not a:
        raise ApiError(404, "用车申请不存在")
    action = body.get("action", "")
    step = body.get("step", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    if step not in ("DEPT", "ADMIN"):
        raise ApiError(400, "审批环节无效（DEPT=部门负责人，ADMIN=车管科）")
    if step == "DEPT":
        if a.status != "DEPT_PENDING":
            raise ApiError(400, f"当前状态为「{APP_STATUS_LABELS.get(a.status, a.status)}」，不在部门审批环节")
        if action == "APPROVE":
            a.status = "ADMIN_PENDING"
        else:
            a.status = "REJECTED"
    else:  # ADMIN
        if a.status != "ADMIN_PENDING":
            raise ApiError(400, f"当前状态为「{APP_STATUS_LABELS.get(a.status, a.status)}」，不在车管科审批环节")
        if action == "APPROVE":
            a.status = "APPROVED"
        else:
            a.status = "REJECTED"
    # FltApplication 模型无审批人/意见字段（规范禁止改模型），审批意见仅回显不落库
    users = await user_name_map(db, {a.applicant_id})
    depts = await dept_name_map(db, {a.dept_id})
    label = "部门审批通过，转车管科合规审批" if a.status == "ADMIN_PENDING" else (
        "车管科审批通过，等待调度派车" if a.status == "APPROVED" else "用车申请已驳回")
    return ok(serialize_application(a, users, depts), label)


# ---------------- dispatch & trip logs ----------------

@router.post("/applications/{app_id}/dispatch")
async def dispatch_application(
    app_id: str, body: dict,
    p: Principal = Depends(require_perms("fleet:dispatch:add")),
    db: AsyncSession = Depends(get_db),
):
    a = await db.get(FltApplication, parse_uuid(app_id, "申请ID格式无效"))
    if not a:
        raise ApiError(404, "用车申请不存在")
    if a.status != "APPROVED":
        raise ApiError(400, f"仅「已批准待派车」的申请可派车，当前状态为「{APP_STATUS_LABELS.get(a.status, a.status)}」")
    vehicle_id = parse_uuid(body.get("vehicle_id"), "车辆ID无效")
    driver_id = parse_uuid(body.get("driver_id"), "驾驶员ID无效")
    v = await db.get(FltVehicle, vehicle_id)
    if not v:
        raise ApiError(404, "车辆不存在")
    if v.status != "AVAILABLE":
        raise ApiError(400, f"车辆「{v.plate_no}」当前状态为「{VEHICLE_STATUS_LABELS.get(v.status, v.status)}」，不可派车")
    if v.seat_count < (a.passenger_count or 1):
        raise ApiError(400, f"车辆「{v.plate_no}」核载 {v.seat_count} 座，不满足 {a.passenger_count} 人乘车需求")
    d = await db.get(FltDriver, driver_id)
    if not d:
        raise ApiError(404, "驾驶员不存在")
    if d.status != "ON_DUTY":
        raise ApiError(400, f"驾驶员「{d.name}」当前状态为「{DRIVER_STATUS_LABELS.get(d.status, d.status)}」，不可派车")

    disp = FltTripDispatch(
        app_id=a.app_id,
        vehicle_id=vehicle_id,
        driver_id=driver_id,
        start_mileage=v.current_mileage or 0.0,
        status="DISPATCHED",
    )
    db.add(disp)
    a.status = "DISPATCHED"
    v.status = "DISPATCHED"
    d.status = "DISPATCHED"
    await db.flush()
    # 电子派车单回显（批量映射取名称，避免懒加载）
    vmap = await vehicle_map(db, {disp.vehicle_id})
    dmap = await driver_map(db, {disp.driver_id})
    amap = await application_map(db, {disp.app_id})
    users = await user_name_map(db, {a.applicant_id})
    return ok(serialize_dispatch(disp, vmap, dmap, amap, users), "派车成功，电子派车单已生成")


@router.get("/dispatches")
async def list_dispatches(
    p: Principal = Depends(require_perms("fleet:dispatch:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None, keyword: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(FltTripDispatch).order_by(FltTripDispatch.dispatch_id.desc())
    if status:
        stmt = stmt.where(FltTripDispatch.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page(await _serialize_dispatch_rows(db, rows), total)


@router.get("/trip-logs")
async def list_trip_logs(
    p: Principal = Depends(require_perms("fleet:dispatch:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    """出车登记/归队核销台账：仅已派车与已归队单据。"""
    stmt = select(FltTripDispatch).where(FltTripDispatch.status.in_(["DISPATCHED", "RETURNED"]))
    stmt = stmt.order_by(FltTripDispatch.dispatch_id.desc())
    if status:
        stmt = stmt.where(FltTripDispatch.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page(await _serialize_dispatch_rows(db, rows), total)


async def _serialize_dispatch_rows(db: AsyncSession, rows) -> list[dict]:
    vehicles = await vehicle_map(db, {d.vehicle_id for d in rows})
    drivers = await driver_map(db, {d.driver_id for d in rows})
    apps = await application_map(db, {d.app_id for d in rows})
    users = await user_name_map(db, {a.applicant_id for a in apps.values()})
    return [serialize_dispatch(d, vehicles, drivers, apps, users) for d in rows]


@router.post("/dispatches/{dispatch_id}/return")
async def return_dispatch(
    dispatch_id: str, body: dict,
    p: Principal = Depends(require_perms("fleet:dispatch:return")),
    db: AsyncSession = Depends(get_db),
):
    """归队核销：登记返还里程/过路费/油费，联动车辆待命、司机在岗、申请完结。"""
    disp = await db.get(FltTripDispatch, parse_uuid(dispatch_id, "派车单ID格式无效"))
    if not disp:
        raise ApiError(404, "派车单不存在")
    if disp.status != "DISPATCHED":
        raise ApiError(400, "该派车单已归队核销，请勿重复操作")
    end_mileage = body.get("end_mileage")
    if end_mileage is None:
        raise ApiError(400, "返还里程（end_mileage）为必填项")
    end_mileage = float(end_mileage)
    if end_mileage < disp.start_mileage:
        raise ApiError(400, f"返还里程 {end_mileage} 不得小于出车登记里程 {disp.start_mileage}")

    disp.end_mileage = end_mileage
    disp.toll_cost = float(body.get("toll_cost") or 0.0)
    disp.fuel_cost = float(body.get("fuel_cost") or 0.0)
    disp.notes = body.get("notes")
    disp.actual_return_time = datetime.now(timezone.utc)
    disp.status = "RETURNED"

    v = await db.get(FltVehicle, disp.vehicle_id)
    if v:
        v.current_mileage = end_mileage
        if v.status == "DISPATCHED":
            v.status = "AVAILABLE"
    dr = await db.get(FltDriver, disp.driver_id)
    if dr and dr.status == "DISPATCHED":
        dr.status = "ON_DUTY"
    a = await db.get(FltApplication, disp.app_id)
    if a and a.status == "DISPATCHED":
        a.status = "COMPLETED"
    await db.flush()

    vmap = await vehicle_map(db, {disp.vehicle_id})
    dmap = await driver_map(db, {disp.driver_id})
    amap = await application_map(db, {disp.app_id})
    users = await user_name_map(db, {a.applicant_id} if a else set())
    return ok(serialize_dispatch(disp, vmap, dmap, amap, users), "归队核销完成，行程已归档")


# ---------------- maintenance & warnings ----------------

@router.get("/maintenance")
async def list_maintenance(
    p: Principal = Depends(require_perms("fleet:maintenance:list")),
    db: AsyncSession = Depends(get_db),
    vehicle_id: str | None = None, log_type: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(FltMaintenanceLog).order_by(FltMaintenanceLog.created_at.desc())
    if vehicle_id:
        stmt = stmt.where(FltMaintenanceLog.vehicle_id == parse_uuid(vehicle_id, "车辆ID格式无效"))
    if log_type:
        stmt = stmt.where(FltMaintenanceLog.log_type == log_type)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    vehicles = await vehicle_map(db, {m.vehicle_id for m in rows})
    return page([serialize_maintenance(m, vehicles) for m in rows], total)


@router.post("/maintenance")
async def create_maintenance(
    body: dict,
    p: Principal = Depends(require_perms("fleet:maintenance:add")),
    db: AsyncSession = Depends(get_db),
):
    vehicle_id = parse_uuid(body.get("vehicle_id"), "车辆ID无效")
    v = await db.get(FltVehicle, vehicle_id)
    if not v:
        raise ApiError(404, "车辆不存在")
    log_type = body.get("log_type", "MAINTENANCE")
    if log_type not in LOG_TYPE_LABELS:
        raise ApiError(400, "维保类型无效（MAINTENANCE/INSURANCE/INSPECTION/REPAIR）")
    m = FltMaintenanceLog(
        vehicle_id=vehicle_id,
        log_type=log_type,
        mileage_at_service=float(body.get("mileage_at_service") or 0.0),
        cost=float(body.get("cost") or 0.0),
        vendor=body.get("vendor"),
        next_due_date=parse_date(body["next_due_date"], "下次保养到期日") if body.get("next_due_date") else None,
        next_due_mileage=float(body["next_due_mileage"]) if body.get("next_due_mileage") is not None else None,
        notes=body.get("notes"),
    )
    db.add(m)
    await db.flush()
    vehicles = await vehicle_map(db, {m.vehicle_id})
    return ok(serialize_maintenance(m, vehicles), "维保记录已登记")


@router.get("/maintenance/warnings")
async def maintenance_warnings(
    p: Principal = Depends(require_perms("fleet:maintenance:list")),
    db: AsyncSession = Depends(get_db),
):
    """保险/年审/保养临期（30 天）预警清单，按剩余天数升序。"""
    today = datetime.now(BUSINESS_TZ).date()
    deadline = today + timedelta(days=WARNING_DAYS)
    vehicles = (await db.execute(
        select(FltVehicle).where(FltVehicle.status != "SCRAPPED").order_by(FltVehicle.plate_no)
    )).scalars().all()
    # 每车最近的保养到期日
    due_rows = (await db.execute(
        select(FltMaintenanceLog.vehicle_id, func.min(FltMaintenanceLog.next_due_date))
        .where(FltMaintenanceLog.next_due_date.is_not(None))
        .group_by(FltMaintenanceLog.vehicle_id)
    )).all()
    next_due = {vid: d for vid, d in due_rows}

    result = []
    for v in vehicles:
        warnings = []

        def _warn(w_type: str, label: str, due: date):
            days_left = (due - today).days
            warnings.append({
                "type": w_type,
                "label": label,
                "due_date": due.isoformat(),
                "days_left": days_left,
                "level": "OVERDUE" if days_left < 0 else "DUE_SOON",
            })

        if v.insurance_expire_date and v.insurance_expire_date <= deadline:
            _warn("INSURANCE", "车险续保到期", v.insurance_expire_date)
        if v.annual_inspection_date and v.annual_inspection_date <= deadline:
            _warn("INSPECTION", "安全年审到期", v.annual_inspection_date)
        due = next_due.get(v.vehicle_id)
        if due and due <= deadline:
            _warn("MAINTENANCE", "车辆保养到期", due)
        if warnings:
            item = serialize_vehicle(v)
            item["warnings"] = sorted(warnings, key=lambda w: w["days_left"])
            item["min_days_left"] = item["warnings"][0]["days_left"]
            result.append(item)
    result.sort(key=lambda x: x["min_days_left"])
    return ok(result)


# ---------------- fuel audit ----------------

@router.get("/fuel-logs")
async def list_fuel_logs(
    p: Principal = Depends(require_perms("fleet:fuel:list")),
    db: AsyncSession = Depends(get_db),
    vehicle_id: str | None = None, abnormal: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(FltFuelLog).order_by(FltFuelLog.fuel_date.desc(), FltFuelLog.created_at.desc())
    if vehicle_id:
        stmt = stmt.where(FltFuelLog.vehicle_id == parse_uuid(vehicle_id, "车辆ID格式无效"))
    if abnormal is not None and abnormal != "":
        stmt = stmt.where(FltFuelLog.is_abnormal.is_(str(abnormal).lower() in ("1", "true", "yes")))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    vehicles = await vehicle_map(db, {f.vehicle_id for f in rows})
    return page([serialize_fuel(f, vehicles) for f in rows], total)


@router.post("/fuel-logs")
async def create_fuel_log(
    body: dict,
    p: Principal = Depends(require_perms("fleet:fuel:add")),
    db: AsyncSession = Depends(get_db),
):
    vehicle_id = parse_uuid(body.get("vehicle_id"), "车辆ID无效")
    v = await db.get(FltVehicle, vehicle_id)
    if not v:
        raise ApiError(404, "车辆不存在")
    fuel_date = parse_date(body["fuel_date"], "加油日期") if body.get("fuel_date") else datetime.now(BUSINESS_TZ).date()
    liters = float(body.get("liters") or 0.0)
    mileage_at_fuel = float(body.get("mileage_at_fuel") or 0.0)
    station = body.get("station")

    # 油耗合规审计：百公里油耗异常 + 定点加油校验
    reasons: list[str] = []
    last = (await db.execute(
        select(FltFuelLog).where(FltFuelLog.vehicle_id == vehicle_id)
        .order_by(FltFuelLog.fuel_date.desc(), FltFuelLog.created_at.desc())
        .limit(1)
    )).scalars().first()
    if last is not None:
        delta_km = mileage_at_fuel - (last.mileage_at_fuel or 0.0)
        if delta_km > 0 and liters > 0:
            per_100km = liters / delta_km * 100
            if per_100km > FUEL_THRESHOLD:
                reasons.append(f"百公里油耗 {per_100km:.1f}L 超阈值{int(FUEL_THRESHOLD)}L")
    # 未登记加油站视为无法核验定点加油，按非定点判异常
    if not station or station not in DESIGNATED_STATIONS:
        reasons.append("非定点加油")
    f = FltFuelLog(
        vehicle_id=vehicle_id,
        fuel_date=fuel_date,
        station=station,
        liters=liters,
        cost=float(body.get("cost") or 0.0),
        mileage_at_fuel=mileage_at_fuel,
        is_abnormal=bool(reasons),
        abnormal_reason="；".join(reasons) if reasons else None,
    )
    db.add(f)
    await db.flush()
    vehicles = await vehicle_map(db, {f.vehicle_id})
    return ok(serialize_fuel(f, vehicles), "加油流水已登记" + ("（触发异常预警）" if f.is_abnormal else ""))


# ---------------- availability query ----------------

@router.get("/available")
async def query_available(
    p: Principal = Depends(require_perms("fleet:dispatch:list", "fleet:vehicle:list")),
    db: AsyncSession = Depends(get_db),
    start_time: str = "", end_time: str = "", seats: int = 1,
):
    """查询指定时段可用车辆（排除时段重叠的已派车单）与当班司机。"""
    if not start_time or not end_time:
        raise ApiError(400, "start_time 与 end_time 为必填项")
    s = parse_dt(start_time, "开始时间")
    e = parse_dt(end_time, "结束时间")
    if e <= s:
        raise ApiError(400, "结束时间必须晚于开始时间")
    seats = max(int(seats or 1), 1)

    # 与请求时段重叠的出车中派车单占用车辆（app.start < req.end 且 app.end > req.start）
    busy = select(FltTripDispatch.vehicle_id).join(
        FltApplication, FltApplication.app_id == FltTripDispatch.app_id
    ).where(
        FltTripDispatch.status == "DISPATCHED",
        FltApplication.start_time < e,
        FltApplication.end_time > s,
    )
    vehicles = (await db.execute(
        select(FltVehicle).where(
            FltVehicle.status == "AVAILABLE",
            FltVehicle.seat_count >= seats,
            FltVehicle.vehicle_id.not_in(busy),
        ).order_by(FltVehicle.seat_count)
    )).scalars().all()
    drivers = (await db.execute(
        select(FltDriver).where(FltDriver.status == "ON_DUTY").order_by(FltDriver.name)
    )).scalars().all()
    return ok({
        "start_time": s.isoformat(),
        "end_time": e.isoformat(),
        "seats": seats,
        "vehicles": [serialize_vehicle(v) for v in vehicles],
        "drivers": [serialize_driver(d) for d in drivers],
    })
