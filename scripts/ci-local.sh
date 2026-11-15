#!/usr/bin/env bash
# Standalone, read-only policy check for the user's independent local CI farm.
# Never invokes install.sh, uninstall.sh, any updater, or privileged command.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
failed=0

say() { printf '%s\n' "$*"; }
fail() { say "FAIL: $*"; failed=1; }

say "macW1Y static policy check (local/ci-farm only)"
say "WARNING: Upstream installers and auto-repair scripts are NOT approved for execution."

for required in AGENTS.md COMPATIBILITY.md IMPLEMENTATION_PLAN.md; do
  [[ -s "$required" ]] || fail "Missing required policy document: $required"
done

if [[ -d .github/workflows ]] && [[ -n "$(find .github/workflows -type f -print -quit)" ]]; then
  fail "GitHub Actions workflow files exist. Remove them: GitHub CI is prohibited."
else
  say "PASS: No GitHub Actions workflows in .github/workflows"
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && [[ -n "$(git ls-files -- .github/workflows)" ]]; then
  fail "Tracked GitHub Actions workflows found in git history."
else
  say "PASS: No tracked GitHub Actions workflows"
fi

for script in install.sh uninstall.sh apply_plymouth.sh; do
  if [[ -f "$script" ]]; then
    if bash -n "$script"; then
      say "PASS: Static Bash syntax: $script (NOT executed)"
    else
      fail "Bash syntax error: $script"
    fi
  fi
done

if command -v python3 >/dev/null 2>&1; then
  if python3 - <<'PY'
import json
from pathlib import Path

files = sorted(Path("extensions").glob("*/metadata.json"))
if not files:
    raise SystemExit("ERROR: no GNOME extension metadata found")
for file in files:
    with file.open(encoding="utf-8") as stream:
        data = json.load(stream)
    if not isinstance(data, dict) or not data.get("uuid"):
        raise ValueError(f"{file}: metadata object or uuid missing")
    if not isinstance(data.get("shell-version"), list):
        raise ValueError(f"{file}: missing shell-version list")
print(f"PASS: Parsed {len(files)} GNOME extension metadata files (not runtime-tested)")

critical = (
    "kiwi@kemma",
    "liquid-glass@thinkingcoding1231.gmail.com",
    "dash2dock-motion@unmade.space",
    "cupertino-dock-lite@rinzler69-wastaken.github.com",
    "blur-my-shell@aunetx",
)
for name in critical:
    path = Path("extensions") / name / "metadata.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if "50" not in [str(v) for v in data["shell-version"]]:
        raise SystemExit(f"ERROR: GNOME 50 not declared: {name}")
print(f"PASS: {len(critical)} critical extensions declare GNOME 50 (metadata only, not a runtime guarantee)")

for name in ("config/extensions.lock.json", "config/macw1y-manifest.json"):
    path = Path(name)
    if path.is_file():
        json.loads(path.read_text(encoding="utf-8"))
        print(f"PASS: JSON OK: {name}")
PY
  then
    :
  else
    fail "GNOME extension metadata validation failed"
  fi
else
  say "SKIP: python3 unavailable (no metadata validation)"
fi

if (( failed )); then
  say "FAIL: Static policy checks failed. Do not deploy."
  exit 1
fi

say "PASS: Preliminary static checks only; not an installer, security audit or deployment approval."
