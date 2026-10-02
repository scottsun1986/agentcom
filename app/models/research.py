"""Government Research and Investigation Activity Models."""

import uuid
from datetime import date, datetime, timezone
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class RschTopic(Base):
    """Research topic and plan registration."""
    __tablename__ = "rsch_topic"

    topic_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    topic_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    field_domain: Mapped[str] = mapped_column(String(100), default="经济与产业") # 优化营商环境, 乡村振兴, 基层治理, 产业创新
    leader_name: Mapped[str] = mapped_column(String(100), nullable=False) # 领队领导
    lead_dept_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="CASCADE"), index=True)
    escort_members: Mapped[str | None] = mapped_column(String(255), nullable=True) # 陪同人员
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    research_type: Mapped[str] = mapped_column(String(50), default="SPECIAL") # SPECIAL(专题调研), GRASSROOTS(蹲点走访), SECRET_VISIT(暗访微调研)
    has_conflict: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(30), default="PLANNED", index=True) # PLANNED, APPROVED, IN_PROGRESS, REPORT_REVIEW, COMPLETED
    summary_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    lead_dept = relationship("SysDept")
    points: Mapped[list["RschRoutePoint"]] = relationship("RschRoutePoint", back_populates="topic", cascade="all, delete-orphan")
    issues: Mapped[list["RschIssueLog"]] = relationship("RschIssueLog", back_populates="topic", cascade="all, delete-orphan")


class RschRoutePoint(Base):
    """Target field itinerary inspection point."""
    __tablename__ = "rsch_route_point"

    point_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    topic_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rsch_topic.topic_id", ondelete="CASCADE"), index=True)
    point_name: Mapped[str] = mapped_column(String(150), nullable=False) # e.g. 高新区重点实验室, 临江街道便民服务中心
    point_address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    conflict_detected: Mapped[bool] = mapped_column(Boolean, default=False)

    topic = relationship("RschTopic", back_populates="points")


class RschIssueLog(Base):
    """Field observation and issue backlog identified during research."""
    __tablename__ = "rsch_issue_log"

    issue_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    topic_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("rsch_topic.topic_id", ondelete="CASCADE"), index=True)
    point_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    issue_title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    target_dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="LOGGED") # LOGGED, SUPERVISED, RECTIFIED
    converted_supervision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True) # Linked SupTask ID
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    topic = relationship("RschTopic", back_populates="issues")
    target_dept = relationship("SysDept")
