import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { CornerEffect } from '../effects/corner.js';

function primaryModifier(mask) {
    if (mask & Clutter.ModifierType.MOD1_MASK)
        return Clutter.ModifierType.MOD1_MASK;
    if (mask & Clutter.ModifierType.MOD4_MASK)
        return Clutter.ModifierType.MOD4_MASK;
    if (mask & Clutter.ModifierType.SUPER_MASK)
        return Clutter.ModifierType.SUPER_MASK;
    if (mask & Clutter.ModifierType.CONTROL_MASK)
        return Clutter.ModifierType.CONTROL_MASK;
    if (mask & Clutter.ModifierType.SHIFT_MASK)
        return Clutter.ModifierType.SHIFT_MASK;
    return 0;
}

const ACCENT_COLOR_MAP = {
    'blue': '#007aff',
    'teal': '#30b0c7',
    'green': '#34c759',
    'yellow': '#ffcc00',
    'orange': '#ff9500',
    'red': '#ff3b30',
    'pink': '#ff2d55',
    'purple': '#af52de',
    'slate': '#8e8e93',
};

function getSystemAccentColor() {
    try {
        const Gio = imports.gi.Gio;
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#007aff';
    } catch (_e) {
        return '#007aff';
    }
}

function getShortLabel(source) {
    const id = (source.id || '').toLowerCase();
    const short = (source.shortName || '').toLowerCase();
    if (id === 'us' || id === 'en' || short === 'en') return 'A';
    if (id === 'ua' || id === 'uk' || short === 'uk' || short === 'ua') return 'ук';
    if (id === 'ru' || short === 'ru') return 'ру';
    if (id === 'by' || short === 'by') return 'бе';
    if (id === 'pl' || short === 'pl') return 'pl';
    if (id === 'de' || short === 'de') return 'de';
    if (id === 'fr' || short === 'fr') return 'fr';
    if (id === 'es' || short === 'es') return 'es';
    if (id === 'it' || short === 'it') return 'it';
    if (id === 'pt' || short === 'pt') return 'pt';
    if (id === 'cs' || short === 'cs') return 'cs';
    if (id === 'tr' || short === 'tr') return 'tr';
    if (id === 'zh' || short === 'zh') return '拼';
    if (id === 'ja' || short === 'ja') return 'あ';
    if (id === 'ko' || short === 'ko') return '한';
    return (source.shortName || source.id || '?').substring(0, 2);
}

function getOsdLabel(source) {
    const id = (source.id || '').toLowerCase();
    const short = (source.shortName || '').toLowerCase();
    if (id === 'us' || id === 'en' || short === 'en') return 'ABC';
    if (id === 'ua' || id === 'uk' || short === 'uk' || short === 'ua') return 'Українська';
    if (id === 'ru' || short === 'ru') return 'Русская';
    if (id === 'by' || short === 'by') return 'Беларуская';
    if (id === 'pl' || short === 'pl') return 'Polski';
    if (id === 'de' || short === 'de') return 'Deutsch';
    if (id === 'fr' || short === 'fr') return 'Français';
    if (id === 'es' || short === 'es') return 'Español';
    if (id === 'it' || short === 'it') return 'Italiano';
    if (id === 'pt' || short === 'pt') return 'Português';
    if (id === 'cs' || short === 'cs') return 'Čeština';
    if (id === 'tr' || short === 'tr') return 'Türkçe';
    if (id === 'zh' || short === 'zh') return '简体中文';
    if (id === 'ja' || short === 'ja') return '日本語';
    if (id === 'ko' || short === 'ko') return '한국어';
    if (source.displayName) {
        return source.displayName.replace(/\s*\(.*?\)/, '');
    }
    return source.id || 'Unknown';
}

function getActiveCaret() {
    // 1. Clutter / St focus (GNOME Shell internal entries)
    const stageFocus = global.stage.get_key_focus();
    if (stageFocus && (stageFocus instanceof Clutter.Text || stageFocus.clutter_text)) {
        const text = stageFocus instanceof Clutter.Text ? stageFocus : stageFocus.clutter_text;
        const [tx, ty] = text.get_transformed_position();
        const r = text.get_cursor_rect();
        if (r) {
            return {
                type: 'shell',
                x: Math.round(tx + r.get_x()),
                y: Math.round(ty + r.get_y()),
                w: Math.max(1, Math.round(r.get_width())),
                h: Math.max(16, Math.round(r.get_height()))
            };
        }
    }

    // 2. Wayland / X11 application text focus via Main.inputMethod
    const im = Main.inputMethod;
    const focusWin = global.display.focus_window;
    if (im && im._currentFocus && im._cursorRect) {
        const r = im._cursorRect;
        let winOk = true;
        if (focusWin && !focusWin.is_override_redirect()) {
            const fr = focusWin.get_frame_rect();
            winOk = (r.x >= fr.x - 40 && r.x <= fr.x + fr.width + 40 &&
                     r.y >= fr.y - 40 && r.y <= fr.y + fr.height + 40);
        }
        if (winOk && r.x > 0 && r.y > 0) {
            return {
                type: 'app',
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.max(1, Math.round(r.width || 1)),
                h: Math.max(16, Math.round(r.height || 18))
            };
        }
    }

    return null;
}

const _UID = Math.floor(Math.random() * 100000000);

export const MacInputSourcePopup = GObject.registerClass({
    GTypeName: `MacInputSourcePopup_${_UID}`,
}, class MacInputSourcePopup extends St.Widget {
    _init(items, action, actionBackward, caretInfo, currentIndex, nextIndex) {
        super._init({
            reactive: true,
            visible: false,
            opacity: 0,
        });

        this.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));

        this._items = items;
        this._action = action;
        this._actionBackward = actionBackward;
        this._caretInfo = caretInfo;
        this._currentIndex = currentIndex;
        this._nextIndex = nextIndex;
        this._selectedIndex = currentIndex;

        this._haveModal = false;
        this._grab = null;
        this._modifierMask = 0;
        this._fadeTimeoutId = 0;
        this._isDestroying = false;
        this._labels = [];

        this.connect('destroy', this._onDestroy.bind(this));

        Main.uiGroup.add_child(this);

        if (this._caretInfo) {
            this._buildCaretUI();
        } else {
            this._buildOsdUI();
        }

        // Dismiss on click outside
        this.connect('button-press-event', (actor, event) => {
            const [clickX, clickY] = event.get_coords();
            let inside = false;
            const target = this._capsuleBox || this._osdBox;
            if (target) {
                const x = target.x;
                const y = target.y;
                const w = target.width;
                const h = target.height;
                inside = (clickX >= x && clickX <= x + w && clickY >= y && clickY <= y + h);
            }
            if (!inside) {
                this.fadeAndDestroy();
            }
            return Clutter.EVENT_STOP;
        });
    }

    _buildCaretUI() {
        const N = this._items.length;
        const M = 3;            // 3px margin from capsule edge on all 4 sides
        const W_pill = 32;      // Width of each language pill/slot
        const H_pill = 22;      // Height of orange pill
        const H_capsule = 28;   // Height of capsule: (28 - 22) / 2 = 3px vertical margin
        const G = 2;            // Gap between slots

        // Total width: 2 * 3px margin + N * 32px + (N - 1) * 2px gap
        const W_capsule = 2 * M + N * W_pill + (N - 1) * G;

        const monitor = Main.layoutManager.currentMonitor || Main.layoutManager.primaryMonitor;
        let capsuleX = 0;
        let capsuleY = 0;

        if (this._caretInfo) {
            const caretCenterX = this._caretInfo.x + Math.round(this._caretInfo.w / 2);
            capsuleX = Math.round(caretCenterX - W_capsule / 2);
            capsuleX = Math.max(monitor.x + 10, Math.min(monitor.x + monitor.width - W_capsule - 10, capsuleX));

            const caretY = this._caretInfo.y;
            if (caretY - H_capsule - 8 >= monitor.y + 35) {
                capsuleY = caretY - H_capsule - 8;
            } else {
                capsuleY = caretY + this._caretInfo.h + 8;
            }
        } else {
            const [px, py] = global.get_pointer();
            capsuleX = Math.max(monitor.x + 10, Math.min(monitor.x + monitor.width - W_capsule - 10, Math.round(px - W_capsule / 2)));
            capsuleY = Math.max(monitor.y + 35, Math.min(monitor.y + monitor.height - H_capsule - 20, Math.round(py - H_capsule - 14)));
        }

        this._margin = M;
        this._pillW = W_pill;
        this._pillH = H_pill;
        this._capsuleW = W_capsule;
        this._capsuleH = H_capsule;
        this._gap = G;

        // 1. Single unified capsule widget with liquid glass blur, rounded 14px corners, and smooth shadow
        this._capsuleBox = new St.Widget({
            style: 'background-color: rgba(22, 26, 34, 0.38); ' +
                   'border-radius: 14px; ' +
                   'border: 1px solid rgba(255, 255, 255, 0.22); ' +
                   'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45); ' +
                   'padding: 0 !important; margin: 0 !important;',
            width: W_capsule,
            height: H_capsule,
            x: capsuleX,
            y: capsuleY,
            opacity: 0,
            scale_x: 0.94,
            scale_y: 0.94,
        });
        this._capsuleBox.set_pivot_point(0.5, 0.5);
        this._capsuleBox.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
        try {
            this._capsuleBlur = new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: 24 });
            this._capsuleCorner = new CornerEffect({ radius: 14 });
            this._capsuleBox.add_effect(this._capsuleBlur);
            this._capsuleBox.add_effect(this._capsuleCorner);
        } catch (_) {}
        this.add_child(this._capsuleBox);

        // 2. Inner orange pill (with exact 3px margin on top, bottom, and active side)
        const startX = M + this._currentIndex * (W_pill + G);
        const startY = M;

        const accent = getSystemAccentColor();
        this._orangePill = new St.Widget({
            style: `background-color: ${accent}; border-radius: 11px; padding: 0 !important; margin: 0 !important;`,
            width: W_pill,
            height: H_pill,
            x: startX,
            y: startY
        });
        this._capsuleBox.add_child(this._orangePill);

        // 3. Language labels centered inside each slot
        this._labels = [];
        this._items.forEach((item, i) => {
            const isSelected = (i === this._currentIndex);
            const lbl = new St.Label({
                text: getShortLabel(item),
                style: isSelected
                    ? 'color: #ffffff; font-weight: 700; font-size: 13px; text-shadow: 0 1px 2px rgba(0,0,0,0.35); text-align: center; padding: 0 !important; margin: 0 !important;'
                    : 'color: rgba(255, 255, 255, 0.55); font-weight: 600; font-size: 13px; text-align: center; padding: 0 !important; margin: 0 !important;',
                x: M + i * (W_pill + G),
                y: 0,
                width: W_pill,
                height: H_capsule
            });
            lbl.clutter_text.x_align = Clutter.ActorAlign.CENTER;
            lbl.clutter_text.y_align = Clutter.ActorAlign.CENTER;
            this._capsuleBox.add_child(lbl);
            this._labels.push(lbl);
        });
    }

    _setCaretPillPosition(index, animate = true) {
        if (!this._orangePill) return;

        const targetX = this._margin + index * (this._pillW + this._gap);

        if (animate) {
            this._orangePill.ease({
                x: targetX,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC
            });
        } else {
            this._orangePill.x = targetX;
        }

        this._labels.forEach((lbl, i) => {
            lbl.style = (i === index)
                ? 'color: #ffffff; font-weight: 700; font-size: 13px; text-shadow: 0 1px 2px rgba(0,0,0,0.35); text-align: center; padding: 0 !important; margin: 0 !important;'
                : 'color: rgba(255, 255, 255, 0.55); font-weight: 600; font-size: 13px; text-align: center; padding: 0 !important; margin: 0 !important;';
        });
    }

    _buildOsdUI() {
        this._osdW = 220;
        this._itemH = 40;
        this._padding = 8;
        const osdH = this._items.length * this._itemH + 2 * this._padding;

        const monitor = Main.layoutManager.primaryMonitor;
        this._osdX = monitor.x + Math.round((monitor.width - this._osdW) / 2);
        this._osdY = monitor.y + Math.round((monitor.height - osdH) / 2);

        // 1. Unified box with liquid glass blur, rounded 22px corners, and smooth shadow
        this._osdBox = new St.Widget({
            style: 'background-color: rgba(22, 26, 34, 0.38); ' +
                   'border-radius: 22px; ' +
                   'border: 1px solid rgba(255, 255, 255, 0.22); ' +
                   'box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); ' +
                   'padding: 0 !important; margin: 0 !important;',
            width: this._osdW,
            height: osdH,
            x: this._osdX,
            y: this._osdY,
            opacity: 0,
            scale_x: 0.94,
            scale_y: 0.94,
        });
        this._osdBox.set_pivot_point(0.5, 0.5);
        this._osdBox.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
        try {
            this._osdBlur = new Shell.BlurEffect({ mode: Shell.BlurMode.BACKGROUND, radius: 24 });
            this._osdCorner = new CornerEffect({ radius: 22 });
            this._osdBox.add_effect(this._osdBlur);
            this._osdBox.add_effect(this._osdCorner);
        } catch (_) {}
        this.add_child(this._osdBox);

        // 2. Selection pill
        const pillW = this._osdW - 2 * this._padding;
        const pillH = this._itemH - 2;
        this._selectionPill = new St.Widget({
            style: 'background-color: rgba(255, 255, 255, 0.20); ' +
                   'border-radius: 14px; ' +
                   'border: 1px solid rgba(255, 255, 255, 0.25); ' +
                   'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.20); ' +
                   'padding: 0 !important; margin: 0 !important;',
            width: pillW,
            height: pillH,
            x: this._padding,
            y: this._padding + this._currentIndex * this._itemH + 1
        });
        this._osdBox.add_child(this._selectionPill);

        // 3. Language labels
        this._labels = [];
        this._items.forEach((item, i) => {
            const isSelected = (i === this._currentIndex);
            const lbl = new St.Label({
                text: getOsdLabel(item),
                style: isSelected
                    ? 'color: #ffffff; font-weight: 600; font-size: 15px; text-align: center; padding: 0 !important; margin: 0 !important;'
                    : 'color: rgba(255, 255, 255, 0.65); font-weight: 500; font-size: 15px; text-align: center; padding: 0 !important; margin: 0 !important;',
                x: this._padding,
                y: this._padding + i * this._itemH,
                width: pillW,
                height: this._itemH
            });
            lbl.clutter_text.x_align = Clutter.ActorAlign.CENTER;
            lbl.clutter_text.y_align = Clutter.ActorAlign.CENTER;
            this._osdBox.add_child(lbl);
            this._labels.push(lbl);
        });
    }

    _setOsdPosition(index, animate = true) {
        if (!this._selectionPill) return;

        const targetY = this._padding + index * this._itemH + 1;
        if (animate) {
            this._selectionPill.ease({
                y: targetY,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC
            });
        } else {
            this._selectionPill.y = targetY;
        }

        this._labels.forEach((lbl, i) => {
            lbl.style = (i === index)
                ? 'color: #ffffff; font-weight: 600; font-size: 15px; text-align: center; padding: 0 !important; margin: 0 !important;'
                : 'color: rgba(255, 255, 255, 0.65); font-weight: 500; font-size: 15px; text-align: center; padding: 0 !important; margin: 0 !important;';
        });
    }

    show(backward, binding, mask) {
        if (this._items.length === 0)
            return false;

        const grab = Main.pushModal(this);
        this._grab = grab;
        this._haveModal = true;
        this._modifierMask = primaryModifier(mask);

        this.opacity = 255;
        this.visible = true;

        // Smooth appearance animation
        const target = this._capsuleBox || this._osdBox;
        if (target) {
            target.ease({
                opacity: 255,
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC
            });
        }

        // Slide into next index
        this._select(this._nextIndex, true);
        this._items[this._selectedIndex].activate(true);

        // If modifier was already released (quick tap)
        if (this._modifierMask) {
            const [x, y, mods] = global.get_pointer();
            if (!(mods & this._modifierMask)) {
                this._onQuickRelease();
                return true;
            }
        }

        return true;
    }

    _select(num, animate = true) {
        this._selectedIndex = num;
        if (this._capsuleBox) {
            this._setCaretPillPosition(num, animate);
        } else {
            this._setOsdPosition(num, animate);
        }
    }

    _next() {
        return (this._selectedIndex + 1) % this._items.length;
    }

    _previous() {
        return (this._selectedIndex - 1 + this._items.length) % this._items.length;
    }

    cycle(backward = false) {
        if (this._fadeTimeoutId) {
            GLib.source_remove(this._fadeTimeoutId);
            this._fadeTimeoutId = 0;
        }

        const newIndex = backward ? this._previous() : this._next();
        this._select(newIndex, true);
        this._items[this._selectedIndex].activate(true);

        // If modal was already popped, restart linger timer
        if (!this._haveModal) {
            this._scheduleFade(1200);
        }
    }

    _keyPressHandler(keysym, action) {
        if (action === this._action || keysym === Clutter.KEY_space) {
            this._select(this._next(), true);
            this._items[this._selectedIndex].activate(true);
            return Clutter.EVENT_STOP;
        }

        if (action === this._actionBackward || keysym === Clutter.KEY_Left) {
            this._select(this._previous(), true);
            this._items[this._selectedIndex].activate(true);
            return Clutter.EVENT_STOP;
        }

        if (keysym === Clutter.KEY_Right) {
            this._select(this._next(), true);
            this._items[this._selectedIndex].activate(true);
            return Clutter.EVENT_STOP;
        }

        if (keysym === Clutter.KEY_Escape) {
            this.fadeAndDestroy();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_press_event(event) {
        const keysym = event.get_key_symbol();
        const action = global.display.get_keybinding_action(
            event.get_key_code(), event.get_state());

        if (this._keyPressHandler(keysym, action) !== Clutter.EVENT_PROPAGATE) {
            return Clutter.EVENT_STOP;
        }

        // If any other key is pressed, dismiss
        this.fadeAndDestroy();
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_release_event(event) {
        const symbol = event.get_key_symbol();
        const isSuper = (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R);
        const isAlt = (symbol === Clutter.KEY_Alt_L || symbol === Clutter.KEY_Alt_R);
        const isControl = (symbol === Clutter.KEY_Control_L || symbol === Clutter.KEY_Control_R);
        const isShift = (symbol === Clutter.KEY_Shift_L || symbol === Clutter.KEY_Shift_R);

        let releasedModifier = false;
        if (this._modifierMask & (Clutter.ModifierType.SUPER_MASK | Clutter.ModifierType.MOD4_MASK)) {
            if (isSuper) releasedModifier = true;
        } else if (this._modifierMask & Clutter.ModifierType.MOD1_MASK) {
            if (isAlt) releasedModifier = true;
        } else if (this._modifierMask & Clutter.ModifierType.CONTROL_MASK) {
            if (isControl) releasedModifier = true;
        } else if (this._modifierMask & Clutter.ModifierType.SHIFT_MASK) {
            if (isShift) releasedModifier = true;
        }

        if (this._modifierMask) {
            const [x, y, mods] = global.get_pointer();
            if ((mods & this._modifierMask) === 0) {
                releasedModifier = true;
            }
        }

        if (releasedModifier) {
            this._finish();
        }
        return Clutter.EVENT_STOP;
    }

    _onQuickRelease() {
        this._popModal();
        const delay = this._capsuleBox ? 1200 : 700;
        this._scheduleFade(delay);
    }

    _finish() {
        this._popModal();
        const delay = this._capsuleBox ? 800 : 250;
        this._scheduleFade(delay);
    }

    _scheduleFade(delayMs) {
        if (this._fadeTimeoutId) {
            GLib.source_remove(this._fadeTimeoutId);
            this._fadeTimeoutId = 0;
        }

        this._fadeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._fadeTimeoutId = 0;
            this.fadeAndDestroy();
            return GLib.SOURCE_REMOVE;
        });
    }

    _popModal() {
        if (this._haveModal && this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
            this._haveModal = false;
        }
    }

    fadeAndDestroy() {
        if (this._isDestroying) return;
        this._isDestroying = true;

        if (this._fadeTimeoutId) {
            GLib.source_remove(this._fadeTimeoutId);
            this._fadeTimeoutId = 0;
        }

        this._popModal();

        const duration = 180;
        const mode = Clutter.AnimationMode.EASE_OUT_QUAD;

        // Synchronously animate the container and fade the entire composite offscreen together
        const target = this._capsuleBox || this._osdBox;
        if (target) {
            target.ease({
                scale_x: 0.94,
                scale_y: 0.94,
                opacity: 0,
                duration: duration,
                mode: mode,
            });
        }

        this.ease({
            opacity: 0,
            duration: duration,
            mode: mode,
            onComplete: () => {
                this.destroy();
            }
        });
    }

    _onDestroy() {
        if (this._fadeTimeoutId) {
            GLib.source_remove(this._fadeTimeoutId);
            this._fadeTimeoutId = 0;
        }
        this._popModal();
    }
});

export class MacInputSwitcher {
    constructor() {
        this._enabled = false;
        this._origSwitchInputSource = null;
        this._origProtoSwitchInputSource = null;
        this._actionForward = 0;
        this._actionBackward = 0;
        this._activePopup = null;
        this._cursorHooked = false;
    }

    async enable() {
        if (this._enabled) return;
        this._enabled = true;
        globalThis._macInputSwitcherInstance = this;

        try {
            const km = await import('resource:///org/gnome/shell/ui/status/keyboard.js');
            const ism = km.getInputSourceManager();

            this._ism = ism;
            this._origSwitchInputSource = ism._switchInputSource ? ism._switchInputSource.bind(ism) : null;

            ism._switchInputSource = (display, window, event, binding) => {
                this._handleSwitch(display, window, event, binding);
            };

            const ismProto = Object.getPrototypeOf(ism);
            if (ismProto && ismProto._switchInputSource && !ismProto._switchInputSourceOrig) {
                ismProto._switchInputSourceOrig = ismProto._switchInputSource;
                this._origProtoSwitchInputSource = ismProto._switchInputSourceOrig;
                const self = this;
                ismProto._switchInputSource = function(display, window, event, binding) {
                    self._handleSwitch(display, window, event, binding);
                };
            }

            // Re-bind switch-input-source and switch-input-source-backward directly on Main.wm
            // so Mutter routes Win+Space directly to our custom MacInputSwitcher
            const Gio = (await import('gi://Gio')).default || imports.gi.Gio;
            const Meta = (await import('gi://Meta')).default || imports.gi.Meta;
            const Shell = (await import('gi://Shell')).default || imports.gi.Shell;

            const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });

            try {
                Main.wm.removeKeybinding('switch-input-source');
                Main.wm.removeKeybinding('switch-input-source-backward');
            } catch (_) {}

            this._actionForward = Main.wm.addKeybinding(
                'switch-input-source',
                settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                (display, window, event, binding) => {
                    this._handleSwitch(display, window, event, binding);
                }
            );

            this._actionBackward = Main.wm.addKeybinding(
                'switch-input-source-backward',
                settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                (display, window, event, binding) => {
                    this._handleSwitch(display, window, event, binding);
                }
            );

            this._hookCaretDismiss();
        } catch (e) {
            console.error('[MacInputSwitcher] enable error:', e);
        }
    }

    _hookCaretDismiss() {
        const im = Main.inputMethod;
        if (!im || this._cursorHooked) return;
        this._cursorHooked = true;

        let currentRect = im._cursorRect;
        Object.defineProperty(im, '_cursorRect', {
            get: () => currentRect,
            set: (v) => {
                currentRect = v;
                if (this._activePopup && !this._activePopup._haveModal) {
                    this._activePopup.fadeAndDestroy();
                }
            },
            configurable: true
        });
    }

    _handleSwitch(display, window, event, binding) {
        if (!this._ism) return;
        if (this._ism._keyboardManager?.isLocked?.()) return;

        // Use configured sources sorted by index
        const sources = Object.values(this._ism.inputSources).sort((a, b) => a.index - b.index);
        if (sources.length < 2) return;

        // If a popup is already active and visible, simply cycle to the next language
        if (this._activePopup) {
            if (!this._activePopup._isDestroying && this._activePopup.visible) {
                this._activePopup.cycle(binding ? binding.is_reversed() : false);
                return;
            } else {
                try { this._activePopup.destroy(); } catch (_) {}
                this._activePopup = null;
            }
        }

        const currentSource = this._ism.currentSource;
        let currentIndex = sources.findIndex(s => s.id === currentSource?.id);
        if (currentIndex === -1) currentIndex = 0;

        const backward = binding ? binding.is_reversed() : false;
        const nextIndex = backward
            ? (currentIndex - 1 + sources.length) % sources.length
            : (currentIndex + 1) % sources.length;

        const caretInfo = getActiveCaret();

        this._activePopup = new MacInputSourcePopup(
            sources,
            this._actionForward || this._ism._keybindingAction,
            this._actionBackward || this._ism._keybindingActionBackward,
            caretInfo,
            currentIndex,
            nextIndex
        );

        this._activePopup.connect('destroy', () => {
            this._activePopup = null;
        });

        const bName = binding ? binding.get_name() : 'switch-input-source';
        const bMask = binding ? binding.get_mask() : Clutter.ModifierType.SUPER_MASK;

        if (!this._activePopup.show(backward, bName, bMask)) {
            this._activePopup.fadeAndDestroy();
            this._activePopup = null;
        }
    }

    disable() {
        if (!this._enabled) return;
        this._enabled = false;
        globalThis._macInputSwitcherInstance = null;

        if (this._activePopup) {
            try { this._activePopup.fadeAndDestroy(); } catch (_) {}
            this._activePopup = null;
        }

        try {
            Main.wm.removeKeybinding('switch-input-source');
            Main.wm.removeKeybinding('switch-input-source-backward');
            if (this._ism && this._origSwitchInputSource) {
                const Gio = imports.gi.Gio;
                const Meta = imports.gi.Meta;
                const Shell = imports.gi.Shell;
                const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.keybindings' });
                Main.wm.addKeybinding(
                    'switch-input-source',
                    settings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.ALL,
                    this._origSwitchInputSource
                );
                Main.wm.addKeybinding(
                    'switch-input-source-backward',
                    settings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.ALL,
                    this._origSwitchInputSource
                );
            }
        } catch (_) {}

        if (this._ism && this._origSwitchInputSource) {
            this._ism._switchInputSource = this._origSwitchInputSource;
            this._origSwitchInputSource = null;
        }

        if (this._ism) {
            const ismProto = Object.getPrototypeOf(this._ism);
            if (ismProto && ismProto._switchInputSourceOrig) {
                ismProto._switchInputSource = ismProto._switchInputSourceOrig;
                delete ismProto._switchInputSourceOrig;
            }
            this._ism = null;
        }
    }
}
