// SPDX-License-Identifier: GPL-3.0-or-later
// Keeps ~/.config/gtk-4.0/gtk.css following the system color scheme
// (MacTahoe Light/Dark), preserving Kiwi's managed imports. Standalone
// twin lives in gtk-theme-sync@micronix (takes over after a re-login).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MARKER_BEGIN = '/* Kiwi (is not Apple) - managed imports: begin */';
const MARKER_END = '/* Kiwi (is not Apple) - managed imports: end */';

let _iface = null;
let _schemeId = 0;
let _themeId = 0;

function _configPath(name) {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-4.0', name]);
}

function _readFile(path) {
    try {
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null))
            return null;
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return null;
    }
}

export function syncTheme() {
    try {
        const iface = _iface ?? new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const theme = iface.get_string('gtk-theme') || '';
        if (!theme.startsWith('MacTahoe')) {
            console.log('[kiwi-gtk-sync] gtk-theme is not MacTahoe, leaving gtk.css alone');
            return;
        }

        const dark = iface.get_string('color-scheme') === 'prefer-dark';
        const variant = dark ? 'gtk-Dark.css' : 'gtk-Light.css';
        const themeCss = _readFile(_configPath(variant));
        if (!themeCss) {
            console.error(`[kiwi-gtk-sync] missing ${variant}, skipping`);
            return;
        }

        const current = _readFile(_configPath('gtk.css')) ?? '';
        const begin = current.indexOf(MARKER_BEGIN);
        const end = current.indexOf(MARKER_END);
        if (begin === -1 || end === -1 || end < begin) {
            console.log('[kiwi-gtk-sync] no Kiwi block in gtk.css, leaving it alone');
            return;
        }
        const block = current.slice(begin, end + MARKER_END.length) + '\n';

        const file = Gio.File.new_for_path(_configPath('gtk.css'));
        file.replace_contents(new TextEncoder().encode(block + themeCss), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        console.log(`[kiwi-gtk-sync] gtk.css now follows ${dark ? 'dark' : 'light'} (${variant})`);
    } catch (e) {
        console.error(`[kiwi-gtk-sync] sync failed: ${e}`);
    }
}

export function enable() {
    if (_iface)
        return;
    _iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    _schemeId = _iface.connect('changed::color-scheme', () => syncTheme());
    _themeId = _iface.connect('changed::gtk-theme', () => syncTheme());
    syncTheme();
}

export function disable() {
    if (_schemeId && _iface) {
        try {
            _iface.disconnect(_schemeId);
        } catch (e) {
            // already gone
        }
        _schemeId = 0;
    }
    if (_themeId && _iface) {
        try {
            _iface.disconnect(_themeId);
        } catch (e) {
            // already gone
        }
        _themeId = 0;
    }
    _iface = null;
}
