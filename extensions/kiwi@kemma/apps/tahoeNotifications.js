// SPDX-License-Identifier: GPL-3.0-or-later


























import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { applyGradientBlurFade } from './gradientBlurFade.js?v=gbf_v3';
import {getPanelInk, watchInk} from './tahoeInk.js';
import {closeAllCenters} from './centerManager.js';
import {
    buildNotificationCard,
} from './tahoeNotificationCard.js?v=notif_v16';
import { t, tf } from './mac_i18n.js';

let LiquidEffect = null;
let UnpickableActor = Clutter.Actor;
let UILayerSampler = null;
let WindowCloneManager = null;
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
let ensureGlassAllocated = () => {};
let glassRefreshDue = null;
let glassRefreshDone = null;
let glassMarkDirty = null;
let glassNeedsStructureSync = null;
let glassForceRefresh = null;
let addGlassWakeListener = null;
let removeGlassWakeListener = null;
let isActorNearGlass = null;

const _LG_BASE = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist';

let _notifStyling = {
    blur: 15,
    tint: 20,
    shadow: 35,
    radius: 18,
};
let _stylingMonitor = null;

function _loadNotifStyling() {
    try {
        const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
        const [ok, bytes] = GLib.file_get_contents(confPath);
        if (ok) {
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (data.notification_blur !== undefined)
                _notifStyling.blur = Math.max(0, Math.min(60, Number(data.notification_blur)));
            else if (data.alert_blur !== undefined)
                _notifStyling.blur = Number(data.alert_blur);

            if (data.notification_tint !== undefined)
                _notifStyling.tint = Math.max(0, Math.min(100, Number(data.notification_tint)));
            else if (data.alert_tint !== undefined)
                _notifStyling.tint = Number(data.alert_tint);

            if (data.notification_shadow !== undefined)
                _notifStyling.shadow = Math.max(0, Math.min(100, Number(data.notification_shadow)));
            else if (data.alert_shadow !== undefined)
                _notifStyling.shadow = Number(data.alert_shadow);
            else if (data.spotlight_shadow !== undefined)
                _notifStyling.shadow = Number(data.spotlight_shadow);

            if (data.notif_radius !== undefined)
                _notifStyling.radius = Math.max(0, Math.min(48, Number(data.notif_radius)));
            else if (data.notification_radius !== undefined)
                _notifStyling.radius = Math.max(0, Math.min(48, Number(data.notification_radius)));
        }
        globalThis._macNotifBlurRadius = _notifStyling.blur;
    } catch (_) {}
}

function _getCardBaseStyle() {
    _loadNotifStyling();
    const tintVal = _notifStyling.tint / 100.0;
    const shadowVal = _notifStyling.shadow / 100.0;
    const radius = _notifStyling.radius || 18;

    let bg = (tintVal <= 0.01) ? 'transparent' : ('rgba(25, 28, 35, ' + (tintVal * 0.40).toFixed(2) + ')');

    let shadow = 'none';
    if (shadowVal > 0.02) {
        const sAlpha = (shadowVal * 0.45).toFixed(2);
        const sBlur = Math.round(6 + shadowVal * 20);
        const sY = Math.round(2 + shadowVal * 8);
        shadow = `0 ${sY}px ${sBlur}px rgba(0, 0, 0, ${sAlpha})`;
    }

    return `background-color: ${bg} !important; ` +
           `border: 1px solid rgba(255, 255, 255, 0.16) !important; ` +
           `border-top: 1px solid rgba(255, 255, 255, 0.22) !important; ` +
           `border-bottom: 1px solid rgba(255, 255, 255, 0.12) !important; ` +
           `border-radius: ${radius}px !important; ` +
           `box-shadow: ${shadow} !important; ` +
           `padding: 0 !important;`;
}

function _getToastContentStyle(noglass = false) {
    _loadNotifStyling();
    const tintVal = _notifStyling.tint / 100.0;
    const shadowVal = _notifStyling.shadow / 100.0;
    const radius = _notifStyling.radius || 18;

    let bg = noglass ? 'rgba(28, 30, 36, 0.92)' : ('rgba(25, 28, 35, ' + (tintVal * 0.40).toFixed(2) + ')');
    if (!noglass && tintVal <= 0.01) bg = 'transparent';

    let shadow = 'none';
    if (shadowVal > 0.02) {
        const sAlpha = (shadowVal * 0.45).toFixed(2);
        const sBlur = Math.round(6 + shadowVal * 20);
        const sY = Math.round(2 + shadowVal * 8);
        shadow = `0 ${sY}px ${sBlur}px rgba(0, 0, 0, ${sAlpha})`;
    }

    return `background-color: ${bg} !important; padding: 13px 10px 15px 14px !important; border-radius: ${radius}px !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; border-top: 1px solid rgba(255, 255, 255, 0.22) !important; border-bottom: 1px solid rgba(255, 255, 255, 0.12) !important; box-shadow: ${shadow} !important;`;
}

function _getSlabStyle(i, radius = 18) {
    _loadNotifStyling();
    const shadowVal = _notifStyling.shadow / 100.0;
    const rad = radius || _notifStyling.radius || 18;
    const bgAlpha = i === 1 ? '0.96' : '0.94';
    let shadow = 'none';
    if (shadowVal > 0.02) {
        const sAlpha = (shadowVal * 0.35).toFixed(2);
        const sBlur = Math.round(4 + shadowVal * 16);
        const sY = Math.round(2 + shadowVal * 6);
        shadow = `0 ${sY}px ${sBlur}px rgba(0, 0, 0, ${sAlpha})`;
    }
    return `background-color: rgba(36, 38, 44, ${bgAlpha}) !important; ` +
           `border: 1px solid rgba(255, 255, 255, 0.12) !important; ` +
           `border-top: 1px solid rgba(255, 255, 255, 0.16) !important; ` +
           `border-radius: ${rad}px !important; ` +
           `box-shadow: ${shadow} !important;`;
}

globalThis._macGetNotifCardStyle = _getCardBaseStyle;
const CARD_BASE_STYLE = _getCardBaseStyle();

import(_LG_BASE + '/liquidEffect.js').then(m => {
    if (m.LiquidEffect)
        LiquidEffect = m.LiquidEffect;
    try { _flushToastQueue(); } catch (_) {}
}).catch(e => {
    _toastGlassDead = true;
    console.warn(`[tahoe-nc] liquidEffect unavailable: ${e}`);
    try { _flushToastQueue(); } catch (_) {}
});

import(_LG_BASE + '/utils.js').then(m => {
    const _utilsDone = () => { try { _flushToastQueue(); } catch (_) {} };
    if (m.UnpickableActor)
        UnpickableActor = m.UnpickableActor;
    if (m.UILayerSampler)
        UILayerSampler = m.UILayerSampler;
    if (m.WindowCloneManager)
        WindowCloneManager = m.WindowCloneManager;
    if (m.setClipIfChanged)
        setClipIfChanged = m.setClipIfChanged;
    if (m.ensureGlassAllocated)
        ensureGlassAllocated = m.ensureGlassAllocated;
    if (m.syncGlassCaptureClip)
        syncGlassCaptureClip = m.syncGlassCaptureClip;
    if (m.glassRefreshDue)
        glassRefreshDue = m.glassRefreshDue;
    if (m.glassRefreshDone)
        glassRefreshDone = m.glassRefreshDone;
    if (m.glassMarkDirty)
        glassMarkDirty = m.glassMarkDirty;
    if (m.glassNeedsStructureSync)
        glassNeedsStructureSync = m.glassNeedsStructureSync;
    if (m.glassForceRefresh)
        glassForceRefresh = m.glassForceRefresh;
    if (m.addGlassWakeListener)
        addGlassWakeListener = m.addGlassWakeListener;
    if (m.removeGlassWakeListener)
        removeGlassWakeListener = m.removeGlassWakeListener;
    if (m.isActorNearGlass)
        isActorNearGlass = m.isActorNearGlass;
    _utilsDone();
}).catch(e => {
    _toastGlassDead = true;
    try { _flushToastQueue(); } catch (_) {}
    console.warn(`[tahoe-nc] liquid-glass utils unavailable: ${e}`);
});

const NC_W = 524;
const NC_RADIUS = 82;
const BACKDROP_PAD = 60;
const SHADER_PADDING = 20;


const TOAST_W = NC_W - 40;
const TOAST_X_PAD = 10;
const TOAST_Y_PAD = 8;
const TOAST_SPACING = 10;
const TOAST_MAX = 4;
const TOAST_ANIM_MS = 770;
const TOAST_TIMEOUT_MS = 6000;
const TOAST_TIMEOUT_CRITICAL_MS = 10000;
const TOAST_GONE_MS = 790;
const TOAST_PILL_CORNER = 40;

let _ = (m) => m;
let _nc = null;
let _cachedGlassStacks = null;
let _trayWasBlocked = false;
let _hooked = false;


let _toastBox = null;
let _toastStack = null;
let _toastTickId = 0;
let _toastsEnabled = false;
let _hookedToastSrc = new Set();
let _toastHookIds = [];
let _toastPending = [];
let _toastTimers = new Map();
let _toastGlassDead = false;
let _toastGlassFailedAt = 0;

function _lgSettings() {
    try {
        const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
        return ext?.stateObj?._settings || new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com' });
    } catch (_) {
        return null;
    }
}

function _makeGlassStack(monitor, radius, name, pure = false, edgePx = 0, noWin = false) {
    if (!LiquidEffect || !UnpickableActor || !UILayerSampler || !WindowCloneManager)
        throw new Error('liquid-glass modules not loaded yet');

    const bgActor = new UnpickableActor({ visible: false, opacity: 0 });
    bgActor.set_name(`liquid-glass-bg-actor-${name}`);
    bgActor.set_pivot_point(0, 0);
    bgActor.set_clip(0, 0, 0, 0);

    const liquidBox = new UnpickableActor();
    liquidBox.set_name(`liquid-box-${name}`);
    liquidBox.set_clip_to_allocation(true);
    bgActor.add_child(liquidBox);

    const dummy = new UnpickableActor();
    dummy.set_name('optimization-breaker');
    dummy.set_size(1, 1);
    dummy.set_opacity(0);
    liquidBox.add_child(dummy);

    let mirror = null;
    if (noWin) {
        mirror = new Clutter.Clone({source: Main.layoutManager._backgroundGroup});
        mirror.set_size(global.stage.width, global.stage.height);
        mirror.set_position(-monitor.x, -monitor.y);
        liquidBox.add_child(mirror);
    }

    const cloneContainer = new UnpickableActor();
    cloneContainer.set_name(`clone-container-${name}`);
    liquidBox.add_child(cloneContainer);

    const extensionPath = GLib.get_home_dir() +
        '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com';
    const effect = new LiquidEffect({
        extensionPath,
        settings: _lgSettings(),
        owner: `tahoe-nc-${name}`,
    });
    effect.setPadding(SHADER_PADDING);
    if (typeof effect.setShapeType === 'function')
        effect.setShapeType(0.0);
    else if (typeof effect._setFloat === 'function')
        effect._setFloat('shape_type', 0.0);
    effect.setCornerRadius(radius);
    effect.setIsDock(false);
    effect.setMultiRegionMode(true);
    effect.setBlurRadius(24.0);

    if (pure) {
        effect.setTintColor(0, 0, 0);
        effect.setTintStrength(0);
        effect.setBrightness(1.0);
        effect.setContrast(1.0);
        effect.setSaturation(1.0);
    } else {
        effect.setTintColor(0.16, 0.16, 0.18);
        effect.setTintStrength(0.12);
        effect.setBrightness(1.0);
        effect.setContrast(1.0);
        effect.setSaturation(1.0);
    }

    effect.setSurfaceLightEnabled(!pure);
    try {
        if (pure) {
            effect.setSurfaceLightEnabled(false);
            effect._setFloat('surface_light_enabled', 0.0);
            effect._setFloat('sheen_intensity', 0);
            effect._setFloat('rim_intensity', 0);
            effect._setFloat('rim_width', 0);
            effect._setFloat('ao_intensity', 0);
            effect._setFloat('specular_intensity', 0);
            effect._setFloat('displacement_scale', 0);
            effect._setFloat('chroma_strength', 0);
            effect._setFloat('edge_smoothing', edgePx > 0 ? edgePx : BACKDROP_PAD);
        } else {
            effect.setSurfaceLightEnabled(true);
            effect._setFloat('surface_light_enabled', 1.0);
            effect._setFloat('sheen_intensity', 0);
            effect._setFloat('rim_intensity', 0.08);
            effect._setFloat('rim_width', 5.0);
            effect._setFloat('rim_power', 6.0);
            effect._setFloat('displacement_scale', 0.02);
            effect._setFloat('edge_smoothing', 1.33);
        }
    } catch (_) {}

    liquidBox.add_effect(effect);





    const wcm = noWin
        ? null
        : new WindowCloneManager(liquidBox, cloneContainer, `lg-${name}`);
    const uiSampler = new UILayerSampler(bgActor, liquidBox,
        [global.windowGroup, global.window_group], cloneContainer, name,
        Main.panel ? [Main.panel] : []);
    if (wcm)
        wcm.rebuildClones();
    uiSampler.rebindSelf();
    uiSampler.refresh();

    return {
        kind: pure ? 'backdrop' : 'cards',
        bgActor, liquidBox, cloneContainer, effect,
        wcm: noWin ? null : wcm, uiSampler,
        lastRegions: null, lastBounds: null, grace: 0, clip: null, screen: null
    };
}

function _collect() {
    const items = [];
    try {
        const tray = Main.messageTray;
        if (!tray)
            return items;
        const sources = tray.getSources?.() ?? [];
        for (const src of sources) {
            let notifs = [];
            try {
                notifs = src.notifications ?? [];
            } catch (_) {
                continue;
            }
            for (const n of notifs)
                items.push({source: src, n});
        }
    } catch (_) {}



    const tOf = (it) => {
        const dt = it.n?.datetime;
        if (!dt)
            return 0;
        try {
            let t = dt.to_unix?.() ?? 0;
            t += (dt.get_microsecond?.() ?? 0) / 1e6;
            return t;
        } catch (_) {
            return 0;
        }
    };
    items.sort((a, b) => tOf(b) - tOf(a));
    return items;
}

function _activate(item) {
    try {
        for (const k of ['activate', 'invoke', 'open', 'launch']) {
            try {
                if (typeof item.n?.[k] === 'function') {
                    item.n[k]();
                    return;
                }
            } catch (_) {}
        }
    } catch (_) {}
    try {
        item.source?.app?.activate?.();
        return;
    } catch (_) {}
    try {
        item.n?.destroy?.();
    } catch (_) {}
}

function _makeMacCard(item, onCloseCb, width = NC_W - 40) {
    return buildNotificationCard(item.source, item.n, {
        sigma: 30,
        width,
        isBanner: false,
        onClose: (data) => {
            const card = data.banner;
            card.remove_all_transitions();

            card.ease({
                translation_x: 480,
                opacity: 0,
                duration: 220,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    try { item.n.destroy(2); } catch (_) {}
                    try { card.destroy(); } catch (_) {}
                    if (onCloseCb) onCloseCb();
                    _rebuild();
                },
            });
        },
        onClick: () => {
            try { _activate(item); } catch (_) {}
            closeNC();
        },
    });
}

function _clearAll() {
    const p = _nc;
    if (!p)
        return;
    const kids = p.list.get_children();
    if (!kids.length)
        return;

    let remaining = kids.length;

    kids.forEach((card, i) => {
        card.remove_all_transitions();
        card.ease({
            translation_x: 480,
            opacity: 0,
            delay: i * 35,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                try { card.destroy(); } catch (_) {}
                remaining--;
                if (remaining <= 0) {
                    try {
                        const tray = Main.messageTray;
                        for (const src of tray?.getSources?.() ?? []) {
                            for (const n of (src.notifications ?? []).slice()) {
                                try { n.destroy(2); } catch (_) {}
                            }
                        }
                    } catch (_) {}
                    _rebuild();
                    const empty = p.list.get_children().find(c => c.has_style_class_name?.('tahoe-nc-empty'));
                    if (empty) {
                        empty.opacity = 0;
                        empty.ease({
                            opacity: 255,
                            duration: 240,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    }
                }
            },
        });
    });
}

function _animateEnter(actor, idx = 0) {
    try {
        actor.remove_all_transitions();
        actor.opacity = 255;
        actor.translation_y = 0;
        actor.translation_x = 0;
    } catch (_) {}
}









let _toastCssLoaded = false;
function _ensureToastStyles() {
    if (_toastCssLoaded)
        return true;
    try {
        const St = imports.gi.St;
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (!theme)
            return false;
        const cssFile = Gio.File.new_for_path(
            `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/kiwi@kemma/apps/mac-toast.css`);
        theme.load_stylesheet(cssFile);
        _toastCssLoaded = true;
        return true;
    } catch (e) {
        console.warn(`[tahoe-nc] toast css failed: ${e}`);
        return false;
    }
}

function _toastDndOn() {
    try {
        const s = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        return !s.get_boolean('show-banners');
    } catch (_) {
        return false;
    }
}

function _clampText(s, n) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1).trimEnd() + '\u2026' : t;
}


const TOAST_INK = '#ffffff';
const TOAST_INK_SUB = 'rgba(255, 255, 255, 0.60)';
const TOAST_INK_RED = '#ff453a';


function _toastLabel(text, spec) {
    const l = new St.Label({
        text: _clampText(text, spec.max ?? 96),
        x_expand: !!spec.expand,
    });
    try { l.clutter_text.set_line_wrap(true); } catch (_) {}
    try { l.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD); } catch (_) {}
    try {
        l.style = `font-family: "${spec.fam || 'Default'}"; font-size: ${spec.size}px;`
            + ` font-weight: ${spec.weight ?? 500}; color: ${spec.color};`;
    } catch (_) {}
    return l;
}

function _ensureToastBox() {
    if (_toastBox)
        return true;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const panelH = Main.layoutManager.panelBox?.height ?? 32;

        _toastBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            clip_to_allocation: false,
            style: `spacing: ${TOAST_SPACING}px;`,
        });
        _toastBox.set_width(TOAST_W);
        _toastBox.set_position(
            monitor.x + monitor.width - TOAST_W - TOAST_X_PAD,
            monitor.y + panelH + TOAST_Y_PAD);
        _toastBox.set_name('tahoe-toast-area');
        Main.layoutManager.uiGroup.add_child(_toastBox);
        return true;
    } catch (e) {
        console.error(`[tahoe-nc] toast box failed: ${e}`);
        _toastBox = null;
        return false;
    }
}

function _toastSlotT(slot) {
    return 1.0;
}


function _toastRelTime(spawn) {
    try {
        const now = GLib.DateTime.new_now_local();
        const sec = Math.max(0, now.difference(spawn) / 1000000);
        if (sec < 60)
            return t('just_now', 'Щойно');
        const min = Math.floor(sec / 60);
        if (min < 60)
            return tf('min_ago', { min }, `${min} хв тому`);
        const hr = Math.floor(min / 60);
        return tf('hour_ago', { hour: hr }, `${hr} год тому`);
    } catch (_) {
        return t('just_now', 'Щойно');
    }
}

function _toastTimeStart(slot) {
    try {
        if (slot._timeId) {
            try { GLib.source_remove(slot._timeId); } catch (_) {}
            slot._timeId = 0;
        }
        if (!slot._spawnTime)
            slot._spawnTime = GLib.DateTime.new_now_local();
        const upd = () => {
            try {
                if (!slot._timeLabel)
                    return GLib.SOURCE_REMOVE;
                slot._timeLabel.text = _toastRelTime(slot._spawnTime);
                if (slot._leaving || slot._merging || !slot.get_parent())
                    return GLib.SOURCE_REMOVE;
            } catch (_) {
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        };
        slot._timeId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, upd);
    } catch (_) {}
}




function _makeToastCard(item, noglass = false) {
    const {source, n} = item;
    const urgency = (() => {
        try { return n.urgency ?? 1; } catch (_) { return 1; }
    })();
    const isCritical = urgency >= 2;

    const slot = new Clutter.Actor({
        clip_to_allocation: false,
    });
    slot.set_width(TOAST_W);



    const pill = new Clutter.Actor({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: false,
    });
    slot.add_child(pill);
    slot._pill = pill;

    const content = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        track_hover: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style: _getToastContentStyle(noglass),
    });
    try { content.set_reactive(true); } catch (_) {}
    try { content.set_width(TOAST_W); } catch (_) {}
    if (noglass) {
        try { content.add_style_class_name('mac-toast-noglass'); } catch (_) {}
    }
    pill.add_child(content);
    slot._content = content;
    slot._noglass = noglass;





    let gicon = null;
    try { gicon = n.gicon ?? null; } catch (_) {}
    try { if (!gicon) gicon = source.icon ?? null; } catch (_) {}
    try { if (!gicon) gicon = source.app?.get_icon?.() ?? null; } catch (_) {}

    try {
        if (!gicon) {
            const name = String(source?.title ?? '').trim();
            if (name && Shell.AppSystem) {
                const appSys = Shell.AppSystem.get_default();
                let app = appSys.lookup_app(`${name}.desktop`)
                    ?? appSys.lookup_app(`${name.toLowerCase()}.desktop`);
                if (!app) {
                    const lower = name.toLowerCase();
                    for (const cand of appSys.get_installed?.() ?? []) {
                        try {
                            const nm = String(cand.get_name() ?? '').toLowerCase();
                            const id = String(cand.get_id() ?? '').toLowerCase();
                            if (nm === lower || id.startsWith(`${lower}.`)) {
                                app = cand;
                                break;
                            }
                        } catch (_) {}
                    }
                }
                gicon = app?.get_app_info?.()?.get_icon?.()
                    ?? app?.get_icon?.() ?? null;
            }
        }
    } catch (_) {}
    if (!gicon) {
        try { gicon = source.createIcon?.(44) ?? null; } catch (_) {}
    }
    const iconTile = new St.Widget({
        width: 44,
        height: 44,
        y_align: Clutter.ActorAlign.CENTER,
        style: gicon ? 'border-radius: 10px;'
                     : 'background-color: rgba(28, 30, 36, 0.62); border-radius: 10px;',
        layout_manager: new Clutter.BinLayout(),
    });
    try { iconTile.set_clip_to_allocation(true); } catch (_) {}
    iconTile.add_child(gicon
        ? new St.Icon({gicon, icon_size: 44})
        : new St.Icon({
            icon_name: 'org.gnome.Settings-notifications-symbolic',
            icon_size: 22,
            style: 'color: #ffffff !important;',
        }));
    try { iconTile.style += 'margin-right: 12px;'; } catch (_) {}
    content.add_child(iconTile);


    const COL_W = TOAST_W - 24 - 44 - 12;
    const textCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
        style: 'spacing: 4px;',
    });
    content.add_child(textCol);

    const appName = String(source?.title ?? '').trim();
    const summary = String(n.title ?? '').trim();
    const body = String(n.body ?? '').trim();

    const rowA = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    if (isCritical) {
        rowA.add_child(_toastLabel(`⚠ ${t('urgent', 'ТЕРМІНОВО')}`, {color: TOAST_INK_RED, size: 13, weight: 700, max: 28, expand: true}));
    } else if (appName) {
        rowA.add_child(_toastLabel(appName, {color: '#ffffff', size: 12.5, weight: 700, max: 40, expand: true, ellip: true}));
    } else {
        const dummy = new St.Widget({x_expand: true});
        rowA.add_child(dummy);
    }
    const timeLabel = _toastLabel(t('just_now', 'Щойно'), {color: 'rgba(255, 255, 255, 0.55)', size: 12, weight: 500, max: 16, ellip: false});
    timeLabel.x_align = Clutter.ActorAlign.END;
    timeLabel.y_align = Clutter.ActorAlign.CENTER;
    timeLabel.style = (timeLabel.style || '') + ' margin-right: 0px !important;';
    rowA.add_child(timeLabel);
    slot._timeLabel = timeLabel;
    textCol.add_child(rowA);

    let summaryLabel = null;
    if (summary) {
        summaryLabel = _toastLabel(summary, {color: 'rgba(255, 255, 255, 0.95)', size: 13.5, weight: 400, max: 110});
        textCol.add_child(summaryLabel);
    }
    let bodyLabel = null;
    if (body) {
        bodyLabel = _toastLabel(body, {color: 'rgba(255, 255, 255, 0.78)', size: 12.5, weight: 400, max: 170});
        textCol.add_child(bodyLabel);
    }


    let actionsBox = null;
    if (item.n.actions && item.n.actions.length > 0) {
        actionsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            opacity: 0,
            style: 'margin-top: 6px; margin-bottom: 4px; spacing: 8px;',
        });
        const btnStyleBase = 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif; background-color: rgba(255, 255, 255, 0.16); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 9999px; padding: 4px 14px; font-size: 11.5px; font-weight: 500; margin-right: 6px;';
        const btnStyleHover = btnStyleBase.replace('0.16', '0.26').replace('0.14', '0.20');
        for (const action of item.n.actions) {
            const actBtn = new St.Button({
                label: action.label,
                reactive: true,
                can_focus: true,
                x_expand: false,
                style: btnStyleBase,
            });
            actBtn.connect('notify::hover', () => {
                actBtn.set_style(actBtn.hover ? btnStyleHover : btnStyleBase);
            });
            actBtn.connect('clicked', () => {
                try { action.activate(); } catch (e) { logError(e); }
                try { _dismissToast(slot); } catch (_) {}
            });
            actionsBox.add_child(actBtn);
        }
        textCol.add_child(actionsBox);
    }


    const closeBtn = new St.Button({
        opacity: 0,
        reactive: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        style: 'width: 22px !important; height: 22px !important; border-radius: 11px !important;'
            + ' background-color: rgba(255, 255, 255, 0.18) !important;'
            + ' border: 1px solid rgba(255, 255, 255, 0.14) !important; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25) !important; padding: 0 !important;'
            + ' margin: 0px !important;',
    });
    closeBtn.set_size(22, 22);
    closeBtn.min_width = 22;
    closeBtn.min_height = 22;
    closeBtn.translation_x = 6;
    closeBtn.translation_y = -6;
    try {
        closeBtn.set_child(new St.Label({
            text: '✕',
            style: 'font-size: 11px !important; color: rgba(255, 255, 255, 0.90) !important;'
                + ' font-weight: 600 !important; text-align: center !important;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    } catch (_) {}
    closeBtn.connect('notify::hover', () => {
        try {
            closeBtn.style = 'width: 22px !important; height: 22px !important; border-radius: 11px !important;'
                + (closeBtn.hover
                    ? ' background-color: rgba(255, 255, 255, 0.28) !important;'
                    : ' background-color: rgba(255, 255, 255, 0.18) !important;')
                + ' border: 1px solid rgba(255, 255, 255, 0.18) !important; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35) !important; padding: 0 !important;'
                + ' margin: 0px !important;';
        } catch (_) {}
    });
    pill.add_child(closeBtn);
    slot._closeBtn = closeBtn;
    closeBtn.connect('clicked', () => {
        try { _toastCloseClicked(item, slot); } catch (_) {}
    });












    const pangoH = (l, w) => {
        try {
            if (!l || !l.clutter_text)
                return 0;



            try { l.ensure_style(); } catch (_) {}
            const lay = l.clutter_text.get_layout();
            try {
                lay.set_wrap(Pango.WrapMode.WORD);
                lay.set_width(Math.max(1, Math.round(w)) * Pango.SCALE);
            } catch (_) {}
            const [, h] = lay.get_pixel_size();
            return isFinite(h) && h > 0 ? h : 0;
        } catch (_) {
            return 0;
        }
    };
    let rowH = 0;
    const rowKids = rowA?.get_children?.() ?? [];
    for (const rk of rowKids) {
        if (!rk.clutter_text)
            continue;
        const h = pangoH(rk, 160);
        if (h > rowH)
            rowH = h;
    }
    if (!(rowH > 0)) {
        try {
            rowH = 15;
        } catch (_) {}
    }
    let coldH = rowH;
    if (summaryLabel)
        coldH += 4 + pangoH(summaryLabel, COL_W);
    if (bodyLabel)
        coldH += 4 + pangoH(bodyLabel, COL_W);
    slot._bodyH = Math.max(72, Math.ceil(coldH + 30));
    slot.set_height(slot._bodyH);
    try { content.set_height(slot._bodyH); } catch (_) {}
    try { pill.set_height(slot._bodyH); } catch (_) {}




    const remeasure = (hovered = null) => {
        try {
            if (!slot || !slot.get_parent())
                return;
            const isHover = hovered !== null ? hovered : !!content.hover;
            const rows = [];
            for (const k of textCol.get_children()) {
                if (k === actionsBox && !isHover)
                    continue;
                try {



                    const [, h] = k.get_preferred_height(COL_W);
                    rows.push(isFinite(h) && h > 0 ? h : 0);
                } catch (_) {
                    rows.push(0);
                }
            }
            const count = rows.filter((v) => v > 0).length;
            const sum = rows.reduce((acc, v) => acc + v, 0);
            const total = 30 + sum + 4 * Math.max(0, count - 1);
            const target = Math.max(isHover && actionsBox ? 88 : 72, Math.ceil(total));
            if (Math.abs(target - slot._bodyH) > 1) {
                slot._bodyH = target;
                try {
                    if (slot._entered) {
                        try { slot.remove_transition('height'); } catch (_) {}
                        try { pill.remove_transition('height'); } catch (_) {}
                        try { content.remove_transition('height'); } catch (_) {}
                        slot.ease({
                            height: target,
                            duration: 180,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        });
                        pill.ease({
                            height: target,
                            duration: 180,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        });
                        content.ease({
                            height: target,
                            duration: 180,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        });
                    } else {
                        slot.set_height(target);
                        try { pill.set_height(target); } catch (_) {}
                        try { content.set_height(target); } catch (_) {}
                    }
                } catch (_) {
                    try { slot.set_height(target); } catch (_) {}
                }
            }
        } catch (_) {}
    };
    try {
        slot._r1 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            try { remeasure(); } catch (_) {}
            slot._r1 = 0;
            return GLib.SOURCE_REMOVE;
        });
        slot._r2 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 320, () => {
            try { remeasure(); } catch (_) {}
            slot._r2 = 0;
            return GLib.SOURCE_REMOVE;
        });
    } catch (_) {}


    try {
        content.connect('button-press-event', () => {
            try { _activate(item); } catch (_) {}
            try { _dismissToast(slot); } catch (_) {}
            return Clutter.EVENT_STOP;
        });
    } catch (_) {}


    try {
        const updateHover = () => {
            try {
                const h = !!content.hover || !!closeBtn.hover;
                const inM = h ? Clutter.AnimationMode.EASE_OUT_CUBIC : Clutter.AnimationMode.EASE_IN_CUBIC;
                closeBtn.ease({
                    opacity: h ? 255 : 0,
                    duration: 140,
                    mode: inM,
                });

                slot._timeLabel.opacity = 255;
                slot._timeLabel.visible = true;
                try { closeBtn.set_reactive(h); } catch (_) {}

                if (actionsBox) {
                    actionsBox.remove_all_transitions();
                    if (h) {
                        actionsBox.visible = true;
                        actionsBox.ease({
                            opacity: 255,
                            duration: 180,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    } else {
                        actionsBox.ease({
                            opacity: 0,
                            duration: 140,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                if (!content.hover && !closeBtn.hover) actionsBox.visible = false;
                            },
                        });
                    }
                }
                remeasure(h);

                if (h)
                    _toastLifeStop(slot);
                else if (!slot._leaving && !slot._merging)
                    _toastLifeStart(slot);
            } catch (_) {}
        };
        content.connect('notify::hover', updateHover);
        closeBtn.connect('notify::hover', updateHover);
    } catch (_) {}

    return slot;
}

function _toastLifeStart(slot) {
    let rec = _toastTimers.get(slot);
    if (!rec) {
        rec = {id: 0, baseMs: 0};
        _toastTimers.set(slot, rec);
    }
    if (rec.id)
        _toastLifeStop(slot);

    const base = rec.baseMs || (slot._critical ? TOAST_TIMEOUT_CRITICAL_MS : TOAST_TIMEOUT_MS);
    rec.baseMs = base;
    rec.id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, base, () => {
        try {
            const r = _toastTimers.get(slot);
            if (r) r.id = 0;
            try { _dismissToast(slot); } catch (_) {}
        } catch (_) {}
        return GLib.SOURCE_REMOVE;
    });
    _toastTimeStart(slot);
}

function _toastLifeStop(slot) {
    try {
        const rec = _toastTimers.get(slot);
        if (rec?.id) {
            try { GLib.source_remove(rec.id); } catch (_) {}
            rec.id = 0;
        }
    } catch (_) {}

}

function _toastClearTimers(slot) {
    _toastLifeStop(slot);
    for (const t of ['_timeId', '_r1', '_r2']) {
        try {
            if (slot?.[t]) {
                try { GLib.source_remove(slot[t]); } catch (_) {}
                slot[t] = 0;
            }
        } catch (_) {}
    }
    try { _toastTimers.delete(slot); } catch (_) {}
}

function _toastCloseClicked(item, slot) {
    try { _dismissToast(slot); } catch (_) {}
    try { item.n.destroy(2); } catch (_) {}
}

function _dismissToast(slot) {
    if (!slot || slot._leaving)
        return;
    slot._leaving = true;
    _toastLifeStop(slot);
    try {
        slot.remove_all_transitions();
        slot.ease({
            translation_x: TOAST_W + 30,
            opacity: 0,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                if (!slot._merging) {
                    _toastClearTimers(slot);
                    _destroyToastSlot(slot, false);
                }
            },
        });
    } catch (_) {
        _destroyToastSlot(slot, false);
    }
}



function _destroyToastSlot(slot, glide = true) {
    if (_toastBox && slot.get_parent() === _toastBox) {
        const kids = _toastBox.get_children();
        const i = kids.indexOf(slot);
        const below = i >= 0 ? kids.slice(i + 1) : [];
        let h = 0;
        try { h = slot.height; } catch (_) {}
        try { slot.remove_all_transitions(); } catch (_) {}
        try { slot.destroy(); } catch (_) {}
        if (glide) {
            for (const b of below) {
                try {
                    b.translation_y = h + TOAST_SPACING;
                    b.ease({
                        translation_y: 0,
                        duration: TOAST_ANIM_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUINT,
                    });
                } catch (_) {}
            }
        }
    } else {
        try { slot.remove_all_transitions(); } catch (_) {}
        try { slot.destroy(); } catch (_) {}
    }
}

function _showToast(item) {
    if (_nc || !_toastsEnabled)
        return false;
    const urgency = (() => {
        try { return item.n?.urgency ?? 1; } catch (_) { return 1; }
    })();
    if (urgency < 1)
        return false;
    if (_toastDndOn() && urgency < 2)
        return false;

    if (!_toastBox && !_ensureToastBox())
        return false;
    if (!_ensureToastGlass()) {


        if (!_toastGlassDead) {
            if (_toastPending.length < TOAST_MAX)
                _toastPending.push(item);
            return true;
        }
        _toastGlassFailedAt = Date.now();
    }


    const kids = _toastBox.get_children();
    if (kids.length >= TOAST_MAX) {

        let oldest = null;
        for (let i = kids.length - 1; i >= 0; i--) {
            if (!kids[i]._leaving && !kids[i]._merging) { oldest = kids[i]; break; }
        }
        if (!oldest)
            oldest = kids[kids.length - 1];
        try {
            if (oldest) {
                _toastClearTimers(oldest);
                _destroyToastSlot(oldest, false);
            }
        } catch (_) {}
    }

    const slot = _makeToastCard(item, !!_toastGlassDead);
    slot._critical = urgency >= 2;
    slot._nItem = item;
    _toastBox.insert_child_at_index(slot, 0);


    try {
        slot.translation_x = TOAST_W + 30;
        slot.opacity = 0;
        slot._content.opacity = 255;
        slot.remove_all_transitions();
        slot.ease({
            translation_x: 0,
            opacity: 255,
            duration: 280,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                slot._entered = true;
            },
        });
    } catch (_) {
        try {
            slot.translation_x = 0;
            slot.opacity = 255;
            slot._content.opacity = 255;
            slot.set_height(slot._bodyH);
        } catch (_) {}
        slot._entered = true;
    }

    _toastLifeStart(slot);
    _toastTickStart();
    try { item.n.acknowledged = true; } catch (_) {}
    return true;
}

function _flushToastQueue() {
    if (!_toastsEnabled)
        return;
    const queue = _toastPending.slice();
    _toastPending = [];
    for (const item of queue)
        _showToast(item);
    _toastTickStart();
}





function _applyWidgetGlassParams(effect) {
    if (!effect)
        return;
    _loadNotifStyling();
    let blur = _notifStyling.blur;
    let tintStrength = _notifStyling.tint / 100.0;
    try {
        const lgset = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com' });
        const r = _readIntSetting(lgset, 'notification-blur-radius', -1);
        if (r >= 0) blur = r;
    } catch (_) {}
    try { effect.setBlurRadius(blur); } catch (_) {}
    try { effect.setCornerRadius(_notifStyling.radius || 18); } catch (_) {}
    try { effect.setTintColor(0, 0, 0); } catch (_) {}
    try { effect.setTintStrength(tintStrength); } catch (_) {}
    try { effect.setBrightness(1.0); } catch (_) {}
    try { effect.setContrast(1.0); } catch (_) {}
    try { effect.setSaturation(1.0); } catch (_) {}
    try { effect.setSurfaceLightEnabled(true); } catch (_) {}
    try {
        effect._setFloat('sheen_intensity', 0);
        effect._setFloat('rim_intensity', 0.08);
        effect._setFloat('rim_width', 5.0);
        effect._setFloat('rim_power', 6.0);
        effect._setFloat('rim_directional_power', 2.7);
        effect._setFloat('rim_light_color_intensity', 1.4);
        effect._setFloat('specular_intensity', 0);
        effect._setFloat('displacement_scale', 20.0);
        effect._setFloat('ior', 1.50);
        effect._setFloat('chroma_strength', 0.0);
        effect._setFloat('edge_smoothing', 1.33);
        effect._setFloat('profile_shape_n', 5.40);
        effect._setFloat('max_z', 6.0);
    } catch (_) {}
}


function _readIntSetting(s, key, dflt) {
    try { return s.get_int(key); } catch (_) {}
    try { return s.get_uint(key); } catch (_) {}
    try { return Math.round(s.get_double(key)); } catch (_) {}
    try { return parseInt(String(s.get_string(key)), 10) || dflt; } catch (_) {}
    return dflt;
}



const _SCENE_WAKE_REASONS = new Set([
    'background', 'restacked', 'fullscreen', 'overview', 'layout',
    'overview-scroll', 'overview-transition', 'window-moved',
    'switch-workspace', 'size-change', 'minimize', 'unminimize',
    'destroy', 'active-workspace-changed', 'showing-desktop-changed',
]);

let _toastWakeUnsub = null;
function _hookToastWake() {
    if (_toastWakeUnsub || !addGlassWakeListener)
        return;
    _toastWakeUnsub = (damagedActor, reason) => {
        if (!_toastBox || _toastBox.get_children().length === 0 || !_toastStack)
            return;
        if (_SCENE_WAKE_REASONS.has(reason)) {
            _toastStack._structureDirty = true;
            glassForceRefresh?.(_toastStack.bgActor, 250);
            if (reason !== 'window-moved' && reason !== 'size-change') {
                try { _toastStack.wcm?.rebuildClones?.(); } catch (_) {}
                try { _toastStack.uiSampler?.rebindSelf?.(); } catch (_) {}
                try { _toastStack.uiSampler?.refresh?.(); } catch (_) {}
            }
            try { _toastStack.effect?.markBackdropDirty?.(); } catch (_) {}
            try { _toastStack.liquidBox?.queue_redraw?.(); } catch (_) {}
            try { _toastStack.bgActor?.queue_redraw?.(); } catch (_) {}
            _toastTickStart();
            return;
        }
        if (!damagedActor || isActorNearGlass?.(damagedActor, _toastBox) || isActorNearGlass?.(damagedActor, _toastStack.bgActor)) {
            if (glassMarkDirty)
                glassMarkDirty(_toastStack.bgActor);
            else
                glassForceRefresh?.(_toastStack.bgActor, 0);
            _toastTickStart();
        }
    };
    try {
        addGlassWakeListener(_toastWakeUnsub);
    } catch (_) {}
}

function _unhookToastWake() {
    if (_toastWakeUnsub) {
        try {
            removeGlassWakeListener?.(_toastWakeUnsub);
        } catch (_) {}
        _toastWakeUnsub = null;
    }
}

function _ensureToastGlass() {
    if (_toastStack)
        return true;
    if (_toastGlassDead)
        return false;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        if (!LiquidEffect || !UnpickableActor || !UILayerSampler || !WindowCloneManager)
            return false;
        const s = _makeGlassStack(monitor, 24, 'mac-toast-glass', true, 0, false);
        _applyWidgetGlassParams(s.effect);



        try { s.uiSampler?.addExclusion?.(_toastBox); } catch (_) {}
        _toastStack = s;
        Main.layoutManager.uiGroup.insert_child_below(s.bgActor, _toastBox);
        _hookToastWake();
        return true;
    } catch (e) {
        return false;
    }
}

function _destroyToastGlass() {
    _unhookToastWake();
    const s = _toastStack;
    _toastStack = null;
    if (!s)
        return;
    try { s.effect?.cleanup?.(); } catch (_) {}
    try { s.uiSampler?.destroy?.(); } catch (_) {}
    try { s.wcm?.destroy?.(); } catch (_) {}
    try { s.bgActor?.destroy?.(); } catch (_) {}
}



function _syncToastGlass(monitor, s) {
    if (!s || !_toastBox)
        return;
    try {
        const regions = [];
        let maxR = 24;
        for (const slot of _toastBox.get_children()) {
            try {
                const pill = slot._pill;
                if (!pill || slot._leaving)
                    continue;
                if (!slot.visible || slot.opacity <= 0)
                    continue;
                const pillW = TOAST_W;
                const pillH = Math.max(36, slot.height);
                pill.set_width(pillW);
                pill.set_height(pillH);
                pill.set_x(0);
                if (slot._content)
                    slot._content.set_x(0);
                const [gx, gy] = pill.get_transformed_position();
                if (!isFinite(gx) || !isFinite(gy) || !(pillW > 0))
                    continue;
                const P = SHADER_PADDING;
                const tintStrength = _notifStyling.tint / 100.0;
                regions.push({
                    x: gx - monitor.x - P, y: gy - monitor.y - P,
                    w: pillW + 2 * P, h: pillH + 2 * P,
                    tintR: 0, tintG: 0, tintB: 0, baseStrength: tintStrength,
                });
                const r = Math.min(24, pillH / 2);
                if (r > maxR)
                    maxR = r;
            } catch (_) {}
        }
        s.bgActor.set_position(monitor.x, monitor.y);
        if (!regions.length) {
            if (s.bgActor.visible)
                s.bgActor.hide();
            setClipIfChanged(s.bgActor, 0, 0, 0, 0);
            try { s.wcm?.applyBgCloneClip?.(null); } catch (_) {}
            return;
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const r of regions) {
            minX = Math.min(minX, r.x);
            minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.w);
            maxY = Math.max(maxY, r.y + r.h);
        }

        const P = Math.max(SHADER_PADDING + 48, 80);
        const clipX = Math.max(0, Math.floor(minX - P));
        const clipY = Math.max(0, Math.floor(minY - P));
        const clipW = Math.min(monitor.width - clipX, Math.ceil(maxX - clipX + 2 * P));
        const clipH = Math.min(monitor.height - clipY, Math.ceil(maxY - clipY + 2 * P));

        setClipIfChanged(s.bgActor, clipX, clipY, clipW, clipH);
        try { s.wcm?.applyBgCloneClip?.([clipX, clipY, clipW, clipH]); } catch (_) {}

        let maxSlotAlpha = 0;
        for (const slot of _toastBox.get_children()) {
            if (slot.visible && !slot._leaving && slot.opacity > maxSlotAlpha)
                maxSlotAlpha = slot.opacity;
        }
        const boxAlpha = _toastBox ? _toastBox.opacity : 255;
        const alpha = Math.min(boxAlpha, maxSlotAlpha > 0 ? maxSlotAlpha : 255);
        s.bgActor.opacity = alpha;
        s.bgActor.translation_x = _toastBox ? _toastBox.translation_x : 0;
        s.bgActor.translation_y = _toastBox ? _toastBox.translation_y : 0;

        let glassTint = [0, 0, 0], glassStrength = 0;
        const fill = {c: glassTint, a: glassStrength};
        for (const r of regions) {
            r.tintR = fill.c[0];
            r.tintG = fill.c[1];
            r.tintB = fill.c[2];
            r.baseStrength = fill.a;
        }

        const riding = _mergingSlots().length > 0;
        let extraH = regions.length ^ (Main.overview?.visible ? 1337 : 42);
        try {
            const ovVal = Main.overview?._controls?._stateAdjustment?.value;
            if (ovVal !== undefined)
                extraH = (extraH ^ (Math.round(ovVal * 100) * 10007)) | 0;
        } catch (_) {}
        for (const r of regions) {
            const dxh = riding ? 0 : (Math.round(r.x * 4) * 73856093);
            const dyh = riding ? 0 : (Math.round(r.y * 4) * 19349663);
            extraH = (extraH ^ dxh ^ dyh ^
                (Math.round(r.w * 4) * 83492791) ^ (Math.round(r.h * 4) * 2654435761)) | 0;
        }
        if (s._lastCornerRadius !== maxR) {
            s._lastCornerRadius = maxR;
            try { s.effect.setCornerRadius(maxR); } catch (_) {}
        }
        if (s._lastExtraH !== extraH || s._lastRegionCount !== regions.length) {
            s._lastExtraH = extraH;
            s._lastRegionCount = regions.length;
            s._structureDirty = true;
            s.effect.setGlassRegions(regions);
        }
        if (s._lastResW !== monitor.width || s._lastResH !== monitor.height) {
            s._lastResW = monitor.width;
            s._lastResH = monitor.height;
            s._structureDirty = true;
            s.effect.setResolution(monitor.width, monitor.height);
            s.liquidBox.set_position(0, 0);
            s.liquidBox.set_size(monitor.width, monitor.height);
        }
        if (alpha > 0 && !s.bgActor.visible)
            s.bgActor.show();
        else if (alpha === 0 && s.bgActor.visible)
            s.bgActor.hide();
        ensureGlassAllocated(s.bgActor);



        let doHeavy = true;
        try {
            doHeavy = glassRefreshDue ? glassRefreshDue(s.bgActor, extraH) : true;
        } catch (_) {
            doHeavy = true;
        }
        if (!doHeavy)
            return;
        const needStruct = !s._syncedOnce || s._structureDirty ||
            (glassNeedsStructureSync ? glassNeedsStructureSync(s.bgActor) : true);
        s._structureDirty = false;
        s._syncedOnce = true;
        if (needStruct) {
            if (s.wcm)
                s.wcm.setOffset(-monitor.x, -monitor.y);
            syncGlassCaptureClip({
                cloneContainer: s.cloneContainer,
                effect: s.effect,
                originX: monitor.x,
                originY: monitor.y,
                uiSampler: s.uiSampler,
                windowCloneManager: s.wcm,
            });
            ensureGlassAllocated(s.bgActor);
            s.uiSampler?.refresh();
            s.uiSampler?.sync(monitor.x, monitor.y, monitor.width, monitor.height);
            if (s.wcm)
                s.wcm.sync();
        }
        try {
            s.effect?.markBackdropDirty?.();
            s.liquidBox?.queue_redraw?.();
            s.bgActor?.queue_redraw?.();
            glassRefreshDone(s.bgActor, extraH);
        } catch (_) {}
    } catch (e) {
        console.error(`[tahoe-nc] _syncToastGlass error: ${e}\n${e?.stack || ''}`);
    }
}

function _toastTick() {
    _toastTickId = 0;
    try {
        if (!Main.layoutManager?.primaryMonitor || !_toastBox)
            return GLib.SOURCE_REMOVE;
        if (_toastStack)
            _syncToastGlass(Main.layoutManager.primaryMonitor, _toastStack);
        else if (_toastBox) {
            for (const slot of _toastBox.get_children()) {
                try {
                    const pill = slot._pill;
                    if (pill && !slot._merging) {
                        pill.set_width(TOAST_W);
                        pill.set_height(Math.max(36, slot.height));
                        pill.set_x(0);
                        if (slot._content)
                            slot._content.set_x(0);
                    }
                } catch (_) {}
            }
        }



        if (_toastBox.get_children().length === 0) {
            try { _toastStack?.effect?.setGlassRegions?.([]); } catch (_) {}
            try { setClipIfChanged(_toastStack?.bgActor, 0, 0, 0, 0); } catch (_) {}
            try { _toastStack?.wcm?.applyBgCloneClip?.(null); } catch (_) {}
            try { _toastStack?.bgActor?.hide?.(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        }
    } catch (e) {
        console.error(`[tahoe-nc] _toastTick error: ${e}\n${e?.stack || ''}`);
        return GLib.SOURCE_REMOVE;
    }
    _toastTickId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, _toastTick);
    return GLib.SOURCE_REMOVE;
}

function _toastTickStart() {
    if (_toastTickId)
        return;
    try {
        _toastTickId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, _toastTick);
    } catch (_) {
        _toastTickId = 0;
    }
}



function _onTrayToastNotification(source) {
    try {
        const notifs = source?.notifications ?? [];
        if (!notifs.length)
            return;
        const n = notifs[notifs.length - 1];
        try {
            if (n.urgency === MessageTray.Urgency.LOW)
                return;
        } catch (_) {}
        _showToast({source, n});
    } catch (_) {}
}

function _hookToastTray() {
    const hook = (obj, sig, fn) => {
        try {
            const id = obj.connect(sig, fn);
            if (id)
                _toastHookIds.push([obj, id]);
        } catch (_) {}
    };
    try {
        const tray = Main.messageTray;
        if (!tray)
            return;
        if (!_hookedToastSrc.has(tray)) {
            _hookedToastSrc.add(tray);
            hook(tray, 'source-added', (t, src) => {
                if (src && !_hookedToastSrc.has(src)) {
                    _hookedToastSrc.add(src);
                    hook(src, 'notification-added', () => _onTrayToastNotification(src));
                }
            });
        }
        const hookSource = (src) => {
            if (!src || _hookedToastSrc.has(src))
                return;
            _hookedToastSrc.add(src);
            hook(src, 'notification-added', () => _onTrayToastNotification(src));
        };
        try {
            for (const src of tray.getSources?.() ?? [])
                hookSource(src);
        } catch (_) {}
        if (Main.overview) {
            hook(Main.overview, 'showing', () => {
                try { if (_toastStack?.bgActor) glassForceRefresh?.(_toastStack.bgActor); } catch (_) {}
                _toastTickStart();
            });
            hook(Main.overview, 'hiding', () => {
                try { if (_toastStack?.bgActor) glassForceRefresh?.(_toastStack.bgActor); } catch (_) {}
                _toastTickStart();
            });
            hook(Main.overview, 'hidden', () => {
                try { if (_toastStack?.bgActor) glassForceRefresh?.(_toastStack.bgActor); } catch (_) {}
                _toastTickStart();
            });
            hook(Main.overview, 'shown', () => {
                try { if (_toastStack?.bgActor) glassForceRefresh?.(_toastStack.bgActor); } catch (_) {}
                _toastTickStart();
            });
        }
        if (global.display) {
            hook(global.display, 'restacked', () => {
                try { if (_toastStack?.bgActor) glassForceRefresh?.(_toastStack.bgActor); } catch (_) {}
                _toastTickStart();
            });
        }
    } catch (_) {}
}

function _unhookToastTray() {
    for (const entry of _toastHookIds) {
        try {
            if (Array.isArray(entry))
                entry[0]?.disconnect(entry[1]);
        } catch (_) {}
    }
    _toastHookIds = [];
    try { _hookedToastSrc.clear(); } catch (_) {}
}






function _mergingSlots() {
    if (!_toastBox)
        return [];
    try {
        return _toastBox.get_children().filter(s => s._merging && !s._leaving);
    } catch (_) {
        return [];
    }
}

function _finishMergedSlot(slot) {
    try {
        if (!slot || slot.is_finalized?.() || !slot._merging)
            return;
        try { slot.remove_all_transitions(); } catch (_) {}
        try { slot.translation_x = 0; slot.translation_y = 0; } catch (_) {}
        try { slot.opacity = 0; } catch (_) {}
        try { _toastClearTimers(slot); } catch (_) {}
        try { _destroyToastSlot(slot, false); } catch (_) {}
    } catch (_) {}
}

function _killMergingSlots() {
    for (const slot of _mergingSlots()) {
        try { _finishMergedSlot(slot); } catch (_) {}
    }
}




function _rideFindBanner(p, slot) {
    try {
        const cached = slot._rideBanner;
        if (cached && !cached.is_finalized?.() && cached.get_parent?.())
            return cached;
        slot._rideBanner = null;
        if (!p?.list || !slot._nItem?.n)
            return null;
        for (const cont of p.list.get_children()) {
            if (cont._macPeekGroup) {
                for (const b of cont._macPeekGroup.cards ?? []) {
                    if (b._notification === slot._nItem.n) {
                        slot._rideBanner = b;
                        return b;
                    }
                }
                continue;
            }
            if (cont._notification === slot._nItem.n) {
                slot._rideBanner = cont;
                return cont;
            }
        }
    } catch (_) {
        slot._rideBanner = null;
    }
    return null;
}


function _commitMergedBanners(p) {
    try {
        if (!p?.list)
            return;
        for (const cont of p.list.get_children()) {
            if (cont._macPeekGroup) {
                for (const b of cont._macPeekGroup.cards ?? []) {
                    if (b._isMergedToast)
                        try { b.opacity = 255; } catch (_) {}
                }
                continue;
            }
            if (cont._isMergedToast)
                try { cont.opacity = 255; } catch (_) {}
        }
    } catch (_) {}
}

function _takeToastMerges() {
    const merges = new Set();
    if (!_toastBox)
        return merges;
    const slots = _toastBox.get_children().filter(s => !s._leaving && !s._merging && s._nItem);
    if (!slots.length)
        return merges;

    for (const slot of slots) {
        slot._merging = true;
        slot.set_reactive(false);
        _toastLifeStop(slot);
        if (slot._nItem?.n)
            merges.add(slot._nItem.n);
        merges.add(slot._nItem);
        try { slot.remove_all_transitions(); } catch (_) {}

        try {
            const [nx, ny] = slot.get_transformed_position();
            slot._rideNat = isFinite(nx) && isFinite(ny) ? { x: nx, y: ny } : null;
        } catch (_) {
            slot._rideNat = null;
        }
        slot._rideBanner = null;
        slot._mergeAt = Date.now();


        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 420, () => {
            try {
                if (slot?._merging && !slot.is_finalized?.()) {
                    _commitMergedBanners(_nc);
                    _finishMergedSlot(slot);
                }
            } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });
    }
    _toastTickStart();
    return merges;
}


function _stackFadeK(s) {
    try {
        if (!s || !s._fadeT0)
            return 1;
        const k = Math.min(1, Math.max(0, (Date.now() - s._fadeT0) / Math.max(60, s._fadeMS ?? 240)));
        if (k >= 1) {
            s._fadeT0 = 0;
            s._fadeK = 1;
            return 1;
        }
        s._fadeK = k;
        return k;
    } catch (_) {
        return 1;
    }
}

function _startStackFade(s, ms = 240) {
    try { s._fadeT0 = Date.now(); s._fadeMS = ms; s._fadeK = 0; } catch (_) {}
}



const _NC_IDLE_PULSE_US = 1200000;

function _invalidateNcStacks(p, rebuild = false) {
    const stacks = p?.stacks;
    if (!stacks?.length)
        return;
    for (const s of stacks) {
        s._structureDirty = true;
        try { glassForceRefresh?.(s.bgActor, 250); } catch (_) {}
        if (rebuild) {
            try { s.wcm?.rebuildClones?.(); } catch (_) {}
            try { s.uiSampler?.rebindSelf?.(); } catch (_) {}
            try { s.uiSampler?.refresh?.(); } catch (_) {}
        }
        try { s.effect?.markBackdropDirty?.(); } catch (_) {}
        try { s.liquidBox?.queue_redraw?.(); } catch (_) {}
        try { s.bgActor?.queue_redraw?.(); } catch (_) {}
    }
    p._nextPixelPulseUs = GLib.get_monotonic_time() + _NC_IDLE_PULSE_US;
}

function _markNcStacksPixelDirty(p, damagedActor = null) {
    const stacks = p?.stacks;
    if (!stacks?.length)
        return;
    for (const s of stacks) {
        if (!s.bgActor?.visible)
            continue;
        if (damagedActor && isActorNearGlass && !isActorNearGlass(damagedActor, s.bgActor))
            continue;
        try {
            if (glassMarkDirty)
                glassMarkDirty(s.bgActor);
            else
                glassForceRefresh?.(s.bgActor, 0);
        } catch (_) {}
    }
}

function _hookNcWake(p) {
    if (!p || p.wakeUnsub || !addGlassWakeListener)
        return;
    p.wakeUnsub = (damagedActor, reason) => {
        if (!_nc || _nc !== p || p._closing || !p.overlay?.mapped)
            return;
        if (_SCENE_WAKE_REASONS.has(reason)) {
            const structuralRebuild = reason !== 'window-moved' && reason !== 'size-change';
            _invalidateNcStacks(p, structuralRebuild);
            return;
        }
        const nearPanel = !damagedActor ||
            isActorNearGlass?.(damagedActor, p.box) ||
            isActorNearGlass?.(damagedActor, p.panelBg);
        if (nearPanel)
            _markNcStacksPixelDirty(p, damagedActor);
    };
    try {
        addGlassWakeListener(p.wakeUnsub);
    } catch (_) {
        p.wakeUnsub = null;
    }
}

function _unhookNcWake(p) {
    if (!p?.wakeUnsub)
        return;
    try {
        removeGlassWakeListener?.(p.wakeUnsub);
    } catch (_) {}
    p.wakeUnsub = null;
}

function _setupNcStack(p, s, monitor = null) {
    try {
        try { s.uiSampler?.addExclusion?.(p.box); } catch (_) {}



        try { s.uiSampler?.addExclusion?.(p.overlay); } catch (_) {}
        for (const child of global.window_group?.get_children?.() ?? []) {
            if (child.meta_window?.get_gtk_application_id?.() === 'com.rastersoft.ding' ||
                child.meta_window?.get_title?.() === 'Desktop Icons 1' ||
                child.meta_window?.get_window_type?.() === 1) {
                try { s.uiSampler?.addExclusion?.(child); } catch (_) {}
            }
        }
        s.uiSampler?.rebindSelf?.();
        try { s.wcm?.rebuildClones?.(); } catch (_) {}
        try { glassForceRefresh?.(s.bgActor); } catch (_) {}
        try { s.effect?.markBackdropDirty?.(); } catch (_) {}

        if (monitor) {
            s.wcm?.setOffset(-monitor.x, -monitor.y);
            s.wcm?.setCullRect(null);
            s.uiSampler?.setCullRect(null);
            s.liquidBox.set_position(0, 0);
            s.liquidBox.set_size(monitor.width, monitor.height);
            s.effect.setResolution(monitor.width, monitor.height);
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                try {
                    s.uiSampler?.sync(monitor.x, monitor.y, monitor.width, monitor.height);
                    s.uiSampler?.refresh?.();
                    s.wcm?.sync?.();
                    s.effect?.markBackdropDirty?.();
                    s.bgActor?.queue_redraw?.();
                } catch (_) {}
                return GLib.SOURCE_REMOVE;
            });
        } else {
            s.uiSampler?.refresh?.();
        }
        return true;
    } catch (_) {
        return false;
    }
}




function _ensureNcCards(p) {
    try {
        if (!p || !p.overlay || !p.stacks)
            return false;
        if (p.stacks.some(s => s.kind === 'cards'))
            return false;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const cards = _makeGlassStack(monitor, _notifStyling.radius || 18, 'nc-cards', true);
        cards.kind = 'cards';
        try { _applyWidgetGlassParams(cards.effect); } catch (_) {}
        try {
            p.overlay.insert_child_at_index(cards.bgActor, 2);
        } catch (_) {
            try { p.overlay.add_child(cards.bgActor); } catch (_) {}
        }
        _setupNcStack(p, cards);
        cards.bgActor.opacity = 0;
        cards.bgActor.visible = false;
        p.stacks.push(cards);
        return true;
    } catch (_) {
        return false;
    }
}





function _ncRideTick(p) {
    try {
        const slots = _mergingSlots();
        if (!slots.length)
            return;
        const tx = Math.max(0, p?.box?.translation_x ?? 0);
        if (!(p._rideDone || tx <= 0.75)) {
            const prog = 1 - Math.min(1, tx / 480);
            const now = Date.now();
            for (const slot of slots) {
                try {
                    if (slot?._mergeAt && now - slot._mergeAt > 420)
                        continue;
                    const banner = _rideFindBanner(p, slot);
                    if (!banner || !slot._rideNat)
                        continue;
                    const [bx, by] = banner.get_transformed_position();
                    if (!isFinite(bx) || !isFinite(by))
                        continue;
                    slot.translation_x = prog * (bx - slot._rideNat.x);
                    slot.translation_y = prog * (by - slot._rideNat.y);
                } catch (_) {}
            }
            return;
        }

        for (const slot of slots) {
            try { _finishMergedSlot(slot); } catch (_) {}
        }
        _commitMergedBanners(p);
        p._rideDone = true;
    } catch (_) {}
}


function _ncSettle(p) {
    try {
        if (!p || p._settleDone)
            return;
        p._settleDone = true;
        try {
            p.box.min_height = 0;
            p.box.width = NC_W;
            p.panelBg.min_height = 0;
            p.panelBg.width = NC_W;
        } catch (_) {}
        _invalidateNcStacks(p, true);
        _ncRideTick(p);
    } catch (_) {}
}

function _destroyToasts() {
    _toastsEnabled = false;
    _toastPending = [];
    if (_toastTickId) {
        try { global.compositor.get_laters().remove(_toastTickId); } catch (_) {}
        _toastTickId = 0;
    }
    _toastClearTimersAll();
    try {
        if (_toastBox) {
            for (const slot of _toastBox.get_children()) {
                try { slot.remove_all_transitions(); } catch (_) {}
                try { slot.destroy(); } catch (_) {}
            }
            try { _toastBox.destroy(); } catch (_) {}
        }
    } catch (_) {}
    _toastBox = null;
    _destroyToastGlass();
}

function _toastClearTimersAll() {
    for (const slot of Array.from(_toastTimers.keys())) {
        try {
            const rec = _toastTimers.get(slot);
            if (rec?.id) {
                try { GLib.source_remove(rec.id); } catch (_) {}
            }
        } catch (_) {}
    }
    _toastTimers.clear();
}



function _animateEnterMerge(card, m) {
    try {
        card.remove_all_transitions();
        let fired = false;
        const tryFly = () => {
            if (fired)
                return true;
            try {
                if (!card.get_stage())
                    return false;
                const [cx, cy] = card.get_transformed_position();
                if (!isFinite(cx) || !isFinite(cy) || cx <= 0 || cy <= 0)
                    return false;
                fired = true;
                const diffX = m.x - cx;
                const diffY = m.y - cy;
                card.translation_x = diffX;
                card.translation_y = diffY;
                card.opacity = 255;
                card.ease({
                    translation_x: 0,
                    translation_y: 0,
                    duration: 320,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                return true;
            } catch (_) {
                return false;
            }
        };

        const id = card.connect('notify::allocation', () => {
            try {
                if (tryFly()) {
                    card.disconnect(id);
                }
            } catch (_) {}
        });

        for (const delay of [20, 60, 120, 200]) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                try { tryFly(); } catch (_) {}
                return GLib.SOURCE_REMOVE;
            });
        }
    } catch (_) {
        try { _animateEnter(card, 0); } catch (_) {}
    }
}

function _rebuild(merges = null) {
    const p = _nc;
    if (!p)
        return;



    try {
        if (merges === null && _mergingSlots().length && !p._rideDone) {
            _killMergingSlots();
            _commitMergedBanners(p);
            p._rideDone = true;
        }
    } catch (_) {}
    try {
        p.list.destroy_all_children();

        const allItems = _collect();

        if (!allItems.length) {
            const empty = new St.Label({
                style_class: 'tahoe-nc-empty',
                text: t('no_new_notifications', 'Немає нових повідомлень'),
            });
            try {
                empty.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            } catch (_) {}
            p.list.add_child(empty);
            return;
        }

        _ensureNcCards(p);




        let enterIdx = 0;
        for (const item of allItems) {
            const cardData = _makeMacCard(item, () => {
                if (p?.list && p.list.get_children().length === 0)
                    _rebuild();
            }, NC_W - 40);
            cardData.banner.x_align = Clutter.ActorAlign.CENTER;
            cardData.banner._notification = item.n;
            cardData.banner._macApp = String(item.source?.title ?? '').trim();

            const isMerged = merges && (merges.has(item.n) || merges.has(item));
            p.list.add_child(cardData.banner);
            if (isMerged) {


                cardData.banner._isMergedToast = true;
                cardData.banner.opacity = (p._rideDone || p._settleDone) ? 255 : 0;
            } else {
                _animateEnter(cardData.banner, enterIdx);
            }
            enterIdx++;
        }
        try { _collapseNcGroups(p, merges); } catch (ex) { console.error('[tahoe-nc] groups: ' + ex); }
        _syncNcHeight(p);
    } catch (e) {
        console.error(`[tahoe-nc] _rebuild error: ${e}`);
    }
}

function _ncHeldBox(p) {
    if (!p)
        return null;
    if (p._held)
        return p._held;
    try {
        const h = new Clutter.Actor();
        h.visible = false;
        global.stage.add_child(h);
        p._held = h;
        return h;
    } catch (e) {
        return null;
    }
}

function _buildGroupStack(g, p) {
    const newest = g.cards[0];
    let headH = newest.height;
    if (!(headH > 0) || headH > 1500) {
        try {
            const [, ph] = newest.get_preferred_height(NC_W - 40);
            if (ph > 0 && ph < 1500) headH = ph;
        } catch (_) {}
    }
    headH = Math.max(54, Math.ceil(headH) || 68);
    const W = NC_W - 40;
    const groupH = headH;

    const container = new St.Widget({
        reactive: true,
        can_focus: true,
        track_hover: true,
        x_expand: false,
        y_expand: false,
        width: W,
        height: groupH,
        min_height: groupH,
        x_align: Clutter.ActorAlign.CENTER,
        style: 'background-color: transparent !important; background: none !important; border: none !important; box-shadow: none !important;',
    });
    container._macPeekGroup = g;
    g.container = container;

    const held = new St.Widget({ visible: false, x_expand: false, y_expand: false });
    g.held = held;
    for (let i = 1; i < g.cards.length; i++) {
        const b = g.cards[i];
        if (b.get_parent() === p.list)
            p.list.remove_child(b);
        b.reactive = false;
        held.add_child(b);
    }
    container.add_child(held);

    if (newest.get_parent() === p.list)
        p.list.remove_child(newest);
    newest.x = 0;
    newest.y = 0;
    newest.translation_x = 0;
    newest.translation_y = 0;
    newest.set_scale(1, 1);
    newest.set_size(W, headH);
    newest.set_style(_getCardBaseStyle());
    try {
        const inner = (newest.get_children?.() ?? [])[0];
        if (inner)
            inner.visible = true;
    } catch (_) {}
    container.add_child(newest);

    const peersCount = g.cards.length - 1;
    if (peersCount > 0) {
        try {
            const mainBox = (newest.get_children?.() ?? [])[0];
            let iconTile = null;
            if (mainBox) {
                for (const c of mainBox.get_children?.() ?? []) {
                    if (c.layout_manager instanceof Clutter.BinLayout && c !== mainBox) {
                        iconTile = c;
                        break;
                    }
                }
            }
            if (iconTile) {
                try { iconTile.set_clip_to_allocation(false); } catch (_) {}
                try { mainBox.set_clip_to_allocation(false); } catch (_) {}
                try { newest.set_clip_to_allocation(false); } catch (_) {}
                const applyBadgeStyle = (b, cnt) => {
                    const str = `${cnt}`;
                    b.text = str;
                    b.visible = (cnt > 1);
                    const base = 'background-color: #ffffff !important; color: #000000 !important; font-size: 11px !important; font-weight: 700 !important; border-radius: 9999px !important; text-align: center; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.40) !important; margin: 0 !important; line-height: 18px !important;';
                    if (str.length <= 1) {
                        b.set_style(`${base} width: 18px !important; min-width: 18px !important; max-width: 18px !important; height: 18px !important; min-height: 18px !important; max-height: 18px !important; padding: 0 !important;`);
                        try { b.set_size(18, 18); } catch (_) {}
                    } else {
                        b.set_style(`${base} width: auto !important; min-width: 18px !important; max-width: none !important; height: 18px !important; min-height: 18px !important; max-height: 18px !important; padding: 0px 5px !important;`);
                        try { b.set_size(-1, 18); } catch (_) {}
                    }
                };
                if (!newest._macBadgeAdded) {
                    const badge = new St.Label({
                        x_align: Clutter.ActorAlign.END,
                        y_align: Clutter.ActorAlign.START,
                        translation_x: 6,
                        translation_y: -6,
                    });
                    applyBadgeStyle(badge, g.cards.length);
                    newest._macStackBadge = badge;
                    newest._macBadgeAdded = true;
                    iconTile.add_child(badge);
                } else if (newest._macStackBadge) {
                    applyBadgeStyle(newest._macStackBadge, g.cards.length);
                }
            }
        } catch (_) {}
    }

    try {
        newest.connect('notify::height', () => {
            try {
                if (container && !container.is_finalized?.() && container._macPeekGroup && !g.expanded) {
                    const curHeadH = newest.height;
                    container.set_height(curHeadH);
                    container.min_height = curHeadH;
                }
            } catch (_) {}
        });
    } catch (_) {}

    try {
        container.connect('button-press-event', () => {
            try { _expandGroup(g); } catch (_) {}
            return Clutter.EVENT_STOP;
        });
    } catch (_) {}
    newest._macGroupIntercept = () => _expandGroup(g);

    return container;
}






function _collapseNcGroups(p, merges = null) {
    if (!p || !p.list)
        return;
    const kids = p.list.get_children().filter((c) => !!c._notification);
    if (kids.length < 2)
        return;
    const gr = new Map();
    const order = [];
    for (const b of kids) {
        let app = String(b._macApp ?? '').trim() || t('notifications', 'Повідомлення');
        if (/знім|screenshot|screen\s*capture/i.test(app) ||
            /знім|screenshot/i.test(b._notification?.title || '') ||
            (b._notification?.source?.id && /screenshot/i.test(b._notification.source.id))) {
            app = t('screen_capture', 'Захоплення знімків екрана');
        }
        let g = gr.get(app);
        if (!g) {
            g = { app, cards: [], container: null, expanded: false, collapseBtn: null };
            gr.set(app, g);
            order.push(g);
        }
        g.cards.push(b);
    }
    const flat = [];
    for (const g of order) {
        if (g.cards.length <= 1) {
            flat.push(g.cards[0]);
            continue;
        }
        const container = _buildGroupStack(g, p);
        flat.push(container);
    }
    for (const b of kids.slice()) {
        if (b.get_parent() === p.list)
            try { p.list.remove_child(b); } catch (_) {}
    }
    let flatIdx = 0;
    const ridePending = _mergingSlots().length > 0 && !p._settleDone;
    for (const x of flat) {
        p.list.add_child(x);
        const isStack = !!x._macPeekGroup;
        const banner = isStack ? x.get_children()[x.get_children().length - 1] : x;
        const isMerged = banner && (banner._isMergedToast || (merges && (merges.has(banner._notification) || merges.has(banner._notification?.n))));
        if (banner) {
            if (isMerged) {
                banner._isMergedToast = true;
                banner.opacity = ridePending ? 0 : 255;
            } else {
                _animateEnter(banner, flatIdx);
            }
        }
        if (!isStack)
            flatIdx++;
    }
}

function _syncNcHeight(p) {
    if (!p || !p.box || !p.panelBg) return;
    try {
        const W = p.box.width || NC_W;
        const monitor = Main.layoutManager.primaryMonitor;
        const topBarH = Math.round(Main.layoutManager.panelBox?.height ?? 34);
        const startY = p.box.y > 0 ? p.box.y : ((monitor ? monitor.y : 0) + topBarH + 10);
        const screenBottom = monitor ? (monitor.y + monitor.height) : 800;
        const maxH = Math.max(200, screenBottom - startY - 20);

        let listH = 0;
        if (p.list) {
            const [, lh] = p.list.get_preferred_height(W - 28);
            let sumH = 0;
            const kids = p.list.get_children();
            for (let i = 0; i < kids.length; i++) {
                const kid = kids[i];
                if (!kid.visible) continue;
                const [, kh] = kid.get_preferred_height(W - 28);
                const actualH = Math.max(kh, kid.height || 0, 54);
                sumH += actualH + (i > 0 ? 10 : 0);
            }
            listH = Math.max(lh || 0, sumH);
        }
        const neededH = Math.max(70, listH + 70);
        const targetH = Math.min(maxH, neededH);

        if (p.scroll) {
            p.scroll.style = `max-height: ${maxH - 60}px; -st-vfade-offset: 0px;`;
        }

        p.box.min_height = 0;
        p.panelBg.min_height = 0;
        p.box.ease({
            height: targetH,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onUpdate: () => {
                try {
                    p.panelBg.set_size(p.box.width, p.box.height);
                    for (const s of p.stacks) {
                        if (s.kind === 'cards')
                            _syncCards(p, monitor, s);
                        else
                            _syncGlass(p, monitor, s);
                    }
                } catch (_) {}
            },
            onComplete: () => {
                try {
                    p.box.set_size(W, targetH);
                    p.panelBg.set_size(W, targetH);
                    for (const s of p.stacks) {
                        if (s.kind === 'cards')
                            _syncCards(p, monitor, s);
                        else
                            _syncGlass(p, monitor, s);
                    }
                } catch (_) {}
            }
        });
        p.panelBg.ease({
            height: targetH,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    } catch (e) {
        console.error('[tahoe-nc] _syncNcHeight: ' + e);
    }
}

function _expandGroup(g) {
    try {
        const cont = g?.container;
        if (!cont || g.expanded || cont.get_parent() !== _nc?.list)
            return;
        const p = _nc;
        g.expanded = true;
        let pos = p.list.get_children().indexOf(cont);
        if (pos < 0) return;

        p.list.remove_child(cont);

        if (g.cards[0]?._macStackBadge) {
            try { g.cards[0]._macStackBadge.visible = false; } catch (_) {}
        }

        for (let i = 0; i < g.cards.length; i++) {
            const b = g.cards[i];
            if (b.get_parent())
                b.get_parent().remove_child(b);
            b.reactive = true;
            try { b.remove_clip(); } catch (_) {}
            delete b._macHiddenPeer;
            b.set_style(_getCardBaseStyle());
            try {
                const inner = (b.get_children?.() ?? [])[0];
                if (inner)
                    inner.visible = true;
            } catch (_) {}
            b.remove_all_transitions();
            b.set_pivot_point(0.5, 0);
            b.set_scale(1, 1);
            b.translation_y = 0;
            b.opacity = 255;

            p.list.insert_child_at_index(b, pos + i);

            if (i > 0) {
                b.translation_y = -18;
                b.opacity = 0;
                b.ease({
                    translation_y: 0,
                    opacity: 255,
                    duration: 260,
                    delay: Math.min(120, (i - 1) * 30),
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        }

        const collapseBtn = new St.Button({
            style_class: 'tahoe-nc-collapse-btn',
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-top: 4px; margin-bottom: 8px; padding: 6px 18px; border-radius: 9999px; background-color: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.16); color: rgba(255, 255, 255, 0.90); font-size: 12.5px; font-weight: 500;',
        });
        const collapseBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style: 'spacing: 6px;',
        });
        collapseBox.add_child(new St.Icon({
            icon_name: 'pan-up-symbolic',
            icon_size: 12,
            style: 'color: rgba(255, 255, 255, 0.85);',
        }));
        collapseBox.add_child(new St.Label({
            text: t('collapse_stack', 'Згорнути'),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        collapseBtn.set_child(collapseBox);
        collapseBtn.connect('notify::hover', () => {
            try {
                collapseBtn.set_style(
                    collapseBtn.hover
                        ? 'margin-top: 4px; margin-bottom: 8px; padding: 6px 18px; border-radius: 9999px; background-color: rgba(255, 255, 255, 0.22); border: 1px solid rgba(255, 255, 255, 0.25); color: #ffffff; font-size: 12.5px; font-weight: 500;'
                        : 'margin-top: 4px; margin-bottom: 8px; padding: 6px 18px; border-radius: 9999px; background-color: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.16); color: rgba(255, 255, 255, 0.90); font-size: 12.5px; font-weight: 500;'
                );
            } catch (_) {}
        });
        collapseBtn.connect('clicked', () => {
            try { _collapseGroup(g); } catch (_) {}
        });

        p.list.insert_child_at_index(collapseBtn, pos + g.cards.length);
        g.collapseBtn = collapseBtn;

        try { cont.destroy(); } catch (_) {}
        g.container = null;
        g.held = null;
        _syncNcHeight(p);
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try { _syncNcHeight(p); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });
    } catch (e) {
        console.error('[tahoe-nc] expand: ' + e);
    }
}

function _collapseGroup(g) {
    try {
        const p = _nc;
        if (!p?.list || !g || !g.expanded)
            return;

        if (g.collapseBtn && g.collapseBtn.get_parent() === p.list) {
            try { p.list.remove_child(g.collapseBtn); } catch (_) {}
            try { g.collapseBtn.destroy(); } catch (_) {}
            g.collapseBtn = null;
        }

        let pos = -1;
        for (const card of g.cards) {
            if (card.get_parent() === p.list) {
                pos = p.list.get_children().indexOf(card);
                break;
            }
        }
        if (pos < 0) return;

        for (const card of g.cards) {
            if (card.get_parent() === p.list) {
                try { p.list.remove_child(card); } catch (_) {}
            }
        }

        g.expanded = false;

        if (g.cards[0]?._macStackBadge) {
            try { g.cards[0]._macStackBadge.visible = true; } catch (_) {}
        }

        const container = _buildGroupStack(g, p);
        p.list.insert_child_at_index(container, pos);
        _syncNcHeight(p);
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try { _syncNcHeight(p); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });
    } catch (e) {
        console.error('[tahoe-nc] collapse: ' + e);
    }
}

function _watchTray(p) {
    const hook = (obj, sig, fn) => {
        try {
            const id = obj.connect(sig, fn);
            if (id)
                p.trayIds.push([obj, id]);
        } catch (_) {}
    };
    const re = () => _rebuild();
    const hookSource = (src) => {
        hook(src, 'notification-added', re);
        hook(src, 'notification-removed', re);
        hook(src, 'notify::count', re);
    };
    hook(Main.messageTray, 'source-added', (t, src) => {
        hookSource(src);
        re();
    });
    hook(Main.messageTray, 'source-removed', re);
    try {
        for (const src of Main.messageTray.getSources?.() ?? [])
            hookSource(src);
    } catch (_) {}
}

function _widgetGlassFill() {
    _loadNotifStyling();
    const tintVal = _notifStyling.tint / 100.0;
    return {c: [0.10, 0.11, 0.14], a: tintVal};
}

function _cardFill() {
    return {c: [0, 0, 0], a: 0};
}

function _syncCards(p, monitor, s) {
    if (!s)
        return;
    try {
        const regions = [];
        let kids = [];
        let scrollY = -Infinity, scrollH = Infinity;
        if (p.scroll && p.scroll.mapped) {
            try {
                const [, sy] = p.scroll.get_transformed_position();
                const sh = p.scroll.height;
                if (isFinite(sy) && sh > 0) {
                    scrollY = sy;
                    scrollH = sh;
                }
            } catch (_) {}
        }
        try {
            for (const c of p.list.get_children()) {
                if (c._macPeekGroup) {
                    const g = c._macPeekGroup;
                    const newest = g.cards?.[0];
                    if (newest && newest.visible && newest.mapped && newest.opacity > 0) {
                        const [cx, cy] = newest.get_transformed_position();
                        const cw = newest.width, ch = newest.height;
                        if (cw > 0 && ch > 0 && isFinite(cx) && isFinite(cy)) {
                            if (isFinite(scrollY) && isFinite(scrollH)) {
                                if (cy + ch < scrollY - 20 || cy > scrollY + scrollH + 20)
                                    continue;
                            }
                            const m = SHADER_PADDING;
                            regions.push({
                                x: (cx - monitor.x) - m,
                                y: (cy - monitor.y) - m,
                                w: cw + m * 2,
                                h: ch + m * 2,
                                tintR: 0, tintG: 0, tintB: 0, baseStrength: _notifStyling.tint / 100.0,
                            });
                        }
                    }
                    continue;
                }
                kids.push(c);
            }
        } catch (_) {
            kids = [];
        }
        let maxR = 0;
        for (const card of kids) {
            try {
                if (card._macGroup && typeof card._macGroup.getGlassRegions === 'function') {
                    const gRegions = card._macGroup.getGlassRegions(monitor);
                    for (const r of gRegions) regions.push(r);
                    continue;
                }
                if (!card?.has_style_class_name?.('mac-notification-banner') && !card?.has_style_class_name?.('tahoe-nc-card'))
                    continue;
                if (!card.visible || !card.mapped || card.opacity <= 0)
                    continue;
                const [cx, cy] = card.get_transformed_position();
                const cw = card.width, ch = card.height;
                if (!(cw > 0) || !(ch > 0) || !isFinite(cx) || !isFinite(cy))
                    continue;

                if (isFinite(scrollY) && isFinite(scrollH)) {
                    if (cy + ch < scrollY - 20 || cy > scrollY + scrollH + 20)
                        continue;
                }

                const m = SHADER_PADDING;
                regions.push({
                    x: (cx - monitor.x) - m, y: (cy - monitor.y) - m,
                    w: cw + m * 2, h: ch + m * 2,
                    tintR: 0, tintG: 0, tintB: 0, baseStrength: _notifStyling.tint / 100.0,
                });
            } catch (_) {}
        }
        const [bx, by] = p.panelBg.get_transformed_position();
        const bw = p.panelBg.width, bh = p.panelBg.height;
        let ovX = monitor.x, ovY = monitor.y;
        try {
            const [gx, gy] = p.overlay.get_transformed_position();
            if (isFinite(gx)) ovX = gx;
            if (isFinite(gy)) ovY = gy;
        } catch (_) {}
        s.bgActor.set_position(monitor.x - ovX, monitor.y - ovY);
        if (!regions.length) {
            if (s.bgActor.visible)
                s.bgActor.hide();
            return;
        }
        const alpha = p.box.opacity * _stackFadeK(s);
        if (alpha > 0 && !s.bgActor.visible)
            s.bgActor.show();
        else if (alpha === 0 && s.bgActor.visible)
            s.bgActor.hide();
        s.bgActor.opacity = Math.round(Math.min(255, Math.max(0, alpha)));

        if (regions.length)
            maxR = _notifStyling.radius || 18;
        const fill = _widgetGlassFill();
        for (const r of regions) {
            r.tintR = fill.c[0];
            r.tintG = fill.c[1];
            r.tintB = fill.c[2];
            r.baseStrength = fill.a;
        }
        if (s._lastCornerRadius !== maxR) {
            s._lastCornerRadius = maxR;
            try { s.effect.setCornerRadius(maxR); } catch (_) {}
        }




        const isSliding = !p._settleDone || (p.box?.translation_x !== 0 && Math.abs(p.box?.translation_x ?? 0) > 0.5);
        let extraH = regions.length;
        for (const r of regions) {
            const dxh = isSliding ? 0 : (Math.round(r.x * 4) * 73856093);
            const dyh = isSliding ? 0 : (Math.round(r.y * 4) * 19349663);
            extraH = (extraH ^ dxh ^ dyh ^
                (Math.round(r.w * 4) * 83492791) ^ (Math.round(r.h * 4) * 2654435761)) | 0;
        }


        if (s._lastExtraH !== extraH || s._lastRegionCount !== regions.length) {
            s._lastExtraH = extraH;
            s._lastRegionCount = regions.length;
            s._structureDirty = true;
            s.effect.setGlassRegions(regions);
        }
        if (s._lastResW !== monitor.width || s._lastResH !== monitor.height) {
            s._lastResW = monitor.width;
            s._lastResH = monitor.height;
            s._structureDirty = true;
            s.effect.setResolution(monitor.width, monitor.height);
            s.liquidBox.set_position(0, 0);
            s.liquidBox.set_size(monitor.width, monitor.height);
        }
        if (isFinite(bx) && isFinite(by) && bw > 0 && bh > 0) {
            if (isFinite(scrollY) && isFinite(scrollH) && !isSliding) {
                setClipIfChanged(s.bgActor, bx - monitor.x - 200, scrollY - monitor.y, bw + 400, scrollH);
            } else {
                setClipIfChanged(s.bgActor, bx - monitor.x - 200, by - monitor.y - 200, bw + 400, bh + 400);
            }
        }
        ensureGlassAllocated(s.bgActor);



        if (isSliding)
            return;


        let doHeavy = true;
        try {
            doHeavy = glassRefreshDue ? glassRefreshDue(s.bgActor, extraH) : true;
        } catch (_) {
            doHeavy = true;
        }
        if (!doHeavy)
            return;
        const needStruct = !s._syncedOnce || s._structureDirty ||
            (glassNeedsStructureSync ? glassNeedsStructureSync(s.bgActor) : true);
        s._structureDirty = false;
        s._syncedOnce = true;
        if (needStruct) {
            s.wcm?.setOffset(-monitor.x, -monitor.y);
            syncGlassCaptureClip({
                cloneContainer: s.cloneContainer,
                effect: s.effect,
                originX: monitor.x,
                originY: monitor.y,
                uiSampler: s.uiSampler,
                windowCloneManager: s.wcm,
            });
            s.uiSampler?.refresh();
            s.uiSampler?.sync(monitor.x, monitor.y, monitor.width, monitor.height);
            s.wcm?.sync();
        }
        try {
            s.effect?.markBackdropDirty?.();
            s.liquidBox?.queue_redraw?.();
            s.bgActor?.queue_redraw?.();
            glassRefreshDone(s.bgActor, extraH);
        } catch (_) {}
    } catch (_) {}
}

function _syncGlass(p, monitor, s) {
    if (!s)
        return;
    try {
        const [bx, by] = p.panelBg.get_transformed_position();
        const bw = p.panelBg.width, bh = p.panelBg.height;
        if (!(bw > 0) || !(bh > 0) || !isFinite(bx) || !isFinite(by)) {
            if (s.bgActor.visible)
                s.bgActor.hide();
            return;
        }
        const m = BACKDROP_PAD;
        const [ovX, ovY] = p.overlay.get_transformed_position();
        const bgPosX = monitor.x - ovX;
        const bgPosY = monitor.y - ovY;
        if (s.bgActor.x !== bgPosX || s.bgActor.y !== bgPosY)
            s.bgActor.set_position(bgPosX, bgPosY);

        const alpha = Math.round(Math.min(255, Math.max(0, p.box.opacity * _stackFadeK(s))));
        if (alpha > 0 && !s.bgActor.visible)
            s.bgActor.show();
        else if (alpha === 0 && s.bgActor.visible)
            s.bgActor.hide();
        if (s.bgActor.opacity !== alpha)
            s.bgActor.opacity = alpha;
        if (s._lastResW !== monitor.width || s._lastResH !== monitor.height) {
            s.liquidBox.set_position(0, 0);
            s.liquidBox.set_size(monitor.width, monitor.height);
        }



        let rx = (bx - monitor.x) - m;
        let ry = (by - monitor.y) - m;
        let rw = bw + m * 2;
        let rh = bh + m * 2;
        let topEdge = 0;
        try {
            topEdge = Math.round(Main.layoutManager.panelBox?.height ?? 34) + 10;
        } catch (_) {
            topEdge = 44;
        }
        if (ry < topEdge) {
            const cut = topEdge - ry;
            ry = topEdge;
            rh -= cut;
        }
        const extraH = (((bw || 0) * 73856093) ^ ((bh || 0) * 19349663) ^
            (Math.round(rx) * 83492791) ^ (Math.round(ry) * 2654435761)) | 0;
        if (s._lastExtraH !== extraH) {
            s._lastExtraH = extraH;
            s._structureDirty = true;
            s.effect.setGlassRegions([{
                x: rx, y: ry,
                w: rw, h: rh,
                tintR: 0, tintG: 0, tintB: 0, baseStrength: (s.kind === 'backdrop' ? 0 : (_notifStyling.tint / 100.0)),
            }]);
        }
        if (s._lastResW !== monitor.width || s._lastResH !== monitor.height) {
            s._lastResW = monitor.width;
            s._lastResH = monitor.height;
            s._structureDirty = true;
            s.effect.setResolution(monitor.width, monitor.height);
        }

        const isSliding = !p._settleDone || (p.box?.translation_x !== 0 && Math.abs(p.box?.translation_x ?? 0) > 0.5);
        if (isSliding) {
            const targetX = (monitor.width - NC_W - 12) - m;
            const clipMinX = Math.min(rx, targetX) - 120;
            const clipMaxX = Math.max(rx + rw, targetX + rw) + 120;
            setClipIfChanged(s.bgActor, clipMinX, ry - 120, clipMaxX - clipMinX, rh + 240);
            ensureGlassAllocated(s.bgActor);
            return;
        }

        const clip = [rx - 200, ry - 200, rw + 400, rh + 400];
        setClipIfChanged(s.bgActor, clip[0], clip[1], clip[2], clip[3]);
        ensureGlassAllocated(s.bgActor);




        let doHeavy = true;
        try {
            doHeavy = glassRefreshDue ? glassRefreshDue(s.bgActor, extraH) : true;
        } catch (_) {
            doHeavy = true;
        }
        if (!doHeavy)
            return;
        const needStruct = !s._syncedOnce || s._structureDirty ||
            (glassNeedsStructureSync ? glassNeedsStructureSync(s.bgActor) : true);
        s._structureDirty = false;
        s._syncedOnce = true;
        if (needStruct) {
            s.wcm?.setOffset(-monitor.x, -monitor.y);
            syncGlassCaptureClip({
                cloneContainer: s.cloneContainer,
                effect: s.effect,
                originX: monitor.x,
                originY: monitor.y,
                uiSampler: s.uiSampler,
                windowCloneManager: s.wcm,
            });
            s.uiSampler?.refresh();
            s.uiSampler?.sync(monitor.x, monitor.y, monitor.width, monitor.height);
            s.wcm?.sync();
        }
        try {
            s.effect?.markBackdropDirty?.();
            s.liquidBox?.queue_redraw?.();
            s.bgActor?.queue_redraw?.();
            glassRefreshDone(s.bgActor, extraH);
        } catch (_) {}
    } catch (_) {}
}

function _applyNcInk() {
    const p = _nc;
    if (!p)
        return;
    try {
        const dark = getPanelInk() === 'light';
        for (const a of [p.box, p.panelBg]) {
            try {
                if (dark)
                    a.add_style_class_name('tahoe-qs-dark');
                else
                    a.remove_style_class_name('tahoe-qs-dark');
            } catch (_) {}
        }
    } catch (_) {}
}

function _buildPanel(merges = null) {
    const monitor = Main.layoutManager.primaryMonitor;
    const panelH = Main.layoutManager.panelBox?.height ?? 32;
    const W = NC_W;
    const X = monitor.x + monitor.width - W - 12;
    const Y = monitor.y + panelH + 10;
    const maxH = monitor.height - (panelH + 24);

    const overlay = new Clutter.Actor({
        reactive: true,
        x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height,
    });
    overlay._tahoeNCOverlay = true;
    overlay.connect('button-press-event', (actor, event) => {
        try {
            if (global.stage.get_event_actor(event) !== actor)
                return Clutter.EVENT_PROPAGATE;
        } catch (_) {
            return Clutter.EVENT_PROPAGATE;
        }
        closeNC();
        return Clutter.EVENT_PROPAGATE;
    });

    const isDark = (() => {
        try {
            return getPanelInk() === 'light';
        } catch (_) {
            return false;
        }
    })();
    const darkCls = isDark ? ' tahoe-qs-dark' : '';

    const panelBg = new St.Widget({
        style_class: `tahoe-qs-panelbg${darkCls}`,
        x_expand: false,
        y_expand: false,
    });
    panelBg.set_position(X, Y);
    panelBg.width = W;
    overlay.add_child(panelBg);

    const box = new St.BoxLayout({
        style_class: `tahoe-nc-panel${darkCls}`,
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_expand: false,
    });
    box.set_position(X, Y);
    box.width = W;
    overlay.add_child(box);


    const head = new St.BoxLayout({style_class: 'tahoe-nc-head'});
    const title = new St.Label({
        style_class: 'tahoe-nc-title-big',
        text: t('notification_center', 'Центр повідомлень'),
        x_expand: true,
        style: 'font-size: 17px !important; font-weight: 600 !important;',
    });
    const CLEAR_STYLE = 'background-color: rgba(255, 255, 255, 0.10) !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; border-radius: 9999px !important; padding: 4px 14px !important; color: #ffffff !important; font-size: 12px !important; font-weight: 500 !important; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18) !important;';
    const CLEAR_STYLE_HOVER = 'background-color: rgba(255, 255, 255, 0.20) !important; border: 1px solid rgba(255, 255, 255, 0.26) !important; border-radius: 9999px !important; padding: 4px 14px !important; color: #ffffff !important; font-size: 12px !important; font-weight: 500 !important; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22) !important;';
    const clear = new St.Button({
        style_class: 'tahoe-nc-clear',
        label: t('clear_all', 'Очистити все'),
        reactive: true,
        can_focus: true,
        style: CLEAR_STYLE,
    });
    clear.connect('notify::hover', () => {
        try {
            clear.set_style(clear.hover ? CLEAR_STYLE_HOVER : CLEAR_STYLE);
        } catch (_) {}
    });
    clear.connect('clicked', () => {
        try {
            _clearAll();
        } catch (_) {}
    });
    head.add_child(title);
    head.add_child(clear);
    box.add_child(head);

    const scroll = new St.ScrollView({
        style_class: 'tahoe-nc-scroll',
        x_expand: true,
        y_expand: true,
    });
    scroll.style = `max-height: ${maxH - 54}px; -st-vfade-offset: 0px;`;
    try {
        scroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
        scroll.hscrollbar_policy = St.PolicyType.NEVER;
        scroll.overlay_scrollbars = true;
        scroll.enable_mouse_scrolling = true;
        const vscroll = scroll.get_vscroll_bar?.();
        if (vscroll) {
            vscroll.opacity = 0;
            vscroll.width = 0;
            vscroll.hide?.();
        }
    } catch (_) {}

    const list = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'tahoe-nc-list',
        x_expand: true,
        y_expand: false,
    });
    scroll.add_child(list);
    box.add_child(scroll);

    Main.layoutManager.uiGroup.add_child(overlay);
    try {
        Main.layoutManager.uiGroup.set_child_below_sibling(overlay, Main.layoutManager.panelBox);
    } catch (_) {}

    const gbfEffect = null;

    const p = {
        overlay,
        box,
        panelBg,
        list,
        scroll,
        gbfEffect,
        stacks: [],
        trayIds: [],
        allocId: 0,
        tickId: 0,
        inkUnwatch: null,
        _closing: false,
    };
    _nc = p;

    try {
        p.inkUnwatch = watchInk(() => _applyNcInk());
    } catch (_) {
        p.inkUnwatch = null;
    }

    try {
        p.allocId = box.connect('notify::allocation', () => {
            try {
                panelBg.set_position(box.x, box.y);
                panelBg.set_size(box.width, box.height);
            } catch (_) {}
            try {
                for (const s of p.stacks) {
                    if (s.kind === 'cards')
                        _syncCards(p, monitor, s);
                    else
                        _syncGlass(p, monitor, s);
                }
            } catch (_) {}
        });
    } catch (_) {
        p.allocId = 0;
    }

    try {
        const vadj = scroll.get_vscroll_bar()?.get_adjustment();
        if (vadj) {
            const vadjId = vadj.connect('notify::value', () => {
                try {
                    for (const s of p.stacks || []) {
                        if (s.kind === 'cards')
                            _syncCards(p, monitor, s);
                    }
                } catch (_) {}
            });
            p.trayIds.push([vadj, vadjId]);
        }
    } catch (_) {}

    try {
        let bd, cards;
        if (_cachedGlassStacks && _cachedGlassStacks.length === 2) {
            bd = _cachedGlassStacks[0];
            cards = _cachedGlassStacks[1];
            _cachedGlassStacks = null;
        } else {
            bd = _makeGlassStack(monitor, NC_RADIUS, 'nc-backdrop', true, 0);
            bd.kind = 'backdrop';
            cards = _makeGlassStack(monitor, _notifStyling.radius || 18, 'nc-cards', true);
            cards.kind = 'cards';
        }

        // Keep backdrop diffuse without widget params
        overlay.insert_child_at_index(bd.bgActor, 1);
        try {
            overlay.set_child_above_sibling(panelBg, bd.bgActor);
        } catch (_) {}

        _setupNcStack(p, bd, monitor);
        bd.bgActor.opacity = 0;
        bd.bgActor.visible = false;
        bd.bgActor.translation_x = 0;
        bd.bgActor.translation_y = 0;

        try { _applyWidgetGlassParams(cards.effect); } catch (_) {}
        try {
            overlay.insert_child_at_index(cards.bgActor, 2);
        } catch (_) {
            try { overlay.add_child(cards.bgActor); } catch (_) {}
        }
        _setupNcStack(p, cards, monitor);
        cards.bgActor.opacity = 0;
        cards.bgActor.visible = false;
        cards.bgActor.translation_x = 0;
        cards.bgActor.translation_y = 0;

        p.stacks = [bd, cards];
        _invalidateNcStacks(p, true);
        _hookNcWake(p);

        const tick = () => {
            p.tickId = 0;
            if (!_nc || _nc !== p)
                return GLib.SOURCE_REMOVE;
            if (!p.overlay.mapped)
                return GLib.SOURCE_REMOVE;
            try {
                if (p.panelBg.opacity !== p.box.opacity)
                    p.panelBg.opacity = p.box.opacity;
                if (p.panelBg.translation_x !== p.box.translation_x)
                    p.panelBg.translation_x = p.box.translation_x;
            } catch (_) {}
            try {


                _ncRideTick(p);
                if (!p._settleDone &&
                    (p.box.translation_x ?? 0) <= 0.5 && (p.box.opacity ?? 0) >= 254)
                    _ncSettle(p);
            } catch (_) {}
            if (p._settleDone && !p._closing) {
                const nowUs = GLib.get_monotonic_time();
                if (!p._nextPixelPulseUs || nowUs >= p._nextPixelPulseUs) {
                    p._nextPixelPulseUs = nowUs + _NC_IDLE_PULSE_US;
                    for (const s of p.stacks) {
                        s._structureDirty = true;
                        try {
                            if (glassMarkDirty)
                                glassMarkDirty(s.bgActor);
                        } catch (_) {}
                    }
                }
            }
            try {
                for (const s of p.stacks) {
                    if (s.kind === 'cards')
                        _syncCards(p, monitor, s);
                    else
                        _syncGlass(p, monitor, s);
                }
            } catch (_) {}
            try {
                p.tickId = global.compositor.get_laters().add(
                    Meta.LaterType.BEFORE_REDRAW, tick);
            } catch (_) {
                p.tickId = 0;
            }
            return GLib.SOURCE_REMOVE;
        };
        try {
            p.tickId = global.compositor.get_laters().add(
                Meta.LaterType.BEFORE_REDRAW, tick);
        } catch (_) {
            p.tickId = 0;
        }
    } catch (e) {
        console.warn(`[tahoe-nc] glass stack unavailable (${e}), falling back to pure blur`);
        if (panelBg && !panelBg._fallbackBlur) {
            try {
                const blurEffect = new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: 24 });
                panelBg.add_effect_with_name('pure-blur-effect', blurEffect);
                panelBg._fallbackBlur = blurEffect;
                panelBg.style = 'background-color: rgba(32, 34, 42, 0.78); border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);';
            } catch (_) {}
        }
    }

    _watchTray(p);
    _rebuild(merges);

    try {
        const [, ph] = box.get_preferred_height(W);
        const initialPanelH = Math.min(maxH, Math.max(70, Math.ceil(ph)));
        box.set_size(W, initialPanelH);
        box.min_height = initialPanelH;
        panelBg.set_size(W, initialPanelH);
        panelBg.min_height = initialPanelH;
    } catch (_) {}




    try {
        box.set_pivot_point(1.0, 0.0);
        box.translation_x = 480;
        box.opacity = 0;
        panelBg.set_pivot_point(1.0, 0.0);
        panelBg.translation_x = 480;
        panelBg.opacity = 0;
        for (const s of p.stacks) {
            s.bgActor.opacity = 0;
            s.bgActor.visible = false;
            s.bgActor.translation_x = 0;
            s.bgActor.translation_y = 0;
        }
        box.ease({
            translation_x: 0,
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                try { _ncSettle(p); } catch (_) {}
            },
        });
        panelBg.ease({
            translation_x: 0,
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    } catch (_) {
        try {
            box.translation_x = 0;
            box.opacity = 255;
            panelBg.opacity = 255;
        } catch (_) {}
        try { _ncSettle(p); } catch (_) {}
    }
}

function _destroyNC(p) {
    if (!p)
        return;
    _nc = null;

    _unhookNcWake(p);
    try { _killMergingSlots(); } catch (_) {}
    try {
        if (p.inkUnwatch)
            p.inkUnwatch();
    } catch (_) {}
    try {
        for (const entry of p.trayIds) {
            try {
                if (Array.isArray(entry))
                    entry[0]?.disconnect(entry[1]);
            } catch (_) {}
        }
    } catch (_) {}
    try {
        if (p.allocId) {
            p.box.disconnect(p.allocId);
            p.allocId = 0;
        }
    } catch (_) {}
    if (p.tickId) {
        try {
            global.compositor.get_laters().remove(p.tickId);
        } catch (_) {}
        p.tickId = 0;
    }
    const stacks = p.stacks;
    p.stacks = [];
    if (!_cachedGlassStacks && stacks && stacks.length === 2) {
        for (const s of stacks) {
            try {
                if (s.bgActor?.get_parent())
                    s.bgActor.get_parent().remove_child(s.bgActor);
                s.bgActor.hide();
                s.bgActor.opacity = 0;
                s.bgActor.translation_x = 0;
                s.bgActor.translation_y = 0;
            } catch (_) {}
        }
        _cachedGlassStacks = stacks;
    } else {
        for (const s of stacks || []) {
            try { s.effect?.cleanup?.(); } catch (_) {}
            try { s.uiSampler?.destroy?.(); } catch (_) {}
            try { s.wcm?.destroy?.(); } catch (_) {}
            try { s.bgActor?.destroy?.(); } catch (_) {}
        }
    }
    try {
        p.gbfEffect?.detach?.();
        p.gbfEffect = null;
    } catch (_) {}
    try {
        p.scroll?.clear_effects?.();
    } catch (_) {}
    try {
        p.overlay.destroy();
    } catch (_) {}
}

export function getToastDebug() {
    return {
        _toastStack: !!_toastStack,
        _toastBox: !!_toastBox,
        _toastTickId,
        _toastPending: _toastPending.length,
        _toastsEnabled,
        kids: _toastBox ? _toastBox.get_children().map(k => ({
            visible: k.visible,
            opacity: k.opacity,
            h: k.height,
            w: k.width,
            _entered: k._entered,
            _pill: !!k._pill,
            _content: !!k._content
        })) : []
    };
}

export function isNCOpen() {
    try {
        return !!_nc && !_nc._closing;
    } catch (_) {
        return false;
    }
}

export function getNCPanelBox() {
    try {
        return _nc?.box ?? null;
    } catch (_) {
        return null;
    }
}

export function getNCOverlay() {
    try {
        return _nc?.overlay ?? null;
    } catch (_) {
        return null;
    }
}

export function ensurePrewarmed() {
    if (_cachedGlassStacks) return;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        const bd = _makeGlassStack(monitor, NC_RADIUS, 'nc-backdrop', true, 0);
        bd.kind = 'backdrop';
        const cards = _makeGlassStack(monitor, _notifStyling.radius || 18, 'nc-cards', true);
        cards.kind = 'cards';
        _cachedGlassStacks = [bd, cards];
    } catch (e) {
        console.warn('[tahoe-nc] ensurePrewarmed error:', e);
    }
}
globalThis._tahoeNCEnsurePrewarmed = ensurePrewarmed;

export function openNC() {
    if (_nc) {
        if (_nc._closing) {
            _destroyNC(_nc);
            _nc = null;
        } else {
            return;
        }
    }
    try {
        for (const ch of Main.layoutManager.uiGroup.get_children()) {
            if (ch._tahoeNCOverlay) {
                try { ch.destroy(); } catch (_) {}
            }
        }
    } catch (_) {}


    if (typeof globalThis._macCloseAllCenters === 'function') {
        globalThis._macCloseAllCenters('nc');
    } else {
        try { globalThis._tahoeQSClose?.(); } catch (_) {}
        try { globalThis._macSpotlightGlobalInstance?.close?.(true); } catch (_) {}
        try { globalThis._macClipboardGlobalInstance?.close?.(true); } catch (_) {}
        try {
            const qs = Main.panel?.statusArea?.quickSettings;
            if (qs?.menu?.isOpen)
                qs.menu.close(1);
        } catch (_) {}
        try {
            if (Main.panel?.menuManager?.activeMenu && Main.panel.menuManager.activeMenu !== Main.panel?.statusArea?.dateMenu?.menu) {
                Main.panel.menuManager.activeMenu.close(1);
            }
        } catch (_) {}
    }
    try {
        import('./tahoeControlCenter.js').then(mod => {
            try { mod.closePanel?.(); } catch (_) {}
        }).catch(() => {});
    } catch (_) {}


    try {
        globalThis._macNotificationCenter?._closeNotificationCenter?.();
    } catch (_) {}


    let merges = null;
    try {
        if (_toastsEnabled && _toastBox?.get_children().length)
            merges = _takeToastMerges();
    } catch (_) {}

    try {
        _buildPanel(merges);
    } catch (e) {
        console.error(`[tahoe-nc] open failed: ${e}`);
        try {
            closeNC();
        } catch (_) {}
    }
    try { globalThis._hideTahoeOSD?.(); } catch (_) {}
    globalThis._tahoeNCOpen = true;
}

export function closeNC(immediate = false) {
    const p = _nc;
    if (!p || p._closing)
        return;
    p._closing = true;
    _nc = null;

    globalThis._tahoeNCOpen = false;

    try { _killMergingSlots(); } catch (_) {}

    if (immediate) {
        _destroyNC(p);
        return;
    }

    try {
        const slideOffset = (p.box?.width || NC_W) + 40;
        p.box.remove_all_transitions();
        p.panelBg.remove_all_transitions();
        p.box.set_pivot_point(1.0, 0.0);
        p.panelBg.set_pivot_point(1.0, 0.0);
        try {
            for (const s of p.stacks || []) {
                try {
                    const bg = s?.bgActor;
                    if (!bg || (typeof bg.is_finalized === 'function' && bg.is_finalized()))
                        continue;
                    bg.remove_all_transitions();
                    bg.ease({
                        translation_x: slideOffset,
                        opacity: 0,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    });
                } catch (_) {}
            }
        } catch (_) {}
        try {
            p.panelBg.ease({
                translation_x: slideOffset,
                opacity: 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            });
        } catch (_) {}
        try {
            p.box.ease({
                translation_x: slideOffset,
                opacity: 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onComplete: () => {
                    _destroyNC(p);
                },
            });
        } catch (_) {
            _destroyNC(p);
        }
    } catch (_) {
        _destroyNC(p);
    }
}

export function toggleNC() {
    try {
        if (isNCOpen())
            closeNC();
        else
            openNC();
    } catch (e) {
        console.error(`[tahoe-nc] toggle failed: ${e}`);
    }
}

function _hookDate() {
    try {
        const dm = Main.panel?.statusArea?.dateMenu;
        const menu = dm?.menu;
        if (!menu)
            return;
        menu._tahoeNCHooked = true;
        menu.open = () => openNC();
        menu.close = () => closeNC();
        menu.toggle = () => toggleNC();
        Object.defineProperty(menu, 'isOpen', {
            get: () => isNCOpen(),
            configurable: true,
        });
        _hooked = true;
    } catch (_) {}
}

function _syncNotificationStyling() {
    _loadNotifStyling();
    const style = _getCardBaseStyle();


    if (_toastStack?.effect) {
        try { _applyWidgetGlassParams(_toastStack.effect); } catch (_) {}
        try { _toastStack.effect._queueRepaintIfDirty?.(); } catch (_) {}
    }
    if (_toastBox) {
        for (const slot of _toastBox.get_children()) {
            if (slot._content) {
                try { slot._content.set_style(_getToastContentStyle(slot._noglass)); } catch (_) {}
            }
        }
    }


    if (_nc) {
        for (const s of _nc.stacks ?? []) {
            if (s.effect) {
                try { _applyWidgetGlassParams(s.effect); } catch (_) {}
                try { s.effect._queueRepaintIfDirty?.(); } catch (_) {}
            }
        }
        if (_nc.list) {
            const blurRad = _notifStyling.blur || 15;
            for (const item of _nc.list.get_children()) {
                if (item._macPeekGroup) {
                    const g = item._macPeekGroup;
                    for (const slab of item.get_children()) {
                        if (slab._macIsSlab) {
                            try { slab.set_style(_getSlabStyle(slab._slabIdx || 1, _notifStyling.radius || 18)); } catch (_) {}
                        }
                    }
                    if (g.cards?.[0]) {
                        try { g.cards[0].set_style(style); } catch (_) {}
                        for (const eff of g.cards[0].get_effects?.() ?? []) {
                            if (eff instanceof Shell.BlurEffect || eff.name === 'mac-notif-card-blur') {
                                try { eff.radius = blurRad; } catch (_) {}
                            }
                        }
                    }
                } else if (item.has_style_class_name?.('mac-notification-banner') || item.has_style_class_name?.('tahoe-nc-card')) {
                    try { item.set_style(style); } catch (_) {}
                    for (const eff of item.get_effects?.() ?? []) {
                        if (eff instanceof Shell.BlurEffect || eff.name === 'mac-notif-card-blur') {
                            try { eff.radius = blurRad; } catch (_) {}
                        }
                    }
                }
            }
        }
    }
}
globalThis._macSyncNotificationStyling = _syncNotificationStyling;

export function enable(settings, gettextFunc) {
    if (typeof gettextFunc === 'function') {
        _ = (s) => {
            try {
                const res = gettextFunc(s);
                return typeof res === 'string' && res ? res : s;
            } catch (_) {
                return s;
            }
        };
    }



    try {
        const tray = Main.messageTray;
        if (tray) {
            try {
                _trayWasBlocked = !!tray.bannerBlocked;
            } catch (_) {
                _trayWasBlocked = false;
            }
            try {
                tray.bannerBlocked = true;
            } catch (_) {}
        }
    } catch (_) {}
    _hookDate();




    try { _ensureToastStyles(); } catch (_) {}
    _toastsEnabled = true;
    try { _hookToastTray(); } catch (_) {}
    try { _flushToastQueue(); } catch (_) {}




    globalThis.__tahoeNC = {
        isNCOpen, getNCPanelBox, getNCOverlay, openNC, closeNC, toggleNC,
    };
    globalThis._tahoeNCOpen = false;

    try {
        const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
        const confFile = Gio.File.new_for_path(confPath);
        if (_stylingMonitor) {
            try { _stylingMonitor.cancel(); } catch (_) {}
        }
        _stylingMonitor = confFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
        _stylingMonitor.connect('changed', () => {
            _syncNotificationStyling();
        });
    } catch (_) {}
}

export function disable() {
    if (_stylingMonitor) {
        try { _stylingMonitor.cancel(); } catch (_) {}
        _stylingMonitor = null;
    }
    try { if (_nc && _nc._held) { _nc._held.destroy(); _nc._held = null; } } catch (_) {}
    _ = (m) => m;
    try {
        const tray = Main.messageTray;
        if (tray && !_trayWasBlocked) {
            try { tray.bannerBlocked = false; } catch (_) {}
        }
    } catch (_) {}
    try {
        closeNC();
    } catch (_) {}
    if (_cachedGlassStacks) {
        for (const s of _cachedGlassStacks) {
            try { s.effect?.cleanup?.(); } catch (_) {}
            try { s.uiSampler?.destroy?.(); } catch (_) {}
            try { s.wcm?.destroy?.(); } catch (_) {}
            try { s.bgActor?.destroy?.(); } catch (_) {}
        }
        _cachedGlassStacks = null;
    }

    try {
        _unhookToastTray();
        _destroyToasts();
    } catch (_) {}
    try {
        const dm = Main.panel?.statusArea?.dateMenu;
        const menu = dm?.menu;
        if (menu && menu._tahoeNCHooked) {
            delete menu.open;
            delete menu.close;
            delete menu.toggle;
            delete menu._tahoeNCHooked;
        }
    } catch (_) {}
    _hooked = false;
    globalThis.__tahoeNC = null;
    globalThis._tahoeNCOpen = false;
}


globalThis._tahoeNCClose = closeNC;



globalThis._tahoeNCOpen = false;
globalThis._tahoeNCToggle = toggleNC;
