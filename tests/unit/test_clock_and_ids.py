"""Unit: clocks + run-id allocation."""

from __future__ import annotations

from datetime import datetime, timezone

from app.clock import FixedClock, SystemClock, iso_utc


def test_system_clock_utc_aware():
    dt = SystemClock().now_utc()
    assert dt.tzinfo is not None
    assert dt.utcoffset().total_seconds() == 0


def test_fixed_clock_monotonic():
    c = FixedClock(datetime(2026, 1, 1, tzinfo=timezone.utc))
    t1 = c.now_utc()
    t2 = c.now_utc()
    assert t2 > t1


def test_iso_utc_format():
    dt = datetime(2026, 1, 1, 12, 30, 5, tzinfo=timezone.utc)
    s = iso_utc(dt)
    assert s.startswith("2026-01-01T12:30:05")
    assert "+00:00" in s


def test_run_ids_unique(tmp_path, harness):
    from app.harness.runstore import RunStore
    ids = {harness.new_run_id() for _ in range(2000)}
    assert len(ids) == 2000, "run ids must be unique"
    assert all(i.startswith("run-") for i in ids)


def test_run_ids_collision_checked_against_store(tmp_path):
    from app.harness.runstore import RunStore
    from app.config import BayoraConfig
    from app.harness.runner import Harness
    from app.harness.client import InProcessBrokerClient

    store = RunStore(tmp_path / "runs")
    # occupy a run dir to prove collision avoidance reads the store
    store.run_dir("run-aaaa01")
    cfg = BayoraConfig()
    h = Harness(cfg, broker_client=None, runstore=store)
    for _ in range(50):
        rid = h.new_run_id()
        assert rid != "run-aaaa01"
