// SPDX-FileCopyrightText: 2026 Disk_MTH
// SPDX-License-Identifier: GPL-2.0-or-later

// Quick Settings Scroll entry point.
// GNOME Shell 49-51 (ESM extensions API).
//
// The whole extension is one patch applied to a menu the shell owns, so this
// file is only its lifecycle: build it on enable, undo it on disable. There
// is no state to keep, nothing to poll and no settings to read.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { QuickSettingsScroll } from './lib/quick-settings-scroll.js';

export default class QuickSettingsScrollExtension extends Extension {
    enable() {
        this._patch = new QuickSettingsScroll();
        this._patch.apply();
    }

    disable() {
        // The menu outlives us -- it is the shell's, and it is still there
        // after disable() -- so the patch has to come off, not merely stop.
        this._patch.revert();
        this._patch = null;
    }
}
