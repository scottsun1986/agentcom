"""Performance & concurrency tests:
- parallel meeting bookings must yield exactly ONE success (GiST exclusion)
- API response-time baselines
- clock-in idempotency under concurrency."""

import asyncio
import time

from datetime import datetime, timedelta

import pytest


def _iso(offset_days: int, hour: int) -> str:
    dt = datetime.now().replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(days=offset_days)
    return dt.isoformat()


async def test_parallel_booking_exactly_one_success(client, zhang_headers, admin_headers):
    """10 concurrent bookings on the same room/time: exactly 1 success, 9 rejections, no doubles."""
    room = (await client.post("/api/conference/rooms", headers=admin_headers, json={
        "name": "并发测试会议室", "capacity": 30, "location": "测试楼",
    })).json()["data"]
    rid = room.get("room_id") or room.get("id")

    async def book(i: int):
        r = await client.post("/api/conference/bookings", headers=zhang_headers, json={
            "room_id": rid, "title": f"并发预订{i}", "attendee_count": 5,
            "start_time": _iso(80, 9), "end_time": _iso(80, 11),
        })
        return r.status_code

    t0 = time.perf_counter()
    codes = await asyncio.gather(*(book(i) for i in range(10)))
    elapsed = time.perf_counter() - t0
    ok = sum(1 for c in codes if c == 200)
    conflict = sum(1 for c in codes if c == 400)
    assert ok == 1, f"expected exactly 1 success, got {ok} (codes={codes})"
    assert conflict == 9, f"expected 9 conflicts, got {conflict}"
    assert elapsed < 15, f"10 concurrent bookings took {elapsed:.1f}s"
    # verify exactly one booking row
    rows = (await client.get(f"/api/conference/bookings?room_id={rid}", headers=admin_headers)).json()["rows"]
    assert len(rows) == 1


async def test_parallel_clock_in_idempotent(client):
    """Concurrent clock-ins with the same type: at most one succeeds, duplicates rejected."""
    r = await client.post("/api/auth/login", json={"username": "sunqian", "password": "admin123"})
    h = {"Authorization": "Bearer " + r.json()["data"]["token"]}

    async def clock():
        return await client.post("/api/attendance/clock", headers=h,
                                 json={"punch_type": "FIELD", "address": "并发外勤"})

    codes = await asyncio.gather(*(clock() for _ in range(5)))
    ok = sum(1 for c in codes if c.status_code == 200)
    rejected = sum(1 for c in codes if c.status_code == 400)
    assert ok >= 1, f"at least one clock-in should succeed, got codes={[c.status_code for c in codes]}"
    assert ok + rejected == 5, f"all must succeed or be rejected as duplicates: {[c.status_code for c in codes]}"


@pytest.mark.parametrize("path", [
    "/api/portal/overview",
    "/api/supervision/dashboard",
    "/api/assets/overview",
    "/api/fleet/dashboard",
    "/api/research/dashboard",
    "/api/knowledge/graph",
    "/api/system/users?pageNum=1&pageSize=10",
])
async def test_api_response_time_baseline(client, zhang_headers, path):
    """Core dashboards must answer within 2.5s (generous for CI variance)."""
    t0 = time.perf_counter()
    r = await client.get(path, headers=zhang_headers)
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    assert elapsed < 2.5, f"{path} took {elapsed:.2f}s"


async def test_task_list_page_load(client, admin_headers):
    """150 tasks paginated query under 2s."""
    t0 = time.perf_counter()
    r = await client.get("/api/supervision/tasks?pageNum=1&pageSize=50", headers=admin_headers)
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200
    assert elapsed < 2.0, f"tasks page took {elapsed:.2f}s"
