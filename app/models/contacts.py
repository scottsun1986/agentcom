"""Organization External Directory and Experts Models."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    DateTime,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class CtExternalPartner(Base):
    """External Government/Enterprise Partner Contact."""
    __tablename__ = "ct_external_partner"

    partner_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    unit_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    partner_type: Mapped[str] = mapped_column(String(50), default="GOV_PEER") # GOV_PEER(对口协同单位), SUPPLIER(核心供应商), THINKTANK(智库机构), EMERGENCY(应急协作)
    contact_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tags: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CtExpert(Base):
    """Consultant and Evaluation Expert Profile."""
    __tablename__ = "ct_expert"

    expert_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(100), nullable=True) # 教授, 行业专家, 高级顾问
    organization: Mapped[str] = mapped_column(String(150), nullable=False)
    field_domain: Mapped[str] = mapped_column(String(100), nullable=False) # 数字化转型, 规划建设, 财政审计
    phone: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    level: Mapped[str] = mapped_column(String(20), default="NATIONAL") # NATIONAL(国家级), PROVINCIAL(省级), MUNICIPAL(市级)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
