"""Attendance and Leave Management Models."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class AttClockRecord(Base):
    """Daily clock-in/out and field attendance record."""
    __tablename__ = "att_clock_record"

    record_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    punch_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    punch_type: Mapped[str] = mapped_column(String(20), default="IN") # IN, OUT, FIELD
    status: Mapped[str] = mapped_column(String(20), default="NORMAL") # NORMAL, LATE, EARLY, ABNORMAL
    location_gps: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    wifi_bssid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verify_photo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

    user = relationship("SysUser")


class AttLeaveApplication(Base):
    """Leave application with multi-tier approval and quota deduction."""
    __tablename__ = "att_leave_application"

    apply_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    leave_type: Mapped[str] = mapped_column(String(30), nullable=False) # ANNUAL, SICK, CASUAL, COMP, MARITAL, MATERNITY, PATERNITY
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_days: Mapped[float] = mapped_column(Float, default=1.0)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    attachment_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    audit_status: Mapped[str] = mapped_column(String(20), default="PENDING") # PENDING, APPROVED, REJECTED, CANCELLED
    approver_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    audit_comment: Mapped[str | None] = mapped_column(String(255), nullable=True)
    audit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("SysUser", foreign_keys=[user_id])
    approver = relationship("SysUser", foreign_keys=[approver_id])


class AttTripApplication(Base):
    """Outing and business trip application."""
    __tablename__ = "att_trip_application"

    trip_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    trip_type: Mapped[str] = mapped_column(String(20), default="OUTING") # OUTING(市内外出), BUSINESS_TRIP(差旅)
    origin: Mapped[str] = mapped_column(String(100), default="单位总部")
    destination: Mapped[str] = mapped_column(String(255), nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    audit_status: Mapped[str] = mapped_column(String(20), default="PENDING") # PENDING, APPROVED, REJECTED
    approver_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("SysUser", foreign_keys=[user_id])


class AttPunchRemedy(Base):
    """Missed punch remedy application."""
    __tablename__ = "att_punch_remedy"

    remedy_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    remedy_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    punch_type: Mapped[str] = mapped_column(String(20), default="IN")
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    audit_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    approver_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("SysUser", foreign_keys=[user_id])
