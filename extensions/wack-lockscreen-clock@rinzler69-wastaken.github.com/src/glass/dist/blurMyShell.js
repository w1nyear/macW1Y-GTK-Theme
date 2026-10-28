import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
const UUID = 'blur-my-shell@aunetx';
const SCHEMA = 'org.gnome.shell.extensions.blur-my-shell';
// The typings still call this state by its pre-46 name, ENABLED.
const ACTIVE = ExtensionState.ACTIVE;
const POPUP_GLASS_KEYS = ['enable-menu-glass', 'enable-quick-settings-glass', 'enable-extra-menu-glass',
    'enable-desktop-menu-glass', 'enable-notification-glass', 'enable-osd-glass'];
// The parts of Blur my Shell that blur where Liquid Glass can draw glass: the
// name used in blur-my-shell-override-parts, Blur my Shell's schema for it,
// the keys that say whether there is glass there, and the key that publishes
// that both blur and glass are there.
const PARTS = [
    { name: 'popups', schema: 'popup', keys: POPUP_GLASS_KEYS, conflict: 'blur-my-shell-popup-blur' },
    { name: 'panel', schema: 'panel', keys: ['top-bar-style'], conflict: 'blur-my-shell-panel-blur' },
    { name: 'dock', schema: 'dash-to-dock', keys: ['enable-dock-glass'], conflict: 'blur-my-shell-dock-blur' },
    { name: 'applications', schema: 'applications', keys: ['enable-application-glass'], conflict: 'blur-my-shell-applications-blur' },
];

function hasGlass(settings, keys) {
    return keys.some(key => key === 'top-bar-style' ? settings.get_string(key) !== 'off' : settings.get_boolean(key));
}

// Blur my Shell's schemas, the way its getSettings() finds them, or null when
// they cannot be read.
function schemaSource(extensionPath) {
    const defaultSource = Gio.SettingsSchemaSource.get_default();
    const dir = GLib.build_filenamev([extensionPath, 'schemas']);
    if (!GLib.file_test(GLib.build_filenamev([dir, 'gschemas.compiled']), GLib.FileTest.EXISTS))
        return defaultSource;
    // Loading a compiled schema file throws a GError when it is unreadable.
    try {
        return Gio.SettingsSchemaSource.new_from_directory(dir, defaultSource, false);
    }
    catch {
        return null;
    }
}

/**
 * Blur my Shell blurs some of what Liquid Glass draws glass on, and repaints
 * their backgrounds, which then show through the glass. Publishes each part
 * it blurs under glass, for the preferences window's warning, and logs the
 * popups. With
 * blur-my-shell-override, turns its blur off for the chosen parts that have
 * glass while both run, and back on afterwards.
 */
export class BlurMyShellWatch {
    _settings;
    _logger;
    _stateId = 0;
    _settingsIds = [];
    // Blur my Shell's settings for each part, while it is installed.
    _parts = new Map();
    _partIds = [];
    _path = null;
    _blurring = null;

    constructor(_settings, _logger) {
        this._settings = _settings;
        this._logger = _logger;
    }

    setup() {
        this._stateId = Main.extensionManager.connect('extension-state-changed', (_manager, extension) => {
            if (extension.uuid === UUID)
                this._sync();
        });
        const keys = new Set(['blur-my-shell-override', 'blur-my-shell-override-parts', ...PARTS.flatMap(part => part.keys)]);
        for (const key of keys) {
            this._settingsIds.push(this._settings.connect(`changed::${key}`, () => {
                this._override();
                this._update();
            }));
        }
        this._sync();
    }

    _sync() {
        const path = Main.extensionManager.lookup(UUID)?.path ?? null;
        if (path !== this._path) {
            this._dropParts();
            this._path = path;
            const source = path ? schemaSource(path) : null;
            for (const part of PARTS) {
                const schema = source?.lookup(`${SCHEMA}.${part.schema}`, true);
                if (!schema)
                    continue;
                const settings = new Gio.Settings({ settings_schema: schema });
                this._parts.set(part.name, settings);
                this._partIds.push([settings, settings.connect('changed::blur', () => {
                        this._override();
                        this._update();
                    })]);
            }
        }
        this._override();
        this._update();
    }

    // Turns Blur my Shell's blur off where it is overridden, and back on where
    // it no longer is (all of it with `restore`). What was turned off is noted
    // before each write, so the change signals this sets off see it done.
    _override(restore = false) {
        const s = this._settings;
        const active = Main.extensionManager.lookup(UUID)?.state === ACTIVE;
        const on = !restore && active && s.get_boolean('blur-my-shell-override');
        const chosen = s.get_strv('blur-my-shell-override-parts');
        for (const part of PARTS) {
            const bms = this._parts.get(part.name);
            if (!bms)
                continue;
            const overridden = s.get_strv('blur-my-shell-overridden');
            if (on && chosen.includes(part.name) && hasGlass(s, part.keys)) {
                if (!bms.get_boolean('blur'))
                    continue;
                if (!overridden.includes(part.name))
                    s.set_strv('blur-my-shell-overridden', [...overridden, part.name]);
                bms.set_boolean('blur', false);
            }
            else if (overridden.includes(part.name)) {
                s.set_strv('blur-my-shell-overridden', overridden.filter(name => name !== part.name));
                bms.set_boolean('blur', true);
            }
        }
    }

    _update() {
        const active = Main.extensionManager.lookup(UUID)?.state === ACTIVE;
        this._publish('enable-blur-my-shell', active);
        // Only where it blurs under glass: elsewhere it does not show through anything.
        for (const part of PARTS) {
            this._publish(part.conflict, active && (this._parts.get(part.name)?.get_boolean('blur') ?? false)
                && hasGlass(this._settings, part.keys));
        }
        const blurring = this._settings.get_boolean('blur-my-shell-popup-blur');
        if (blurring === this._blurring)
            return;
        this._blurring = blurring;
        if (blurring) {
            this._logger.warn('[Liquid Glass] Blur my Shell is blurring popups, which shows through the glass on menus, '
                + 'notifications and OSDs. Turn off Popups in Blur my Shell.');
        }
    }

    // Written only when it changes, so the preferences window is not told of every Blur my Shell change.
    _publish(key, value) {
        if (this._settings.get_boolean(key) !== value)
            this._settings.set_boolean(key, value);
    }

    _disconnectParts() {
        for (const [settings, id] of this._partIds)
            settings.disconnect(id);
        this._partIds = [];
    }

    _dropParts() {
        this._disconnectParts();
        this._parts.clear();
    }

    cleanup() {
        Main.extensionManager.disconnect(this._stateId);
        this._stateId = 0;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        // Before the blur is given back, which would override it again.
        this._disconnectParts();
        // Locking the screen turns Liquid Glass off as well, and on again after;
        // Blur my Shell is left as it is in between.
        if (!Main.sessionMode.isLocked)
            this._override(true);
        this._dropParts();
        this._path = null;
        for (const part of PARTS)
            this._publish(part.conflict, false);
    }
}
