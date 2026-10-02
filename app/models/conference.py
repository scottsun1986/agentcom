"""Conference and Meeting Room Management Models (Reusing meetmanager + Expansion)."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint, TSTZRANGE
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class ConfRoom(Base):
    """Meeting room resource table (Reused from meetmanager)."""
    __tablename__ = "conf_room"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    min_capacity: Mapped[int] = mapped_column(Integer, default=1)
    max_capacity: Mapped[int] = mapped_column(Integer, default=50)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    department_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    amenities: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    status: Mapped[str] = mapped_column(String(20), default="AVAILABLE") # AVAILABLE, MAINTENANCE, DISABLED
    max_duration_hours: Mapped[int] = mapped_column(Integer, default=8)
    advance_booking_days: Mapped[int] = mapped_column(Integer, default=30)
    buffer_time_minutes: Mapped[int] = mapped_column(Integer, default=15)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    department = relationship("SysDept")
    bookings: Mapped[list["ConfBooking"]] = relationship("ConfBooking", back_populates="room")


class ConfBooking(Base):
    """
    Meeting room reservation with PostgreSQL tsrange and GiST exclusion constraint
    for hardware-level zero double-booking protection (Reused from meetmanager).
    """
    __tablename__ = "conf_booking"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conf_room.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    during: Mapped[datetime] = mapped_column(TSTZRANGE, nullable=False)
    attendee_count: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="CONFIRMED", index=True) # CONFIRMED, CANCELLED, PENDING_APPROVAL
    host_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    service_status: Mapped[str] = mapped_column(String(20), default="NONE") # NONE, PENDING, DISPATCHED, COMPLETED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        # 真正的数据库级排除约束（须配合 btree_gist 扩展）：同会议室同时段（未取消）重叠插入将被拒绝，
        # 杜绝高并发下应用层检查竞态导致的重复预订。
        ExcludeConstraint(
            ("room_id", "="),
            ("during", "&&"),
            name="excl_conf_booking_no_overlap",
            using="gist",
            where=text("status != 'CANCELLED'"),
        ),
    )

    room: Mapped["ConfRoom"] = relationship("ConfRoom", back_populates="bookings")
    user = relationship("SysUser")
    minutes: Mapped["ConfMinutes | None"] = relationship("ConfMinutes", back_populates="booking", uselist=False)
    services: Mapped[list["ConfServiceTicket"]] = relationship("ConfServiceTicket", back_populates="booking")


class ConfAffair(Base):
    """Expanded Government Conference Planning & Affairs."""
    __tablename__ = "conf_affair"

    affair_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    booking_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conf_booking.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    meeting_type: Mapped[str] = mapped_column(String(50), default="WORK") # PARTY_COMMITTEE, EXECUTIVE, WORK, EXTERNAL
    security_level: Mapped[str] = mapped_column(String(20), default="NORMAL") # TOP_SECRET, CONFIDENTIAL, NORMAL
    agenda_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    booking = relationship("ConfBooking")
    attendees: Mapped[list["ConfAttendee"]] = relationship("ConfAttendee", back_populates="affair")


class ConfAttendee(Base):
    """Conference attendee registration and attendance status."""
    __tablename__ = "conf_attendee"

    attendee_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    affair_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conf_affair.affair_id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    dept_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    post_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    attendance_status: Mapped[str] = mapped_column(String(20), default="CONFIRMED") # CONFIRMED, LEAVE, DEPUTY
    deputy_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    seat_label: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sign_in_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    affair = relationship("ConfAffair", back_populates="attendees")


class ConfServiceTicket(Base):
    """Conference logistics & AV service dispatch ticket."""
    __tablename__ = "conf_service_ticket"

    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    booking_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conf_booking.id", ondelete="CASCADE"), index=True)
    service_type: Mapped[str] = mapped_column(String(50), nullable=False) # TEA(茶歇备水), AV_PROJECTOR(音响投影), LED_BANNER(横幅屏显), AC(空调调试)
    assignee_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING") # PENDING, PROCESSING, COMPLETED
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

    booking = relationship("ConfBooking", back_populates="services")


class ConfMinutes(Base):
    """Meeting minutes with Markdown content and versioning (Reused from meetmanager)."""
    __tablename__ = "conf_minutes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    booking_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conf_booking.id", ondelete="CASCADE"), unique=True, index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    booking: Mapped["ConfBooking"] = relationship("ConfBooking", back_populates="minutes")
    action_items: Mapped[list["ConfActionItem"]] = relationship("ConfActionItem", back_populates="minutes")


class ConfActionItem(Base):
    """Action items from meeting minutes, with bridge to Supervision tasks."""
    __tablename__ = "conf_action_item"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    minutes_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conf_minutes.id", ondelete="CASCADE"), index=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conf_booking.id", ondelete="CASCADE"), index=True)
    task_description: Mapped[str] = mapped_column(String(500), nullable=False)
    assignee_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING") # PENDING, IN_PROGRESS, DONE
    converted_supervision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True) # Linked SupTask ID!

    minutes: Mapped["ConfMinutes"] = relationship("ConfMinutes", back_populates="action_items")
