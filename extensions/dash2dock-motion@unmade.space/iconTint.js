// Kiwi icon-tint bridge: macOS-style accent recolor for dock icons.
// Reads the toggle + color from kiwi's own settings (single source of
// truth, edited in Kiwi Preferences), applies Clutter.ColorizeEffect
// which preserves luminance like the macOS tinted-icon pipeline.

import {
    Clutter,
    Cogl,
    Gio,
    GLib,
    GObject,
} from './dependencies/gi.js';

const KIWI_UUID = 'kiwi@kemma';
const KIWI_SCHEMA = 'org.gnome.shell.extensions.kiwi';

// Only Clutter.ColorizeEffect exists in this build (Desaturate and
// BrightnessContrast throw at construction). Single effect, tint passed
// via constructor.
function _newTintChain(r, g, b) {
    try {
        const effect = new Clutter.ColorizeEffect({
            tint: {red: r, green: g, blue: b, alpha: 255},
        });
        effect._isIconTint = true;
        return [effect];
    } catch (e) {
        return null;
    }
}

let _settings = null;
let _probed = false;

function _kiwiSchemaDir() {
    const [path] = GLib.filename_from_uri(import.meta.url);
    const thisDir = GLib.path_get_dirname(path);
    const extRoot = GLib.path_get_dirname(thisDir);
    return GLib.build_filenamev([extRoot, KIWI_UUID, 'schemas']);
}

export function getKiwiSettings() {
    if (_probed)
        return _settings;
    _probed = true;
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(
            _kiwiSchemaDir(), Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(KIWI_SCHEMA, false);
        if (schema)
            _settings = new Gio.Settings({settings_schema: schema});
    } catch (e) {
        _settings = null;
    }
    return _settings;
}

// Builds a real Cogl.Color: plain JS objects do not reliably marshal
// into the effect's tint struct (silent white = invisible tint).
export function makeTintColor(spec) {
    const c = parseAccentColor(spec);
    if (!c)
        return null;
    try {
        const color = new Cogl.Color();
        color.init_from_4ub(c.red, c.green, c.blue, c.alpha);
        return color;
    } catch (e) {
        return c;
    }
}

// Accepts '#rrggbb[aa]' and 'rgb()/rgba()' (what Gtk.ColorButton writes).
export function parseAccentColor(spec) {
    if (typeof spec !== 'string')
        return null;
    const s = spec.trim();
    let m = s.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (m) {
        return {
            red: parseInt(m[1].slice(0, 2), 16),
            green: parseInt(m[1].slice(2, 4), 16),
            blue: parseInt(m[1].slice(4, 6), 16),
            alpha: m[2] ? parseInt(m[2], 16) : 255,
        };
    }
    m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) {
        let a = 255;
        if (m[4] !== undefined) {
            const f = parseFloat(m[4]);
            a = f <= 1 ? Math.round(f * 255) : Math.round(f);
        }
        return {
            red: Math.min(255, parseInt(m[1], 10)),
            green: Math.min(255, parseInt(m[2], 10)),
            blue: Math.min(255, parseInt(m[3], 10)),
            alpha: Math.max(0, Math.min(255, a)),
        };
    }
    return null;
}

// Tahoe icon-style engine (Light / Dark / Tinted / Clear), self-contained
// duplicate of kiwi's apps/iconStyle.js (cross-extension imports would
// hard-fail the dock when kiwi is absent). Per the Finder reference:
// dark = gamma curve (plates go black, glyph hues survive); tinted/clear =
// luminance-keyed duotone (colored/gray plate + white glyph). GLSL idiom
// copied from kiwi's minimizedToDock.js RoundedCornersEffect.

const DARK_SRC = `
uniform sampler2D tex;
void main() {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 c = texture2D(tex, uv);
    vec3 g = pow(c.rgb, vec3(1.5));
    cogl_color_out = vec4(g, c.a) * cogl_color_in;
}`;

const DUO_SRC = `
uniform sampler2D tex;
uniform float u_lo;
uniform float u_hi;
uniform float u_shR;
uniform float u_shG;
uniform float u_shB;
void main() {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 c = texture2D(tex, uv);
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    float t = smoothstep(u_lo, u_hi, lum);
    vec3 g = mix(vec3(u_shR, u_shG, u_shB), vec3(1.0), t);
    cogl_color_out = vec4(g, c.a) * cogl_color_in;
}`;

const DuoEffect = GObject.registerClass(
class DuoEffect extends Clutter.ShaderEffect {
    constructor() {
        super();
    }
});

function _newDuo(source) {
    const fx = new DuoEffect();
    fx._isIconStyle = true;
    try {
        if (typeof fx.set_shader_source === 'function')
            fx.set_shader_source(source);
    } catch (e) {
        // no shader on this build
    }
    return fx;
}

function _setFloat(fx, name, v) {
    try {
        fx.set_uniform_value(name, v - 1e-6);
    } catch (e) {
        // uniform missing
    }
}

function _isDarkTheme() {
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        return iface.get_string('color-scheme') === 'prefer-dark';
    } catch (e) {
        return true;
    }
}

function _resolveStyle(s) {
    try {
        const mode = s?.get_string?.('icon-style') ?? 'auto';
        if (mode === 'light' || mode === 'dark' || mode === 'tinted' || mode === 'clear')
            return mode;
        if (mode === 'auto' && s?.get_boolean?.('icon-tint-enabled'))
            return 'tinted';
    } catch (e) {
        // fall through to theme
    }
    try {
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (iface.get_string('color-scheme') === 'prefer-dark')
            return 'dark';
    } catch (e) {
        // light fallback
    }
    return 'light';
}

function _applyStyle(iconActor, mode, colorSpec) {
    if (mode === 'tinted') {
        const c = parseAccentColor(colorSpec ?? '#0a84ff') ??
            {red: 10, green: 132, blue: 255};
        const fx = _newDuo(DUO_SRC);
        iconActor.add_effect(fx);
        _setFloat(fx, 'u_lo', 0.20);
        _setFloat(fx, 'u_hi', 0.75);
        _setFloat(fx, 'u_shR', c.red / 255 * 0.9);
        _setFloat(fx, 'u_shG', c.green / 255 * 0.9);
        _setFloat(fx, 'u_shB', c.blue / 255 * 0.9);
        return;
    }
    if (mode === 'clear') {
        const g = _isDarkTheme() ? 0.30 : 0.60;
        const fx = _newDuo(DUO_SRC);
        iconActor.add_effect(fx);
        _setFloat(fx, 'u_lo', 0.25);
        _setFloat(fx, 'u_hi', 0.70);
        _setFloat(fx, 'u_shR', g);
        _setFloat(fx, 'u_shG', g);
        _setFloat(fx, 'u_shB', g * 1.02);
        return;
    }
    if (mode === 'dark') {
        const fx = _newDuo(DARK_SRC);
        iconActor.add_effect(fx);
        return;
    }
}

export function refreshIconTint(iconActor) {
    // Icon styles removed - plain stock icons only. Strip any leftover
    // style effect and stop.
    try {
        const old = typeof iconActor.get_effects === 'function'
            ? iconActor.get_effects() : [];
        for (const e of old ?? []) {
            if (e && (e._isIconTint || e._isIconStyle)) {
                try {
                    iconActor.remove_effect(e);
                } catch (_) {
                    // gone
                }
            }
        }
    } catch (_) {
        // plain icon stays
    }
}

// Returns an unwatch closure (or null).
export function watchIconTint(cb) {
    return null;
}
