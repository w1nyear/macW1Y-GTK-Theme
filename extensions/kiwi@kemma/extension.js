/*
 * Kiwi is not Apple – macOS-inspired enhancements for GNOME Shell.
 * Customized for macOS Tahoe Transformation Suite.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { enable as tahoeQuickSettingsEnable, disable as tahoeQuickSettingsDisable } from './apps/tahoeControlCenter.js';
import { enable as tahoeNCEnable, disable as tahoeNCDisable } from './apps/tahoeNotificationCenter.js';
import { enable as tahoeInkEnable, disable as tahoeInkDisable } from './apps/tahoeInk.js';
import { enable as reduceWindowAnimationsEnable, disable as reduceWindowAnimationsDisable } from './apps/reduceWindowAnimations.js';
import { enable as gtkThemeSyncEnable, disable as gtkThemeSyncDisable } from './apps/gtkThemeSync.js';

export default class KiwiExtension extends Extension {
    _resolveDark() {
        try {
            const scheme = this._interfaceSettings?.get_string('color-scheme');
            return scheme === 'prefer-dark';
        } catch (_) {
            return false;
        }
    }

    _on_settings_changed(_key) {
        const gettextFunc = this.gettext ? this.gettext.bind(this) : (m => m);
        try {
            tahoeInkEnable();
        } catch (e) {
            console.warn(`[kiwi] tahoeInkEnable: ${e}`);
        }
        try {
            tahoeNCEnable(this._settings, gettextFunc);
        } catch (e) {
            console.warn(`[kiwi] tahoeNCEnable: ${e}`);
        }
        try {
            tahoeQuickSettingsEnable(this._settings, gettextFunc);
        } catch (e) {
            console.warn(`[kiwi] tahoeQuickSettingsEnable: ${e}`);
        }

        try {
            if (this._settings?.get_boolean('reduce-window-animations'))
                reduceWindowAnimationsEnable();
            else
                reduceWindowAnimationsDisable();
        } catch (_) {}
    }

    enable() {
        try {
            this._settings = this.getSettings('org.gnome.shell.extensions.kiwi');
        } catch (_) {
            this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.kiwi' });
        }
        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed', (_settings, key) => this._on_settings_changed(key));
        }
        try {
            this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        } catch (_) {
            this._interfaceSettings = null;
        }

        try {
            gtkThemeSyncEnable();
        } catch (_) {}

        this._on_settings_changed(null);
    }

    disable() {
        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._interfaceSettings = null;

        try { tahoeQuickSettingsDisable(); } catch (_) {}
        try { tahoeNCDisable(); } catch (_) {}
        try { tahoeInkDisable(); } catch (_) {}
        try { reduceWindowAnimationsDisable(); } catch (_) {}
        try { gtkThemeSyncDisable(); } catch (_) {}

        this._settings = null;
    }
}