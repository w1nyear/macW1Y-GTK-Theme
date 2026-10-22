// SPDX-License-Identifier: GPL-3.0-or-later
// Adds a 5px hardware-accelerated rounded blur effect to dock labels and overview window captions.

import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let Blur = null;
try {
    Blur = (await import('gi://Blur')).default;
} catch (_) {}

let WindowPreview = null;
try {
    const wpMod = await import('resource:///org/gnome/shell/ui/windowPreview.js');
    WindowPreview = wpMod.WindowPreview;
} catch (_) {}

const EFFECT_NAME = 'tahoe-label-blur';
let childAddedId = 0;
let overviewShowingId = 0;
let origWpInit = null;

export function applyLabelBlur(actor) {
    if (!actor || !actor.add_effect)
        return;

    try {
        const effects = actor.get_effects ? actor.get_effects() : [];
        if (effects.some(e => e.name === EFFECT_NAME))
            return;

        if (Blur?.BlurEffect) {
            const effect = new Blur.BlurEffect({
                name: EFFECT_NAME,
                mode: 1, // GB_BLUR_MODE_BACKGROUND
                radius: 5,
                corner_radius: 9999,
            });
            actor.add_effect(effect);
        } else if (Shell?.BlurEffect) {
            const effect = new Shell.BlurEffect({
                name: EFFECT_NAME,
                mode: Shell.BlurMode.BACKGROUND,
                radius: 5,
            });
            actor.add_effect(effect);
        }
    } catch (e) {
        console.warn(`[kiwi] Failed to apply label blur: ${e}`);
    }
}

export function removeLabelBlur(actor) {
    if (!actor || !actor.get_effects)
        return;
    try {
        const effects = actor.get_effects();
        for (const eff of effects) {
            if (eff.name === EFFECT_NAME)
                actor.remove_effect(eff);
        }
    } catch (_) {}
}

function _dashLabels() {
    try {
        return Main.uiGroup.get_children().filter(child =>
            child.has_style_class_name?.('dash-label')
        );
    } catch (_) {
        return [];
    }
}

function _walkOverviewCaptions(root) {
    if (!root) return;
    try {
        if (root.has_style_class_name?.('window-caption'))
            applyLabelBlur(root);
    } catch (_) {}

    try {
        const kids = root.get_children ? root.get_children() : [];
        for (const child of kids)
            _walkOverviewCaptions(child);
    } catch (_) {}
}

function _blurAllCaptions() {
    try {
        if (Main.layoutManager?.overviewGroup)
            _walkOverviewCaptions(Main.layoutManager.overviewGroup);
    } catch (_) {}
}

export function enable() {
    // 1. Blur existing and future dock labels
    _dashLabels().forEach(applyLabelBlur);

    if (!childAddedId && Main.uiGroup) {
        childAddedId = Main.uiGroup.connect('child-added', (_group, actor) => {
            if (actor.has_style_class_name?.('dash-label'))
                applyLabelBlur(actor);
        });
    }

    // 2. Blur overview window captions on overview showing
    if (!overviewShowingId && Main.overview) {
        overviewShowingId = Main.overview.connect('showing', _blurAllCaptions);
    }

    // 3. Hook WindowPreview._init
    if (WindowPreview && !origWpInit) {
        origWpInit = WindowPreview.prototype._init;
        WindowPreview.prototype._init = function(...args) {
            origWpInit.apply(this, args);
            if (this._title)
                applyLabelBlur(this._title);
        };
    }

    // Check if overview is currently open
    _blurAllCaptions();
}

export function disable() {
    if (childAddedId && Main.uiGroup) {
        Main.uiGroup.disconnect(childAddedId);
        childAddedId = 0;
    }

    if (overviewShowingId && Main.overview) {
        Main.overview.disconnect(overviewShowingId);
        overviewShowingId = 0;
    }

    if (WindowPreview && origWpInit) {
        WindowPreview.prototype._init = origWpInit;
        origWpInit = null;
    }

    _dashLabels().forEach(removeLabelBlur);

    try {
        if (Main.layoutManager?.overviewGroup) {
            const walk = (root) => {
                if (!root) return;
                if (root.has_style_class_name?.('window-caption'))
                    removeLabelBlur(root);
                const kids = root.get_children ? root.get_children() : [];
                for (const child of kids) walk(child);
            };
            walk(Main.layoutManager.overviewGroup);
        }
    } catch (_) {}
}
