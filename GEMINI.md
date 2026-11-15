# Gemini — macW1Y implementation workhorse

Read `AGENTS.md` first; it is the source of truth.

Implement only the clearly scoped task assigned by Codex or Claude. Preserve existing macOS UI behavior and keep patches minimal. Before coding, identify files/dependencies. After coding, report diffs, exact local tests, potential GNOME 50/Wayland regressions, and any commands that would require elevated privileges. Ask the manager before changing installation/security policy or implementing system-level hooks.

No GitHub Actions, GitHub-hosted CI, or hosted runners. Do not run upstream installers or change the real Ubuntu workstation. For safe static checks use `bash scripts/ci-local.sh`; GUI tests require a disposable GNOME 50 session.
