// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe Notification Center (v4): замінює спливання календаря по кліку на дату.
// ЕТАП ПЕРЕРОБКИ UI СПОВІЩЕНЬ (v4, "нічого не показуємо"):
//   • плаваючі банери повністю ВИДАЛЕНО — жодних спливаючих вікон; новий
//     простий UI банерів буде додано пізніше;
//   • стеки груп (MacNotificationGroup) у Центрі видалено — кожне
//     сповіщення = окрема картка; стеки переробимо заново пізніше;
//   • збережено всю логіку та анімації Центру: слайд панелі 480→0 320мс
//     EASE_OUT_CUBIC / 260мс EASE_IN_CUBIC, каскад карток 240мс EASE_OUT_
//     CUBIC зі стагером 35мс, каскад «Очистити все» 220мс EASE_IN_CUBIC,
//     фейд glass-бекдропів 320мс/260мс.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {getPanelInk, watchInk} from './tahoeInk.js';
import {closeAllCenters} from './centerManager.js';
import {
    buildNotificationCard,
} from './tahoeNotificationCard.js?v=macnotif_v4';

let LiquidEffect = null;
let UnpickableActor = Clutter.Actor;
let UILayerSampler = null;
let WindowCloneManager = null;
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
let ensureGlassAllocated = () => {};

const _LG_BASE = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist';

import(_LG_BASE + '/liquidEffect.js').then(m => {
    if (m.LiquidEffect)
        LiquidEffect = m.LiquidEffect;
}).catch(e => console.warn(`[tahoe-nc] liquidEffect unavailable: ${e}`));

import(_LG_BASE + '/utils.js').then(m => {
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
}).catch(e => console.warn(`[tahoe-nc] liquid-glass utils unavailable: ${e}`));

const NC_W = 480;
const NC_RADIUS = 82;
const BACKDROP_PAD = 60;
const SHADER_PADDING = 20;

let _ = (m) => m;
let _nc = null;
let _trayWasBlocked = false;
let _hooked = false;

function _lgSettings() {
    try {
        const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
        return ext?.stateObj?._settings || new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com' });
    } catch (_) {
        return null;
    }
}

function _makeGlassStack(monitor, radius, name, pure = false, edgePx = 0) {
    if (!LiquidEffect || !UnpickableActor || !UILayerSampler || !WindowCloneManager)
        throw new Error('liquid-glass modules not loaded yet');

    const bgActor = new UnpickableActor();
    bgActor.set_name(`liquid-glass-bg-actor-${name}`);
    bgActor.set_pivot_point(0, 0);

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
        effect.setTintStrength(0.04);
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
            effect._setFloat('edge_smoothing', 2.0);
        }
    } catch (_) {}

    liquidBox.add_effect(effect);

    const wcm = new WindowCloneManager(liquidBox, cloneContainer, `lg-${name}`);
    const uiSampler = new UILayerSampler(bgActor, liquidBox,
        [global.windowGroup, global.window_group], cloneContainer, name,
        Main.panel ? [Main.panel] : []);
    wcm.rebuildClones();
    uiSampler.rebindSelf();
    uiSampler.refresh();

    return {
        kind: pure ? 'backdrop' : 'cards',
        bgActor, liquidBox, cloneContainer, effect, wcm, uiSampler,
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
    // Sort items by time (newest first)
    items.sort((a, b) => {
        const timeA = a.n?.datetime?.to_unix ? a.n.datetime.to_unix() : 0;
        const timeB = b.n?.datetime?.to_unix ? b.n.datetime.to_unix() : 0;
        return timeB - timeA;
    });
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

function _makeMacCard(item, onCloseCb, width = null) {
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
        actor.opacity = 0;
        actor.translation_y = -16;
        actor.ease({
            opacity: 255,
            translation_y: 0,
            duration: 240,
            delay: Math.min(8, Math.max(0, idx)) * 35,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    } catch (_) {
        try { actor.opacity = 255; actor.translation_y = 0; } catch (_) {}
    }
}

function _rebuild() {
    const p = _nc;
    if (!p)
        return;
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
            }, 440);
            cardData.banner.x_align = Clutter.ActorAlign.CENTER;
            cardData.banner._notification = item.n;

            p.list.add_child(cardData.banner);
            _animateEnter(cardData.banner, enterIdx);
            enterIdx++;
        }
    } catch (e) {
        console.error(`[tahoe-nc] _rebuild error: ${e}`);
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

function _cardFill() {
    try {
        if (getPanelInk() === 'light')
            return {c: [0.0, 0.0, 0.0], a: 0.04};
    } catch (_) {}
    return {c: [1.0, 1.0, 1.0], a: 0.05};
}

function _syncCards(p, monitor, s) {
    if (!s)
        return;
    try {
        const regions = [];
        let kids = [];
        try {
            kids = p.list.get_children();
        } catch (_) {
            kids = [];
        }
        for (const card of kids) {
            try {
                if (card._macGroup && typeof card._macGroup.getGlassRegions === 'function') {
                    const gRegions = card._macGroup.getGlassRegions(monitor);
                    for (const r of gRegions) regions.push(r);
                    continue;
                }
                if (!card?.has_style_class_name?.('mac-notification-banner') && !card?.has_style_class_name?.('tahoe-nc-card'))
                    continue;
                if (!card.visible || !card.mapped)
                    continue;
                const [cx, cy] = card.get_transformed_position();
                const cw = card.width, ch = card.height;
                if (!(cw > 0) || !(ch > 0) || !isFinite(cx) || !isFinite(cy))
                    continue;
                const m = 0;
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
        if (!s.bgActor.visible)
            s.bgActor.show();
        s.bgActor.opacity = 255;
        const fill = _cardFill();
        for (const r of regions) {
            r.tintR = fill.c[0];
            r.tintG = fill.c[1];
            r.tintB = fill.c[2];
            r.baseStrength = fill.a;
        }
        s.effect.setGlassRegions(regions);
        s.effect.setResolution(monitor.width, monitor.height);
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(monitor.width, monitor.height);
        if (isFinite(bx) && isFinite(by) && bw > 0 && bh > 0)
            setClipIfChanged(s.bgActor, bx - monitor.x - 200, by - monitor.y - 200, bw + 400, bh + 400);
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
        s.uiSampler.refresh();
        s.uiSampler.sync(monitor.x, monitor.y, monitor.width, monitor.height);
        s.wcm.sync();
    } catch (_) {}
}

function _syncGlass(p, monitor, s) {
    if (!s)
        return;
    try {
        const [bx, by] = p.panelBg.get_transformed_position();
        const bw = p.panelBg.width, bh = p.panelBg.height;
        if (!(bw > 0) || !(bh > 0) || !isFinite(bx) || !isFinite(by))
            return;
        const m = BACKDROP_PAD;
        s.bgActor.set_position(monitor.x, monitor.y);
        if (!s.bgActor.visible)
            s.bgActor.show();
        s.bgActor.opacity = 255;
        s.effect.setGlassRegions([{
            x: (bx - monitor.x) - m, y: (by - monitor.y) - m,
            w: bw + m * 2, h: bh + m * 2,
            tintR: 0, tintG: 0, tintB: 0, baseStrength: 0,
        }]);
        s.effect.setResolution(monitor.width, monitor.height);
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(monitor.width, monitor.height);
        const clip = [(bx - monitor.x) - m - 200, (by - monitor.y) - m - 200,
            bw + m * 2 + 400, bh + m * 2 + 400];
        setClipIfChanged(s.bgActor, clip[0], clip[1], clip[2], clip[3]);
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

function _buildPanel() {
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

    const panelBg = new St.Widget({style_class: `tahoe-qs-panelbg${darkCls}`});
    panelBg.set_position(X, Y);
    panelBg.set_size(W, -1);
    overlay.add_child(panelBg);

    const box = new St.BoxLayout({style_class: `tahoe-nc-panel${darkCls}`, vertical: true});
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

    // Рядок «Не турбувати» (новий вигляд MacShell) з живим перемикачем DnD
    const DND_STYLE_BASE = 'background-color: rgba(255, 255, 255, 0.07) !important; border: 1px solid rgba(255, 255, 255, 0.09) !important; border-radius: 12px !important; padding: 9px 12px !important; spacing: 10px !important; margin-bottom: 2px !important;';
    const dndRow = new St.BoxLayout({
        style_class: 'tahoe-nc-dndrow',
        style: DND_STYLE_BASE,
    });
    const moonIcon = new St.Icon({
        icon_name: 'weather-clear-night-symbolic',
        icon_size: 15,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'color: rgba(255, 255, 255, 0.85) !important;',
    });
    const dndLabel = new St.Label({
        text: _('Не турбувати'),
        y_align: Clutter.ActorAlign.CENTER,
        style: 'color: rgba(255, 255, 255, 0.92) !important; font-size: 13px !important; font-weight: 500 !important;',
    });
    const dndSpacer = new St.Widget({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const dndSwitch = new PopupMenu.Switch(false);
    try {
        dndSwitch.y_align = Clutter.ActorAlign.CENTER;
    } catch (_) {}
    const notifSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    const syncDnd = () => {
        try {
            dndSwitch.state = !notifSettings.get_boolean('show-banners');
        } catch (_) {}
    };
    syncDnd();
    dndSwitch.connect('notify::state', () => {
        try {
            notifSettings.set_boolean('show-banners', !dndSwitch.state);
        } catch (_) {}
    });
    let dndSettingsId = 0;
    try {
        dndSettingsId = notifSettings.connect('changed::show-banners', syncDnd);
    } catch (_) {
        dndSettingsId = 0;
    }
    dndRow.add_child(moonIcon);
    dndRow.add_child(dndLabel);
    dndRow.add_child(dndSpacer);
    dndRow.add_child(dndSwitch);
    box.add_child(dndRow);

    const scroll = new St.ScrollView({
        style_class: 'tahoe-nc-scroll',
        x_expand: true,
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
        dndSettings: { notifSettings, dndSettingsId },
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

    // Glass stacks: CC-style backdrop (pure blur) + glass under every notification card
    try {
        const bd = _makeGlassStack(monitor, NC_RADIUS, 'nc-backdrop', true, 0);
        const cards = _makeGlassStack(monitor, 24, 'nc-cards', false);
        overlay.insert_child_at_index(bd.bgActor, 1);
        overlay.insert_child_at_index(cards.bgActor, 2);
        try {
            overlay.set_child_above_sibling(panelBg, bd.bgActor);
        } catch (_) {}

        for (const s of [bd, cards]) {
            try {
                s.uiSampler.addExclusion(box);
            } catch (_) {}
            s.wcm.rebuildClones();
            s.uiSampler.rebindSelf();
            s.uiSampler.refresh();
            try {
                s.bgActor.opacity = 0;
                s.bgActor.ease({
                    opacity: 255,
                    duration: 320,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            } catch (_) {}
        }
        p.stacks = [bd, cards];

        const tick = () => {
            p.tickId = 0;
            if (!_nc || _nc !== p)
                return GLib.SOURCE_REMOVE;
            if (!p.overlay.mapped)
                return GLib.SOURCE_REMOVE;
            try {
                const bd = p.stacks.find(s => s.kind === 'backdrop');
                if (bd) _syncGlass(p, monitor, bd);
            } catch (_) {}
            try {
                const cards = p.stacks.find(s => s.kind === 'cards');
                if (cards) _syncCards(p, monitor, cards);
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
    _rebuild();

    // Slide-in animation from our theme: translation_x 480 -> 0 with EASE_OUT_CUBIC
    try {
        box.translation_x = 480;
        box.opacity = 0;
        panelBg.opacity = 0;
        box.ease({
            translation_x: 0,
            opacity: 255,
            duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        panelBg.ease({
            opacity: 255,
            duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    } catch (_) {
        box.translation_x = 0;
        box.opacity = 255;
        panelBg.opacity = 255;
    }
}

function _destroyNC(p) {
    if (!p)
        return;
    try {
        const dd = p.dndSettings;
        if (dd?.notifSettings && dd?.dndSettingsId) {
            try { dd.notifSettings.disconnect(dd.dndSettingsId); } catch (_) {}
        }
    } catch (_) {}
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

    try {
        _buildPanel();
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

    if (immediate) {
        _destroyNC(p);
        return;
    }

    // Slide-out animation from our theme: translation_x 0 -> 480 with EASE_IN_CUBIC
    try {
        p.box.remove_all_transitions();
        p.panelBg.remove_all_transitions();
        for (const s of p.stacks) {
            try {
                s.bgActor?.ease({
                    opacity: 0,
                    duration: 260,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                });
            } catch (_) {}
        }
        try {
            p.panelBg.ease({
                opacity: 0,
                duration: 260,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            });
        } catch (_) {}
        try {
            p.box.ease({
                translation_x: 480,
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
    if (typeof gettextFunc === 'function')
        _ = gettextFunc;
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
    // Делегатор для легасі-споживачів (tahoeNotificationCenter.js-шим
    // → topbarBlur / tahoeOSD), щоб вони завжди консультували ЖИВИЙ
    // інстанс модуля незалежно від кешування ES-модулів.
    globalThis.__tahoeNC = {
        isNCOpen, getNCPanelBox, getNCOverlay, openNC, closeNC, toggleNC,
    };
    globalThis._tahoeNCOpen = false;
}

export function disable() {
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
