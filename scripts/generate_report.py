#!/usr/bin/env python
"""Build + sign audit_report.json; --verify is the independent path (D15).

Usage:
  python scripts/generate_report.py --run <run_id> [--config PATH] [--verify FILE]

--run:     builds from artifacts, validates, signs (if enabled), exports,
           prints status + counts + verification_steps. NOTE (D15): the
           builder prints "status=<computed> (run evidence); signature
           enforced by --verify".
--verify:  loads report + trusted public key, verifies the signature over
           the canonical bytes AND re-verifies the referenced ledger from
           scratch. ACCEPTS only per the ACCEPT rule; a VERIFIED* report with
           absent/invalid signature while signing is enabled => exit 1.

Exit codes: 0 accepted; 1 verification failed; 2 usage/environment error.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import load_config
from app.clock import SystemClock
from app.harness.docker_probe import DockerProbe
from app.harness.runstore import RunStore
from app.ledger.keys import load_or_generate_keypair, load_public_key
from app.reporting.report import build_report, validate_report, export_report
from app.reporting.signing import sign_report, verify_report_file


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Bayora audit report tool")
    parser.add_argument("--run")
    parser.add_argument("--config", default=None)
    parser.add_argument("--verify")
    parser.add_argument("--key-dir", default=None)
    args = parser.parse_args(argv)

    if not args.run and not args.verify:
        print("ERROR: provide --run <run_id> or --verify <report.json>")
        return 2

    config = load_config(Path(args.config) if args.config else None)

    if args.verify:
        report_path = Path(args.verify)
        if not report_path.is_file():
            print(f"ERROR: report not found: {report_path}")
            return 2
        key_dir = Path(args.key_dir) if args.key_dir else Path(config.report.key_dir)
        pub_path = key_dir / "demo_public_key.pem"
        pub = load_public_key(pub_path) if pub_path.is_file() else None
        rv = verify_report_file(report_path, pub, config=config)
        print("REPORT VERIFICATION (independent path)")
        print("-" * 46)
        print(f"recorded_status:    {rv.recorded_status}")
        print(f"signature_valid:    {rv.signature_valid}")
        print(f"ledger_chain_valid: {rv.ledger_chain_valid}")
        print(f"checkpoint_valid:   {rv.checkpoint_valid}")
        print(f"findings:           {rv.findings or 'none'}")
        print(f"ACCEPT:             {rv.accepted}")
        return 0 if rv.accepted else 1

    # --run path -----------------------------------------------------------
    run_id = args.run
    runstore = RunStore(Path(config.ledger.runs_dir))
    if not runstore.has_run(run_id):
        print(f"ERROR: run not found: {run_id}")
        return 2

    key_dir = Path(args.key_dir) if args.key_dir else Path(config.report.key_dir)
    keypair = load_or_generate_keypair(key_dir)

    report = build_report(run_id, runstore, config, SystemClock(),
                          DockerProbe(), keypair=keypair)
    validate_report(report)
    if config.report.signing_enabled:
        report = sign_report(report, keypair[0])
        sig = report.report_signature.signature or ""
        print(f"report signed: key_id={keypair[1]}, signature={sig[:24]}…")
    else:
        print("report signing disabled by config — recording limitation")

    out = export_report(report, Path(config.ledger.runs_dir) / run_id / "audit_report.json")
    print(f"report exported:  {out}")
    print(f"status={report.status.value} (run evidence); "
          f"signature enforced by --verify")
    print(f"assertions: total={report.assertions.total} "
          f"passed={report.assertions.passed} failed={report.assertions.failed} "
          f"errors={report.assertions.errors} skipped={report.assertions.skipped} "
          f"not_evaluated={report.assertions.not_evaluated}")
    for step in report.verification_steps:
        print(f"  step {step.name}: required={step.required} "
              f"executed={step.executed} result={step.result}")
    for lim in report.limitations:
        print(f"  limitation: {lim}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
