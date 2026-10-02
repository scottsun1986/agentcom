"""Access Control and Visitor Management Models."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class VisAppointment(Base):
    """Visitor reservation and invitation workflow."""
    __tablename__ = "vis_appointment"

    appointment_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    visitor_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    visitor_phone: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    id_card_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    company: Mapped[str | None] = mapped_column(String(150), nullable=True)
    car_plate: Mapped[str | None] = mapped_column(String(32), nullable=True)
    visit_reason: Mapped[str] = mapped_column(String(255), nullable=False)
    host_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    scheduled_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scheduled_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    access_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True) # QR code string
    status: Mapped[str] = mapped_column(String(30), default="PENDING_HOST", index=True) # PENDING_HOST, PENDING_SECURITY, APPROVED, REJECTED, CHECKED_IN, CHECKED_OUT, OVERDUE_STAY
    check_in_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pass_floor_permit: Mapped[str] = mapped_column(String(100), default="1F,3F") # Authorized elevator floors
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    host_user = relationship("SysUser")


class VisBlacklist(Base):
    """Security Blacklist for Access Control."""
    __tablename__ = "vis_blacklist"

    blacklist_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    id_card_number: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), default="保卫处")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
