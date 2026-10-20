"""RunStore: run dirs + state/observations/verifications artifacts (§9.7)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.ledger.verifier import VerificationResult


class RunState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    status: str                       # "in_progress" | "complete" | "failed"
    started_at: str
    updated_at: str
    assertions: dict[str, int]        # six-part counting everywhere
    scenario_status: dict[str, str]   # scenario_id -> AssertionStatus value
    skip_reasons: dict[str, str] = {} # scenario_id -> live-probed reason

    @classmethod
    def fresh(cls, run_id: str) -> "RunState":
        now = datetime.now(timezone.utc).isoformat()
        return cls(run_id=run_id, status="in_progress", started_at=now,
                   updated_at=now,
                   assertions={"total": 0, "passed": 0, "failed": 0,
                               "errors": 0, "skipped": 0, "not_evaluated": 0},
                   scenario_status={}, skip_reasons={})


class RunSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    status: str
    started_at: str
    assertions: dict[str, int]


class RunStore:
    """All run artifacts live under runs_dir/<run_id>/."""

    LATEST_POINTER = "latest_demo_run"

    def __init__(self, runs_dir: Path):
        self.runs_dir = Path(runs_dir)
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def run_dir(self, run_id: str) -> Path:
        d = self.runs_dir / run_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def has_run(self, run_id: str) -> bool:
        return (self.runs_dir / run_id).is_dir()

    # -- state -------------------------------------------------------------

    def save_state(self, run_id: str, state: RunState) -> Path:
        path = self.run_dir(run_id) / "state.json"
        path.write_text(state.model_dump_json(indent=2) + "\n", encoding="utf-8")
        return path

    def load_state(self, run_id: str) -> Optional[RunState]:
        path = self.runs_dir / run_id / "state.json"
        if not path.is_file():
            return None
        return RunState.model_validate_json(path.read_text(encoding="utf-8"))

    # -- observations --------------------------------------------------------

    def append_observation(self, run_id: str, obs: dict) -> None:
        path = self.run_dir(run_id) / "observations.jsonl"
        with path.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(obs, separators=(",", ":"), ensure_ascii=False) + "\n")

    def load_observations(self, run_id: str) -> list[dict]:
        path = self.runs_dir / run_id / "observations.jsonl"
        if not path.is_file():
            return []
        out = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
        return out

    # -- verifications -------------------------------------------------------

    def append_verification(self, run_id: str, vr: VerificationResult) -> None:
        path = self.run_dir(run_id) / "verifications.jsonl"
        with path.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(vr.model_dump_json() + "\n")

    def load_verifications(self, run_id: str) -> list[dict]:
        path = self.runs_dir / run_id / "verifications.jsonl"
        if not path.is_file():
            return []
        out = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(json.loads(line))
        return out

    # -- runtime battery -----------------------------------------------------

    def save_runtime_tests(self, run_id: str, record: dict) -> None:
        """Append a battery record under its scenario id — BOTH SC-03r and
        SC-04r must survive in one run's runtime_tests.json (the old
        full-file overwrite destroyed SC-03r's probe record whenever
        SC-04r ran after it). File shape: {"batteries": {<sid>: record}}.
        A legacy single-record file (flat dict with "verdict") is migrated
        on first write."""
        path = self.run_dir(run_id) / "runtime_tests.json"
        data: dict = {"batteries": {}}
        if path.is_file():
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(existing, dict):
                    if "batteries" in existing and isinstance(existing["batteries"], dict):
                        data["batteries"] = existing["batteries"]
                    elif existing.get("verdict"):
                        # legacy flat record — keep it under its run-scoped key
                        data["batteries"]["legacy"] = existing
            except Exception:
                pass   # corrupt file: start fresh rather than crash the run
        sid = str(record.get("scenario_id") or "runtime")
        data["batteries"][sid] = record
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")

    def load_runtime_tests(self, run_id: str) -> Optional[dict]:
        path = self.runs_dir / run_id / "runtime_tests.json"
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def runtime_battery_record(self, run_id: str, scenario_id: str) -> Optional[dict]:
        """The battery record for ONE scenario, from the accumulated file."""
        data = self.load_runtime_tests(run_id) or {}
        batteries = data.get("batteries") if isinstance(data, dict) else None
        if isinstance(batteries, dict):
            rec = batteries.get(scenario_id)
            if isinstance(rec, dict):
                return rec
            # legacy flat file (pre-accumulation shape): one record total
            if data.get("verdict") and scenario_id in ("SC-03r", "SC-04r"):
                return data
        return None

    # -- run completion --------------------------------------------------------

    def complete_run(self, run_id: str, *, status: str,
                     counts: dict) -> Optional[RunState]:
        """Mark the run complete and persist the final state atomically
        (blueprint §9.2 step 6: state transitions to 'complete' with the
        six-part counts; a run is distinguishable from an interrupted one)."""
        state = self.load_state(run_id) or RunState.fresh(run_id)
        state.status = status
        state.assertions = {k: int(v) for k, v in counts.items()}
        state.updated_at = datetime.now(timezone.utc).isoformat()
        self.save_state(run_id, state)
        return state

    # -- demo bookkeeping ------------------------------------------------------

    def set_latest_demo_run(self, run_id: str) -> None:
        (self.runs_dir / self.LATEST_POINTER).write_text(run_id, encoding="utf-8")

    def latest_demo_run(self) -> Optional[str]:
        path = self.runs_dir / self.LATEST_POINTER
        if not path.is_file():
            return None
        txt = path.read_text(encoding="utf-8").strip()
        return txt or None

    def list_runs(self) -> list[RunSummary]:
        out: list[RunSummary] = []
        for entry in sorted(self.runs_dir.iterdir()):
            if not entry.is_dir():
                continue
            state = self.load_state(entry.name)
            if state is None:
                continue
            out.append(RunSummary(run_id=state.run_id, status=state.status,
                                   started_at=state.started_at,
                                   assertions=state.assertions))
        return out

    def append_demo_result(self, run_id: str, entry: dict) -> None:
        path = self.run_dir(run_id) / "demo_result.json"
        existing: dict = {}
        if path.is_file():
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                existing = {}
        scenes = existing.setdefault("scenes", [])
        # idempotent per (scene, scenario): replace if present
        key = (entry.get("scene"), entry.get("scenario_id"))
        scenes[:] = [s for s in scenes
                     if (s.get("scene"), s.get("scenario_id")) != key]
        scenes.append(entry)
        existing["run_id"] = run_id
        path.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
