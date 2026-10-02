"""Fixed Assets and Office Consumables Management Models."""

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


class AstCategory(Base):
    """Asset standard category."""
    __tablename__ = "ast_category"

    category_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    category_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    category_name: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    order_num: Mapped[int] = mapped_column(Integer, default=0)


class AstItemCard(Base):
    """Fixed asset physical item card with one-code-per-item."""
    __tablename__ = "ast_item_card"

    asset_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    asset_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("ast_category.category_id", ondelete="SET NULL"), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    spec: Mapped[str | None] = mapped_column(String(100), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    price: Mapped[float] = mapped_column(Float, default=0.0)
    current_value: Mapped[float] = mapped_column(Float, default=0.0)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    location: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True, index=True)
    custodian_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="IN_STOCK", index=True) # IN_STOCK, IN_USE, BORROWED, IN_REPAIR, SCRAPPED
    qr_code_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    department = relationship("SysDept")
    custodian = relationship("SysUser")
    category = relationship("AstCategory")


class AstRequisition(Base):
    """Asset requisition / borrow / return / transfer / scrap workflow."""
    __tablename__ = "ast_requisition"

    req_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    req_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    req_type: Mapped[str] = mapped_column(String(20), nullable=False) # CLAIM(领用), BORROW(借用), RETURN(归还), TRANSFER(调拨), SCRAP(报废)
    asset_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("ast_item_card.asset_id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), index=True)
    dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    target_dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    audit_status: Mapped[str] = mapped_column(String(20), default="PENDING") # PENDING, APPROVED, REJECTED
    approver_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    asset = relationship("AstItemCard")
    user = relationship("SysUser", foreign_keys=[user_id])


class AstStocktakePlan(Base):
    """Asset stocktaking plan and reconciliation."""
    __tablename__ = "ast_stocktake_plan"

    plan_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    plan_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    scope_dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="IN_PROGRESS") # DRAFT, IN_PROGRESS, COMPLETED
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    verified_count: Mapped[int] = mapped_column(Integer, default=0)
    surplus_count: Mapped[int] = mapped_column(Integer, default=0)
    loss_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class AstConsumable(Base):
    """Low-value office consumables and supplies catalog."""
    __tablename__ = "ast_consumable"

    item_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    item_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(String(64), default="办公文具")
    spec: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str] = mapped_column(String(20), default="件")
    stock_count: Mapped[int] = mapped_column(Integer, default=0)
    min_stock: Mapped[int] = mapped_column(Integer, default=10) # safety threshold
    unit_price: Mapped[float] = mapped_column(Float, default=0.0)


class AstConsumableRequisition(Base):
    """Consumable supplies requisition."""
    __tablename__ = "ast_consumable_requisition"

    req_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("ast_consumable.item_id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"))
    dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    purpose: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING") # PENDING, APPROVED, REJECTED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    consumable = relationship("AstConsumable")
    user = relationship("SysUser")
