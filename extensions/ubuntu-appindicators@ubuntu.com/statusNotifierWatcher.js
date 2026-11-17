


// modify it under the terms of the GNU General Public License

// of the License, or (at your option) any later version.




// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License



import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as AppIndicator from './appIndicator.js';
import * as IndicatorStatusIcon from './indicatorStatusIcon.js';
import * as Interfaces from './interfaces.js';
import * as PromiseUtils from './promiseUtils.js';
import * as Util from './util.js';
import * as DBusUtils from './dbusUtils.js';
import * as DBusMenu from './dbusMenu.js';

import {DBusProxy} from './dbusProxy.js';

Gio._promisify(Gio.Subprocess.prototype, 'wait_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_async');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish_utf8');



const KDE_PREFIX = 'org.kde';

export const WATCHER_BUS_NAME = `${KDE_PREFIX}.StatusNotifierWatcher`;
const WATCHER_OBJECT = '/StatusNotifierWatcher';

const DEFAULT_ITEM_OBJECT_PATH = '/StatusNotifierItem';




export class StatusNotifierWatcher {
    constructor(extension, watchDog) {
        this._watchDog = watchDog;
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(Interfaces.StatusNotifierWatcher, this);
        try {
            this._dbusImpl.export(Gio.DBus.session, WATCHER_OBJECT);
        } catch (e) {
            Util.Logger.warn(`Failed to export ${WATCHER_OBJECT}`);
            logError(e);
        }
        this._cancellable = new Gio.Cancellable();
        this._everAcquiredName = false;
        this._ownName = Gio.DBus.session.own_name(WATCHER_BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            this._acquiredName.bind(this),
            this._lostName.bind(this));
        this._items = new Map();

        try {
            this._dbusImpl.emit_signal('StatusNotifierHostRegistered', null);
        } catch (e) {
            Util.Logger.warn(`Failed to notify registered host ${WATCHER_OBJECT}`);
        }

        this._seekStatusNotifierItems(extension).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'Looking for StatusNotifierItem\'s');
        });
    }

    _acquiredName() {
        this._everAcquiredName = true;
        this._watchDog.nameAcquired = true;
    }

    _lostName() {
        if (this._everAcquiredName)
            Util.Logger.debug(`Lost name${WATCHER_BUS_NAME}`);
        else
            Util.Logger.warn(`Failed to acquire ${WATCHER_BUS_NAME}`);
        this._watchDog.nameAcquired = false;
    }

    async _registerItem(service, busName, objPath) {
        const id = Util.indicatorId(service, busName, objPath);

        if (this._items.has(id)) {
            Util.Logger.warn(`Item ${id} is already registered`);
            return;
        }

        Util.Logger.debug(`Registering StatusNotifierItem ${id}`);

        try {
            const indicator = new AppIndicator.AppIndicator(service, busName, objPath);
            const cancellable = this._cancellable;
            this._items.set(id, indicator);
            indicator.connect('destroy', () => this._onIndicatorDestroyed(indicator));

            indicator.connect('name-owner-changed', async () => {
                if (!indicator.hasNameOwner) {
                    try {
                        await new PromiseUtils.TimeoutPromise(500,
                            GLib.PRIORITY_DEFAULT, cancellable);
                        if (this._items.has(id) && !indicator.hasNameOwner)
                            indicator.destroy();
                    } catch (e) {
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            logError(e);
                    }
                }
            });


            await Util.waitForStartupCompletion(indicator.cancellable);
            const statusIcon = new IndicatorStatusIcon.IndicatorStatusIcon(indicator);
            IndicatorStatusIcon.addIconToPanel(statusIcon);

            this._dbusImpl.emit_signal('StatusNotifierItemRegistered',
                GLib.Variant.new('(s)', [indicator.uniqueId]));
            this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems',
                GLib.Variant.new('as', this.RegisteredStatusNotifierItems));
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
            throw e;
        }
    }

    async _ensureItemRegistered(service, busName, objPath) {
        const id = Util.indicatorId(service, busName, objPath);
        const item = this._items.get(id);

        if (item) {

            Util.Logger.debug(`Attempting to re-register ${id}; resetting instead`);
            item.reset();
            return;
        }

        await this._registerItem(service, busName, objPath);
    }

    async _seekStatusNotifierItems(extension) {







        const cancellable = this._cancellable;
        await new PromiseUtils.TimeoutSecondsPromise(2, GLib.PRIORITY_LOW, cancellable);
        const busAnalyzer = GLib.build_filenamev([
            extension.path, 'tools', 'busAnalyzer.js',
        ]);

        const subProcess = Gio.Subprocess.new(['gjs', '-m', busAnalyzer],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

        const stdOut = subProcess.get_stdout_pipe();
        const dataInputStream = new Gio.DataInputStream({base_stream: stdOut});
        const textDecoder = new TextDecoder();

        while (true) {
            // eslint-disable-next-line no-await-in-loop
            const [line] = await dataInputStream.read_line_async(GLib.PRIORITY_DEFAULT,
                cancellable);
            if (!line)
                break;

            try {
                const {services, name, path} = JSON.parse(textDecoder.decode(line));
                const ids = [null, ...services].map(s => Util.indicatorId(s, name, path));

                if (ids.every(id => !this._items.has(id))) {
                    const service = services.find(s =>
                        s?.startsWith('org.kde.StatusNotifierItem')) ?? services[0];
                    const id = Util.indicatorId(
                        path === DEFAULT_ITEM_OBJECT_PATH ? service : null,
                        name, path);
                    Util.Logger.warn(`Using Brute-force mode for StatusNotifierItem ${id}`);
                    // eslint-disable-next-line no-await-in-loop
                    await this._registerItem(service, name, path);
                }
            } catch (e) {
                logError(e);
            }
        }

        const [, stdErr] = await subProcess.communicate_async(null, cancellable);
        await subProcess.wait_async(cancellable);

        if (subProcess.get_exit_status() !== 0) {
            const errorLines = textDecoder.decode(stdErr.toArray()).split('\n');
            const error = new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED,
                errorLines[0]);
            error.stack = `${errorLines.slice(3).join('\n')}${error.stack}`;
            throw error;
        }
    }

    async RegisterStatusNotifierItemAsync(params, invocation) {



        const [service] = params;
        let busName, objPath;

        if (service.charAt(0) === '/') {
            busName = invocation.get_sender();
            objPath = service;
        } else if (service.match(DBusUtils.BUS_ADDRESS_REGEX)) {
            try {
                busName = await DBusUtils.getUniqueBusName(invocation.get_connection(),
                    service, this._cancellable);
            } catch (e) {
                logError(e);
            }
            objPath = DEFAULT_ITEM_OBJECT_PATH;
        }

        if (!busName || !objPath) {
            const error = `Impossible to register an indicator for parameters '${
                service.toString()}'`;
            Util.Logger.warn(error);

            invocation.return_dbus_error('org.gnome.gjs.JSError.ValueError',
                error);
            return;
        }

        try {
            await this._ensureItemRegistered(service, busName, objPath);
            invocation.return_value(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
            invocation.return_dbus_error('org.gnome.gjs.JSError.ValueError',
                e.message);
        }
    }

    _onIndicatorDestroyed(indicator) {
        const {uniqueId} = indicator;
        this._items.delete(uniqueId);

        try {
            this._dbusImpl.emit_signal('StatusNotifierItemUnregistered',
                GLib.Variant.new('(s)', [uniqueId]));
            this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems',
                GLib.Variant.new('as', this.RegisteredStatusNotifierItems));
        } catch (e) {
            Util.Logger.warn(`Failed to emit signals: ${e}`);
        }
    }

    RegisterStatusNotifierHostAsync(_service, invocation) {
        invocation.return_error_literal(
            Gio.DBusError,
            Gio.DBusError.NOT_SUPPORTED,
            'Registering additional notification hosts is not supported');
    }

    IsNotificationHostRegistered() {
        return true;
    }

    get RegisteredStatusNotifierItems() {
        return Array.from(this._items.values()).map(i => i.uniqueId);
    }

    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return 0;
    }

    destroy() {
        if (this._isDestroyed)
            return;




        this._items.forEach(indicator => indicator.destroy());
        this._cancellable.cancel();

        try {
            this._dbusImpl.emit_signal('StatusNotifierHostUnregistered', null);
        } catch (e) {
            Util.Logger.warn(`Failed to emit uinregistered signal: ${e}`);
        }

        Gio.DBus.session.unown_name(this._ownName);

        try {
            this._dbusImpl.unexport();
        } catch (e) {
            Util.Logger.warn(`Failed to unexport watcher object: ${e}`);
        }

        DBusMenu.DBusClient.destroy();
        AppIndicator.AppIndicatorProxy.destroy();
        DBusProxy.destroy();
        Util.destroyDefaultTheme();

        this._dbusImpl.run_dispose();
        delete this._dbusImpl;

        delete this._items;
        this._isDestroyed = true;
    }
}
