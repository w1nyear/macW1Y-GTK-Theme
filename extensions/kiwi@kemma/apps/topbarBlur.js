// SPDX-License-Identifier: GPL-3.0-or-later
// Persistent macOS-style topbar backdrop: pure blur behind the panel,
// full at the top screen edge, dissipating downward over TOP_FADE px.
// Layering: uiGroup below panelBox (paints over windows). Input is
// wallpaper only - all UI newborn-excluded every frame, all windows
// culled via NOWHERE_RECT. Same pure-blur params as the QS backdrop
// (no tint, no refraction, no rim).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Liquid-glass helpers live in another extension. Static
// `import ... from 'file://' + ...` is a SyntaxError (module specifiers must
// be string literals), so load them dynamically at runtime.
let ensureGlassAllocated = () => {};
let setClipIfChanged = () => {};
let syncGlassCaptureClip = () => {};
import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist/utils.js').then(m => {
    if (m.ensureGlassAllocated)
        ensureGlassAllocated = m.ensureGlassAllocated;
    if (m.setClipIfChanged)
        setClipIfChanged = m.setClipIfChanged;
    if (m.syncGlassCaptureClip)
        syncGlassCaptureClip = m.syncGlassCaptureClip;
}).catch(e => console.warn(`[tahoe-topbar-blur] liquid-glass utils unavailable: ${e}`));
import {_makeGlassStack, getQSPanelBox, getQSOverlay} from './tahoeQuickSettings.js';
import {getNCPanelBox, getNCOverlay} from './tahoeNotifications.js';

const SHADER_PAD = 20;
// topbar fade tail: shorter than the QS backdrop (60) - the bar is thin
const TOP_FADE = 12;
// windows stay out of the blur entirely: cull rect that hits nothing.
// (bgClone wallpaper uses a separate clip path and is unaffected.)
const NOWHERE_RECT = [-100000, -100000, 1, 1];

let _settings = null;
let _stack = null;
let _frameId = 0;
let _monitorsId = 0;

function _blur() {
    try {
        return _settings?.get_int?.('tahoe-qs-glass-blur') ?? 8;
    } catch (_) {
        return 8;
    }
}

// Window-aware output: the band minus window rects (x-segmentation).
// Windows stay sharp under the panel; blur lives only where they aren't.
// Returns {key, rects} - key cached so setGlassRegions runs on change only.
function _bandSegments(monitor, panelH) {
    const F = TOP_FADE, P = SHADER_PAD;
    const y = -F - P, h = panelH + 2 * (F + P);
    const W = monitor.width;
    const empty = {key: `${W}x${panelH}|`, rects: []};
    let iv = [];
    try {
        const bandTop = monitor.y, bandBot = monitor.y + panelH + F + P;
        const actors = global.get_window_actors();
        for (const a of actors) {
            try {
                if (!a.visible)
                    continue;
                let mw = null;
                try {
                    mw = a.get_meta_window();
                } catch (_) {
                    mw = null;
                }
                if (mw) {
                    if (mw.minimized)
                        continue;
                    try {
                        const t = mw.get_window_type();
                        if (t !== Meta.WindowType.NORMAL &&
                            t !== Meta.WindowType.DIALOG)
                            continue;
                    } catch (_) {
                        // unknown type: count it
                    }
                }
                const [ax, ay] = a.get_transformed_position();
                const aw = a.width, ah = a.height;
                if (!(aw > 0 && ah > 0))
                    continue;
                if (ay + ah <= bandTop || ay >= bandBot)
                    continue;
                let x0 = Math.max(0, Math.round(ax - monitor.x));
                let x1 = Math.min(W, Math.round(ax + aw - monitor.x));
                if (x1 - x0 >= 4)
                    iv.push([x0, x1]);
            } catch (_) {
                // actor gone
            }
        }
    } catch (_) {
        return empty;
    }
    // QS / NC panels overlap the band's fade tail: cut them out like
    // windows, otherwise the bar frost smears over the panel top edge
    for (const getBox of [getQSPanelBox, getNCPanelBox]) {
        try {
            const b = getBox();
            if (!b || !b.visible || !b.mapped)
                continue;
            const [bx, by] = b.get_transformed_position();
            const bw = b.width, bh = b.height;
            if (!(bw > 0 && bh > 0))
                continue;
            if (by + bh <= bandTop || by >= bandBot)
                continue;
            let x0 = Math.max(0, Math.round(bx - monitor.x));
            let x1 = Math.min(W, Math.round(bx + bw - monitor.x));
            if (x1 - x0 >= 4)
                iv.push([x0, x1]);
        } catch (_) {
            // panel gone
        }
    }
    iv.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const [a, b] of iv) {
        const last = merged[merged.length - 1];
        if (last && a <= last[1])
            last[1] = Math.max(last[1], b);
        else
            merged.push([a, b]);
    }
    const rects = [];
    let cur = 0;
    for (const [a, b] of merged) {
        if (a - cur >= 8)
            rects.push({x: cur - P, y, w: (a - cur) + 2 * P, h,
                tintR: 0, tintG: 0, tintB: 0, baseStrength: 0});
        cur = Math.max(cur, b);
    }
    if (W - cur >= 8)
        rects.push({x: cur - P, y, w: (W - cur) + 2 * P, h,
            tintR: 0, tintG: 0, tintB: 0, baseStrength: 0});
    const key = `${W}x${panelH}|` + merged.map(p => p.join('-')).join(',');
    return {key, rects};
}

// Ghost-proofing: this band overlaps the panel, so clone NOTHING from the
// UI layer - wallpaper + windows only (macOS behaviour). Runs EVERY frame
// (before refresh) so newborn actors (Spotlight, banners, OSD, QS overlay)
// are excluded the same frame they appear - a geometry-gated sweep misses
// anything born between geometry changes.
function _excludeUi(s) {
    try {
        const uiGroup = Main.layoutManager.uiGroup;
        for (const child of uiGroup.get_children()) {
            try {
                if (child === s.bgActor)
                    continue;
                if (child === Main.layoutManager._backgroundGroup)
                    continue;
                s.uiSampler.addExclusion(child);
            } catch (_) {
                // gone
            }
        }
    } catch (_) {
        // no ui group
    }
}

function _sync() {
    const s = _stack;
    if (!s)
        return;
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const W = monitor.width, H = monitor.height;
        const panelH = Math.round(Main.layoutManager.panelBox?.height ?? 34);
        const F = TOP_FADE, P = SHADER_PAD;
        s.bgActor.set_position(monitor.x, monitor.y);
        _excludeUi(s);
        // output regions are window-aware (see tick); geometry here is static
        s.effect.setResolution(W, H);
        s.effect.setBlurRadius(_blur());
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(W, H);
        const clip = [-F - 100, -F - 100,
            W + 2 * (F + 100), panelH + 2 * (F + 100)];
        if (!s.clip || s.clip[0] !== clip[0] || s.clip[1] !== clip[1] ||
            s.clip[2] !== clip[2] || s.clip[3] !== clip[3]) {
            s.clip = clip;
            setClipIfChanged(s.bgActor, clip[0], clip[1], clip[2], clip[3]);
        }
        if (!s.screen || s.screen[0] !== W || s.screen[1] !== H ||
            s.panelH !== panelH) {
            s.screen = [W, H];
            s.panelH = panelH;
        }
        s.wcm.setOffset(-monitor.x, -monitor.y);
        syncGlassCaptureClip({            cloneContainer: s.cloneContainer,
            effect: s.effect,
            originX: monitor.x,
            originY: monitor.y,
            uiSampler: s.uiSampler,
            windowCloneManager: s.wcm,
        });
        // windows out: cull every window clone (persists until next _sync,
        // which re-applies it the same way)
        try {
            s.wcm.setCullRect(NOWHERE_RECT);
        } catch (_) {
            // uncullable
        }
        s.uiSampler.refresh();
        s.uiSampler.sync(monitor.x, monitor.y, W, H);
        s.wcm.sync();
    } catch (_) {
        // panel gone
    }
}

export function enable(settings) {
    if (settings)
        _settings = settings;
    if (_stack) {
        // settings pass: live-update blur strength + geometry
        try {
            _stack.effect.setBlurRadius(_blur());
        } catch (_) {
            // effect gone
        }
        _sync();
        return;
    }
    try {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const s = _makeGlassStack(monitor, 12, 'topbar', true, TOP_FADE);
        _stack = {...s, clip: null, screen: null, panelH: 0,
            geoKey: null, segKey: null, tickN: 5};
        // back to the variant that visibly worked: uiGroup, below panelBox.
        // (stage-bottom placement left the band with empty input.)
        try {
            Main.layoutManager.uiGroup.add_child(s.bgActor);
            try {
                Main.layoutManager.uiGroup.set_child_below_sibling(
                    s.bgActor, Main.layoutManager.panelBox);
                console.log('[tahoe-topbar-blur] placed below panelBox');
            } catch (_) {
                try {
                    Main.layoutManager.uiGroup.set_child_at_index(s.bgActor, 0);
                    console.log('[tahoe-topbar-blur] placed at uiGroup 0');
                } catch (_) {
                    // order unchanged
                }
            }
        } catch (e) {
            console.log(`[tahoe-topbar-blur] insert FAILED: ${e}`);
            _stack = null;
            return;
        }
        s.bgActor.opacity = 0;
        s.bgActor.ease({opacity: 255, duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        _sync();
        // one-shot diagnostic: allocation + clone inventory after settle
        try {
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                try {
                    if (!_stack)
                        return GLib.SOURCE_REMOVE;
                    const b = _stack.bgActor;
                    const [bx, by] = b.get_transformed_position();
                    const lb = _stack.liquidBox;
                    const cc = _stack.cloneContainer;
                    const nKids = cc ? cc.get_n_children() : -1;
                    const wcm = _stack.wcm;
                    const bgc = wcm ? wcm.bgClone : null;
                    let bgGeo = '?';
                    try {
                        if (bgc) {
                            const [gx, gy] = bgc.get_transformed_position();
                            bgGeo = `${Math.round(gx)},${Math.round(gy)} ${Math.round(bgc.width)}x${Math.round(bgc.height)}`;
                        } else {
                            bgGeo = 'null';
                        }
                    } catch (_) {
                        bgGeo = 'err';
                    }
                    console.log(`[tahoe-topbar-blur] bgActor=${Math.round(bx)},${Math.round(by)} ${Math.round(b.width)}x${Math.round(b.height)} vis=${b.visible} op=${b.opacity} mapped=${b.mapped}`);
                    console.log(`[tahoe-topbar-blur] liquidBox=${Math.round(lb.width)}x${Math.round(lb.height)} clones=${nKids} bgClone=${bgGeo} panelH=${_stack.panelH}`);
                } catch (_) {
                    // gone
                }
                return GLib.SOURCE_REMOVE;
            });
        } catch (_) {
            // no clock
        }
        if (!_monitorsId) {
            try {
                _monitorsId = Main.layoutManager.connect('monitors-changed',
                    () => _sync());
            } catch (_) {
                _monitorsId = 0;
            }
        }
        const tick = () => {
            if (!_stack)
                return GLib.SOURCE_REMOVE;
            try {
                ensureGlassAllocated(_stack.bgActor);
            } catch (_) {
                // not allocated yet
            }
            try {
                // Invisible throttle: the band is static, so heavy sampler
                // work runs at ~10fps (every 6th frame); exclusion sweep at
                // ~20fps (every 3rd) so newborn popups never ghost a full
                // frame longer than ~50ms. Geometry check stays per-frame.
                const n = (_stack.tickN = ((_stack.tickN ?? 0) + 1) % 6);
                if (n % 3 === 0)
                    _excludeUi(_stack);
                const monitor = Main.layoutManager.primaryMonitor;
                const panelH = Math.round(
                    Main.layoutManager.panelBox?.height ?? 0);
                const geoKey = monitor
                    ? `${monitor.width}x${monitor.height}x${panelH}` : '?';
                if (geoKey !== _stack.geoKey) {
                    _stack.geoKey = geoKey;
                    _sync();
                }
                // window-aware output regions + sampler work: heavy, ~10fps.
                // Cached by key, so idle frames cost nothing here.
                if (n === 0) {
                    try {
                        const m = monitor ?? Main.layoutManager.primaryMonitor;
                        if (m) {
                            const segs = _bandSegments(m, _stack.panelH || panelH);
                            if (segs.key !== _stack.segKey) {
                                _stack.segKey = segs.key;
                                _stack.effect.setGlassRegions(segs.rects);
                                const show = segs.rects.length > 0;
                                if (_stack.bgActor.visible !== show)
                                    _stack.bgActor.visible = show;
                            }
                        }
                    } catch (_) {
                        // regions stay
                    }
                    // layering: the band paints above QS/NC overlays (both
                    // sit below panelBox, so the bar keeps its own frost on
                    // top and CC/NC backdrop never covers the icons)
                    try {
                        const ug = Main.layoutManager.uiGroup;
                        for (const getOv of [getQSOverlay, getNCOverlay]) {
                            let ov = null;
                            try {
                                ov = getOv();
                            } catch (_) {
                                ov = null;
                            }
                            if (!ov)
                                continue;
                            try {
                                const kids = ug.get_children();
                                if (ov.get_parent() === ug &&
                                    _stack.bgActor.get_parent() === ug &&
                                    kids.indexOf(_stack.bgActor) < kids.indexOf(ov))
                                    ug.set_child_above_sibling(_stack.bgActor, ov);
                            } catch (_) {
                                // order stays
                            }
                        }
                    } catch (_) {
                        // no ui group
                    }
                    _stack.uiSampler.refresh();
                    _stack.wcm.sync();
                }
            } catch (_) {
                // tearing down
            }
            try {
                _frameId = global.compositor.get_laters().add(
                    Meta.LaterType.BEFORE_REDRAW, tick);
            } catch (_) {
                _frameId = 0;
            }
            return GLib.SOURCE_REMOVE;
        };
        try {
            _frameId = global.compositor.get_laters().add(
                Meta.LaterType.BEFORE_REDRAW, tick);
        } catch (_) {
            _frameId = 0;
        }
    } catch (_) {
        _stack = null;
    }
}

export function disable() {
    if (_frameId) {
        try {
            global.compositor.get_laters().remove(_frameId);
        } catch (_) {
            // already gone
        }
        _frameId = 0;
    }
    if (_monitorsId) {
        try {
            Main.layoutManager.disconnect(_monitorsId);
        } catch (_) {
            // gone
        }
        _monitorsId = 0;
    }
    const s = _stack;
    _stack = null;
    _settings = null;
    if (!s)
        return;
    try {
        s.effect?.cleanup?.();
    } catch (_) {
        // already cleaned
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
