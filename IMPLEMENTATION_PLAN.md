# macW1Y Compatibility Fork — Implementation Plan

**Stage:** Plan only. No deployment approved.  
**Primary target:** Existing Ubuntu 26.04.1 LTS / GNOME Wayland workstation.  
**Managers:** Codex or Claude (one active owner). **Implementer:** Gemini.  
**CI:** Independent local ci-farm only; never GitHub Actions.

## Delivery philosophy

Preserve a working development machine and its remote connectivity. Aim for the macOS visual experience without adopting upstream's entire operating-system modification layer. Prefer user-scoped GTK/icon changes and isolated GNOME extensions; avoid a bespoke installer framework, unnecessary packages, and system-wide changes. A component may be skipped if its risk outweighs its visual value.

### Work package 0 — Safety and environment baseline (current)

- [x] Establish safe agent rules and local-only CI requirement.
- [x] Identify critical static risks in upstream installer, uninstaller, and representative runtime components.
- [ ] Run scripts/ci-local.sh on a local clone or independent ci-farm; record output (no GitHub Actions).
- [ ] Verify current exact GNOME Shell, Mutter, Ubuntu, Wayland, existing extensions, theme settings, and remote access with read-only commands listed in COMPATIBILITY.md.
- [ ] Establish a restore point, access method independent of the modified graphical session, and a proven rollback process before any GUI mutation.
- [ ] Manually inspect upstream assets that will be reused for licenses, unexpected executables/symlinks, and malware indicators.

**Gate 0:** Manager approves a specific, auditable cosmetic-only scope. No runtime changes.

### Work package 1 — Safe cosmetic asset adapter (Gemini)

- [ ] Create a minimal user-scoped preview or install plan that does not call install.sh, uninstall.sh, any updater, or privileged helper.
- [ ] Select theme CSS, icons and optional backgrounds explicitly; list every installed/overwritten path in a generated manifest.
- [ ] Do not overwrite existing user GTK4 configuration without backup; account for libadwaita's stylesheet limitations.
- [ ] Include dry-run as the default, backup of each overwritten user file, exact restore command, and collision detection.
- [ ] Keep GTK/theme application separate from GNOME Shell extension enablement.
- [ ] Include test fixtures for paths with spaces, repeated application (idempotency), pre-existing themes, and partial failure recovery.
- [ ] No Apple fonts, proprietary wallpapers, or other unclear-redistribution assets in a new packaged release until license verification.

**Gate 1:** Manager has reviewed the diff, reproducible asset manifest, and dry-run/restore tests in a disposable account or VM. User authorizes first cosmetic test on target.

### Work package 2 — Desktop shell appearance, one extension at a time

Suggested evaluation order: existing Ubuntu dock baseline -> user theme -> one supported dock enhancement -> one blur/glass extension -> one menu/control-center feature. Never enable competing implementations simultaneously.

- [ ] Inventory and preserve the currently installed Ubuntu dock and extensions.
- [ ] Inspect GNOME 50 API compatibility and security-sensitive behavior of each candidate, not just metadata.json.
- [ ] Explicitly exclude eval-helper@mactheme, any D-Bus Eval endpoint, and forced extension-version-validation bypass.
- [ ] Prefer native user-scoped GNOME extension mechanisms; no /usr/bin/gnome-shell replacement or G_RESOURCE_OVERLAYS injection.
- [ ] Verify on a test session first; never mass-enable bundled extensions.
- [ ] Record login behavior, extension errors, window management, performance, and the remote desktop session after each change.
- [ ] Keep an immediate disable/restore path available in case the GUI stops responding.

**Gate 2:** Each extension individually passes functional and remote-access smoke tests; compatibility review signed off by manager.

### Work package 3 — User experience refinement

- [ ] Tune light/dark behavior, titlebar buttons, window shadows, dock placement, and GNOME accessibility without replacing system binaries.
- [ ] Preserve keyboard layout, input methods, terminal keybindings, copy/paste, screenshots, AnyDesk, RDP, Tailscale, and SSH.
- [ ] Consider optional changes to the user file manager appearance only through supported themes or extensions; do not hook Nautilus through LD_PRELOAD.
- [ ] If GNOME 50 cannot support a particular macOS feature safely, document the trade-off and skip it.

**Gate 3:** Accept visually with a live before/after review and a clean rollback test; no degradation in the development workflow.

## Excluded from this program unless separately requested and approved

GDM/login customization; GRUB/Plymouth; initramfs, kernel, dracut; systemd daemons (including the root-privileged mac-grub-status.service that executes a script from the user's home directory); power/GPU tweaks; udev/input group changes; sudoers changes; environment rewrites; GNOME binary diversion; Nautilus or GNOME Control Center binary wrappers; arbitrary D-Bus JavaScript Eval; auto-repair watchdogs; the ~/Applications auto-execute watcher (mac-sync-applications); mac-gdm-bypass auto-login/GDM-restart behavior; global dconf import/reset; installing Wine/Steam/NVIDIA drivers solely for appearance.

## Local CI contract

The ci-farm may run shell syntax checking, metadata validation, static security checks, file manifest consistency checks, and tests that operate only inside a disposable temporary directory. It **must not** run the upstream install/uninstall/upgrade scripts or apply GTK/dconf/system changes to the ci-farm node.

Minimum initial job, invoked **from a local clone or the independent ci-farm**:

    bash scripts/ci-local.sh

This check intentionally proves only the documented static policy assertions and is not a security certification. Future tests can be added under scripts/ and called directly by the farm; never create .github/workflows.

## Deployment checklist (future, not authorization)

1. Capture exactly which files/settings would change; review a dry-run before any writes.
2. Store backups and a rollback manifest outside the theme source tree.
3. Confirm alternate SSH/physical recovery route, and verify it works.
4. Apply one user-scoped component (not full installer).
5. Confirm desktop, login, AnyDesk, GNOME RDP, Tailscale, SSH, terminal autocomplete, clipboard text, and screenshot clipboard behavior are no worse than baseline.
6. If any function breaks, execute the specific component rollback and stop; do not use upstream uninstall.sh.
7. After a successful validation window, document the exact tested versions and any unresolved limitations.

## Current handoff to Gemini

**First engineering task, only after manager review:** Build and test a user-scoped cosmetic asset manifest/dry-run prototype, with no sudo, no system paths, no dconf changes, no extension enablement, no network downloads, and no workstation installation. Keep implementation narrowly scoped and dependency-free where practical. Report a compact file-by-file change summary, local test output, and known risks.

## Acceptance and reporting

Each merge candidate should state: changed files, tests run (where: local/ci-farm), version assumptions, privilege and network usage, planned workstation impact, exact rollback strategy, and any gaps. No automatic merge or deploy.
