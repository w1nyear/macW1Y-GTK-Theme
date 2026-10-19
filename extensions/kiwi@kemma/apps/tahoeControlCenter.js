// SPDX-License-Identifier: GPL-3.0-or-later
// Tahoe Quick Settings v5: 1:1 macOS Tahoe Control Center.
//   panel 320, padding 14, col gap 18, column 137
//   St adds CSS padding ON TOP of forced sizes (content-box), so the grid
//   below targets RENDERED sizes, not forced ones:
//   pills: forced 60 + pad 20 = 80 tall; music 152; circles 62;
//   cards: forced 72 + pad 20 = 96; Focus 137x62 (forced 127x50);
//   bottom Settings pill 36.
// Panel bg = its own actor BELOW the glass stacks:
//   'pill' (r40), 'disc' (r31), 'card' (r26), 'music' (r26), 'edit' (r18).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeBluetooth from 'gi://GnomeBluetooth';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import Meta from 'gi://Meta';
import NM from 'gi://NM';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import {getPanelInk, watchInk, notePanelRect} from './tahoeInk.js';

// Liquid-glass helpers live in another extension. Static
// `import ... from 'file://' + ...` is a SyntaxError (module specifiers must
// be string literals), so load them dynamically at runtime. Until loaded,
// glass stacks are skipped and the panel works without blur.
let LiquidEffect = null;
let UnpickableActor = null;
let UILayerSampler = null;
let WindowCloneManager = null;
let setClipIfChanged = () => {};
let getTransformedRect = a => {
    const [x, y] = a.get_transformed_position();
    return [x, y, a.width, a.height];
};
let ensureGlassAllocated = () => {};
let syncGlassCaptureClip = () => {};
let reportFrameLoopError = (ctx, e) => console.error(`[${ctx}] ${e}`);
const _LG_BASE = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com/dist';
import(_LG_BASE + '/liquidEffect.js').then(m => {
    if (m.LiquidEffect)
        LiquidEffect = m.LiquidEffect;
}).catch(e => console.warn(`[tahoe-qs] liquidEffect unavailable: ${e}`));
import(_LG_BASE + '/utils.js').then(m => {
    if (m.UnpickableActor)
        UnpickableActor = m.UnpickableActor;
    if (m.UILayerSampler)
        UILayerSampler = m.UILayerSampler;
    if (m.WindowCloneManager)
        WindowCloneManager = m.WindowCloneManager;
    if (m.setClipIfChanged)
        setClipIfChanged = m.setClipIfChanged;
    if (m.getTransformedRect)
        getTransformedRect = m.getTransformedRect;
    if (m.ensureGlassAllocated)
        ensureGlassAllocated = m.ensureGlassAllocated;
    if (m.syncGlassCaptureClip)
        syncGlassCaptureClip = m.syncGlassCaptureClip;
    if (m.reportFrameLoopError)
        reportFrameLoopError = m.reportFrameLoopError;
}).catch(e => console.warn(`[tahoe-qs] liquid-glass utils unavailable: ${e}`));
function _lgReady() {
    return false;
}

const PANEL_W = 320;
const PAD = 14;
const COLGAP = 18;
const COL_W = (PANEL_W - PAD * 2 - COLGAP) / 2;   // 137
const GAP = 12;
const PILL_H = 60;                                // renders 80 with padding
const CIRCLE = 62;
const MUSIC_H = PILL_H * 2 + GAP;                 // 132 forced, 152 rendered
const CARD_H = 72;                                // forced (96 rendered)
const EDIT_H = 28;                                // same as privacy pill

const LG_SCHEMA = 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com';
const SHADER_PADDING = 20;
const GLASS_EXPAND = 2;
const CLIP_PADDING = 200;

// per-region fill colors (painted by the shader under each element):
// light tint in the light theme, dark tint in the dark one. Subtle.
const SURF_LIGHT = {c: [0.78, 0.78, 0.80], a: 0.10};
const SURF_DARK = {c: [0.05, 0.05, 0.07], a: 0.10};
const CIRCLE_ON = {c: [1, 1, 1], a: 0.45};

// glass stacks (radius must match the RENDERED element shape):
// pills 137x80 (r40), discs 62 / Focus 137x62 (r31), cards (r26),
// music (r26), privacy + Edit Controls pills (r16).
const GLASS_GROUPS = [
    {name: 'pill', radius: 40},
    {name: 'disc', radius: 31},
    {name: 'card', radius: 28},
    {name: 'music', radius: 28},
    {name: 'priv', radius: 18},
    // edit button has its own stack: shallower corners than the pill
    {name: 'edit', radius: 15},
    // backdrop LAST: index-1 inserts paint it deepest, right above panelBg.
    // Pure backdrop blur under the whole panel + shadow, fading out at the
    // edges (edge_smoothing gradient, no tint/refraction/rim at all).
    {name: 'backdrop', radius: 82},
];
export const BACKDROP_PAD = 60;
// backdrop region margin: covers the whole panel shadow (blur 22 + glow 70),
// while the fade gradient stays BACKDROP_PAD - full blur under panel+shadow,
// dissipation beyond.
export const BACKDROP_REGION = 80;
// vertical margin is tighter: height shrinks, width untouched.
// (must stay >= BACKDROP_PAD, else the fade eats into the panel itself)
export const BACKDROP_REGION_Y = 60;

// custom Tahoe artwork (icons/): moon, mute rings, transport glyphs
const ICON_DIR = GLib.get_home_dir() +
    '/.local/share/gnome-shell/extensions/kiwi@kemma/icons';
function _fileGicon(name) {
    try {
        return new Gio.FileIcon({
            file: Gio.File.new_for_path(`${ICON_DIR}/${name}`),
        });
    } catch (_) {
        return null;
    }
}
let _G = null;
function _gicons() {
    // adaptive ink: dark glyphs (-light variants) on light backgrounds,
    // white glyphs on dark ones. Hardcoded SVG fills can't follow CSS color,
    // so the cache is keyed on ink (luminance), not on theme.
    const light = getPanelInk() !== 'light';
    if (!_G || _G._light !== light) {
        const suf = light ? '-light' : '';
        _G = {
            _light: light,
            focus: _fileGicon(`tahoe-focus${suf}.svg`),
            focusOn: _fileGicon('tahoe-focus-active.svg'),
            mute: _fileGicon(`tahoe-mute${suf}.svg`),
            play: _fileGicon(`tahoe-play${suf}.svg`),
            pause: _fileGicon(`tahoe-pause${suf}.svg`),
            prev: _fileGicon(`tahoe-prev${suf}.svg`),
            next: _fileGicon(`tahoe-next${suf}.svg`),
            // user glyphs (raster, not SVG): screenshot button, monochrome pair
            shot: _fileGicon(`tahoe-shot4${suf}.png`),
            // user logout glyph, monochrome pair
            logout: _fileGicon(`tahoe-logout${suf}.png`),
            // user glyphs (raster, not SVG): theme toggle + lock,
            // monochrome ink-following pair each
            theme: _fileGicon(`tahoe-theme${suf}.png`),
            themeDark: _fileGicon('tahoe-theme-light.png'),
            lock: _fileGicon(`tahoe-lock2${suf}.png`),
            // AirDrop: user's own glyph (AirDrop_2019) - monochrome
            // ink-following when OFF, original blue when ON.
            airdrop: _fileGicon(`tahoe-airdrop${suf}.png`),
            airdropBlue: _fileGicon('tahoe-airdrop-blue.png'),
        };
    }
    return _G;
}

// QS glass tuning (Kiwi prefs -> Control Center Glass)
function _qsGlassBlur() {
    try {
        return _settings?.get_int?.('tahoe-qs-glass-blur') ?? 8;
    } catch (_) {
        return 8;
    }
}
function _qsGlassBrightness() {
    try {
        return (_settings?.get_int?.('tahoe-qs-glass-brightness') ?? 130) / 100;
    } catch (_) {
        return _isDark() ? 1.0 : 1.3;
    }
}
// int setting with fallback (glass tuning sliders)
function _qsInt(key, dflt) {
    try {
        return _settings?.get_int?.(key) ?? dflt;
    } catch (_) {
        return dflt;
    }
}
function _qsGlassSaturation() {
    try {
        return (_settings?.get_int?.('tahoe-qs-glass-saturation') ?? 85) / 100;
    } catch (_) {
        return 0.85;
    }
}
function _qsGlassTint() {
    try {
        return (_settings?.get_int?.('tahoe-qs-glass-tint') ?? 12) / 100;
    } catch (_) {
        return 0.12;
    }
}
function _qsGlassRefraction() {
    try {
        return ((_settings?.get_int?.('tahoe-qs-glass-refraction') ?? 117) / 100) * 78.5;
    } catch (_) {
        return 92;
    }
}
function _qsGlassGlare() {
    try {
        return (_settings?.get_int?.('tahoe-qs-glass-glare') ?? 0) / 100;
    } catch (_) {
        return 0;
    }
}
// panel shadow from settings (reproduces the CSS default at stock values)
function _qsPanelShadow() {
    let blur = 22, op = 15, glow = 70;
    try {
        blur = _settings?.get_int?.('tahoe-qs-shadow-blur') ?? 22;
        op = _settings?.get_int?.('tahoe-qs-shadow-opacity') ?? 15;
        glow = _settings?.get_int?.('tahoe-qs-shadow-glow') ?? 70;
    } catch (_) {
        // defaults above
    }
    const a1 = (op / 100).toFixed(2);
    let shadow = `box-shadow: 0 4px ${blur}px rgba(0, 0, 0, ${a1})`;
    if (glow > 0) {
        const a2 = (op * 0.67 / 100).toFixed(2);
        shadow += `, 0 ${Math.round(glow / 6)}px ${glow}px rgba(0, 0, 0, ${a2})`;
    }
    return shadow + ';';
}

let _enabled = false;
let _settings = null;
// gettext hook (wired in enable()): English msgids, ru .mo ships translations
let _ = (m) => m;
let _origOpen = null;
let _origClose = null;
let _origToggle = null;
let _panel = null;
let _editMode = false;
let _editMod = null;
let _activeSubmenu = null;

function _closeActiveSubmenu() {
    if (_activeSubmenu) {
        try { _activeSubmenu.close(); _activeSubmenu.destroy(); } catch (_) {}
        _activeSubmenu = null;
    }
}

async function _openWifiSubmenu(sourceActor, state) {
    if (_activeSubmenu) {
        const wasOpen = _activeSubmenu._sourceActor === sourceActor;
        _closeActiveSubmenu();
        if (wasOpen) return;
    }

    try {
        const PopupMenu = await import('resource:///org/gnome/shell/ui/popupMenu.js');
        const BoxPointer = await import('resource:///org/gnome/shell/ui/boxpointer.js');
        const sharedMod = await import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/mac_menus_shared_v5.js');

        const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.RIGHT);
        menu._sourceActor = sourceActor;
        Main.uiGroup.add_child(menu.actor);
        menu.box.style = 'width: 296px !important; min-width: 296px !important; max-width: 296px !important; border-radius: 14px !important; background-color: rgba(26, 26, 28, 0.88) !important; color: #ffffff !important; box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; padding: 6px !important;';

        let nmClient = state.nm;
        if (!nmClient) {
            nmClient = NM.Client.new(null);
            state.nm = nmClient;
        }
        const devices = nmClient.get_devices() || [];
        const wifiDevice = devices.find(d => d.get_device_type() === NM.DeviceType.WIFI) || null;

        sharedMod.populateUniversalWifiContent(menu, {
            nmClient,
            wifiDevice,
            isEnabled: Boolean(nmClient?.wireless_enabled),
            onToggle: (newState) => {
                if (nmClient) nmClient.wireless_enabled = newState;
            },
            isControlCenter: false,
            onClose: () => _closeActiveSubmenu(),
            onOpenSettings: (p) => {
                try { GLib.spawn_command_line_async('gnome-control-center ' + p); } catch (_) {}
                _closeActiveSubmenu();
                _closePanel();
            },
        });

        _activeSubmenu = menu;
        menu.actor.opacity = 0;
        menu.actor.scale_x = 0.94;
        menu.actor.scale_y = 0.94;
        menu.actor.set_pivot_point(1.0, 0.2);
        menu.open(BoxPointer.PopupAnimation.FULL);
        menu.actor.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    } catch (e) {
        console.error(`[tahoe-cc] _openWifiSubmenu error: ${e}`);
    }
}

async function _openBluetoothSubmenu(sourceActor, state) {
    if (_activeSubmenu) {
        const wasOpen = _activeSubmenu._sourceActor === sourceActor;
        _closeActiveSubmenu();
        if (wasOpen) return;
    }

    try {
        const PopupMenu = await import('resource:///org/gnome/shell/ui/popupMenu.js');
        const BoxPointer = await import('resource:///org/gnome/shell/ui/boxpointer.js');
        const sharedMod = await import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/mac_menus_shared_v5.js');

        const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.RIGHT);
        menu._sourceActor = sourceActor;
        Main.uiGroup.add_child(menu.actor);
        menu.box.style = 'width: 296px !important; min-width: 296px !important; max-width: 296px !important; border-radius: 14px !important; background-color: rgba(26, 26, 28, 0.88) !important; color: #ffffff !important; box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; padding: 6px !important;';

        let btClient = state.bt;
        if (!btClient) {
            btClient = new GnomeBluetooth.Client();
            state.bt = btClient;
        }

        sharedMod.populateUniversalBluetoothContent(menu, {
            btClient,
            isPowered: Boolean(btClient?.default_adapter_powered),
            onToggle: (newState) => {
                if (btClient) btClient.default_adapter_powered = newState;
            },
            isControlCenter: false,
            onClose: () => _closeActiveSubmenu(),
            onOpenSettings: (p) => {
                try { GLib.spawn_command_line_async('gnome-control-center ' + p); } catch (_) {}
                _closeActiveSubmenu();
                _closePanel();
            },
        });

        _activeSubmenu = menu;
        menu.actor.opacity = 0;
        menu.actor.scale_x = 0.94;
        menu.actor.scale_y = 0.94;
        menu.actor.set_pivot_point(1.0, 0.2);
        menu.open(BoxPointer.PopupAnimation.FULL);
        menu.actor.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    } catch (e) {
        console.error(`[tahoe-cc] _openBluetoothSubmenu error: ${e}`);
    }
}

async function _openSoundSubmenu(sourceActor, state) {
    if (_activeSubmenu) {
        const wasOpen = _activeSubmenu._sourceActor === sourceActor;
        _closeActiveSubmenu();
        if (wasOpen) return;
    }

    try {
        const PopupMenu = await import('resource:///org/gnome/shell/ui/popupMenu.js');
        const BoxPointer = await import('resource:///org/gnome/shell/ui/boxpointer.js');
        const sharedMod = await import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/mac_menus_shared_v5.js');

        const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.RIGHT);
        menu._sourceActor = sourceActor;
        Main.uiGroup.add_child(menu.actor);
        menu.box.style = 'width: 296px !important; min-width: 296px !important; max-width: 296px !important; border-radius: 14px !important; background-color: rgba(26, 26, 28, 0.88) !important; color: #ffffff !important; box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; padding: 6px !important;';

        let control = state.control;
        if (!control) {
            try {
                control = new Gvc.MixerControl({name: 'Tahoe Quick Settings Audio Submenu'});
                control.open();
                state.control = control;
            } catch (_) {}
        }
        const currentSink = control?.get_default_sink();

        // 1. Output Device Section Header
        const secHeader = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const headerLbl = new St.Label({
            text: _('Output Device') || 'Вихідний пристрій',
            style: 'font-size: 11px !important; font-weight: 700 !important; color: rgba(255, 255, 255, 0.6) !important; letter-spacing: 0.5px !important; margin: 4px 8px !important;',
        });
        secHeader.add_child(headerLbl);
        menu.addMenuItem(secHeader);

        const sinks = control?.get_sinks() || [];
        for (const s of sinks) {
            const isDefault = currentSink && s.get_id() === currentSink.get_id();
            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: true,
                can_focus: false,
                style_class: isDefault ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
            });
            sharedMod.setupMacMenuItem(item);

            const sName = (s.get_name() || '').toLowerCase();
            const iconName = (sName.includes('headphone') || sName.includes('headset') || sName.includes('buds') || sName.includes('airpods'))
                ? 'audio-headphones-symbolic'
                : 'audio-speakers-symbolic';
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: 15,
                style: 'margin-right: 8px; color: #ffffff !important;',
            });
            item.add_child(icon);

            const desc = new St.Label({
                text: s.get_description() || 'Аудіовихід',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'color: #ffffff !important;',
            });
            desc.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            item.add_child(desc);

            if (isDefault) {
                const check = new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: 14,
                    style: 'color: #ffffff !important;',
                });
                item.add_child(check);
            }

            item.connect('activate', () => {
                try {
                    control.set_default_sink(s);
                } catch (_) {}
                _closeActiveSubmenu();
            });

            menu.addMenuItem(item);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings item
        const settItem = new PopupMenu.PopupBaseMenuItem({reactive: true, can_focus: false, style_class: 'mac-menu-item-row'});
        sharedMod.setupMacMenuItem(settItem);
        const settLbl = new St.Label({
            text: _('Sound Settings…') || 'Параметри звуку…',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'color: #ffffff !important;',
        });
        settItem.add_child(settLbl);
        settItem.connect('activate', () => {
            try { GLib.spawn_command_line_async('gnome-control-center sound'); } catch (_) {}
            _closeActiveSubmenu();
            _closePanel();
        });
        menu.addMenuItem(settItem);

        _activeSubmenu = menu;
        menu.actor.opacity = 0;
        menu.actor.scale_x = 0.94;
        menu.actor.scale_y = 0.94;
        menu.actor.set_pivot_point(1.0, 0.2);
        menu.open(BoxPointer.PopupAnimation.FULL);
        menu.actor.ease({
            opacity: 255,
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    } catch (e) {
        console.error(`[tahoe-cc] _openSoundSubmenu error: ${e}`);
    }
}

function _ifaceSettings() {
    try {
        return new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    } catch (_) {
        return null;
    }
}

function _lgSettings() {
    try {
        return new Gio.Settings({schema_id: LG_SCHEMA});
    } catch (_) {
        // Schema not in the default source — load it from the
        // liquid-glass extension's own schemas/ dir.
    }
    try {
        const dir = GLib.build_filenamev([GLib.get_home_dir(),
            '.local', 'share', 'gnome-shell', 'extensions',
            'liquid-glass@thinkingcoding1231.gmail.com', 'schemas']);
        const source = Gio.SettingsSchemaSource.new_from_directory(
            dir, Gio.SettingsSchemaSource.get_default(), false);
        const schema = source?.lookup(LG_SCHEMA, false);
        if (schema)
            return new Gio.Settings({settings_schema: schema});
    } catch (_) {
        // liquid-glass not installed
    }
    return null;
}

function _isDark() {
    // same theme resolution as the Tahoe Launchpad: explicit override,
    // else system scheme + GTK theme name.
    try {
        const mode = _settings?.get_string('tahoe-theme') ?? 'auto';
        if (mode === 'dark')
            return true;
        if (mode !== 'light') {
            const iface = _ifaceSettings();
            const scheme = iface?.get_string('color-scheme') ?? 'default';
            const gtkTheme = iface?.get_string('gtk-theme') ?? '';
            const themeIsLight = (/light/i.test(gtkTheme) && !/dark/i.test(gtkTheme)) ||
                gtkTheme === 'Adwaita' || gtkTheme === 'Default';
            if (scheme === 'prefer-light')
                return false;
            if (scheme === 'prefer-dark')
                return !themeIsLight;
        }
        return false;
    } catch (_) {
        return false;
    }
}

const _surf = () => (_isDark() ? SURF_DARK : SURF_LIGHT);

// ------------------------------------------------------------- UI atoms
function _setActive(widget, on) {
    try {
        if (on)
            widget.add_style_class_name('tahoe-qs-on');
        else
            widget.remove_style_class_name('tahoe-qs-on');
    } catch (_) {
        // gone
    }
}

// capsule pill: [circle glyph] Title / subtitle   (Wi-Fi, Bluetooth, AirDrop, Focus)
// expandTexts=false packs the content strictly left (unused by Focus now:
// it shares the exact Wi-Fi geometry, single title line, no subtitle).
function _makePill(iconName, title, subtitle, expandTexts = true) {
    const btn = new St.Button({
        style_class: 'tahoe-qs-pill',
        reactive: true,
        can_focus: true,
        x_expand: true,
        height: PILL_H,
    });
    const box = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
        // BinLayout centers an undersized child: pin the box left so the
        // circle+text can never drift right (measured 20px drift otherwise).
        // x_expand requests full button width; Focus additionally gets an
        // explicit width below, so centering becomes a no-op either way.
        x_align: Clutter.ActorAlign.START,
        x_expand: true,
    });
    // StBin = ClutterBinLayout: the ONLY container that honours the child's
    // x_align/y_align (ClutterBoxLayout ignores them -> icons slid left).
    const icon = new St.Icon({
        style_class: 'tahoe-qs-pill-glyph',
        icon_name: iconName,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const circle = new St.Bin({
        style_class: 'tahoe-qs-pill-circle',
        child: icon,
    });
    box.add_child(circle);
    const texts = new St.BoxLayout({vertical: true, x_expand: expandTexts});
    // BoxLayout packs from the top: expandable spacers center the stack
    const spTop = new St.BoxLayout({y_expand: true});
    texts.add_child(spTop);
    const t = new St.Label({
        style_class: 'tahoe-qs-title',
        text: title,
        x_align: Clutter.ActorAlign.START,
    });
    try {
        t.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    } catch (_) {
        // no clutter text
    }
    texts.add_child(t);
    let s = null;
    if (subtitle !== null) {
        s = new St.Label({
            style_class: 'tahoe-qs-subtitle',
            text: subtitle ?? '',
            x_align: Clutter.ActorAlign.START,
        });
        try {
            s.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        } catch (_) {
            // no clutter text
        }
        texts.add_child(s);
    }
    const spBot = new St.BoxLayout({y_expand: true});
    texts.add_child(spBot);
    box.add_child(texts);
    btn.set_child(box);
    return {btn, icon, circle, title: t, subtitle: s, box, texts};
}

// slim centered privacy pill with a fixed colored dot (one per source)
function _makePrivPill(iconName, dotClass) {
    const pill = _makePill(iconName, '', null);
    pill.btn.visible = false;
    pill.btn.x_expand = false;
    pill.btn.set_height(28);
    pill.btn.add_style_class_name('tahoe-qs-pill-priv');
    pill.circle.add_style_class_name(dotClass);
    return pill;
}

// single pill for every active source at once (macOS Tahoe): extra dots
// are appended after the main circle, names are joined with commas.
function _makeComboPrivPill() {
    const pill = _makePrivPill('camera-web-symbolic', 'tahoe-qs-priv-green');
    const extras = [];
    for (let i = 0; i < 2; i++) {
        const icon = new St.Icon({
            style_class: 'tahoe-qs-pill-glyph tahoe-qs-priv-glyph',
            icon_name: 'audio-input-microphone-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const dot = new St.Bin({
            style_class: 'tahoe-qs-pill-circle tahoe-qs-privdot',
            child: icon,
            visible: false,
        });
        pill.box.insert_child_at_index(dot, 1 + i);
        extras.push({dot, icon});
    }
    pill.dots = extras;
    return pill;
}

function _setPrivDot(ref, cls, iconName) {
    const COLORS = ['tahoe-qs-priv-green', 'tahoe-qs-priv-orange', 'tahoe-qs-priv-blue'];
    try {
        for (const c of COLORS) {
            try {
                (ref.dot ?? ref.circle).remove_style_class_name(c);
            } catch (_) {
                // gone
            }
        }
        (ref.dot ?? ref.circle).add_style_class_name(cls);
    } catch (_) {
        // gone
    }
    try {
        ref.icon.icon_name = iconName;
    } catch (_) {
        // gone
    }
}

// round button, always fixed 60x60
function _makeCircle(iconName) {
    const btn = new St.Button({
        style_class: 'tahoe-qs-circle',
        reactive: true,
        can_focus: true,
        height: CIRCLE,
        width: CIRCLE,
    });
    const icon = new St.Icon({
        style_class: 'tahoe-qs-circle-icon',
        icon_name: iconName,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    btn.set_child(icon);
    return {btn, icon};
}

// small icon button (music transport)
function _makeGlyph(iconName) {
    const btn = new St.Button({
        style_class: 'tahoe-qs-glyphbtn',
        reactive: true,
        can_focus: true,
        x_expand: true,   // even thirds = Tahoe control row
    });
    const icon = new St.Icon({
        style_class: 'tahoe-qs-glyphicon',
        icon_name: iconName,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    btn.set_child(icon);
    return {btn, icon};
}

// Tahoe slider: the stock round dot is replaced by an elongated pill
// handle (~27x16, like macOS Tahoe). Only the handle paint is overridden;
// the bar, gestures and value mapping stay stock.
const TahoeSlider = GObject.registerClass({
    GTypeName: `TahoeSlider_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
}, class TahoeSlider extends Slider {

    vfunc_repaint() {
        // bar via the grandparent (skip Slider's own dot)
        Object.getPrototypeOf(Slider.prototype).vfunc_repaint.call(this);

        const cr = this.get_context();
        const themeNode = this.get_theme_node();
        const [width, height] = this.get_surface_size();
        const rtl = this.get_text_direction() === Clutter.TextDirection.RTL;

        const h = 2 * this._handleRadius;   // pill height (from css)
        const w = Math.round(h * 1.7);      // pill width ~24
        const hw = w / 2;
        const handleY = height / 2;
        // position by the pill half-width so the ends never clip
        let handleX = hw + (width - 2 * hw) * this._value / this._maxValue;
        if (rtl)
            handleX = width - handleX;

        const r = h / 2;
        cr.setSourceColor(themeNode.get_foreground_color());
        cr.arc(handleX - hw + r, handleY, r, Math.PI / 2, Math.PI * 1.5);
        cr.arc(handleX + hw - r, handleY, r, -Math.PI / 2, Math.PI / 2);
        cr.fill();   // fill() closes the capsule path
        cr.$dispose();
    }
});

// full-width card: label + horizontal slider between two end icons
function _makeSliderCard(title, leftIcon, rightIcon, withEndBtn) {
    const outer = new St.BoxLayout({style_class: 'tahoe-qs-card', vertical: true});
    outer.set_height(CARD_H);
    const label = new St.Label({
        style_class: 'tahoe-qs-card-label',
        text: title,
        x_align: Clutter.ActorAlign.START,
    });
    outer.add_child(label);
    const row = new St.BoxLayout({style_class: 'tahoe-qs-card-row'});
    const li = new St.Icon({
        style_class: 'tahoe-qs-endicon-small',
        icon_name: leftIcon,
        y_align: Clutter.ActorAlign.CENTER,
    });
    row.add_child(li);
    const slider = new TahoeSlider(0);
    slider.add_style_class_name('tahoe-qs-slider');
    row.add_child(slider);
    const ri = new St.Icon({
        style_class: 'tahoe-qs-endicon',
        icon_name: rightIcon,
        y_align: Clutter.ActorAlign.CENTER,
    });
    row.add_child(ri);
    let endBtn = null;
    let endIcon = null;
    if (withEndBtn) {
        endBtn = new St.Button({
            style_class: 'tahoe-qs-endbtn',
            reactive: true,
            can_focus: true,
        });
        endIcon = new St.Icon({
            style_class: 'tahoe-qs-endbtn-icon',
            icon_name: 'audio-volume-muted-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        endBtn.set_child(endIcon);
        if (_gicons().mute)
            endIcon.gicon = _gicons().mute;
        row.add_child(endBtn);
    }
    outer.add_child(row);
    return {box: outer, slider, icon: ri, label, endBtn, endIcon};
}

// row: [left][expanding spacer][right]
function _makeSpacerRow(left, right) {
    const row = new St.BoxLayout({style_class: 'tahoe-qs-row', x_expand: true});
    const spacer = new St.BoxLayout({x_expand: true});
    row.add_child(left);
    row.add_child(spacer);
    row.add_child(right);
    return row;
}

// ------------------------------------------------------------- panel
function _buildPanel() {
    const monitor = Main.layoutManager.primaryMonitor;
    const panelH = Main.layoutManager.panelBox?.height ?? 32;
    const W = PANEL_W;
    const X = monitor.x + monitor.width - W - 12;
    const Y = monitor.y + panelH + 10;

    const overlay = new Clutter.Actor({
        reactive: true,
        x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height,
    });
    overlay.connect('button-press-event', (actor, event) => {
        if (_activeSubmenu) {
            _closeActiveSubmenu();
        }
        try {
            if (global.stage.get_event_actor(event) !== actor)
                return Clutter.EVENT_PROPAGATE;
        } catch (_) {
            return Clutter.EVENT_PROPAGATE;
        }
        // non-modal click-through dismissal: close, then let the same click
        // reach the window below (system stays usable while open)
        _closePanel();
        return Clutter.EVENT_PROPAGATE;
    });

    const isDark = _isDark();
    const darkCls = isDark ? ' tahoe-qs-dark' : '';

    // panel background actor (BELOW the glass stacks, like the Tahoe window)
    const panelBg = new St.Widget({style_class: `tahoe-qs-panelbg${darkCls}`});
    try {
        panelBg.set_style(_qsPanelShadow());
    } catch (_) {
        // stylesheet default shadow stays
    }
    panelBg.set_position(X, Y);
    panelBg.set_size(W, -1);
    overlay.add_child(panelBg);

    const box = new St.BoxLayout({style_class: `tahoe-qs-panel${darkCls}`, vertical: true});
    // adaptive ink class (luminance, not theme); refined after allocation
    try {
        if (getPanelInk() === 'light')
            box.add_style_class_name('tahoe-qs-inklight');
    } catch (_) {
        // base (dark) ink stays
    }
    box.set_position(X, Y);
    box.set_size(W, -1);
    overlay.add_child(box);

    const state = {control: null, nm: null, bt: null,
        mpris: null, mprisTimer: 0, regions: [], brightScale: null,
        sink: null, sinkGuard: false, dispGuard: false, sndGuard: false,
        micApp: '', camApp: '', privTimer: 0, camMon: null, camId: 0,
        shareInd: null, shareId: 0, racHandles: null, micViaPW: false, micLogged: false};

    // No modal grab: the panel floats while the session stays fully usable
    // (pointer + keyboard go to apps; toggle via button/shortcut anytime).
    // Dismissal is click-through (see button-press above).
    overlay.connect('key-press-event', (_a, event) => {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
            _closePanel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    // ======================= privacy pill (top, hidden when idle) =======================
    // ONE compact centered pill for every active source at once (macOS Tahoe)
    const privPill = _makeComboPrivPill();
    const privRow = new St.BoxLayout({x_expand: true});
    privRow.add_child(new St.BoxLayout({x_expand: true}));
    privRow.add_child(privPill.btn);
    privRow.add_child(new St.BoxLayout({x_expand: true}));
    box.add_child(privRow);

    // ======================= row A-C: two columns =======================
    const cols = new St.BoxLayout({style_class: 'tahoe-qs-cols'});
    box.add_child(cols);
    const leftCol = new St.BoxLayout({vertical: true, style_class: 'tahoe-qs-col', x_expand: true});
    const rightCol = new St.BoxLayout({vertical: true, style_class: 'tahoe-qs-col', x_expand: true});
    leftCol.set_width(COL_W);
    rightCol.set_width(COL_W);
    cols.add_child(leftCol);
    cols.add_child(rightCol);

    // -- left: Wi-Fi, Bluetooth, AirDrop pills (60 each)
    const wifi = _makePill('network-wireless-symbolic', _('Wi-Fi'), '…');
    wifi.btn.connect('clicked', () => {
        try {
            if (state.nm)
                state.nm.wireless_enabled = !state.nm.wireless_enabled;
        } catch (_) {
            // no permission
        }
    });
    wifi.btn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === 3) {
            _openWifiSubmenu(wifi.btn, state);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    leftCol.add_child(wifi.btn);

    const btPill = _makePill('bluetooth-active-symbolic', _('Bluetooth'), '…');
    btPill.btn.add_style_class_name('tahoe-qs-pill-bt');
    btPill.btn.connect('clicked', () => {
        try {
            if (state.bt)
                state.bt.default_adapter_powered = !state.bt.default_adapter_powered;
        } catch (_) {
            // unsupported
        }
    });
    btPill.btn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === 3) {
            _openBluetoothSubmenu(btPill.btn, state);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    leftCol.add_child(btPill.btn);

    const air = _makePill('tahoe-airdrop', _('AirDrop'), _('Off'));
    try {
        if (_gicons().airdrop)
            air.icon.gicon = _gicons().airdrop;
    } catch (_) {
        // stock glyph stays
    }
    air.btn.connect('clicked', () => _toggleAirdrop(state));
    leftCol.add_child(air.btn);
    _refreshAirdrop(air);

    // -- right: music card (132) + [Dark][Lock] circles row (60)
    const music = new St.Button({style_class: 'tahoe-qs-music', reactive: true, x_expand: true});
    music.set_height(MUSIC_H);
    const mbox = new St.BoxLayout({vertical: true, style_class: 'tahoe-qs-music-box'});
    music.set_child(mbox);
    // vertical BoxLayout stretches children full width -> wrap the square art
    const artWrap = new St.BoxLayout({x_expand: true});
    const artIcon = new St.Icon({
        style_class: 'tahoe-qs-music-articon',
        icon_name: 'audio-x-generic-symbolic',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const art = new St.Bin({
        style_class: 'tahoe-qs-music-art',
        child: artIcon,
    });
    artWrap.add_child(art);
    mbox.add_child(artWrap);
    const mTitle = new St.Label({
        style_class: 'tahoe-qs-music-title',
        text: _('Not Playing'),
        x_align: Clutter.ActorAlign.START,
    });
    try {
        mTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    } catch (_) {
        // no clutter text
    }
    mbox.add_child(mTitle);
    const mArtist = new St.Label({
        style_class: 'tahoe-qs-music-artist',
        text: '',
        x_align: Clutter.ActorAlign.START,
        visible: false,
    });
    try {
        mArtist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    } catch (_) {
        // no clutter text
    }
    mbox.add_child(mArtist);
    // push transport controls to the card bottom (Tahoe: art, title, ctl at bottom)
    mbox.add_child(new St.BoxLayout({y_expand: true}));
    const mctl = new St.BoxLayout({style_class: 'tahoe-qs-music-ctl'});
    const prev = _makeGlyph('media-skip-backward-symbolic');
    const play = _makeGlyph('media-playback-start-symbolic');
    const next = _makeGlyph('media-skip-forward-symbolic');
    try {
        const g = _gicons();
        if (g.prev)
            prev.icon.gicon = g.prev;
        if (g.play)
            play.icon.gicon = g.play;
        if (g.next)
            next.icon.gicon = g.next;
    } catch (_) {
        // stock glyphs stay
    }
    prev.btn.connect('clicked', () => _mprisCall(state, 'Previous'));
    play.btn.connect('clicked', () => _mprisCall(state, 'PlayPause'));
    next.btn.connect('clicked', () => _mprisCall(state, 'Next'));
    mctl.add_child(prev.btn);
    mctl.add_child(play.btn);
    mctl.add_child(next.btn);
    mbox.add_child(mctl);
    rightCol.add_child(music);

    const dark = _makeCircle('weather-clear-night-symbolic');
    dark.btn.connect('clicked', () => {
        try {
            const iface = _ifaceSettings();
            if (!iface)
                return;
            const cur = iface.get_string('color-scheme');
            iface.set_string('color-scheme',
                cur === 'prefer-dark' ? 'prefer-light' : 'prefer-dark');
            _refreshDarkCircle(dark);
        } catch (_) {
            // unavailable
        }
    });
    const lock = _makeCircle('system-lock-screen-symbolic');
    lock.btn.add_style_class_name('tahoe-qs-circle-lock');
    lock.btn.connect('clicked', () => {
        _closePanel();
        _systemAction('lock');
    });
    try {
        const g0 = _gicons();
        if (g0.theme)
            dark.icon.gicon = g0.theme;
        if (g0.lock)
            lock.icon.gicon = g0.lock;
    } catch (_) {
        // stock glyphs stay
    }
    const darkRow = _makeSpacerRow(dark.btn, lock.btn);
    rightCol.add_child(darkRow);
    _refreshDarkCircle(dark);

    // ======================= row D: [Logout][Screenshot] | Focus =======================
    const rowd = new St.BoxLayout({style_class: 'tahoe-qs-rowd'});
    box.add_child(rowd);
    const logout = _makeCircle('system-log-out-symbolic');
    logout.btn.add_style_class_name('tahoe-qs-circle-logout');
    logout.btn.connect('clicked', () => {
        _closePanel();
        _systemAction('logout');
    });
    try {
        if (_gicons().logout)
            logout.icon.gicon = _gicons().logout;
    } catch (_) {
        // stock glyph stays
    }
    const shot = _makeCircle('camera-photo-symbolic');
    try {
        if (_gicons().shot)
            shot.icon.gicon = _gicons().shot;
    } catch (_) {
        // stock glyph stays
    }
    shot.btn.connect('clicked', () => {
        _closePanel();
        _systemAction('screenshot');
    });
    const leftRow = _makeSpacerRow(logout.btn, shot.btn);
    leftRow.x_expand = false;
    leftRow.set_width(COL_W);
    rowd.add_child(leftRow);

    const focus = _makePill('weather-clear-night-symbolic', _('Focus'), null);
    if (_gicons().focus)
        focus.icon.gicon = _gicons().focus;
    focus.btn.connect('clicked', () => {
        try {
            const s = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
            s.set_boolean('show-banners', !s.get_boolean('show-banners'));
            _refreshFocus(focus);
        } catch (_) {
            // unavailable
        }
    });
    focus.btn.x_expand = false;
    // border-box (proven by live allocation dump): forced == rendered,
    // so plain COL_W lands exactly in the column; no height override
    // (pills are 60 tall, Focus matches them pixel for pixel)
    focus.btn.set_width(COL_W);
    focus.btn.add_style_class_name('tahoe-qs-pill-focus');
    // Full inner width: button padding is 10 left + 12 right
    // (.tahoe-qs-pill). A full-width box renders identically whether the
    // button left-pins or centers its child - alignment stops mattering.
    focus.box.set_width(COL_W - 22);
    rowd.add_child(focus.btn);
    _refreshFocus(focus);

    // ======================= Display card =======================
    const disp = _makeSliderCard(_('Display'),
        'display-brightness-symbolic', 'display-brightness-symbolic', false);
    box.add_child(disp.box);

    // display backend 1: brightnessManager (stock)
    let haveBrightness = false;
    try {
        const bm = Main.brightnessManager;
        if (bm?.globalScale) {
            haveBrightness = true;
            state.brightScale = bm.globalScale;
            disp.slider.value = state.brightScale.value ?? 0.5;
            const upd = () => {
                if (state.dispGuard)
                    return;
                try {
                    state.dispGuard = true;
                    disp.slider.value = state.brightScale.value;
                } finally {
                    state.dispGuard = false;
                }
            };
            try {
                state.brightScale.connect('notify::value', upd);
            } catch (_) {
                // static
            }
            disp.slider.connect('notify::value', () => {
                if (state.dispGuard || !state.brightScale)
                    return;
                try {
                    state.brightScale.value = disp.slider.value;
                } catch (_) {
                    // read-only
                }
            });
        }
    } catch (_) {
        // no brightnessManager
    }
    // display backend 2: gsd-power D-Bus fallback
    if (!haveBrightness) {
        try {
            const proxy = Gio.DBusProxy.new_sync(
                Gio.DBus.session,
                Gio.DBusProxyFlags.NONE,
                null,
                'org.gnome.SettingsDaemon.Power',
                '/org/gnome/SettingsDaemon/Power/Screen',
                'org.gnome.SettingsDaemon.Power.Screen',
                null);
            if (proxy) {
                haveBrightness = true;
                state.screen = proxy;
                try {
                    const b = proxy.get_cached_property('Brightness');
                    if (b !== null)
                        disp.slider.value = b.unpack() / 100;
                } catch (_) {
                    // unreadable yet
                }
                disp.slider.connect('notify::value', () => {
                    try {
                        proxy.set('org.gnome.SettingsDaemon.Power.Screen', 'Brightness',
                            GLib.Variant.new_int32(Math.round(disp.slider.value * 100)));
                    } catch (_) {
                        // read-only
                    }
                });
                try {
                    proxy.connect('g-properties-changed', () => {
                        if (!_panel || state.dispGuard)
                            return;
                        try {
                            const v = proxy.get_cached_property('Brightness');
                            if (v !== null) {
                                state.dispGuard = true;
                                disp.slider.value = v.unpack() / 100;
                                state.dispGuard = false;
                            }
                        } catch (_) {
                            // gone
                        }
                    });
                } catch (_) {
                    // static
                }
            }
        } catch (_) {
            // no backlight
        }
    }
    if (!haveBrightness) {
        // keep the grid intact, just dead
        disp.box.opacity = 140;
        try {
            disp.slider.reactive = false;
            disp.slider.can_focus = false;
        } catch (_) {
            // gone
        }
    }

    // ======================= Sound card =======================
    const snd = _makeSliderCard(_('Sound'),
        'audio-volume-low-symbolic', 'audio-volume-high-symbolic', true);
    snd.box.reactive = true;
    snd.box.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === 3) {
            _openSoundSubmenu(snd.box, state);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    if (snd.endBtn) {
        snd.endBtn.connect('clicked', () => {
            _openSoundSubmenu(snd.box, state);
        });
        snd.endBtn.connect('button-press-event', (_actor, event) => {
            _openSoundSubmenu(snd.box, state);
            return Clutter.EVENT_STOP;
        });
    }
    box.add_child(snd.box);

    // sound backend: shared Gvc pattern from stock volume.js
    try {
        const control = new Gvc.MixerControl({name: 'Tahoe Quick Settings'});
        state.control = control;
        control.open();
        const id = control.connect('state-changed', () => {
            try {
                if (control.get_state() !== Gvc.MixerControlState.READY)
                    return;
                control.disconnect(id);
                if (!_panel)
                    return;
                const sink = control.get_default_sink();
                if (!sink)
                    return;
                state.sink = sink;
                const syncVol = () => {
                    if (!_panel || state.sndGuard)
                        return;
                    try {
                        state.sndGuard = true;
                        const max = control.get_vol_max_norm();
                        snd.slider.value = Math.max(0, Math.min(1, sink.volume / max));
                        snd.icon.icon_name = sink.is_muted
                            ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic';
                        if (snd.endIcon)
                            snd.endIcon.opacity = sink.is_muted ? 120 : 255;
                    } finally {
                        state.sndGuard = false;
                    }
                };
                try {
                    sink.connect('notify::volume', syncVol);
                    sink.connect('notify::mute', syncVol);
                    control.connect('default-sink-changed', () => {
                        try {
                            state.sink = control.get_default_sink();
                        } catch (_) {
                            // gone
                        }
                        syncVol();
                    });
                } catch (_) {
                    // static
                }
                snd.slider.connect('notify::value', () => {
                    if (state.sndGuard || !state.sink)
                        return;
                    try {
                        const max = control.get_vol_max_norm();
                        state.sink.volume = Math.round(snd.slider.value * max);
                        if (state.sink.is_muted && snd.slider.value > 0)
                            state.sink.is_muted = false;
                        state.sink.push_volume();
                    } catch (_) {
                        // gone
                    }
                });
                if (snd.endBtn) {
                    snd.endBtn.connect('clicked', () => {
                        try {
                            if (state.sink)
                                state.sink.is_muted = !state.sink.is_muted;
                        } catch (_) {
                            // gone
                        }
                    });
                }
                syncVol();
            } catch (_) {
                // no sink
            }
        });
    } catch (_) {
        snd.box.visible = false;
    }

    // ======================= bottom: Edit Controls pill =======================
    // same geometry as the privacy pill above (forced 28 + pad 8)
    const edit = new St.Button({
        style_class: 'tahoe-qs-edit tahoe-qs-pill-priv',
        reactive: true,
        can_focus: true,
        label: _('Edit Controls'),
        height: EDIT_H,
    });
    edit.connect('clicked', () => {
        _closePanel();
        try {
            Shell.AppSystem.get_default()
                .lookup_app('org.gnome.Settings.desktop')?.activate();
        } catch (_) { /* no settings */ }
    });
    // BoxLayout stretches full width and ignores x_align -> center by spacers
    const editRow = new St.BoxLayout({x_expand: true});
    const esp1 = new St.BoxLayout({x_expand: true});
    const esp2 = new St.BoxLayout({x_expand: true});
    editRow.add_child(esp1);
    editRow.add_child(edit);
    editRow.add_child(esp2);
    box.add_child(editRow);

    // extra control: never parented until the user drags it into the CC
    const setg = _makePill('preferences-system-symbolic', _('Settings'), null);
    setg.btn.visible = false;
    setg.btn.connect('clicked', () => {
        _closePanel();
        try {
            Shell.AppSystem.get_default()
                .lookup_app('org.gnome.Settings.desktop')?.activate();
        } catch (_) { /* no settings */ }
    });

    // layout-edit registry: every droppable/resizable/movable control
    state.leftCol = leftCol;
    state.rightCol = rightCol;
    state.editRow = editRow;
    state.units = [
        {id: 'wifi', actor: wifi.btn, kind: 'pill', home: leftCol, wide: false},
        {id: 'bt', actor: btPill.btn, kind: 'pill', home: leftCol, wide: false},
        {id: 'air', actor: air.btn, kind: 'pill', home: leftCol, wide: false},
        {id: 'music', actor: music, kind: 'music', home: rightCol, wide: false},
        {id: 'dark', actor: dark.btn, kind: 'circle', home: darkRow, wide: false},
        {id: 'lock', actor: lock.btn, kind: 'circle', home: darkRow, wide: false},
        {id: 'logout', actor: logout.btn, kind: 'circle', home: leftRow, wide: false},
        {id: 'shot', actor: shot.btn, kind: 'circle', home: leftRow, wide: false},
        {id: 'focus', actor: focus.btn, kind: 'pill', home: rowd, wide: false},
        {id: 'display', actor: disp.box, kind: 'card', home: box, wide: true},
        {id: 'sound', actor: snd.box, kind: 'card', home: box, wide: true},
        {id: 'settings', actor: setg.btn, kind: 'pill', home: leftCol, wide: false},
    ];
    for (const u of state.units) {
        try {
            u.actor.connect('button-press-event', (_a, ev) => _editPress(u, ev));
        } catch (_) { /* static */ }
    }

    Main.layoutManager.uiGroup.add_child(overlay);
    try {
        Main.layoutManager.uiGroup.set_child_below_sibling(overlay, Main.layoutManager.panelBox);
    } catch (_) {
        // stays on top
    }

    _panel = {overlay, box, panelBg, state, wifi, bt: btPill, air, focus, dark, lock, shot, logout, disp, snd,
        music, mTitle, mArtist, mPlayIcon: play.icon, mPrevIcon: prev.icon,
        mNextIcon: next.icon, artBin: art, artIcon, artUrl: '',
        priv: privPill, glass: null};

    // ======================= glass regions =======================
    // The theme circle paints its ON white wash in-shader (same mask as the
    // glass, so wash and glass are exactly the same size - a CSS background
    // would stop at the actor rect and read smaller). Other circles never
    // go ON, they keep the base fill.
    const circleSurf = _surf;
    const darkSurf = () => {
        try {
            const iface = _ifaceSettings();
            const isDark = iface
                ? iface.get_string('color-scheme') === 'prefer-dark'
                : _isDark();
            if (isDark)
                return {c: [1, 1, 1], a: 1};
        } catch (_) {
            // fall through to base
        }
        return _surf();
    };
    state.regions = [
        {g: 'pill', actor: wifi.btn, colorFn: _surf},
        {g: 'pill', actor: btPill.btn, colorFn: _surf},
        {g: 'pill', actor: air.btn, colorFn: _surf},
        {g: 'pill', actor: setg.btn, colorFn: _surf},
        {g: 'priv', actor: privPill.btn, colorFn: _surf},
        {g: 'disc', actor: focus.btn, colorFn: _surf},
        {g: 'edit', actor: edit, colorFn: _surf},
        {g: 'disc', actor: dark.btn, colorFn: () => darkSurf()},
        {g: 'disc', actor: lock.btn, colorFn: () => circleSurf(lock.btn)},
        {g: 'disc', actor: logout.btn, colorFn: () => circleSurf(logout.btn)},
        {g: 'disc', actor: shot.btn, colorFn: () => circleSurf(shot.btn)},
        {g: 'music', actor: music, colorFn: _surf},
        {g: 'card', actor: disp.box, colorFn: _surf},
        {g: 'card', actor: snd.box, colorFn: _surf},
        // backdrop: whole panel rect, zero surface fill (pure blur layer)
        {g: 'backdrop', actor: box, colorFn: () => ({c: [0, 0, 0], a: 0})},
    ];

    // NM backend
    try {
        NM.Client.new_async(null, (o, res) => {
            try {
                const client = NM.Client.new_finish(res);
                if (!_panel)
                    return;
                state.nm = client;
                const sync = () => _refreshWifi(wifi);
                try {
                    client.connect('notify::wireless-enabled', sync);
                    client.connect('notify::primary-connection', sync);
                    client.connect('notify::active-connections', sync);
                } catch (_) {
                    // static
                }
                _refreshWifi(wifi);
            } catch (_) {
                // no NM
            }
        });
    } catch (_) {
        // no NM
    }

    // BT backend (stock-correct: GnomeBluetooth.Client)
    try {
        state.bt = new GnomeBluetooth.Client();
        const bsync = () => _refreshBt(btPill);
        try {
            state.bt.connect('notify::default-adapter-powered', bsync);
            state.bt.connect('notify::default-adapter', bsync);
        } catch (_) {
            // static
        }
        _refreshBt(btPill);
    } catch (_) {
        btPill.btn.visible = false;
    }

    // MPRIS polling
    _mprisSync(state);
    try {
        state.mprisTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            if (!_panel)
                return GLib.SOURCE_REMOVE;
            _mprisSync(state);
            return GLib.SOURCE_CONTINUE;
        });
    } catch (_) {
        state.mprisTimer = 0;
    }

    // privacy pill monitors (mic/camera/share)
    _privacyStart(state);

    // panel bg + glass AFTER allocation (region math needs a real layout)
    try {
        const allocId = box.connect('notify::allocation', () => {
            try {
                box.disconnect(allocId);
            } catch (_) {
                // once
            }
            try {
                panelBg.set_position(box.x, box.y);
                panelBg.set_size(box.width, box.height);
            } catch (_) {
                // geometry unchanged
            }
            // adaptive ink: sample the real background behind the panel,
            // apply, and follow it while open (open animation covers a flip)
            try {
                const [px, py] = box.get_transformed_position();
                notePanelRect({x: px, y: py, w: box.width, h: box.height});
            } catch (_) {
                // unsampled: theme fallback ink stays
            }
            _applyPanelInk();
            try {
                if (state.inkUnwatch)
                    state.inkUnwatch();
            } catch (_) {
                // unwatched
            }
            try {
                state.inkUnwatch = watchInk(() => _applyPanelInk());
            } catch (_) {
                state.inkUnwatch = null;
            }
            _startGlass();
            _scheduleFocusFix();
        });
    } catch (_) {
        _startGlass();
    }
    box.opacity = 0;
    panelBg.opacity = 0;
    box.ease({opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    panelBg.ease({opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
}

// adaptive ink application: class + custom-glyph repaint (runs at open
// and on every background flip while open)
function _applyPanelInk() {
    const p = _panel;
    if (!p)
        return;
    try {
        if (getPanelInk() === 'light')
            p.box.add_style_class_name('tahoe-qs-inklight');
        else
            p.box.remove_style_class_name('tahoe-qs-inklight');
    } catch (_) {
        // class stays
    }
    // _gicons() re-resolves by ink (cache keyed on it); repaint the glyphs
    try {
        _refreshFocus(p.focus);
    } catch (_) {
        // gone
    }
    try {
        if (p.snd?.endIcon)
            p.snd.endIcon.gicon = _gicons().mute;
    } catch (_) {
        // gone
    }
    try {
        if (p.mPlayIcon) {
            const g = _gicons();
            p.mPlayIcon.gicon = p.state?.playing ? (g.pause ?? g.play) : g.play;
        }
    } catch (_) {
        // gone
    }
    try {
        _refreshAirdrop(p.air);
    } catch (_) {
        // gone
    }
    try {
        const g = _gicons();
        if (p.mPrevIcon && g.prev)
            p.mPrevIcon.gicon = g.prev;
        if (p.mNextIcon && g.next)
            p.mNextIcon.gicon = g.next;
    } catch (_) {
        // gone
    }
    try {
        const g = _gicons();
        try {
            _refreshDarkCircle(p.dark);
        } catch (_) {
            if (p.dark?.icon && g.theme)
                p.dark.icon.gicon = g.theme;
        }
        if (p.lock?.icon && g.lock)
            p.lock.icon.gicon = g.lock;
        if (p.shot?.icon && g.shot)
            p.shot.icon.gicon = g.shot;
        if (p.logout?.icon && g.logout)
            p.logout.icon.gicon = g.logout;
    } catch (_) {
        // gone
    }
}

// Capsule glass radii track the RENDERED shape (wifi/dark heights).
// One-shot passes only: per-frame setCornerRadius would rebuild pipelines.
function _syncCapsuleRadii() {
    try {
        const p = _panel;
        if (!p || !p.glass)
            return;
        const pillH = Math.round(p.wifi.btn.height || 0);
        const discH = Math.round(p.dark.btn.height || 0);
        for (const s of p.glass.stacks) {
            try {
                if (s.group === 'pill' && pillH > 0)
                    s.effect.setCornerRadius(Math.round(pillH / 2));
                else if (s.group === 'disc' && discH > 0)
                    s.effect.setCornerRadius(Math.round(discH / 2));
            } catch (_) {
                // effect gone
            }
        }
    } catch (_) {
        // panel gone
    }
}

// one-shot geometry dump to the journal for remote diagnosis:
// real allocations + text direction of every QS row element.
function _dumpGeometry() {
    try {
        const p = _panel;
        if (!p)
            return;
        const pos = a => {
            try {
                const [x, y] = a.get_transformed_position();
                return `${Math.round(x)},${Math.round(y)} ${Math.round(a.width)}x${Math.round(a.height)}`;
            } catch (_) {
                return '?';
            }
        };
        let dir = '?';
        try {
            dir = `${p.box.text_direction} dflt=${Clutter.get_default_text_direction()}`;
        } catch (_) {
            // no api
        }
        console.log(`[tahoe-qs-geo] dir=${dir} box=${pos(p.box)}`);
        console.log(`[tahoe-qs-geo] wifi=${pos(p.wifi.btn)} music=${pos(p.music)}`);
        console.log(`[tahoe-qs-geo] focus=${pos(p.focus.btn)} title='${p.focus.title.text}' sub=${p.focus.subtitle ? `'${p.focus.subtitle.text}'` : 'null'}`);
        try {
            const [cx] = p.focus.circle.get_transformed_position();
            const [tx] = p.focus.title.get_transformed_position();
            console.log(`[tahoe-qs-geo] focusCircleX=${Math.round(cx)} focusTextX=${Math.round(tx)} circleW=${Math.round(p.focus.circle.width)} textsW=${Math.round(p.focus.title.width)}`);
            console.log(`[tahoe-qs-geo] focusBox=${pos(p.focus.box)} wifiBox=${pos(p.wifi.box)}`);
        } catch (_) {
            // gone
        }
    } catch (_) {
        // panel gone
    }
}

function _scheduleFocusFix() {
    // radii passes land inside the 160ms fade-in (invisible) + verify pass
    for (const ms of [60, 350, 600]) {
        try {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                if (!_panel)
                    return GLib.SOURCE_REMOVE;
                _syncCapsuleRadii();
                if (ms === 600)
                    _dumpGeometry();
                return GLib.SOURCE_REMOVE;
            });
        } catch (_) {
            // no clock
        }
    }
}

// ------------------------------------------------------------- refresh
function _refreshWifi(wifi) {
    try {
        const s = _panel?.state?.nm;
        if (!s)
            return;
        const on = !!s.wireless_enabled;
        let name = 'Off';
        try {
            const c = on ? s.get_primary_connection() : null;
            const id = c?.get_id?.();
            if (id)
                name = id;
            else if (on)
                name = _('On');
        } catch (_) {
            // no active connection
        }
        if (wifi.subtitle)
            wifi.subtitle.text = name;
        _setActive(wifi.btn, on);
        wifi.icon.icon_name = on
            ? 'network-wireless-symbolic' : 'network-wireless-disabled-symbolic';
    } catch (_) {
        // gone
    }
}

function _refreshBt(pill) {
    try {
        const s = _panel?.state?.bt;
        if (!s)
            return;
        let on = false;
        try {
            on = !!s.default_adapter_powered;
        } catch (_) {
            on = false;
        }
        if (pill.subtitle)
            pill.subtitle.text = on ? _('On') : _('Off');
        _setActive(pill.btn, on);
        pill.icon.icon_name = on
            ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic';
    } catch (_) {
        // gone
    }
}

function _refreshAirdrop(air) {
    // AirDrop pill (no macOS-share backend on Linux): persistent ON/OFF.
    // Glyph monochrome (ink-following) when OFF, Apple blue when ON.
    if (!air)
        return;
    try {
        let on = false;
        try {
            on = _settings.get_boolean('tahoe-airdrop-on');
        } catch (_) {
            on = !!_panel?.state?.airdropOn;
        }
        if (air.subtitle)
            air.subtitle.text = on ? _('On') : _('Off');
        _setActive(air.btn, on);
        try {
            const g = _gicons();
            if (g.airdrop && g.airdropBlue)
                air.icon.gicon = on ? g.airdropBlue : g.airdrop;
        } catch (_) {
            // glyph stays
        }
    } catch (_) {
        // gone
    }
}

function _toggleAirdrop(state) {
    try {
        let on = false;
        try {
            on = !_settings.get_boolean('tahoe-airdrop-on');
            _settings.set_boolean('tahoe-airdrop-on', on);
        } catch (_) {
            on = !(state.airdropOn ?? false);
            state.airdropOn = on;
        }
        const p = _panel;
        if (p)
            _refreshAirdrop(p.air);
    } catch (_) {
        // unavailable
    }
}

function _refreshFocus(focus) {
    try {
        const s = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        const dnd = !s.get_boolean('show-banners');
        if (focus.subtitle)
            focus.subtitle.text = dnd ? _('On') : _('Off');
        _setActive(focus.btn, dnd);
        // custom moon: blue on white when Focus is on (white-on-white is invisible)
        try {
            const g = _gicons();
            if (g.focus && g.focusOn)
                focus.icon.gicon = dnd ? g.focusOn : g.focus;
        } catch (_) {
            // stock glyph stays
        }
    } catch (_) {
        // unavailable
    }
}

function _refreshDarkCircle(dark) {
    try {
        const iface = _ifaceSettings();
        const isDark = iface ? iface.get_string('color-scheme') === 'prefer-dark' : _isDark();
        _setActive(dark.btn, isDark);
        // ON circle is always the white wash (both themes): dark glyph.
        // OFF circle: ink-following glyph. (Custom PNGs ignore CSS color,
        // so white-on-white must be avoided here explicitly.)
        try {
            const g = _gicons();
            if (g.theme)
                dark.icon.gicon = (isDark && g.themeDark) ? g.themeDark : g.theme;
        } catch (_) {
            // glyph stays
        }
    } catch (_) {
        // unavailable
    }
}

function _systemAction(kind) {
    try {
        if (kind === 'lock') {
            Gio.DBus.session.call('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver',
                'org.gnome.ScreenSaver', 'Lock', null, null,
                Gio.DBusCallFlags.NONE, -1, null, null);
        } else if (kind === 'logout') {
            Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', 'Logout',
                new GLib.Variant('(u)', [0]), null,
                Gio.DBusCallFlags.NONE, -1, null, null);
        } else if (kind === 'shutdown') {
            Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager',
                'org.gnome.SessionManager', 'Shutdown', null, null,
                Gio.DBusCallFlags.NONE, -1, null, null);
        } else if (kind === 'screenshot') {
            // system screenshot UI (area select + capture)
            Gio.DBus.session.call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
                'org.gnome.Shell.Screenshot', 'InteractiveScreenshot', null, null,
                Gio.DBusCallFlags.NONE, -1, null, null);
        }
    } catch (_) {
        // unavailable
    }
}

// ------------------------------------------------- privacy pill (mic/camera/share)
// macOS-style pill on top: colored dot + app name. Camera green, mic
// orange, share blue. Hidden when nothing is in use.
// Sources: Shell.CameraMonitor (camera), the stock screen-sharing
// indicator (share, initial-state-correct), pactl source-outputs (mic
// WITH the real application name).
function _findShareIndicator() {
    try {
        const area = Main.panel.statusArea ?? {};
        for (const k in area) {
            try {
                if (area[k]?.has_style_class_name?.('screen-sharing-indicator'))
                    return area[k];
            } catch (_) {
                // next
            }
        }
    } catch (_) {
        // no panel
    }
    return null;
}

// stream owner name: the real binary beats the engine name
// (Discord-desktop is Electron -> application.name lies "chromium").
function _streamName(app, bin) {
    try {
        const base = (bin ?? '').split('/').pop() ?? '';
        if (base && !/^(chromium|chrome|google-chrome|firefox|electron)$/i.test(base))
            return base.charAt(0).toUpperCase() + base.slice(1);
        if (app)
            return app;
        if (base)
            return base.charAt(0).toUpperCase() + base.slice(1);
    } catch (_) {
        // fall through
    }
    return '';
}

function _parseMicApp(out) {
    try {
        const blocks = (out ?? '').split(/^Source Output #/m);
        for (let i = 1; i < blocks.length; i++) {
            const b = blocks[i];
            let m = b.match(/application\.name\s*=\s*"([^"]+)"/);
            const app = m?.[1] ?? '';
            m = b.match(/application\.process\.binary\s*=\s*"([^"]+)"/);
            const name = _streamName(app, m?.[1] ?? '');
            if (name && !/^pactl$/i.test(name))
                return name;
        }
    } catch (_) {
        // unparsable
    }
    return '';
}

function _parseCamApp(out) {
    // PIDs holding /dev/video* -> /proc/PID/comm (real app name).
    // fuser exits non-zero when idle — caller treats that as empty.
    try {
        const SKIP = new Set(['pipewire', 'wireplumber', 'pipewire-pulse',
            'xdg-desktop-portal', 'xdg-desktop-por', 'gnome-shell']);
        const seen = new Set();
        const ids = (out ?? '').match(/\d+/g) ?? [];
        for (const id of ids) {
            if (seen.has(id))
                continue;
            seen.add(id);
            let comm = '';
            try {
                const f = Gio.File.new_for_path(`/proc/${id}/comm`);
                const [, bytes] = f.load_contents(null);
                comm = new TextDecoder().decode(bytes).trim();
            } catch (_) {
                continue;
            }
            if (!comm || SKIP.has(comm))
                continue;
            return comm.charAt(0).toUpperCase() + comm.slice(1);
        }
    } catch (_) {
        // unparsable
    }
    return '';
}

function _privacyCamPoll() {
    try {
        const devs = [];
        for (let i = 0; i < 10; i++) {
            const dev = `/dev/video${i}`;
            try {
                if (GLib.file_test(dev, GLib.FileTest.EXISTS))
                    devs.push(dev);
            } catch (_) {
                // next
            }
        }
        if (!devs.length)
            return;
        const proc = Gio.Subprocess.new(['fuser', ...devs],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        proc.communicate_utf8_async(null, null, (proc_, res) => {
            try {
                const [, out] = proc_.communicate_utf8_finish(res);
                const p = _panel;
                if (!p)
                    return;
                p.state.camApp = _parseCamApp(out ?? '');
            } catch (_) {
                // fuser idle exit / no devices: no direct grabbers
                const p = _panel;
                if (p)
                    p.state.camApp = '';
            }
            _privacySync();
        });
    } catch (_) {
        // no fuser
    }
}

function _privacySync() {
    const p = _panel;
    if (!p || !p.priv)
        return;
    try {
        const st = p.state;
        const mic = st.micApp || '';
        const share = !!(st.shareInd ? st.shareInd.visible
            : (st.racHandles?.size > 0));
        // camera: direct V4L2 grabbers (fuser, with the real app name)
        // fall back to the portal monitor (generic label)
        const camApp = st.camApp || '';
        let camMon = false;
        try {
            camMon = !!st.camMon?.cameras_in_use;
        } catch (_) {
            camMon = false;
        }
        const cam = camApp || (camMon ? 'Camera' : '');
        const act = [];
        if (cam)
            act.push({cls: 'tahoe-qs-priv-green', icon: 'camera-web-symbolic', label: cam});
        if (mic)
            act.push({cls: 'tahoe-qs-priv-orange', icon: 'audio-input-microphone-symbolic', label: mic});
        if (share)
            act.push({cls: 'tahoe-qs-priv-blue', icon: 'screen-shared-symbolic', label: _('Screen Sharing')});
        const priv = p.priv;
        if (!act.length) {
            priv.btn.visible = false;
            return;
        }
        // main dot + up to 2 extra dots, names joined with commas
        _setPrivDot(priv, act[0].cls, act[0].icon);
        for (let i = 0; i < priv.dots.length; i++) {
            const slot = priv.dots[i];
            const a = act[i + 1];
            if (a) {
                _setPrivDot(slot, a.cls, a.icon);
                slot.dot.visible = true;
            } else {
                slot.dot.visible = false;
            }
        }
        try {
            priv.title.text = act.map(a => a.label).join(', ').slice(0, 30);
        } catch (_) {
            // gone
        }
        priv.btn.visible = true;
        console.log(`[tahoe-qs-priv] ${act.map(a => a.label).join(' + ')}`);
    } catch (_) {
        // panel gone
    }
}

function _privacyMicSync() {
    const q0 = _panel;
    if (!q0)
        return;
    // no pactl on PipeWire-only systems -> PipeWire native dump
    if (q0.state.micViaPW) {
        _privacyMicPwDump();
        return;
    }
    try {
        const proc = Gio.Subprocess.new(['pactl', 'list', 'source-outputs'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        proc.communicate_utf8_async(null, null, (proc_, res) => {
            try {
                const [, out] = proc_.communicate_utf8_finish(res);
                const p = _panel;
                if (!p)
                    return;
                p.state.micApp = _parseMicApp(out ?? '');
                _privacySync();
            } catch (e) {
                // no pactl: switch to pw-dump permanently
                const p = _panel;
                if (!p)
                    return;
                p.state.micViaPW = true;
                console.log(`[tahoe-qs-priv] pactl failed, using pw-dump: ${e}`);
                _privacyMicPwDump();
            }
        });
    } catch (_) {
        // no pactl binary at all
        const q = _panel;
        if (!q)
            return;
        q.state.micViaPW = true;
        _privacyMicPwDump();
    }
}

// PipeWire-native mic users: running Stream/Output/Audio nodes + app name.
function _privacyMicPwDump() {
    try {
        const proc = Gio.Subprocess.new(['pw-dump'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        proc.communicate_utf8_async(null, null, (proc_, res) => {
            try {
                const [, out] = proc_.communicate_utf8_finish(res);
                const p = _panel;
                if (!p)
                    return;
                p.state.micApp = _parsePwMic(out ?? '');
                _privacySync();
            } catch (e) {
                const p = _panel;
                if (p && !p.state.micLogged) {
                    p.state.micLogged = true;
                    console.log(`[tahoe-qs-priv] pw-dump failed: ${e}`);
                }
            }
        });
    } catch (_) {
        // no pipewire cli
    }
}

function _parsePwMic(out) {
    try {
        const arr = JSON.parse(out);
        const cands = [];
        for (const o of arr) {
            if (o?.type !== 'PipeWire:Interface:Node')
                continue;
            const props = o?.info?.props ?? {};
            if (props['media.class'] !== 'Stream/Output/Audio')
                continue;
            if (o?.info?.state !== 'running')
                continue;
            const name = _streamName(props['application.name'] ?? '',
                props['application.process.binary'] ?? '');
            if (!name || /portal|wireplumber|^pipewire/i.test(name))
                continue;
            // a specific app wins at once; browsers are kept as fallback
            // (a browser tab can legitimately hold the mic)
            if (!/^(chromium|chrome|google-chrome|firefox)$/i.test(name))
                return name;
            cands.push(name);
        }
        if (cands.length)
            return cands[0];
    } catch (_) {
        // not json (yet)
    }
    return '';
}

function _privacyStart(state) {
    // camera (native)
    try {
        state.camMon = new Shell.CameraMonitor();
        state.camId = state.camMon.connect('notify::cameras-in-use', _privacySync);
    } catch (_) {
        state.camMon = null;
    }
    // screen share: reuse the stock indicator (it tracks since shell start)
    const shareInd = _findShareIndicator();
    if (shareInd) {
        state.shareInd = shareInd;
        try {
            state.shareId = shareInd.connect('notify::visible', _privacySync);
        } catch (_) {
            // static
        }
    } else {
        // fallback: track remote-access handles opened from now on
        try {
            const ctl = global.backend.get_remote_access_controller();
            state.racHandles = new Set();
            ctl?.connect('new-handle', (o, h) => {
                try {
                    if (h.isRecording)
                        return;
                    state.racHandles.add(h);
                    h.connect('stopped', () => {
                        try {
                            state.racHandles.delete(h);
                        } catch (_) {
                            // gone
                        }
                        _privacySync();
                    });
                } catch (_) {
                    // gone
                }
                _privacySync();
            });
        } catch (_) {
            // no controller
        }
    }
    // mic app name (pactl) + direct camera grabbers (fuser),
    // refreshed while the panel is open
    try {
        state.privTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            if (!_panel)
                return GLib.SOURCE_REMOVE;
            _privacyMicSync();
            _privacyCamPoll();
            return GLib.SOURCE_CONTINUE;
        });
    } catch (_) {
        state.privTimer = 0;
    }
    _privacyMicSync();
    _privacyCamPoll();
    _privacySync();
}

// ------------------------------------------------------------- MPRIS
// Album art: file:// locally, http(s) downloaded once to the user cache.
function _setArt(p, url) {
    try {
        url = url ?? '';
        if ((p.artUrl ?? '') === url)
            return;
        p.artUrl = url;
        console.log(`[tahoe-qs-art] url=${url.slice(0, 100)}`);
        const make = path => new St.Icon({
            gicon: new Gio.FileIcon({file: Gio.File.new_for_path(path)}),
            icon_size: 44,
        });
        const fallback = () => p.artBin.set_child(p.artIcon);
        let path = null;
        if (url.startsWith('file://'))
            path = Gio.File.new_for_uri(url).get_path();
        else if (url.startsWith('/'))
            path = url;
        if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) {
            console.log(`[tahoe-qs-art] local file ok: ${path.slice(0, 100)}`);
            p.artBin.set_child(make(path));
            return;
        }
        if (!path && (url.startsWith('file://') || url.startsWith('/')))
            console.log(`[tahoe-qs-art] local file missing: ${url.slice(0, 100)}`);
        if (url.startsWith('http://') || url.startsWith('https://')) {
            const want = url;
            console.log(`[tahoe-qs-art] downloading: ${want.slice(0, 100)}`);
            Gio.File.new_for_uri(url).read_bytes_async(4 * 1024 * 1024,
                GLib.PRIORITY_LOW, null, (src, res) => {
                    try {
                        const bytes = src.read_bytes_finish(res);
                        if (!_panel || p.artUrl !== want)
                            return;   // track changed meanwhile
                        const dir = GLib.build_filenamev(
                            [GLib.get_user_cache_dir(), 'tahoe-qs']);
                        GLib.mkdir_with_parents(dir, 0o755);
                        const dst = GLib.build_filenamev(
                            [dir, want.endsWith('.png') ? 'cover.png' : 'cover.jpg']);
                        const out = Gio.File.new_for_path(dst).replace(
                            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                        out.write_bytes(bytes, null);
                        out.close(null);
                        console.log(`[tahoe-qs-art] cached: ${dst}`);
                        p.artBin.set_child(make(dst));
                    } catch (e) {
                        console.log(`[tahoe-qs-art] download failed: ${e}`);
                    }
                });
            return;
        }
        fallback();
    } catch (_) {
        try {
            p.artBin.set_child(p.artIcon);
        } catch (__) {
            // panel gone
        }
    }
}

function _mprisPlayers() {
    try {
        const names = Gio.DBus.session.call_sync('org.freedesktop.DBus',
            '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, null).deep_unpack()[0];
        return names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
    } catch (_) {
        return [];
    }
}

function _mprisSync(state) {
    try {
        const p = _panel;
        if (!p)
            return;
        const players = _mprisPlayers();
        if (!players.length) {
            p.mTitle.text = _('Not Playing');
            p.mArtist.text = '';
            p.mArtist.visible = false;
            try {
                if (_gicons().play)
                    p.mPlayIcon.gicon = _gicons().play;
            } catch (_) {
                // icon stays
            }
            _setArt(p, '');
            return;
        }
        const bus = players[0];
        const proxy = Gio.DBusProxy.new_sync(Gio.DBus.session,
            Gio.DBusProxyFlags.NONE, null, bus,
            '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', null);
        state.mpris = {bus, proxy};
        let status = '';
        let title = '';
        let artist = '';
        try {
            status = proxy.get_cached_property('PlaybackStatus')?.unpack() ?? '';
        } catch (_) {
            status = '';
        }
        try {
            _panel.state.playing = (status === 'Playing');
        } catch (_) {
            // panel gone
        }
        try {
            const md = proxy.get_cached_property('Metadata')?.deep_unpack() ?? {};
            const rawTitle = md['xesam:title'];
            title = (rawTitle?.unpack?.() ?? rawTitle ?? '').toString();
            const rawArtist = md['xesam:artist'];
            const arr = rawArtist?.deep_unpack?.() ?? rawArtist;
            artist = Array.isArray(arr) ? arr.join(', ') : (arr ?? '').toString();
            const rawArt = md['mpris:artUrl'];
            const artUrl = (rawArt?.unpack?.() ?? rawArt ?? '').toString();
            _setArt(p, artUrl);
        } catch (_) {
            // no metadata
        }
        p.mTitle.text = title || bus.replace('org.mpris.MediaPlayer2.', '');
        p.mArtist.text = artist;
        p.mArtist.visible = !!artist;
        p.mPlayIcon.visible = true;
        try {
            const g = _gicons();
            if (status === 'Playing')
                p.mPlayIcon.gicon = g.pause ?? g.play;
            else
                p.mPlayIcon.gicon = g.play;
            if (!p.mPlayIcon.gicon)
                p.mPlayIcon.icon_name = status === 'Playing'
                    ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        } catch (_) {
            p.mPlayIcon.icon_name = status === 'Playing'
                ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        }
    } catch (_) {
        // no player
    }
}

function _mprisCall(state, method) {
    try {
        const m = state.mpris;
        if (!m)
            return;
        m.proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            if (_panel)
                _mprisSync(state);
            return GLib.SOURCE_REMOVE;
        });
    } catch (_) {
        // player gone
    }
}

// ------------------------------------------------------------ glass (2 stacks)
export function _makeGlassStack(monitor, radius, name, pure = false, edgePx = 0) {
    if (!_lgReady())
        throw new Error('liquid-glass modules not loaded yet');
    const bgActor = new UnpickableActor();
    bgActor.set_name(`liquid-glass-bg-actor-${name}`);
    bgActor.set_pivot_point(0, 0);

    const liquidBox = new UnpickableActor();
    liquidBox.set_name(`liquid-box-${name}`);
    liquidBox.set_clip_to_allocation(true);
    bgActor.add_child(liquidBox);

    // prevents the BMS black-screen optimization bug (same as stock toggles)
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
        owner: `tahoe-qs-${name}`,
    });
    effect.setPadding(SHADER_PADDING);
    effect.setCornerRadius(radius);
    effect.setIsDock(false);
    effect.setMultiRegionMode(true);
    effect.setBlurRadius(_qsGlassBlur());
    // launchpad-style tint: dark glass sheet vs white sheet
    if (pure) {
        // backdrop: pure blur, nothing else. No tint wash, no brightness/
        // saturation shift, no refraction, no rim/specular/sheen - and a
        // wide edge_smoothing so the blur fades out gradually (macOS 26).
        effect.setTintColor(0, 0, 0);
        effect.setTintStrength(0);
        effect.setBrightness(1.0);
        effect.setContrast(1.0);
        effect.setSaturation(1.0);
    } else if (_isDark())
        effect.setTintColor(0.16, 0.16, 0.18);
    else
        effect.setTintColor(1, 1, 1);
    if (!pure) {
        effect.setTintStrength(_qsGlassTint());
        effect.setBrightness(_qsGlassBrightness());
        effect.setContrast(1.0);
        effect.setSaturation(_qsGlassSaturation());
    }
    // glare: broad specular sheen from the slider (0 = clean glass);
    // full rim/specular rig from the sliders (defaults = clean edges)
    effect.setSurfaceLightEnabled(true);
    try {
        if (pure) {
            effect._setFloat('sheen_intensity', 0);
            effect._setFloat('rim_intensity', 0);
            // rim_width 0 kills edgeBand entirely (step-gated in the shader),
            // which also kills the hardcoded idleRim outline - otherwise a
            // faint bright rect stays visible at the region edge.
            effect._setFloat('rim_width', 0);
            // inner-edge AO darkening is independent of the rim rig.
            effect._setFloat('ao_intensity', 0);
            effect._setFloat('specular_intensity', 0);
            effect._setFloat('displacement_scale', 0);
            effect._setFloat('chroma_strength', 0);
            effect._setFloat('edge_smoothing', edgePx > 0 ? edgePx : BACKDROP_PAD);
        } else {
            effect._setFloat('sheen_intensity', _qsGlassGlare() * 0.6);
            effect._setFloat('rim_intensity', _qsInt('tahoe-qs-rim-intensity', 8) / 100);
            effect._setFloat('rim_width', _qsInt('tahoe-qs-rim-width', 50) / 10);
            effect._setFloat('rim_power', _qsInt('tahoe-qs-rim-power', 60) / 10);
            effect._setFloat('rim_directional_power', _qsInt('tahoe-qs-rim-direction', 27) / 10);
            effect._setFloat('rim_light_color_intensity', _qsInt('tahoe-qs-rim-light', 140) / 100);
            effect._setFloat('specular_intensity', _qsInt('tahoe-qs-specular', 0) / 100);
            effect._setFloat('displacement_scale', _qsGlassRefraction());
            effect._setFloat('ior', _qsInt('tahoe-qs-ior', 240) / 100);
            effect._setFloat('chroma_strength', _qsInt('tahoe-qs-chroma', 60) / 10000);
            effect._setFloat('edge_smoothing', _qsInt('tahoe-qs-edge', 20) / 10);
            effect._setFloat('profile_shape_n', _qsInt('tahoe-qs-profile', 700) / 100);
            effect._setFloat('max_z', _qsInt('tahoe-qs-depth', 25));
        }
    } catch (_) {
        // older liquid-glass without the uniforms
    }
    liquidBox.add_effect(effect);

    const wcm = new WindowCloneManager(liquidBox, cloneContainer, `lg-${name}`);
    // panelBox (topbar icons) must never be cloned into QS glass: the backdrop
    // region overlaps the topbar, otherwise blurred icon ghosts land in it.
    // Ancestor source (not fixed actor) so rebuilds of the panel stay excluded.
    const uiSampler = new UILayerSampler(bgActor, liquidBox,
        [global.windowGroup, global.window_group], cloneContainer, name,
        Main.panel ? [Main.panel] : []);
    wcm.rebuildClones();
    uiSampler.rebindSelf();
    uiSampler.refresh();

    return {bgActor, liquidBox, cloneContainer, effect, wcm, uiSampler,
        lastRegions: null, lastBounds: null, grace: 0, clip: null, screen: null};
}

function _startGlass() {
    if (!_panel || _panel.glass)
        return;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor)
        return;
    if (!_lgReady()) {
        // liquid-glass modules still loading: retry shortly while open.
        try {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                if (_panel && !_panel.glass)
                    _startGlass();
                return GLib.SOURCE_REMOVE;
            });
        } catch (_) {
            // stays glass-less
        }
        return;
    }

    try {
        const stacks = GLASS_GROUPS.map(g => ({
            group: g.name,
            ..._makeGlassStack(monitor, g.radius, g.name, g.name === 'backdrop'),
        }));
        // index 1: above panelBg (0), below the content box
        for (const s of stacks)
            _panel.overlay.insert_child_at_index(s.bgActor, 1);
        // Layer cake, self-verified (no journal): the shadow must paint OVER
        // the backdrop blur, never under it. panelBg sits right above the
        // backdrop actor, below the element stacks.
        try {
            const ov = _panel.overlay;
            const bd = stacks.find(s => s.group === 'backdrop');
            if (bd) {
                const place = () => ov.get_children().indexOf(bd.bgActor);
                try {
                    ov.set_child_above_sibling(_panel.panelBg, bd.bgActor);
                } catch (_) {
                    // fall through to index repair
                }
                if (ov.get_children().indexOf(_panel.panelBg) !== place() + 1) {
                    try {
                        ov.remove_child(_panel.panelBg);
                    } catch (_) {
                        // already out
                    }
                    ov.insert_child_at_index(_panel.panelBg, place() + 1);
                }
            }
        } catch (_) {
            // order unchanged
        }
        const glass = {stacks, frameId: 0, torndown: false, tickN: 0};
        _panel.glass = glass;

        for (const s of stacks) {
            s.bgActor.opacity = 0;
            s.bgActor.ease({opacity: 255, duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }

        const tick = () => {
            glass.frameId = 0;
            if (glass.torndown || !_panel || _panel.glass !== glass)
                return GLib.SOURCE_REMOVE;
            if (!_panel.overlay.mapped)
                return GLib.SOURCE_REMOVE;
            try {
                _panel.panelBg.opacity = _panel.box.opacity;
            } catch (_) {
                // gone
            }
            // Invisible throttle: heavy sampler sync every 4th frame (~15fps).
            // Regions are static while open; opacity above stays per-frame so
            // the 160ms fade-in keeps all its steps.
            const heavy = (glass.tickN++ % 4) === 0;
            for (const s of glass.stacks) {
                try {
                    if (heavy) {
                        ensureGlassAllocated(s.bgActor);
                        _syncStack(s, monitor);
                    }
                } catch (e) {
                    reportFrameLoopError(`tahoe-qs-${s.group}`, e);
                }
            }
            try {
                glass.frameId = global.compositor.get_laters().add(
                    Meta.LaterType.BEFORE_REDRAW, tick);
            } catch (_) {
                glass.frameId = 0;
            }
            return GLib.SOURCE_REMOVE;
        };
        glass.frameId = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, tick);
    } catch (e) {
        console.error(`[tahoe-qs] glass failed: ${e}`);
    }
}

function _syncStack(s, monitor) {
    const p = _panel;
    if (!p)
        return;
    const monitorX = monitor.x;
    const monitorY = monitor.y;
    const screenW = monitor.width;
    const screenH = monitor.height;

    const [ovX, ovY] = p.overlay.get_transformed_position();
    s.bgActor.set_position(monitorX - ovX, monitorY - ovY);

    const regions = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const entry of p.state.regions) {
        if (entry.g !== s.group)
            continue;
        const a = entry.actor;
        if (!a || !a.visible || !a.mapped)
            continue;
        const [ax, ay, w, h] = getTransformedRect(a);
        if (!(w > 0) || !(h > 0) || Number.isNaN(ax) || Number.isNaN(ay))
            continue;
        // backdrop region covers panel + shadow with room for the fade
        // (tighter vertically); element regions keep the tight margin.
        const mx = s.group === 'backdrop' ? BACKDROP_REGION : GLASS_EXPAND + SHADER_PADDING;
        const my = s.group === 'backdrop' ? BACKDROP_REGION_Y : GLASS_EXPAND + SHADER_PADDING;
        let rx = (ax - monitorX) - mx;
        let ry = (ay - monitorY) - my;
        let rw = w + mx * 2;
        let rh = h + my * 2;
        // backdrop stays UNDER the topbar: the panel is transparent, so an
        // unclamped fade would bleed blurred glass through the bar. Clamp
        // the region top to just under panelBox (topbarBlur owns that band).
        if (s.group === 'backdrop') {
            let topEdge = 0;
            try {
                topEdge = Math.round(Main.layoutManager.panelBox?.height ?? 34) + 12;
            } catch (_) {
                topEdge = 46;
            }
            if (ry < topEdge) {
                const cut = topEdge - ry;
                ry = topEdge;
                rh -= cut;
                if (!(rh > 0))
                    continue;
            }
        }
        let col;
        try {
            col = entry.colorFn();
        } catch (_) {
            col = SURF_LIGHT;
        }
        regions.push({
            x: rx, y: ry, w: rw, h: rh,
            tintR: col.c[0], tintG: col.c[1], tintB: col.c[2],
            baseStrength: col.a,
        });
        minX = Math.min(minX, rx);
        minY = Math.min(minY, ry);
        maxX = Math.max(maxX, rx + rw);
        maxY = Math.max(maxY, ry + rh);
    }

    if (regions.length === 0) {
        if (s.lastRegions && s.grace++ < 2) {
            regions.push(...s.lastRegions);
            ({minX, minY, maxX, maxY} = s.lastBounds);
        } else {
            if (s.bgActor.visible)
                s.bgActor.hide();
            s.lastRegions = null;
            return;
        }
    } else {
        s.lastRegions = regions;
        s.lastBounds = {minX, minY, maxX, maxY};
        s.grace = 0;
    }

    if (!s.bgActor.visible)
        s.bgActor.show();
    s.bgActor.opacity = p.box.opacity;
    s.effect.setGlassRegions(regions);

    const clip = [minX - CLIP_PADDING, minY - CLIP_PADDING,
        (maxX - minX) + CLIP_PADDING * 2, (maxY - minY) + CLIP_PADDING * 2];
    if (!s.clip || s.clip[0] !== clip[0] || s.clip[1] !== clip[1] ||
        s.clip[2] !== clip[2] || s.clip[3] !== clip[3]) {
        s.clip = clip;
        setClipIfChanged(s.bgActor, clip[0], clip[1], clip[2], clip[3]);
    }
    if (!s.screen || s.screen[0] !== screenW || s.screen[1] !== screenH) {
        s.screen = [screenW, screenH];
        s.effect.setResolution(screenW, screenH);
        s.liquidBox.set_position(0, 0);
        s.liquidBox.set_size(screenW, screenH);
    }

    s.wcm.setOffset(-monitorX, -monitorY);
    syncGlassCaptureClip({
        cloneContainer: s.cloneContainer,
        effect: s.effect,
        originX: monitorX,
        originY: monitorY,
        uiSampler: s.uiSampler,
        windowCloneManager: s.wcm,
    });
    s.uiSampler.refresh();
    s.uiSampler.sync(monitorX, monitorY, screenW, screenH);
    s.wcm.sync();
}

function _destroyGlass() {
    const g = _panel?.glass;
    if (_panel)
        _panel.glass = null;
    if (!g)
        return;
    g.torndown = true;
    if (g.frameId) {
        try {
            global.compositor.get_laters().remove(g.frameId);
        } catch (_) {
            // already gone
        }
        g.frameId = 0;
    }
    for (const s of g.stacks) {
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
}

// ------------------------------------------------------------ open/close
let _closing = false;

function _closePanel() {
    _closeActiveSubmenu();
    if (!_panel || _closing)
        return;
    _closing = true;
    const {overlay, state} = _panel;
    _panel = null;
    // leave edit mode: badges die with the overlay, menu closes too
    _editMode = false;
    if (_editBadgeTimer) {
        try {
            GLib.source_remove(_editBadgeTimer);
        } catch (_) {
            // gone
        }
        _editBadgeTimer = 0;
    }
    for (const b of _editBadges) {
        try {
            b.destroy();
        } catch (_) {
            // already gone
        }
    }
    _editBadges = [];
    _editBadgeSig = '';
    try {
        import('./tahoeQSEdit.js').then(m => m.closeEditMenu()).catch(() => {});
    } catch (_) {
        // menu never opened
    }
    try {
        state.inkUnwatch?.();
    } catch (_) {
        // unwatched
    }
    try {
        notePanelRect(null);
    } catch (_) {
        // sampler keeps last
    }
    try {
        state.control?.close?.();
    } catch (_) {
        // mixer gone
    }
    if (state.mprisTimer) {
        try {
            GLib.source_remove(state.mprisTimer);
        } catch (_) {
            // gone
        }
    }
    if (state.privTimer) {
        try {
            GLib.source_remove(state.privTimer);
        } catch (_) {
            // gone
        }
    }
    try {
        if (state.camMon && state.camId)
            state.camMon.disconnect(state.camId);
    } catch (_) {
        // gone
    }
    try {
        if (state.shareInd && state.shareId)
            state.shareInd.disconnect(state.shareId);
    } catch (_) {
        // gone
    }
    _destroyGlass();
    try {
        overlay.destroy();
    } catch (_) {
        // gone
    }
    _closing = false;
    globalThis._tahoeQSOpen = false;
}

function _openPanel() {
    if (_panel) {
        _closePanel();
        return;
    }
    globalThis._tahoeQSOpen = true;
    // QS and NC never share the screen (dynamic import: no module cycle)
    try {
        import('./tahoeNotificationCenter.js').then(mod => {
            try {
                mod.closeNC();
            } catch (_) {
                // nc unavailable
            }
        }).catch(() => {
            // nc unavailable
        });
    } catch (_) {
        // nc unavailable
    }
    _buildPanel();
}

// direct entry for external triggers (topbar buttons, shortcuts):
// same toggle semantics, no synthetic keys involved.
export function togglePanel() {
    try {
        _openPanel();
    } catch (e) {
        console.error(`[tahoe-qs] toggle failed: ${e}`);
    }
}

// true while the Control Center panel is open (OSD suppresses itself then)
export function isPanelOpen() {
    try {
        return !!_panel;
    } catch (_) {
        return false;
    }
}

// Panel box actor for topbarBlur cut-outs (band never smears over it)
export function getQSPanelBox() {
    try {
        return _panel?.box ?? null;
    } catch (_) {
        return null;
    }
}

// Fullscreen overlay actor for topbarBlur layering (band stays above it)
export function getQSOverlay() {
    try {
        return _panel?.overlay ?? null;
    } catch (_) {
        return null;
    }
}

// ------------------------------------------------------------- edit mode
// "Edit Controls" opens the Tahoe menu (tahoeQSEdit.js); the CC itself
// enters edit mode: every control gets a "−" badge (remove), a resize
// badge (half <-> full width), and can be dragged to a new slot.

function _editCatalog() {
    const g = (() => { try { return _gicons(); } catch (_) { return {}; } })();
    return [
        {id: 'wifi', title: _('Wi-Fi'), icon: 'network-wireless-symbolic', category: 'connectivity'},
        {id: 'bt', title: _('Bluetooth'), icon: 'bluetooth-active-symbolic', category: 'connectivity'},
        {id: 'air', title: _('AirDrop'), gicon: g.airdrop ?? g.airdropBlue, icon: 'tahoe-airdrop', category: 'connectivity'},
        {id: 'focus', title: _('Focus'), gicon: g.focus, icon: 'weather-clear-night-symbolic', category: 'focus'},
        {id: 'display', title: _('Display'), icon: 'display-brightness-symbolic', category: 'display'},
        {id: 'dark', title: _('Dark Mode'), gicon: g.theme, icon: 'weather-clear-night-symbolic', category: 'display'},
        {id: 'sound', title: _('Sound'), icon: 'audio-volume-high-symbolic', category: 'sounds'},
        {id: 'music', title: _('Now Playing'), icon: 'multimedia-player-symbolic', category: 'nowplaying'},
        {id: 'lock', title: _('Lock Screen'), gicon: g.lock, icon: 'system-lock-screen-symbolic', category: 'lockscreen'},
        {id: 'logout', title: _('Log Out'), gicon: g.logout, icon: 'system-log-out-symbolic', category: 'shortcuts'},
        {id: 'shot', title: _('Screenshot'), gicon: g.shot, icon: 'camera-photo-symbolic', category: 'screenshot'},
        {id: 'settings', title: _('Settings'), icon: 'preferences-system-symbolic', category: 'desktop'},
    ];
}

function _editResizable(u) {
    return u.kind === 'pill' || u.kind === 'card' || u.kind === 'music';
}

function _editResize(u) {
    const p = _panel;
    if (!p || !u)
        return;
    try {
        const cur = u.actor.get_parent();
        if (u.wide) {
            // full width -> back home (narrow slot)
            cur?.remove_child(u.actor);
            u.home.add_child(u.actor);
            u.actor.set_width(u.id === 'focus' ? COL_W : (u.kind === 'card' ? COL_W : -1));
            u.wide = false;
        } else {
            // narrow -> full content width (own row above the edit pill)
            cur?.remove_child(u.actor);
            const idx = p.box.get_children().indexOf(p.state.editRow);
            p.box.insert_child_at_index(u.actor, idx < 0 ? p.box.get_children().length : idx);
            u.actor.set_width(PANEL_W - PAD * 2);
            u.wide = true;
        }
        _syncCapsuleRadii();
        _syncEditBadges();
    } catch (e) {
        console.log(`[tahoe-qse] resize failed: ${e}`);
    }
}

function _editRemove(u) {
    if (!u)
        return;
    try {
        u.actor.visible = false;
    } catch (_) { /* gone */ }
    _syncEditBadges();
}

// place `unit` so it lands at stage point (mx, my) inside the panel
function _editPlaceAt(unit, mx, my) {
    const p = _panel;
    if (!p || !unit)
        return false;
    const a = unit.actor;
    // drop outside the CC panel -> ignore (stage coords everywhere)
    let ox = 0, oy = 0, bx = 0, by = 0, bw = 0, bh = 0;
    try {
        [ox, oy] = p.overlay.get_transformed_position();
        [bx, by] = p.box.get_transformed_position();
        bw = p.box.width;
        bh = p.box.height;
    } catch (_) {
        return false;
    }
    if (mx < bx || mx > bx + bw || my < by || my > by + bh)
        return false;
    let target = null, tAfter = false;
    for (const u of p.state.units) {
        if (u === unit || u === unit.unit || !u.actor.visible || !u.actor.mapped)
            continue;
        try {
            const [tx, ty] = u.actor.get_transformed_position();
            const tw = u.actor.width, th = u.actor.height;
            if (mx >= tx && mx <= tx + tw && my >= ty && my <= ty + th) {
                target = u;
                tAfter = my > ty + th / 2;
                break;
            }
        } catch (_) { /* gone */ }
    }
    try {
        if (target) {
            const par = target.actor.get_parent();
            const idx = par.get_children().indexOf(target.actor);
            if (a.get_parent())
                a.get_parent().remove_child(a);
            par.insert_child_at_index(a, idx + (tAfter ? 1 : 0));
            unit.home = par;
        } else {
            // empty area: own row for wide units, nearest column otherwise
            if (a.get_parent())
                a.get_parent().remove_child(a);
            if (unit.wide || unit.kind === 'card') {
                const idx = p.box.get_children().indexOf(p.state.editRow);
                p.box.insert_child_at_index(a, idx < 0 ? p.box.get_children().length : idx);
                a.set_width(PANEL_W - PAD * 2);
                unit.wide = true;
                unit.home = p.box;
            } else {
                const midX = bx + bw / 2;
                const col = mx < midX ? p.state.leftCol : p.state.rightCol;
                col.add_child(a);
                a.set_width(-1);
                unit.home = col;
                unit.wide = false;
            }
        }
        a.visible = true;
        _syncCapsuleRadii();
        return true;
    } catch (e) {
        console.log(`[tahoe-qse] place failed: ${e}`);
        return false;
    }
}

// menu -> CC drop (called by tahoeQSEdit.js, stage coordinates)
export function tryDropControl(ctrl, mx, my) {
    const p = _panel;
    if (!p || !ctrl)
        return false;
    const unit = p.state.units?.find(u => u.id === ctrl.id);
    if (!unit)
        return false;
    const ok = _editPlaceAt(unit, mx, my);
    if (ok) {
        _setEditMode(true);
        _syncEditBadges();
    }
    return ok;
}

// drag an existing control to a new slot (edit mode only)
function _editPress(u, ev) {
    if (!_editMode)
        return Clutter.EVENT_PROPAGATE;
    const p = _panel;
    if (!p || !u.actor.visible)
        return Clutter.EVENT_PROPAGATE;
    const [sx, sy] = ev.get_coords();
    let moved = false;
    let cMotion = 0, cRelease = 0;

    const finish = () => {
        try { global.stage.disconnect(cMotion); } catch (_) {}
        try { global.stage.disconnect(cRelease); } catch (_) {}
        try {
            u.actor.translation_x = 0;
            u.actor.translation_y = 0;
            u.actor.opacity = 255;
        } catch (_) { /* gone */ }
    };

    cMotion = global.stage.connect('captured-event', (_s, mev) => {
        if (mev.type() !== Clutter.EventType.MOTION)
            return Clutter.EVENT_PROPAGATE;
        const [mx, my] = mev.get_coords();
        if (!moved) {
            if (Math.abs(mx - sx) + Math.abs(my - sy) < 8)
                return Clutter.EVENT_PROPAGATE;
            moved = true;
        }
        try {
            const [ax, ay] = u.actor.get_transformed_position();
            u.actor.translation_x = mx - sx;
            u.actor.translation_y = my - sy;
            void ax; void ay;
            u.actor.opacity = 200;
        } catch (_) { /* gone */ }
        return Clutter.EVENT_STOP;
    });

    cRelease = global.stage.connect('captured-event', (_s, rev) => {
        if (rev.type() !== Clutter.EventType.BUTTON_RELEASE)
            return Clutter.EVENT_PROPAGATE;
        const [mx, my] = rev.get_coords();
        const wasDrag = moved;
        finish();
        if (wasDrag) {
            _editPlaceAt(u, mx, my);
            _syncEditBadges();
        }
        return Clutter.EVENT_STOP;
    });

    return Clutter.EVENT_STOP;
}

// overlay badges: "−" remove, "⇄" resize (resizable units only)
let _editBadges = [];
let _editBadgeTimer = 0;
let _editBadgeSig = '';

function _syncEditBadges() {
    const p = _panel;
    // signature: rebuild only when the layout actually changed
    let sig = '';
    if (_editMode && p) {
        try {
            const [ox, oy] = p.overlay.get_transformed_position();
            for (const u of p.state.units ?? []) {
                if (!u.actor.visible || !u.actor.mapped)
                    continue;
                const [ux, uy] = u.actor.get_transformed_position();
                sig += `${u.id}:${Math.round(ux - ox)},${Math.round(uy - oy)}|`;
            }
        } catch (_) { sig = ''; }
        if (sig && sig === _editBadgeSig)
            return;
    }
    _editBadgeSig = sig;
    for (const b of _editBadges) {
        try { b.destroy(); } catch (_) { /* gone */ }
    }
    _editBadges = [];
    if (!_editMode || !p)
        return;
    let ox = 0, oy = 0;
    try {
        [ox, oy] = p.overlay.get_transformed_position();
    } catch (_) { return; }
    const mk = (glyph, cb) => {
        const b = new St.Button({
            style_class: 'tahoe-qs-editbadge',
            reactive: true, can_focus: true,
            label: glyph,
        });
        b.connect('clicked', cb);
        p.overlay.add_child(b);
        _editBadges.push(b);
        return b;
    };
    for (const u of p.state.units ?? []) {
        try {
            if (!u.actor.visible || !u.actor.mapped)
                continue;
            const [ux, uy] = u.actor.get_transformed_position();
            const bx = ux - ox - 7;
            const by = uy - oy - 7;
            const rm = mk('−', () => { _editRemove(u); });
            rm.set_position(bx, by);
            if (_editResizable(u)) {
                const rz = mk('⇄', () => { _editResize(u); });
                rz.set_position(bx + u.actor.width + 4, by);
                rz.add_style_class_name('tahoe-qs-editbadge-resize');
            }
        } catch (_) { /* unit gone */ }
    }
}

function _setEditMode(on) {
    const prev = _editMode;
    _editMode = !!on;
    _syncEditBadges();
    if (_editMode) {
        // layout settles after reparent passes -> re-stamp badges
        for (const ms of [160, 420]) {
            try {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                    if (_editMode)
                        _syncEditBadges();
                    return GLib.SOURCE_REMOVE;
                });
            } catch (_) { /* no clock */ }
        }
        // keep badges glued to their controls while the layout animates
        if (!_editBadgeTimer) {
            try {
                _editBadgeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    if (!_editMode) {
                        _editBadgeTimer = 0;
                        return GLib.SOURCE_REMOVE;
                    }
                    _syncEditBadges();
                    return GLib.SOURCE_CONTINUE;
                });
            } catch (_) { /* no clock */ }
        }
    } else if (prev && _editBadgeTimer) {
        try {
            GLib.source_remove(_editBadgeTimer);
        } catch (_) { /* gone */ }
        _editBadgeTimer = 0;
    }
}

export function isEditMode() {
    return _editMode;
}

// ------------------------------------------------------------ enable
export function enable(settings, gettextFunc) {
    if (_enabled)
        return;
    _settings = settings;
    if (typeof gettextFunc === 'function')
        _ = gettextFunc;
    if (!_settings.get_boolean('tahoe-quick-settings'))
        return;
    _enabled = true;
    try {
        const menu = Main.panel?.statusArea?.quickSettings?.menu;
        if (!menu)
            return;
        _origOpen = menu.open;
        _origClose = menu.close;
        _origToggle = menu.toggle;
        menu.open = () => {
            _openPanel();
            return true;
        };
        menu.close = () => {
            _closePanel();
            return true;
        };
        menu.toggle = () => {
            togglePanel();
            return true;
        };
    } catch (_) {
        // no quick settings here
    }
}

export function disable() {
    _enabled = false;
    try {
        const menu = Main.panel?.statusArea?.quickSettings?.menu;
        if (menu) {
            if (_origOpen) {
                menu.open = _origOpen;
                _origOpen = null;
            }
            if (_origClose) {
                menu.close = _origClose;
                _origClose = null;
            }
            if (_origToggle) {
                menu.toggle = _origToggle;
                _origToggle = null;
            } else {
                delete menu.toggle;
            }
        }
    } catch (_) {
        // already gone
    }
    _closePanel();
    _settings = null;
    _ = (m) => m;
}

export function openWifiSubmenu() {
    if (_panel && _panel.wifi)
        _openWifiSubmenu(_panel.wifi.btn, _panel.state);
}

export function openBluetoothSubmenu() {
    if (_panel && _panel.bt)
        _openBluetoothSubmenu(_panel.bt.btn, _panel.state);
}

export function openSoundSubmenu() {
    if (_panel && _panel.snd)
        _openSoundSubmenu(_panel.snd.box, _panel.state);
}

export function closeActiveSubmenu() {
    _closeActiveSubmenu();
}
