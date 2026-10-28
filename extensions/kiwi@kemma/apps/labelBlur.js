// SPDX-License-Identifier: GPL-3.0-or-later
// Adds a hardware-accelerated rounded frosted glass blur effect to dock labels, tooltips, and overview window captions.
// Dynamically connected to Mac Stylization "Blur" settings (blur-my-shell sigma/brightness).

import Gio from "gi://Gio";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

let Blur = null;
try {
    Blur = (await import("gi://Blur")).default;
} catch (_) {}

let WindowPreview = null;
try {
    const wpMod = await import("resource:///org/gnome/shell/ui/windowPreview.js");
    WindowPreview = wpMod.WindowPreview;
} catch (_) {}

const EFFECT_NAME = "tahoe-label-blur";
const DEFAULT_BLUR_RADIUS = 30;
const DEFAULT_CORNER_RADIUS = 14;
const DEFAULT_BRIGHTNESS = 0.85;

let bmsDockSettings = null;
let bmsRootSettings = null;
let settingsSignalIds = [];
let childAddedId = 0;
let overviewShowingId = 0;
let overviewShownId = 0;
let origWpInit = null;
let origShowOverlay = null;

function _initSettings() {
    if (bmsDockSettings || bmsRootSettings) return;
    try {
        const src = Gio.SettingsSchemaSource.get_default();
        if (src.lookup("org.gnome.shell.extensions.blur-my-shell.dash-to-dock", true)) {
            bmsDockSettings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.blur-my-shell.dash-to-dock" });
        }
        if (src.lookup("org.gnome.shell.extensions.blur-my-shell", true)) {
            bmsRootSettings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.blur-my-shell" });
        }
    } catch (e) {
        console.warn(`[kiwi] labelBlur: error initializing Gio.Settings: ${e}`);
    }
}

function _getCurrentRadius() {
    _initSettings();
    try {
        if (bmsDockSettings?.settings_schema?.has_key("sigma")) {
            const s = bmsDockSettings.get_int("sigma");
            if (s > 0) return s;
        }
        if (bmsRootSettings?.settings_schema?.has_key("sigma")) {
            const s = bmsRootSettings.get_int("sigma");
            if (s > 0) return s;
        }
    } catch (_) {}
    return DEFAULT_BLUR_RADIUS;
}

function _getCurrentBrightness() {
    _initSettings();
    try {
        if (bmsDockSettings?.settings_schema?.has_key("brightness"))
            return bmsDockSettings.get_double("brightness");
        if (bmsRootSettings?.settings_schema?.has_key("brightness"))
            return bmsRootSettings.get_double("brightness");
    } catch (_) {}
    return DEFAULT_BRIGHTNESS;
}

function _isBlurActive() {
    return _getCurrentRadius() > 0;
}

function _isLabelActor(actor) {
    if (!actor || !actor.has_style_class_name) return false;
    return actor.has_style_class_name("dash-label") ||
           actor.has_style_class_name("window-caption") ||
           actor.has_style_class_name("screenshot-ui-tooltip") ||
           actor.has_style_class_name("tooltip");
}

export function applyLabelBlur(actor) {
    if (!actor || !actor.add_effect)
        return;

    try {
        const radius = _getCurrentRadius();
        const brightness = _getCurrentBrightness();
        const active = _isBlurActive() && radius > 0;

        const effects = actor.get_effects ? actor.get_effects() : [];
        const existing = effects.find(e => e.name === EFFECT_NAME);
        if (existing) {
            existing.enabled = active;
            existing.radius = active ? radius : 0;
            if ("corner_radius" in existing)
                existing.corner_radius = DEFAULT_CORNER_RADIUS;
            if ("brightness" in existing)
                existing.brightness = brightness;
            if (existing.queue_repaint)
                existing.queue_repaint();
            return;
        }

        if (!active)
            return;

        let effect = null;
        if (Blur?.BlurEffect) {
            effect = new Blur.BlurEffect({
                name: EFFECT_NAME,
                mode: 1, // GB_BLUR_MODE_BACKGROUND
                radius: radius,
                corner_radius: DEFAULT_CORNER_RADIUS,
                brightness: brightness,
            });
        } else if (Shell?.BlurEffect) {
            effect = new Shell.BlurEffect({
                name: EFFECT_NAME,
                mode: Shell.BlurMode.BACKGROUND,
                radius: radius,
            });
        }

        if (effect) {
            actor.add_effect(effect);
            if (actor.connectObject) {
                actor.connectObject(
                    "notify::visible", () => {
                        if (actor.visible && effect.queue_repaint)
                            effect.queue_repaint();
                    },
                    "notify::opacity", () => {
                        if (actor.opacity > 0 && effect.queue_repaint)
                            effect.queue_repaint();
                    },
                    "notify::allocation", () => {
                        if (effect.queue_repaint)
                            effect.queue_repaint();
                    },
                    actor
                );
            }
        }
    } catch (e) {
        console.warn(`[kiwi] Failed to apply label blur: ${e}`);
    }
}

export function removeLabelBlur(actor) {
    if (!actor || !actor.get_effects)
        return;
    try {
        if (actor.disconnectObject)
            actor.disconnectObject(actor);
        const effects = actor.get_effects();
        for (const eff of effects) {
            if (eff.name === EFFECT_NAME)
                actor.remove_effect(eff);
        }
    } catch (_) {}
}

function _dashLabels() {
    try {
        return Main.uiGroup.get_children().filter(_isLabelActor);
    } catch (_) {
        return [];
    }
}

function _walkOverviewCaptions(root) {
    if (!root) return;
    try {
        if (root.has_style_class_name?.("window-caption"))
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

        const wsViews = Main.overview?._overview?._controls?._workspacesDisplay?._workspacesViews;
        if (wsViews) {
            for (const wv of wsViews) {
                const wss = wv._workspaces || [];
                for (const ws of wss) {
                    const wins = ws._windows || [];
                    for (const wp of wins) {
                        if (wp._title)
                            applyLabelBlur(wp._title);
                    }
                }
            }
        }
    } catch (_) {}
}

function _updateAllLabels() {
    const radius = _getCurrentRadius();
    const brightness = _getCurrentBrightness();
    const active = _isBlurActive() && radius > 0;

    _dashLabels().forEach(actor => {
        const effects = actor.get_effects ? actor.get_effects() : [];
        const existing = effects.find(e => e.name === EFFECT_NAME);
        if (existing) {
            existing.enabled = active;
            existing.radius = active ? radius : 0;
            if ("corner_radius" in existing)
                existing.corner_radius = DEFAULT_CORNER_RADIUS;
            if ("brightness" in existing)
                existing.brightness = brightness;
            if (existing.queue_repaint)
                existing.queue_repaint();
        } else if (active) {
            applyLabelBlur(actor);
        }
    });

    _blurAllCaptions();
}

export function enable() {
    _initSettings();

    // Listen to changes in Mac Stylization "Blur" settings
    if (bmsDockSettings) {
        settingsSignalIds.push([bmsDockSettings, bmsDockSettings.connect("changed::sigma", _updateAllLabels)]);
        settingsSignalIds.push([bmsDockSettings, bmsDockSettings.connect("changed::brightness", _updateAllLabels)]);
    }
    if (bmsRootSettings) {
        settingsSignalIds.push([bmsRootSettings, bmsRootSettings.connect("changed::sigma", _updateAllLabels)]);
        settingsSignalIds.push([bmsRootSettings, bmsRootSettings.connect("changed::brightness", _updateAllLabels)]);
    }

    // 1. Blur existing and future dock labels / tooltips
    _dashLabels().forEach(applyLabelBlur);

    if (!childAddedId && Main.uiGroup) {
        childAddedId = Main.uiGroup.connect("child-added", (_group, actor) => {
            if (_isLabelActor(actor))
                applyLabelBlur(actor);
        });
    }

    // 2. Blur overview window captions on overview showing & shown
    if (!overviewShowingId && Main.overview) {
        overviewShowingId = Main.overview.connect("showing", _blurAllCaptions);
    }
    if (!overviewShownId && Main.overview) {
        overviewShownId = Main.overview.connect("shown", _blurAllCaptions);
    }

    // 3. Hook WindowPreview._init & showOverlay
    if (WindowPreview) {
        if (!origWpInit) {
            origWpInit = WindowPreview.prototype._init;
            WindowPreview.prototype._init = function(...args) {
                origWpInit.apply(this, args);
                if (this._title)
                    applyLabelBlur(this._title);
            };
        }
        if (!origShowOverlay) {
            origShowOverlay = WindowPreview.prototype.showOverlay;
            WindowPreview.prototype.showOverlay = function(...args) {
                if (this._title)
                    applyLabelBlur(this._title);
                return origShowOverlay.apply(this, args);
            };
        }
    }

    _blurAllCaptions();
}

export function disable() {
    for (const [settings, id] of settingsSignalIds) {
        try { settings.disconnect(id); } catch (_) {}
    }
    settingsSignalIds = [];

    if (childAddedId && Main.uiGroup) {
        Main.uiGroup.disconnect(childAddedId);
        childAddedId = 0;
    }

    if (overviewShowingId && Main.overview) {
        Main.overview.disconnect(overviewShowingId);
        overviewShowingId = 0;
    }

    if (overviewShownId && Main.overview) {
        overviewShownId = Main.overview.disconnect(overviewShownId);
        overviewShownId = 0;
    }

    if (WindowPreview) {
        if (origWpInit) {
            WindowPreview.prototype._init = origWpInit;
            origWpInit = null;
        }
        if (origShowOverlay) {
            WindowPreview.prototype.showOverlay = origShowOverlay;
            origShowOverlay = null;
        }
    }

    _dashLabels().forEach(removeLabelBlur);

    try {
        if (Main.layoutManager?.overviewGroup) {
            const walk = (root) => {
                if (!root) return;
                if (root.has_style_class_name?.("window-caption"))
                    removeLabelBlur(root);
                const kids = root.get_children ? root.get_children() : [];
                for (const child of kids) walk(child);
            };
            walk(Main.layoutManager.overviewGroup);
        }
    } catch (_) {}
}
