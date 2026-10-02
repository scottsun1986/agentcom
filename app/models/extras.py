"""Supplementary models closing functional gaps in the PRD:
notices, leave quotas, asset/fleet maintenance logs, fuel audit,
supervision extension requests, knowledge documents."""

import uuid
from datetime import date, datetime, timezone
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class SysNotice(Base):
    """Portal notification message (per-user or broadcast when user_id IS NULL)."""
    __tablename__ = "sys_notice"

    notice_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    notice_type: Mapped[str] = mapped_column(String(30), default="INFO")  # INFO, WARNING, URGENT, SUCCESS
    source_module: Mapped[str | None] = mapped_column(String(50), nullable=True)
    link: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AttLeaveQuota(Base):
    """Annual leave / comp-time balance account per user per year."""
    __tablename__ = "att_leave_quota"

    quota_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, default=2026)
    leave_type: Mapped[str] = mapped_column(String(30), nullable=False)  # ANNUAL, SICK, CASUAL, COMP
    total_days: Mapped[float] = mapped_column(Float, default=0.0)
    used_days: Mapped[float] = mapped_column(Float, default=0.0)

    __table_args__ = (UniqueConstraint("user_id", "year", "leave_type", name="uq_att_quota"),)

    user = relationship("SysUser")


class AstMaintenanceLog(Base):
    """Asset repair / maintenance cost log."""
    __tablename__ = "ast_maintenance_log"

    log_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    asset_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("ast_item_card.asset_id", ondelete="CASCADE"), index=True)
    fault_desc: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="IN_REPAIR")  # IN_REPAIR, FIXED, SCRAPPED
    reported_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    asset = relationship("AstItemCard")


class FltMaintenanceLog(Base):
    """Vehicle maintenance / insurance / annual inspection record."""
    __tablename__ = "flt_maintenance_log"

    log_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("flt_vehicle.vehicle_id", ondelete="CASCADE"), index=True)
    log_type: Mapped[str] = mapped_column(String(20), default="MAINTENANCE")  # MAINTENANCE, INSURANCE, INSPECTION, REPAIR
    mileage_at_service: Mapped[float] = mapped_column(Float, default=0.0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    vendor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    next_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_due_mileage: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    vehicle = relationship("FltVehicle")


class FltFuelLog(Base):
    """Designated fueling transaction for audit."""
    __tablename__ = "flt_fuel_log"

    fuel_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("flt_vehicle.vehicle_id", ondelete="CASCADE"), index=True)
    fuel_date: Mapped[date] = mapped_column(Date, nullable=False)
    station: Mapped[str | None] = mapped_column(String(100), nullable=True)
    liters: Mapped[float] = mapped_column(Float, default=0.0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    mileage_at_fuel: Mapped[float] = mapped_column(Float, default=0.0)
    is_abnormal: Mapped[bool] = mapped_column(Boolean, default=False)
    abnormal_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    vehicle = relationship("FltVehicle")


class SupExtensionRequest(Base):
    """Supervision task deadline extension application."""
    __tablename__ = "sup_extension_request"

    request_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sup_task.task_id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    old_deadline: Mapped[date] = mapped_column(Date, nullable=False)
    new_deadline: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING, APPROVED, REJECTED
    applicant_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    audit_comment: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    task = relationship("SupTask")


class KnbDocument(Base):
    """Knowledge base document (local fallback store synced with GBrainKG)."""
    __tablename__ = "knb_document"

    doc_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(50), default="政策法规")  # 政策法规/制度规程/讲话汇编/成果档案
    doc_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_org: Mapped[str | None] = mapped_column(String(150), nullable=True)
    publish_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    content: Mapped[str] = mapped_column(Text, default="")
    keywords: Mapped[str | None] = mapped_column(String(255), nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
