/*
 * Kiwi is not Apple – macOS-inspired enhancements for GNOME Shell.
 * Copyright (C) 2025  Arnis Kemlers
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const LG_SCHEMA_ID = 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com';
const LG_UUID = 'liquid-glass@thinkingcoding1231.gmail.com';

function _loadLiquidGlassSettings() {
    try {
        return new Gio.Settings({schema_id: LG_SCHEMA_ID});
    } catch (_) {
        // Schema lives in the other extension's schemas/ dir, not in the
        // default source. Try loading it from there.
    }
    try {
        const dir = GLib.build_filenamev([GLib.get_home_dir(),
            '.local', 'share', 'gnome-shell', 'extensions', LG_UUID, 'schemas']);
        const source = Gio.SettingsSchemaSource.new_from_directory(
            dir, Gio.SettingsSchemaSource.get_default(), false);
        const schema = source?.lookup(LG_SCHEMA_ID, false);
        if (schema)
            return new Gio.Settings({settings_schema: schema});
    } catch (_) {
        // liquid glass not installed
    }
    return null;
}
import { enable as addUsernameEnable, disable as addUsernameDisable } from './apps/addUsernameToQuickMenu.js';
import { enable as moveFullscreenEnable, disable as moveFullscreenDisable } from './apps/moveFullscreenWindow.js';
import { enable as focusLaunchedWindowEnable, disable as focusLaunchedWindowDisable } from './apps/focusLaunchedWindow.js';
import { enable as lockIconEnable, disable as lockIconDisable } from './apps/lockIcon.js';
import { enable as transparentMoveEnable, disable as transparentMoveDisable } from './apps/transparentMove.js';
import { enable as batteryPercentageEnable, disable as batteryPercentageDisable } from './apps/batteryPercentage.js';
import { enable as calendarEnable, disable as calendarDisable } from './apps/calendar.js';
import { enable as windowTitleEnable, disable as windowTitleDisable } from './apps/windowTitle.js';
import { enable as windowControlsEnable, disable as windowControlsDisable } from './apps/windowControls.js';
import { enable as panelHoverEnable, disable as panelHoverDisable } from './apps/panelHover.js';
import { enable as panelTransparencyEnable, disable as panelTransparencyDisable } from './apps/panelTransparency.js';
import { enable as panelGradientEnable, disable as panelGradientDisable } from './apps/panelGradient.js';
import { enable as panelStylingEnable, disable as panelStylingDisable, enableMenus as popupStylingEnable, disableMenus as popupStylingDisable } from './apps/panelStyling.js';
import { enable as hideMinimizedWindowsEnable, disable as hideMinimizedWindowsDisable } from './apps/hideMinimizedWindows.js';
import { enable as gtkThemeManagerEnable, disable as gtkThemeManagerDisable } from './apps/gtkThemeManager.js';
import { enable as firefoxThemeManagerEnable, disable as firefoxThemeManagerDisable } from './apps/firefoxThemeManager.js';
import { enable as thunderbirdThemeManagerEnable, disable as thunderbirdThemeManagerDisable } from './apps/thunderbirdThemeManager.js';
import { enable as hideActivitiesButtonEnable, disable as hideActivitiesButtonDisable } from './apps/hideActivitiesButton.js';
import { enable as polkitDialogEnable, disable as polkitDialogDisable } from './apps/polkitDialog.js';
import { enable as overviewWallpaperEnable, disable as overviewWallpaperDisable, refresh as overviewWallpaperRefresh } from './apps/overviewWallpaper.js';
import { enable as overviewSeamlessZoomEnable, disable as overviewSeamlessZoomDisable } from './apps/overviewSeamlessZoom.js';
import { enable as overviewMissionControlEnable, disable as overviewMissionControlDisable } from './apps/overviewMissionControl.js';
import { enable as skipOverviewEnable, disable as skipOverviewDisable } from './apps/skipOverviewOnLogin.js';
import { enable as quickSettingsNotificationsEnable, disable as quickSettingsNotificationsDisable } from './apps/quickSettingsNotifications.js';
import { enable as quickSettingsCirclesEnable, disable as quickSettingsCirclesDisable } from './apps/quickSettingsCircles.js';
import { enable as tahoeQuickSettingsEnable, disable as tahoeQuickSettingsDisable } from './apps/tahoeQuickSettings.js';
import { enable as quickSettingsMediaEnable, disable as quickSettingsMediaDisable } from './apps/quickSettingsMedia.js';
import { enable as keyboardIndicatorEnable, disable as keyboardIndicatorDisable } from './apps/keyboardIndicator.js';
import { enable as launchpadAppEnable, disable as launchpadAppDisable } from './apps/launchpadApp.js';
import { enable as tahoeAppsEnable, disable as tahoeAppsDisable } from './apps/tahoeApps.js';
import { enable as dockBlurEnable, disable as dockBlurDisable } from './apps/dockBlur.js';
import { enable as dockStylingEnable, disable as dockStylingDisable } from './apps/dockStyling.js';
import { enable as dockColorsEnable, disable as dockColorsDisable } from './apps/dockColors.js';
import { enable as minimizedToDockEnable, disable as minimizedToDockDisable } from './apps/minimizedToDock.js';
import { enable as downloadsStackEnable, disable as downloadsStackDisable } from './apps/downloadsStack.js';
import { enable as reduceWindowAnimationsEnable, disable as reduceWindowAnimationsDisable } from './apps/reduceWindowAnimations.js';
import { enableDragRestore, disableDragRestore } from './apps/windowTiling.js';
import { dockActive, isDockExtension } from './apps/dockUtils.js';
import { enable as topbarClockEnable, disable as topbarClockDisable } from './apps/topbarClock.js';
import { enable as quickSettingsButtonEnable, disable as quickSettingsButtonDisable } from './apps/quickSettingsButton.js';
import { enable as topbarButtonsEnable, disable as topbarButtonsDisable } from './apps/topbarButtons.js';
import { enable as topbarBlurEnable, disable as topbarBlurDisable } from './apps/topbarBlur.js';
import { enable as tahoeOSDEnable, disable as tahoeOSDDisable } from './apps/tahoeOSD.js';
import { enable as tahoeNCEnable, disable as tahoeNCDisable } from './apps/tahoeNotifications.js';
import { enable as tahoeInkEnable, disable as tahoeInkDisable } from './apps/tahoeInk.js';
import { enable as topbarStatusIconsEnable, disable as topbarStatusIconsDisable } from './apps/topbarStatusIcons.js';
import { enable as gtkThemeSyncEnable, disable as gtkThemeSyncDisable } from './apps/gtkThemeSync.js';

export default class KiwiExtension extends Extension {
    // Dock glass follows the launchpad theme: white tint in light mode,
    // dark tint in dark mode.
    _applyDockGlassTint() {
        const dark = this._resolveDark();
        try {
            if (!this._glassSettings)
                this._glassSettings = _loadLiquidGlassSettings();
            if (!this._glassSettings)
                return;
            const want = dark ? '#2e2e33' : '#ffffff';
            if (this._glassSettings.get_string('dock-tint-color') !== want)
                this._glassSettings.set_string('dock-tint-color', want);
            const wantStrength = dark ? 0.35 : 0.12;
            if (this._glassSettings.get_double('dock-tint-strength') !== wantStrength)
                this._glassSettings.set_double('dock-tint-strength', wantStrength);
        } catch (e) {
            // liquid glass not installed
            this._glassSettings = null;
        }
        // Running dots: dark in light theme, white in dark theme.
        try {
            if (!this._dockSettings) {
                this._dockSettings = new Gio.Settings({
                    schema_id: 'org.gnome.shell.extensions.dash2dock-motion',
                });
            }
            if (!this._dockSettings.get_boolean('custom-theme-customize-running-dots'))
                this._dockSettings.set_boolean('custom-theme-customize-running-dots', true);
            const wantDot = dark ? '#ffffff' : '#3a3a3c';
            if (this._dockSettings.get_string('custom-theme-running-dots-color') !== wantDot)
                this._dockSettings.set_string('custom-theme-running-dots-color', wantDot);
        } catch (e) {
            // dock not installed
        }
    }

    _resolveDark() {
        try {
            const mode = this._settings.get_string('tahoe-theme');
            if (mode === 'dark')
                return true;
            if (mode === 'light')
                return false;
            const scheme = this._interfaceSettings.get_string('color-scheme');
            const gtkTheme = (this._interfaceSettings.get_string('gtk-theme') || '');
            // Known-light theme even under a dark scheme (e.g. picked in Tweaks).
            const themeIsLight = (/light/i.test(gtkTheme) && !/dark/i.test(gtkTheme)) ||
                gtkTheme === 'Adwaita' || gtkTheme === 'Default';
            if (scheme === 'prefer-light')
                return false;
            if (scheme === 'prefer-dark')
                return !themeIsLight;
            // 'default' is GNOME's light: an explicit dark needs prefer-dark.
            return false;
        } catch (e) {
            return false;
        }
    }

    // Terminal follows too: macOS Gray / macOS Light pair swap.
    // Anything else the user picked stays untouched.
    _applyTerminalTheme() {
        const dark = this._resolveDark();
        try {
            const ptyxis = new Gio.Settings({schema_id: 'org.gnome.Ptyxis'});
            const uuid = ptyxis.get_string('default-profile-uuid');
            if (!uuid)
                return;
            const profile = new Gio.Settings({
                schema_id: 'org.gnome.Ptyxis.Profile',
                path: `/org/gnome/Ptyxis/Profiles/${uuid}/`,
            });
            const cur = profile.get_string('palette');
            const want = dark ? 'macOS Gray' : 'macOS Light';
            if ((cur === 'macOS Gray' || cur === 'macOS Light') && cur !== want)
                profile.set_string('palette', want);
        } catch (e) {
            // ptyxis not around
        }
    }

    _on_settings_changed(key) {
        const gettextFunc = this.gettext.bind(this);

        // Ensure all Kiwi modules that interfere with topbar, dock, or shell UI are dismantled
        try { topbarClockDisable(); } catch (_) {}
        try { quickSettingsButtonDisable(); } catch (_) {}
        try { topbarButtonsDisable(); } catch (_) {}
        try { topbarBlurDisable(); } catch (_) {}
        try { topbarStatusIconsDisable(); } catch (_) {}
        try { keyboardIndicatorDisable(); } catch (_) {}
        try { windowControlsDisable(); } catch (_) {}
        try { windowTitleDisable(); } catch (_) {}
        try { disableDragRestore(); } catch (_) {}
        try { moveFullscreenDisable(); } catch (_) {}
        try { addUsernameDisable(); } catch (_) {}
        try { lockIconDisable(); } catch (_) {}
        try { transparentMoveDisable(); } catch (_) {}
        try { batteryPercentageDisable(); } catch (_) {}
        try { calendarDisable(); } catch (_) {}
        try { panelHoverDisable(); } catch (_) {}
        try { panelTransparencyDisable(); } catch (_) {}
        try { panelGradientDisable(); } catch (_) {}
        try { panelStylingDisable(); } catch (_) {}
        try { popupStylingDisable(); } catch (_) {}
        try { hideActivitiesButtonDisable(); } catch (_) {}
        try { hideMinimizedWindowsDisable(); } catch (_) {}
        try { polkitDialogDisable(); } catch (_) {}
        try { overviewWallpaperDisable(); } catch (_) {}
        try { overviewSeamlessZoomDisable(); } catch (_) {}
        try { overviewMissionControlDisable(); } catch (_) {}
        try { skipOverviewDisable(); } catch (_) {}
        try { quickSettingsMediaDisable(); } catch (_) {}
        try { quickSettingsNotificationsDisable(); } catch (_) {}
        try { quickSettingsCirclesDisable(); } catch (_) {}
        try { tahoeAppsDisable(); } catch (_) {}
        try { launchpadAppDisable(); } catch (_) {}
        try { dockBlurDisable(); } catch (_) {}
        try { dockStylingDisable(); } catch (_) {}
        try { dockColorsDisable(); } catch (_) {}
        try { downloadsStackDisable(); } catch (_) {}
        try { minimizedToDockDisable(); } catch (_) {}
        try { reduceWindowAnimationsDisable(); } catch (_) {}
        try { gtkThemeSyncDisable(); } catch (_) {}
        try { firefoxThemeManagerDisable(); } catch (_) {}
        try { thunderbirdThemeManagerDisable(); } catch (_) {}

        // ONLY enable the user-requested friend Tahoe components:
        // 1. Control Center (Tahoe Quick Settings)
        // 2. Notification Center (Tahoe Notifications)
        // 3. Window Control Buttons (GTK Theme Manager)
        // 4. Tahoe Ink & OSD
        try { tahoeInkEnable(); } catch (_) {}
        try { tahoeOSDEnable(); } catch (_) {}
        try { tahoeNCEnable(this._settings, gettextFunc); } catch (_) {}
        try { tahoeQuickSettingsEnable(this._settings, gettextFunc); } catch (_) {}
        try { gtkThemeManagerEnable(this); } catch (_) {}
    }

    _applyBatteryPercentage() {
        try { batteryPercentageDisable(); } catch (_) {}
    }

    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => this._on_settings_changed(key));
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._on_settings_changed(null);
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._batteryPercentageChangedId) {
            this._interfaceSettings.disconnect(this._batteryPercentageChangedId);
            this._batteryPercentageChangedId = null;
        }
        if (this._colorSchemeChangedId) {
            try {
                this._interfaceSettings.disconnect(this._colorSchemeChangedId);
            } catch (e) {
                // gone
            }
            this._colorSchemeChangedId = null;
        }
        if (this._gtkThemeChangedId) {
            try {
                this._interfaceSettings.disconnect(this._gtkThemeChangedId);
            } catch (e) {
                // gone
            }
            this._gtkThemeChangedId = null;
        }
        if (this._dockStateChangedId) {
            Main.extensionManager.disconnect(this._dockStateChangedId);
            this._dockStateChangedId = null;
        }
        this._interfaceSettings = null;
        moveFullscreenDisable();
        addUsernameDisable();
        focusLaunchedWindowDisable();
        lockIconDisable();
        transparentMoveDisable();
        batteryPercentageDisable();
        calendarDisable();
        windowTitleDisable();
        windowControlsDisable();
        panelHoverDisable();
        panelTransparencyDisable();
        panelGradientDisable();
        panelStylingDisable();
        popupStylingDisable();
        hideMinimizedWindowsDisable();
        hideActivitiesButtonDisable();
        overviewWallpaperDisable();
        overviewSeamlessZoomDisable();
        overviewMissionControlDisable();
        polkitDialogDisable();
        skipOverviewDisable();
        keyboardIndicatorDisable();
        gtkThemeManagerDisable();
        firefoxThemeManagerDisable();
        thunderbirdThemeManagerDisable();
        quickSettingsMediaDisable();
        quickSettingsNotificationsDisable();
        quickSettingsCirclesDisable();
        tahoeQuickSettingsDisable();
        tahoeAppsDisable();
        launchpadAppDisable();
        dockBlurDisable();
        dockStylingDisable();
        dockColorsDisable();
        // The stack borrows the minimized strip and holds a signal on it, so it
        // has to let go before that strip is destroyed
        downloadsStackDisable();
        minimizedToDockDisable();
        reduceWindowAnimationsDisable();
        disableDragRestore();
        quickSettingsButtonDisable();
        topbarButtonsDisable();
        tahoeInkDisable();
        topbarBlurDisable();
        tahoeOSDDisable();
        tahoeNCDisable();
        topbarStatusIconsDisable();
        topbarClockDisable();
        gtkThemeSyncDisable();
        this._settings = null;
    }
}