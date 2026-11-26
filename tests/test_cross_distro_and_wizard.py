import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


class TestCrossDistroAndWizard(unittest.TestCase):
    def test_gschema_override_sets_wallpaper_zoom(self):
        override = (ROOT / "macw1y-gdm" / "99_mactheme.gschema.override").read_text(encoding="utf-8")
        self.assertIn("picture-uri = 'file:///usr/share/backgrounds/GoldenGate_Day.jpg'", override)
        self.assertIn("picture-uri-dark = 'file:///usr/share/backgrounds/GoldenGate_Day.jpg'", override)
        self.assertIn("picture-options = 'zoom'", override)

    def test_install_sh_supports_cross_distro_dbus_and_ensure_extensions(self):
        install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("dbus-run-session", install_sh)
        self.assertIn("picture-options 'zoom'", install_sh)
        self.assertIn("/etc/xdg/autostart/mac-ensure-extensions.desktop", install_sh)
        for pkg_file in ("apt-packages.txt", "dnf-packages.txt", "pacman-packages.txt"):
            txt = (ROOT / "dependencies" / pkg_file).read_text(encoding="utf-8")
            self.assertIn("gettext", txt)
            self.assertIn("zenity", txt)

    def test_ensure_extensions_checks_wallpaper(self):
        ensure_sh = (ROOT / "bin" / "mac-ensure-extensions.sh").read_text(encoding="utf-8")
        self.assertIn("GoldenGate_Day.jpg", ensure_sh)
        self.assertIn("picture-options", ensure_sh)

    def test_no_hardcoded_vitaliy_in_locale_and_blur_scripts(self):
        apply_locale = (ROOT / "bin" / "mac-apply-locale").read_text(encoding="utf-8")
        self.assertNotIn("/home/vitaliy", apply_locale)
        self.assertIn("_macDesktopWidgetsController", apply_locale)
        blur_script = (ROOT / "bin" / "update-bms-menubar-blur").read_text(encoding="utf-8")
        self.assertNotIn("/home/vitaliy", blur_script)

    def test_desktop_widgets_dynamic_locale_and_wizard_hooks(self):
        ext_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macDesktopWidgetsController", ext_js)
        self.assertIn("updateLocale(", ext_js)
        self.assertIn("hideForWizard(", ext_js)
        self.assertIn("showFromWizardAnimated(", ext_js)
        cal_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "widgets" / "calendar" / "widget.js").read_text(encoding="utf-8")
        self.assertIn("getModpackIntlLocale", cal_js)
        weather_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "widgets" / "weather" / "widget.js").read_text(encoding="utf-8")
        self.assertIn("getModpackIntlLocale", weather_js)

    def test_setup_wizard_language_pill_and_sync_restore(self):
        wizard_js = (ROOT / "extensions" / "eval-helper@mactheme" / "macSetupWizard.js").read_text(encoding="utf-8")
        self.assertIn("_showLanguageChangePill", wizard_js)
        self.assertIn("applyModpackSystemLocaleAsync", wizard_js)
        self.assertIn("Зміна мови", wizard_js)
        self.assertIn("_restoreDesktop(true)", wizard_js)

    def test_gnome51_offscreen_glass_and_unlock_hooks(self):
        glass_js = (ROOT / "extensions" / "desktop-widgets@r3nhick" / "lib" / "glass.js").read_text(encoding="utf-8")
        self.assertIn("USE_OFFSCREEN_SHADER_COMPAT", glass_js)
        self.assertIn("defineOffscreenShaderEffectCompat", glass_js)
        self.assertIn("Clutter.PipelineNode.new", glass_js)
        menubar_js = (ROOT / "extensions" / "blur-my-shell@aunetx" / "components" / "menubar_v29.js").read_text(encoding="utf-8")
        self.assertIn("_hoverGlideDisposed", menubar_js)
        self.assertIn("_menuManagerAddWrapper", menubar_js)
        eval_js = (ROOT / "extensions" / "eval-helper@mactheme" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macGlideDisposed", eval_js)
        self.assertIn("_macGlideAddWrapper", eval_js)

    def test_debian_fedora_gdm_and_dnf_optimization(self):
        install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("update-alternatives --query gdm-theme.gresource", install_sh)
        self.assertIn("/usr/share/gdm/greeter-dconf-defaults", install_sh)
        deps_sh = (ROOT / "dependencies" / "install-deps.sh").read_text(encoding="utf-8")
        self.assertIn("install_weak_deps=False", deps_sh)
        self.assertIn("rpm -q", deps_sh)

    def test_extension_update_guard_prevents_ego_overwrites(self):
        eval_js = (ROOT / "extensions" / "eval-helper@mactheme" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_setupExtensionUpdateGuard", eval_js)
        self.assertIn("updatesSupported", eval_js)
        ensure_sh = (ROOT / "bin" / "mac-ensure-extensions.sh").read_text(encoding="utf-8")
        self.assertIn("extension-updates/$ext", ensure_sh)

    def test_boot_gdm_and_synchronized_desktop_startup(self):
        pro_js = (ROOT / "extensions" / "wack-lockscreen-clock@rinzler69-wastaken.github.com" / "src" / "pro" / "pro.js").read_text(encoding="utf-8")
        self.assertIn("_ensureBootCover", pro_js)
        self.assertIn("_scheduleBootReveal", pro_js)
        self.assertIn("waitingForSingleAutoSelect", pro_js)
        self.assertIn("macw1y-boot/logo.png", pro_js)
        self.assertIn("macBootLogoOverlay", pro_js)
        layout_js = (ROOT / "gnome-shell-overlay" / "ui" / "layout.js").read_text(encoding="utf-8")
        self.assertIn("_macStartupManaged", layout_js)
        self.assertIn("_macDockRevealActive", layout_js)
        self.assertIn("checkDing", layout_js)
        self.assertIn("macw1y-boot/logo.png", layout_js)
        self.assertIn("macBootLogoOverlay", layout_js)
        self.assertIn("dc._dock || dc", layout_js)
        self.assertIn("_macWinGroupChildAddedId", layout_js)
        self.assertIn("STARTUP_TIMEOUT_MS = 12000", layout_js)
        eval_js = (ROOT / "extensions" / "eval-helper@mactheme" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macStartupManaged", eval_js)
        self.assertIn("_macDockRevealActive", eval_js)
        self.assertIn("_macTrashReady", eval_js)
        self.assertIn("suppressStartupOverview", eval_js)
        self.assertIn("runMacStartupSession", eval_js)
        self.assertIn("dc._dock || dc", eval_js)
        self.assertIn("_macWinGroupChildAddedId", eval_js)
        self.assertIn("STARTUP_TIMEOUT_MS = 12000", eval_js)
        install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("start-in-overview false", install_sh)
        self.assertIn("/usr/share/gnome-shell/extensions/ding@rastersoft.com", install_sh)
        kiwi_js = (ROOT / "extensions" / "kiwi@kemma" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("_macKiwiReady", kiwi_js)
        ding_js = (ROOT / "extensions" / "ding@rastersoft.com" / "extension.js").read_text(encoding="utf-8")
        self.assertNotIn("Main.layoutManager.connect('startup-complete'", ding_js)
        ding_schema = (ROOT / "extensions" / "ding@rastersoft.com" / "schemas" / "org.gnome.shell.extensions.ding.gschema.xml").read_text(encoding="utf-8")
        self.assertNotIn('<key type="b" name="show-trash">\n        <default>true</default>', ding_schema)
        self.assertNotIn('<key type="b" name="show-volumes">\n        <default>true</default>', ding_schema)
        dconf_txt = (ROOT / "dconf" / "gnome-all.dconf").read_text(encoding="utf-8")
        self.assertIn("show-trash=false", dconf_txt)
        self.assertIn("show-volumes=false", dconf_txt)
        backdrop_js = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "rendering" / "backdropGlass.js").read_text(encoding="utf-8")
        self.assertIn("modalDialogGroup", backdrop_js)
        self.assertIn("stylesApplied", eval_js)
        self.assertIn("isPromptDialog", eval_js)
        popup_targets = (ROOT / "extensions" / "blur-my-shell@aunetx" / "components" / "popup" / "targets.js").read_text(encoding="utf-8")
        self.assertIn("mac-empty-trash-dialog", popup_targets)
        self.assertIn("_macDlgGlassState", popup_targets)
        liq_js = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "liquidEffect.js").read_text(encoding="utf-8")
        self.assertIn("this._multiRegion ? Math.min(rawReach, 22) : rawReach", liq_js)
        liq_ts = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "src" / "liquidEffect.ts").read_text(encoding="utf-8")
        self.assertIn("this._multiRegion ? Math.min(rawReach, 22) : rawReach", liq_ts)
        cc_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "tahoeControlCenter.js").read_text(encoding="utf-8")
        self.assertIn("const CLIP_PADDING = 200;", cc_js)
        notif_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "tahoeNotifications.js").read_text(encoding="utf-8")
        self.assertIn("Math.max(SHADER_PADDING + 48, 80)", notif_js)
        bms_notif_js = (ROOT / "extensions" / "blur-my-shell@aunetx" / "components" / "notifications_v4.js").read_text(encoding="utf-8")
        self.assertIn("const P = 80;", bms_notif_js)
        self.assertIn("_hasCompletedColdBootSplash", pro_js)
        self.assertIn("_hasCompletedColdBootSplash", layout_js)
        self.assertIn(".macw1y_session_", eval_js)
        appmenu_ext = (ROOT / "extensions" / "appmenu@ChathurangaBW.github.io" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("Main.wm._allowedKeybindings?.['search-shortcut']", appmenu_ext)
        self.assertNotIn("tracker.connectObject?.('visibility-changed'", appmenu_ext)
        search_dialog = (ROOT / "extensions" / "appmenu@ChathurangaBW.github.io" / "searchDialog.js").read_text(encoding="utf-8")
        self.assertNotIn("get_pointer_visible() === false", search_dialog)
        self.assertNotIn("ext.stateObj._settings.set_strv('search-shortcut', ['<Control>space', '<Primary>space']);\n                } catch (_) {}\n\n                const isSpotlightBlocked", eval_js)
        menubar_js = (ROOT / "extensions" / "blur-my-shell@aunetx" / "components" / "menubar_v29.js").read_text(encoding="utf-8")
        self.assertIn("mac-privacy-cam.svg", menubar_js)
        self.assertIn("_pollCameraDevices", menubar_js)
        self.assertIn("margin: 0 9px 0 0 !important;", menubar_js)
        self.assertIn("this._fadeGen", menubar_js)
        tbo_js = (ROOT / "extensions" / "top-bar-organizer@julian.gse.jsts.xyz" / "extension.js").read_text(encoding="utf-8")
        self.assertIn('Main.panel.statusArea["macPrivacy"]', tbo_js)

    def test_about_this_mac_dialog_and_hwinfo_integration(self):
        file_actions = (ROOT / "extensions" / "appmenu@ChathurangaBW.github.io" / "actions" / "fileActions.js").read_text(encoding="utf-8")
        self.assertIn("launchAboutThisMac", file_actions)
        self.assertIn("'about-this-system': () => launchAboutThisMac()", file_actions)
        mac_about = (ROOT / "bin" / "mac-about").read_text(encoding="utf-8")
        self.assertIn("https://github.com/w1nyear/macW1Y-GTK-Theme", mac_about)
        self.assertIn("GNU GPL v3", mac_about)
        self.assertIn("about-laptop.png", mac_about)
        self.assertIn("about-desktop.png", mac_about)
        self.assertIn("open_system_about", mac_about)
        self.assertIn("make_traffic_dot", mac_about)
        self.assertIn("find_windows_assets_dir", mac_about)
        self.assertIn("mac-wc-muted", mac_about)
        self.assertIn('make_traffic_dot("minimize")', mac_about)
        self.assertIn("STYLE_PROVIDER_PRIORITY_USER", mac_about)

    def test_dock_glass_slides_and_fades_in_sync_during_hide(self):
        dock_mgr_js = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "dockManager.js").read_text(encoding="utf-8")
        self.assertIn("const isSlideAnimating = Boolean(d2d && (isD2DTransitioning || slideX < 0.999));", dock_mgr_js)
        self.assertIn("Math.round(baseOpacity * slideX)", dock_mgr_js)
        self.assertNotIn("if (d2d && d2d._dockState === 1  ) {\n            return false;\n        }", dock_mgr_js)
        dock_mgr_ts = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "src" / "dockManager.ts").read_text(encoding="utf-8")
        self.assertIn("const isSlideAnimating = Boolean(d2d && (isD2DTransitioning || slideX < 0.999));", dock_mgr_ts)
        docking_js = (ROOT / "extensions" / "dash2dock-motion@unmade.space" / "docking.js").read_text(encoding="utf-8")
        self.assertIn("globalThis._liquidGlassDockSync?.()", docking_js)
        self.assertNotIn("glassBg.ease({", docking_js)
        mac_hwinfo = (ROOT / "bin" / "mac-hwinfo").read_text(encoding="utf-8")
        self.assertIn("/run/macw1y", mac_hwinfo)
        self.assertIn("product_serial", mac_hwinfo)
        gcc_wrap = (ROOT / "bin" / "gnome-control-center").read_text(encoding="utf-8")
        self.assertIn('"$1" = "system" ] && [ "$2" = "about"', gcc_wrap)
        self.assertTrue((ROOT / "assets" / "icons" / "about-laptop.png").is_file())
        self.assertTrue((ROOT / "assets" / "icons" / "about-desktop.png").is_file())
        self.assertTrue((ROOT / "systemd" / "mac-hwinfo.service").is_file())
        self.assertTrue((ROOT / "applications" / "org.macw1y.About.desktop").is_file())
        install_sh = (ROOT / "install.sh").read_text(encoding="utf-8")
        self.assertIn("mac-hwinfo.service", install_sh)
        self.assertIn("mac-about", install_sh)

    def test_cc_and_nc_glass_refresh_on_backdrop_and_pixel_updates(self):
        glass_gate = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "glassGate.js").read_text(encoding="utf-8")
        self.assertIn("const bg = lm?._backgroundGroup ?? lm?.backgroundGroup;", glass_gate)
        self.assertIn("noteNonWindowContentDamaged", glass_gate)
        self.assertIn("_nonWindowDamageVersion", glass_gate)
        self.assertIn("org.gnome.desktop.background", glass_gate)
        self.assertIn("_hookBgChild", glass_gate)
        self.assertIn("const nonWinDmgChanged = (st.lastNonWindowDamage !== nonWinDmg);", glass_gate)

        cc_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "tahoeControlCenter.js").read_text(encoding="utf-8")
        self.assertIn("_invalidateCCGlass", cc_js)
        self.assertIn("addGlassWakeListener(glass.wakeUnsub)", cc_js)
        self.assertIn("removeGlassWakeListener?.(g.wakeUnsub)", cc_js)
        self.assertIn("_finishCCPanelOpen", cc_js)
        self.assertIn("_CC_IDLE_PULSE_US", cc_js)

        nc_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "tahoeNotifications.js").read_text(encoding="utf-8")
        self.assertIn("_invalidateNcStacks", nc_js)
        self.assertIn("_hookNcWake", nc_js)
        self.assertIn("_unhookNcWake(p)", nc_js)
        self.assertIn("_NC_IDLE_PULSE_US", nc_js)
        self.assertIn("'background'", nc_js)

    def test_three_plus_line_smooth_fillet_selection_pill(self):
        nautilus_c = (ROOT / "src" / "mac_nautilus.c").read_text(encoding="utf-8")
        self.assertIn("mac_draw_smooth_multiline_pill", nautilus_c)
        self.assertIn("mac_snap_edge_runs", nautilus_c)
        self.assertIn("i < n_lines - 1", nautilus_c)
        self.assertIn("i = n_lines - 2; i >= 0; i--", nautilus_c)

        for rel in (
            ROOT / "extensions" / "ding@rastersoft.com" / "app" / "desktopIconItem.js",
            ROOT / "extensions" / "ding-patches" / "desktopIconItem.js",
        ):
            ding_js = rel.read_text(encoding="utf-8")
            self.assertIn("snapEdgeRuns", ding_js)
            self.assertIn("clampFillet", ding_js)
            self.assertIn("i < n - 1", ding_js)
            self.assertIn("i = n - 2; i >= 0; i--", ding_js)

    def test_alttab_switcher_scaled_1_5x_proportional(self):
        eval_js = (ROOT / "extensions" / "eval-helper@mactheme" / "extension.js").read_text(encoding="utf-8")
        self.assertIn("iconSize: 67", eval_js)
        self.assertIn("padding: 9", eval_js)
        self.assertIn("spacing: 12", eval_js)
        self.assertIn("radius: 34", eval_js)
        self.assertIn("_macCalcAltTabMetrics", eval_js)
        self.assertIn("return [m.totalH, m.totalH];", eval_js)
        self.assertNotIn("const totalH = 82;", eval_js)

        styling_json = (ROOT / "config" / "mac-styling" / "styling.json").read_text(encoding="utf-8")
        self.assertIn('"alttab_icon_size": 67', styling_json)
        self.assertIn('"alttab_radius": 34', styling_json)

        styling_ui = (ROOT / "bin" / "mac-styling-settings").read_text(encoding="utf-8")
        self.assertIn("self.alttab_icon_size = 67", styling_ui)
        self.assertIn("32, 120", styling_ui)

    def test_fullscreen_exit_drag_preserves_shrink_animation(self):
        wm_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "macWindowManagement.js").read_text(encoding="utf-8")
        self.assertIn("_fullscreenAnimWrapper", wm_js)
        self.assertIn("_destroyFullscreenAnimClone", wm_js)
        self.assertIn("_fullscreenAnimWrapper.set_position(targetX, targetY)", wm_js)
        self.assertNotIn("_fsDragState.win._fullscreenAnimClone.remove_all_transitions()", wm_js)
        self.assertIn("if (win._macExitingFullscreen)", wm_js)

    def test_glass_damage_avoids_forced_settle_loop_and_ui_rescan(self):
        glass_gate = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "glassGate.js").read_text(encoding="utf-8")
        self.assertIn("export const GLASS_REFRESH_PIXEL_INTERVAL_US", glass_gate)
        self.assertIn("export function glassMarkDirty", glass_gate)
        self.assertIn("export function glassNeedsStructureSync", glass_gate)
        self.assertIn("lastRefreshStructural", glass_gate)
        self.assertIn("lastDamageCheckUs", glass_gate)

        utils_js = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "utils.js").read_text(encoding="utf-8")
        self.assertIn("_matchesUiSnapshot", utils_js)
        self.assertIn("_refreshDirty", utils_js)
        self.assertIn("glassMarkDirty", utils_js)
        self.assertIn("glassNeedsStructureSync", utils_js)

        bg_js = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "rendering" / "backdropGlass.js").read_text(encoding="utf-8")
        self.assertIn("glassMarkDirty?.(this);", bg_js)
        self.assertIn("glassNeedsStructureSync?.(this)", bg_js)
        self.assertNotIn("this._effect?.markBackdropDirty?.();\n                this.wakeFrameSync?.();", bg_js)

        cc_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "tahoeControlCenter.js").read_text(encoding="utf-8")
        self.assertIn("_markCCGlassPixelDirty", cc_js)
        self.assertIn("glassNeedsStructureSync(s.bgActor)", cc_js)
        self.assertIn("s.liquidBox?.queue_redraw?.();", cc_js)
        self.assertIn("s.bgActor?.queue_redraw?.();", cc_js)
        self.assertNotIn("_CC_PIXEL_PULSE_US = 350000", cc_js)

        nc_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "tahoeNotifications.js").read_text(encoding="utf-8")
        self.assertIn("_markNcStacksPixelDirty", nc_js)
        self.assertIn("glassNeedsStructureSync(s.bgActor)", nc_js)
        self.assertIn("s.liquidBox?.queue_redraw?.();", nc_js)
        self.assertNotIn("_NC_PIXEL_PULSE_US = 350000", nc_js)

    def test_dock_label_tracks_magnified_launch_bounce_distance(self):
        anim_js = (ROOT / "extensions" / "cupertino-dock-lite@rinzler69-wastaken.github.com" / "animator.js").read_text(encoding="utf-8")
        self.assertIn("_getAncestorScale", anim_js)
        self.assertIn("_syncLabelTranslation", anim_js)
        self.assertIn("(jY * srcSy) / dstSy", anim_js)
        self.assertIn("this._syncLabelTranslation(icon, realIcon, jX, jY);", anim_js)

        d2d_icons = (ROOT / "extensions" / "dash2dock-motion@unmade.space" / "appIcons.js").read_text(encoding="utf-8")
        self.assertIn("dir * travel * effScale", d2d_icons)
        self.assertIn("label._blurActor, label._blurArrowActor", d2d_icons)
        self.assertIn("const iconActor = visual?.first_child;", d2d_icons)

    def test_gaming_overview_launchpad_and_dock_hover_responsiveness(self):
        gm_py = (ROOT / "bin" / "mac-gamemode").read_text(encoding="utf-8")
        self.assertIn("COMPOSITOR_NAMES", gm_py)
        self.assertIn("'vm.swappiness': '25'", gm_py)
        self.assertIn("os.setpriority(os.PRIO_PROCESS, pid, -18)", gm_py)
        self.assertIn("_proc_opt_cache", gm_py)

        glass_gate = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "glassGate.js").read_text(encoding="utf-8")
        self.assertIn("export function isOverviewAnimating()", glass_gate)
        self.assertIn("_overviewAnimUntilUs", glass_gate)

        dock_js = (ROOT / "extensions" / "liquid-glass@thinkingcoding1231.gmail.com" / "dist" / "dockManager.js").read_text(encoding="utf-8")
        self.assertIn("isOverviewAnimating", dock_js)
        self.assertIn("glassNeedsStructureSync", dock_js)
        self.assertIn("glassMarkDirty", dock_js)

        apps_js = (ROOT / "extensions" / "kiwi@kemma" / "apps" / "tahoeApps.js").read_text(encoding="utf-8")
        self.assertIn("_reopenCached", apps_js)
        self.assertIn("_scheduleOpenAnimation", apps_js)
        self.assertIn("this._animatingOpen", apps_js)
        self.assertIn("glassRefreshDue", apps_js)


if __name__ == "__main__":
    unittest.main()
