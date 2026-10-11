import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { flushAllCache } from '../main/alphaCache.js';

export function isWackShellInstalled() {
    const userPath = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'wack-shell@rinzler69-wastaken.github.com']);
    const sysPath1 = '/usr/share/gnome-shell/extensions/wack-shell@rinzler69-wastaken.github.com';
    const sysPath2 = '/usr/local/share/gnome-shell/extensions/wack-shell@rinzler69-wastaken.github.com';
    return Gio.File.new_for_path(userPath).query_exists(null) ||
        Gio.File.new_for_path(sysPath1).query_exists(null) ||
        Gio.File.new_for_path(sysPath2).query_exists(null);
}

export function isWackShellEnabled() {
    const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
    const enabled = shellSettings.get_strv('enabled-extensions');
    return enabled.includes('wack-shell@rinzler69-wastaken.github.com');
}



export function flushWackCache() {
    flushAllCache();
}

export function buildComboRow(settings, key, title, subtitle, options, _) {
    const model = new Gtk.StringList();
    for (const [, label] of options)
        model.append(_(label));

    const row = new Adw.ComboRow({
        title,
        subtitle,
        model,
    });

    const syncFromSettings = () => {
        const current = settings.get_string(key);
        const selected = Math.max(0, options.findIndex(([value]) => value === current));
        row.selected = selected;
    };

    syncFromSettings();
    row.connect('notify::selected', () => {
        const [value] = options[row.selected] ?? options[0];
        if (settings.get_string(key) !== value)
            settings.set_string(key, value);
    });
    const sigId = settings.connect(`changed::${key}`, syncFromSettings);
    row.connect('destroy', () => settings.disconnect(sigId));

    return row;
}
