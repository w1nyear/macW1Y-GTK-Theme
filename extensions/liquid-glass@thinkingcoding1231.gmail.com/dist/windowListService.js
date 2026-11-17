







import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
export const WINDOW_LIST_OBJECT_PATH = '/org/gnome/Shell/Extensions/LiquidGlass';
export const WINDOW_LIST_INTERFACE_NAME = 'org.gnome.Shell.Extensions.LiquidGlass';


const WINDOW_LIST_IFACE = `
<node>
  <interface name="${WINDOW_LIST_INTERFACE_NAME}">
    <method name="ListWindows">
      <arg type="s" direction="out" name="windows"/>
    </method>
    <signal name="WindowsChanged"/>
  </interface>
</node>`;
export class WindowListService {
    _logger;
    _dbusImpl = null;
    _displaySignals = [];


    _windowSignals = new Map();
    _emitIdleId = 0;
    constructor(logger) {
        this._logger = logger;
    }
    setup() {
        try {
            this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(WINDOW_LIST_IFACE, this);
            this._dbusImpl.export(Gio.DBus.session, WINDOW_LIST_OBJECT_PATH);
        }
        catch (e) {
            this._logger.log('[Liquid Glass] Failed to export the window list service: ' + e);
            this._dbusImpl = null;
            return;
        }
        const connectDisplay = (signal, callback) => {
            try {
                this._displaySignals.push({ obj: global.display, id: global.display.connect(signal, callback) });
            }
            catch (e) {   }
        };
        connectDisplay('window-created', (_display, metaWindow) => {
            this._trackWindow(metaWindow);
            this._queueChanged();
        });
        connectDisplay('restacked', () => this._queueChanged());
        for (const metaWindow of this._listMetaWindows())
            this._trackWindow(metaWindow);
        this._logger.log('[Liquid Glass] WindowListService exported at ' + WINDOW_LIST_OBJECT_PATH);
    }
    cleanup() {
        if (this._emitIdleId) {
            GLib.Source.remove(this._emitIdleId);
            this._emitIdleId = 0;
        }
        for (const sig of this._displaySignals) {
            try {
                sig.obj.disconnect(sig.id);
            }
            catch (e) { }
        }
        this._displaySignals = [];
        for (const [metaWindow, ids] of this._windowSignals) {
            for (const id of ids) {
                try {
                    metaWindow.disconnect(id);
                }
                catch (e) { }
            }
        }
        this._windowSignals.clear();
        if (this._dbusImpl) {
            try {
                this._dbusImpl.unexport();
            }
            catch (e) { }
            this._dbusImpl = null;
        }
    }

    ListWindows() {
        try {
            return JSON.stringify(this._collectWindows());
        }
        catch (e) {
            this._logger.log('[Liquid Glass] ListWindows failed: ' + e);
            return '[]';
        }
    }

    _trackWindow(metaWindow) {
        if (!metaWindow || this._windowSignals.has(metaWindow))
            return;
        const ids = [];
        for (const signal of ['notify::wm-class', 'notify::title', 'notify::window-type']) {
            try {
                ids.push(metaWindow.connect(signal, () => this._queueChanged()));
            }
            catch (e) {   }
        }
        try {
            ids.push(metaWindow.connect('unmanaged', () => {
                this._untrackWindow(metaWindow);
                this._queueChanged();
            }));
        }
        catch (e) { }
        this._windowSignals.set(metaWindow, ids);
    }
    _untrackWindow(metaWindow) {
        const ids = this._windowSignals.get(metaWindow);
        if (!ids)
            return;
        for (const id of ids) {
            try {
                metaWindow.disconnect(id);
            }
            catch (e) { }
        }
        this._windowSignals.delete(metaWindow);
    }
    _listMetaWindows() {
        try {
            return global.display.list_all_windows() ?? [];
        }
        catch (e) {
            this._logger.log('[Liquid Glass] list_all_windows() failed: ' + e);
            return [];
        }
    }


    _collectWindows() {

        let tracker = undefined;
        const getTracker = () => {
            if (tracker === undefined) {
                try {
                    tracker = Shell.WindowTracker.get_default();
                }
                catch (e) {
                    tracker = null;
                }
            }
            return tracker;
        };
        const byClass = new Map();
        for (const metaWindow of this._listMetaWindows()) {
            let wmClass = '';
            let windowType = null;
            let title = '';
            try {
                wmClass = metaWindow.get_wm_class() ?? '';
                windowType = metaWindow.get_window_type();
                title = metaWindow.get_title() ?? '';
            }
            catch (e) {
                continue;
            }
            if (!wmClass)
                continue;


            if (windowType === Meta.WindowType.DESKTOP ||
                windowType === Meta.WindowType.DOCK ||
                windowType === Meta.WindowType.SPLASHSCREEN)
                continue;
            const isNormal = windowType === Meta.WindowType.NORMAL ||
                windowType === Meta.WindowType.DIALOG ||
                windowType === Meta.WindowType.MODAL_DIALOG;
            let entry = byClass.get(wmClass);
            if (!entry) {
                entry = { wmClass, appName: '', iconName: '', titles: [], count: 0, normal: false };
                byClass.set(wmClass, entry);
            }
            entry.count += 1;
            entry.normal = entry.normal || isNormal;
            if (title && entry.titles.length < 8 && !entry.titles.includes(title))
                entry.titles.push(title);
            const trackerRef = entry.appName ? null : getTracker();
            if (trackerRef) {
                try {
                    const app = trackerRef.get_window_app(metaWindow);
                    if (app) {
                        entry.appName = app.get_name() ?? '';
                        const appInfo = app.get_app_info();
                        const icon = appInfo?.get_icon();


                        if (icon)
                            entry.iconName = icon.to_string() ?? '';
                    }
                }
                catch (e) {   }
            }
        }
        const entries = [...byClass.values()];
        entries.sort((a, b) => (a.appName || a.wmClass).toLowerCase()
            .localeCompare((b.appName || b.wmClass).toLowerCase()));
        return entries;
    }


    _queueChanged() {
        if (this._emitIdleId)
            return;
        this._emitIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._emitIdleId = 0;
            if (this._dbusImpl) {
                try {
                    this._dbusImpl.emit_signal('WindowsChanged', null);
                }
                catch (e) {
                    this._logger.log('[Liquid Glass] Failed to emit WindowsChanged: ' + e);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
    }
}
