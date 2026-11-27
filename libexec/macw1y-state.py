#!/usr/bin/env python3
"""
macw1y-state.py — Predictable state tracking, targeted config editing, and safe rollback.

Records original user/system state before installation changes:
  - GSettings key/value pairs (first-write wins so re-runs preserve true originals)
  - Existing files/symlinks (backup copy, uid, gid, mode, symlink target)
  - Newly created files/directories
  - Systemd user/system service states (enabled/masked/active)
  - Installed packages (recorded for visibility; never blindly removed)

Supports dry-run plans, targeted KEY=VALUE file updates (preserving existing
lines), and accurate partial-failure reporting on rollback.
"""

import argparse
import datetime
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys

MANIFEST_VERSION = 1


def default_state_dir():
    env_dir = os.environ.get("MACW1Y_STATE_DIR")
    if env_dir:
        return pathlib.Path(env_dir)
    xdg_state = os.environ.get("XDG_STATE_HOME")
    if xdg_state:
        return pathlib.Path(xdg_state) / "macw1y"
    return pathlib.Path.home() / ".local" / "state" / "macw1y"


def manifest_path(state_dir):
    return pathlib.Path(state_dir) / "install-manifest.json"


def load_manifest(state_dir):
    mp = manifest_path(state_dir)
    if mp.exists():
        return json.loads(mp.read_text(encoding="utf-8"))
    return {
        "version": MANIFEST_VERSION,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "components": [],
        "files": {},
        "gsettings": {},
        "services": {},
        "packages": [],
    }


def save_manifest(state_dir, data):
    state_dir = pathlib.Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    mp = manifest_path(state_dir)
    tmp = mp.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, mp)


def record_component(state_dir, name):
    data = load_manifest(state_dir)
    if name not in data["components"]:
        data["components"].append(name)
    save_manifest(state_dir, data)


def record_file(state_dir, target_path, component="core"):
    """Record original state of target_path before modifying or creating it."""
    state_dir = pathlib.Path(state_dir)
    data = load_manifest(state_dir)
    abs_path = os.path.abspath(target_path)
    if abs_path in data["files"]:
        return data["files"][abs_path]

    entry = {
        "path": abs_path,
        "component": component,
        "existed": False,
        "newly_created": True,
        "is_symlink": False,
        "link_target": None,
        "is_dir": False,
        "uid": None,
        "gid": None,
        "mode": None,
        "backup_path": None,
    }

    if os.path.lexists(abs_path):
        st = os.lstat(abs_path)
        entry["existed"] = True
        entry["newly_created"] = False
        entry["uid"] = st.st_uid
        entry["gid"] = st.st_gid
        entry["mode"] = stat.S_IMODE(st.st_mode)
        if stat.S_ISLNK(st.st_mode):
            entry["is_symlink"] = True
            entry["link_target"] = os.readlink(abs_path)
        elif stat.S_ISDIR(st.st_mode):
            entry["is_dir"] = True
        elif stat.S_ISREG(st.st_mode):
            rel_safe = abs_path.lstrip("/").replace("/", "__")
            backup_dir = state_dir / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            bpath = backup_dir / rel_safe
            shutil.copy2(abs_path, bpath)
            entry["backup_path"] = str(bpath)

    data["files"][abs_path] = entry
    save_manifest(state_dir, data)
    return entry


def record_gsetting(state_dir, schema, key, value=None, gsettings_bin="gsettings"):
    """Record original gsettings value before modifying it (first-write wins)."""
    data = load_manifest(state_dir)
    full_key = f"{schema}::{key}"
    if full_key in data["gsettings"]:
        return data["gsettings"][full_key]

    orig_val = value
    present = value is not None
    if orig_val is None and shutil.which(gsettings_bin):
        res = subprocess.run(
            [gsettings_bin, "get", schema, key],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0:
            orig_val = res.stdout.strip()
            present = True

    entry = {
        "schema": schema,
        "key": key,
        "present": present,
        "original_value": orig_val,
    }
    data["gsettings"][full_key] = entry
    save_manifest(state_dir, data)
    return entry


def record_service(state_dir, unit, scope="user", state=None):
    """Record original systemd unit enabled/masked state before changing it."""
    data = load_manifest(state_dir)
    svc_key = f"{scope}:{unit}"
    if svc_key in data["services"]:
        return data["services"][svc_key]

    orig_state = state
    if orig_state is None and shutil.which("systemctl"):
        cmd = ["systemctl"]
        if scope == "user":
            cmd.append("--user")
        cmd.extend(["is-enabled", unit])
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        orig_state = (res.stdout.strip() or res.stderr.strip() or "unknown").splitlines()[0]

    entry = {
        "unit": unit,
        "scope": scope,
        "original_state": orig_state or "unknown",
    }
    data["services"][svc_key] = entry
    save_manifest(state_dir, data)
    return entry


def record_package(state_dir, pkg_name):
    data = load_manifest(state_dir)
    if pkg_name not in data["packages"]:
        data["packages"].append(pkg_name)
    save_manifest(state_dir, data)


def update_kv_file(state_dir, target_path, updates, component="perf-tweaks"):
    """
    Targeted KEY=VALUE update for files like /etc/environment.
    Preserves all unrelated lines, comments, and existing keys.
    """
    record_file(state_dir, target_path, component=component)
    p = pathlib.Path(target_path)
    lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
    remaining = dict(updates)
    out = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            out.append(line)
            continue
        k = stripped.split("=", 1)[0].strip()
        if k in remaining:
            out.append(f"{k}={remaining.pop(k)}")
        else:
            out.append(line)
    for k, v in remaining.items():
        out.append(f"{k}={v}")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(out) + "\n", encoding="utf-8")


def rollback(state_dir, dry_run=True, remove_new=False, gsettings_bin="gsettings"):
    """
    Restore recorded original files, gsettings, and services.
    Identifies newly introduced items before removing them (only removes when remove_new=True).
    Never removes recorded packages/dependencies automatically.
    Returns (succeeded_list, failed_list, newly_introduced_list).
    """
    mp = manifest_path(state_dir)
    if not mp.exists():
        return [], [f"No install manifest found at {mp}"], []

    data = load_manifest(state_dir)
    succeeded = []
    failed = []
    newly_introduced = []

    # 1. Restore pre-existing files and identify newly introduced items
    for abs_path, entry in sorted(data.get("files", {}).items()):
        if entry.get("newly_created"):
            newly_introduced.append(abs_path)
            if not dry_run and remove_new:
                try:
                    if os.path.islink(abs_path) or os.path.isfile(abs_path):
                        os.unlink(abs_path)
                        succeeded.append(f"Removed newly created file: {abs_path}")
                    elif os.path.isdir(abs_path):
                        shutil.rmtree(abs_path)
                        succeeded.append(f"Removed newly created directory: {abs_path}")
                except OSError as exc:
                    failed.append(f"Failed to remove {abs_path}: {exc}")
            continue

        # Pre-existing file/symlink restoration
        if dry_run:
            succeeded.append(f"[DRY-RUN] Restore pre-existing path: {abs_path}")
            continue
        try:
            if entry.get("is_symlink") and entry.get("link_target") is not None:
                if os.path.lexists(abs_path):
                    if os.path.isdir(abs_path) and not os.path.islink(abs_path):
                        shutil.rmtree(abs_path)
                    else:
                        os.unlink(abs_path)
                os.symlink(entry["link_target"], abs_path)
                succeeded.append(f"Restored symlink: {abs_path} -> {entry['link_target']}")
            elif entry.get("backup_path") and os.path.exists(entry["backup_path"]):
                pathlib.Path(abs_path).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(entry["backup_path"], abs_path)
                if entry.get("mode") is not None:
                    os.chmod(abs_path, entry["mode"])
                if entry.get("uid") is not None and entry.get("gid") is not None and os.geteuid() == 0:
                    os.chown(abs_path, entry["uid"], entry["gid"])
                succeeded.append(f"Restored file: {abs_path}")
            elif entry.get("is_dir"):
                pathlib.Path(abs_path).mkdir(parents=True, exist_ok=True)
                if entry.get("mode") is not None:
                    os.chmod(abs_path, entry["mode"])
                succeeded.append(f"Preserved pre-existing directory: {abs_path}")
            else:
                failed.append(f"Missing backup for pre-existing file: {abs_path}")
        except OSError as exc:
            failed.append(f"Failed to restore {abs_path}: {exc}")

    # 2. Restore recorded GSettings values
    for _, entry in sorted(data.get("gsettings", {}).items()):
        schema = entry["schema"]
        key = entry["key"]
        orig = entry.get("original_value")
        if dry_run:
            action = f"set {schema} {key} {orig}" if entry.get("present") else f"reset {schema} {key}"
            succeeded.append(f"[DRY-RUN] GSettings {action}")
            continue
        if not shutil.which(gsettings_bin):
            failed.append(f"gsettings unavailable to restore {schema} {key}")
            continue
        cmd = [gsettings_bin, "set", schema, key, orig] if (entry.get("present") and orig is not None) else [gsettings_bin, "reset", schema, key]
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res.returncode == 0:
            succeeded.append(f"Restored gsettings {schema} {key}")
        else:
            failed.append(f"Failed gsettings restore {schema} {key}: {res.stderr.strip()}")

    # 3. Restore recorded systemd unit states
    for _, entry in sorted(data.get("services", {}).items()):
        unit = entry["unit"]
        scope = entry.get("scope", "user")
        orig_state = entry.get("original_state", "unknown")
        if dry_run:
            succeeded.append(f"[DRY-RUN] Restore {scope} service {unit} (original: {orig_state})")
            continue
        if not shutil.which("systemctl"):
            failed.append(f"systemctl unavailable to restore {unit}")
            continue
        base = ["systemctl", "--user"] if scope == "user" else ["systemctl"]
        if orig_state in ("disabled", "static", "indirect", "not-found"):
            subprocess.run(base + ["unmask", unit], capture_output=True, check=False)
            res = subprocess.run(base + ["disable", "--now", unit], capture_output=True, text=True, check=False)
            if res.returncode == 0 or orig_state == "not-found":
                succeeded.append(f"Restored {scope} service {unit} to {orig_state}")
            else:
                failed.append(f"Failed to restore {scope} service {unit}: {res.stderr.strip()}")
        elif orig_state == "enabled":
            subprocess.run(base + ["unmask", unit], capture_output=True, check=False)
            res = subprocess.run(base + ["enable", unit], capture_output=True, text=True, check=False)
            if res.returncode == 0:
                succeeded.append(f"Re-enabled {scope} service {unit}")
            else:
                failed.append(f"Failed to re-enable {scope} service {unit}: {res.stderr.strip()}")

    return succeeded, failed, newly_introduced


def main():
    parser = argparse.ArgumentParser(description="macW1Y state manifest & safe rollback helper")
    parser.add_argument("--state-dir", default=str(default_state_dir()))
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_comp = sub.add_parser("record-component")
    p_comp.add_argument("name")

    p_file = sub.add_parser("record-file")
    p_file.add_argument("path")
    p_file.add_argument("--component", default="core")

    p_gs = sub.add_parser("record-gsetting")
    p_gs.add_argument("schema")
    p_gs.add_argument("key")
    p_gs.add_argument("--value", default=None)

    p_svc = sub.add_parser("record-service")
    p_svc.add_argument("unit")
    p_svc.add_argument("--scope", choices=["user", "system"], default="user")
    p_svc.add_argument("--state", default=None)

    p_pkg = sub.add_parser("record-package")
    p_pkg.add_argument("name")

    p_kv = sub.add_parser("update-kv")
    p_kv.add_argument("path")
    p_kv.add_argument("pairs", nargs="+", help="KEY=VALUE pairs")
    p_kv.add_argument("--component", default="perf-tweaks")

    p_rb = sub.add_parser("rollback")
    p_rb.add_argument("--dry-run", action="store_true")
    p_rb.add_argument("--remove-new", action="store_true")

    args = parser.parse_args()
    if args.cmd == "record-component":
        record_component(args.state_dir, args.name)
    elif args.cmd == "record-file":
        record_file(args.state_dir, args.path, component=args.component)
    elif args.cmd == "record-gsetting":
        record_gsetting(args.state_dir, args.schema, args.key, value=args.value)
    elif args.cmd == "record-service":
        record_service(args.state_dir, args.unit, scope=args.scope, state=args.state)
    elif args.cmd == "record-package":
        record_package(args.state_dir, args.name)
    elif args.cmd == "update-kv":
        updates = {}
        for pair in args.pairs:
            if "=" not in pair:
                parser.error(f"Invalid KEY=VALUE pair: {pair}")
            k, v = pair.split("=", 1)
            updates[k] = v
        update_kv_file(args.state_dir, args.path, updates, component=args.component)
    elif args.cmd == "rollback":
        ok, errs, new_items = rollback(
            args.state_dir,
            dry_run=args.dry_run,
            remove_new=args.remove_new,
        )
        for line in ok:
            print(f"[OK] {line}")
        if new_items:
            print(f"\nNewly introduced items ({len(new_items)}):")
            for item in new_items:
                status = "removed" if (not args.dry_run and args.remove_new) else "proposed for removal (--remove-new)"
                print(f"  - {item} ({status})")
        data = load_manifest(args.state_dir) if manifest_path(args.state_dir).exists() else {}
        if data.get("packages"):
            print("\nRecorded packages (preserved; never automatically removed):")
            for pkg in data["packages"]:
                print(f"  - {pkg}")
        if errs:
            print(f"\nPartial failures ({len(errs)}):", file=sys.stderr)
            for err in errs:
                print(f"  - {err}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
