

import {GLib, Gio} from './dependencies/gi.js';
const {signals: Signals} = imports;

import {Utils} from './imports.js';

const FileManager1Iface = '<node><interface name="org.freedesktop.FileManager1">\
                               <property name="OpenWindowsWithLocations" type="a{sas}" access="read"/>\
                           </interface></node>';

const FileManager1Proxy = Gio.DBusProxy.makeProxyWrapper(FileManager1Iface);

const Labels = Object.freeze({
    WINDOWS: Symbol('windows'),
});









export class FileManager1Client {
    constructor() {
        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._cancellable = new Gio.Cancellable();

        this._windowsByPath = new Map();
        this._windowsByLocation = new Map();
        this._proxy = new FileManager1Proxy(Gio.DBus.session,
            'org.freedesktop.FileManager1',
            '/org/freedesktop/FileManager1',
            (initable, error) => {

                if (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        global.log(error);
                } else {
                    this._updateWindows();
                    this._updateLocationMap();
                }
            }, this._cancellable);

        this._signalsHandler.add([
            this._proxy,
            'g-properties-changed',
            this._onPropertyChanged.bind(this),
        ], [


            global.workspaceManager,
            'workspace-added',
            () => this._onWindowsChanged(),
        ], [
            global.workspaceManager,
            'workspace-removed',
            () => this._onWindowsChanged(),
        ], [
            global.display,
            'window-entered-monitor',
            () => this._onWindowsChanged(),
        ], [
            global.display,
            'window-left-monitor',
            () => this._onWindowsChanged(),
        ]);
    }

    destroy() {
        if (this._windowsUpdateIdle) {
            GLib.source_remove(this._windowsUpdateIdle);
            delete this._windowsUpdateIdle;
        }
        this._cancellable.cancel();
        this._signalsHandler.destroy();
        this._windowsByLocation.clear();
        this._windowsByPath.clear();
        this._proxy = null;
    }







    getWindows(location) {
        if (!location)
            return [];

        location += location.endsWith('/') ? '' : '/';
        const windows = [];
        this._windowsByLocation.forEach((wins, l) => {
            if (l.startsWith(location))
                windows.push(...wins);
        });
        return [...new Set(windows)];
    }

    _onPropertyChanged(proxy, changed, _invalidated) {
        const property = changed.unpack();
        if (property &&
            ('OpenWindowsWithLocations' in property))
            this._updateLocationMap();
    }

    _updateWindows() {
        const oldSize = this._windowsByPath.size;
        const oldPaths = this._windowsByPath.keys();
        this._windowsByPath = Utils.getWindowsByObjectPath();

        if (oldSize !== this._windowsByPath.size)
            return true;

        return [...oldPaths].some(path => !this._windowsByPath.has(path));
    }

    _onWindowsChanged() {
        if (this._windowsUpdateIdle)
            return;

        this._windowsUpdateIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._updateWindows())
                this._updateLocationMap();

            delete this._windowsUpdateIdle;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateLocationMap() {
        const properties = this._proxy.get_cached_property_names();
        if (!properties) {

            return;
        }

        if (properties.includes('OpenWindowsWithLocations'))
            this._updateFromPaths();
    }

    _locationMapsEquals(mapA, mapB) {
        if (mapA.size !== mapB.size)
            return false;

        const setsEquals = (a, b) => a.size === b.size &&
            [...a].every(value => b.has(value));

        for (const [key, val] of mapA) {
            const windowsSet = mapB.get(key);
            if (!windowsSet || !setsEquals(windowsSet, val))
                return false;
        }
        return true;
    }

    _updateFromPaths() {
        const locationsByWindowsPath = this._proxy.OpenWindowsWithLocations;

        const windowsByLocation = new Map();
        this._signalsHandler.removeWithLabel(Labels.WINDOWS);

        Object.entries(locationsByWindowsPath).forEach(([windowPath, locations]) => {
            locations.forEach(location => {
                const win = this._windowsByPath.get(windowPath);
                const windowGroup = win ? [win] : [];

                win?.foreach_transient(w => windowGroup.push(w) || true);

                windowGroup.forEach(window => {
                    location += location.endsWith('/') ? '' : '/';


                    const windows = windowsByLocation.get(location) || new Set();
                    windows.add(window);

                    if (windows.size === 1)
                        windowsByLocation.set(location, windows);

                    this._signalsHandler.addWithLabel(Labels.WINDOWS, window,
                        'unmanaged', () => {
                            const wins = this._windowsByLocation.get(location);
                            wins.delete(window);
                            if (!wins.size)
                                this._windowsByLocation.delete(location);
                            this.emit('windows-changed');
                        });
                });
            });
        });

        if (!this._locationMapsEquals(this._windowsByLocation, windowsByLocation)) {
            this._windowsByLocation = windowsByLocation;
            this.emit('windows-changed');
        }
    }
}
Signals.addSignalMethods(FileManager1Client.prototype);
