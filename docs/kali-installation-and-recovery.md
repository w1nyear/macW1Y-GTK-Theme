# macW1Y on Kali Linux (GNOME 50.5 / Wayland) — Installation, Limitations & Recovery Guide

This guide covers safe, English-first installation, Kali-specific limitations, automated vs. VM validation boundaries, and recovery procedures for this fork.

---

## 1. Kali-Specific Limitations & Compatibility Notice

- **GNOME Shell 50.5 schema differences:** On Kali Linux 2026.3 (GNOME Shell 50.5, Wayland), `org.gnome.shell` does **not** define the `start-in-overview` key that upstream Ubuntu/Debian `layout.js` overlays expect.
  - `gnome-shell-overlay/ui/layout.js` now guards `start-in-overview` via `settings_schema.has_key('start-in-overview')` with a `try/catch` fallback.
  - More importantly, **diverting `/usr/bin/gnome-shell` with `dpkg-divert` is now disabled by default** (`--with-shell-overlay` is an explicit opt-in). Keeping the packaged `/usr/bin/gnome-shell` binary untouched is strongly recommended on Kali Linux.
- **Metadata is not runtime proof:** `dependencies/check-platform.py` checks `metadata.json` `shell-version` entries and inspects `org.gnome.shell` schema keys, but **extension metadata alone does not guarantee runtime compatibility** across all 21 extensions on Kali GNOME 50.5 Wayland.
- **High-impact system modifications are opt-in:** GDM theming, GRUB/Plymouth boot themes, `initramfs` regeneration, touchpad daemon (`input` group), `LD_PRELOAD` native libraries, `/usr/local/bin` app wrappers, `/etc/environment` / `sysctl` / systemd slice performance tweaks, and `sudoers.d` rules are **disabled by default**.

---

## 2. Safe Installation Workflow

### Step 1: Preview with Dry-Run & Preflight Checks

Run a non-mutating preflight check and plan first:

```bash
./install.sh --dry-run
```

Or select specific user-level components only:

```bash
./install.sh --dry-run --only-components gtk,icons,fonts,wallpapers
```

### Step 2: Install Core User-Level Styling (Recommended Default)

```bash
./install.sh --cli --install
```

Core components enabled by default (all independently toggleable with `--no-<name>` or `--only-components`):
- `--gtk` / `--no-gtk` — GTK3/GTK4 styling & Shell theme
- `--extensions` / `--no-extensions` — GNOME Shell extensions (scoped settings; preserves workspace names, keyboard layouts, and file chooser history)
- `--icons` / `--no-icons` — Icon & cursor themes
- `--fonts` / `--no-fonts` — Typography
- `--wallpapers` / `--no-wallpapers` — Wallpapers
- `--sounds` / `--no-sounds` — Sound theme

### Step 3: Explicit System Opt-Ins (Use Only If Needed)

Each system-level modification requires its own explicit flag:
- `--with-wrappers` — App wrappers in `/usr/local/bin` and Settings overlay (with full `locales/en` deployment)
- `--with-native-libs` — `LD_PRELOAD` shared libraries (`libmac_*.so`)
- `--with-gestures` — Touchpad gesture daemon + `input` group
- `--with-gdm` — GDM login screen theme
- `--with-shell-overlay` — Private GNOME Shell `layout.js` overlay (`dpkg-divert`; not recommended on Kali)
- `--with-grub` / `--with-plymouth` / `--with-boot-themes` — Bootloader/splash themes & initramfs rebuild
- `--with-perf-tweaks` — Targeted `/etc/environment` key updates (preserves existing `PATH` and lines), `sysctl`, and systemd slices

---

## 3. State Tracking, Rollback & Recovery

### State Manifest

Every installation records pre-existing state in:
```
~/.local/state/macw1y/install-manifest.json
~/.local/state/macw1y/backups/
```
Recorded state includes original GSettings values, pre-existing files (with ownership, permissions, and symlink targets), newly created files, and touched systemd services.

### Preview Rollback (Dry-Run)

```bash
./libexec/macw1y-uninstall --dry-run
```

### Restore Recorded State

Restore pre-existing files, GSettings, and services while listing newly introduced files (without deleting them yet):

```bash
./libexec/macw1y-uninstall --rollback
```

Restore recorded state **and** remove newly introduced macW1Y files (never removes system packages or unrelated user configs like `~/.config/gtk-3.0/bookmarks`):

```bash
./libexec/macw1y-uninstall --rollback --remove-new
```

Full uninstallation (runs state rollback first, then cleans remaining macW1Y artifacts):

```bash
./install.sh --uninstall
```

### Emergency GNOME Login Loop Recovery

If a previous upstream installation diverted `/usr/bin/gnome-shell` and caused a login loop:

1. **Immediate user-session bypass (non-destructive):**
   Create `~/.config/systemd/user/org.gnome.Shell@user.service.d/99-macw1y-recovery.conf`:
   ```ini
   [Service]
   Environment=MACW1Y_DISABLE_SHELL_OVERLAY=1
   ```
   (Or point `ExecStart=` directly to `/usr/bin/gnome-shell.real` if an older wrapper is installed.)
2. **Global safe-mode flag (from TTY):**
   ```bash
   sudo mkdir -p /etc/mactheme && sudo touch /etc/mactheme/disable-overlay
   ```
3. **Restore the packaged GNOME Shell binary cleanly:**
   ```bash
   sudo rm -f /usr/bin/gnome-shell
   sudo dpkg-divert --remove --rename --divert /usr/bin/gnome-shell.real /usr/bin/gnome-shell
   ```

---

## 4. Automated Checks vs. Disposable VM Verification

| Verification Layer | What Is Covered | Environment |
|---|---|---|
| **Automated unit & regression tests** (`tests/test_*.py`) | `layout.js` `start-in-overview` guard (supported & missing schema), `bin/gnome-shell` arg preservation across bypass paths, `check-platform.py` schema & metadata checks, English resource completeness, `/home/vitaliy` & `sudoers.d` guards, `install.sh --dry-run`, `macw1y-state.py` targeted `/etc/environment` update & rollback symmetry, extension lockfile integrity | Local repository (isolated temp dirs & mocks; zero host mutation) |
| **Disposable Kali VM verification** (required before live deployment) | Live Wayland login/logout under GNOME Shell 50.5, actual runtime loading of all 21 extensions, visual English UI inspection in GNOME Control Center / Notifications / Workspaces / OSD / Screen Recording, optional `--with-gdm` / `--with-grub` / `--with-plymouth` boot cycle, and end-to-end install -> reboot -> rollback -> reboot | Disposable Kali Linux 2026.3 VM with snapshot |
