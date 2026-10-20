"""Harness runner: gates, dispatch, assertions (blueprint §9.2).

Gate order per spec: environment gate (2) -> config gate (2a) ->
checkpoint gate+refresh (2b) -> dispatch. SKIPPED reasons are always recorded
and can never become PASS (enforced by runner + test_evidence_gates).
"""

from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.harness.observation import Observation  # (no circular import: pure model)

from app.config import BayoraConfig
from app.harness import assertions as A
from app.harness.runstore import RunStore, RunState
from app.ledger.checkpoints import checkpoint_at_head
from app.ledger.verifier import verify_ledger
from app.schema import AssertionStatus, Component, EventType, Outcome
from app.harness.scenarios import ScenarioSpec


class ScenarioResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    scenario_id: str
    status: AssertionStatus
    checks: list[A.AssertionResult]
    skip_reason: Optional[str] = None
    evidence_event_ids: list[str] = []


class Harness:
    """Drives scenarios through the broker client; records honest results."""

    def __init__(self, config: BayoraConfig, *, broker_client, runstore: RunStore,
                 keypair=None, clock=None, runtime_battery=None,
                 target_spy=None, secret_store=None, ledger=None,
                 tmp_root=None):
        from app.clock import SystemClock
        self.config = config
        self.broker_client = broker_client
        self.runstore = runstore
        self.keypair = keypair            # (private_key, key_id, public_key)
        self.clock = clock or SystemClock()
        self.runtime_battery = runtime_battery
        self.target_spy = target_spy      # attached only in block-mode tests
        self.secret_store = secret_store
        self.ledger = ledger              # the live ledger for this wiring
        self.tmp_root = tmp_root
        self._issued_run_ids: set[str] = set()   # in-memory collision guard

    def new_run_id(self) -> str:
        """'run-' + 6 hex from uuid4; collision-checked against the store AND
        against ids this harness already issued in-process (a 6-hex space is
        small enough that two live allocations could otherwise collide)."""
        while True:
            candidate = "run-" + uuid.uuid4().hex[:6]
            if candidate in self._issued_run_ids:
                continue
            if self.runstore.has_run(candidate):
                continue
            self._issued_run_ids.add(candidate)
            return candidate

    # ------------------------------------------------------------------ run

    def run(self, spec: ScenarioSpec, run_id: Optional[str] = None) -> ScenarioResult:
        rid = run_id or self.new_run_id()
        run_dir = self.runstore.run_dir(rid)
        state = self.runstore.load_state(rid) or RunState.fresh(rid)

        def finish(result: ScenarioResult) -> ScenarioResult:
            self._record(state, result)
            self.runstore.save_state(rid, state)
            return result

        # -- gate 2: environment ------------------------------------------
        if spec.applicable is not None and not spec.applicable():
            return finish(ScenarioResult(
                run_id=rid, scenario_id=spec.scenario_id,
                status=AssertionStatus.SKIPPED, checks=[],
                skip_reason="environment gate returned false"))

        # -- gate 2a: config precondition -----------------------------------
        if spec.config_required is not None and not spec.config_required(self.config):
            return finish(ScenarioResult(
                run_id=rid, scenario_id=spec.scenario_id,
                status=AssertionStatus.SKIPPED, checks=[],
                skip_reason="config precondition unmet (see scenario spec)"))

        # -- gate 2b: checkpoint availability + refresh (D12/D25) -----------
        checkpoint = None
        public_key = None
        private_key = None
        if spec.requires_checkpoints:
            if not self.config.ledger.sign_checkpoints or self.keypair is None:
                return finish(ScenarioResult(
                    run_id=rid, scenario_id=spec.scenario_id,
                    status=AssertionStatus.SKIPPED, checks=[],
                    skip_reason="sign_checkpoints=false — no trusted anchor"))
            assert self.ledger is not None
            private_key, _key_id, public_key = self.keypair
            checkpoint = checkpoint_at_head(self.ledger, private_key,
                                            _key_id, self.clock)
            cover = A.assert_checkpoint_covers_current_height(
                checkpoint, self.ledger.block_height)
            if cover.status != AssertionStatus.PASSED:
                return finish(ScenarioResult(
                    run_id=rid, scenario_id=spec.scenario_id,
                    status=AssertionStatus.ERRORED, checks=[cover],
                    skip_reason=None))

        # -- dispatch by kind ----------------------------------------------
        try:
            if spec.kind == "evaluate":
                result = self._run_evaluate(spec, rid, checkpoint)
            elif spec.kind == "evaluate_raw":
                result = self._run_evaluate(spec, rid, checkpoint, raw_body=True)
            elif spec.kind == "check_destination":
                result = self._run_check_destination(spec, rid, checkpoint)
            elif spec.kind in ("ledger_tamper", "checkpoint_tamper"):
                result = self._run_tamper(spec, rid, checkpoint,
                                          private_key, public_key)
            elif spec.kind in ("runtime_network", "runtime_fs"):
                result = self._run_runtime(spec, rid)
            else:  # pragma: no cover - catalogue is closed
                result = ScenarioResult(
                    run_id=rid, scenario_id=spec.scenario_id,
                    status=AssertionStatus.ERRORED, checks=[],
                    skip_reason=f"unknown scenario kind {spec.kind}")
        except Exception as exc:  # infrastructure fault, never a verdict
            result = ScenarioResult(
                run_id=rid, scenario_id=spec.scenario_id,
                status=AssertionStatus.ERRORED, checks=[A.executed(
                    "scenario infrastructure", False,
                    "", f"harness fault: {type(exc).__name__}: {exc}")],
                skip_reason=None)

        return finish(result)

    # -------------------------------------------------------------- helpers

    def _run_evaluate(self, spec: ScenarioSpec, rid: str,
                      checkpoint, raw_body: bool = False) -> ScenarioResult:
        if raw_body:
            assert spec.raw_body is not None
            resp = self.broker_client.post_evaluate_raw(
                spec.raw_body.encode("utf-8"), run_id=rid,
                scenario_id=spec.scenario_id)
        else:
            assert spec.prompt is not None
            resp = self.broker_client.post_evaluate(
                spec.prompt, run_id=rid, scenario_id=spec.scenario_id)
        obs = self._observation_from_response(resp, spec.scenario_id)
        obs.recorded_event_types = self._event_types_for(spec.scenario_id)
        self.runstore.append_observation(rid, obs.model_dump(mode="json"))
        checks = [A.assert_outcome(obs, spec.expected.outcome)]
        if spec.expected.http_status is not None:
            checks.append(A.assert_status_code(obs, spec.expected.http_status))
        if spec.expected.policy_reason:
            checks.append(A.assert_policy_reason(obs, spec.expected.policy_reason))
        if spec.expected.released_text_excludes:
            excludes = list(spec.expected.released_text_excludes)
            if self.secret_store is not None:
                excludes.append(self.secret_store.canary_value)
            checks.append(A.assert_released_text_excludes(obs, excludes))
        for ev_type in spec.evidence_required:
            if ev_type.startswith("runtime"):
                continue
            checks.append(A.assert_event_recorded(obs, ev_type))
        if spec.scenario_id == "SC-01b" and self.target_spy is not None:
            checks.append(A.assert_target_never_called(self.target_spy))
        status = self._roll_up(checks)
        return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                              status=status, checks=checks,
                              evidence_event_ids=obs.event_ids)

    def _run_check_destination(self, spec: ScenarioSpec, rid: str,
                               checkpoint) -> ScenarioResult:
        assert spec.destination_url is not None
        resp = self.broker_client.post_check_destination(
            spec.destination_url, run_id=rid, scenario_id=spec.scenario_id)
        obs = self._observation_from_response(resp, spec.scenario_id)
        obs.recorded_event_types = self._event_types_for(spec.scenario_id)
        self.runstore.append_observation(rid, obs.model_dump(mode="json"))
        checks = [A.assert_outcome(obs, spec.expected.outcome)]
        if spec.expected.http_status is not None:
            checks.append(A.assert_status_code(obs, spec.expected.http_status))
        if spec.expected.policy_reason:
            checks.append(A.assert_policy_reason(obs, spec.expected.policy_reason))
        status = self._roll_up(checks)
        return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                              status=status, checks=checks,
                              evidence_event_ids=obs.event_ids)

    def _run_tamper(self, spec: ScenarioSpec, rid: str, checkpoint,
                    private_key=None, public_key=None) -> ScenarioResult:
        """Ledger/checkpoint tamper scenarios on a disposable copy (spec §6)."""
        import tempfile
        from pathlib import Path
        from app.harness import adversary

        assert self.ledger is not None
        tmp = Path(tempfile.mkdtemp(prefix="bayora-tamper-"))

        checks: list[A.AssertionResult] = []

        if spec.kind == "ledger_tamper":
            copy = adversary.disposable_copy(self.ledger.path, tmp)
            pre = verify_ledger(copy)
            checks.append(A.executed(
                "copy verifies before tamper", pre.valid,
                f"disposable copy VALID at height {pre.checked_height} before tamper",
                "disposable copy did not verify before tampering"))

            info: adversary.TamperInfo
            if spec.scenario_id == "SC-05":
                target_event = min(3, pre.checked_height)
                info = adversary.flip_one_byte(copy, target_event)
            elif spec.scenario_id == "SC-05c":
                h = pre.checked_height
                if h < 4:
                    checks.append(A.skipped("reorder needs >=4 events",
                                            f"ledger height {h} too small"))
                    return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                                          status=AssertionStatus.SKIPPED,
                                          checks=checks,
                                          skip_reason="ledger too small to reorder")
                info = adversary.reorder_events(copy, 1, 3)
            elif spec.scenario_id == "SC-05d":
                if pre.checked_height < 2:
                    return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                                          status=AssertionStatus.SKIPPED, checks=checks,
                                          skip_reason="ledger too small to delete")
                info = adversary.delete_event(copy, 2)
            else:  # pragma: no cover
                raise ValueError(f"unhandled tamper scenario {spec.scenario_id}")

            vr = verify_ledger(copy)
            self._record_verification(rid, spec.scenario_id, vr)
            tamper_check = A.assert_tamper_rejected(vr)
            # expected vs computed hashes recorded in the assertion detail
            checks.append(A.executed(
                "expected vs computed hash differ",
                info.expected_hash != info.computed_hash,
                f"expected={info.expected_hash[:16]}… computed={info.computed_hash[:16]}…",
                "corruption did not change the hash — verifier would miss it"))
            checks.append(tamper_check)
            checks.append(self._verification_evidence_check(rid, spec.scenario_id))
            # original must remain untouched and VALID
            original = verify_ledger(self.ledger.path)
            checks.append(A.executed(
                "original ledger UNMODIFIED",
                original.valid,
                f"original still VALID at height {original.checked_height}",
                "original ledger failed verification after tamper demo"))
            status = (AssertionStatus.PASSED
                      if all(c.status == AssertionStatus.PASSED for c in checks)
                      else AssertionStatus.FAILED)
            return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                                  status=status, checks=checks)

        # checkpoint_tamper
        if checkpoint is None:
            return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                                  status=AssertionStatus.SKIPPED, checks=checks,
                                  skip_reason="sign_checkpoints=false — no trusted anchor")

        if spec.scenario_id == "SC-05b":
            copy = adversary.disposable_copy(self.ledger.path, tmp)
            pre = verify_ledger(copy, checkpoint=checkpoint,
                                trusted_public_key=public_key)
            checks.append(A.executed(
                "checkpoint covers current height",
                checkpoint.checkpoint_seq == self.ledger.block_height,
                f"checkpoint_seq={checkpoint.checkpoint_seq} == height="
                f"{self.ledger.block_height}",
                "checkpoint does not cover the current height"))
            info = adversary.truncate_tail(copy, 2)
            vr = verify_ledger(copy, checkpoint=checkpoint,
                               trusted_public_key=public_key)
            self._record_verification(rid, spec.scenario_id, vr)
            has_prefix_mismatch = any(
                f == "CHECKPOINT_PREFIX_MISMATCH" or f.value == "CHECKPOINT_PREFIX_MISMATCH"
                for f in vr.findings)
            checks.append(A.executed(
                "truncation detected vs checkpoint",
                (not vr.valid) and has_prefix_mismatch,
                "verifier reports BELOW_CHECKPOINT + CHECKPOINT_PREFIX_MISMATCH",
                f"truncated ledger not flagged: findings={[f.value for f in vr.findings]}"))
            # honest limitation: without checkpoint, truncation is NOT detectable
            vr_no_cp = verify_ledger(copy)
            checks.append(A.executed(
                "without checkpoint truncation check not possible",
                vr_no_cp.checkpoint_coverage == "none",
                "verifier reports coverage=none without a trusted checkpoint",
                "verifier claimed coverage without a checkpoint"))
            checks.append(self._verification_evidence_check(rid, spec.scenario_id))
            # original untouched
            original = verify_ledger(self.ledger.path, checkpoint=checkpoint,
                                    trusted_public_key=public_key)
            checks.append(A.executed(
                "original ledger UNMODIFIED", original.valid,
                f"original VALID (coverage={original.checkpoint_coverage})",
                "original ledger failed verification"))
            status = (AssertionStatus.PASSED
                      if all(c.status == AssertionStatus.PASSED for c in checks)
                      else AssertionStatus.FAILED)
            return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                                  status=status, checks=checks)

        if spec.scenario_id == "SC-07":
            forged = adversary.forge_checkpoint_signature(checkpoint)
            # Blueprint §12 SC-07 prescribes: assert_checkpoint_signature(
            # corrupted) == False. PASS iff Ed25519 verification FAILS on
            # the forged bytes — the previous code asserted the forge would
            # VERIFY (inverted: an unconditional FAIL when the system works).
            sig_result = A.assert_checkpoint_signature(forged, public_key)
            checks.append(A.executed(
                "assert_checkpoint_signature(forged) == False",
                sig_result.status == AssertionStatus.FAILED,
                f"Ed25519 rejects the corrupted signature (key_id={checkpoint.key_id})",
                "SC: forged checkpoint signature ACCEPTED — critical failure"))
            vr = verify_ledger(self.ledger.path, checkpoint=forged,
                               trusted_public_key=public_key)
            self._record_verification(rid, spec.scenario_id, vr)
            checks.append(A.executed(
                "verifier fails closed on forged checkpoint",
                (not vr.valid) and any(
                    f.value == "CHECKPOINT_SIG_INVALID" for f in vr.findings),
                "verifier reports CHECKPOINT_SIG_INVALID",
                f"findings={[f.value for f in vr.findings]}"))
            checks.append(self._verification_evidence_check(rid, spec.scenario_id))
            status = (AssertionStatus.PASSED
                      if all(c.status == AssertionStatus.PASSED for c in checks)
                      else AssertionStatus.FAILED)
            return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                                  status=status, checks=checks)

        raise ValueError(f"unhandled checkpoint_tamper scenario {spec.scenario_id}")

    def _run_runtime(self, spec: ScenarioSpec, rid: str) -> ScenarioResult:
        """SC-03r / SC-04r: Docker-gated in-container batteries (D26/D28)."""
        if self.runtime_battery is None:
            return ScenarioResult(
                run_id=rid, scenario_id=spec.scenario_id,
                status=AssertionStatus.SKIPPED, checks=[],
                skip_reason="runtime battery not wired (no Docker orchestration)")
        status = self.runtime_battery.probe_status()
        if status.get("available") is not True or status.get("compose") is not True:
            reason = status.get("reason", "docker unavailable")
            return ScenarioResult(
                run_id=rid, scenario_id=spec.scenario_id,
                status=AssertionStatus.SKIPPED, checks=[],
                skip_reason=f"docker unavailable — runtime "
                           f"{'network' if spec.kind == 'runtime_network' else 'fs'} "
                           f"test not executed ({reason})")
        if spec.kind == "runtime_network":
            record = self.runtime_battery.run_network(rid)
        else:
            record = self.runtime_battery.run_fs(rid)
        record["scenario_id"] = spec.scenario_id   # accumulate per scenario
        self.runstore.save_runtime_tests(rid, record)
        check = A.assert_battery_verdict(record)
        status_final = (AssertionStatus.PASSED if check.status == AssertionStatus.PASSED
                        else check.status)
        return ScenarioResult(run_id=rid, scenario_id=spec.scenario_id,
                              status=status_final, checks=[check],
                              evidence_event_ids=[])

    # ------------------------------------------------------------ plumbing

    def _record_verification(self, rid: str, scenario_id: Optional[str],
                             vr) -> None:
        """Persist a verification BOTH ways (D8 + blueprint §9.2 step 4):
        verifications.jsonl (run artifact) AND a sanitized
        VERIFICATION_PERFORMED ledger event (persisted record). Findings are
        recorded as static enum names only — never raw values."""
        from app.schema import Component, EventType
        detail = {"valid": "true" if vr.valid else "false",
                  "findings": ",".join(f.value for f in vr.findings) or "none",
                  "checked_height": str(vr.checked_height),
                  "coverage": vr.checkpoint_coverage}
        if self.ledger is not None:
            try:
                self.ledger.append(EventType.VERIFICATION_PERFORMED,
                                   Component.VERIFIER, run_id=rid,
                                   outcome=None, scenario_id=scenario_id,
                                   detail=detail)
            except Exception:
                pass   # evidence-of-verification is best-effort; never blocks
        try:
            self.runstore.append_verification(rid, vr)
        except Exception:
            pass

    def _verification_evidence_check(self, rid: str,
                                     scenario_id: Optional[str]) -> A.AssertionResult:
        """The tamper scenarios declare evidence_required=
        ['verification.performed'] — assert the event really landed in the
        referenced chain (the old code never emitted it, so the declared
        evidence was unsatisfiable by construction)."""
        from app.schema import EventType
        if self.ledger is None:
            return A.not_evaluated(
                "verification.performed recorded",
                "no ledger wired — verification evidence cannot be recorded")
        ids = [e.event_id for e in self.ledger.read_all()
               if e.event_type == EventType.VERIFICATION_PERFORMED
               and e.scenario_id == scenario_id]
        return A.executed(
            "verification.performed recorded",
            bool(ids),
            "VERIFICATION_PERFORMED ledger event(s) recorded for this scenario",
            "SC: expected ledger event verification.performed, not recorded",
            evidence=ids)

    def _observation_from_response(self, resp, scenario_id: str) -> Observation:
        """Parse an httpx.Response into an Observation per §7.4.2's rule.

        Outcome is read from the BODY (EvaluateResponse or BrokerErrorBody);
        transport failure => NOT_EVALUATED with the reason recorded.
        """
        import json as _json
        try:
            body = resp.json()
        except Exception:
            return Observation(scenario_id=scenario_id, transport_failed=True,
                               outcome=Outcome.NOT_EVALUATED,
                               detail="body unparseable/transport error",
                               status_code=getattr(resp, "status_code", None))
        outcome = body.get("outcome")
        obs = Observation(
            scenario_id=scenario_id,
            status_code=resp.status_code,
            outcome=Outcome(outcome) if outcome else None,
            released_text=body.get("released_text"),
            policy_reason=(body.get("policy_decision", {}) or {}).get("reason_code")
            or body.get("error"),
            event_ids=body.get("events", []) or [],
        )
        return obs

    def _roll_up(self, checks: list[A.AssertionResult]) -> AssertionStatus:
        statuses = {c.status for c in checks}
        if AssertionStatus.FAILED in statuses:
            return AssertionStatus.FAILED
        if AssertionStatus.ERRORED in statuses:
            return AssertionStatus.ERRORED
        if AssertionStatus.NOT_EVALUATED in statuses:
            return AssertionStatus.NOT_EVALUATED
        return AssertionStatus.PASSED

    def _event_types_for(self, scenario_id: str) -> list[str]:
        """Event types recorded in the ledger for this scenario (evidence)."""
        if self.ledger is None:
            return []
        return [e.event_type.value for e in self.ledger.read_all()
                if e.scenario_id == scenario_id]

    def _record(self, state: RunState, result: ScenarioResult) -> None:
        state.scenario_status[result.scenario_id] = result.status.value
        if result.skip_reason:
            # the LIVE probed/gate reason — the report renders it verbatim
            state.skip_reasons[result.scenario_id] = result.skip_reason
        elif result.status.value != "SKIPPED":
            state.skip_reasons.pop(result.scenario_id, None)
        state.updated_at = self.clock.now_utc().isoformat()
        counts = state.assertions
        counts["total"] = counts.get("total", 0) + len(result.checks)
        for c in result.checks:
            key = {"PASS": "passed", "FAIL": "failed", "ERROR": "errors",
                   "SKIPPED": "skipped", "NOT_EVALUATED": "not_evaluated"}[c.status.value]
            counts[key] = counts.get(key, 0) + 1
        # A gate-SKIPPED scenario with no executed checks still counts as one
        # honest SKIPPED assertion; same for an infrastructure ERRORED result.
        if result.status == AssertionStatus.SKIPPED and not result.checks:
            counts["total"] = counts.get("total", 0) + 1
            counts["skipped"] = counts.get("skipped", 0) + 1
        if result.status == AssertionStatus.ERRORED and not result.checks:
            counts["total"] = counts.get("total", 0) + 1
            counts["errors"] = counts.get("errors", 0) + 1
