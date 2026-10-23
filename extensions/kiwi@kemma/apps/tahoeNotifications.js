// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe Notification Center (v5): замінює спливання календаря по кліку на дату.
// ЕТАП 2 — банери-тости у вигляді MacShell-main (перенесено СИМЕТРИЧНО 1:1):
//   • тост-колонка справа зверху під панеллю: 364px, відступ 10px зправа,
//     8px під панеллю, інтервал між тостами 10px, максимум 4 тости;
//   • картка тоста = точна копія NotifBody (MacShell): іконка 44×44
//     в (14,15), текст-колонка з x=70, ✕-кнопка 22×22 (r11) праворуч
//     зверху (10,10), з'являється при наведенні; шрифт Open Runde;
//   • ПОЯВА: пілюля → картка, 770мс EASE_OUT_QUINT — ширина 0.42→1,
//     зсув праворуч 46px→0, слот-висота 0.35→1, контент опак. pow 1.3;
//   • ЗНИКНЕННЯ: 770мс EASE_OUT_CUBIC назад у пілюлю (истрок, ✕, merge);
//   • життя 6с (критичні 10с, expireTimeout додатка враховано); наведення
//     ПАУЗА з перезапуском таймера (як Timer running у QML);
//   • стек: «великі» переміщення без стрибків — слот-висота тягне
//     решту плавно; видалення — glide translation_y 770мс OutQuint;
//   • MERGE у Центр: відкриття Центру при видимих тостах — тости
//     миттєво зникають, картки в Центрі стартують з їх позицій
//     (620мс EASE_OUT_QUINT, політ правого краю);
//   • DnD: show-banners=false ховає звичайні тости (критичні показує);
//   • активний клик = активація сповіщення + dismiss;
//   • скло: наш LiquidEffect стек 'mac-toast-glass' (мультирегіон),
//     тінт per-region, radius інтерполюється пілюлею.
// Центр повідомлень залишено БЕЗ ЗМІН (етап 1): слайд панелі 480→0 320мс
//     EASE_OUT_CUBIC / 260мс EASE_IN_CUBIC, каскад карток 240мс, каскад
//     «Очистити все» 220мс EASE_IN_CUBIC зі стагером 35мс, фейд
//     glass-бекдропів 320мс/260мс.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {getPanelInk, watchInk} from './tahoeInk.js';
import {closeAllCenters} from './centerManager.js';
import {
    buildNotificationCard,
} from './tahoeNotificationCard.js?v=notif_v15';

let LiquidEffect = null;
let UnpickableActor = Clutter.Actor;
let UILayerSampler = null;
let WindowCloneManager = null;
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
let ensureGlassAllocated = () => {};
let glassRefreshDue = null;
let glassRefreshDone = null;
let glassForceRefresh = null;

const _LG_BASE = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist';
const CARD_BASE_STYLE = 'background-color: rgba(0, 0, 0, 0) !important; border-top: 2px solid rgba(200, 200, 200, 0.50) !important; border-bottom: 2px solid rgba(200, 200, 200, 0.50) !important; border-left: none !important; border-right: none !important; border-radius: 24px !important; box-shadow: none !important; padding: 0 !important;';

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
    if (m.glassForceRefresh)
        glassForceRefresh = m.glassForceRefresh;
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

// --- Банери-тости (вигляд MacShell-main, етап 2) ---
const TOAST_W = NC_W - 40;        /* = 484: та сама ширина, що в карток Центру (NC_W 524 - 40) */
const TOAST_X_PAD = 10;           /* відступ від правого краю екрана */
const TOAST_Y_PAD = 8;            /* відступ під панеллю */
const TOAST_SPACING = 10;         /* інтервал між тостами */
const TOAST_MAX = 4;              /* максимум видимих тостів одночасно */
const TOAST_ANIM_MS = 770;        /* пілюля <-> картка (OutQuint вхід / OutCubic вихід) */
const TOAST_TIMEOUT_MS = 6000;    /* звичайні 6с */
const TOAST_TIMEOUT_CRITICAL_MS = 10000; /* критичні 10с */
const TOAST_GONE_MS = 790;        /* слот живе стільки після початку зникнення (goneTimer) */
const TOAST_PILL_CORNER = 40;     /* cornerR = min(24+(1-t)*40, h/2) */

let _ = (m) => m;
let _nc = null;
let _trayWasBlocked = false;
let _hooked = false;

// Тост-стан
let _toastBox = null;             /* St.BoxLayout колонка справа зверху */
let _toastStack = null;           /* glass stack (mac-toast-glass) */
let _toastTickId = 0;             /* BEFORE_REDRAW laters id */
let _toastsEnabled = false;       /* тости підключено */
let _hookedToastSrc = new Set();  /* джерела, на які вже підписані */
let _toastHookIds = [];           /* [obj, id] для disconnect */
let _toastPending = [];           /* черга тостів до готовності скла */
let _toastTimers = new Map();     /* slot -> {id, baseMs} */
let _toastGlassDead = false;      /* LG-модулі недоступні (fallback без скла) */
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

    const mirror = new Clutter.Clone({source: Main.layoutManager._backgroundGroup});
    mirror.set_size(global.stage.width, global.stage.height);
    mirror.set_position(-monitor.x, -monitor.y);
    liquidBox.add_child(mirror);

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

    effect.setSurfaceLightEnabled(true);
    try {
        if (pure) {
            effect._setFloat('sheen_intensity', 0);
            effect._setFloat('rim_intensity', 0);
            effect._setFloat('rim_width', 0);
            effect._setFloat('ao_intensity', 0);
            effect._setFloat('specular_intensity', 0);
            effect._setFloat('displacement_scale', 0);
            effect._setFloat('chroma_strength', 0);
            effect._setFloat('edge_smoothing', edgePx > 0 ? edgePx : BACKDROP_PAD);
        } else {
            effect._setFloat('sheen_intensity', 0);
            effect._setFloat('rim_intensity', 0.08);
            effect._setFloat('rim_width', 5.0);
            effect._setFloat('rim_power', 6.0);
            effect._setFloat('displacement_scale', 0.02);
            effect._setFloat('edge_smoothing', 1.33);
        }
    } catch (_) {}

    liquidBox.add_effect(effect);

    // noWin: без клонів вікон у протекторі шейдера (тости плавають на
    // яскравому столі - фрагменти вікон з тінями виглядають сірими
    // "елементами всередині скла" і перекривають сусідні тости;
    // заломлення лишається на шпалерах-дзеркалі та ui-канві)
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
    // Sort items by time (newest first); datetime гранулярна до
    // секунди, тому додаємо мікросекунди - иначе односекундні
    // пари сортувались за порядком трея і новіша ставала піром
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
            // Card dismiss animation from our theme: slide out 480px with EASE_IN_CUBIC
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
    // Clear All animation from our theme: staggered cascade slide-out to right with 35ms delay
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

// ═════════════════════════════════════════════════════════════════════
// БАНЕРИ-ТОСТИ (вигляд MacShell-main, перенесено 1:1)
// ═════════════════════════════════════════════════════════════════════

// ================================================================

// Живе підвантаження стилів тостів (GNOME читає stylesheet розширення
// тільки на reload, а тости оновлюються без-зло)
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

// ---- Ink-палiтра тостiв за iOS-референсом (i expectation user) ----
const TOAST_INK = '#ffffff';
const TOAST_INK_SUB = 'rgba(255, 255, 255, 0.60)';
const TOAST_INK_RED = '#ff453a';

// ---- рядок тексту тоста (стANNEL inline) ----
function _toastLabel(text, spec) {
    const l = new St.Label({
        text: _clampText(text, spec.max ?? 96),
        x_expand: !!spec.expand,
    });
    try { l.clutter_text.set_line_wrap(true); } catch (_) {}
    try { l.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD); } catch (_) {}
    try {
        l.style = `font-family: "${spec.fam || 'Open Runde'}"; font-size: ${spec.size}px;`
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
        // GNOME 50: spacing у St.BoxLayout — тільки CSS-властивiсть
        _toastBox = new St.BoxLayout({
            vertical: true,
            reactive: true,
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

// Вiднсний час iOS: Щойно / N хв тому / N год тому
function _toastRelTime(spawn) {
    try {
        const now = GLib.DateTime.new_now_local();
        const sec = Math.max(0, now.difference(spawn) / 1000000);
        if (sec < 60)
            return 'Щойно';
        const min = Math.floor(sec / 60);
        if (min < 60)
            return `${min} хв тому`;
        const hr = Math.floor(min / 60);
        return `${hr} год тому`;
    } catch (_) {
        return 'Щойно';
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

// Картка тоста — вигляд за референсом iOS: свiтле frosted-скло,
// темний текст, [⚠ ТЕРМIНОВО | застосунок] + час зверху, ✕ на
// наведеннi на мiсцi часу; iконка 44×44 вертикально по центру.
function _makeToastCard(item, noglass = false) {
    const {source, n} = item;
    const urgency = (() => {
        try { return n.urgency ?? 1; } catch (_) { return 1; }
    })();
    const isCritical = urgency >= 2;

    const slot = new Clutter.Actor();
    slot.set_width(TOAST_W);

    // pill — контейнер з clip: карта-контент праворуч звужується/
    // розкривається (механiка tslab + tcontent у MacShell)
    const pill = new Clutter.Actor({
        layout_manager: new Clutter.BinLayout(),
        clip_to_allocation: true,
    });
    slot.add_child(pill);
    slot._pill = pill;

    const content = new St.BoxLayout({
        vertical: false,
        track_hover: true,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style: 'background-color: rgba(0, 0, 0, 0) !important; padding: 14px 14px 16px 14px; border-radius: 24px; border-top: 2px solid rgba(200, 200, 200, 0.50) !important; border-bottom: 2px solid rgba(200, 200, 200, 0.50) !important; border-left: none !important; border-right: none !important; box-shadow: none !important;',
    });
    try { content.set_reactive(true); } catch (_) {}
    try { content.set_width(TOAST_W); } catch (_) {}
    if (noglass) {
        try {
            content.add_style_class_name('mac-toast-noglass');
            content.style += ` background-color: rgba(28, 30, 36, 0.92); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 24px;`;
        } catch (_) {}
    }
    pill.add_child(content);
    slot._content = content;

    // --- iконка 44×44 (fallback: акцентна плитка + дзвоник), по центру ---
    // іконка ХТО надіслав: gicon повідомлення -> source.icon ->
    // додаток джерела -> createIcon джерела. Без іконки - нейтральна
    // темна плитка (не акцентно-синя)
    let gicon = null;
    try { gicon = n.gicon ?? null; } catch (_) {}
    try { if (!gicon) gicon = source.icon ?? null; } catch (_) {}
    try { if (!gicon) gicon = source.app?.get_icon?.() ?? null; } catch (_) {}
    // назва джерела -> застосунок (cover -a python, snap-назви тощо)
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

    // --- прача колонка: [термiнове/застосунок .. час] + сумарi + тiло ---
    const textCol = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
        style: 'spacing: 4px;',
    });
    content.add_child(textCol);

    // Правий рейл 76px - та сама структура, що в карток Центру: час i ✕
    // лежать у ньому один над одним (BinLayout), крос-фейд при наведенні
    const rail = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        y_align: Clutter.ActorAlign.START,
    });
    rail.set_width(76);
    content.add_child(rail);

    const appName = String(source?.title ?? '').trim();
    const summary = String(n.title ?? '').trim();
    const body = String(n.body ?? '').trim();

    const rowA = new St.BoxLayout({vertical: false, x_expand: true});
    if (isCritical) {
        rowA.add_child(_toastLabel('⚠ ТЕРМIНОВО', {color: TOAST_INK_RED, size: 13, weight: 700, max: 28, expand: true}));
    } else if (appName) {
        rowA.add_child(_toastLabel(appName, {color: TOAST_INK_SUB, size: 12, weight: 600, max: 40, expand: true, ellip: true}));
    }
    const timeLabel = _toastLabel('Щойно', {color: 'rgba(255, 255, 255, 0.55)', size: 12, weight: 500, max: 16, ellip: true});
    timeLabel.x_align = Clutter.ActorAlign.END;
    timeLabel.y_align = Clutter.ActorAlign.START;
    textCol.add_child(rowA);
    rail.add_child(timeLabel);
    slot._timeLabel = timeLabel;

    let summaryLabel = null;
    if (summary) {
        summaryLabel = _toastLabel(summary, {color: TOAST_INK, size: 14, weight: 700, max: 110});
        textCol.add_child(summaryLabel);
    }
    let bodyLabel = null;
    if (body) {
        bodyLabel = _toastLabel(body, {color: TOAST_INK, size: 13, weight: 500, max: 170});
        textCol.add_child(bodyLabel);
    }

    // --- Кнопки дій тоста — приховані за замовчуванням, з'являються при hover ---
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
        const btnStyleBase = 'font-family: "Open Runde"; background-color: rgba(255, 255, 255, 0.16); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 9999px; padding: 4px 14px; font-size: 11.5px; font-weight: 500; margin-right: 6px;';
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

    // --- ✕ 22×22 оверлеєм у верхньому правому куті повідомлення ---
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
            + ' margin-top: 9px !important; margin-right: 9px !important;',
    });
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
                + ' margin-top: 9px !important; margin-right: 9px !important;';
        } catch (_) {}
    });
    pill.add_child(closeBtn);
    slot._closeBtn = closeBtn;
    closeBtn.connect('clicked', () => {
        try { _toastCloseClicked(item, slot); } catch (_) {}
    });

    // --- висота картки: ручний height-for-width. St.BoxLayout рахує
    // висоту за природною шириною лейблiв (до переносу), тому
    // вимiрюємо рядки напряму через Clutter.Text (вiн коректно
    // реалiзує height-for-width). Колонка = 344px - та сама, що в
    // карток Центру (484 - паддiнги 14x2 - iконка 44 - маржа 12 -
    // рейл 76), тому висоти тоста i картки збігаються. ---
    const COL_W = TOAST_W - 28 - 44 - 12 - 76;
    // висоти через Pango layout: Clutter.Text тримає той самий
    // лейаут, яким потім малює, тому висота піксельно збігається зі
    // стабільним рендером (get_preferred_height на неприйнятому
    // акторі повертає завищені значення -> зайвий висота картки)
    const pangoH = (l, w) => {
        try {
            if (!l || !l.clutter_text)
                return 0;
            // шрифт inline-стилю застосовується ліниво (на першому
            // малярстві) — наступивимо стиль синхронно, інакше лейаут
            // міряє дефолтним шрифтом (+~5px на рядок)
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

    // створення-time pref лейаут ще дефолтного шрифту (стиль лінивий) -
    // висоту перераховують ПІСЛЯ перших кадрів з фактичних prefH рядків
    // (інакше під текстом лишалось ~20px порожнього скла)
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
                    // строго по ширині колонки: get_preferred_height(-1)
                    // міряє рядок БЕЗ переносу - тіло з 2+ рядків
                    // стискається до одного -> еліпсис на кінці тексту
                    const [, h] = k.get_preferred_height(COL_W);
                    rows.push(isFinite(h) && h > 0 ? h : 0);
                } catch (_) {
                    rows.push(0);
                }
            }
            const count = rows.filter((v) => v > 0).length;
            const sum = rows.reduce((acc, v) => acc + v, 0);
            let total = 30 + sum + 4 * Math.max(0, count - 1);
            if (actionsBox && isHover) {
                total += 44; // ample breathing room for pill button
            }
            const target = Math.max(isHover && actionsBox ? 104 : 72, Math.ceil(total));
            if (Math.abs(target - slot._bodyH) > 1) {
                slot._bodyH = target;
                try { content.set_height(target); } catch (_) {}
                try {
                    if (slot._entered) {
                        try { slot.remove_transition('height'); } catch (_) {}
                        slot.ease({
                            height: target,
                            duration: 180,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        });
                    } else {
                        slot.set_height(target);
                        try { pill.set_height(target); } catch (_) {}
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

    // --- клiк по картцi = активацiя сповiщення + dismiss ---
    try {
        content.connect('button-press-event', () => {
            try { _activate(item); } catch (_) {}
            try { _dismissToast(slot); } catch (_) {}
            return Clutter.EVENT_STOP;
        });
    } catch (_) {}

    // --- наведення: час -> ✕ (крос-фейд), розкриття кнопок дій, пауза тоста ---
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
                slot._timeLabel.ease({
                    opacity: h ? 0 : 255,
                    duration: 140,
                    mode: inM,
                });
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
    // Timer running: false -> true у QML перезапускає вiдлiк з нуля
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
    // час НЕ призупиняється на паузi — вiн вiдбиває прiющий тост
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

// Знищення слота + плавний glide решти стеку вгору
// (MacShell: Column move-транзишн 770мс OutQuint)
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
        // скло ще не завантажилося — у чергу (як MacShell Loader);
        // якщо скло мертве (LG відсутнє) — показуємо без скла
        if (!_toastGlassDead) {
            if (_toastPending.length < TOAST_MAX)
                _toastPending.push(item);
            return true;
        }
        _toastGlassFailedAt = Date.now();
    }

    // глибина стеку — максимум 4 (найстаріший миттєво зникає)
    const kids = _toastBox.get_children();
    if (kids.length >= TOAST_MAX) {
        // діти: [найновіший ... найстаріший] — шукаємо найстаріший живий
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

    // ПОЯВА: виїзд з правої верхньої сторони (translation_x: TOAST_W + 30 -> 0)
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

// --- скло тостів: мультирегіон-стек LiquidEffect ---


// === Скло тостів = точний конфіг віджетів робочого столу
// (tahoe-widgets@micronix): той самий .frag, слабкий тінт користувача,
// refraction ior 2.4 / displacement 92 / rim-набір. Головне — НЕ наш
// білий тінт: фон картки дає лишей шейдер скла.
function _applyWidgetGlassParams(effect) {
    if (!effect)
        return;
    let tint = [0.16, 0.16, 0.18], strength = 0.12, blur = 4, sat = 1.0;
    try {
        const sset = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.tahoe-widgets' });
        try {
            const raw = String(sset.get_string('glass-tint') || '');
            const nums = raw.match(/[\d.]+/g);
            if (nums && nums.length >= 3) {
                const c = nums.slice(0, 3).map((x) => Math.min(1, Math.max(0, parseFloat(x) / 255)));
                if (c.every((v) => isFinite(v)))
                    tint = c;
            }
        } catch (_) {}
        try { strength = Math.min(1, Math.max(0, _readIntSetting(sset, 'glass-tint-strength', 12) / 100)); } catch (_) {}
        try { blur = Math.min(60, Math.max(0, _readIntSetting(sset, 'glass-blur', blur))); } catch (_) {}
        try { sat = Math.min(2, Math.max(0.2, _readIntSetting(sset, 'glass-saturation', 100) / 100)); } catch (_) {}
    } catch (_) {}
    // для фону з вікнами беремо свій notification-blur (8) - саме
    // його LiquidGlass-автори поставили для банерів
    try {
        const lgset = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.liquid-glass' });
        blur = Math.min(60, Math.max(0, _readIntSetting(lgset, 'notification-blur-radius', 8)));
    } catch (_) {}
    try { effect.setBlurRadius(blur); } catch (_) {}
    try { effect.setTintColor(tint[0], tint[1], tint[2]); } catch (_) {}
    try { effect.setTintStrength(strength); } catch (_) {}
    try { effect.setBrightness(1.0); } catch (_) {}
    try { effect.setContrast(1.0); } catch (_) {}
    try { effect.setSaturation(sat); } catch (_) {}
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

// int-зчитування з партнерського schem'я (int/uint/double як є)
function _readIntSetting(s, key, dflt) {
    try { return s.get_int(key); } catch (_) {}
    try { return s.get_uint(key); } catch (_) {}
    try { return Math.round(s.get_double(key)); } catch (_) {}
    try { return parseInt(String(s.get_string(key)), 10) || dflt; } catch (_) {}
    return dflt;
}


// стек скла тостів: LiquidEffect + WindowCloneManager + UILayerSampler
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
        const s = _makeGlassStack(monitor, 24, 'mac-toast-glass', false, 0, false);
        _applyWidgetGlassParams(s.effect);
        // тости НЕ мають заломлюватись у власному склі: UILayerSampler
        // клонує всіх дітей uiGroup, тому без виключення самі слоти
        // (іконка/текст) потрапляють у каптур і «сяють» у шейдері
        try { s.uiSampler?.addExclusion?.(_toastBox); } catch (_) {}
        _toastStack = s;
        Main.layoutManager.uiGroup.insert_child_below(s.bgActor, _toastBox);
        return true;
    } catch (e) {
        return false;
    }
}

function _destroyToastGlass() {
    const s = _toastStack;
    _toastStack = null;
    if (!s)
        return;
    try { s.effect?.cleanup?.(); } catch (_) {}
    try { s.uiSampler?.destroy?.(); } catch (_) {}
    try { s.wcm?.destroy?.(); } catch (_) {}
    try { s.bgActor?.destroy?.(); } catch (_) {}
}

// Екран тост-скла: регіон на кожен pill (схема _syncCards Центру)
// + інтерполяція cornerR пілюлі спільним стеком
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
                regions.push({
                    x: gx - monitor.x - P, y: gy - monitor.y - P,
                    w: pillW + 2 * P, h: pillH + 2 * P,
                    tintR: 0, tintG: 0, tintB: 0, baseStrength: 0,
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
            return;
        }
        const alpha = _toastBox ? _toastBox.opacity : 255;
        if (alpha > 0 && !s.bgActor.visible)
            s.bgActor.show();
        else if (alpha === 0 && s.bgActor.visible)
            s.bgActor.hide();
        s.bgActor.opacity = alpha;
        s.bgActor.translation_x = _toastBox ? _toastBox.translation_x : 0;
        s.bgActor.translation_y = _toastBox ? _toastBox.translation_y : 0;
        // єдиний тінт скла 12% [0.16, 0.16, 0.18], розмиття, заломлення
        let glassTint = [0.16, 0.16, 0.18], glassStrength = 0.12;        try {
            const sset = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.tahoe-widgets' });
            const raw = String(sset.get_string('glass-tint') || '');
            const nums = raw.match(/[\d.]+/g);
            if (nums && nums.length >= 3) {
                const c = nums;
                if (c && c.length >= 3) {
                    const cc = c.slice(0, 3).map((x) => Math.min(1, Math.max(0, parseFloat(x) / 255)));
                    if (cc.every((v) => isFinite(v)))
                        glassTint = cc;
                }
            }
            glassStrength = Math.min(1, Math.max(0, _readIntSetting(sset, 'glass-tint-strength', 12) / 100));
        } catch (_) {}
        const fill = {c: glassTint, a: glassStrength};
        for (const r of regions) {
            r.tintR = fill.c[0];
            r.tintG = fill.c[1];
            r.tintB = fill.c[2];
            r.baseStrength = fill.a;
        }
        // [GPU-SAVE] Extras-хеш регіонів тостів: зміщення тостів (висування/
        // згортання стосу, злива HOSTING) та стан Overview миттєво рахуються як зміна скла.
        // RIDE: поки злиті тости летять у Центр, їхні регіони змінюються
        // щокадрово — рух тоста не рахуємо за «зміну сцени», важка частина
        // повернеться одразу після settle.
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
        try { s.effect.setCornerRadius(maxR); } catch (_) {}
        s.effect.setGlassRegions(regions);
        s.effect.setResolution(monitor.width, monitor.height);
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(monitor.width, monitor.height);
        setClipIfChanged(s.bgActor, 0, 0, monitor.width, monitor.height);
        ensureGlassAllocated(s.bgActor);
        // [GPU-SAVE] Важку частину виконуємо тільки коли фон дійсно змінився
        // (регіони/геометрія/opacity тост змінилися як extras), межа 60 FPS;
        // у спокої скло тостів не перемалюється взагалі.
        let doHeavy = true;
        try {
            doHeavy = glassRefreshDue ? glassRefreshDue(s.bgActor, extraH) : true;
        } catch (_) {
            doHeavy = true;
        }
        if (!doHeavy)
            return;
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
        try {
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
        // коли останній тост зник - НЕ лишати скло висіти з
        // застиглим регіоном/кадром (інакше на столі "сяє" привид
        // останнього банера): чищаємо регіони і ховаємо стек
        if (_toastBox.get_children().length === 0) {
            try { _toastStack?.effect?.setGlassRegions?.([]); } catch (_) {}
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

// --- підключення до MessageTray (notification-added -> тости) ---

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

// --- MERGE у Центр: тости віддають позиції карткам Центру ---
// RIDE: замість короткого ease «SHIFT_X/SHIFT_Y» тост-двійник летить
// разом із панеллю Центру до позиції свого банера, в settle обмінюється
// на банер за один кадр (без дрейфу/блимання окремого сповіщення).

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

// Банер Центру, що відповідає злитому тосту (за самим Notification).
// Кеш у slot._rideBanner: _rebuild може перестворювати картки посеред
// польоту, тоді кеш стає недійсним і шукаємо заново.
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

// Показ злитих банерів, які тримали у прозорості на час польоту.
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
        // природна (стартова) позиція тоста — точка відліку польоту
        try {
            const [nx, ny] = slot.get_transformed_position();
            slot._rideNat = isFinite(nx) && isFinite(ny) ? { x: nx, y: ny } : null;
        } catch (_) {
            slot._rideNat = null;
        }
        slot._rideBanner = null;
        slot._mergeAt = Date.now();
        // fail-safe: якщо тик Центру не завершить політ (ease відмінено,
        // панель не відкрилась, сповіщення зникло) — прибираємо самі
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

// fade-in скла стеку (0..1 за _fadeMS мс); рухається тіком Центру
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

// Спільна підготовка стеку Центру: виключення з каптура (панель/бокс/столешні
// іконки) + перший семплінг.
function _setupNcStack(p, s) {
    try {
        try { s.uiSampler?.addExclusion?.(p.box); } catch (_) {}
        // сам оверлей (panelBg + бокс) НЕ має бути в каптурі -
        // інакше скло карток семплить темний фон панелі і
        // виглядає плоско, а не як скло з заломленням
        try { s.uiSampler?.addExclusion?.(p.overlay); } catch (_) {}
        for (const child of global.window_group?.get_children?.() ?? []) {
            if (child.meta_window?.get_gtk_application_id?.() === 'com.rastersoft.ding' ||
                child.meta_window?.get_title?.() === 'Desktop Icons 1' ||
                child.meta_window?.get_window_type?.() === 1) {
                try { s.uiSampler?.addExclusion?.(child); } catch (_) {}
            }
        }
        s.uiSampler?.rebindSelf?.();
        s.uiSampler?.refresh?.();
        return true;
    } catch (_) {
        return false;
    }
}

// cards-стек створюється ТІЛЬКИ при settle (кінець слайду): дорога побудова
// (rebuildClones/каптура) у кадрах руху панелі — причина «дьоргання» відкриття.
// Під час слайду скла карток немає взагалі; на місці воно приходить fade-in.
function _ensureNcCards(p) {
    try {
        if (!p || !p.overlay || !p.stacks)
            return false;
        if (p.stacks.some(s => s.kind === 'cards'))
            return false;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const cards = _makeGlassStack(monitor, 24, 'nc-cards', false);
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

// Тик ПОЛЬОТУ: злиті тости їдуть разом із панеллю Центру у точку свого банера.
// prog = 1 - clamp(box.translation_x/480): 0 на старті слайду, 1 при settle;
// перевід тоста = prog * (трансформована позиція банера − природна позиція тоста).
// Окремих ease-транзишнів на тостах немає — рух виводить сам тик.
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
                        continue; // fail-safe прибере сам
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
        // SETTLE: тости на позиції банерів → банери показуємо, тости прибираємо
        for (const slot of slots) {
            try { _finishMergedSlot(slot); } catch (_) {}
        }
        _commitMergedBanners(p);
        p._rideDone = true;
    } catch (_) {}
}

// settle слайду: дорога частина лишається поза кадрами руху — тут створюємо
// скло карток і форсуємо рефреші стеків (один раз, поза анімацією).
function _ncSettle(p) {
    try {
        if (!p || p._settleDone)
            return;
        p._settleDone = true;
        try {
            p.box.min_height = -1;
            p.box.set_size(NC_W, -1);
            p.panelBg.min_height = -1;
            p.panelBg.set_size(NC_W, -1);
        } catch (_) {}
        _ensureNcCards(p);
        for (const s of p.stacks ?? []) {
            try {
                _startStackFade(s, 220);
                glassForceRefresh?.(s.bgActor);
            } catch (_) {}
        }
        try {
            const cards = p.stacks?.find(s => s.kind === 'cards');
            if (cards)
                _startStackFade(cards, 260);
        } catch (_) {}
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

// MERGE з банерів-тостів: картка плавно зміщується вниз зі своєї
// вихідної позиції тоста (m.x, m.y) у слот Центру сповіщень
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
    // RIDE: повторний rebuild (нове сповіщення/очистка) посеред польоту
    // тостів — миттєво завершуємо, інакше старі двійники ведуться до
    // заново створених карток і стан хитається.
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
                text: _('Немає нових повідомлень'),
            });
            try {
                empty.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            } catch (_) {}
            p.list.add_child(empty);
            return;
        }

        // Кожне сповіщення — окрема картка (стеки-групи видалено,
        // переробимо заново пізніше). Каскадна поява: 240мс EASE_OUT_CUBIC,
        // стагер 35мс по індексу.
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
                // RIDE: банер тримаємо прозорим до settle (тост-двійник летить
                // до його позиції), далі показ за один кадр без блимання
                cardData.banner._isMergedToast = true;
                cardData.banner.opacity = (p._rideDone || p._settleDone) ? 255 : 0;
            } else {
                _animateEnter(cardData.banner, enterIdx);
            }
            enterIdx++;
        }
        try { _collapseNcGroups(p, merges); } catch (ex) { console.error('[tahoe-nc] groups: ' + ex); }
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

/* 2.11: стеки-групи за ім'ям застосунку (референс macOS):
   колапс - найновіша картка повного розміру зверху, під нею
   старіші ПОВНОГО РОЗМІРУ, злегка менші за скейлом (по x) і
   присунуті нижче - видно лише нижній край кожного шару.
   Клік по стеку розгортає групу в звичайні картки. */
function _collapseNcGroups(p, merges = null) {
    if (!p || !p.list)
        return;
    const kids = p.list.get_children().filter((c) => !!c._notification);
    if (kids.length < 2)
        return;
    const gr = new Map();
    const order = [];
    for (const b of kids) {
        const app = String(b._macApp ?? '').trim() || 'Повідомлення';
        let g = gr.get(app);
        if (!g) {
            g = { app, cards: [], container: null, expanded: false };
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
        // шаруємо: старіші під найновішою (порядок додавання =
        // порядок малювання, тому найновіша додається останньою)
        const newest = g.cards[0];
        let headH = newest.height;
        if (!(headH > 0) || headH > 1500) {
            try {
                const [, ph] = newest.get_preferred_height(NC_W - 40);
                if (ph > 0 && ph < 1500) headH = ph;
            } catch (_) {}
        }
        headH = Math.max(54, Math.ceil(headH) || 68);
        const over = 9;
        const peersN = Math.min(2, g.cards.length - 1);
        const container = new St.Widget({
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
        });
        container._macPeekGroup = g;
        // тіло у гурті далі peersN - у невидимій скриньці (щоб не загубити
        // картки при колапсі і повернути всі при розгортанні)
        const held = new St.Widget({ visible: false, x_expand: false, y_expand: false });
        g.held = held;
        g.container = container;
        container.set_width(NC_W - 40);
        const groupH = headH + peersN * over;
        container.set_height(groupH);
        container.min_height = groupH;
        container.x_align = Clutter.ActorAlign.CENTER;
        const peerEnter = (b, delayIdx) => {
            try {
                b.remove_all_transitions();
                b.opacity = 255;
            } catch (_) {}
        };
        for (let i = peersN; i >= 1; i--) {
            const b = g.cards[i];
            if (b.get_parent() === p.list)
                p.list.remove_child(b);
            b.reactive = false;
            b._macHiddenPeer = true;
            b._macSavedStyle = CARD_BASE_STYLE;
            b.set_style(CARD_BASE_STYLE + ' border-top: none !important;');
            try {
                for (const ch of b.get_children?.() ?? []) {
                    ch.visible = false;
                }
            } catch (_) {}
            b.set_pivot_point(0.5, 0);
            b.set_scale(1 - i * 0.042, 1);
            b.translation_y = i * over;
            b.set_width(NC_W - 40);
            try {
                const clipY = Math.max(0, headH - i * over);
                b.set_clip(0, clipY, b.width, i * over + 50);
            } catch (_) {}
            peerEnter(b, i);
            container.add_child(b);
        }
        for (let i = peersN + 1; i < g.cards.length; i++) {
            const b = g.cards[i];
            if (b.get_parent() === p.list)
                p.list.remove_child(b);
            held.add_child(b);
        }
        container.add_child(held);
        if (newest.get_parent() === p.list)
            p.list.remove_child(newest);
        newest.translation_y = 0;
        newest.set_scale(1, 1);
        newest.set_width(NC_W - 40);
        newest.set_style(CARD_BASE_STYLE);
        try {
            const inner = (newest.get_children?.() ?? [])[0];
            if (inner)
                inner.visible = true;
        } catch (_) {}
        container.add_child(newest);
        try {
            newest.connect('notify::height', () => {
                try {
                    if (container && !container.is_finalized?.() && container._macPeekGroup) {
                        const newH = newest.height + peersN * over;
                        container.set_height(newH);
                        container.min_height = newH;
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
        flat.push(container);
    }
    for (const b of kids.slice()) {
        if (b.get_parent() === p.list)
            try { p.list.remove_child(b); } catch (_) {}
    }
    // remove_child скасовує ease (каскад "замер" на opacity 0),
    // тому кожну картку перевставляємо з повторним каскадом;
    // злиті - з merge-анімацією
    let flatIdx = 0;
    const ridePending = _mergingSlots().length > 0 && !p._settleDone;
    for (const x of flat) {
        p.list.add_child(x);
        const isStack = !!x._macPeekGroup;
        const banner = isStack ? x.get_children()[x.get_children().length - 1] : x;
        const isMerged = banner && (banner._isMergedToast || (merges && (merges.has(banner._notification) || merges.has(banner._notification?.n))));
        if (banner) {
            if (isMerged) {
                // RIDE: до settle банер прозорий, після — за один кадр
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

function _expandGroup(g) {
    try {
        const cont = g?.container;
        if (!cont || g.expanded || cont.get_parent() !== _nc?.list)
            return;
        const p = _nc;
        g.expanded = true;
        let pos = p.list.get_children().indexOf(cont);
        const headH = Math.max(72, Math.ceil(g.cards[0].height) || 88);
        const spacing = 10;
        const step = headH + spacing;

        for (let i = 0; i < g.cards.length; i++) {
            const b = g.cards[i];
            if (b.get_parent())
                b.get_parent().remove_child(b);
            b.reactive = true;
            try { b.remove_clip(); } catch (_) {}
            delete b._macHiddenPeer;
            b.set_style(CARD_BASE_STYLE);
            try {
                const inner = (b.get_children?.() ?? [])[0];
                if (inner)
                    inner.visible = true;
            } catch (_) {}
            b.remove_all_transitions();
            p.list.insert_child_at_index(b, pos);

            if (i === 0) {
                // Те що було зверху стоса, залишається нагорі (чисте рідке скло, без блимання)
                b.translation_y = 0;
                b.set_scale(1, 1);
                b.opacity = 255;
            } else {
                // Старіші сповіщення плавно спадають униз з-під верхнього
                b.set_pivot_point(0.5, 0);
                b.set_scale(1 - i * 0.042, 1);
                b.translation_y = - (i * step - (i * 9));
                b.opacity = 220;
                b.ease({
                    translation_y: 0,
                    scale_x: 1,
                    scale_y: 1,
                    opacity: 255,
                    duration: 280,
                    delay: (i - 1) * 35,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
            pos++;
        }
        cont.destroy();
        g.container = null;
        g.held = null;
    } catch (e) {
        console.error('[tahoe-nc] expand: ' + e);
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
    // єдиний тінт і сила [0.16, 0.16, 0.18] 12%
    let tint = [0.16, 0.16, 0.18], strength = 0.12;
    try {
        const sset = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.tahoe-widgets' });
        try {
            const raw = String(sset.get_string('glass-tint') || '');
            const nums = raw.match(/[\d.]+/g);
            if (nums && nums.length >= 3) {
                const c = nums.slice(0, 3).map((x) => Math.min(1, Math.max(0, parseFloat(x) / 255)));
                if (c.every((v) => isFinite(v)))
                    tint = c;
            }
        } catch (_) {}
        try { strength = Math.min(1, Math.max(0, _readIntSetting(sset, 'glass-tint-strength', 12) / 100)); } catch (_) {}
    } catch (_) {}
    return {c: tint, a: strength};
}

function _cardFill() {
    return {c: [0.16, 0.16, 0.18], a: 0.12};
}

function _syncCards(p, monitor, s) {
    if (!s)
        return;
    try {
        const regions = [];
        let kids = [];
        try {
            for (const c of p.list.get_children()) {
                if (c._macPeekGroup) {
                    const g = c._macPeekGroup;
                    const newest = g.cards?.[0];
                    if (newest && newest.visible && newest.mapped && newest.opacity > 0) {
                        const [cx, cy] = newest.get_transformed_position();
                        const cw = newest.width, ch = newest.height;
                        if (cw > 0 && ch > 0 && isFinite(cx) && isFinite(cy)) {
                            const m = SHADER_PADDING;
                            regions.push({
                                x: (cx - monitor.x) - m,
                                y: (cy - monitor.y) - m,
                                w: cw + m * 2,
                                h: ch + m * 2,
                                tintR: 0, tintG: 0, tintB: 0, baseStrength: 0,
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
                // як у тостів: шейдер стискає кожен регіон на
                // SHADER_PADDING з усіх боків (actual_size = size -
                // pad*2), тому компенсуємо - інакше скло НЕ на всю
                // висоту/рядо картки
                const m = SHADER_PADDING;
                regions.push({
                    x: (cx - monitor.x) - m, y: (cy - monitor.y) - m,
                    w: cw + m * 2, h: ch + m * 2,
                    tintR: 0, tintG: 0, tintB: 0, baseStrength: 0,
                });
            } catch (_) {}
        }
        const [bx, by] = p.panelBg.get_transformed_position();
        const bw = p.panelBg.width, bh = p.panelBg.height;
        s.bgActor.set_position(monitor.x, monitor.y);
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
        // тінт регіонів карток = той самий, що в тостів (віджет-конфіг)
        if (regions.length)
            maxR = 24; // корнер картки, як у тостів (radius 24)
        const fill = _widgetGlassFill();
        for (const r of regions) {
            r.tintR = fill.c[0];
            r.tintG = fill.c[1];
            r.tintB = fill.c[2];
            r.baseStrength = fill.a;
        }
        try { s.effect.setCornerRadius(maxR); } catch (_) {}
        // [GPU-SAVE] Extras: регіони карток (позиції з transformed_position
        // самих карток) — зміщення/згортання стосу сповіщень рахується як зміна.
        // Стек карток існує лише від settle, слайд панелі тому не потрапляє
        // у хеш; анімації карток (к-enter/expand) чесно рахуються.
        let extraH = regions.length;
        for (const r of regions) {
            extraH = (extraH ^ (Math.round(r.x * 4) * 73856093) ^ (Math.round(r.y * 4) * 19349663) ^
                (Math.round(r.w * 4) * 83492791) ^ (Math.round(r.h * 4) * 2654435761)) | 0;
        }
        // ДЕШЕВИЙ шлях (щокадрово): регіони їдуть разом із картками без
        // нового захоплення кадру — фон за склом не змінюється від їх руху.
        s.effect.setGlassRegions(regions);
        s.effect.setResolution(monitor.width, monitor.height);
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(monitor.width, monitor.height);
        if (isFinite(bx) && isFinite(by) && bw > 0 && bh > 0)
            setClipIfChanged(s.bgActor, bx - monitor.x - 200, by - monitor.y - 200, bw + 400, bh + 400);
        ensureGlassAllocated(s.bgActor);
        // [GPU-SAVE] важка частина — лишень при реальній зміні; межа 60 FPS.
        let doHeavy = true;
        try {
            doHeavy = glassRefreshDue ? glassRefreshDue(s.bgActor, extraH) : true;
        } catch (_) {
            doHeavy = true;
        }
        if (!doHeavy)
            return;
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
        try {
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
        s.bgActor.set_position(monitor.x - ovX, monitor.y - ovY);

        // Slide animation protection: while the panel is sliding in (before settle or translation_x != 0),
        // keep the glass backdrop hidden so unaligned wallpaper clones never flash or tear during movement.
        const isSliding = (!p._settleDone || (p.box?.translation_x !== 0 && Math.abs(p.box?.translation_x ?? 0) > 1));
        if (isSliding) {
            if (s.bgActor.visible)
                s.bgActor.hide();
            s.bgActor.opacity = 0;
            return;
        }

        const alpha = p.box.opacity * _stackFadeK(s);
        if (alpha > 0 && !s.bgActor.visible)
            s.bgActor.show();
        else if (alpha === 0 && s.bgActor.visible)
            s.bgActor.hide();
        s.bgActor.opacity = Math.round(Math.min(255, Math.max(0, alpha)));
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(monitor.width, monitor.height);
        // ДЕШЕВИЙ шлях (щокадрово): регіон і кліп їдуть разом із панеллю,
        // захоплений кадр при цьому МАЛЮЄТЬСЯ не заново — фон за панеллю
        // не змінюється від слайду, тож стара каптура лишається правильною.
        s.effect.setGlassRegions([{
            x: (bx - monitor.x) - m, y: (by - monitor.y) - m,
            w: bw + m * 2, h: bh + m * 2,
            tintR: 0, tintG: 0, tintB: 0, baseStrength: 0,
        }]);
        s.effect.setResolution(monitor.width, monitor.height);
        const clip = [(bx - monitor.x) - m - 200, (by - monitor.y) - m - 200,
            bw + m * 2 + 400, bh + m * 2 + 400];
        setClipIfChanged(s.bgActor, clip[0], clip[1], clip[2], clip[3]);
        // [GPU-SAVE] Важку частину виконуємо тільки коли фон дійсно змінився
        // (перший кадр стеку, зміна вікна/шпалер під склом) або коли реально
        // змінився РОЗМІР панелі (вміст списку). Слайд bx/by у хеш НЕ входить:
        // рух панелі не має рахуватися за «зміну сцени», інакше — фризи.
        const extraH = (((bw || 0) * 73856093) ^ ((bh || 0) * 19349663)) | 0;
        let doHeavy = true;
        try {
            doHeavy = glassRefreshDue ? glassRefreshDue(s.bgActor, extraH) : true;
        } catch (_) {
            doHeavy = true;
        }
        if (!doHeavy)
            return;
        s.wcm.setOffset(-monitor.x, -monitor.y);
        syncGlassCaptureClip({
            cloneContainer: s.cloneContainer,
            effect: s.effect,
            originX: monitor.x,
            originY: monitor.y,
            uiSampler: s.uiSampler,
            windowCloneManager: s.wcm,
        });
        s.uiSampler.refresh();
        s.uiSampler.sync(monitor.x, monitor.y, monitor.width, monitor.height);
        s.wcm.sync();
        try {
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
    panelBg.set_size(W, -1);
    overlay.add_child(panelBg);

    const box = new St.BoxLayout({
        style_class: `tahoe-nc-panel${darkCls}`,
        vertical: true,
        x_expand: false,
        y_expand: false,
    });
    box.set_position(X, Y);
    box.set_size(W, -1);
    overlay.add_child(box);

    // Заголовок: локалізований великий титул + пілюля «Очистити все» (новий вигляд MacShell)
    const head = new St.BoxLayout({style_class: 'tahoe-nc-head'});
    const title = new St.Label({
        style_class: 'tahoe-nc-title-big',
        text: _('Центр повідомлень'),
        x_expand: true,
        style: 'font-size: 17px !important; font-weight: 600 !important;',
    });
    const CLEAR_STYLE = 'background-color: rgba(255, 255, 255, 0.10) !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; border-radius: 9999px !important; padding: 4px 14px !important; color: #ffffff !important; font-size: 12px !important; font-weight: 500 !important; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18) !important;';
    const CLEAR_STYLE_HOVER = 'background-color: rgba(255, 255, 255, 0.20) !important; border: 1px solid rgba(255, 255, 255, 0.26) !important; border-radius: 9999px !important; padding: 4px 14px !important; color: #ffffff !important; font-size: 12px !important; font-weight: 500 !important; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22) !important;';
    const clear = new St.Button({
        style_class: 'tahoe-nc-clear',
        label: _('Очистити все'),
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
        y_expand: false,
    });
    scroll.style = `max-height: ${maxH}px;`;
    try {
        scroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
        scroll.hscrollbar_policy = St.PolicyType.NEVER;
        scroll.overlay_scrollbars = true;
    } catch (_) {}

    const list = new St.BoxLayout({
        vertical: true,
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

    const p = {
        overlay,
        box,
        panelBg,
        list,
        scroll,
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

    // Glass stacks: CC-style backdrop (pure blur) створюємо одразу; стек скла
    // карток відкладаємо до settle — дорога побудова (wcm.rebuildClones,
    // семплінг, каптура) у кадрах слайду давала фризи відкриття.
    try {
        const bd = _makeGlassStack(monitor, NC_RADIUS, 'nc-backdrop', true, 0);
        overlay.insert_child_at_index(bd.bgActor, 1);
        try {
            overlay.set_child_above_sibling(panelBg, bd.bgActor);
        } catch (_) {}

        _setupNcStack(p, bd);
        bd.bgActor.opacity = 0;
        bd.bgActor.visible = false;
        p.stacks = [bd];

        const tick = () => {
            p.tickId = 0;
            if (!_nc || _nc !== p)
                return GLib.SOURCE_REMOVE;
            if (!p.overlay.mapped)
                return GLib.SOURCE_REMOVE;
            try {
                p.panelBg.opacity = p.box.opacity;
                p.panelBg.translation_x = p.box.translation_x;
            } catch (_) {}
            try {
                // RIDE: злиті тости летять разом із панеллю (щокадрово),
                // settle-страховка на випадок відміненого onComplete
                _ncRideTick(p);
                if (!p._settleDone &&
                    (p.box.translation_x ?? 0) <= 0.5 && (p.box.opacity ?? 0) >= 254)
                    _ncSettle(p);
            } catch (_) {}
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
        console.error(`[tahoe-nc] glass failed: ${e}`);
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

    // Slide-in animation from our theme: translation_x 480 -> 0 with EASE_OUT_CUBIC.
    // Скло їде разом із панеллю: дешеві шляхи тиків рухають регіони/кліп,
    // важкий (каптура/семплінг) ніколи не виконується в кадрах руху.
    try {
        box.set_pivot_point(1.0, 0.0);
        box.scale_x = 1.12;
        box.scale_y = 1.12;
        box.opacity = 0;
        panelBg.set_pivot_point(1.0, 0.0);
        panelBg.scale_x = 1.12;
        panelBg.scale_y = 1.12;
        panelBg.opacity = 0;
        for (const s of p.stacks) {
            s.bgActor.opacity = 0;
            s.bgActor.visible = false;
        }
        box.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                try { _ncSettle(p); } catch (_) {}
            },
        });
        panelBg.ease({
            scale_x: 1.0,
            scale_y: 1.0,
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
    // RIDE: зачистка злитних тостів (ніхто їх більше не веде)
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
    for (const s of stacks) {
        try { s.effect?.cleanup?.(); } catch (_) {}
        try { s.uiSampler?.destroy?.(); } catch (_) {}
        try { s.wcm?.destroy?.(); } catch (_) {}
        try { s.bgActor?.destroy?.(); } catch (_) {}
    }
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

    // Only one center can be open at a time
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

    // Якщо відкритий NC menubar (легасі) — закриваємо його теж:
    try {
        globalThis._macNotificationCenter?._closeNotificationCenter?.();
    } catch (_) {}

    // MERGE: видимі тости передають позиції карткам Центру і зникають
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
    globalThis._tahoeNCOpen = true;
}

export function closeNC(immediate = false) {
    const p = _nc;
    if (!p || p._closing)
        return;
    p._closing = true;
    _nc = null;

    globalThis._tahoeNCOpen = false;

    // RIDE: злиті тости більше не ведуться польотом — прибираємо одразу,
    // щоб не тягнути їх у slide-out (банери вже показані в по-settle,
    // а на ран busiest закритті сповіщення лишаться в Центрі на наступний раз)
    try { _killMergingSlots(); } catch (_) {}

    if (immediate) {
        _destroyNC(p);
        return;
    }

    // Scale-up on close: 1.0 -> 1.12 (zoom in while fading out).
    // Тик уже мертвий (_nc = null на старті closeNC), тому опадність скла
    // на scale-out ведуть per-stack ease → 0, синхронно з панеллю (260мс).
    try {
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
                    bg.ease({
                        opacity: 0,
                        duration: 260,
                        mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    });
                } catch (_) {}
            }
        } catch (_) {}
        try {
            p.panelBg.ease({
                scale_x: 1.12,
                scale_y: 1.12,
                opacity: 0,
                duration: 260,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            });
        } catch (_) {}
        try {
            p.box.ease({
                scale_x: 1.12,
                scale_y: 1.12,
                opacity: 0,
                duration: 260,
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
    // Тихий режим: нативні банери вимкнено (сповіщення накопичуються
    // лише в Центрі повідомлень). Флоутинг-банери видалено у v4;
    // новий простий UI банерів додається пізніше.
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

    // Банери-тости (етап 2): вигляд MacShell-main.
    // Скло може підвантажитися пізніше — покажемо тости одразу,
    // як тільки LiquidEffect готовий (flush з import hook).
    try { _ensureToastStyles(); } catch (_) {}
    _toastsEnabled = true;
    try { _hookToastTray(); } catch (_) {}
    try { _flushToastQueue(); } catch (_) {}

    // Делегатор для легасі-споживачів (tahoeNotificationCenter.js-шим
    // → topbarBlur / tahoeOSD), щоб вони завжди консультували ЖИВИЙ
    // інстанс модуля незалежно від кешування ES-модулів.
    globalThis.__tahoeNC = {
        isNCOpen, getNCPanelBox, getNCOverlay, openNC, closeNC, toggleNC,
    };
    globalThis._tahoeNCOpen = false;
}

export function disable() {
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
    // Тости (етап 2): інтервали, актори, скло
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

// Інтерфейс для centerManager/extension.js:
globalThis._tahoeNCClose = closeNC;
// ВАЖЛИВО: _tahoeNCOpen — boolean стан (читається menubar_v29
// у _changeMenu/_onCapturedEvent як Boolean(...)); функція тут неприпустима,
// otherwise hover-switch патч ламається.
globalThis._tahoeNCOpen = false;
globalThis._tahoeNCToggle = toggleNC;
