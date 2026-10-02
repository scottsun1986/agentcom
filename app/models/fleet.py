"""Official Fleet and Vehicle Management Models."""

import uuid
from datetime import date, datetime, timezone
from sqlalchemy import (
    Date,
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


class FltVehicle(Base):
    """Official vehicle profile (one car one file)."""
    __tablename__ = "flt_vehicle"

    vehicle_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    plate_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    brand_model: Mapped[str] = mapped_column(String(100), nullable=False) # e.g. 丰田考斯特 23座, 红旗H9 5座, 别克GL8 7座
    seat_count: Mapped[int] = mapped_column(Integer, default=5)
    quota_type: Mapped[str] = mapped_column(String(50), default="GENERAL_OFFICIAL") # GENERAL_OFFICIAL(一般公务), EMERGENCY(机要通信/应急), SPECIAL(调研接待)
    current_mileage: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="AVAILABLE", index=True) # AVAILABLE, DISPATCHED, MAINTENANCE, SCRAPPED
    designated_parking_spot: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fuel_card_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    insurance_expire_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    annual_inspection_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FltDriver(Base):
    """Driver profile and status."""
    __tablename__ = "flt_driver"

    driver_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(50), nullable=False)
    license_type: Mapped[str] = mapped_column(String(20), default="A1") # A1, A2, B1, C1
    status: Mapped[str] = mapped_column(String(20), default="ON_DUTY") # ON_DUTY, DISPATCHED, OFF_DUTY
    safe_mileage: Mapped[float] = mapped_column(Float, default=0.0)


class FltApplication(Base):
    """Official vehicle requisition and dispatch workflow."""
    __tablename__ = "flt_application"

    app_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    applicant_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    purpose: Mapped[str] = mapped_column(String(255), nullable=False)
    trip_type: Mapped[str] = mapped_column(String(50), default="OFFICIAL_BUSINESS") # LEADERSHIP_RESEARCH, OFFICIAL_BUSINESS, EMERGENCY
    origin: Mapped[str] = mapped_column(String(100), default="机关大院")
    destination: Mapped[str] = mapped_column(String(255), nullable=False)
    route_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    passenger_count: Mapped[int] = mapped_column(Integer, default=1)
    leader_name: Mapped[str | None] = mapped_column(String(100), nullable=True) # 带队领导
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="DEPT_PENDING", index=True) # DEPT_PENDING, ADMIN_PENDING, APPROVED, DISPATCHED, COMPLETED, REJECTED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    applicant = relationship("SysUser", foreign_keys=[applicant_id])
    department = relationship("SysDept")
    dispatch: Mapped["FltTripDispatch | None"] = relationship("FltTripDispatch", back_populates="application", uselist=False)


class FltTripDispatch(Base):
    """Vehicle Dispatch Order & Trip Audit."""
    __tablename__ = "flt_trip_dispatch"

    dispatch_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    app_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("flt_application.app_id", ondelete="CASCADE"), unique=True, index=True)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("flt_vehicle.vehicle_id", ondelete="CASCADE"), index=True)
    driver_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("flt_driver.driver_id", ondelete="CASCADE"), index=True)
    start_mileage: Mapped[float] = mapped_column(Float, default=0.0)
    end_mileage: Mapped[float] = mapped_column(Float, default=0.0)
    toll_cost: Mapped[float] = mapped_column(Float, default=0.0)
    fuel_cost: Mapped[float] = mapped_column(Float, default=0.0)
    actual_return_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="DISPATCHED") # DISPATCHED, RETURNED, SETTLED
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

    application = relationship("FltApplication", back_populates="dispatch")
    vehicle = relationship("FltVehicle")
    driver = relationship("FltDriver")
