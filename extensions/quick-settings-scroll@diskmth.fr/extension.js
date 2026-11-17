// SPDX-FileCopyrightText: 2026 Disk_MTH
// SPDX-License-Identifier: GPL-2.0-or-later








import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { QuickSettingsScroll } from './lib/quick-settings-scroll.js';

export default class QuickSettingsScrollExtension extends Extension {
    enable() {
        this._patch = new QuickSettingsScroll();
        this._patch.apply();
    }

    disable() {


        this._patch.revert();
        this._patch = null;
    }
}
