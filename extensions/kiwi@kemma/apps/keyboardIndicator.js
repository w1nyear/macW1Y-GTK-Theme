// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-style keyboard badge for the top panel: a filled rounded rect with
// the layout code (RU/DE/EN…) punched out as transparent glyphs (Cairo
// DEST_OUT), so the panel shows through the letter shapes.
//
// NOTE (GNOME 50): the stock indicator holds one label per source and the
// panel button only ever allocates its FIRST child — so the badge lives
// inside the indicator's own container (which stacks all children) and all
// stock labels stay hidden. Text comes straight from InputSourceManager.

import Cairo from 'cairo';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {getTopbarInk, watchInk} from './tahoeInk.js';

const BADGE_FONT_PX = 10;
const BADGE_PAD_X = 5;
const BADGE_PAD_Y = 4;
const BADGE_RADIUS = 5;
const EN_SET = new Set(['en', 'us', 'gb']);

let _state = null;

function _badgeFont() {
    const desc = new Pango.FontDescription();
    desc.set_family('Sans');
    desc.set_weight(Pango.Weight.BOLD);
    desc.set_size(BADGE_FONT_PX * Pango.SCALE);
    return desc;
}

function _badgeMeasureLayout() {
    if (!_state?.badgeMeasure) {
        const fontmap = PangoCairo.FontMap.get_default();
        _state.badgeMeasure = Pango.Layout.new(fontmap.create_context());
        _state.badgeMeasure.set_font_description(_badgeFont());
    }
    return _state.badgeMeasure;
}

function _badgeWantSize(text) {
    if (!text || !_state)
        return [1, 1];
    const layout = _badgeMeasureLayout();
    layout.set_text(text, -1);
    // Ink extents (real glyph bounds), not the full line box — otherwise
    // the badge comes out a tall slab.
    const [ink] = layout.get_pixel_extents();
    return [ink.width + BADGE_PAD_X * 2, ink.height + BADGE_PAD_Y * 2];
}

function _badgeInk(text, cr) {
    const layout = PangoCairo.create_layout(cr);
    layout.set_font_description(_badgeFont());
    layout.set_text(text, -1);
    const [ink] = layout.get_pixel_extents();
    return {layout, ink};
}

function _badgeFill() {
    // Dark pill on light surroundings, light pill on dark ones.
    // Adaptive ink first, panel classes + theme as fallback.
    try {
        const ink = getTopbarInk();
        if (ink === 'dark')
            return [0, 0, 0, 0.85];
        if (ink === 'light')
            return [1, 1, 1, 0.92];
    } catch (_) {
        // fall through
    }
    const panel = Main.panel;
    if (panel?.has_style_class_name?.('kiwi-panel-dark-text'))
        return [0, 0, 0, 0.85];
    if (panel?.has_style_class_name?.('kiwi-panel-light-text'))
        return [1, 1, 1, 0.92];
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (iface.get_string('color-scheme') === 'prefer-dark')
            return [1, 1, 1, 0.92];
    } catch (_) {
        // fall through to the dark pill
    }
    return [0, 0, 0, 0.85];
}

function _roundedRect(cr, x, y, w, h, r) {
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    cr.closePath();
}

function _onBadgeRepaint(area) {
    const text = _state?.badgeText ?? '';
    const cr = area.get_context();
    const [sw, sh] = area.get_surface_size();
    const aw = area.width || 1;
    const ah = area.height || 1;
    cr.save();
    cr.scale(sw / aw, sh / ah);
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    if (text.length > 0) {
        const {layout, ink} = _badgeInk(text, cr);
        const wantW = ink.width + BADGE_PAD_X * 2;
        const wantH = ink.height + BADGE_PAD_Y * 2;
        if (Math.abs(aw - wantW) > 0.5 || Math.abs(ah - wantH) > 0.5) {
            // Resize first; the next repaint after allocation draws.
            cr.restore();
            cr.$dispose();
            area.set_size(wantW, wantH);
            return;
        }
        const [fr, fg, fb, fa] = _badgeFill();
        cr.setOperator(Cairo.Operator.SOURCE);
        cr.setSourceRGBA(fr, fg, fb, fa);
        _roundedRect(cr, 0.5, 0.5, aw - 1, ah - 1, BADGE_RADIUS);
        cr.fill();
        // Punch the glyphs out: panel shows through the letter shapes.
        cr.setOperator(Cairo.Operator.DEST_OUT);
        cr.moveTo((aw - ink.width) / 2 - ink.x, (ah - ink.height) / 2 - ink.y);
        PangoCairo.show_layout(cr, layout);
    }
    cr.restore();
    cr.$dispose();
}

function _badgeHost() {
    // The indicator's own container stacks every child (preferred size is
    // the max, all children get allocated) — unlike the panel button, which
    // only ever allocates its first child.
    return _state?.indicator?._container ?? _state?.indicator ?? null;
}

function _hideAllLabels() {
    // Detach beats hiding: the shell re-shows labels on several paths
    // (source switch, keymap change), but show() on a detached actor is a
    // no-op, so no race is possible. Stashed for re-adding on disable.
    const host = _badgeHost();
    if (!host)
        return;
    _state.stripped = _state.stripped ?? [];
    for (const child of [...(host.get_children?.() ?? [])]) {
        if (child instanceof St.Label && child !== _state?.badge &&
            !_state.stripped.includes(child)) {
            try {
                host.remove_child(child);
                _rememberStripped(child);
            } catch (_) {
                // already gone
            }
        }
    }
}

function _rememberStripped(label) {
    // The shell destroys stashed labels on input-source rebuilds; re-adding
    // a dead actor segfaults Clutter (no JS exception to catch). Prune on
    // destroy via WeakRef so the stash only ever holds live actors and
    // nothing is leaked by the tracking itself.
    if (_state.stripped.includes(label))
        return;
    _state.stripped.push(label);
    try {
        const ref = new WeakRef(label);
        label.connect('destroy', () => {
            const dead = ref.deref?.();
            const arr = _state?.stripped;
            if (!arr)
                return;
            const i = arr.indexOf(dead);
            if (i >= 0)
                arr.splice(i, 1);
        });
    } catch (_) {
        // cannot track; stash stays (restore probes before adding)
    }
}

function _restoreLabels() {
    const host = _badgeHost();
    let hostOk = false;
    try {
        hostOk = !!host && typeof host.get_children === 'function' &&
            (host.get_children(), true);
    } catch (_) {
        hostOk = false;
    }
    for (const label of [...(_state?.stripped ?? [])]) {
        if (!hostOk)
            break;
        let detached = false;
        try {
            detached = label.get_parent() === null;
        } catch (_) {
            detached = false;
        }
        if (!detached)
            continue;
        try {
            host.add_child(label);
            label.visible = true;
        } catch (_) {
            // actor died mid-restore
        }
    }
    if (_state)
        _state.stripped = [];
}

function _currentShortName() {
    try {
        const manager = Keyboard.getInputSourceManager();
        const source = manager?.currentSource;
        const id = source?.id ? String(source.id).match(/^[A-Za-z]+/)?.[0]?.toLowerCase() : null;
        if (!id)
            return '';
        if (id === 'ru')
            return 'РУ';
        if (EN_SET.has(id))
            return 'A';
        return id.length <= 3 ? id.toUpperCase() : '';
    } catch (_) {
        return '';
    }
}

function _ensureBadge() {
    if (!_state?.indicator || _state.badge)
        return;
    const host = _badgeHost();
    if (!host)
        return;
    const badge = new St.DrawingArea({reactive: false});
    _state.badge = badge;
    _state.badgeText = '';
    host.add_child(badge);
    badge.connect('repaint', () => _onBadgeRepaint(badge));
    // Catch labels created on ANY path (source switch, keymap change,
    // rebuild): strip them the moment they land in the container.
    if (!_state.hostChildAddedId) {
        try {
            _state.hostChildAddedId = host.connect('child-added', (_c, child) => {
                if (child instanceof St.Label && child !== _state?.badge) {
                    try {
                        host.remove_child(child);
                    } catch (_) {
                        // already gone
                    }
                    if (_state && !_state.stripped.includes(child))
                        _rememberStripped(child);
                }
            });
        } catch (_) {
            // host may be gone
        }
    }
    _hideAllLabels();
    _updateBadge();
}

function _updateBadge() {
    if (!_state?.badge)
        return;
    const text = _currentShortName();
    // Synchronous size: a zero-size DrawingArea never gets a repaint,
    // so force it on every change (same values are a cheap no-op).
    const [wantW, wantH] = _badgeWantSize(text);
    _state.badge.set_size(wantW, wantH);
    if (_state.badgeText !== text)
        _state.badgeText = text;
    _state.badge.queue_repaint();
    _hideAllLabels();
}

function _destroyBadge() {
    if (!_state)
        return;
    if (_state.badge) {
        try {
            _state.badge.destroy();
        } catch (_) {
            // already gone
        }
        _state.badge = null;
    }
    _state.badgeMeasure = null;
    _state.badgeText = '';
}

function _onInputSourceChanged() {
    _hideAllLabels();
    _updateBadge();
}

function _onSourcesChanged() {
    // Source set rebuilt: fresh labels appear visible — hide them again.
    _hideAllLabels();
    _updateBadge();
}

function _applyVisibility() {
    if (!_state?.indicator)
        return false;
    const hidden = _state.settings.get_boolean('hide-keyboard-indicator');
    const shellVisible = _state.shellVisible ?? _state.indicator.visible;
    if (_state.indicator._kiwiOriginalVisible === undefined)
        _state.indicator._kiwiOriginalVisible = shellVisible;
    const shouldBeVisible = !hidden && shellVisible;
    if (_state.indicator.visible === shouldBeVisible)
        return shouldBeVisible;
    _state.updatingVisibility = true;
    try {
        _state.indicator.visible = shouldBeVisible;
    } finally {
        _state.updatingVisibility = false;
    }
    return shouldBeVisible;
}

function _syncIndicatorState() {
    if (!_state?.indicator)
        return;
    const isVisible = _applyVisibility();
    if (isVisible)
        _state.indicator.add_style_class_name('kiwi-input-themed');
    else
        _state.indicator.remove_style_class_name('kiwi-input-themed');
    _ensureBadge();
    _updateBadge();
}

function _getIndicator() {
    const sa = Main.panel?.statusArea;
    if (!sa)
        return null;
    return sa.keyboard || sa.inputSource || sa.inputMethod || null;
}

function _connect() {
    if (!_state?.indicator)
        return;
    if (!_state.visibilityChangedId) {
        _state.visibilityChangedId = _state.indicator.connect('notify::visible', actor => {
            if (!_state || _state.updatingVisibility)
                return;
            _state.shellVisible = actor.visible;
            actor._kiwiOriginalVisible = actor.visible;
            _syncIndicatorState();
        });
    }
    const inputSourceManager = Keyboard.getInputSourceManager();
    if (inputSourceManager && !_state.inputManagerChangedId) {
        _state.inputManagerChangedId = inputSourceManager.connect('current-source-changed',
            _onInputSourceChanged);
    }
    if (inputSourceManager && !_state.sourcesChangedId) {
        _state.sourcesChangedId = inputSourceManager.connect('sources-changed',
            _onSourcesChanged);
    }
    if (Main.panel && !_state.panelStyleChangedId) {
        _state.panelStyleChangedId = Main.panel.connect('style-changed',
            () => _updateBadge());
    }
    if (!_state.inkUnwatch) {
        try {
            _state.inkUnwatch = watchInk(() => _updateBadge());
        } catch (_) {
            _state.inkUnwatch = null;
        }
    }
}

function _disconnect() {
    const inputSourceManager = Keyboard.getInputSourceManager();
    if (_state?.inputManagerChangedId) {
        try {
            inputSourceManager?.disconnect(_state.inputManagerChangedId);
        } catch (_) {
            // manager may be gone
        }
        _state.inputManagerChangedId = 0;
    }
    if (_state?.sourcesChangedId) {
        try {
            inputSourceManager?.disconnect(_state.sourcesChangedId);
        } catch (_) {
            // manager may be gone
        }
        _state.sourcesChangedId = 0;
    }
    if (_state?.visibilityChangedId && _state.indicator) {
        try {
            _state.indicator.disconnect(_state.visibilityChangedId);
        } catch (_) {
            // already gone
        }
        _state.visibilityChangedId = 0;
    }
    if (_state?.panelStyleChangedId && Main.panel) {
        try {
            Main.panel.disconnect(_state.panelStyleChangedId);
        } catch (_) {
            // panel may be gone
        }
        _state.panelStyleChangedId = 0;
    }
    if (_state?.inkUnwatch) {
        try {
            _state.inkUnwatch();
        } catch (_) {
            // gone
        }
        _state.inkUnwatch = null;
    }
    if (_state?.hostChildAddedId) {
        try {
            const host = _badgeHost();
            host?.disconnect?.(_state.hostChildAddedId);
        } catch (_) {
            // host may be gone
        }
        _state.hostChildAddedId = 0;
    }
    if (_state?.indicatorDestroyId && _state.indicator) {
        try {
            _state.indicator.disconnect(_state.indicatorDestroyId);
        } catch (_) {
            // already gone
        }
        _state.indicatorDestroyId = 0;
    }
}

function _onIndicatorDestroyed() {
    if (!_state)
        return;
    _state.indicator = null;
    _state.visibilityChangedId = 0;
}

export function enable(settings) {
    if (_state)
        return;
    const indicator = _getIndicator();
    if (!indicator)
        return;
    _state = {
        indicator,
        badge: null,
        badgeText: '',
        badgeMeasure: null,
        settings,
        inputManagerChangedId: 0,
        sourcesChangedId: 0,
        visibilityChangedId: 0,
        panelStyleChangedId: 0,
        shellVisible: indicator.visible,
        updatingVisibility: false,
        indicatorDestroyId: 0,
    };
    _state.indicatorDestroyId = indicator.connect('destroy', _onIndicatorDestroyed);
    _connect();
    _syncIndicatorState();
}

export function disable() {
    if (!_state)
        return;
    _disconnect();
    _destroyBadge();
    // Give the stock labels back.
    _restoreLabels();
    if (_state.indicator) {
        if (_state.shellVisible !== undefined) {
            try {
                _state.indicator.visible = _state.shellVisible;
            } catch (_) {
                // actor may be gone
            }
        }
        if (_state.indicator._kiwiOriginalVisible !== undefined) {
            try {
                _state.indicator._kiwiOriginalVisible = undefined;
            } catch (_) {
                // ignore
            }
        }
        try {
            _state.indicator.remove_style_class_name('kiwi-input-themed');
            _state.indicator.remove_style_class_name('kiwi-input-en');
        } catch (_) {
            // ignore
        }
    }
    _state = null;
}
