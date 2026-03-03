#!/usr/bin/env python3
"""
GENERATED CODE - REVIEW REQUIRED

consolidate.py
- Loads docs/phoenix-master-vision/memory_manifest.yaml
- Computes local SHA256 for each listed module
- Emits changed/missing status report
- Optionally updates manifest hashes in-place (--write-manifest)

Security notes:
- This script hashes file bytes only.
- It does not print file contents.
- Do not add secret files to manifest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

import yaml


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict) or "memory_manifest" not in data:
        raise ValueError("Manifest must contain top-level key 'memory_manifest'.")
    return data


def compare_manifest(repo_root: Path, manifest: Dict) -> Tuple[List[Dict], List[Dict]]:
    changed: List[Dict] = []
    current_rows: List[Dict] = []

    for row in manifest.get("memory_manifest", []):
        filename = row.get("filename", "")
        expected = row.get("sha256", "")
        role = row.get("role", "supporting")

        target = repo_root / filename
        status = "ok"
        actual = ""

        if not target.exists():
            status = "missing"
        else:
            actual = sha256_file(target)
            if expected and expected != actual:
                status = "modified"
            if not expected:
                status = "untracked_hash"

        current = {
            "filename": filename,
            "role": role,
            "expected_sha256": expected,
            "actual_sha256": actual,
            "status": status,
        }
        current_rows.append(current)

        if status in {"missing", "modified", "untracked_hash"}:
            changed.append(current)

    return changed, current_rows


def update_manifest_hashes(repo_root: Path, manifest: Dict) -> Dict:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    for row in manifest.get("memory_manifest", []):
        filename = row.get("filename", "")
        target = repo_root / filename
        if target.exists():
            row["sha256"] = sha256_file(target)
            row["last_modified"] = now

    return manifest


def write_report(report_path: Path, payload: Dict) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Phoenix memory consolidation checker")
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root path (default: current directory)",
    )
    parser.add_argument(
        "--manifest",
        default="docs/phoenix-master-vision/memory_manifest.yaml",
        help="Manifest path, relative to repo root",
    )
    parser.add_argument(
        "--report",
        default="docs/phoenix-master-vision/consolidation_report.json",
        help="Output JSON report path, relative to repo root",
    )
    parser.add_argument(
        "--write-manifest",
        action="store_true",
        help="Update sha256 fields in the manifest for existing files",
    )

    args = parser.parse_args()
    repo_root = Path(args.repo_root).resolve()
    manifest_path = (repo_root / args.manifest).resolve()
    report_path = (repo_root / args.report).resolve()

    manifest = load_manifest(manifest_path)

    if args.write_manifest:
        manifest = update_manifest_hashes(repo_root, manifest)
        with manifest_path.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(manifest, fh, sort_keys=False)

    changed, current = compare_manifest(repo_root, manifest)

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "manifest": os.path.relpath(manifest_path, repo_root),
        "changedCount": len(changed),
        "changed": changed,
        "files": current,
    }

    write_report(report_path, payload)

    print(f"Report written: {os.path.relpath(report_path, repo_root)}")
    print(f"Changed files: {len(changed)}")
    for item in changed:
        print(f"- {item['status']}: {item['filename']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
