"""RuoYi RBAC System Models and Agent Credentials."""

import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class DataScope(str, enum.Enum):
    """RuoYi Data Permission Scope."""
    ALL = "1"           # 全部数据权限
    CUSTOM = "2"        # 自定义数据权限
    DEPT = "3"          # 本部门数据权限
    DEPT_AND_CHILD = "4"# 本部门及以下数据权限
    SELF = "5"          # 仅本人数据权限


# Association tables
sys_user_role = Table(
    "sys_user_role",
    Base.metadata,
    Column("user_id", Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Uuid, ForeignKey("sys_role.role_id", ondelete="CASCADE"), primary_key=True),
)

sys_role_menu = Table(
    "sys_role_menu",
    Base.metadata,
    Column("role_id", Uuid, ForeignKey("sys_role.role_id", ondelete="CASCADE"), primary_key=True),
    Column("menu_id", Uuid, ForeignKey("sys_menu.menu_id", ondelete="CASCADE"), primary_key=True),
)

sys_role_dept = Table(
    "sys_role_dept",
    Base.metadata,
    Column("role_id", Uuid, ForeignKey("sys_role.role_id", ondelete="CASCADE"), primary_key=True),
    Column("dept_id", Uuid, ForeignKey("sys_dept.dept_id", ondelete="CASCADE"), primary_key=True),
)

sys_user_post = Table(
    "sys_user_post",
    Base.metadata,
    Column("user_id", Uuid, ForeignKey("sys_user.user_id", ondelete="CASCADE"), primary_key=True),
    Column("post_id", Uuid, ForeignKey("sys_post.post_id", ondelete="CASCADE"), primary_key=True),
)


class SysDept(Base):
    """Department organization table."""
    __tablename__ = "sys_dept"

    dept_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True)
    ancestors: Mapped[str] = mapped_column(String(500), default="0")
    dept_name: Mapped[str] = mapped_column(String(100), nullable=False)
    order_num: Mapped[int] = mapped_column(Integer, default=0)
    leader: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(1), default="0")  # 0正常 1停用
    del_flag: Mapped[str] = mapped_column(String(1), default="0") # 0存在 2删除
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    parent: Mapped["SysDept | None"] = relationship("SysDept", remote_side=[dept_id], backref="children")
    users: Mapped[list["SysUser"]] = relationship("SysUser", back_populates="department")


class SysRole(Base):
    """Role permission table."""
    __tablename__ = "sys_role"

    role_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    role_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    role_sort: Mapped[int] = mapped_column(Integer, default=0)
    data_scope: Mapped[str] = mapped_column(String(1), default="1")  # 1全部 2自定 3本部门 4本部门及以下 5仅本人
    status: Mapped[str] = mapped_column(String(1), default="0")  # 0正常 1停用
    del_flag: Mapped[str] = mapped_column(String(1), default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    users: Mapped[list["SysUser"]] = relationship("SysUser", secondary=sys_user_role, back_populates="roles")
    menus: Mapped[list["SysMenu"]] = relationship("SysMenu", secondary=sys_role_menu, back_populates="roles")
    custom_depts: Mapped[list["SysDept"]] = relationship("SysDept", secondary=sys_role_dept)


class SysMenu(Base):
    """Menu and permission table."""
    __tablename__ = "sys_menu"

    menu_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    menu_name: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    top_category: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True) # ATTENDANCE, ASSETS, etc.
    order_num: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[str | None] = mapped_column(String(200), nullable=True)
    component: Mapped[str | None] = mapped_column(String(255), nullable=True)
    menu_type: Mapped[str] = mapped_column(String(1), default="C")  # M目录 C菜单 F按钮
    perms: Mapped[str | None] = mapped_column(String(100), nullable=True) # system:user:list
    icon: Mapped[str | None] = mapped_column(String(100), nullable=True)
    visible: Mapped[str] = mapped_column(String(1), default="0") # 0显示 1隐藏
    status: Mapped[str] = mapped_column(String(1), default="0")  # 0正常 1停用

    roles: Mapped[list["SysRole"]] = relationship("SysRole", secondary=sys_role_menu, back_populates="menus")


class SysPost(Base):
    """Position / Post table."""
    __tablename__ = "sys_post"

    post_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    post_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    post_name: Mapped[str] = mapped_column(String(100), nullable=False)
    post_sort: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(1), default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    users: Mapped[list["SysUser"]] = relationship("SysUser", secondary=sys_user_post, back_populates="posts")


class SysUser(Base):
    """User account table."""
    __tablename__ = "sys_user"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    dept_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("sys_dept.dept_id", ondelete="SET NULL"), nullable=True, index=True)
    user_name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    nick_name: Mapped[str] = mapped_column(String(64), nullable=False)
    email: Mapped[str | None] = mapped_column(String(128), nullable=True)
    phonenumber: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sex: Mapped[str | None] = mapped_column(String(1), default="0")  # 0男 1女 2未知
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(1), default="0")  # 0正常 1停用
    del_flag: Mapped[str] = mapped_column(String(1), default="0") # 0正常 2删除
    login_ip: Mapped[str | None] = mapped_column(String(128), nullable=True)
    login_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    department: Mapped["SysDept | None"] = relationship("SysDept", back_populates="users")
    roles: Mapped[list["SysRole"]] = relationship("SysRole", secondary=sys_user_role, back_populates="users")
    posts: Mapped[list["SysPost"]] = relationship("SysPost", secondary=sys_user_post, back_populates="users")


class SysDictType(Base):
    """Dictionary type table."""
    __tablename__ = "sys_dict_type"

    dict_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    dict_name: Mapped[str] = mapped_column(String(100), nullable=False)
    dict_type: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(1), default="0")
    remark: Mapped[str | None] = mapped_column(String(500), nullable=True)

    data_items: Mapped[list["SysDictData"]] = relationship("SysDictData", back_populates="dict_type_obj")


class SysDictData(Base):
    """Dictionary data item table."""
    __tablename__ = "sys_dict_data"

    dict_code: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    dict_sort: Mapped[int] = mapped_column(Integer, default=0)
    dict_label: Mapped[str] = mapped_column(String(100), nullable=False)
    dict_value: Mapped[str] = mapped_column(String(100), nullable=False)
    dict_type: Mapped[str] = mapped_column(String(100), ForeignKey("sys_dict_type.dict_type", ondelete="CASCADE"), nullable=False)
    css_class: Mapped[str | None] = mapped_column(String(100), nullable=True)
    list_class: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(1), default="0")

    dict_type_obj: Mapped["SysDictType"] = relationship("SysDictType", back_populates="data_items")


class SysConfig(Base):
    """System configuration parameters."""
    __tablename__ = "sys_config"

    config_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    config_name: Mapped[str] = mapped_column(String(100), nullable=False)
    config_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    config_value: Mapped[str] = mapped_column(Text, nullable=False)
    config_type: Mapped[str] = mapped_column(String(1), default="Y")  # Y内置 N自定义


class SysOperLog(Base):
    """Operation audit log."""
    __tablename__ = "sys_oper_log"

    oper_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    business_type: Mapped[str] = mapped_column(String(50), default="0") # 1新增 2修改 3删除 4导出 5审批
    method: Mapped[str] = mapped_column(String(200), default="")
    request_method: Mapped[str] = mapped_column(String(10), default="POST")
    oper_name: Mapped[str] = mapped_column(String(100), default="")
    dept_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    oper_url: Mapped[str] = mapped_column(String(500), default="")
    oper_ip: Mapped[str] = mapped_column(String(128), default="")
    oper_param: Mapped[str | None] = mapped_column(Text, nullable=True)
    json_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[int] = mapped_column(Integer, default=0) # 0正常 1异常
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    oper_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    cost_time: Mapped[int] = mapped_column(Integer, default=0) # milliseconds


class SysAppCredential(Base):
    """Agent MCP & API Application Credentials."""
    __tablename__ = "sys_app_credential"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    app_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    app_secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    app_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    scopes: Mapped[str] = mapped_column(Text, default="*") # comma separated or *
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, default=120)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(String(64), default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
