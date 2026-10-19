// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe Notification Center: replaces the calendar popup on date click.
// Slides in from the right with CC-style gradient-blur backdrop + shadow,
// header (clear-all X + localized title), one rounded card per real
// GNOME notification (app icon, bold title, subtitle, SF Pro Display).
// Non-modal like QS (click-through dismissal). While open, the volume
// OSD stays hidden; opening QS hides the NC automatically.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import Meta from 'gi://Meta';
import {togglePanel, isPanelOpen, _makeGlassStack, BACKDROP_PAD} from './tahoeQuickSettings.js';

// Liquid-glass helpers live in another extension. Static
// `import ... from 'file://' + ...` is a SyntaxError (module specifiers must
// be string literals), so load them dynamically at runtime.
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist/utils.js').then(m => {
    if (m.setClipIfChanged)
        setClipIfChanged = m.setClipIfChanged;
    if (m.syncGlassCaptureClip)
        syncGlassCaptureClip = m.syncGlassCaptureClip;
}).catch(e => console.warn(`[tahoe-nc] liquid-glass utils unavailable: ${e}`));
import {getPanelInk, getTopbarInk, watchInk} from './tahoeInk.js';

const NC_W = 360;
const NC_RADIUS = 82;

let _ = (m) => m;
let _nc = null;
let _bannerBox = null;
let _bannerStack = null;
let _bannerTimers = new Map();
let _bannerEnabled = false;
let _bannerHookIds = [];
let _bannerWasBlocked = false;
let _hookedSrc = new Set();
let _bannerTickId = 0;

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
    } catch (_) {
        // no tray
    }
    items.reverse();
    return items;
}

// Field probing: exact MessageTray property names vary by shell version,
// so title/body/icon resolve through candidate lists (first non-empty
// string / usable gicon wins). No logs, no guessing twice.
const TITLE_KEYS = ['title', 'summary', 'bannerTitle', 'label', 'text'];
const BODY_KEYS = ['bannerBodyText', 'body', 'message', 'banner', 'text', 'content'];

function _strField(obj, keys) {
    try {
        if (!obj)
            return '';
        for (const k of keys) {
            try {
                const v = obj[k];
                if (typeof v === 'string' && v.trim().length)
                    return v;
            } catch (_) {
                // next key
            }
        }
    } catch (_) {
        // no fields
    }
    return '';
}

function _notifTitle(n) {
    return _strField(n, TITLE_KEYS);
}

function _notifBody(n) {
    return _strField(n, BODY_KEYS);
}

function _notifIcon(source, n, size) {
    // fresh actor every time (actors can't be reparented); app texture
    // first, notification gicon second, generic fallback last
    try {
        const app = source?.app ?? null;
        if (app && typeof app.create_icon_texture === 'function') {
            try {
                return app.create_icon_texture(size);
            } catch (_) {
                // fall through
            }
        }
    } catch (_) {
        // no app
    }
    try {
        for (const k of ['gicon', 'iconGicon', 'icon_name', 'iconName']) {
            try {
                const g = n?.[k] ?? source?.[k] ?? null;
                if (!g)
                    continue;
                if (g instanceof Clutter.Actor)
                    continue;
                if (typeof g === 'string' && g.length)
                    return new St.Icon({icon_name: g, icon_size: size});
                if (typeof g === 'object')
                    return new St.Icon({gicon: g, icon_size: size});
            } catch (_) {
                // next key
            }
        }
    } catch (_) {
        // no gicon
    }
    return new St.Icon({icon_name: 'dialog-information-symbolic', icon_size: size});
}

function _activate(item) {
    try {
        for (const k of ['activate', 'invoke', 'open', 'launch']) {
            try {
                if (typeof item.n?.[k] === 'function') {
                    item.n[k]();
                    return;
                }
            } catch (_) {
                // next method
            }
        }
    } catch (_) {
        // fall through
    }
    try {
        item.source?.app?.activate?.();
        return;
    } catch (_) {
        // fall through
    }
    try {
        item.n.destroy?.();
    } catch (_) {
        // gone
    }
}

function _clearAll() {
    try {
        for (const item of _collect()) {
            const n = item.n;
            let done = false;
            for (const k of ['destroy', 'dismiss', 'close', 'acknowledge', 'remove', 'expire']) {
                try {
                    if (typeof n?.[k] === 'function') {
                        n[k]();
                        done = true;
                        break;
                    }
                } catch (_) {
                    // next method
                }
            }
            void done;
        }
    } catch (_) {
        // nothing to clear
    }
    _rebuild();
}

function _sourceName(source) {
    try {
        for (const k of ['title', 'name', 'summary']) {
            try {
                const v = source?.[k];
                if (typeof v === 'string' && v.trim().length)
                    return v;
            } catch (_) {
                // next key
            }
        }
        try {
            const app = source?.app ?? null;
            if (app) {
                try {
                    const n = app.get_name?.();
                    if (typeof n === 'string' && n.trim().length)
                        return n;
                } catch (_) {
                    // no name
                }
            }
        } catch (_) {
            // no app
        }
    } catch (_) {
        // nameless
    }
    return '';
}

function _makeCard(item) {
    const card = new St.Button({style_class: 'tahoe-nc-card', reactive: true, can_focus: true, x_expand: true});
    const row = new St.BoxLayout({style_class: 'tahoe-nc-cardrow', x_expand: true});
    try {
        row.add_child(_notifIcon(item.source, item.n, 38));
    } catch (_) {
        // iconless
    }
    const texts = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'tahoe-nc-texts'});
    const titleText = _notifTitle(item.n) || _sourceName(item.source) || ' ';
    const title = new St.Label({style_class: 'tahoe-nc-title', text: titleText});
    try {
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    } catch (_) {
        // no clutter text
    }
    const body = new St.Label({style_class: 'tahoe-nc-sub', text: _notifBody(item.n)});
    try {
        body.clutter_text.set_line_wrap(true);
        body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    } catch (_) {
        // single line
    }
    texts.add_child(title);
    if ((_notifBody(item.n) ?? '').length)
        texts.add_child(body);
    row.add_child(texts);
    card.set_child(row);
    card.connect('clicked', () => {
        try {
            _activate(item);
        } catch (_) {
            // gone
        }
    });
    return card;
}

function _rebuild() {
    const p = _nc;
    if (!p)
        return;
    try {
        p.list.destroy_all_children();
        const items = _collect();
        if (!items.length) {
            const empty = new St.Label({style_class: 'tahoe-nc-empty', text: _('No Notifications')});
            try {
                empty.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            } catch (_) {
                // left aligned
            }
            p.list.add_child(empty);
        } else {
            for (const item of items) {
                try {
                    p.list.add_child(_makeCard(item));
                } catch (_) {
                    // skip broken card
                }
            }
        }
    } catch (_) {
        // panel gone
    }
}

// ---- desktop banners (same cards, swipe right-to-left) ----
// Stock banners are suppressed via bannerBlocked; every incoming
// notification gets our card top-right, sliding in from the right edge.
// Respects Do Not Disturb (show-banners off = NC list only, like macOS).

function _dndOn() {
    try {
        const s = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        return !s.get_boolean('show-banners');
    } catch (_) {
        return false;
    }
}

function _ensureBannerBox() {
    if (_bannerBox)
        return true;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return false;
        const panelH = Main.layoutManager.panelBox?.height ?? 32;
        _bannerBox = new St.BoxLayout({
            vertical: true, style_class: 'tahoe-nc-banners',
            reactive: false, visible: true, opacity: 255,
        });
        _bannerBox.set_width(NC_W);
        _bannerBox.set_position(monitor.x + monitor.width - NC_W - 12, monitor.y + panelH + 10);
        try {
            // banners live under the topbar: topbar ink, refreshed per show
            if (getTopbarInk() === 'light')
                _bannerBox.add_style_class_name('tahoe-qs-dark');
            else
                _bannerBox.remove_style_class_name('tahoe-qs-dark');
        } catch (_) {
            // classes stay
        }
        Main.layoutManager.uiGroup.add_child(_bannerBox);
        return true;
    } catch (_) {
        _bannerBox = null;
        return false;
    }
}

function _syncBannerGlass() {
    const s = _bannerStack;
    if (!s || !_bannerBox)
        return;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const regions = [];
        let kids = [];
        try {
            kids = _bannerBox.get_children();
        } catch (_) {
            kids = [];
        }
        for (const card of kids) {
            try {
                if (!card?.has_style_class_name?.('tahoe-nc-card'))
                    continue;
                if (!card.visible)
                    continue;
                const [cx, cy] = card.get_transformed_position();
                const cw = card.width, ch = card.height;
                if (!(cw > 0) || !(ch > 0) || !isFinite(cx) || !isFinite(cy))
                    continue;
                const m = 20;
                regions.push({
                    x: (cx - monitor.x) - m, y: (cy - monitor.y) - m,
                    w: cw + m * 2, h: ch + m * 2,
                    tintR: 0, tintG: 0, tintB: 0, baseStrength: 0,
                });
            } catch (_) {
                // skip broken card
            }
        }
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
        const [bx, by] = _bannerBox.get_transformed_position();
        if (isFinite(bx) && isFinite(by))
            setClipIfChanged(s.bgActor, bx - monitor.x - 100, by - monitor.y - 100,
                NC_W + 200, _bannerBox.height + 200);
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
    } catch (_) {
        // box gone
    }
}

function _ensureBannerGlass() {
    if (_bannerStack)
        return true;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !_bannerBox)
            return false;
        const s = _makeGlassStack(monitor, 20, 'nc-banners', false);
        Main.layoutManager.uiGroup.add_child(s.bgActor);
        try {
            Main.layoutManager.uiGroup.set_child_below_sibling(s.bgActor, _bannerBox);
        } catch (_) {
            // order unchanged
        }
        try {
            s.uiSampler.addExclusion(_bannerBox);
        } catch (_) {
            // sampler stays
        }
        s.wcm.rebuildClones();
        s.uiSampler.rebindSelf();
        s.uiSampler.refresh();
        _bannerStack = s;
        return true;
    } catch (_) {
        _bannerStack = null;
        return false;
    }
}

function _destroyBannerGlass() {
    if (_bannerTickId) {
        try {
            global.compositor.get_laters().remove(_bannerTickId);
        } catch (_) {
            // already gone
        }
        _bannerTickId = 0;
    }
    const s = _bannerStack;
    _bannerStack = null;
    if (!s)
        return;
    try {
        s.effect?.cleanup?.();
    } catch (_) {
        // cleaned
    }
    try {
        s.uiSampler?.destroy?.();
    } catch (_) {
        // gone
    }
    try {
        s.wcm?.destroy?.();
    } catch (_) {
        // gone
    }
    try {
        s.bgActor?.destroy?.();
    } catch (_) {
        // gone
    }
}

function _dismissBanner(card) {
    try {
        const id = _bannerTimers.get(card);
        if (id) {
            try {
                GLib.Source.remove(id);
            } catch (_) {
                // fired
            }
            _bannerTimers.delete(card);
        }
    } catch (_) {
        // no timer
    }
    try {
        card.ease({translation_x: 80, opacity: 0, duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try {
                    card.destroy();
                } catch (_) {
                    // gone
                }
                try {
                    _syncBannerGlass();
                } catch (_) {
                    // gone
                }
            }});
    } catch (_) {
        try {
            card.destroy();
        } catch (_) {
            // gone
        }
    }
}

// Per-frame sync while any banner is visible (same pattern as the NC
// tick): one-shot syncs go stale the moment a window underneath moves,
// resizes or opens - the glass then shows wallpaper where a window is.
function _bannerTickStart() {
    if (_bannerTickId)
        return;
    const tick = () => {
        _bannerTickId = 0;
        try {
            if (!_bannerStack || !_bannerBox)
                return GLib.SOURCE_REMOVE;
            let kids = [];
            try {
                kids = _bannerBox.get_children();
            } catch (_) {
                kids = [];
            }
            if (!kids.length)
                return GLib.SOURCE_REMOVE;
            try {
                if (!_bannerStack.bgActor.mapped)
                    return GLib.SOURCE_REMOVE;
            } catch (_) {
                return GLib.SOURCE_REMOVE;
            }
            try {
                _syncBannerGlass();
            } catch (_) {
                // next frame
            }
        } catch (_) {
            return GLib.SOURCE_REMOVE;
        }
        try {
            _bannerTickId = global.compositor.get_laters().add(
                Meta.LaterType.BEFORE_REDRAW, tick);
        } catch (_) {
            _bannerTickId = 0;
        }
        return GLib.SOURCE_REMOVE;
    };
    try {
        _bannerTickId = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, tick);
    } catch (_) {
        _bannerTickId = 0;
    }
}

function _showBanner(item) {
    try {
        if (!_bannerEnabled)
            return;
        if (_dndOn())
            return;
        if (!_ensureBannerBox())
            return;
        try {
            if (getTopbarInk() === 'light')
                _bannerBox.add_style_class_name('tahoe-qs-dark');
            else
                _bannerBox.remove_style_class_name('tahoe-qs-dark');
        } catch (_) {
            // classes stay
        }
        while (_bannerBox.get_children().length >= 4) {
            try {
                _bannerBox.get_children()[0].destroy();
            } catch (_) {
                break;
            }
        }
        const card = _makeCard(item);
        // _makeCard already wires clicked->activate; one dismiss handler
        // rides alongside (a second activate connect = double app launch)
        try {
            card.connect('clicked', () => _dismissBanner(card));
        } catch (_) {
            // static
        }
        _bannerBox.add_child(card);
        try {
            card.translation_x = 80;
            card.opacity = 0;
            card.ease({translation_x: 0, opacity: 255, duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } catch (_) {
            // shown statically
        }
        if (_ensureBannerGlass()) {
            // cards have no allocation on the first frames: retry the sync
            // a few times so the blur lands instead of staying hidden
            try {
                _syncBannerGlass();
            } catch (_) {
                // retry below
            }
            for (const ms of [80, 250, 500]) {
                try {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                        try {
                            _syncBannerGlass();
                        } catch (_) {
                            // gone
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                } catch (_) {
                    break;
                }
            }
        }
        try {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 6000, () => {
                try {
                    _bannerTimers.delete(card);
                } catch (_) {
                    // gone
                }
                _dismissBanner(card);
                return GLib.SOURCE_REMOVE;
            });
            _bannerTimers.set(card, id);
        } catch (_) {
            // stays until clicked
        }
        // live sync while visible (windows underneath stay current)
        try {
            _bannerTickStart();
        } catch (_) {
            // one-shot syncs above stand
        }
    } catch (_) {
        // box gone
    }
}

function _onTrayNotification(source) {
    try {
        const notifs = source?.notifications ?? [];
        if (!notifs.length)
            return;
        const n = notifs[notifs.length - 1];
        // already shown/acknowledged (e.g. re-hook after reload): NC list
        // still has it, no second banner
        try {
            if (n.acknowledged)
                return;
        } catch (_) {
            // unflagged: show it
        }
        // stock parity: LOW urgency never banners (NC list only)
        try {
            if (n.urgency === MessageTray.Urgency.LOW)
                return;
        } catch (_) {
            // urgency unreadable: show it
        }
        _showBanner({source, n});
        // stock marks shown banners acknowledged so the tray queue can't
        // pile up unacked items and flood stock banners on the next
        // disable/enable cycle; NC list keeps them either way
        try {
            n.acknowledged = true;
        } catch (_) {
            // read-only: queue stays
        }
    } catch (_) {
        // nothing to show
    }
}

function _hookBannerTray() {
    const hook = (obj, sig, fn) => {
        try {
            const id = obj.connect(sig, fn);
            if (id)
                _bannerHookIds.push([obj, id]);
        } catch (_) {
            // static
        }
    };
    try {
        const tray = Main.messageTray;
        if (!tray)
            return;
        // enable() runs on every settings pass: never hook twice
        // (duplicates = duplicate banners)
        if (!_hookedSrc.has(tray)) {
            _hookedSrc.add(tray);
            hook(tray, 'source-added', (t, src) => hookSource(src));
        }
        const hookSource = (src) => {
            if (!src || _hookedSrc.has(src))
                return;
            _hookedSrc.add(src);
            hook(src, 'notification-added', () => _onTrayNotification(src));
        };
        try {
            for (const src of tray.getSources?.() ?? [])
                hookSource(src);
        } catch (_) {
            // no sources
        }
    } catch (_) {
        // no tray
    }
}

function _watchTray(p) {
    const hook = (obj, sig, fn) => {
        try {
            const id = obj.connect(sig, fn);
            if (id)
                p.trayIds.push([obj, id]);
        } catch (_) {
            // static
        }
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
    } catch (_) {
        // no sources
    }
}

function _cardFill() {
    try {
        if (getPanelInk() === 'light')
            return {c: [0.18, 0.18, 0.20], a: 0.55};
    } catch (_) {
        // light fill stays
    }
    return {c: [1, 1, 1], a: 0.45};
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
                if (!card?.has_style_class_name?.('tahoe-nc-card'))
                    continue;
                if (!card.visible || !card.mapped)
                    continue;
                const [cx, cy] = card.get_transformed_position();
                const cw = card.width, ch = card.height;
                if (!(cw > 0) || !(ch > 0) || !isFinite(cx) || !isFinite(cy))
                    continue;
                const m = 20;
                regions.push({
                    x: (cx - monitor.x) - m, y: (cy - monitor.y) - m,
                    w: cw + m * 2, h: ch + m * 2,
                    tintR: 0, tintG: 0, tintB: 0, baseStrength: 0,
                });
            } catch (_) {
                // skip broken card
            }
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
    } catch (_) {
        // panel gone
    }
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
    } catch (_) {
        // panel gone
    }
}

// Adaptive ink for NC chrome + cards (CSS paints via .tahoe-qs-dark;
// this flips the class live as the background behind changes)
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
            } catch (_) {
                // gone
            }
        }
    } catch (_) {
        // classes stay
    }
}

function _buildPanel() {
    const monitor = Main.layoutManager.primaryMonitor;
    const panelH = Main.layoutManager.panelBox?.height ?? 32;
    const W = NC_W;
    const X = monitor.x + monitor.width - W - 12;
    const Y = monitor.y + panelH + 10;

    const overlay = new Clutter.Actor({
        reactive: true,
        x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height,
    });
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

    // header: clear-all X circle + title
    const head = new St.BoxLayout({style_class: 'tahoe-nc-head'});
    const clear = new St.Button({style_class: 'tahoe-nc-clear', reactive: true, can_focus: true});
    const cross = new St.Icon({style_class: 'tahoe-nc-cross', icon_name: 'window-close-symbolic', icon_size: 14});
    clear.set_child(cross);
    try {
        clear.set_tooltip_text?.(_('Clear all'));
    } catch (_) {
        // no tooltip
    }
    clear.connect('clicked', () => {
        try {
            _clearAll();
        } catch (_) {
            // nothing
        }
    });
    const title = new St.Label({style_class: 'tahoe-nc-title-big', text: _('Notification Center'), x_expand: true});
    head.add_child(title);
    head.add_child(clear);
    box.add_child(head);

    const scroll = new St.ScrollView({style_class: 'tahoe-nc-scroll', x_expand: true});
    try {
        scroll.vscrollbar_policy = St.PolicyType.NEVER;
        scroll.hscrollbar_policy = St.PolicyType.NEVER;
    } catch (_) {
        // scrollbars stay
    }
    const list = new St.BoxLayout({vertical: true, style_class: 'tahoe-nc-list', x_expand: true});
    scroll.add_child(list);
    box.add_child(scroll);

    Main.layoutManager.uiGroup.add_child(overlay);
    // under the topbar like QS: the bar keeps its own frost on top,
    // topbarBlur re-raises its band above this overlay every tick
    try {
        Main.layoutManager.uiGroup.set_child_below_sibling(overlay, Main.layoutManager.panelBox);
    } catch (_) {
        // stays on top
    }

    const p = {overlay, box, panelBg, list, stacks: [], trayIds: [], allocId: 0, tickId: 0, inkUnwatch: null};
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
            } catch (_) {
                // geometry unchanged
            }
            try {
                for (const s of p.stacks) {
                    if (s.kind === 'cards')
                        _syncCards(p, monitor, s);
                    else
                        _syncGlass(p, monitor, s);
                }
            } catch (_) {
                // no glass yet
            }
        });
    } catch (_) {
        p.allocId = 0;
    }

    // glass stacks: CC-style backdrop (pure blur + shadow) + full glass
    // under every notification card
    try {
        const bd = _makeGlassStack(monitor, NC_RADIUS, 'nc-backdrop', true, 0);
        const cards = _makeGlassStack(monitor, 20, 'nc-cards', false);
        overlay.insert_child_at_index(bd.bgActor, 1);
        overlay.insert_child_at_index(cards.bgActor, 2);
        try {
            overlay.set_child_above_sibling(panelBg, bd.bgActor);
        } catch (_) {
            // order unchanged
        }
        for (const s of [bd, cards]) {
            try {
                s.uiSampler.addExclusion(box);
            } catch (_) {
                // sampler stays
            }
            s.wcm.rebuildClones();
            s.uiSampler.rebindSelf();
            s.uiSampler.refresh();
            try {
                s.bgActor.opacity = 0;
                s.bgActor.ease({opacity: 255, duration: 160,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            } catch (_) {
                // stays
            }
        }
        p.stacks = [{kind: 'backdrop', ...bd}, {kind: 'cards', ...cards}];
        const tick = () => {
            p.tickId = 0;
            if (!_nc || _nc !== p)
                return GLib.SOURCE_REMOVE;
            if (!p.overlay.mapped)
                return GLib.SOURCE_REMOVE;
            try {
                const bd = p.stacks.find(s => s.kind === 'backdrop');
                const cards = p.stacks.find(s => s.kind === 'cards');
                if (bd)
                    _syncGlass(p, monitor, bd);
            } catch (_) {
                // gone
            }
            try {
                const cards = p.stacks.find(s => s.kind === 'cards');
                if (cards)
                    _syncCards(p, monitor, cards);
            } catch (_) {
                // gone
            }
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

    // slide in from the right + fade
    try {
        box.translation_x = 60;
        box.opacity = 0;
        panelBg.opacity = 0;
        box.ease({translation_x: 0, opacity: 255, duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        panelBg.ease({opacity: 255, duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    } catch (_) {
        try {
            box.translation_x = 0;
            box.opacity = 255;
            panelBg.opacity = 255;
        } catch (_) {
            // shown statically
        }
    }
}

export function isNCOpen() {
    try {
        return !!_nc;
    } catch (_) {
        return false;
    }
}

// Panel box actor for topbarBlur cut-outs (band never smears over it)
export function getNCPanelBox() {
    try {
        return _nc?.box ?? null;
    } catch (_) {
        return null;
    }
}

// Fullscreen overlay actor for topbarBlur layering (band stays above it)
export function getNCOverlay() {
    try {
        return _nc?.overlay ?? null;
    } catch (_) {
        return null;
    }
}

export function openNC() {
    if (_nc)
        return;
    // QS and NC never share the screen
    try {
        if (isPanelOpen())
            togglePanel();
    } catch (_) {
        // qs unavailable
    }
    try {
        _buildPanel();
    } catch (e) {
        console.error(`[tahoe-nc] open failed: ${e}`);
        try {
            closeNC();
        } catch (_) {
            // nothing
        }
    }
}

export function closeNC() {
    const p = _nc;
    _nc = null;
    if (!p)
        return;
    try {
        if (p.inkUnwatch)
            p.inkUnwatch();
    } catch (_) {
        // unwatched
    }
    try {
        for (const entry of p.trayIds) {
            try {
                if (Array.isArray(entry))
                    entry[0]?.disconnect(entry[1]);
            } catch (_) {
                // gone
            }
        }
    } catch (_) {
        // no tray
    }
    // per-source connects die with the sources; overlay teardown below
    try {
        if (p.allocId) {
            try {
                p.box.disconnect(p.allocId);
            } catch (_) {
                // gone
            }
            p.allocId = 0;
        }
    } catch (_) {
        // gone
    }
    const stacks = p.stacks;
    p.stacks = [];
    if (p.tickId) {
        try {
            global.compositor.get_laters().remove(p.tickId);
        } catch (_) {
            // already gone
        }
        p.tickId = 0;
    }
    for (const s of stacks) {
        try {
            s.effect?.cleanup?.();
        } catch (_) {
            // cleaned
        }
        try {
            s.uiSampler?.destroy?.();
        } catch (_) {
            // gone
        }
        try {
            s.wcm?.destroy?.();
        } catch (_) {
            // gone
        }
        try {
            s.bgActor?.destroy?.();
        } catch (_) {
            // gone
        }
    }
    try {
        p.overlay.destroy();
    } catch (_) {
        // gone
    }
}

export function toggleNC() {
    try {
        if (_nc)
            closeNC();
        else
            openNC();
    } catch (e) {
        console.error(`[tahoe-nc] toggle failed: ${e}`);
    }
}

let _hooked = false;

function _hookDate() {
    try {
        const dm = Main.panel?.statusArea?.dateMenu;
        const menu = dm?.menu;
        if (!menu || menu._tahoeNCHooked)
            return;
        menu._tahoeNCHooked = true;
        menu.open = () => openNC();
        menu.close = () => closeNC();
        menu.toggle = () => toggleNC();
        _hooked = true;
    } catch (_) {
        // no date menu
    }
}

export function enable(settings, gettextFunc) {
    if (typeof gettextFunc === 'function')
        _ = gettextFunc;
    _bannerEnabled = true;
    try {
        const tray = Main.messageTray;
        if (tray) {
            try {
                _bannerWasBlocked = !!tray.bannerBlocked;
            } catch (_) {
                _bannerWasBlocked = false;
            }
            try {
                tray.bannerBlocked = true;
            } catch (_) {
                // stock banners stay
            }
        }
    } catch (_) {
        // no tray
    }
    _hookBannerTray();
    _hookDate();
}

export function disable() {
    _ = (m) => m;
    _bannerEnabled = false;
    try {
        for (const [obj, id] of _bannerHookIds) {
            try {
                obj?.disconnect(id);
            } catch (_) {
                // gone
            }
        }
    } catch (_) {
        // no hooks
    }
    _bannerHookIds = [];
    _hookedSrc.clear();
    try {
        for (const [card, id] of _bannerTimers) {
            try {
                GLib.Source.remove(id);
            } catch (_) {
                // fired
            }
            try {
                card?.destroy();
            } catch (_) {
                // gone
            }
        }
    } catch (_) {
        // no timers
    }
    _bannerTimers = new Map();
    _destroyBannerGlass();
    try {
        _bannerBox?.destroy();
    } catch (_) {
        // gone
    }
    _bannerBox = null;
    try {
        const tray = Main.messageTray;
        if (tray && !_bannerWasBlocked) {
            try {
                tray.bannerBlocked = false;
            } catch (_) {
                // stays blocked
            }
        }
    } catch (_) {
        // no tray
    }
    try {
        closeNC();
    } catch (_) {
        // already closed
    }
    try {
        const dm = Main.panel?.statusArea?.dateMenu;
        const menu = dm?.menu;
        if (menu && menu._tahoeNCHooked) {
            // calendar stays replaced while enabled; restore stock handlers
            delete menu.open;
            delete menu.close;
            delete menu.toggle;
            delete menu._tahoeNCHooked;
        }
    } catch (_) {
        // gone
    }
    _hooked = false;
}
