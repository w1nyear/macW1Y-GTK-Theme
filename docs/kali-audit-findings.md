# macW1Y Kali Linux (GNOME 50.5 / Wayland) — Audit Findings & Remediation Plan

**Branch:** `fix/kali-gnome50-english-safe-install`  
**Base commit:** `90d423c4` (v0.7.1)  
**Scope:** Repository-only audit and remediation (no live host mutations).

---

## 1. Existing Test Baseline (Non-Mutating)

- Running `python3 -m unittest discover -s tests -p 'test_*.py'` against a read-only `$HOME` fails with 6 errors because `bin/mac-extension-guard:34` and `bin/mac-sync-applications:253` call `os.makedirs()` in `$HOME` at module import time.
- Running with an isolated temporary home (`HOME=/tmp/macw1y-test-home python3 -m unittest discover -s tests -p 'test_*.py' -v`) passes **39/39** existing tests.
- Host-mutating or live-session scripts (`bin/test-macw1y-animations.py`, `bin/mac-audit-sync`) were intentionally **not** executed against the host desktop.

---

## 2. Confirmed Defects

### Critical

1. **GNOME Shell 50.5 startup crash in `layout.js` overlay**
   - **File:** `gnome-shell-overlay/ui/layout.js:231-233`
   - **Confirmed:** Unconditionally calls `global.settings.get_boolean('start-in-overview')`. On Kali Linux 2026.3 / GNOME Shell 50.5, `start-in-overview` is absent from `org.gnome.shell`, causing an unhandled GSettings abort and a login loop.
   - **Fix:** Guard schema key lookup with `global.settings.settings_schema?.has_key('start-in-overview')` (with `try/catch` fallback to `false`). Also avoid diverting `/usr/bin/gnome-shell` or installing private Shell overlays by default; make the overlay an explicit opt-in and validate schema compatibility before enabling.

2. **`bin/gnome-shell` wrapper drops launch arguments in `bypass_overlay`**
   - **File:** `bin/gnome-shell:15-18, 30, 36, 46, 80, 90`
   - **Confirmed:** `bypass_overlay()` executes `exec "$REAL_SHELL" "$@"`, but all 5 call sites invoke `bypass_overlay` without `"$@"`. When safe mode, version guard, or watchdog triggers, arguments such as `--wayland`, `--mode=gdm`, or `--display-server` are lost.
   - **Fix:** Pass `"$@"` to every `bypass_overlay "$@"` call and add a schema-key check (`gsettings list-keys org.gnome.shell`) so the overlay auto-bypasses when required keys are absent.

3. **Dangerous and author-specific `sudoers.d` grants deployed unconditionally**
   - **Files:** `etc/sudoers.d/99-mactheme:1`, `etc/sudoers.d/99-mac-boot-config:1`, `install.sh:1418-1426`
   - **Confirmed:**
     - `99-mactheme` grants `vitaliy ALL=(ALL) NOPASSWD: ALL`.
     - `99-mac-boot-config` grants `ALL ALL=(ALL) NOPASSWD: /usr/local/bin/mac-boot-config` (any local user can modify GRUB/initramfs/systemd as root without authentication).
     - `install.sh` copies every file in `etc/sudoers.d/*` into `/etc/sudoers.d/`.
   - **Fix:** Remove `etc/sudoers.d/99-mactheme`, restrict/remove world-accessible NOPASSWD boot-config grant (do not install `sudoers.d` rules by default; require explicit opt-in or interactive privilege elevation via `pkexec`/`sudo`).

### High

4. **Incomplete English localization & missing Settings `.ui` locale deployment**
   - **Files & Confirmed Behavior:**
     - `install.sh:1161-1183`: `install_settings_overlay()` copies only top-level `gnome-control-center-overlay/cc-*.ui` (Ukrainian) and never copies `gnome-control-center-overlay/locales/` (which contains `en/`, `de/`, `es/`, `fr/`, `it/`, `pl/`, `uk/`). As a result, `bin/gnome-control-center:12-21` falls back to Ukrainian base `.ui` files.
     - `dconf/gnome-all.dconf:90,119-120,265,297-321`: Hardcodes Ukrainian `workspace-names=['Робочий стіл 1', 'Робочий стіл 2', 'Робочий стіл 3']`, `name='Офіс'`, and `/home/vitaliy/...` file chooser paths and wallpaper URIs.
     - `extensions/appmenu@ChathurangaBW.github.io/workspaceIndicator.js:55,63,65,759`: Hardcodes `` `Робочий стіл ${index + 1}` `` instead of using `mac_i18n.js` with English fallback (`Desktop N`).
     - `extensions/macw1y-touchpad-gestures@mactheme/gestureImpl.js:294,296,563,568` (and `touchpad/macw1y-touchpad-gestures@mactheme/gestureImpl.js`): Hardcodes `'Скопійовано'` and `'Вставлено'` in OSD feedback.
     - `extensions/kiwi@kemma/apps/tahoeNotifications.js:2233,2237`, `tahoeNotificationCard.js:349,399`, `tahoeScreenCast.js:396`, `tahoeQuickSettings.js:3078`, `tahoeControlCenter.js`: Hardcoded Ukrainian strings or missing `en` key (`stage_manager`) causing Ukrainian fallbacks.
     - `extensions/appmenu@ChathurangaBW.github.io/searchDialog.js:361-380`: Uses Ukrainian fallback strings in panel definitions (search `match` aliases should be preserved).
     - `grub/macw1y-boot/theme.txt:35`, `grub/macw1y-boot-usb/theme.txt:35`, `grub/macw1y-boot-usb2/theme.txt:35`: Hardcoded Ukrainian boot countdown text.
     - `bin/mac-boot-config:36,63,88,132,247,249`: Hardcoded Ukrainian notifications and app name.
     - `bin/gnome-control-center:74`, `bin/nautilus:29`, `bin/ptyxis:54`: Hardcoded Ukrainian error messages.
     - `bin/mac-screenshot-process:40`, `bin/mac-airdrop:18`: Hardcoded Ukrainian default directories (`~/Зображення/Знімки екрана`, `~/Завантажене/AirDrop`).
   - **Fix:** Deploy `gnome-control-center-overlay/locales/` in `install.sh`, prefer `locales/en` fallback over Ukrainian base files, localize hardcoded UI strings with English defaults while preserving other languages, native language names, search aliases, and custom user workspace names. Update `config/extensions.lock.json` after extension edits.

5. **Author-specific `/home/vitaliy` paths and account fallbacks**
   - **Files (confirmed via repo-wide grep — 204 occurrences):**
     - `services/org.gnome.Settings.service:3` (`Exec=/home/vitaliy/.local/bin/gnome-control-center --gapplication-service`) — copied verbatim by `install.sh:1327`.
     - `bin/mac-boot-config:55`, `bin/mac-apply-locale:513`, `bin/mac-installer-gui:134`, `bin/mac-sync-applications:1424`, `bin/mac-gdm-bypass:37,76,95,144,155`, `bin/mac-diagnostics:26`, `bin/mac-theme-sync:15`, `bin/mac-integrity-check:46,67`, `bin/mac-graphics-profile:17`, `bin/mac-styling-settings:921`, `bin/mac-widget-picker:7,76`, `bin/update-bms-menubar-blur:2`, `bin/mac-airdrop:11-13,203,234-238,353`, `bin/mac-capcut-fix:13`, `bin/mac-generate-slider-glass.py:281-294`, `bin/mac-build-theme:17,112-113`, `bin/mac-i18n-verify:16`.
     - `systemd/mac-grub-status.service:8`, `applications/launchpad.desktop:8`, `applications/com.mattjakeman.ExtensionManager.desktop:41`, `touchpad/mac-touchpad-daemon.c:60-63`, `touchpad/macw1y-touchpad-gestures@mactheme/gestureImpl.js:55,63,76,92`, `wack-system/src/main/lockscreenMenuBar.js:389-390`, `gnome-control-center-overlay/libmac_settings.c`, `src/mac_terminal.c`, `grub/generate_icons.py`, `grub/patch_grub_keys.py`, `gtk-3.0/bookmarks`, `config/gtk-3.0/bookmarks`, CSS files.
   - **Fix:** Replace author-specific paths with `$HOME`, `os.path.expanduser("~")`, `GLib.get_home_dir()`, dynamic user detection, or `/usr/local/bin` / `/usr/share/mactheme` paths. Never fall back to `"vitaliy"`.

6. **Excessive installer scope, destructive overwrites, and lossy rollback**
   - **Files:** `install.sh`, `libexec/macw1y-uninstall`, `dependencies/check-platform.py`
   - **Confirmed:**
     - `install.sh:1907, 2542` overwrites `/etc/environment` completely (`cat > /etc/environment`).
     - `install.sh:981-1021` imports broad `dconf/gnome-all.dconf` via `dconf load /`, touching unrelated user preferences, workspace names, file-chooser paths, and wallpapers.
     - `install.sh:1969-1990` unconditionally installs fonts, themes, icons, sounds, wallpapers, extensions, settings overlay, native `LD_PRELOAD` libraries, app wrappers, touchpad daemon (`usermod -aG input`, `/etc/bluetooth/main.conf`), gamemode/sysctl/sudoers, GDM theme + `gnome-shell` diversion, Plymouth + initramfs, and GRUB.
     - `install.sh` suppresses many failures (`2>/dev/null || true`) and still prints `COMPLETED SUCCESSFULLY`.
     - `libexec/macw1y-uninstall` blindly runs `rm -rf "$TARGET_HOME/.config/gtk-3.0" "$TARGET_HOME/.config/gtk-4.0"` and `gsettings reset` / `dconf reset -f` instead of restoring recorded original state.
     - `dependencies/check-platform.py` only checks `metadata.json` `shell-version` and prints a message in Ukrainian; it does not check required GSettings schemas/keys, disk space, or privilege requirements.
   - **Fix:**
     - Modularize `install.sh` with independently selectable core components (`--gtk`, `--extensions`, `--icons`, `--fonts`, `--wallpapers`, `--sounds`) and explicit opt-ins for high-impact system modifications (`--with-gdm`, `--with-shell-overlay`, `--with-grub`, `--with-plymouth`, `--with-touchpad`, `--with-wrappers`, `--with-native-libs`, `--with-perf-tweaks`).
     - Add `--dry-run` / `--plan` and preflight checks (GNOME version, schema/key checks, dependencies, privileges, disk space).
     - Implement state manifest recording (`~/.local/state/macw1y/install-manifest.json` + backups) tracking original gsettings values, pre-existing files (with ownership/permissions/symlink targets), newly created files, and touched services/packages.
     - Replace `/etc/environment` overwrite with targeted key updates (only when `--with-perf-tweaks` is explicitly requested).
     - Replace broad `dconf load /` with intentional, scoped settings writes.
     - Update `libexec/macw1y-uninstall` (and rollback logic) to restore recorded original values/files first, report newly introduced items before removal, never blindly delete unrelated user config (`~/.config/gtk-3.0` / `gtk-4.0`), and report partial failures accurately.

---

## 3. Confirmed vs. Assumed

- **Confirmed by repository inspection:** All code defects listed in Section 2, including the exact crash line in `layout.js:233`, missing `"$@"` in `bin/gnome-shell`, missing `locales/` copy in `install.sh`, `99-mactheme` sudoers grant, `/home/vitaliy` references, hardcoded Ukrainian strings, `/etc/environment` overwrite, and destructive `rm -rf ~/.config/gtk-*` in `macw1y-uninstall`.
- **Assumed / requires disposable VM verification:** Runtime behavior of all 21 GNOME Shell extensions under Kali Linux 2026.3 / GNOME Shell 50.5 Wayland, live GDM greeter rendering, Plymouth/GRUB boot flow, and real `dpkg-divert` / `apt` package interactions. These will be explicitly separated in the validation report and VM test plan.
