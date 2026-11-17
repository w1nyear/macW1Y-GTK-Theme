// SPDX-License-Identifier: GPL-3.0-or-later


import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';
import Clutter from 'gi://Clutter';

import { connectPaintSignal } from './blurPaintSignal.js';

let settings;
let enabled = false;
let windowSignals = [];
let settingsSignals = [];
let interfaceSettings;
let originalStyle;
let isUpdatingStyle = false;
let interfaceSettingsSignal;
let timeoutId;
let safetyIntervalId;
let lastForcedAlpha = null;
let lastFullscreenState = false;
let overviewHiding = false;
let lastPanelColor = null;
let noTransitionIdleId = 0;
let colorFixIdleId = 0;
let themeUpdateIdleId = 0;
let colorSchemeIdleId = 0;
let ownBackground = '';
let panelStyleSignal;


let bgSettings;
let bgSignals = [];
let wallpaperLuminance = 0;
let wallpaperAverage = null;
let iconTheme;
let monochromeIcons = new Map();
let contentIcons = new WeakMap();

const SAMPLE_SIZE = 32;
const SAMPLE_ROWS = 4;
const LIGHT_THRESHOLD = 0.6;
const DARKEN_EFFECT = 'kiwi-tray-darken';
const LIGHTEN_EFFECT = 'kiwi-tray-lighten';
const ICON_SAMPLE_SIZE = 24;
const ICON_SATURATION_MAX = 0.15;
const ICON_LUMINANCE_MIN = 0.6;
const ICON_LUMINANCE_MAX_DARK = 0.4;


let blurEffect = null;
let blurBackgroundGroup = null;
let blurWidget = null;
let blurSizeSignals = [];
let blurPaintSignals = [];
let blurRepaintIdleId = 0;







function createBlurEffect() {
    destroyBlurEffect();

    const panel = Main.panel;
    const panelBox = panel?.get_parent();
    if (!panel || !panelBox) return;


    blurBackgroundGroup = new Meta.BackgroundGroup({
        name: 'kiwi-panel-blur-group',
        width: 0,
        height: 0,
    });


    blurWidget = new St.Widget({ name: 'kiwi-panel-blur' });

    blurEffect = new Shell.BlurEffect({
        mode: Shell.BlurMode.BACKGROUND,
        radius: 30,
        brightness: 1.0,
    });
    blurWidget.add_effect(blurEffect);




    connectPaintSignal(blurWidget, _scheduleBlurRepaint);

    blurBackgroundGroup.insert_child_at_index(blurWidget, 0);
    panelBox.insert_child_at_index(blurBackgroundGroup, 0);


    _updateBlurSize();


    blurSizeSignals.push(
        panel.connect('notify::position', _updateBlurSize),
        panel.connect('notify::size', _updateBlurSize),
    );
    blurSizeSignals.push(
        panelBox.connect('notify::size', _updateBlurSize),
        panelBox.connect('notify::position', _updateBlurSize),
    );






    _connectPaintSignals();
}

function _scheduleBlurRepaint() {
    if (blurRepaintIdleId || !blurEffect) return;
    blurRepaintIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        blurRepaintIdleId = 0;
        if (blurEffect && blurWidget?.visible)
            blurEffect.queue_repaint();
        return GLib.SOURCE_REMOVE;
    });
}

function _connectPaintSignals() {
    _disconnectPaintSignals();
    if (!blurEffect) return;

    const backgroundGroup = Main.layoutManager._backgroundGroup;
    if (!backgroundGroup) return;


    for (const bg of backgroundGroup) {
        _connectBgActor(bg);
    }


    const addId = backgroundGroup.connect('child-added', (_group, child) => {
        _connectBgActor(child);
    });
    const removeId = backgroundGroup.connect('child-removed', (_group, child) => {

        blurPaintSignals = blurPaintSignals.filter(s => s.actor !== child);
    });
    blurPaintSignals.push({ actor: backgroundGroup, id: addId });
    blurPaintSignals.push({ actor: backgroundGroup, id: removeId });


    const restackedId = global.display.connect('restacked', _scheduleBlurRepaint);
    blurPaintSignals.push({ actor: global.display, id: restackedId });

    const wmSignals = ['map', 'destroy', 'minimize', 'unminimize', 'switch-workspace'];
    for (const sigName of wmSignals) {
        try {
            const id = global.window_manager.connect(sigName, _scheduleBlurRepaint);
            blurPaintSignals.push({ actor: global.window_manager, id });
        } catch (_) {}
    }

    const showId = Main.overview.connect('showing', _scheduleBlurRepaint);
    const hideId = Main.overview.connect('hidden', _scheduleBlurRepaint);
    blurPaintSignals.push({ actor: Main.overview, id: showId });
    blurPaintSignals.push({ actor: Main.overview, id: hideId });
}

function _connectBgActor(bg) {
    const contentId = bg.connect('notify::content', _scheduleBlurRepaint);

    const destroyId = bg.connect('destroy', () => {
        blurPaintSignals = blurPaintSignals.filter(s => s.actor !== bg);
    });
    blurPaintSignals.push({ actor: bg, id: contentId });
    blurPaintSignals.push({ actor: bg, id: destroyId });
}

function _disconnectPaintSignals() {

    const signals = blurPaintSignals;
    blurPaintSignals = [];
    for (const { actor, id } of signals) {
        try { actor.disconnect(id); } catch (_) {}
    }
    if (blurRepaintIdleId) {
        GLib.Source.remove(blurRepaintIdleId);
        blurRepaintIdleId = 0;
    }
}

function _updateBlurSize() {
    const panel = Main.panel;
    if (!blurWidget || !panel) return;

    blurWidget.set_position(panel.x, panel.y);
    blurWidget.set_size(panel.width, panel.height);
    _scheduleBlurRepaint();
}

function destroyBlurEffect() {
    const panel = Main.panel;
    const panelBox = panel?.get_parent();


    if (blurSizeSignals.length > 0) {

        if (panel) {
            try { panel.disconnect(blurSizeSignals[0]); } catch (_) {}
            try { panel.disconnect(blurSizeSignals[1]); } catch (_) {}
        }
        if (panelBox) {
            try { panelBox.disconnect(blurSizeSignals[2]); } catch (_) {}
            try { panelBox.disconnect(blurSizeSignals[3]); } catch (_) {}
        }
        blurSizeSignals = [];
    }

    _disconnectPaintSignals();

    if (blurBackgroundGroup) {
        if (panelBox) {
            try { panelBox.remove_child(blurBackgroundGroup); } catch (_) {}
        }
        blurBackgroundGroup.destroy_all_children();
        blurBackgroundGroup.destroy();
        blurBackgroundGroup = null;
    }
    blurWidget = null;
    blurEffect = null;
}

function updateBlurVisibility(visible) {
    if (blurWidget) {
        blurWidget.visible = visible;
    }
}








function _wallpaperPath() {
    if (!bgSettings) return null;
    const dark = interfaceSettings?.get_string('color-scheme') === 'prefer-dark';
    let uri = dark ? bgSettings.get_string('picture-uri-dark') : '';
    if (!uri) uri = bgSettings.get_string('picture-uri');
    if (!uri) return null;
    return Gio.File.new_for_uri(uri).get_path();
}

function updateWallpaperLightness() {
    const path = _wallpaperPath();
    if (!path) {
        wallpaperLuminance = 0;
        wallpaperAverage = null;
        return;
    }

    try {


        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, SAMPLE_SIZE, SAMPLE_SIZE, false);
        const pixels = pixbuf.get_pixels();
        const stride = pixbuf.get_rowstride();
        const channels = pixbuf.get_n_channels();
        const width = pixbuf.get_width();
        const rows = Math.min(SAMPLE_ROWS, pixbuf.get_height());

        let sum = 0, sr = 0, sg = 0, sb = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * stride + x * channels;
                const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
                sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
                sr += r;
                sg += g;
                sb += b;
            }
        }
        const n = rows * width;
        wallpaperLuminance = sum / n;
        wallpaperAverage = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    } catch (_e) {

        wallpaperLuminance = 0;
        wallpaperAverage = null;
    }
}






function _measureIcon(pixbuf) {
    const pixels = pixbuf.get_pixels();
    const stride = pixbuf.get_rowstride();
    const channels = pixbuf.get_n_channels();
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();

    let saturation = 0;
    let luminance = 0;
    let count = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * stride + x * channels;
            if (pixels[i + 3] < 30) continue;

            const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);

            saturation += max === 0 ? 0 : (max - min) / max;
            luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
            count++;
        }
    }

    if (!count || (saturation / count) >= ICON_SATURATION_MAX) return null;

    const mean = luminance / count;
    if (mean > ICON_LUMINANCE_MIN) return 'light';
    if (mean < ICON_LUMINANCE_MAX_DARK) return 'dark';
    return null;
}

function _iconTone(gicon) {
    if (!gicon) return null;



    if (gicon instanceof Gio.EmblemedIcon)
        gicon = gicon.get_icon();

    const key = gicon.to_string();
    if (key && monochromeIcons.has(key))
        return monochromeIcons.get(key);

    let tone = null;
    try {
        const info = iconTheme.lookup_by_gicon(gicon, ICON_SAMPLE_SIZE, St.IconLookupFlags.FORCE_SIZE);
        const pixbuf = info?.load_icon();


        if (pixbuf?.get_has_alpha())
            tone = _measureIcon(pixbuf);
    } catch (_e) {

    }

    if (key) monochromeIcons.set(key, tone);
    return tone;
}








function _contentTone(content) {
    if (contentIcons.has(content))
        return contentIcons.get(content);

    let tone = null;
    try {
        const [stream] = content.load(ICON_SAMPLE_SIZE, null);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
        if (pixbuf?.get_has_alpha())
            tone = _measureIcon(pixbuf);
    } catch (_e) {

    }

    contentIcons.set(content, tone);
    return tone;
}

function _trayIcons() {
    const icons = [];
    const walk = actor => {
        for (const child of actor.get_children()) {
            if (child instanceof St.Icon &&
                (child.has_style_class_name('appindicator-icon') || child.has_style_class_name('tray-icon')))
                icons.push(child);
            else
                walk(child);
        }
    };
    walk(Main.panel);
    return icons;
}



function updateTrayIconInversion(mode) {
    for (const icon of _trayIcons()) {



        const tone = mode ? (icon.content
            ? _contentTone(icon.content)
            : _iconTone(icon.gicon)) : null;


        const wanted = (mode === 'darken' && tone === 'light') ? DARKEN_EFFECT
            : (mode === 'lighten' && tone === 'dark') ? LIGHTEN_EFFECT
            : null;

        for (const name of [DARKEN_EFFECT, LIGHTEN_EFFECT]) {
            if (name !== wanted && icon.get_effect(name))
                icon.remove_effect_by_name(name);
        }

        if (wanted && !icon.get_effect(wanted)) {
            const effect = new Clutter.BrightnessContrastEffect({ name: wanted });
            effect.set_brightness(wanted === DARKEN_EFFECT ? -1.0 : 1.0);
            icon.add_effect(effect);
        }
    }
}


function _luminance(color) {
    return (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
}

function _panelLuminance() {
    return _luminance(Main.panel.get_theme_node().get_background_color());
}



function clearForegroundContrast() {
    const panel = Main.panel;
    panel.remove_style_class_name('kiwi-panel-dark-text');
    panel.remove_style_class_name('kiwi-panel-light-text');
    updateTrayIconInversion(null);
}

function updateForegroundContrast(opacity, panelLuminance = _panelLuminance()) {
    const panel = Main.panel;
    const behind = opacity * panelLuminance + (1 - opacity) * wallpaperLuminance;
    const dark = behind > LIGHT_THRESHOLD;



    panel.remove_style_class_name(dark ? 'kiwi-panel-light-text' : 'kiwi-panel-dark-text');
    panel.add_style_class_name(dark ? 'kiwi-panel-dark-text' : 'kiwi-panel-light-text');


    updateTrayIconInversion(settings?.get_boolean('panel-invert-tray-icons')
        ? (dark ? 'darken' : 'lighten')
        : null);
}







function applyPanelColorFix() {
    const panel = Main.panel;
    if (!panel) return;

    if (settings && settings.get_boolean('panel-color-inherit')) {
        panel.add_style_class_name('kiwi-panel-color-inherit');
    } else {
        panel.remove_style_class_name('kiwi-panel-color-inherit');
    }



    setPanelBackground('');
    if (colorFixIdleId)
        GLib.Source.remove(colorFixIdleId);
    colorFixIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        colorFixIdleId = 0;
        if (enabled) updatePanelStyle(lastForcedAlpha);
        return GLib.SOURCE_REMOVE;
    });
}




function restorePanelStyle() {
    const panel = Main.panel;
    if (!panel) return;
    ownBackground = '';
    panel.set_style(originalStyle);
    panel.queue_redraw();
}

function _isFullscreenActive() {
    try {
        return global.workspace_manager
            .get_active_workspace()
            .list_windows()
            .some(win =>
                win.showing_on_its_workspace() &&
                !win.is_hidden() &&
                typeof win.is_fullscreen === 'function' && win.is_fullscreen());
    } catch (_e) {
        return false;
    }
}





function setPanelBackground(declaration) {
    const panel = Main.panel;
    ownBackground = declaration;

    const current = panel.get_style() ?? '';
    const base = current.replace(/background-color:[^;]*;\s*/g, '');
    const wanted = `${base}${declaration}`;
    if (current !== wanted) {
        panel.set_style(wanted);
    }
}

function _cancelNoTransitionIdle() {
    if (noTransitionIdleId) {
        GLib.Source.remove(noTransitionIdleId);
        noTransitionIdleId = 0;
    }
}

function updatePanelStyle(alpha = null) {
    const panel = Main.panel;
    if (isUpdatingStyle || !panel) return;
    isUpdatingStyle = true;

    try {

        const fullscreenNow = _isFullscreenActive();


        if (fullscreenNow !== lastFullscreenState) {
            lastFullscreenState = fullscreenNow;

            if (fullscreenNow) {

                panel.add_style_class_name('kiwi-panel-fullscreen');
                lastForcedAlpha = 1.0;
            } else {

                panel.remove_style_class_name('kiwi-panel-fullscreen');
                lastForcedAlpha = null;
            }
        }




        if (Main.overview.visible && !overviewHiding) {


            const { red: r, green: g, blue: b } = panel.get_theme_node().get_background_color();
            setPanelBackground(`background-color: rgba(${r}, ${g}, ${b}, 0) !important;`);
            updateBlurVisibility(false);
            clearForegroundContrast();
            panel.queue_redraw();
            return;
        }


        if (fullscreenNow) {

            setPanelBackground('');
            updateBlurVisibility(false);
            updateForegroundContrast(1.0);
            panel.queue_redraw();
            return;
        }

        if (!settings?.get_boolean('panel-transparency')) {
            updateBlurVisibility(false);
            updateForegroundContrast(1.0);
            restorePanelStyle();
            return;
        }




        const themeNode = panel.get_theme_node();
        const backgroundColor = themeNode.get_background_color();
        let [r, g, b] = [backgroundColor.red, backgroundColor.green, backgroundColor.blue];
        if (overviewHiding && lastPanelColor)
            [r, g, b] = lastPanelColor;
        else if (!overviewHiding)
            lastPanelColor = [r, g, b];



        if (!overviewHiding && settings?.get_boolean('panel-adaptive-colors') &&
            wallpaperAverage)
            [r, g, b] = wallpaperAverage;

        if (alpha !== null) {
            lastForcedAlpha = alpha;
        }
        const opacity = (alpha !== null ? alpha : (lastForcedAlpha !== null ? lastForcedAlpha : settings.get_int('panel-transparency-level') / 100));
        const newStyle = `background-color: rgba(${r}, ${g}, ${b}, ${opacity}) !important;`;


        const blurEnabled = settings?.get_boolean('panel-blur');
        updateBlurVisibility(blurEnabled && opacity < 1.0);
        updateForegroundContrast(opacity, _luminance({ red: r, green: g, blue: b }));

        if (ownBackground !== newStyle) {
            setPanelBackground(newStyle);
            panel.queue_redraw();
        }
    } catch (error) {
        ownBackground = '';
        panel.set_style(originalStyle || '');
    } finally {
        isUpdatingStyle = false;
    }
}

function checkWindowTouchingPanel() {
    if (!settings?.get_boolean('panel-transparency') ||
        !settings.get_boolean('panel-opaque-on-window')) {

        if (_isFullscreenActive()) {
            updatePanelStyle(1.0);
        } else {

            if (lastForcedAlpha !== null) {
                lastForcedAlpha = null;
            }
            updatePanelStyle(null);
        }
        return;
    }



    const windowTouching = global.workspace_manager
        .get_active_workspace()
        .list_windows()
        .some(win =>
            win.is_on_primary_monitor() &&
            win.showing_on_its_workspace() &&
            !win.is_hidden() &&
            win.get_window_type() !== Meta.WindowType.DESKTOP &&
            !win.skip_taskbar &&
            win.maximized_horizontally &&
            win.maximized_vertically
        );
    if (_isFullscreenActive()) {
        updatePanelStyle(1.0);
    } else {


        if (!windowTouching) {
            lastForcedAlpha = null;
        }
        updatePanelStyle(windowTouching ? 1.0 : null);
    }
}

function handleWindowSignals(connect = true) {
    if (!connect) {
        windowSignals.forEach(({ actor, signals }) => {
            signals.forEach(signalId => {


                if (signalId)
                    actor.disconnect(signalId);
            });
        });
        windowSignals = [];
        return;
    }

    const workspace = global.workspace_manager.get_active_workspace();
    const workspaceSignals = [];

    workspaceSignals.push(workspace.connect('window-added', (ws, win) => {
        connectWindowSignals(win);
        checkWindowTouchingPanel();
    }));

    workspaceSignals.push(workspace.connect('window-removed', (ws, win) => {
        disconnectWindowSignals(win);
        checkWindowTouchingPanel();
    }));

    windowSignals.push({ actor: workspace, signals: workspaceSignals });

    workspace.list_windows().forEach(win => {
        connectWindowSignals(win);
    });
}

function connectWindowSignals(metaWindow) {
    const actorSignals = [];

    actorSignals.push(metaWindow.connect('position-changed', () => {
        checkWindowTouchingPanel();
    }));

    actorSignals.push(metaWindow.connect('size-changed', () => {
        checkWindowTouchingPanel();
    }));


    actorSignals.push(metaWindow.connect('notify::fullscreened', () => {
        checkWindowTouchingPanel();
    }));
    actorSignals.push(metaWindow.connect('notify::maximized-horizontally', () => {
        checkWindowTouchingPanel();
    }));
    actorSignals.push(metaWindow.connect('notify::maximized-vertically', () => {
        checkWindowTouchingPanel();
    }));

    actorSignals.push(metaWindow.connect('unmanaged', () => {
        disconnectWindowSignals(metaWindow);
        checkWindowTouchingPanel();
    }));

    windowSignals.push({ actor: metaWindow, signals: actorSignals });
}

function disconnectWindowSignals(metaWindow) {
    const index = windowSignals.findIndex(item => item.actor === metaWindow);
    if (index !== -1) {
        const { signals } = windowSignals[index];
        signals.forEach(signalId => {
            metaWindow.disconnect(signalId);
        });
        windowSignals.splice(index, 1);
    }
}

function setupSignals() {
    settingsSignals.forEach(signal => {
        settings.disconnect(signal);
    });
    settingsSignals = [];

    settingsSignals = [
        settings.connect('changed::panel-transparency', () => {
            if (settings.get_boolean('panel-transparency')) {
                checkWindowTouchingPanel();
            } else {
                lastForcedAlpha = null;
                updateBlurVisibility(false);
                restorePanelStyle();
            }
        }),
        settings.connect('changed::panel-transparency-level', () => {
            updatePanelStyle(null);
        }),
        settings.connect('changed::panel-opaque-on-window', () => {
            checkWindowTouchingPanel();
        }),
        settings.connect('changed::panel-color-inherit', () => {
            applyPanelColorFix();
        }),
        settings.connect('changed::panel-invert-tray-icons', () => {
            updatePanelStyle(null);
        }),
        settings.connect('changed::panel-adaptive-colors', () => {
            updatePanelStyle(null);
        }),
        settings.connect('changed::panel-blur', () => {
            if (settings.get_boolean('panel-blur')) {
                createBlurEffect();
                checkWindowTouchingPanel();
            } else {
                destroyBlurEffect();
            }
        })
    ];

    handleWindowSignals(true);

    windowSignals.push({
        actor: global.window_manager,
        signals: [
            global.window_manager.connect('switch-workspace', () => {
                checkWindowTouchingPanel();
            })
        ]
    });

    windowSignals.push({
        actor: global.display,
        signals: [
            global.display.connect('window-entered-monitor', () => {
                checkWindowTouchingPanel();
            }),
            global.display.connect('window-left-monitor', () => {
                checkWindowTouchingPanel();
            }),


            (() => { try { return global.display.connect('window-entered-fullscreen', () => { updatePanelStyle(); }); } catch(_e) { return 0; } })(),
                (() => { try { return global.display.connect('window-left-fullscreen', () => {

                    if (!settings.get_boolean('panel-opaque-on-window')) {
                        lastForcedAlpha = null;
                        updatePanelStyle(null);
                    } else {
                        checkWindowTouchingPanel();
                    }
                 }); } catch(_e) { return 0; } })(),
            (() => { try { return global.display.connect('in-fullscreen-changed', () => { checkWindowTouchingPanel(); }); } catch(_e) { return 0; } })()
        ]
    });

    windowSignals.push({
        actor: Main.overview,
        signals: [
            Main.overview.connect('showing', () => {
                overviewHiding = false;
                _cancelNoTransitionIdle();

                Main.panel.remove_style_class_name('kiwi-panel-no-transition');
                updatePanelStyle();
            }),
            Main.overview.connect('hiding', () => {
                overviewHiding = true;


                Main.panel.add_style_class_name('kiwi-panel-no-transition');
                checkWindowTouchingPanel();
            }),
            Main.overview.connect('hidden', () => {
                overviewHiding = false;
                checkWindowTouchingPanel();

                noTransitionIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    noTransitionIdleId = 0;
                    Main.panel.remove_style_class_name('kiwi-panel-no-transition');
                    return GLib.SOURCE_REMOVE;
                });
            })
        ]
    });
}

function forceThemeUpdate() {
    const panel = Main.panel;
    panel.remove_style_class_name('panel');
    if (themeUpdateIdleId)
        GLib.Source.remove(themeUpdateIdleId);
    themeUpdateIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        themeUpdateIdleId = 0;
        panel.add_style_class_name('panel');
        ownBackground = '';
        panel.style = null;
        updatePanelStyle();
        return GLib.SOURCE_REMOVE;
    });
}

export function init(extensionSettings) {
    settings = extensionSettings;
}

export function enable(_settings) {



    if (enabled || !_settings) return;
    settings = _settings;
    enabled = true;

    originalStyle = Main.panel.get_style();
    panelStyleSignal = Main.panel.connect('notify::style', () => {
        if (ownBackground)
            setPanelBackground(ownBackground);
    });
    interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    interfaceSettingsSignal = interfaceSettings.connect('changed::color-scheme', () => {
        updateWallpaperLightness();
        forceThemeUpdate();
        if (colorSchemeIdleId)
            GLib.Source.remove(colorSchemeIdleId);
        colorSchemeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            colorSchemeIdleId = 0;
            updatePanelStyle();
            return GLib.SOURCE_REMOVE;
        });
    });

    iconTheme = new St.IconTheme();
    bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
    bgSignals = ['changed::picture-uri', 'changed::picture-uri-dark'].map(key =>
        bgSettings.connect(key, () => {
            updateWallpaperLightness();
            updatePanelStyle();
        }));
    updateWallpaperLightness();

    setupSignals();

    updatePanelStyle();
    forceThemeUpdate();


    applyPanelColorFix();


    if (settings.get_boolean('panel-blur')) {
        createBlurEffect();
    }

    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        checkWindowTouchingPanel();
        timeoutId = null;
        return GLib.SOURCE_REMOVE;
    });


    safetyIntervalId = GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
        if (!settings) { safetyIntervalId = null; return GLib.SOURCE_REMOVE; }
        checkWindowTouchingPanel();
        return GLib.SOURCE_CONTINUE;
    });
}

export function disable() {
    if (!enabled) return;
    enabled = false;

    if (timeoutId) {
        GLib.Source.remove(timeoutId);
        timeoutId = null;
    }
    if (safetyIntervalId) {
        GLib.Source.remove(safetyIntervalId);
        safetyIntervalId = null;
    }
    if (panelStyleSignal) {
        Main.panel.disconnect(panelStyleSignal);
        panelStyleSignal = null;
    }
    _cancelNoTransitionIdle();
    if (colorFixIdleId) {
        GLib.Source.remove(colorFixIdleId);
        colorFixIdleId = 0;
    }
    if (themeUpdateIdleId) {
        GLib.Source.remove(themeUpdateIdleId);
        themeUpdateIdleId = 0;
    }
    if (colorSchemeIdleId) {
        GLib.Source.remove(colorSchemeIdleId);
        colorSchemeIdleId = 0;
    }
    ownBackground = '';

    settingsSignals.forEach(signal => {
        settings.disconnect(signal);
    });
    settingsSignals = [];

    handleWindowSignals(false);

    if (interfaceSettingsSignal) {
        interfaceSettings.disconnect(interfaceSettingsSignal);
        interfaceSettingsSignal = null;
    }
    interfaceSettings = null;

    bgSignals.forEach(signal => bgSettings.disconnect(signal));
    bgSignals = [];
    bgSettings = null;
    wallpaperLuminance = 0;
    iconTheme = null;
    monochromeIcons.clear();
    contentIcons = new WeakMap();


    destroyBlurEffect();


    const panel = Main.panel;
    panel.remove_style_class_name('kiwi-panel-fullscreen');
    panel.remove_style_class_name('kiwi-panel-color-inherit');
    panel.remove_style_class_name('kiwi-panel-no-transition');
    clearForegroundContrast();
    restorePanelStyle();

    settings = null;
    originalStyle = null;
    lastForcedAlpha = null;
    lastFullscreenState = false;
    overviewHiding = false;
    lastPanelColor = null;
}
