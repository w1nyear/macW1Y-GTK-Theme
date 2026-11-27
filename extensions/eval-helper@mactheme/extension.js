import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Mtk from 'gi://Mtk';
import Graphene from 'gi://Graphene';
import GObject from 'gi://GObject';
import cairo from 'cairo';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MacSetupWizard from './macSetupWizard.js';
import * as MacScreenshotUI from './macScreenshotUI.js';
import { t } from './mac_i18n.js';
import { MacAnimationCache } from './macAnimationCache.js';

let Blur = null;
try {
    Blur = (await import('gi://Blur')).default;
} catch (_) {}

const EvalIface = `
<node>
  <interface name="org.gnome.Shell.Extensions.EvalHelper">
    <method name="Eval">
      <arg type="s" direction="in" name="code"/>
      <arg type="s" direction="out" name="result"/>
    </method>
    <method name="ShowEmptyTrashDialog">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="SyncAlertStyling">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="SyncNotificationStyling">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="SyncLabelStyling">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="SyncSpotlightStyling">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="SyncDockStyling">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="SyncAltTabStyling">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="SyncScreenshotStyling">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="GetAnimationDiagnostics">
      <arg type="s" direction="out" name="json_diagnostics"/>
    </method>
    <method name="PrewarmAnimations">
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="ShowSetupWizard">
      <arg type="b" direction="in" name="force"/>
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="GetSetupWizardStatus">
      <arg type="s" direction="out" name="status"/>
    </method>
    <method name="ResetSetupWizard">
      <arg type="b" direction="out" name="success"/>
    </method>
  </interface>
</node>`;

const ACCENT_COLOR_MAP = {
    'blue':   '#007aff',
    'teal':   '#30b0c7',
    'green':  '#34c759',
    'yellow': '#ffcc00',
    'orange': '#ff6a00',
    'red':    '#ff3b30',
    'pink':   '#ff2d55',
    'purple': '#af52de',
    'slate':  '#8e8e93',
    'brown':  '#a27447',
};

function getSystemAccentColor() {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#ff6a00';
    } catch (_) {
        return '#ff6a00';
    }
}

class OverviewWallpaperManager {
    constructor() {
        this._bgManagers = [];
        this._bgGroup = null;
        this._build();

        Main.layoutManager.connectObject(
            'monitors-changed', () => this._build(),
            this
        );

        Main.overview.connectObject(
            'showing', () => {
                if (this._bgGroup && this._bgGroup.get_parent() === Main.layoutManager.overviewGroup) {
                    Main.layoutManager.overviewGroup.set_child_below_sibling(this._bgGroup, null);
                }
            },
            this
        );
    }

    _build() {
        for (const mgr of this._bgManagers) {
            try { mgr.destroy(); } catch (_) {}
        }
        this._bgManagers = [];

        if (this._bgGroup) {
            try { this._bgGroup.destroy(); } catch (_) {}
            this._bgGroup = null;
        }

        if (!Main.layoutManager?.overviewGroup) return;

        this._bgGroup = new Meta.BackgroundGroup({ name: 'mac-overview-wallpaper-group', reactive: false });
        Main.layoutManager.overviewGroup.insert_child_at_index(this._bgGroup, 0);

        for (const monitor of (Main.layoutManager.monitors || [])) {
            const monBin = new Clutter.Actor({
                name: 'mac-overview-monitor-bin',
                reactive: false,
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
            });
            this._bgGroup.add_child(monBin);

            try {

                const bmsExt = Main.extensionManager?.lookup('blur-my-shell@aunetx');
                const bmsHasOverviewBlur = bmsExt && bmsExt.stateObj?._overview_blur?.enabled;
                if (!bmsHasOverviewBlur) {
                    const blurEffect = new Shell.BlurEffect({
                        brightness: 0.85,
                        radius: 30,
                        mode: Shell.BlurMode.ACTOR,
                    });
                    monBin.add_effect(blurEffect);
                }
            } catch (_) {}

            const bgMgr = new Background.BackgroundManager({
                container: monBin,
                monitorIndex: monitor.index,
                controlPosition: false,
            });
            this._bgManagers.push(bgMgr);
        }
    }

    destroy() {
        try { Main.layoutManager.disconnectObject(this); } catch (_) {}
        try { Main.overview.disconnectObject(this); } catch (_) {}
        try { Main.layoutManager.overviewGroup.disconnectObject(this); } catch (_) {}

        for (const mgr of this._bgManagers) {
            try { mgr.destroy(); } catch (_) {}
        }
        this._bgManagers = [];

        if (this._bgGroup) {
            try { this._bgGroup.destroy(); } catch (_) {}
            this._bgGroup = null;
        }
    }
}

class MacMenuHoverGlide {
    constructor(menu) {
        this._menu = menu;
        this._pill = null;
        this._itemSignals = [];
        this._hideTimeoutId = 0;
        this._activeItem = null;

        if (!menu || !menu.box) return;
        this._setup();
    }

    _setup() {
        if (!this._menuOpenSignalId) {
            this._menuOpenSignalId = this._menu.connectObject('open-state-changed', (_m, open) => {
                if (open) {
                    this._ensurePill();
                    this._updateItems();
                    const activeChild = this._findActiveChild();
                    if (activeChild) {
                        this._glideTo(activeChild);
                    }
                } else {
                    this._hidePill(true);
                }
            }, this);
        }

        if (this._menu.box) {
            this._menu.box.add_style_class_name('mac-menu-hover-glide-active');
            this._menu.box.connectObject(
                'child-added', () => this._updateItems(),
                'child-removed', () => this._updateItems(),
                this
            );
        }

        if (this._menu.isOpen) {
            this._ensurePill();
            this._updateItems();
            const activeChild = this._findActiveChild();
            if (activeChild) {
                this._glideTo(activeChild);
            }
        }
    }

    _findActiveChild() {
        if (!this._menu?.box) return null;
        for (const child of this._menu.box.get_children()) {
            if (this._isItemEligible(child) && (child.hover || child.active)) {
                return child;
            }
        }
        return null;
    }

    _ensurePill() {
        const accent = getSystemAccentColor();
        if (this._pill && this._pill.get_parent()) {
            this._pill.style = `background-color: ${accent} !important; border-radius: 9999px !important; box-shadow: none !important;`;
            return;
        }
        const box = this._menu.box;
        const parent = box ? box.get_parent() : null;
        if (!parent) return;


        for (const c of parent.get_children()) {
            if (c !== this._pill && c.name === 'mac-menu-hover-pill') {
                try { c.destroy(); } catch (_) {}
            }
        }

        this._pill = new St.Widget({
            name: 'mac-menu-hover-pill',
            style_class: 'mac-menu-hover-pill',
            style: `background-color: ${accent} !important; border-radius: 9999px !important; box-shadow: none !important;`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: false,
            y_expand: false,
            opacity: 0,
            reactive: false,
        });

        try {
            parent.insert_child_below(this._pill, box);
        } catch (_e) {
            try { parent.add_child(this._pill); } catch (_e2) {}
        }
    }

    _isItemEligible(child) {
        if (!child || !child.visible) return false;
        if (!child.reactive) return false;
        if (child.sensitive === false) return false;
        if (child.has_style_class_name) {
            if (child.has_style_class_name('popup-separator-menu-item') ||
                child.has_style_class_name('appmenu-separator-menu-item') ||
                child.has_style_class_name('popup-inactive-menu-item') ||
                child.has_style_class_name('popup-sub-menu') ||
                child.has_style_class_name('mac-menu-section-label') ||
                child.has_style_class_name('mac-menu-hover-pill')) {
                return false;
            }
        }
        return true;
    }

    _updateItems() {
        this._cleanupItemSignals();
        const box = this._menu.box;
        if (!box) return;

        const children = box.get_children();
        for (const child of children) {
            if (!this._isItemEligible(child)) continue;

            if (child.menu && !child.menu._macHoverTracker && child.menu.box) {
                child.menu._macHoverTracker = new MacMenuHoverGlide(child.menu);
            }

            const hoverId = child.connect('notify::hover', () => this._onItemState(child));
            const activeId = child.connect('notify::active', () => this._onItemState(child));
            this._itemSignals.push({ actor: child, id: hoverId });
            this._itemSignals.push({ actor: child, id: activeId });
        }
    }

    _onItemState(child) {
        if (child.hover || child.active) {
            if (this._hideTimeoutId) {
                GLib.source_remove(this._hideTimeoutId);
                this._hideTimeoutId = 0;
            }
            this._glideTo(child);
        } else {
            if (!this._hideTimeoutId) {
                this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                    this._hideTimeoutId = 0;
                    const anyActive = this._findActiveChild();
                    if (!anyActive) {
                        this._hidePill(false);
                    } else if (anyActive !== this._activeItem) {
                        this._glideTo(anyActive);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _glideTo(child) {
        if (!this._isItemEligible(child) || !child.get_stage()) return;
        this._ensurePill();
        if (!this._pill) return;
        const parent = this._menu.box?.get_parent();
        if (!parent || !parent.get_stage()) return;

        try {
            const [px, py] = parent.get_transformed_position();
            const [cx, cy] = child.get_transformed_position();
            if (isNaN(cx) || isNaN(cy) || isNaN(px) || isNaN(py)) return;

            const ab = child.get_allocation_box ? child.get_allocation_box() : null;
            let w = (ab && ab.x2 > ab.x1) ? (ab.x2 - ab.x1) : child.width;
            let h = (ab && ab.y2 > ab.y1) ? (ab.y2 - ab.y1) : child.height;
            if (w <= 0 || h <= 0) return;


            const pillAb = this._pill.get_allocation_box ? this._pill.get_allocation_box() : null;
            const originX = (pillAb && pillAb.x2 >= pillAb.x1) ? pillAb.x1 : 0;
            const originY = (pillAb && pillAb.y2 >= pillAb.y1) ? pillAb.y1 : 0;

            const tx = (cx - px) - originX;
            const ty = (cy - py) - originY;

            this._activeItem = child;
            this._pill.remove_all_transitions();
            const accent = getSystemAccentColor();
            this._pill.style = `background-color: ${accent} !important; border-radius: 9999px !important; box-shadow: none !important;`;

            if (this._pill.opacity === 0) {
                this._pill.translation_x = tx;
                this._pill.translation_y = ty;
                this._pill.width = w;
                this._pill.height = h;
                this._pill.scale_x = 0.95;
                this._pill.scale_y = 0.95;
                this._pill.ease({
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 100,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                this._pill.ease({
                    translation_x: tx,
                    translation_y: ty,
                    width: w,
                    height: h,
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 130,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        } catch (_e) {}
    }

    _hidePill(immediate = false) {
        this._activeItem = null;
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (!this._pill) return;
        this._pill.remove_all_transitions();
        if (immediate) {
            this._pill.opacity = 0;
        } else {
            this._pill.ease({
                opacity: 0,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _cleanupItemSignals() {
        for (const s of this._itemSignals) {
            try { s.actor.disconnect(s.id); } catch (_) {}
        }
        this._itemSignals = [];
    }

    destroy() {
        this._cleanupItemSignals();
        if (this._hideTimeoutId) {
            try { GLib.source_remove(this._hideTimeoutId); } catch (_) {}
            this._hideTimeoutId = 0;
        }
        if (this._pill) {
            try { this._pill.destroy(); } catch (_) {}
            this._pill = null;
        }
        try {
            if (this._menu) {
                delete this._menu._macHoverTracker;
                delete this._menu._hasHoverTracker;
                if (this._menu.box) {
                    this._menu.box.remove_style_class_name('mac-menu-hover-glide-active');
                    this._menu.box.disconnectObject(this);
                }
            }
        } catch (_) {}
        try { this._menu?.disconnectObject(this); } catch (_) {}
    }
}

export default class EvalHelper extends Extension {
    enable() {
        try {
            let uid = null;
            try { uid = new Gio.Credentials().get_unix_user(); } catch (_) {}
            if (uid === null || uid === undefined)
                uid = (GLib.get_user_name() || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
            const [okB, bytesB] = GLib.file_get_contents('/proc/sys/kernel/random/boot_id');
            const bootId = (okB && bytesB) ? (new TextDecoder().decode(bytesB).trim() || 'boot') : 'boot';
            const path = `/dev/shm/.macw1y_session_${uid}`;
            GLib.file_set_contents(path, `${bootId}\n`);
            Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', 0o644, Gio.FileQueryInfoFlags.NONE, null);
        } catch (_) {}
        globalThis.Clutter = Clutter;
        globalThis.Gio = Gio;
        globalThis.GLib = GLib;
        globalThis.Meta = Meta;
        globalThis.Main = Main;
        globalThis.Mtk = Mtk;
        globalThis.Shell = Shell;
        globalThis.Pango = Pango;
        globalThis.St = St;
        globalThis.MacAnimationCache = MacAnimationCache;
        try {
            const nodeInfo = Gio.DBusNodeInfo.new_for_xml(EvalIface);
            this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(nodeInfo.interfaces[0], {
                Eval: async (code) => {
                    try {
                        let res = eval(code);
                        if (res && typeof res.then === 'function')
                            res = await res;
                        return JSON.stringify(res !== undefined ? res : null) ?? 'null';
                    } catch (e) {
                        return `ERROR: ${e?.name}: ${e?.message}\n${e?.stack || e}`;
                    }
                },
                ShowEmptyTrashDialog: () => {
                    try {
                        if (typeof globalThis.showMacEmptyTrashDialog === 'function') {
                            globalThis.showMacEmptyTrashDialog();
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] ShowEmptyTrashDialog error: ${e}`);
                        return false;
                    }
                },
                SyncAlertStyling: () => {
                    try {
                        if (typeof globalThis._macSyncDialogAlertStyling === 'function') {
                            globalThis._macSyncDialogAlertStyling();
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] SyncAlertStyling error: ${e}`);
                        return false;
                    }
                },
                SyncNotificationStyling: () => {
                    try {
                        if (typeof globalThis._macSyncNotificationStyling === 'function') {
                            globalThis._macSyncNotificationStyling();
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] SyncNotificationStyling error: ${e}`);
                        return false;
                    }
                },
                SyncLabelStyling: () => {
                    try {
                        if (typeof globalThis._macSyncLabelStyling === 'function') {
                            globalThis._macSyncLabelStyling();
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] SyncLabelStyling error: ${e}`);
                        return false;
                    }
                },
                SyncSpotlightStyling: () => {
                    try {
                        if (typeof globalThis._macSyncSpotlightStyling === 'function') {
                            globalThis._macSyncSpotlightStyling();
                            return true;
                        }
                        const dlg = globalThis._macSpotlightGlobalInstance;
                        if (dlg) {
                            dlg._lastGeometryKey = null;
                            if (typeof dlg._applyGlassUniforms === 'function') {
                                dlg._applyGlassUniforms();
                            }
                            if (typeof dlg._syncGlass === 'function') {
                                dlg._syncGlass();
                            }
                            if (dlg._glass && typeof dlg._glass.forceRefresh === 'function') {
                                dlg._glass.forceRefresh(1);
                            }
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] SyncSpotlightStyling error: ${e}`);
                        return false;
                    }
                },
                SyncDockStyling: () => {
                    try {
                        if (typeof globalThis._macSyncDockStyling === 'function') {
                            globalThis._macSyncDockStyling();
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] SyncDockStyling error: ${e}`);
                        return false;
                    }
                },
                SyncAltTabStyling: () => {
                    try {
                        if (typeof globalThis._macSyncAltTabStyling === 'function') {
                            globalThis._macSyncAltTabStyling();
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] SyncAltTabStyling error: ${e}`);
                        return false;
                    }
                },
                SyncScreenshotStyling: () => {
                    try {
                        if (typeof globalThis._macSyncScreenshotStyling === 'function') {
                            globalThis._macSyncScreenshotStyling();
                            return true;
                        }
                        return false;
                    } catch (e) {
                        console.error(`[EvalHelper] SyncScreenshotStyling error: ${e}`);
                        return false;
                    }
                },
                GetAnimationDiagnostics: () => {
                    try {
                        const diag = MacAnimationCache.getDiagnostics();
                        return JSON.stringify(diag);
                    } catch (e) {
                        return JSON.stringify({ error: String(e) });
                    }
                },
                PrewarmAnimations: () => {
                    try {
                        MacAnimationCache.prewarmAll();
                        return true;
                    } catch (e) {
                        console.error(`[EvalHelper] PrewarmAnimations error: ${e}`);
                        return false;
                    }
                },
                ShowSetupWizard: (force) => {
                    try {
                        return MacSetupWizard.startSetupWizard(force);
                    } catch (e) {
                        console.error(`[EvalHelper] ShowSetupWizard error: ${e}`);
                        return false;
                    }
                },
                GetSetupWizardStatus: () => {
                    try {
                        return JSON.stringify({
                            active: !!globalThis.macSetupWizardActive,
                            flag: MacSetupWizard.getSetupWizardFlag(),
                            version: MacSetupWizard.getModpackVersion(),
                            hasTouchpad: MacSetupWizard.hasTouchpadGestures()
                        });
                    } catch (e) {
                        return JSON.stringify({ error: String(e) });
                    }
                },
                ResetSetupWizard: () => {
                    try {
                        MacSetupWizard.setSetupWizardFlag(true);
                        return true;
                    } catch (e) {
                        console.error(`[EvalHelper] ResetSetupWizard error: ${e}`);
                        return false;
                    }
                },
            });
            this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/EvalHelper');
        } catch (e) {
            console.error(`[EvalHelper] DBus export error: ${e}`);
        }

        try {
            const updateFocusPid = () => {
                const w = global.display?.focus_window;
                const pid = w?.get_pid?.() ?? 0;
                try {
                    GLib.file_set_contents('/dev/shm/mac_focused_pid', String(pid));
                } catch (_) {}
            };
            this._focusSignalId = global.display?.connect('notify::focus-window', updateFocusPid);
            updateFocusPid();
        } catch (e) {
            console.error(`[EvalHelper] Focus tracking error: ${e}`);
        }

        // Global helpers for setup wizard
        globalThis.startMacSetupWizard = (force = false) => MacSetupWizard.startSetupWizard(force);
        globalThis.stopMacSetupWizard = () => MacSetupWizard.stopSetupWizard();
        globalThis.getMacSetupWizardStatus = () => ({
            active: !!globalThis.macSetupWizardActive,
            flag: MacSetupWizard.getSetupWizardFlag(),
            version: MacSetupWizard.getModpackVersion(),
            hasTouchpad: MacSetupWizard.hasTouchpadGestures()
        });


        if (MacSetupWizard.getSetupWizardFlag()) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                MacSetupWizard.startSetupWizard(false);
                return GLib.SOURCE_REMOVE;
            });
        }


        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            try { MacAnimationCache.prewarmAll(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });


        try {
            this._shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            if (this._shellSettings.get_boolean('disable-user-extensions')) {
                this._shellSettings.set_boolean('disable-user-extensions', false);
            }
            this._disableExtSignalId = this._shellSettings.connect('changed::disable-user-extensions', () => {
                if (this._shellSettings.get_boolean('disable-user-extensions')) {
                    this._shellSettings.set_boolean('disable-user-extensions', false);
                }
            });
        } catch (_) {}

        try {
            this._userThemeSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.user-theme' });
            let curTheme = this._userThemeSettings.get_string('name');
            if (!curTheme) {
                this._userThemeSettings.set_string('name', 'macW1Y-Dark-solid');
            }
            this._userThemeSignalId = this._userThemeSettings.connect('changed::name', () => {
                let name = this._userThemeSettings.get_string('name');
                if (!name) {
                    this._userThemeSettings.set_string('name', 'macW1Y-Dark-solid');
                }
            });
        } catch (_) {}


        try {
            const patchWackFade = () => {
                const wack = Main.extensionManager?.lookup('wack-lockscreen-clock@rinzler69-wastaken.github.com')?.stateObj;
                if (wack) {
                    const proto = Object.getPrototypeOf(wack);
                    if (proto && !proto._macFadePatched) {
                        proto._macFadePatched = true;
                        proto._syncCupertinoUnlockFade = function() {
                            if (!this._settings) return;
                            const isPowerSaver = this._powerProfilesProxy?.ActiveProfile === 'power-saver';
                            this._cupertinoUnlockFade = this._settings.get_string('lockscreen-mode') === 'cupertino' &&
                                this._settings.get_boolean('cupertino-unlock-fade') &&
                                !isPowerSaver;
                        };
                    }
                    wack._syncCupertinoUnlockFade();
                }
            };
            patchWackFade();
            this._wackExtStateSignalId = Main.extensionManager?.connect('extension-state-changed', (_mgr, ext) => {
                if (ext.uuid === 'wack-lockscreen-clock@rinzler69-wastaken.github.com' && ext.state === 1) {
                    patchWackFade();
                }
            });
        } catch (_) {}


        const isScreenshotShutterSoundEnabled = () => {
            try {
                const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'screenshot.json']);
                if (GLib.file_test(confPath, GLib.FileTest.EXISTS)) {
                    const [ok, data] = GLib.file_get_contents(confPath);
                    if (ok) {
                        const text = (data instanceof Uint8Array) ? new TextDecoder().decode(data) : data.toString();
                        const json = JSON.parse(text);
                        if (json.shutter_sound !== undefined)
                            return Boolean(json.shutter_sound);
                    }
                }
            } catch (_) {}
            return true;
        };

        try {
            // GNOME Shell's screenshot.js already plays 'screen-capture' on capture;
            // honor screenshot.json's shutter_sound setting without spawning a second player.
            if (Meta.SoundPlayer?.prototype?.play_from_theme && !this._origSoundPlayerPlayFromTheme) {
                const origPlayFromTheme = Meta.SoundPlayer.prototype.play_from_theme;
                this._origSoundPlayerPlayFromTheme = origPlayFromTheme;
                Meta.SoundPlayer.prototype.play_from_theme = function (name, ...args) {
                    if ((name === 'screen-capture' || name === 'camera-shutter') && !isScreenshotShutterSoundEnabled())
                        return;
                    return origPlayFromTheme.call(this, name, ...args);
                };
            }
        } catch (_) {}

        try {
            if (Main.screenshotUI) {
                MacScreenshotUI.installMacScreenshotUI(this.dir);
                this._screenshotTakenSignalId = Main.screenshotUI.connect('screenshot-taken', (_ui, file) => {
                    try {
                        const ctrl = MacScreenshotUI.getMacScreenshotController();
                        const finalPath = ctrl ? ctrl.handleCapturedScreenshot(file) : (file?.get_path ? file.get_path() : null);
                        if (finalPath) {
                            const quoted = GLib.shell_quote(finalPath);
                            GLib.spawn_command_line_async(`/usr/local/bin/mac-screenshot-process --file ${quoted}`);
                        }
                    } catch (_) {}
                });
                this._screencastNotifySignalId = Main.screenshotUI.connect('notify::screencast-in-progress', () => {
                    try {
                        if (!Main.screenshotUI._screencastInProgress && Main.screenshotUI._screencastPath) {
                            const p = Main.screenshotUI._screencastPath;
                            const ctrl = MacScreenshotUI.getMacScreenshotController();
                            const audioPath = ctrl ? ctrl.takeAudioSidecarPath() : null;
                            const cmd = audioPath
                                ? `/usr/local/bin/mac-screenshot-process --file ${GLib.shell_quote(p)} --audio-file ${GLib.shell_quote(audioPath)}`
                                : `/usr/local/bin/mac-screenshot-process --file ${GLib.shell_quote(p)}`;
                            GLib.spawn_command_line_async(cmd);
                        }
                    } catch (_) {}
                });
            }
        } catch (_) {}


        const fdo = Main.notificationDaemon?._fdoNotificationDaemon;
        if (fdo && !this._origGetSourceForPidAndName) {
            this._origGetSourceForPidAndName = fdo._getSourceForPidAndName.bind(fdo);
            const origFn = this._origGetSourceForPidAndName;
            fdo._getSourceForPidAndName = function(sender, pid, appName) {
                const key = (appName && appName.trim()) ? appName.trim() : (pid || sender || 'generic');
                let source = this._sourceForPidAndName.get(key);
                if (source)
                    return source;

                source = origFn(sender, null, key);
                this._sourceForPidAndName.set(key, source);
                source.connect('destroy', () => {
                    this._sourceForPidAndName.delete(key);
                });
                return source;
            };
        }


        const patchLiquidGlass = () => {
            try {
                const lg = Main.extensionManager?.lookup?.('liquid-glass@thinkingcoding1231.gmail.com')?.stateObj;
                const qsm = lg?._quickSettingsManager;
                if (qsm?._toggleStyles) {
                    const proto = Object.getPrototypeOf(qsm._toggleStyles);
                    if (!proto._macPatched) {
                        proto._macPatched = true;
                        const origLeafKind = proto._toggleLeafKind;
                        proto._toggleLeafKind = function(actor, inSystemItem) {
                            if (actor && actor.has_style_class_name) {
                                if (actor.has_style_class_name('mac-cc-submenu-card') ||
                                    actor.has_style_class_name('mac-cc-sound-drawer')) {
                                    return 'toggle';
                                }
                            }
                            return origLeafKind.call(this, actor, inSystemItem);
                        };
                    }
                    if (!proto._macSubActorsPatched) {
                        proto._macSubActorsPatched = true;
                        proto._getStylableSubActors = function(pod) {
                            const found = [];
                            const walk = (actor) => {
                                if (actor instanceof Clutter.Actor && actor.has_style_class_name) {
                                    if (actor !== pod && (
                                        actor.has_style_class_name('mac-cc-pill-icon-btn') ||
                                        actor.has_style_class_name('mac-cc-slider-track') ||
                                        actor.has_style_class_name('mac-cc-media-art') ||
                                        actor.has_style_class_name('mac-cc-airplay-btn') ||
                                        actor.has_style_class_name('slider') ||
                                        actor.has_style_class_name('mac-cc-transport-btn') ||
                                        actor.has_style_class_name('mac-cc-back-btn') ||
                                        actor.has_style_class_name('mac-cc-route-btn') ||
                                        actor.has_style_class_name('mac-cc-switch-track') ||
                                        actor.has_style_class_name('mac-cc-switch-thumb') ||
                                        actor.has_style_class_name('mac-cc-switch-btn') ||
                                        actor.has_style_class_name('toggle-switch')
                                    )) {
                                        return;
                                    }
                                    found.push(actor);
                                }
                                for (let child of actor.get_children())
                                    walk(child);
                            };
                            walk(pod);
                            return found;
                        };
                    }
                }
                if (lg && lg._searchGlassManager) {
                    lg._searchGlassManager.cleanup();
                    lg._searchGlassManager = null;
                }
                if (lg && (!lg._dashDocks || lg._dashDocks.length === 0)) {
                    lg._findDashToDock();
                }


                if (global._lgGlass && global._lgGlass.glassObjects) {
                    for (const glass of global._lgGlass.glassObjects()) {
                        if (glass._copier && !glass._copier.constructor._macThrottled) {
                            const CopierProto = glass._copier.constructor.prototype;
                            glass._copier.constructor._macThrottled = true;
                            const origTake = CopierProto.take;
                            CopierProto.take = function(actor, root, paintContext, stageRect) {
                                if (!actor.mapped || !actor.visible || actor.opacity === 0 || (actor.get_paint_opacity && actor.get_paint_opacity() === 0)) {
                                    return { copy: this.lastCopy, missed: false };
                                }
                                const fb = paintContext.get_framebuffer();
                                const view = this.constructor.liveView(actor, fb);
                                if (!view) {
                                    this.offStageCount++;
                                    return { copy: this.lastCopy, missed: false };
                                }
                                let copy = this._copies.get(view) ?? null;


                                if (actor._backdropLocked && copy?.texture) {
                                    this.reuseCount++;
                                    return { copy, missed: false };
                                }

                                const layout = view.layout;
                                const x0 = Math.max(stageRect[0], layout.x);
                                const y0 = Math.max(stageRect[1], layout.y);
                                const x1 = Math.min(stageRect[2], layout.x + layout.width);
                                const y1 = Math.min(stageRect[3], layout.y + layout.height);
                                if (!(x1 > x0) || !(y1 > y0))
                                    return { copy, missed: false };

                                const scale = view.get_scale();
                                const ox = Math.round(-layout.x * scale);
                                const oy = Math.round(-layout.y * scale);
                                const fx0 = Math.floor(x0 * scale) + ox;
                                const fy0 = Math.floor(y0 * scale) + oy;
                                const fx1 = Math.ceil(x1 * scale) + ox;
                                const fy1 = Math.ceil(y1 * scale) + oy;
                                const rect = [(fx0 - ox) / scale, (fy0 - oy) / scale, (fx1 - ox) / scale, (fy1 - oy) / scale];

                                const inOverview = Boolean(Main?.overview?.visible || Main?.overview?._animationInProgress);
                                const overviewChanged = copy && copy.inOverview !== undefined && copy.inOverview !== inOverview;
                                if (overviewChanged) {
                                    copy = null;
                                    this._copies.delete(view);
                                    if (typeof this.forceRefresh === 'function') {
                                        this.forceRefresh(500);
                                    }
                                }

                                const nowUs = GLib.get_monotonic_time();
                                const sameGeometry = copy?.rect &&
                                    Math.abs(copy.rect[0] - rect[0]) < 1.0 &&
                                    Math.abs(copy.rect[1] - rect[1]) < 1.0 &&
                                    Math.abs(copy.rect[2] - rect[2]) < 1.0 &&
                                    Math.abs(copy.rect[3] - rect[3]) < 1.0;

                                const isForced = nowUs < (this._forceUntilUs || 0);
                                const mustCopy = !copy?.texture || !copy?.rect || overviewChanged;



                                if (!mustCopy && !isForced && sameGeometry && copy?.texture && (nowUs - (copy.lastTimeUs || 0) < 16000)) {
                                    this.reuseCount++;
                                    return { copy, missed: false };
                                }



                                const clip = paintContext.get_redraw_clip();
                                const clipX = Math.floor(rect[0]);
                                const clipY = Math.floor(rect[1]);
                                const _Mtk = globalThis.Mtk || (typeof Mtk !== 'undefined' ? Mtk : imports.gi.Mtk);
                                let touchesClip = true;
                                if (clip && _Mtk) {
                                    try {
                                        const overlap = clip.contains_rectangle(new _Mtk.Rectangle({
                                            x: clipX, y: clipY, width: Math.max(1, Math.ceil(rect[2]) - clipX), height: Math.max(1, Math.ceil(rect[3]) - clipY),
                                        }));
                                        touchesClip = (overlap !== _Mtk.RegionOverlap.OUT);
                                    } catch (_) {
                                        touchesClip = true;
                                    }
                                }

                                if (!mustCopy && !isForced && copy?.texture && !touchesClip) {
                                    this.reuseCount++;
                                    return { copy, missed: false };
                                }

                                const savedForce = this._forceUntilUs;
                                this._forceUntilUs = nowUs + 10000000;
                                const res = origTake.call(this, actor, root, paintContext, stageRect);
                                this._forceUntilUs = savedForce;
                                if (res.copy) {
                                    res.copy.lastTimeUs = nowUs;
                                    res.copy.inOverview = inOverview;
                                }
                                return res;
                            };
                        }
                    }
                }

                const syncDockGlass = () => {
                    if (typeof global._liquidGlassDockSync === 'function') {
                        try { global._liquidGlassDockSync(); } catch (_) {}
                    }
                };

                if (!this._macDockSignalsConnected) {
                    this._macDockSignalsConnected = true;
                    this._dockSignals = [];
                    if (global.window_manager) {
                        this._dockSignals.push(
                            global.window_manager.connect('switch-workspace', () => syncDockGlass())
                        );
                    }
                    this._dockSignals.push(
                        Main.overview.connect('shown', () => syncDockGlass()),
                        Main.overview.connect('hidden', () => syncDockGlass())
                    );
                }
            } catch (_) {}
        };
        patchLiquidGlass();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            patchLiquidGlass();
            return GLib.SOURCE_REMOVE;
        });


        const setupDockMagnifierGuard = () => {
            try {
                const getMag = () => {
                    const d2d = Main.uiGroup?.get_children?.()?.find(c => c.name === 'dashtodockContainer');
                    return d2d?._dock?._magnifier || d2d?._magnifier || null;
                };

                const mag = getMag();
                if (mag && mag.constructor?.prototype && !this._origIsPointerOverDock) {
                    this._origIsPointerOverDock = mag.constructor.prototype._isPointerOverDock;
                    mag.constructor.prototype._isPointerOverDock = function() {
                        if (!this._hoverBox || !this._hoverBox.has_allocation())
                            return false;
                        if (Main.overview.visibleTarget || Main.overview.visible)
                            return false;
                        try {
                            const [x, y] = this._debugPointer ?? global.get_pointer();
                            const [boxX, boxY] = this._hoverBox.get_transformed_position();
                            const [w, h] = this._hoverBox.get_transformed_size?.() || [this._hoverBox.width, this._hoverBox.height];
                            const margin = 12;
                            const inBounds = x >= boxX - margin && x <= boxX + w + margin &&
                                             y >= boxY - margin && y <= boxY + h + margin;
                            if (!inBounds)
                                return false;
                            return true;
                        } catch (_) {
                            return false;
                        }
                    };
                }

                const resetMag = () => {
                    try {
                        const m = getMag();
                        if (m) {
                            m._stopTimeline?.();
                            m._target = 0;
                            m._envelope = 0;
                            m._velocity = 0;
                            m._cursor = null;
                            m._clearTransforms?.();
                        }
                    } catch (_) {}
                };

                const syncMag = () => {
                    try {
                        const m = getMag();
                        if (m) {
                            m._stopTimeline?.();
                            m._target = 0;
                            m._envelope = 0;
                            m._velocity = 0;
                            m._cursor = null;
                            m._clearTransforms?.();
                            if (typeof m._isPointerOverDock === 'function' && m._isPointerOverDock()) {
                                m._syncTarget?.();
                            }
                        }
                    } catch (_) {}
                };

                if (!this._dockMagSignalsConnected && Main.overview) {
                    this._dockMagSignalsConnected = true;
                    this._dockMagSignals = [
                        Main.overview.connect('showing', resetMag),
                        Main.overview.connect('hiding', resetMag),
                        Main.overview.connect('hidden', syncMag),
                    ];
                }
            } catch (_) {}
        };
        setupDockMagnifierGuard();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            setupDockMagnifierGuard();
            return GLib.SOURCE_REMOVE;
        });



        const setupAppDialogBlurGuard = () => {
            try {
                const bmsExt = Main.extensionManager.lookup('blur-my-shell@aunetx');
                const appsBlur = bmsExt?.stateObj?._applications_blur;
                if (!appsBlur) return;

                const isDialogOrModalWindow = (meta_window) => {
                    if (!meta_window) return false;
                    const type = typeof meta_window.get_window_type === 'function'
                        ? meta_window.get_window_type()
                        : meta_window.window_type;
                    if (type !== Meta.WindowType.NORMAL) return true;
                    if (typeof meta_window.get_transient_for === 'function' && meta_window.get_transient_for()) return true;
                    if (typeof meta_window.is_attached_dialog === 'function' && meta_window.is_attached_dialog()) return true;
                    if (typeof meta_window.can_maximize === 'function' && !meta_window.can_maximize()) return true;
                    if (typeof meta_window.allows_resize === 'function' && !meta_window.allows_resize()) return true;
                    return false;
                };

                const applyFullBlurToDialog = (mw) => {
                    try {
                        if (!mw || !isDialogOrModalWindow(mw)) return;
                        const blur_actor = mw.blur_actor;
                        if (!blur_actor) return;
                        const alloc = appsBlur.compute_allocation(mw);
                        blur_actor.x = alloc.x;
                        blur_actor.y = alloc.y;
                        blur_actor.width = alloc.width;
                        blur_actor.height = alloc.height;
                        blur_actor.remove_clip?.();
                    } catch (_) {}
                };

                const proto = appsBlur.constructor.prototype;
                if (proto && !this._origBmsUpdateSize) {
                    this._origBmsUpdateSize = proto.update_size;
                    const origUpdateSize = proto.update_size;
                    proto.update_size = function(pid) {
                        origUpdateSize.call(this, pid);
                        try {
                            if (this.meta_window_map?.has(pid)) {
                                const mw = this.meta_window_map.get(pid);
                                applyFullBlurToDialog(mw);
                            }
                        } catch (_) {}
                    };
                }

                if (appsBlur.meta_window_map) {
                    for (const [pid, mw] of appsBlur.meta_window_map) {
                        try {
                            if (isDialogOrModalWindow(mw)) {
                                appsBlur.update_size(pid);
                            }
                        } catch (_) {}
                    }
                }
            } catch (_) {}
        };
        setupAppDialogBlurGuard();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            setupAppDialogBlurGuard();
            return GLib.SOURCE_REMOVE;
        });


        const setupMenuHoverGlide = () => {
            try {
                const attachToMenu = (menu) => {
                    if (!menu || !menu.box || menu._macHoverTracker || menu._hasHoverTracker || menu._appMenuHoverGlide) return;
                    const isQuickSettings = menu.constructor.name === 'QuickSettingsMenu' || !!menu._grid;
                    if (isQuickSettings) return;
                    menu._macHoverTracker = new MacMenuHoverGlide(menu);
                };

                for (const m of (Main.panel.menuManager?._menus || [])) {
                    attachToMenu(m);
                }

                for (const key of Object.keys(Main.panel.statusArea || {})) {
                    const btn = Main.panel.statusArea[key];
                    if (btn?.menu) {
                        attachToMenu(btn.menu);
                    }
                }

                const suppressLeadingSeparator = (menu) => {
                    if (!menu || !menu.box) return;
                    try {
                        const items = menu._getMenuItems ? menu._getMenuItems() : [];
                        for (const item of items) {
                            if (!item.actor?.visible) continue;
                            if (item instanceof PopupMenu.PopupSeparatorMenuItem) {
                                item.actor.hide();
                            }
                            break;
                        }
                    } catch (_) {}
                };

                globalThis._macGlideDisposed = false;
                if (!PopupMenu.PopupMenu.prototype._origMacGlideOpen) {
                    const origOpen = PopupMenu.PopupMenu.prototype.open;
                    PopupMenu.PopupMenu.prototype._origMacGlideOpen = origOpen;
                    const openWrapper = function(animate) {
                        if (!globalThis._macGlideDisposed) {
                            try {
                                suppressLeadingSeparator(this);
                                attachToMenu(this);
                            } catch (e) {
                                console.error(`[EvalHelper] MacMenuHoverGlide open error: ${e}`);
                            }
                        }
                        return origOpen.call(this, animate);
                    };
                    PopupMenu.PopupMenu.prototype._macGlideOpenWrapper = openWrapper;
                    PopupMenu.PopupMenu.prototype.open = openWrapper;
                }

                if (PopupMenu.PopupSubMenu && !PopupMenu.PopupSubMenu.prototype._origMacGlideOpen) {
                    const origSubOpen = PopupMenu.PopupSubMenu.prototype.open;
                    PopupMenu.PopupSubMenu.prototype._origMacGlideOpen = origSubOpen;
                    const subOpenWrapper = function(animate) {
                        if (!globalThis._macGlideDisposed) {
                            try { attachToMenu(this); } catch (_) {}
                        }
                        return origSubOpen.call(this, animate);
                    };
                    PopupMenu.PopupSubMenu.prototype._macGlideSubOpenWrapper = subOpenWrapper;
                    PopupMenu.PopupSubMenu.prototype.open = subOpenWrapper;
                }

                if (PopupMenu.PopupSwitchMenuItem && !PopupMenu.PopupSwitchMenuItem.prototype._origMacActivate) {
                    PopupMenu.PopupSwitchMenuItem.prototype._origMacActivate = PopupMenu.PopupSwitchMenuItem.prototype.activate;
                    PopupMenu.PopupSwitchMenuItem.prototype.activate = function(event) {
                        if (this._switch?.mapped)
                            this.toggle();

                        if (event && typeof event.type === 'function' &&
                            event.type() === Clutter.EventType.KEY_PRESS &&
                            typeof event.get_key_symbol === 'function' &&
                            event.get_key_symbol() === Clutter.KEY_space)
                            return;

                        if (event && (event instanceof Clutter.Event || (typeof Clutter.Event === 'function' && event instanceof Clutter.Event))) {
                            this.emit('activate', event);
                        }
                    };
                }

                if (Main.panel.menuManager && !Main.panel.menuManager._origMacGlideAddMenu) {
                    const origAdd = Main.panel.menuManager.addMenu;
                    Main.panel.menuManager._origMacGlideAddMenu = origAdd;
                    const addWrapper = function(menu, position) {
                        if (!globalThis._macGlideDisposed) {
                            try { attachToMenu(menu); } catch (_) {}
                        }
                        return origAdd.call(this, menu, position);
                    };
                    Main.panel.menuManager._macGlideAddWrapper = addWrapper;
                    Main.panel.menuManager.addMenu = addWrapper;
                }
            } catch (e) {
                console.error(`[EvalHelper] setupMenuHoverGlide error: ${e}`);
            }
        };
        setupMenuHoverGlide();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            setupMenuHoverGlide();
            return GLib.SOURCE_REMOVE;
        });




        const patchSpotlightKeybinding = async () => {
            try {
                try {
                    const ibusSettings = new Gio.Settings({ schema_id: 'org.freedesktop.ibus.general.hotkey' });
                    let trig = ibusSettings.get_strv('trigger');
                    if (trig.some(t => t.toLowerCase() === 'control+space')) {
                        ibusSettings.set_strv('trigger', trig.filter(t => t.toLowerCase() !== 'control+space'));
                    }
                } catch (_) {}

                const ext = Main.extensionManager.lookup('appmenu@ChathurangaBW.github.io');
                if (!ext?.stateObj?._settings) return;

                try {
                    const cur = ext.stateObj._settings.get_strv('search-shortcut');
                    if (!Array.isArray(cur) || cur.length === 0) {
                        ext.stateObj._settings.set_strv('search-shortcut', ['<Control>space', '<Primary>space']);
                    }
                } catch (_) {}

                // Keep appmenu as the single owner of search-shortcut and clipboard-shortcut,
                // and recover them automatically if GNOME Shell still has ActionMode.NONE (0).
                if (typeof ext.stateObj._syncSpotlightKeybinding === 'function') {
                    ext.stateObj._syncSpotlightKeybinding();
                } else {
                    if (typeof ext.stateObj._addSearchKeybinding === 'function' && !Main.wm._allowedKeybindings?.['search-shortcut']) {
                        ext.stateObj._searchShortcutInstalled = false;
                        ext.stateObj._addSearchKeybinding();
                    }
                    if (typeof ext.stateObj._addClipboardKeybinding === 'function' && !Main.wm._allowedKeybindings?.['clipboard-shortcut']) {
                        ext.stateObj._clipboardShortcutInstalled = false;
                        ext.stateObj._addClipboardKeybinding();
                    }
                }
            } catch (e) {
                console.error(`[EvalHelper] patchSpotlightKeybinding error: ${e}`);
            }
        };
        patchSpotlightKeybinding();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            patchSpotlightKeybinding();
            return GLib.SOURCE_REMOVE;
        });


        const patchSwitcherPopupLQVisual = async () => {
            try {
                const SwitcherPopupMod = await import('resource:///org/gnome/shell/ui/switcherPopup.js');
                const AltTabMod = await import('resource:///org/gnome/shell/ui/altTab.js');
                const ShellMod = await import('gi://Shell');
                const Shell = ShellMod.default || ShellMod;
                const PangoMod = await import('gi://Pango');
                const Pango = PangoMod.default || PangoMod;
                const ClutterMod = await import('gi://Clutter');
                const Clutter = ClutterMod.default || ClutterMod;
                const SwitcherPopup = SwitcherPopupMod.SwitcherPopup;
                const SwitcherList = SwitcherPopupMod.SwitcherList;
                if (!SwitcherPopup || !SwitcherList) return;

                const _macGetAccentColorRgba = (alpha = 0.80) => {
                    try {
                        const ifaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                        const acc = ifaceSettings.get_string('accent-color');
                        const ACCENTS = {
                            'blue': [0, 122, 255],
                            'teal': [48, 176, 199],
                            'green': [52, 199, 89],
                            'yellow': [255, 204, 0],
                            'orange': [255, 149, 0],
                            'red': [255, 59, 48],
                            'pink': [255, 45, 85],
                            'purple': [175, 82, 222],
                            'slate': [142, 142, 147]
                        };
                        const rgb = ACCENTS[acc] || [255, 149, 0];
                        return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
                    } catch (_) {
                        return `rgba(255, 149, 0, ${alpha})`;
                    }
                };

                const _MAC_ALTTAB_DEFAULTS = {
                    iconSize: 67,
                    padding: 9,
                    spacing: 12,
                    radius: 34,
                    blur: 20,
                    tint: 15,
                    shadow: 25,
                };

                const _macGetAltTabConfig = () => {
                    let { iconSize, padding, spacing, radius, blur, tint, shadow } = _MAC_ALTTAB_DEFAULTS;
                    try {
                        const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
                        if (GLib.file_test(confPath, GLib.FileTest.EXISTS)) {
                            const [ok, bytes] = GLib.file_get_contents(confPath);
                            if (ok) {
                                const conf = JSON.parse(new TextDecoder().decode(bytes));
                                if (typeof conf.alttab_icon_size === 'number') iconSize = conf.alttab_icon_size;
                                if (typeof conf.alttab_padding === 'number') padding = conf.alttab_padding;
                                if (typeof conf.alttab_spacing === 'number') spacing = conf.alttab_spacing;
                                if (typeof conf.alttab_radius === 'number') radius = conf.alttab_radius;
                                if (typeof conf.alttab_blur === 'number') blur = conf.alttab_blur;
                                if (typeof conf.alttab_tint === 'number') tint = conf.alttab_tint;
                                if (typeof conf.alttab_shadow === 'number') shadow = conf.alttab_shadow;
                            }
                        }
                    } catch (_) {}
                    globalThis._macAltTabConfig = { iconSize, padding, spacing, radius, blur, tint, shadow };
                    return globalThis._macAltTabConfig;
                };
                globalThis._macGetAltTabConfigFn = _macGetAltTabConfig;

                /** Computes proportional Alt+Tab tile, squircle, font, and container metrics from iconSize & padding. */
                const _macCalcAltTabMetrics = (cfg, tileOverride = null) => {
                    const tileSize = Math.max(24, Math.round(tileOverride || cfg.iconSize || _MAC_ALTTAB_DEFAULTS.iconSize));
                    const boxSize = Math.max(20, Math.round(tileSize * (50 / 56)));
                    const outlineRad = Math.max(10, Math.round(boxSize * 0.28));
                    const borderW = (Math.max(2.0, Math.round((tileSize / 56) * 2.5 * 2) / 2)).toFixed(1);
                    const fontPx = Math.max(10, Math.round(tileSize * (16 / 84)));
                    const scrollY1 = Math.max(6, Math.round(tileSize * (10 / 84)));
                    const lblGap = Math.max(2, Math.round(tileSize * 0.04));
                    const lblY1 = scrollY1 + Math.round((tileSize + boxSize) / 2) + lblGap;
                    const lblMaxH = Math.max(14, Math.round(fontPx * 1.45));
                    const botMargin = Math.max(2, Math.round(tileSize * 0.04));
                    const totalH = lblY1 + lblMaxH + botMargin;
                    const vPad = Math.max(4, Math.round(cfg.padding ?? _MAC_ALTTAB_DEFAULTS.padding));
                    const hPad = Math.max(14, Math.round(vPad * 2));
                    return { tileSize, boxSize, outlineRad, borderW, fontPx, scrollY1, lblY1, lblMaxH, totalH, vPad, hPad };
                };

                const _macApplyIconActorBox = (iconActor, m, selected) => {
                    if (!iconActor) return;
                    if (typeof iconActor.add_style_class_name === 'function') iconActor.add_style_class_name('alt-tab-icon-bin');
                    iconActor.x_align = Clutter.ActorAlign.CENTER;
                    iconActor.y_align = Clutter.ActorAlign.CENTER;
                    if (typeof iconActor.set_size === 'function') iconActor.set_size(m.boxSize, m.boxSize);
                    const iconChild = iconActor.child || (iconActor.get_children ? iconActor.get_children()[0] : null);
                    if (iconChild) {
                        iconChild.set_pivot_point(0.5, 0.5);
                        iconChild.set_scale(1.18, 1.18);
                    }
                    const borderColor = selected ? _macGetAccentColorRgba(0.85) : 'transparent';
                    const shadowCss = selected ? '0 4px 14px rgba(0, 0, 0, 0.35)' : 'none';
                    iconActor.style = `padding: 0px !important; margin: 0px !important; border-radius: ${m.outlineRad}px !important; border: ${m.borderW}px solid ${borderColor} !important; background-color: transparent !important; background: transparent !important; box-shadow: ${shadowCss} !important; transition-duration: 150ms !important;`;
                    if (selected) {
                        if (typeof iconActor.add_style_pseudo_class === 'function') iconActor.add_style_pseudo_class('selected');
                        if (typeof iconActor.add_style_class_name === 'function') iconActor.add_style_class_name('selected');
                    } else {
                        if (typeof iconActor.remove_style_pseudo_class === 'function') iconActor.remove_style_pseudo_class('selected');
                        if (typeof iconActor.remove_style_class_name === 'function') iconActor.remove_style_class_name('selected');
                    }
                };

                const _macLabelStyleForFont = (fontPx) =>
                    `font-family: "Default Display", "Default", "SF Pro Display", "SF Pro Text", Cantarell, sans-serif !important; font-size: ${fontPx}px !important; font-weight: 500 !important; color: #ffffff !important; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9) !important; text-align: center !important; margin: 0px !important; padding: 0px !important;`;

                SwitcherList.prototype._macUpdateItemVisual = function(i) {
                    if (!Array.isArray(this._items) || i < 0 || i >= this._items.length) return;
                    const item = this._items[i];
                    if (!item) return;
                    const cfg = _macGetAltTabConfig();
                    const m = _macCalcAltTabMetrics(cfg, this._itemTileSize);

                    item.set_size(m.tileSize, m.tileSize);
                    item.style = 'padding: 0px !important; margin: 0px !important; background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important; outline: none !important;';

                    const child = item.get_child ? item.get_child() : null;
                    if (child) {
                        child.set_size(m.tileSize, m.tileSize);
                        child.style = 'padding: 0px !important; margin: 0px !important; spacing: 0px !important; background-color: transparent !important; background: transparent !important;';
                    }
                    const iconActor = child?._iconBin || child?._icon || (child?.get_children ? child.get_children()[0] : null);
                    const label = child?.label || item.label_actor;
                    const isSelected = (i === this._highlighted) || item.hover;

                    _macApplyIconActorBox(iconActor, m, isSelected);

                    if (label) {
                        label.opacity = 0;
                        if (typeof label.set_height === 'function') label.set_height(0);
                    }
                };

                if (!SwitcherList.prototype._macHeightPatchedV12) {
                    SwitcherList.prototype._macHeightPatchedV12 = true;
                    SwitcherList.prototype.vfunc_get_preferred_height = function(_forWidth) {
                        const cfg = _macGetAltTabConfig();
                        if (!this._iconSize && typeof this._setIconSize === 'function') {
                            this._setIconSize();
                        }
                        const m = _macCalcAltTabMetrics(cfg, this._itemTileSize);
                        return [m.totalH, m.totalH];
                    };
                }

                if (!SwitcherList.prototype._macAllocPatchedV12) {
                    SwitcherList.prototype._macAllocPatchedV12 = true;
                    const origVfuncAllocate = SwitcherList.prototype._macOrigVfuncAllocate || SwitcherList.prototype.vfunc_allocate;
                    SwitcherList.prototype._macOrigVfuncAllocate = origVfuncAllocate;
                    SwitcherList.prototype.vfunc_allocate = function(box) {
                        this.set_allocation(box);
                        const cfg = _macGetAltTabConfig();
                        const m = _macCalcAltTabMetrics(cfg, this._itemTileSize);
                        const W = box.x2 - box.x1;
                        const H = box.y2 - box.y1;

                        const scrollBox = new Clutter.ActorBox();
                        scrollBox.x1 = 0;
                        scrollBox.x2 = W;
                        scrollBox.y1 = m.scrollY1;
                        scrollBox.y2 = m.scrollY1 + m.tileSize;
                        this._scrollView.allocate(scrollBox);

                        if (this._leftArrow) this._leftArrow.opacity = 0;
                        if (this._rightArrow) this._rightArrow.opacity = 0;

                        if (this._activeAppLabel) {
                            if (this._activeAppLabel.visible && this._highlighted >= 0 && Array.isArray(this._items) && this._items[this._highlighted]) {
                                const item = this._items[this._highlighted];
                                const [minW, natW] = this._activeAppLabel.get_preferred_width(-1);
                                const [minH, natH] = this._activeAppLabel.get_preferred_height(natW);

                                const [absX] = item.get_transformed_position();
                                const [thisX] = this.get_transformed_position();
                                const relX = (absX != null && thisX != null) ? Math.round(absX - thisX) : Math.round(item.allocation.x1);

                                const lBox = new Clutter.ActorBox();
                                let lx1 = Math.round(relX + (item.width - natW) / 2);
                                let lx2 = lx1 + natW;
                                const sidePad = Math.max(8, m.hPad - 4);
                                if (lx1 < sidePad) {
                                    lx2 += (sidePad - lx1);
                                    lx1 = sidePad;
                                }
                                if (lx2 > W - sidePad) {
                                    lx1 -= (lx2 - (W - sidePad));
                                    lx2 = W - sidePad;
                                }
                                lBox.x1 = Math.max(6, lx1);
                                lBox.x2 = Math.min(W - 6, lx2);
                                const lblH = Math.min(m.lblMaxH, Math.max(natH, m.fontPx + 2));
                                lBox.y1 = m.lblY1;
                                lBox.y2 = Math.min(H, m.lblY1 + lblH);
                                this._activeAppLabel.allocate(lBox);
                            }
                        }
                    };
                }


                if (!SwitcherList.prototype._macHighlightPatchedV12) {
                    SwitcherList.prototype._macHighlightPatchedV12 = true;
                    const origHighlight = SwitcherList.prototype._macOrigHighlight || SwitcherList.prototype.highlight;
                    SwitcherList.prototype._macOrigHighlight = origHighlight;
                    SwitcherList.prototype.highlight = function(index, justOutline) {
                        origHighlight.call(this, index, justOutline);
                        if (!Array.isArray(this._items)) return;
                        this._highlighted = index;
                        const cfg = _macGetAltTabConfig();
                        const m = _macCalcAltTabMetrics(cfg, this._itemTileSize);

                        if (!this._activeAppLabel) {
                            this._activeAppLabel = new St.Label({
                                style_class: 'alt-tab-app-label',
                            });
                            if (this._activeAppLabel.clutter_text) {
                                this._activeAppLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                                this._activeAppLabel.clutter_text.line_wrap = false;
                                this._activeAppLabel.clutter_text.x_align = Clutter.ActorAlign.CENTER;
                            }
                            this.add_child(this._activeAppLabel);
                        }
                        this._activeAppLabel.style = _macLabelStyleForFont(m.fontPx);

                        if (index >= 0 && index < this._items.length) {
                            const item = this._items[index];
                            const child = item?.get_child ? item.get_child() : null;
                            const name = child?.label?.text || item?.label_actor?.text || (this.icons && this.icons[index]?.label?.text) || '';
                            this._activeAppLabel.text = name;
                            this._activeAppLabel.opacity = 255;
                            this._activeAppLabel.show();
                        } else {
                            this._activeAppLabel.opacity = 0;
                        }

                        for (let i = 0; i < this._items.length; i++) {
                            const item = this._items[i];
                            if (!item) continue;
                            item.remove_style_pseudo_class('selected');
                            item.remove_style_pseudo_class('outlined');
                            item.remove_style_pseudo_class('highlighted');
                            item.remove_style_class_name('selected');
                            this._macUpdateItemVisual(i);
                        }
                        this.queue_relayout();
                    };
                }


                if (!SwitcherList.prototype._macAddItemPatchedV12) {
                    SwitcherList.prototype._macAddItemPatchedV12 = true;
                    const origAddItem = SwitcherList.prototype._macOrigAddItem || SwitcherList.prototype.addItem;
                    SwitcherList.prototype._macOrigAddItem = origAddItem;
                    SwitcherList.prototype.addItem = function(item, label) {
                        const bbox = origAddItem.call(this, item, label);
                        const cfg = _macGetAltTabConfig();
                        const m = _macCalcAltTabMetrics(cfg, this._itemTileSize);

                        bbox._square = false;
                        bbox.x_align = Clutter.ActorAlign.CENTER;
                        bbox.y_align = Clutter.ActorAlign.CENTER;
                        if (typeof bbox.set_width === 'function') bbox.set_width(m.tileSize);
                        bbox.style = 'padding: 0px !important; margin: 0px !important; background-color: transparent !important; border: none !important; box-shadow: none !important;';
                        if (label) {
                            label.opacity = 0;
                            if (typeof label.set_height === 'function') label.set_height(0);
                        }
                        const child = bbox.get_child ? bbox.get_child() : null;
                        if (child?.label) {
                            child.label.opacity = 0;
                            if (typeof child.label.set_height === 'function') child.label.set_height(0);
                        }
                        const iconActor = child?._iconBin || child?._icon || (child?.get_children ? child.get_children()[0] : null);
                        _macApplyIconActorBox(iconActor, m, false);
                        if (this._leftArrow) this._leftArrow.opacity = 0;
                        if (this._rightArrow) this._rightArrow.opacity = 0;

                        bbox.connect('notify::hover', () => {
                            const idx = this._items.indexOf(bbox);
                            if (typeof this._macUpdateItemVisual === 'function') {
                                this._macUpdateItemVisual(idx);
                            }
                            if (bbox.hover && this._activeAppLabel && idx >= 0) {
                                const ch = bbox?.get_child ? bbox.get_child() : null;
                                const nm = ch?.label?.text || bbox?.label_actor?.text || (this.icons && this.icons[idx]?.label?.text) || '';
                                if (nm) {
                                    this._activeAppLabel.text = nm;
                                    this._activeAppLabel.opacity = 255;
                                    this._activeAppLabel.show();
                                    this.queue_relayout();
                                }
                            }
                        });

                        return bbox;
                    };
                }


                if (AltTabMod.AppIcon && !AltTabMod.AppIcon.prototype._macPatchedV12) {
                    AltTabMod.AppIcon.prototype._macPatchedV12 = true;
                    const origAppIconInit = AltTabMod.AppIcon.prototype._macOrigInit || AltTabMod.AppIcon.prototype._init;
                    AltTabMod.AppIcon.prototype._macOrigInit = origAppIconInit;
                    AltTabMod.AppIcon.prototype._init = function(app) {
                        origAppIconInit.call(this, app);
                        const cfg = _macGetAltTabConfig();
                        const m = _macCalcAltTabMetrics(cfg);
                        _macApplyIconActorBox(this._iconBin, m, false);
                        if (this.label) {
                            this.label.add_style_class_name('alt-tab-app-label');
                            this.label.opacity = 0;
                            if (typeof this.label.set_height === 'function') this.label.set_height(0);
                            this.label.x_align = Clutter.ActorAlign.CENTER;
                            this.label.style = _macLabelStyleForFont(m.fontPx);
                            if (this.label.clutter_text) {
                                this.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                                this.label.clutter_text.line_wrap = false;
                                this.label.clutter_text.x_align = Clutter.ActorAlign.CENTER;
                            }
                        }
                    };
                }


                if (AltTabMod.AppSwitcherPopup && !AltTabMod.AppSwitcherPopup.prototype._macThumbPatchedV12) {
                    AltTabMod.AppSwitcherPopup.prototype._macThumbPatchedV12 = true;
                    AltTabMod.AppSwitcherPopup.prototype._createThumbnails = function() {};
                    AltTabMod.AppSwitcherPopup.prototype._timeoutPopupThumbnails = function() {};
                }

                if (AltTabMod.WindowIcon && !AltTabMod.WindowIcon.prototype._macPatchedV12) {
                    AltTabMod.WindowIcon.prototype._macPatchedV12 = true;
                    const origWindowIconInit = AltTabMod.WindowIcon.prototype._macOrigInit || AltTabMod.WindowIcon.prototype._init;
                    AltTabMod.WindowIcon.prototype._macOrigInit = origWindowIconInit;
                    AltTabMod.WindowIcon.prototype._init = function(window, mode) {
                        origWindowIconInit.call(this, window, 2);
                        const cfg = _macGetAltTabConfig();
                        const m = _macCalcAltTabMetrics(cfg);

                        if (this._icon) {
                            this._icon.destroy_all_children();
                            const tracker = Shell.WindowTracker.get_default();
                            const app = tracker.get_window_app(window);
                            this.app = app;
                            const appIcon = app
                                ? app.create_icon_texture(m.tileSize)
                                : new St.Icon({ icon_name: 'application-x-executable', icon_size: m.tileSize });
                            appIcon.x_align = Clutter.ActorAlign.CENTER;
                            appIcon.y_align = Clutter.ActorAlign.CENTER;
                            this._icon.add_child(appIcon);
                            _macApplyIconActorBox(this._icon, m, false);
                        }

                        if (this.label) {
                            try {
                                const tracker = Shell.WindowTracker.get_default();
                                const app = tracker.get_window_app(window);
                                const name = app?.get_name() || window.get_title();
                                this.label.text = name;
                            } catch (_) {}
                            this.label.add_style_class_name('alt-tab-app-label');
                            this.label.x_align = Clutter.ActorAlign.CENTER;
                            this.label.opacity = 0;
                            if (typeof this.label.set_height === 'function') this.label.set_height(0);
                            this.label.style = _macLabelStyleForFont(m.fontPx);
                            if (this.label.clutter_text) {
                                this.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                                this.label.clutter_text.line_wrap = false;
                                this.label.clutter_text.x_align = Clutter.ActorAlign.CENTER;
                            }
                            if (!this.label.get_parent()) {
                                this.add_child(this.label);
                            }
                        }
                    };
                }


                try {
                    const dummyPopup = new AltTabMod.AppSwitcherPopup();
                    const AppSwitcherProto = dummyPopup._switcherList ? Object.getPrototypeOf(dummyPopup._switcherList) : null;
                    if (AppSwitcherProto && !AppSwitcherProto._macPatchedV12) {
                        AppSwitcherProto._macPatchedV12 = true;
                        const origAddIcon = AppSwitcherProto._macOrigAddIcon || AppSwitcherProto._addIcon;
                        AppSwitcherProto._macOrigAddIcon = origAddIcon;
                        AppSwitcherProto._addIcon = function(appIcon) {
                            origAddIcon.call(this, appIcon);
                            this._squareItems = false;
                            if (Array.isArray(this._items) && this._items.length > 0) {
                                const lastItem = this._items[this._items.length - 1];
                                if (lastItem) {
                                    lastItem._square = false;
                                    const cfg = _macGetAltTabConfig();
                                    const tileW = this._itemTileSize || cfg.iconSize;
                                    if (typeof lastItem.set_width === 'function') lastItem.set_width(tileW);
                                    lastItem.style = 'padding: 0px !important; margin: 0px !important; background-color: transparent !important; border: none !important; box-shadow: none !important;';
                                }
                            }
                            if (Array.isArray(this._arrows)) {
                                for (const arrow of this._arrows) {
                                    if (arrow) arrow.hide();
                                }
                            }
                        };
                        AppSwitcherProto.highlight = function(n, justOutline) {
                            SwitcherList.prototype.highlight.call(this, n, justOutline);
                            if (Array.isArray(this._arrows)) {
                                for (const arrow of this._arrows) {
                                    if (arrow) arrow.hide();
                                }
                            }
                        };
                        AppSwitcherProto._setIconSize = function() {
                            const cfg = _macGetAltTabConfig();
                            const primary = Main.layoutManager.primaryMonitor;
                            const availWidth = primary ? primary.width - 160 : 1600;

                            let baseIconSize = cfg.iconSize;
                            let spacing = cfg.spacing;
                            let itemW = baseIconSize;

                            const totalNeeded = this._items.length * (itemW + spacing) + 80;
                            if (totalNeeded > availWidth && this._items.length > 0) {
                                const scale = Math.max(0.4, (availWidth - 80) / (this._items.length * (itemW + spacing)));
                                baseIconSize = Math.max(24, Math.round(baseIconSize * scale));
                                spacing = Math.max(2, Math.round(spacing * scale));
                                itemW = baseIconSize;
                            }

                            const m = _macCalcAltTabMetrics(cfg, itemW);
                            this._iconSize = baseIconSize;
                            this._squareItems = false;
                            this._itemTileSize = itemW;
                            this._itemSpacing = spacing;
                            if (typeof this.set_height === 'function') this.set_height(m.totalH);

                            if (this._list) {
                                this._list.spacing = spacing;
                                this._list.style = `spacing: ${spacing}px !important;`;
                                this._list.y_align = Clutter.ActorAlign.CENTER;
                                this._list.x_align = Clutter.ActorAlign.CENTER;
                            }

                            for (let i = 0; i < this.icons.length; i++) {
                                if (this._items[i]) {
                                    this._items[i]._square = false;
                                    this._items[i].x_align = Clutter.ActorAlign.CENTER;
                                    this._items[i].y_align = Clutter.ActorAlign.CENTER;
                                    this._items[i].set_size(m.tileSize, m.tileSize);
                                    if (typeof this._items[i].set_width === 'function') this._items[i].set_width(m.tileSize);
                                    this._items[i].style = 'padding: 0px !important; margin: 0px !important; background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;';
                                }
                                if (this.icons[i]) {
                                    this.icons[i].set_size(baseIconSize);
                                    this.icons[i].x_align = Clutter.ActorAlign.CENTER;
                                    this.icons[i].y_align = Clutter.ActorAlign.CENTER;
                                    this.icons[i].style = 'padding: 0px !important; margin: 0px !important; spacing: 0px !important; background-color: transparent !important; background: transparent !important;';
                                    const iconActor = this.icons[i]._iconBin || this.icons[i]._icon || (this.icons[i].get_children ? this.icons[i].get_children()[0] : null);
                                    _macApplyIconActorBox(iconActor, m, i === this._highlighted);
                                    if (this.icons[i].label) {
                                        this.icons[i].label.add_style_class_name('alt-tab-app-label');
                                        this.icons[i].label.opacity = 0;
                                        if (typeof this.icons[i].label.set_height === 'function') this.icons[i].label.set_height(0);
                                        this.icons[i].label.x_align = Clutter.ActorAlign.CENTER;
                                    }
                                }
                            }
                        };
                    }
                    dummyPopup.destroy();
                } catch (_) {}


                try {
                    const dummyWinPopup = new AltTabMod.WindowSwitcherPopup();
                    const WinSwitcherProto = dummyWinPopup._switcherList ? Object.getPrototypeOf(dummyWinPopup._switcherList) : null;
                    if (WinSwitcherProto && !WinSwitcherProto._macPatchedV12) {
                        WinSwitcherProto._macPatchedV12 = true;
                        const origWinSwitcherInit = WinSwitcherProto._macOrigInit || WinSwitcherProto._init;
                        WinSwitcherProto._macOrigInit = origWinSwitcherInit;
                        WinSwitcherProto._init = function(windows, mode) {
                            origWinSwitcherInit.call(this, windows, 2);
                            this._squareItems = false;
                            if (this._label) {
                                this._label.hide();
                                this._label.opacity = 0;
                                if (typeof this._label.set_height === 'function') this._label.set_height(0);
                                this._label.style = 'font-size: 0px; margin: 0px; padding: 0px;';
                            }
                            this._setIconSize();
                        };
                        WinSwitcherProto._setIconSize = function() {
                            const cfg = _macGetAltTabConfig();
                            const primary = Main.layoutManager.primaryMonitor;
                            const availWidth = primary ? primary.width - 160 : 1600;

                            let baseIconSize = cfg.iconSize;
                            let spacing = cfg.spacing;
                            let itemW = baseIconSize;

                            const totalNeeded = this._items.length * (itemW + spacing) + 80;
                            if (totalNeeded > availWidth && this._items.length > 0) {
                                const scale = Math.max(0.4, (availWidth - 80) / (this._items.length * (itemW + spacing)));
                                baseIconSize = Math.max(24, Math.round(baseIconSize * scale));
                                spacing = Math.max(2, Math.round(spacing * scale));
                                itemW = baseIconSize;
                            }

                            const m = _macCalcAltTabMetrics(cfg, itemW);
                            this._iconSize = baseIconSize;
                            this._squareItems = false;
                            this._itemTileSize = itemW;
                            this._itemSpacing = spacing;
                            if (typeof this.set_height === 'function') this.set_height(m.totalH);

                            if (this._list) {
                                this._list.spacing = spacing;
                                this._list.style = `spacing: ${spacing}px !important;`;
                                this._list.y_align = Clutter.ActorAlign.CENTER;
                                this._list.x_align = Clutter.ActorAlign.CENTER;
                            }

                            for (let i = 0; i < this._items.length; i++) {
                                const item = this._items[i];
                                if (item) {
                                    item._square = false;
                                    item.x_align = Clutter.ActorAlign.CENTER;
                                    item.y_align = Clutter.ActorAlign.CENTER;
                                    item.set_size(m.tileSize, m.tileSize);
                                    if (typeof item.set_width === 'function') item.set_width(m.tileSize);
                                    item.style = 'padding: 0px !important; margin: 0px !important; background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;';
                                }
                                const iconObj = this.icons && this.icons[i];
                                if (iconObj) {
                                    iconObj.x_align = Clutter.ActorAlign.CENTER;
                                    iconObj.y_align = Clutter.ActorAlign.CENTER;
                                    iconObj.style = 'padding: 0px !important; margin: 0px !important; spacing: 0px !important;';
                                    const iconActor = iconObj._icon || iconObj._iconBin || (iconObj.get_children ? iconObj.get_children()[0] : null);
                                    _macApplyIconActorBox(iconActor, m, i === this._highlighted);
                                }
                            }
                        };
                        WinSwitcherProto.vfunc_get_preferred_height = function(forWidth) {
                            return SwitcherList.prototype.vfunc_get_preferred_height.call(this, forWidth);
                        };
                        WinSwitcherProto.vfunc_allocate = function(box) {
                            SwitcherList.prototype.vfunc_allocate.call(this, box);
                        };
                        WinSwitcherProto.highlight = function(index, justOutline) {
                            SwitcherList.prototype.highlight.call(this, index, justOutline);
                            if (this._label) {
                                this._label.hide();
                                this._label.opacity = 0;
                            }
                        };
                    }
                    dummyWinPopup.destroy();
                } catch (_) {}

                const getSwitcherGlass = async () => {
                    let glass = globalThis._macSwitcherGlass;
                    if (!glass || !glass.get_parent() || glass.is_finalized?.()) {
                        const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                        const path = ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
                        const glassMod = await import(`file://${path}/dist/rendering/backdropGlass.js`);
                        const BackdropGlass = glassMod.BackdropGlass;

                        glass = new BackdropGlass({
                            extensionPath: path,
                            settings: ext?.stateObj?._settings || null,
                            logger: console,
                            owner: 'switcher-popup',
                        });
                        glass.setIsDock(false);
                        glass.setCornerSmoothingEnabled(0.0);
                        const cfg = _macGetAltTabConfig();
                        glass.setCornerRadius(cfg.radius);
                        glass.setTintColor(0.0, 0.0, 0.0);
                        glass.setTintStrength(cfg.tint / 100.0);
                        glass.setBlurRadius(cfg.blur);
                        glass.setPadding(0);
                        try {
                            glass._effect?.setSurfaceLightEnabled?.(true);
                            glass._effect?._setFloat?.('shadow_intensity', cfg.shadow / 100.0);
                            glass._effect?._setFloat?.('ao_intensity', 0.0);
                        } catch (_) {}
                        glass.hide();
                        Main.layoutManager.uiGroup.add_child(glass);
                        globalThis._macSwitcherGlass = glass;
                    }
                    return glass;
                };


                getSwitcherGlass().catch(() => {});

                if (!SwitcherPopup.prototype._macLQVisualPatchedV12) {
                    SwitcherPopup.prototype._macLQVisualPatchedV12 = true;
                    const origShow = SwitcherPopup.prototype._macOrigShow || SwitcherPopup.prototype.show;
                    SwitcherPopup.prototype._macOrigShow = origShow;
                    SwitcherPopup.prototype.show = function(backward, binding, mask) {
                        const cfg = _macGetAltTabConfig();
                        const m = _macCalcAltTabMetrics(cfg, this._switcherList?._itemTileSize);
                        const radius = cfg.radius;
                        const vPad = m.vPad;
                        const hPad = m.hPad;
                        const tintA = (cfg.tint / 100.0).toFixed(2);
                        const shadowA = (cfg.shadow / 100.0).toFixed(2);

                        if (this._switcherList) {
                            this._switcherList._squareItems = false;
                            if (typeof this._switcherList._setIconSize === 'function' && !this._switcherList._itemTileSize) {
                                this._switcherList._setIconSize();
                            }
                            const resolvedM = _macCalcAltTabMetrics(cfg, this._switcherList._itemTileSize);
                            if (typeof this._switcherList.set_height === 'function') {
                                this._switcherList.set_height(resolvedM.totalH);
                            }
                            this._switcherList.style = `background-color: rgba(22, 22, 22, ${tintA}) !important; border-radius: ${radius}px !important; border: 1px solid rgba(255, 255, 255, 0.22) !important; box-shadow: 0 16px 40px rgba(0, 0, 0, ${shadowA}) !important; padding: 0px ${hPad}px !important;`;
                            if (this._switcherList._list) {
                                this._switcherList._list.style = `spacing: ${cfg.spacing}px !important;`;
                                this._switcherList._list.spacing = cfg.spacing;
                                this._switcherList._list.y_align = Clutter.ActorAlign.CENTER;
                                this._switcherList._list.x_align = Clutter.ActorAlign.CENTER;
                            }
                        }
                        const res = origShow.call(this, backward, binding, mask);
                        if (!res) return res;

                        let destroyed = false;
                        let stageSignalId = 0;
                        let switcherGlass = null;
                        const disconnectStage = () => {
                            if (stageSignalId) {
                                try { global.stage.disconnect(stageSignalId); } catch (_) {}
                                stageSignalId = 0;
                            }
                        };

                        try {
                            this.connect('destroy', () => {
                                destroyed = true;
                                disconnectStage();
                                if (switcherGlass) {
                                    try {
                                        switcherGlass.hide();
                                        switcherGlass.opacity = 0;
                                    } catch (_) {}
                                }
                            });
                        } catch (_) {
                            destroyed = true;
                        }

                        const attachGlass = (glass) => {
                            if (!glass || destroyed) return;
                            switcherGlass = glass;
                            try {
                                switcherGlass.addExclusion(this);
                                if (this._switcherList) {
                                    switcherGlass.addExclusion(this._switcherList);
                                }
                            } catch (_) {}

                            const syncGlass = () => {
                                if (destroyed) {
                                    disconnectStage();
                                    if (switcherGlass?.visible) switcherGlass.hide();
                                    return;
                                }
                                let isDisposed = false;
                                try {
                                    if (!this || !this.visible || this._destroyed || !this._switcherList) {
                                        isDisposed = true;
                                    }
                                } catch (_) {
                                    isDisposed = true;
                                }
                                if (isDisposed) {
                                    destroyed = true;
                                    disconnectStage();
                                    if (switcherGlass?.visible) switcherGlass.hide();
                                    return;
                                }

                                let slX, slY, slW, slH;
                                try {
                                    [slX, slY] = this._switcherList.get_transformed_position();
                                    [slW, slH] = this._switcherList.get_transformed_size();
                                } catch (_) {
                                    destroyed = true;
                                    disconnectStage();
                                    if (switcherGlass?.visible) switcherGlass.hide();
                                    return;
                                }
                                if (slX == null || slY == null || Number.isNaN(slX) || Number.isNaN(slY) || slW <= 1 || slH <= 1) return;

                                const primary = Main.layoutManager.primaryMonitor;
                                if (!primary) return;

                                const localX = Math.round(slX - primary.x);
                                const localY = Math.round(slY - primary.y);
                                const bgW = Math.round(slW);
                                const bgH = Math.round(slH);

                                const cfg = _macGetAltTabConfig();
                                const blurRad = Math.max(0.0, Number(cfg.blur));
                                const tintStr = Math.max(0.0, Math.min(1.0, cfg.tint / 100.0));
                                const shadowStr = Math.max(0.0, Math.min(1.0, cfg.shadow / 100.0));

                                switcherGlass.opacity = this.opacity;
                                if (this.opacity > 0) {
                                    if (!switcherGlass.visible) switcherGlass.show();
                                } else {
                                    if (switcherGlass.visible) switcherGlass.hide();
                                }

                                switcherGlass.set_position(primary.x, primary.y);
                                switcherGlass.set_size(primary.width, primary.height);
                                switcherGlass.setResolution(primary.width, primary.height);
                                switcherGlass.setCornerRadius(cfg.radius);
                                switcherGlass.setPadding(0);
                                switcherGlass.setBlurRadius(blurRad);
                                switcherGlass.setTintStrength(tintStr);
                                switcherGlass.setTintColor(0.0, 0.0, 0.0);
                                try {
                                    switcherGlass._effect?._setFloat?.('padding', 0.0);
                                    switcherGlass._effect?._setFloat?.('corner_radius', cfg.radius);
                                    switcherGlass._effect?._setFloat?.('shadow_intensity', shadowStr);
                                } catch (_) {}
                                switcherGlass.setGlassGeometry(localX, localY, bgW, bgH);

                                const CLIP_PAD = 160;
                                switcherGlass.set_clip(localX - CLIP_PAD, localY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);

                                if (typeof switcherGlass.syncSources === 'function') {
                                    switcherGlass.syncSources();
                                }
                            };

                            try {
                                if (typeof switcherGlass.forceRefresh === 'function') {
                                    switcherGlass.forceRefresh(1);
                                }
                            } catch (_) {}

                            if (!destroyed) {
                                if (!stageSignalId) {
                                    stageSignalId = global.stage.connect('before-update', syncGlass);
                                }
                                syncGlass();
                            }
                        };

                        const syncGlassInst = (globalThis._macSwitcherGlass && globalThis._macSwitcherGlass.get_parent() && !globalThis._macSwitcherGlass.is_finalized?.())
                            ? globalThis._macSwitcherGlass
                            : null;
                        if (syncGlassInst) {
                            attachGlass(syncGlassInst);
                        } else {
                            (async () => {
                                try {
                                    if (destroyed) return;
                                    const g = await getSwitcherGlass();
                                    if (!g || destroyed) return;
                                    attachGlass(g);
                                } catch (err) {
                                    console.error('[macW1Y] Switcher glass sync error:', err);
                                }
                            })();
                        }

                        return res;
                    };
                }
            } catch (e) {
                console.error('[EvalHelper] patchSwitcherPopupLQVisual error: ' + e);
            }
        };
        patchSwitcherPopupLQVisual();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            patchSwitcherPopupLQVisual();
            return GLib.SOURCE_REMOVE;
        });

        const loadAlertStyling = () => {
            let alertTint = 20;
            let alertBlur = 15;
            let alertShadow = 35;
            try {
                const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
                if (GLib.file_test(confPath, GLib.FileTest.EXISTS)) {
                    const [ok, data] = GLib.file_get_contents(confPath);
                    if (ok) {
                        const text = (data instanceof Uint8Array) ? new TextDecoder().decode(data) : data.toString();
                        const json = JSON.parse(text);
                        if (json.alert_tint !== undefined) alertTint = Number(json.alert_tint);
                        if (json.alert_blur !== undefined) alertBlur = Number(json.alert_blur);
                        if (json.alert_shadow !== undefined) alertShadow = Number(json.alert_shadow);
                    }
                }
            } catch (_) {}
            return { alertTint, alertBlur, alertShadow };
        };

        const patchModalDialogLQVisual = async () => {
            try {
                const ModalDialogMod = await import('resource:///org/gnome/shell/ui/modalDialog.js');
                const ModalDialog = ModalDialogMod.ModalDialog;
                if (!ModalDialog) return;

                try {
                    const DialogMod = await import('resource:///org/gnome/shell/ui/dialog.js');
                    const Dialog = DialogMod.Dialog;
                    if (Dialog && !Dialog.prototype._macButtonPatched) {
                        Dialog.prototype._macButtonPatched = true;
                        if (!Dialog.prototype._macOrigAddButton)
                            Dialog.prototype._macOrigAddButton = Dialog.prototype.addButton;
                        Dialog.prototype.addButton = function (buttonInfo) {
                            if (buttonInfo && typeof buttonInfo.label === 'string') {
                                const trimmed = buttonInfo.label.trim();
                                if (trimmed === 'Завершити роботу' || trimmed === 'Вимкнути живлення' || trimmed === 'Power Off' || trimmed === 'Выключить' || trimmed === 'Ausschalten' || trimmed === 'Éteindre' || trimmed === 'Apagar' || trimmed === 'Spegni' || trimmed === 'Wyłącz') {
                                    buttonInfo.label = t('shutdown_short', 'Вимкнути');
                                }
                            }
                            const btn = Dialog.prototype._macOrigAddButton.call(this, buttonInfo);
                            if (btn) {
                                const checkLabel = () => {
                                    if (btn.label && (btn.label.trim() === 'Завершити роботу' || btn.label.trim() === 'Вимкнути живлення' || btn.label.trim() === 'Power Off' || btn.label.trim() === 'Выключить' || btn.label.trim() === 'Ausschalten' || btn.label.trim() === 'Éteindre' || btn.label.trim() === 'Apagar' || btn.label.trim() === 'Spegni' || btn.label.trim() === 'Wyłącz')) {
                                        btn.label = t('shutdown_short', 'Вимкнути');
                                    }
                                };
                                btn.connectObject?.('notify::label', checkLabel, btn);
                                checkLabel();
                            }
                            return btn;
                        };
                    }
                } catch (_) {}

                const getLiquidGlassPath = () => {
                    const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                    return ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
                };

                const createDialogGlass = async (dialogActor) => {
                    const lgExt = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                    if (!lgExt || lgExt.state !== 1) return null;
                    const path = getLiquidGlassPath();
                    const glassMod = await import(`file://${path}/dist/rendering/backdropGlass.js`);
                    const BackdropGlass = glassMod.BackdropGlass;

                    const stack = dialogActor.backgroundStack;
                    const dialogLayout = dialogActor.dialogLayout;
                    const dialogBox = dialogLayout?._dialog;
                    if (!stack || !dialogBox) return null;
                    if (dialogBox.has_style_class_name?.('mac-empty-trash-dialog')) return null;


                    for (const child of stack.get_children()) {
                        if (child.name === 'liquid-glass-dialog-actor') {
                            stack.remove_child(child);
                            try { child.destroy(); } catch (_) {}
                        }
                    }

                    const exclusions = [
                        dialogActor,
                        dialogLayout,
                        dialogBox,
                        Main.layoutManager?.modalDialogGroup,
                        Main.layoutManager?.screenShieldGroup,
                    ].filter(Boolean);

                    const glass = new BackdropGlass({
                        extensionPath: path,
                        settings: lgExt?.stateObj?._settings || null,
                        logger: console,
                        owner: 'modal-dialog',
                        excludeActors: exclusions,
                    });
                    glass.name = 'liquid-glass-dialog-actor';

                    stack.insert_child_below(glass, dialogLayout);
                    try { glass.set_pivot_point(0.5, 0.5); } catch (_) {}
                    try { glass.x_expand = true; glass.y_expand = true; } catch (_) {}

                    glass.setIsDock(false);
                    glass.setCornerSmoothingEnabled(0.0);
                    glass.setPadding(0);
                    glass._backdropLocked = true;
                    try {
                        glass._effect?._setFloat?.('shadow_intensity', 0.0);
                        glass._effect?._setFloat?.('shadow_radius', 0.0);
                        glass._effect?._setFloat?.('shadow_max_radius', 0.0);
                        glass._effect?._setFloat?.('ao_intensity', 0.0);
                        glass._effect?._setFloat?.('ao_radius', 0.0);
                    } catch (_) {}
                    glass.hide();

                    let checkShaderTimerId = 0;
                    const state = {
                        dialogActor, dialogLayout, dialogBox, glass,
                        lastX: null, lastY: null, lastW: null, lastH: null,
                        stylesApplied: false, shaderShown: false, syncPending: false,
                    };
                    const cleanUpState = () => {
                        if (checkShaderTimerId) {
                            try { GLib.source_remove(checkShaderTimerId); } catch (_) {}
                            checkShaderTimerId = 0;
                        }
                        globalThis._macDlgStates?.delete(state);
                        try { glass.destroy(); } catch (_) {}
                        if (dialogActor._macDlgGlassState === state)
                            delete dialogActor._macDlgGlassState;
                    };
                    const scheduleSyncDialogGlass = () => {
                        if (state.syncPending || dialogActor.is_finalized?.()) return;
                        state.syncPending = true;
                        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                            state.syncPending = false;
                            if (!dialogActor.is_finalized?.() && !glass.is_finalized?.())
                                syncDialogGlass(state);
                            return GLib.SOURCE_REMOVE;
                        });
                    };
                    dialogBox.connectObject(
                        'notify::allocation', scheduleSyncDialogGlass,
                        'notify::position', scheduleSyncDialogGlass,
                        dialogActor
                    );
                    dialogActor.connectObject(
                        'opened', () => {
                            glass._backdropLocked = false;
                            syncDialogGlass(state);
                        },
                        'closed', () => {
                            glass._backdropLocked = true;
                            if (glass.visible) glass.hide();
                            glass.scale_x = 1.0;
                            glass.scale_y = 1.0;
                        },
                        'destroy', cleanUpState,
                        dialogActor
                    );


                    if (!glass._effect?._shadersLoaded) {
                        let shaderChecks = 0;
                        checkShaderTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                            shaderChecks++;
                            if (dialogActor.is_finalized?.() || glass.is_finalized?.() || shaderChecks > 50) {
                                checkShaderTimerId = 0;
                                return GLib.SOURCE_REMOVE;
                            }
                            if (glass._effect?._shadersLoaded) {
                                checkShaderTimerId = 0;
                                syncDialogGlass(state);
                                return GLib.SOURCE_REMOVE;
                            }
                            return GLib.SOURCE_CONTINUE;
                        });
                    }

                    syncDialogGlass(state);
                    return state;
                };

                const syncDialogGlass = (state) => {
                    const { dialogActor, dialogBox, glass } = state;

                    if (!dialogActor || !dialogBox || !glass) return;
                    if (dialogActor.is_finalized?.() || dialogBox.is_finalized?.() || glass.is_finalized?.()) return;

                    const isClosing = (dialogActor._state === ModalDialogMod.State.CLOSING || dialogActor._state === ModalDialogMod.State.CLOSED);
                    const isOpeningOrOpen = dialogActor.visible && dialogActor.mapped && dialogActor.opacity > 0;
                    const shadersReady = (glass._effect?._shadersLoaded === true);

                    const isPromptDialog = dialogActor.has_style_class_name?.('prompt-dialog') ||
                        dialogBox.has_style_class_name?.('prompt-dialog');

                    if (!state.stylesApplied) {
                        state.stylesApplied = true;
                        const styling = loadAlertStyling();
                        const tintStrength = Math.max(0.0, Math.min(1.0, styling.alertTint / 100.0));
                        const shadowIntensity = Math.max(0.0, Math.min(1.0, styling.alertShadow / 100.0));
                        const fallbackBg = shadersReady
                            ? 'transparent'
                            : `rgba(32, 34, 42, ${(0.72 + tintStrength * 0.16).toFixed(2)})`;
                        if (isPromptDialog) {
                            dialogBox.set_style(`background-color: ${fallbackBg} !important; border-radius: 30px !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; box-shadow: 0 18px 48px rgba(0, 0, 0, ${shadowIntensity.toFixed(2)}) !important; min-width: 360px !important; max-width: 440px !important; padding: 18px 20px 16px 20px !important;`);
                        } else {
                            dialogBox.set_style(`background-color: ${fallbackBg} !important; border-radius: 34px !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; box-shadow: 0 16px 45px rgba(0, 0, 0, ${shadowIntensity.toFixed(2)}) !important; width: 260px !important; min-width: 260px !important; max-width: 260px !important; padding: 15px 18px 14px 18px !important;`);
                            try {
                                for (const btnBox of dialogBox.get_children().filter(c => c.has_style_class_name?.('modal-dialog-button-box') || c.get_children?.().some(b => b.has_style_class_name?.('modal-dialog-button')))) {
                                    btnBox.set_style('padding-top: 3px !important; spacing: 8px !important;');
                                }
                                for (const button of dialogBox.get_children().flatMap(child => child.get_children?.() || []).flatMap(child => child.get_children?.() || []).filter(child => child.has_style_class_name?.('modal-dialog-button') || child.has_style_class_name?.('modal-dialog-linked-button'))) {
                                    button.set_style('min-height: 28px !important; height: 28px !important; border-radius: 999px !important; margin: 0 4px !important; padding: 0 10px !important;');
                                    if (button.label && (button.label.trim() === 'Завершити роботу' || button.label.trim() === 'Вимкнути живлення' || button.label.trim() === 'Power Off' || button.label.trim() === 'Выключить' || button.label.trim() === 'Ausschalten' || button.label.trim() === 'Éteindre' || button.label.trim() === 'Apagar' || button.label.trim() === 'Spegni' || button.label.trim() === 'Wyłącz')) {
                                        button.label = t('shutdown_short', 'Вимкнути');
                                    }
                                    const ct = button.get_child?.();
                                    if (ct && (ct.text?.trim() === 'Завершити роботу' || ct.text?.trim() === 'Вимкнути живлення' || ct.text?.trim() === 'Power Off' || ct.text?.trim() === 'Выключить' || ct.text?.trim() === 'Ausschalten' || ct.text?.trim() === 'Éteindre' || ct.text?.trim() === 'Apagar' || ct.text?.trim() === 'Spegni' || ct.text?.trim() === 'Wyłącz')) {
                                        ct.text = t('shutdown_short', 'Вимкнути');
                                    }
                                }
                                for (const mdc of dialogBox.get_children().flatMap(child => child.get_children?.() || []).filter(child => child.has_style_class_name?.('message-dialog-content') || child.name === 'MessageDialogContent')) {
                                    mdc.set_x_align(Clutter.ActorAlign.START);
                                    mdc.set_style('text-align: left !important; x-align: start !important; spacing: 3px !important;');
                                }
                                for (const label of dialogBox.get_children().flatMap(child => child.get_children?.() || []).flatMap(child => child.get_children?.() || []).filter(child => child.has_style_class_name?.('message-dialog-title') || child.has_style_class_name?.('message-dialog-description'))) {
                                    label.set_x_align(Clutter.ActorAlign.START);
                                    if (label.clutter_text) {
                                        label.clutter_text.set_line_alignment(Pango.Alignment.LEFT);
                                        label.clutter_text.set_x_align(Clutter.ActorAlign.START);
                                    }
                                    if (label.has_style_class_name?.('message-dialog-title')) {
                                        label.set_style('text-align: left !important; x-align: start !important; margin-left: 4px !important; margin-right: 4px !important; margin-bottom: 2px !important;');
                                    } else {
                                        label.set_style('text-align: left !important; x-align: start !important; margin-left: 4px !important; margin-right: 4px !important; margin-top: 0px !important;');
                                    }
                                }
                            } catch (_) {}
                        }
                    }

                    if (isClosing || !shadersReady) {
                        if (glass.visible && isClosing) glass.hide();
                        return;
                    }

                    if (!state.shaderShown) {
                        state.shaderShown = true;
                        const styling = loadAlertStyling();
                        const shadowIntensity = Math.max(0.0, Math.min(1.0, styling.alertShadow / 100.0));
                        if (isPromptDialog) {
                            dialogBox.set_style(`background-color: transparent !important; border-radius: 30px !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; box-shadow: 0 18px 48px rgba(0, 0, 0, ${shadowIntensity.toFixed(2)}) !important; min-width: 360px !important; max-width: 440px !important; padding: 18px 20px 16px 20px !important;`);
                        } else {
                            dialogBox.set_style(`background-color: transparent !important; border-radius: 34px !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; box-shadow: 0 16px 45px rgba(0, 0, 0, ${shadowIntensity.toFixed(2)}) !important; width: 260px !important; min-width: 260px !important; max-width: 260px !important; padding: 15px 18px 14px 18px !important;`);
                        }
                    }

                    let monitorIndex = -1;
                    try {
                        const mc = dialogActor._monitorConstraint;
                        if (mc && mc.index !== undefined) monitorIndex = mc.index;
                    } catch (_) {}
                    if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();
                    let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
                    const screenW = Math.max(1, monitor?.width ?? 1);
                    const screenH = Math.max(1, monitor?.height ?? 1);

                    const box = dialogBox.get_allocation_box();
                    let bgW = Math.round(box.x2 - box.x1);
                    let bgH = Math.round(box.y2 - box.y1);
                    if (bgW <= 1 || bgH <= 1) {
                        const [w, h] = dialogBox.get_size();
                        bgW = Math.round(w);
                        bgH = Math.round(h);
                    }
                    if (bgW <= 1 || bgH <= 1) return;

                    let localBgX = Math.round(box.x1);
                    let localBgY = Math.round(box.y1);
                    if (localBgX <= 0 || (localBgX + bgW > screenW)) {
                        localBgX = Math.round((screenW - bgW) / 2);
                    }
                    if (localBgY <= 0 || (localBgY + bgH > screenH)) {
                        localBgY = Math.round((screenH - bgH) / 2);
                    }

                    const geometryChanged = state.lastX !== localBgX || state.lastY !== localBgY || state.lastW !== bgW || state.lastH !== bgH || state.forceResync;
                    if (geometryChanged) {
                        state.lastX = localBgX;
                        state.lastY = localBgY;
                        state.lastW = bgW;
                        state.lastH = bgH;
                        state.forceResync = false;

                        const styling = loadAlertStyling();
                        const tintStrength = Math.max(0.0, Math.min(1.0, styling.alertTint / 100.0));
                        const blurRadius = Math.max(0.0, Math.min(30.0, styling.alertBlur));
                        const shadowIntensity = Math.max(0.0, Math.min(1.0, styling.alertShadow / 100.0));
                        const radius = isPromptDialog ? 30.0 : 34.0;

                        glass.setResolution(screenW, screenH);
                        glass.setCornerRadius(radius);
                        glass.setTintColor(0.0, 0.0, 0.0);
                        glass.setTintStrength(tintStrength);
                        glass.setBlurRadius(blurRadius);
                        glass.setPadding(0);
                        glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);

                        try {
                            glass._effect?._setFloat?.('shadow_intensity', shadowIntensity);
                            glass._effect?._setFloat?.('shadow_radius', shadowIntensity * 25.0);
                            glass._effect?._setFloat?.('shadow_max_radius', Math.max(25.0, shadowIntensity * 50.0));
                            glass._effect?._setFloat?.('ao_intensity', shadowIntensity * 0.35);
                            glass._effect?._setFloat?.('ao_radius', shadowIntensity * 15.0);
                        } catch (_) {}

                        const CLIP_PAD = 40;
                        glass.set_clip(localBgX - CLIP_PAD, localBgY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);
                    }

                    if (isOpeningOrOpen) {
                        if (!glass.visible) {
                            glass.opacity = 0;
                            glass.show();
                            glass.ease({
                                opacity: dialogActor.opacity,
                                duration: 120,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            });
                        } else if (!glass.get_transition('opacity') && !glass.get_transition('scale-x') && !glass.get_transition('scale-y')) {
                            glass.opacity = dialogActor.opacity;
                        }
                    }

                    if (geometryChanged && isOpeningOrOpen && !glass._backdropLocked && typeof glass.syncSources === 'function') {
                        glass.syncSources();
                    }
                };

                const syncAllDialogs = () => {
                    if (!globalThis._macDlgStates || globalThis._macDlgStates.size === 0) return;
                    for (const state of [...globalThis._macDlgStates]) {
                        try {
                            state.forceResync = true;
                            syncDialogGlass(state);
                        } catch (_) {}
                    }
                };
                globalThis._macSyncDialogAlertStyling = syncAllDialogs;

                const attachDialogGlass = (dialogActor) => {
                    try {
                        if (!dialogActor) return;
                        const lightbox = dialogActor._lightbox;
                        if (lightbox) {
                            lightbox._radialEffect = false;
                            lightbox._fadeFactor = 0;
                            lightbox.opacity = 0;
                        }
                        if (dialogActor._macDlgGlassState) {
                            if (dialogActor._macDlgGlassState !== 'pending') {
                                if (globalThis._macDlgStates && !globalThis._macDlgStates.has(dialogActor._macDlgGlassState)) {
                                    globalThis._macDlgStates.add(dialogActor._macDlgGlassState);
                                }
                            }
                            return;
                        }
                        const stack = dialogActor.backgroundStack;
                        const dialogLayout = dialogActor.dialogLayout;
                        if (!stack || !dialogLayout?._dialog) return;
                        if (dialogLayout._dialog.has_style_class_name?.('mac-empty-trash-dialog')) return;
                        dialogActor._macDlgGlassState = 'pending';
                        createDialogGlass(dialogActor).then((state) => {
                            if (!state) { delete dialogActor._macDlgGlassState; return; }
                            globalThis._macDlgStates.add(state);
                            dialogActor._macDlgGlassState = state;
                        }).catch(() => { delete dialogActor._macDlgGlassState; });
                    } catch (_) {}
                };

                const attachIfSystemDialog = (child) => {
                    try {
                        if (child?.backgroundStack && child?.dialogLayout) attachDialogGlass(child);
                    } catch (_) {}
                };

                if (!globalThis._macDlgStates) {
                    globalThis._macDlgStates = new Set();
                } else {

                    globalThis._macDlgStates.clear();
                }
                if (globalThis._macDlgStageId) {
                    try { global.stage.disconnect(globalThis._macDlgStageId); } catch (_) {}
                    globalThis._macDlgStageId = 0;
                }
                if (globalThis._macDlgChildId) {
                    try {
                        Main.layoutManager.modalDialogGroup?.disconnect(globalThis._macDlgChildId);
                    } catch (_) {}
                    globalThis._macDlgChildId = 0;
                }



                const mg = Main.layoutManager.modalDialogGroup;
                if (mg) {
                    globalThis._macDlgChildId = mg.connect('child-added', (_, child) => attachIfSystemDialog(child));
                    for (const child of mg.get_children()) attachIfSystemDialog(child);
                }
                try { if (Main.endSessionDialog) attachIfSystemDialog(Main.endSessionDialog); } catch (_) {}

                globalThis._macAttachDialogGlass = attachDialogGlass;
                if (!ModalDialog.prototype._macRecoveryAlertPatchedV2) {
                    ModalDialog.prototype._macRecoveryAlertPatchedV2 = true;
                    if (!ModalDialog.prototype._macOrigOpen)
                        ModalDialog.prototype._macOrigOpen = ModalDialog.prototype.open;
                    if (!ModalDialog.prototype._macOrigClose)
                        ModalDialog.prototype._macOrigClose = ModalDialog.prototype.close;
                    if (!ModalDialog.prototype._macOrigFadeOpen)
                        ModalDialog.prototype._macOrigFadeOpen = ModalDialog.prototype.fadeOpen || ModalDialog.prototype._fadeOpen;
                    ModalDialog.prototype._fadeOpen = function (...args) {
                        const result = ModalDialog.prototype._macOrigFadeOpen.call(this, ...args);
                        const content = this.dialogLayout;
                        const glass = this.backgroundStack?.get_children?.().find(c => c.name === 'liquid-glass-dialog-actor');
                        const START_SCALE = 0.84;
                        const ANIM_DURATION = 260;
                        const ANIM_MODE = Clutter.AnimationMode.EASE_OUT_CUBIC;

                        if (glass) {
                            glass._backdropLocked = true;
                            if (glass._effect?._shadersLoaded) {
                                glass.show();
                                glass.remove_all_transitions();
                                glass.set_pivot_point(0.5, 0.5);
                                glass.scale_x = START_SCALE;
                                glass.scale_y = START_SCALE;
                                glass.opacity = 0;
                                glass.ease({
                                    scale_x: 1.0,
                                    scale_y: 1.0,
                                    opacity: 255,
                                    duration: ANIM_DURATION,
                                    mode: ANIM_MODE,
                                    onComplete: () => {
                                        glass._backdropLocked = false;
                                        glass.wakeFrameSync?.();
                                    },
                                });
                            }
                        }
                        if (content) {
                            content.remove_all_transitions();
                            content.set_pivot_point(0.5, 0.5);
                            content.scale_x = START_SCALE;
                            content.scale_y = START_SCALE;
                            content.opacity = 0;
                            content.ease({
                                scale_x: 1.0,
                                scale_y: 1.0,
                                opacity: 255,
                                duration: ANIM_DURATION,
                                mode: ANIM_MODE,
                                onComplete: () => {
                                    if (glass) glass._backdropLocked = false;
                                    if (this._macDlgGlassState && typeof this._macDlgGlassState === 'object') {
                                        syncDialogGlass(this._macDlgGlassState);
                                    }
                                },
                            });
                        }
                        return result;
                    };
                    ModalDialog.prototype.open = function (...args) {
                        try {
                            if (this.dialogLayout) {
                                this.dialogLayout.scale_x = 1.0;
                                this.dialogLayout.scale_y = 1.0;
                            }
                            const glass = this.backgroundStack?.get_children?.().find(c => c.name === 'liquid-glass-dialog-actor');
                            if (glass) {
                                glass.scale_x = 1.0;
                                glass.scale_y = 1.0;
                            }
                            globalThis._macAttachDialogGlass?.(this);
                        } catch (_) {}
                        return ModalDialog.prototype._macOrigOpen.call(this, ...args);
                    };
                    ModalDialog.prototype.close = function (...args) {
                        if (this.state === ModalDialogMod.State.CLOSED || this.state === ModalDialogMod.State.CLOSING)
                            return;
                        const glass = this.backgroundStack?.get_children?.().find(c => c.name === 'liquid-glass-dialog-actor');
                        if (glass) {
                            glass.ease({
                                scale_x: 0.84,
                                scale_y: 0.84,
                                opacity: 0,
                                duration: 160,
                                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                                onComplete: () => {
                                    if (glass.visible) glass.hide();
                                    glass.scale_x = 1.0;
                                    glass.scale_y = 1.0;
                                },
                            });
                        }
                        if (this._shouldFadeOut) {
                            this._setState(ModalDialogMod.State.CLOSING);
                            this.popModal();
                            this._savedKeyFocus = null;
                            const content = this.dialogLayout;
                            this.ease({
                                opacity: 0,
                                duration: 160,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => this._closeComplete(),
                            });
                            if (content) {
                                content.ease({
                                    scale_x: 0.84,
                                    scale_y: 0.84,
                                    opacity: 0,
                                    duration: 160,
                                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                                    onComplete: () => {
                                        content.scale_x = 1.0;
                                        content.scale_y = 1.0;
                                    },
                                });
                            }
                            return;
                        }
                        const content = this.dialogLayout;
                        if (content) {
                            this._setState(ModalDialogMod.State.CLOSING);
                            this.popModal();
                            this._savedKeyFocus = null;
                            content.remove_all_transitions();
                            content.ease({
                                scale_x: 0.72,
                                scale_y: 0.72,
                                opacity: 0,
                                duration: 180,
                                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                                onComplete: () => {
                                    content.scale_x = 1.0;
                                    content.scale_y = 1.0;
                                    this._closeComplete();
                                },
                            });
                            this.ease({
                                opacity: 0,
                                duration: 180,
                                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                            });
                            return;
                        }
                        return ModalDialog.prototype._macOrigClose.call(this, ...args);
                    };
                }
            } catch (e) {
                console.error('[EvalHelper] patchModalDialogLQVisual error: ' + e);
            }
        };
        patchModalDialogLQVisual();


        const emptyTrashInternal = () => {
            try {
                const bus = Gio.DBus.session;
                bus.call(
                    'org.gnome.Nautilus',
                    '/org/gnome/Nautilus/FileOperations',
                    'org.gnome.Nautilus.FileOperations2',
                    'EmptyTrashRemote',
                    new GLib.Variant('(ba{sv})', [false, {}]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (conn, res) => {
                        try {
                            conn.call_finish(res);
                        } catch (_) {
                            try {
                                bus.call(
                                    'org.gnome.Nautilus',
                                    '/org/gnome/Nautilus/FileOperations',
                                    'org.gnome.Nautilus.FileOperations',
                                    'EmptyTrashRemote',
                                    new GLib.Variant('(ba{sv})', [false, {}]),
                                    null,
                                    Gio.DBusCallFlags.NONE,
                                    -1,
                                    null,
                                    null
                                );
                            } catch (_) {}
                        }
                    }
                );
            } catch (_) {}


            try {
                const trashFile = Gio.File.new_for_uri('trash:///');
                trashFile.enumerate_children_async(
                    'standard::name',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    GLib.PRIORITY_LOW,
                    null,
                    (file, res) => {
                        try {
                            const enumerator = file.enumerate_children_finish(res);
                            let info;
                            while ((info = enumerator.next_file(null)) !== null) {
                                const child = file.get_child(info.get_name());
                                try { child.delete(null); } catch (_) {}
                            }
                        } catch (_) {}
                    }
                );
            } catch (_) {}
        };

        const showMacEmptyTrashDialog = async () => {
            try {
                const tr = (k, fb) => {
                    try {
                        if (typeof t === 'function') return t(k, fb);
                    } catch (_) {}
                    return fb;
                };

                if (globalThis._macActiveEmptyTrashDialog) {
                    try { globalThis._macActiveEmptyTrashDialog.close(); } catch (_) {}
                    globalThis._macActiveEmptyTrashDialog = null;
                }
                if (globalThis._macRestoreTrashPanel) {
                    try { globalThis._macRestoreTrashPanel(); } catch (_) {}
                    globalThis._macRestoreTrashPanel = null;
                }

                try {
                    const ui = Main.layoutManager.uiGroup;
                    for (const c of ui.get_children()) {
                        if (c.name === 'macPanelDimScrim') {
                            try { c.destroy(); } catch (_) {}
                        }
                    }
                    if (Main.panel) Main.panel.opacity = 255;
                } catch (_) {}

                const ModalDialogMod = await import('resource:///org/gnome/shell/ui/modalDialog.js');
                const ModalDialog = ModalDialogMod.ModalDialog;
                if (!ModalDialog) return;

                const dlg = new ModalDialog({
                    styleClass: 'modal-dialog mac-empty-trash-dialog',
                    destroyOnClose: true,
                });

                const styling = loadAlertStyling();
                const tintStrength = Math.max(0.0, Math.min(1.0, styling.alertTint / 100.0));
                const blurRadius = Math.max(8, Math.min(24, styling.alertBlur || 18));
                const shadowIntensity = Math.max(0.0, Math.min(1.0, styling.alertShadow / 100.0));
                const cardBg = `rgba(32, 34, 42, ${(0.62 + tintStrength * 0.22).toFixed(2)})`;
                const shadowVal = (shadowIntensity * 0.85).toFixed(2);

                const d = dlg.dialogLayout?._dialog;
                if (d) {
                    d.add_style_class_name('mac-empty-trash-dialog');
                    try {
                        const blur = new Shell.BlurEffect({
                            mode: Shell.BlurMode.BACKGROUND,
                            radius: Math.round(blurRadius),
                        });
                        blur.name = 'mac-alert-blur-effect';
                        d.add_effect(blur);
                    } catch (_) {}
                    d.set_style(`background-color: ${cardBg} !important; border-radius: 24px !important; border: 1px solid rgba(255, 255, 255, 0.20) !important; border-top: 1px solid rgba(255, 255, 255, 0.28) !important; box-shadow: 0 20px 50px rgba(0, 0, 0, ${shadowVal}) !important; width: 260px !important; min-width: 260px !important; max-width: 260px !important; padding: 18px 18px 14px 18px !important;`);
                }

                const content = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 0px; width: 224px;',
                });

                const iconBox = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'margin-bottom: 8px;',
                });
                const warnIcon = new St.Icon({
                    icon_name: 'dialog-warning-symbolic',
                    icon_size: 36,
                    style: 'color: #fac01f; -st-icon-style: symbolic;',
                });
                iconBox.add_child(warnIcon);
                content.add_child(iconBox);

                const title = new St.Label({
                    text: tr('empty_trash_prompt', 'Спорожнити смітник?'),
                    style: 'font-size: 14.5px; font-weight: 700; color: #ffffff; text-align: center; margin-bottom: 3px;',
                });
                title.clutter_text.set_line_wrap(true);
                title.clutter_text.set_x_align(Clutter.ActorAlign.CENTER);
                content.add_child(title);

                const body = new St.Label({
                    text: tr('empty_trash_desc', 'Усі об’єкти у смітнику буде\nвилучено остаточно.'),
                    style: 'font-size: 12px; color: rgba(255, 255, 255, 0.72); text-align: center; margin-bottom: 12px; line-height: 1.3;',
                });
                body.clutter_text.set_line_wrap(true);
                body.clutter_text.set_x_align(Clutter.ActorAlign.CENTER);
                content.add_child(body);

                dlg.contentLayout.add_child(content);

                const bl = dlg.dialogLayout.buttonLayout;
                bl.layout_manager.orientation = Clutter.Orientation.HORIZONTAL;
                bl.layout_manager.spacing = 8;
                bl.set_style('padding: 0 !important; margin: 0 !important; width: 224px !important;');

                const cancelBtn = dlg.addButton({
                    label: tr('cancel', 'Скасувати'),
                    action: () => dlg.close(),
                    key: Clutter.KEY_Escape,
                });
                const updateCancelStyle = () => {
                    const bg = cancelBtn.hover ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.14)';
                    cancelBtn.set_style(`background-color: ${bg} !important; background-gradient-direction: none !important; color: white !important; font-weight: 500; font-size: 13px; border: 1px solid rgba(255, 255, 255, 0.16) !important; border-radius: 9999px !important; min-height: 28px; height: 28px; min-width: 108px; width: 108px !important; margin: 0; padding: 0 10px;`);
                };
                cancelBtn.connect('notify::hover', updateCancelStyle);
                updateCancelStyle();

                const getConfirmText = () => {
                    const full = tr('empty_trash_action', 'Спорожнити');
                    if (full === 'Спорожнити смітник') return 'Спорожнити';
                    if (full === 'Очистить корзину') return 'Очистить';
                    if (full === 'Vaciar la papelera') return 'Vaciar';
                    if (full === 'Papierkorb leeren') return 'Leeren';
                    return full;
                };

                const confirmBtn = dlg.addButton({
                    label: getConfirmText(),
                    action: () => {
                        dlg.close();
                        emptyTrashInternal();
                    },
                    default: true,
                });
                const updateConfirmStyle = () => {
                    const bg = confirmBtn.hover ? '#ff453a' : '#eb5545';
                    confirmBtn.set_style(`background-color: ${bg} !important; background-gradient-direction: none !important; color: white !important; font-weight: 600; font-size: 13px; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 9999px !important; min-height: 28px; height: 28px; min-width: 108px; width: 108px !important; margin: 0; padding: 0 10px;`);
                };
                confirmBtn.connect('notify::hover', updateConfirmStyle);
                updateConfirmStyle();

                dlg.connect('destroy', () => {
                    if (globalThis._macActiveEmptyTrashDialog === dlg)
                        globalThis._macActiveEmptyTrashDialog = null;
                });

                dlg.open();
                globalThis._macActiveEmptyTrashDialog = dlg;
            } catch (e) {
                console.error('[EvalHelper] showMacEmptyTrashDialog error: ' + e);
            }
        };

        globalThis.showMacEmptyTrashDialog = showMacEmptyTrashDialog;


        try {
            const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
            const confFile = Gio.File.new_for_path(confPath);
            if (this._stylingMonitor) {
                try { this._stylingMonitor.cancel(); } catch (_) {}
            }
            this._stylingMonitor = confFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._stylingMonitor.connect('changed', () => {
                if (typeof globalThis._macSyncDialogAlertStyling === 'function') {
                    globalThis._macSyncDialogAlertStyling();
                }
                if (typeof globalThis._macSyncNotificationStyling === 'function') {
                    globalThis._macSyncNotificationStyling();
                }
                if (typeof globalThis._macSyncLabelStyling === 'function') {
                    globalThis._macSyncLabelStyling();
                }
                if (typeof globalThis._macSyncDockStyling === 'function') {
                    globalThis._macSyncDockStyling();
                }
                if (typeof globalThis._macSyncAltTabStyling === 'function') {
                    globalThis._macSyncAltTabStyling();
                }
            });
        } catch (_) {}


        const syncAltTabStyling = () => {
            try {
                let iconSize, padding, spacing, radius, blur, tint, shadow;
                if (typeof globalThis._macGetAltTabConfigFn === 'function') {
                    ({ iconSize, padding, spacing, radius, blur, tint, shadow } = globalThis._macGetAltTabConfigFn());
                } else {
                    const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
                    let conf = {};
                    if (GLib.file_test(confPath, GLib.FileTest.EXISTS)) {
                        const [ok, bytes] = GLib.file_get_contents(confPath);
                        if (ok) conf = JSON.parse(new TextDecoder().decode(bytes));
                    }
                    iconSize = (typeof conf.alttab_icon_size === 'number') ? conf.alttab_icon_size : 67;
                    padding = (typeof conf.alttab_padding === 'number') ? conf.alttab_padding : 9;
                    spacing = (typeof conf.alttab_spacing === 'number') ? conf.alttab_spacing : 12;
                    radius = (typeof conf.alttab_radius === 'number') ? conf.alttab_radius : 34;
                    blur = (typeof conf.alttab_blur === 'number') ? conf.alttab_blur : 20;
                    tint = (typeof conf.alttab_tint === 'number') ? conf.alttab_tint : 15;
                    shadow = (typeof conf.alttab_shadow === 'number') ? conf.alttab_shadow : 25;
                    globalThis._macAltTabConfig = { iconSize, padding, spacing, radius, blur, tint, shadow };
                }
                if (globalThis._macSwitcherGlass) {
                    if (typeof globalThis._macSwitcherGlass.setCornerRadius === 'function') {
                        globalThis._macSwitcherGlass.setCornerRadius(radius);
                    }
                    if (typeof globalThis._macSwitcherGlass.setPadding === 'function') {
                        globalThis._macSwitcherGlass.setPadding(0);
                    }
                    try {
                        globalThis._macSwitcherGlass._effect?._setFloat?.('padding', 0.0);
                        globalThis._macSwitcherGlass._effect?._setFloat?.('corner_radius', radius);
                    } catch (_) {}
                    if (typeof globalThis._macSwitcherGlass.setBlurRadius === 'function') {
                        globalThis._macSwitcherGlass.setBlurRadius(blur);
                    }
                    if (typeof globalThis._macSwitcherGlass.setTintStrength === 'function') {
                        globalThis._macSwitcherGlass.setTintStrength(tint / 100.0);
                    }
                    try {
                        globalThis._macSwitcherGlass._effect?._setFloat?.('shadow_intensity', shadow / 100.0);
                    } catch (_) {}
                    if (typeof globalThis._macSwitcherGlass.forceRefresh === 'function') {
                        globalThis._macSwitcherGlass.forceRefresh(1);
                    }
                }
            } catch (e) {
                console.error('[EvalHelper] syncAltTabStyling error: ' + e);
            }
        };
        globalThis._macSyncAltTabStyling = syncAltTabStyling;
        syncAltTabStyling();


        let _sharedEnsureTail = null;

        const installUnifiedDockLabelHandler = () => {
            try {
                const ARROW_MASK_SHADER = `
uniform sampler2D tex;
uniform float pos_side;
void main() {
    vec2 uv = cogl_tex_coord_in[0].xy;
    float dist = 0.0;
    if (pos_side > 1.5 && pos_side < 2.5) {
        float t = clamp((uv.y - 0.125) / 0.875, 0.0, 1.0);
        float maxHalf = 0.5 * (1.0 - t);
        dist = abs(uv.x - 0.5) - maxHalf;
    } else if (pos_side < 0.5) {
        float t = clamp(uv.y / 0.875, 0.0, 1.0);
        float maxHalf = 0.5 * t;
        dist = abs(uv.x - 0.5) - maxHalf;
    } else if (pos_side > 2.5) {
        float t = clamp(uv.x / 0.875, 0.0, 1.0);
        float maxHalf = 0.5 * t;
        dist = abs(uv.y - 0.5) - maxHalf;
    } else {
        float t = clamp((uv.x - 0.125) / 0.875, 0.0, 1.0);
        float maxHalf = 0.5 * (1.0 - t);
        dist = abs(uv.y - 0.5) - maxHalf;
    }
    float a = 1.0 - smoothstep(-0.06, 0.0, dist);
    vec4 c = texture2D(tex, uv);
    cogl_color_out = c * a * cogl_color_in;
}
`;

                const _posToFloat = (pos) => {
                    if (pos === St.Side.TOP) return 0.0;
                    if (pos === St.Side.RIGHT) return 1.0;
                    if (pos === St.Side.LEFT) return 3.0;
                    return 2.0; // St.Side.BOTTOM
                };

                const _updateTailPos = (label, position) => {
                    const tail = label._arrowTailActor;
                    if (!tail || !label.get_stage())
                        return;
                    label._arrowPos = position;

                    const [minW, natW] = label.get_preferred_width(-1);
                    const pillWidth = Math.ceil(natW > 0 ? natW : (label.width > 0 ? label.width : 50));
                    if (pillWidth <= 0)
                        return;

                    const [minH, natH] = label.get_preferred_height(pillWidth);
                    const pillHeight = Math.ceil(natH > 0 ? natH : (label.height > 0 ? label.height : 25));

                    const rise = 7.0;
                    const halfBase = 5.0;
                    const baseW = 2.0 * halfBase;
                    const padX = 6.0;
                    const padY = 6.0;

                    let tailW, tailH, posX, posY;
                    const lx = Math.round(label.x);
                    const ly = Math.round(label.y);
                    const cx = Math.round(lx + pillWidth / 2.0);
                    const cy = Math.round(ly + pillHeight / 2.0);

                    let arrowX = 0, arrowY = 0, arrowBoxW = baseW, arrowBoxH = rise + 1.0;

                    if (position === St.Side.TOP) {
                        tailW = pillWidth + 2 * padX;
                        tailH = pillHeight + rise + 2 * padY;
                        posX = lx - padX;
                        posY = ly - rise - padY;

                        arrowBoxW = baseW;
                        arrowBoxH = rise + 1.0;
                        arrowX = Math.round(cx - halfBase);
                        arrowY = Math.round(ly - rise);
                    } else if (position === St.Side.LEFT) {
                        tailW = pillWidth + rise + 2 * padX;
                        tailH = pillHeight + 2 * padY;
                        posX = lx - rise - padX;
                        posY = ly - padY;

                        arrowBoxW = rise + 1.0;
                        arrowBoxH = baseW;
                        arrowX = Math.round(lx - rise);
                        arrowY = Math.round(cy - halfBase);
                    } else if (position === St.Side.RIGHT) {
                        tailW = pillWidth + rise + 2 * padX;
                        tailH = pillHeight + 2 * padY;
                        posX = lx - padX;
                        posY = ly - padY;

                        arrowBoxW = rise + 1.0;
                        arrowBoxH = baseW;
                        arrowX = Math.round(lx + pillWidth - 1.0);
                        arrowY = Math.round(cy - halfBase);
                    } else {
                        // St.Side.BOTTOM
                        tailW = pillWidth + 2 * padX;
                        tailH = pillHeight + rise + 2 * padY;
                        posX = lx - padX;
                        posY = ly - padY;

                        arrowBoxW = baseW;
                        arrowBoxH = rise + 1.0;
                        arrowX = Math.round(cx - halfBase);
                        arrowY = Math.round(ly + pillHeight - 1.0);
                    }

                    tail.set_size(Math.round(tailW), Math.round(tailH));
                    tail.set_position(Math.round(posX), Math.round(posY));
                    try {
                        const tBox = new Clutter.ActorBox();
                        tBox.x1 = posX;
                        tBox.y1 = posY;
                        tBox.x2 = posX + tailW;
                        tBox.y2 = posY + tailH;
                        tail.allocate(tBox);
                    } catch (_) {}

                    if (label._blurActor) {
                        label._blurActor.set_size(pillWidth, pillHeight);
                        label._blurActor.set_position(lx, ly);
                        try {
                            const bBox = new Clutter.ActorBox();
                            bBox.x1 = lx;
                            bBox.y1 = ly;
                            bBox.x2 = lx + pillWidth;
                            bBox.y2 = ly + pillHeight;
                            label._blurActor.allocate(bBox);
                        } catch (_) {}
                        if (label._blurActor._blurEff && 'corner_radius' in label._blurActor._blurEff) {
                            label._blurActor._blurEff.corner_radius = Math.round(pillHeight / 2);
                        }
                    }

                    if (label._blurArrowActor) {
                        label._blurArrowActor.set_size(arrowBoxW, arrowBoxH);
                        label._blurArrowActor.set_position(arrowX, arrowY);
                        try {
                            const aBox = new Clutter.ActorBox();
                            aBox.x1 = arrowX;
                            aBox.y1 = arrowY;
                            aBox.x2 = arrowX + arrowBoxW;
                            aBox.y2 = arrowY + arrowBoxH;
                            label._blurArrowActor.allocate(aBox);
                        } catch (_) {}
                        if (label._blurArrowActor._maskShader) {
                            try {
                                label._blurArrowActor._maskShader.set_uniform_value('pos_side', _posToFloat(position));
                            } catch (_) {}
                        }
                    }

                    tail.queue_repaint();
                };

                const _ensureTail = (label, position) => {
                    if (!label)
                        return;

                    if (label._arrowTail && label.contains(label._arrowTail)) {
                        label.remove_child(label._arrowTail);
                        label._arrowTail.destroy();
                        label._arrowTail = null;
                    }

                    const labelBlurEff = label.get_effects?.()?.find(e => e.name === 'tahoe-label-blur');
                    if (labelBlurEff) {
                        labelBlurEff.enabled = false;
                    }

                    if (label._blurActor && (!label._blurActor.get_parent?.() || label._blurActor._isDisposed)) {
                        try {
                            Main.uiGroup.remove_child(label._blurActor);
                            label._blurActor.destroy();
                        } catch (_) {}
                        label._blurActor = null;
                    }

                    if (label._blurArrowActor && (!label._blurArrowActor.get_parent?.() || label._blurArrowActor._isDisposed)) {
                        try {
                            Main.uiGroup.remove_child(label._blurArrowActor);
                            label._blurArrowActor.destroy();
                        } catch (_) {}
                        label._blurArrowActor = null;
                    }

                    const cfg = globalThis._macLabelStylingConfig || { blur: 20, tint: 20, shadow: 25 };
                    const radius = (typeof cfg.blur === 'number') ? cfg.blur : 20;

                    if (!label._blurActor) {
                        const blurActor = new St.Widget({
                            style_class: 'dash-label-blur-pill',
                            reactive: false,
                        });
                        blurActor.set_style('background: rgba(0, 0, 0, 0.01) !important; border: none !important; box-shadow: none !important;');
                        label._blurActor = blurActor;

                        if (Blur?.BlurEffect) {
                            blurActor._blurEff = new Blur.BlurEffect({
                                name: 'dash-label-pill-blur',
                                mode: 1,
                                radius: radius,
                                corner_radius: 13,
                                brightness: 1.0,
                            });
                            blurActor.add_effect(blurActor._blurEff);
                            blurActor._blurEff.enabled = (radius > 0);
                        } else if (Shell?.BlurEffect) {
                            blurActor._blurEff = new Shell.BlurEffect({
                                name: 'dash-label-pill-blur',
                                mode: Shell.BlurMode.BACKGROUND,
                                radius: radius,
                            });
                            blurActor.add_effect(blurActor._blurEff);
                            blurActor._blurEff.enabled = (radius > 0);
                        }

                        Main.uiGroup.add_child(blurActor);

                        label.bind_property('visible', blurActor, 'visible', GObject.BindingFlags.SYNC_CREATE);
                        label.bind_property('opacity', blurActor, 'opacity', GObject.BindingFlags.SYNC_CREATE);
                    } else if (label._blurActor._blurEff) {
                        label._blurActor._blurEff.enabled = (radius > 0);
                        label._blurActor._blurEff.radius = radius;
                    }

                    if (!label._blurArrowActor) {
                        const arrowBlur = new St.Widget({
                            style_class: 'dash-label-blur-arrow',
                            reactive: false,
                        });
                        arrowBlur.set_style('background: rgba(0, 0, 0, 0.01) !important; border: none !important; box-shadow: none !important;');
                        label._blurArrowActor = arrowBlur;

                        if (Blur?.BlurEffect) {
                            arrowBlur._blurEff = new Blur.BlurEffect({
                                name: 'dash-label-arrow-blur',
                                mode: 1,
                                radius: radius,
                                corner_radius: 0,
                                brightness: 1.0,
                            });
                            arrowBlur.add_effect(arrowBlur._blurEff);
                            arrowBlur._blurEff.enabled = (radius > 0);
                        } else if (Shell?.BlurEffect) {
                            arrowBlur._blurEff = new Shell.BlurEffect({
                                name: 'dash-label-arrow-blur',
                                mode: Shell.BlurMode.BACKGROUND,
                                radius: radius,
                            });
                            arrowBlur.add_effect(arrowBlur._blurEff);
                            arrowBlur._blurEff.enabled = (radius > 0);
                        }

                        try {
                            const shader = new Clutter.ShaderEffect();
                            shader.set_shader_source(ARROW_MASK_SHADER);
                            shader.set_uniform_value('pos_side', _posToFloat(position));
                            arrowBlur._maskShader = shader;
                            arrowBlur.add_effect(shader);
                        } catch (e) {
                            console.warn(`[eval-helper] arrow blur mask shader error: ${e}`);
                        }

                        Main.uiGroup.add_child(arrowBlur);

                        label.bind_property('visible', arrowBlur, 'visible', GObject.BindingFlags.SYNC_CREATE);
                        label.bind_property('opacity', arrowBlur, 'opacity', GObject.BindingFlags.SYNC_CREATE);
                    } else if (label._blurArrowActor._blurEff) {
                        label._blurArrowActor._blurEff.enabled = (radius > 0);
                        label._blurArrowActor._blurEff.radius = radius;
                        if (label._blurArrowActor._maskShader) {
                            try {
                                label._blurArrowActor._maskShader.set_uniform_value('pos_side', _posToFloat(position));
                            } catch (_) {}
                        }
                    }

                    if (label._arrowTailActor && (!label._arrowTailActor.get_parent?.() || label._arrowTailActor._isDisposed)) {
                        try {
                            Main.uiGroup.remove_child(label._arrowTailActor);
                            label._arrowTailActor.destroy();
                        } catch (_) {}
                        label._arrowTailActor = null;
                    }

                    if (!label._arrowTailActor) {
                        const tail = new St.DrawingArea({ style_class: 'dash-label-tail', reactive: false });
                        label._arrowTailActor = tail;

                        tail.connect('repaint', (area) => {
                            const cr = area.get_context();
                            cr.setAntialias(cairo.Antialias.SUBPIXEL);
                            cr.setLineCap(cairo.LineCap.ROUND);
                            cr.setLineJoin(cairo.LineJoin.ROUND);

                            const cfg = globalThis._macLabelStylingConfig || { blur: 20, tint: 20, shadow: 25 };
                            const tintVal = (typeof cfg.tint === 'number') ? cfg.tint : 20;
                            const tintAlpha = Math.max(0.05, Math.min(0.95, tintVal / 100.0));
                            const shadowVal = (typeof cfg.shadow === 'number') ? cfg.shadow : 25;
                            const shadowAlpha = Math.max(0.0, Math.min(1.0, shadowVal / 100.0));

                            const isLight = (Main.sessionMode && Main.sessionMode.currentMode === 'light') ||
                                            (typeof globalThis._macIsLightMode === 'function' ? globalThis._macIsLightMode() : false);

                            let r, g, b, a, br, bg_c, bb, ba;
                            if (isLight) {
                                r = 0.94; g = 0.94; b = 0.96; a = Math.max(0.18, Math.min(0.95, tintAlpha * 0.85));
                                br = 0.0; bg_c = 0.0; bb = 0.0; ba = 0.14;
                            } else {
                                r = 0.12; g = 0.12; b = 0.15; a = Math.max(0.18, Math.min(0.95, tintAlpha));
                                br = 1.0; bg_c = 1.0; bb = 1.0; ba = 0.22;
                            }

                            const padX = 6.0;
                            const padY = 6.0;
                            const [minW, natW] = label.get_preferred_width(-1);
                            const pw = Math.ceil(natW > 0 ? natW : (label.width > 0 ? label.width : 50));
                            const [minH, natH] = label.get_preferred_height(pw);
                            const ph = Math.ceil(natH > 0 ? natH : (label.height > 0 ? label.height : 25));
                            const rad = ph / 2.0;

                            const rise = 7.0;
                            const halfBase = 5.0;
                            const fillet = 10.0;
                            const tipR = 1.8;

                            const pos = label._arrowPos ?? position ?? St.Side.BOTTOM;

                            function makeUnifiedPath() {
                                cr.newPath();
                                if (pos === St.Side.TOP) {
                                    const ox = padX;
                                    const oy = padY + rise;
                                    const cx = ox + pw / 2.0;
                                    cr.moveTo(ox + rad, oy);
                                    cr.lineTo(cx - halfBase - fillet, oy);
                                    cr.curveTo(cx - halfBase - fillet * 0.5, oy, cx - halfBase - 1.2, oy - rise * 0.25, cx - halfBase, oy - rise * 0.55);
                                    cr.curveTo(cx - halfBase + 1.2, oy - rise * 0.85, cx - tipR * 1.3, oy - rise, cx, oy - rise);
                                    cr.curveTo(cx + tipR * 1.3, oy - rise, cx + halfBase - 1.2, oy - rise * 0.85, cx + halfBase, oy - rise * 0.55);
                                    cr.curveTo(cx + halfBase + 1.2, oy - rise * 0.25, cx + halfBase + fillet * 0.5, oy, cx + halfBase + fillet, oy);
                                    cr.lineTo(ox + pw - rad, oy);
                                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                                    cr.lineTo(ox + rad, oy + ph);
                                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                                    cr.closePath();
                                } else if (pos === St.Side.LEFT) {
                                    const ox = padX + rise;
                                    const oy = padY;
                                    const cy = oy + ph / 2.0;
                                    cr.moveTo(ox + rad, oy);
                                    cr.lineTo(ox + pw - rad, oy);
                                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                                    cr.lineTo(ox + rad, oy + ph);
                                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                                    cr.lineTo(ox, cy + halfBase + fillet);
                                    cr.curveTo(ox, cy + halfBase + fillet * 0.5, ox - rise * 0.25, cy + halfBase + 1.2, ox - rise * 0.55, cy + halfBase);
                                    cr.curveTo(ox - rise * 0.85, cy + halfBase - 1.2, ox - rise, cy + tipR * 1.3, ox - rise, cy);
                                    cr.curveTo(ox - rise, cy - tipR * 1.3, ox - rise * 0.85, cy - halfBase + 1.2, ox - rise * 0.55, cy - halfBase);
                                    cr.curveTo(ox - rise * 0.25, cy - halfBase - 1.2, ox, cy - halfBase - fillet * 0.5, ox, cy - halfBase - fillet);
                                    cr.lineTo(ox, oy + rad);
                                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                                    cr.closePath();
                                } else if (pos === St.Side.RIGHT) {
                                    const ox = padX;
                                    const oy = padY;
                                    const cy = oy + ph / 2.0;
                                    cr.moveTo(ox + rad, oy);
                                    cr.lineTo(ox + pw - rad, oy);
                                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                                    cr.lineTo(ox + pw, cy - halfBase - fillet);
                                    cr.curveTo(ox + pw, cy - halfBase - fillet * 0.5, ox + pw + rise * 0.25, cy - halfBase - 1.2, ox + pw + rise * 0.55, cy - halfBase);
                                    cr.curveTo(ox + pw + rise * 0.85, cy - halfBase + 1.2, ox + pw + rise, cy - tipR * 1.3, ox + pw + rise, cy);
                                    cr.curveTo(ox + pw + rise, cy + tipR * 1.3, ox + pw + rise * 0.85, cy + halfBase - 1.2, ox + pw + rise * 0.55, cy + halfBase);
                                    cr.curveTo(ox + pw + rise * 0.25, cy + halfBase + 1.2, ox + pw, cy + halfBase + fillet * 0.5, ox + pw, cy + halfBase + fillet);
                                    cr.lineTo(ox + pw, oy + ph - rad);
                                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                                    cr.lineTo(ox + rad, oy + ph);
                                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                                    cr.closePath();
                                } else {
                                    const ox = padX;
                                    const oy = padY;
                                    const cx = ox + pw / 2.0;
                                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                                    cr.lineTo(ox + pw - rad, oy);
                                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                                    cr.lineTo(cx + halfBase + fillet, oy + ph);
                                    cr.curveTo(cx + halfBase + fillet * 0.5, oy + ph, cx + halfBase + 1.2, oy + ph + rise * 0.25, cx + halfBase, oy + ph + rise * 0.55);
                                    cr.curveTo(cx + halfBase - 1.2, oy + ph + rise * 0.85, cx + tipR * 1.3, oy + ph + rise, cx, oy + ph + rise);
                                    cr.curveTo(cx - tipR * 1.3, oy + ph + rise, cx - halfBase + 1.2, oy + ph + rise * 0.85, cx - halfBase, oy + ph + rise * 0.55);
                                    cr.curveTo(cx - halfBase - 1.2, oy + ph + rise * 0.25, cx - halfBase - fillet * 0.5, oy + ph, cx - halfBase - fillet, oy + ph);
                                    cr.lineTo(ox + rad, oy + ph);
                                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                                    cr.closePath();
                                }
                            }

                            if (shadowAlpha > 0.02) {
                                for (let s = 3; s >= 1; s--) {
                                    cr.save();
                                    cr.translate(0, s * 1.5);
                                    makeUnifiedPath();
                                    cr.setSourceRGBA(0, 0, 0, (shadowAlpha * 0.14) / s);
                                    cr.setLineWidth(s * 2.8);
                                    cr.stroke();
                                    cr.restore();
                                }
                            }

                            makeUnifiedPath();
                            cr.setSourceRGBA(r, g, b, a);
                            cr.fillPreserve();

                            cr.setSourceRGBA(br, bg_c, bb, ba);
                            cr.setLineWidth(1.0);
                            cr.stroke();

                            cr.$dispose();
                        });

                        Main.uiGroup.add_child(tail);
                        Main.uiGroup.set_child_below_sibling(tail, label);

                        label.bind_property('visible', tail, 'visible', GObject.BindingFlags.SYNC_CREATE);
                        label.bind_property('opacity', tail, 'opacity', GObject.BindingFlags.SYNC_CREATE);

                        label.connect('destroy', () => {
                            if (label._blurActor) {
                                try {
                                    Main.uiGroup.remove_child(label._blurActor);
                                    label._blurActor.destroy();
                                } catch (_) {}
                                label._blurActor = null;
                            }
                            if (label._blurArrowActor) {
                                try {
                                    Main.uiGroup.remove_child(label._blurArrowActor);
                                    label._blurArrowActor.destroy();
                                } catch (_) {}
                                label._blurArrowActor = null;
                            }
                            if (label._arrowTailActor) {
                                try {
                                    Main.uiGroup.remove_child(label._arrowTailActor);
                                    label._arrowTailActor.destroy();
                                } catch (_) {}
                                label._arrowTailActor = null;
                            }
                        });

                        label.connect('notify::position', () => {
                            _updateTailPos(label, label._arrowPos ?? St.Side.BOTTOM);
                        });

                        label.connect('notify::allocation', () => {
                            _updateTailPos(label, label._arrowPos ?? St.Side.BOTTOM);
                        });
                    }

                    // Ensure stacking order: blur actors below tail, and tail below label
                    if (label._blurActor && label._arrowTailActor)
                        Main.uiGroup.set_child_below_sibling(label._blurActor, label._arrowTailActor);
                    if (label._blurArrowActor && label._arrowTailActor)
                        Main.uiGroup.set_child_below_sibling(label._blurArrowActor, label._arrowTailActor);
                    if (label._arrowTailActor)
                        Main.uiGroup.set_child_below_sibling(label._arrowTailActor, label);

                    _updateTailPos(label, position);
                };

                _sharedEnsureTail = _ensureTail;
                globalThis._macEnsureDockLabelTail = _ensureTail;

                const _posLabel = (item) => {
                    const visual = item.child?.icon?._iconBin ?? item.child?.icon ?? item.child ?? item;
                    const extents = visual.get_transformed_extents();
                    const stageX = extents.get_x();
                    const stageY = extents.get_y();
                    const itemWidth = extents.get_width();
                    const itemHeight = extents.get_height();

                    const [minW, natW] = item.label.get_preferred_width(-1);
                    const labelWidth = Math.ceil(natW > 0 ? natW : (item.label.get_width() || 0));
                    const [minH, natH] = item.label.get_preferred_height(labelWidth);
                    const labelHeight = Math.ceil(natH > 0 ? natH : (item.label.get_height() || 25));

                    const position = item._position ?? St.Side.BOTTOM;
                    const iconCenterX = stageX + itemWidth / 2;
                    const iconCenterY = stageY + itemHeight / 2;

                    let x, y;
                    switch (position) {
                    case St.Side.LEFT:
                        y = Math.round(iconCenterY - labelHeight / 2);
                        x = Math.round(stageX + itemWidth + 20);
                        break;
                    case St.Side.RIGHT:
                        y = Math.round(iconCenterY - labelHeight / 2);
                        x = Math.round(stageX - labelWidth - 20);
                        break;
                    case St.Side.TOP:
                        y = Math.round(stageY + itemHeight + 20);
                        x = Math.round(iconCenterX - (labelWidth / 2));
                        break;
                    case St.Side.BOTTOM:
                    default:
                        y = Math.round(stageY - labelHeight - 20);
                        x = Math.round(iconCenterX - (labelWidth / 2));
                        break;
                    }

                    const monitor = Main.layoutManager.findMonitorForActor(item);
                    if (monitor) {
                        const gap = 5;
                        if (x - monitor.x < gap)
                            x += monitor.x - x;
                        else if (x + labelWidth > monitor.x + monitor.width - gap)
                            x -= x + labelWidth - (monitor.x + monitor.width) + gap;
                    }

                    item.label.set_position(x, y);
                    _updateTailPos(item.label, position);
                };

                const _showLabel = function() {
                    if (!this._labelText || !this.label.get_stage())
                        return;

                    try {
                        const allLabels = Main.uiGroup.get_children().filter(
                            a => a && a.has_style_class_name && a.has_style_class_name('dash-label') && a !== this.label
                        );
                        for (const other of allLabels) {
                            other.remove_all_transitions();
                            other.opacity = 0;
                            other.hide();
                            if (other._arrowTailActor) {
                                other._arrowTailActor.remove_all_transitions();
                                other._arrowTailActor.opacity = 0;
                                other._arrowTailActor.hide();
                            }
                            if (other._blurActor) {
                                other._blurActor.remove_all_transitions();
                                other._blurActor.opacity = 0;
                                other._blurActor.hide();
                            }
                        }
                    } catch (_) {}

                    this.label.set_text(this._labelText);
                    this.label.remove_all_transitions();
                    if (this.label._arrowTailActor)
                        this.label._arrowTailActor.remove_all_transitions();
                    if (this.label._blurActor)
                        this.label._blurActor.remove_all_transitions();

                    this.label.opacity = 0;
                    this.label.show();
                    if (this.label._arrowTailActor) {
                        this.label._arrowTailActor.opacity = 0;
                        this.label._arrowTailActor.show();
                    }
                    if (this.label._blurActor) {
                        this.label._blurActor.opacity = 0;
                        this.label._blurActor.show();
                    }

                    const transparentStyle =
                        'background-color: transparent !important; ' +
                        'box-shadow: none !important; ' +
                        'border: none !important; ' +
                        'color: #ffffff !important; ' +
                        'text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.6) !important; ' +
                        'margin: 0px !important; ' +
                        'padding: 4px 12px !important; ' +
                        'font-weight: 500 !important; ' +
                        'font-size: 13px !important;';

                    this.label.set_style(transparentStyle);

                    if (this.label.set_offscreen_redirect)
                        this.label.set_offscreen_redirect(0);

                    _ensureTail(this.label, this._position ?? St.Side.BOTTOM);
                    _posLabel(this);

                    if (globalThis._macLabelStylingConfig) {
                        const { blur } = globalThis._macLabelStylingConfig;
                        const eff = this.label._blurActor?._blurEff;
                        if (eff) {
                            eff.enabled = (blur > 0);
                            eff.radius = blur;
                            eff.queue_repaint?.();
                        }
                    }

                    if (this.label._arrowTailActor)
                        this.label._arrowTailActor.queue_repaint();

                    this.label.ease({
                        opacity: 255,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            this.label._blurActor?._blurEff?.queue_repaint?.();
                        },
                    });
                };

                const _hideLabel = function(immediate = false) {
                    if (!this.label || !this.label.get_stage())
                        return;

                    this.label.remove_all_transitions();
                    const subs = [this.label._arrowTailActor, this.label._blurActor];
                    for (const sub of subs) {
                        if (sub) sub.remove_all_transitions();
                    }

                    if (immediate) {
                        this.label.opacity = 0;
                        this.label.hide();
                        for (const sub of subs) {
                            if (sub) {
                                sub.opacity = 0;
                                sub.hide();
                            }
                        }
                        return;
                    }

                    this.label.ease({
                        opacity: 0,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            this.label.hide();
                            for (const sub of subs) {
                                if (sub) sub.hide();
                            }
                        },
                    });
                };

                const items = Main.overview?.dash?._box?.get_children?.() || [];
                const first = items.find(it => it && typeof it.showLabel === 'function');
                if (first?.constructor?.prototype) {
                    first.constructor.prototype.showLabel = _showLabel;
                    first.constructor.prototype.hideLabel = _hideLabel;
                }

                const patchDockItems = () => {
                    const d2d = Main.uiGroup?.get_children?.()?.find(c => c.name === 'dashtodockContainer');
                    const d2dItems = d2d?.dash?._box?.get_children?.() || [];
                    const d2dFirst = d2dItems.find(it => it && typeof it.showLabel === 'function');
                    if (d2dFirst?.constructor?.prototype) {
                        d2dFirst.constructor.prototype.showLabel = _showLabel;
                        d2dFirst.constructor.prototype.hideLabel = _hideLabel;
                    }
                    for (const it of d2dItems) {
                        if (it && typeof it.showLabel === 'function') {
                            it.showLabel = _showLabel;
                            it.hideLabel = _hideLabel;
                        }
                    }
                };
                patchDockItems();
                globalThis._macPatchDockLabels = patchDockItems;

                import('resource:///org/gnome/shell/ui/dash.js').then((Dash) => {
                    if (Dash?.DashItemContainer?.prototype) {
                        Dash.DashItemContainer.prototype.showLabel = _showLabel;
                        Dash.DashItemContainer.prototype.hideLabel = _hideLabel;
                    }
                }).catch(() => {});
            } catch (e) {
                console.error('[EvalHelper] installUnifiedDockLabelHandler error: ' + e);
            }
        };
        installUnifiedDockLabelHandler();

        const syncAllLabels = () => {
            try {
                const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
                let conf = {};
                if (GLib.file_test(confPath, GLib.FileTest.EXISTS)) {
                    const [ok, bytes] = GLib.file_get_contents(confPath);
                    if (ok) conf = JSON.parse(new TextDecoder().decode(bytes));
                }
                const blur = (typeof conf.label_blur === 'number') ? conf.label_blur : 20;
                const tint = (typeof conf.label_tint === 'number') ? conf.label_tint : 20;
                const shadow = (typeof conf.label_shadow === 'number') ? conf.label_shadow : 25;

                globalThis._macLabelStylingConfig = { blur, tint, shadow };

                const styleStr = 'background-color: transparent !important; ' +
                                 'box-shadow: none !important; ' +
                                 'border: none !important; ' +
                                 'color: #ffffff !important; ' +
                                 'text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.6) !important; ' +
                                 'margin: 0px !important; ' +
                                 'padding: 4px 12px !important; ' +
                                 'font-weight: 500 !important; ' +
                                 'font-size: 13px !important;';

                const labels = Main.uiGroup.get_children().filter(a => a && a.has_style_class_name && a.has_style_class_name('dash-label'));
                for (const l of labels) {
                    l.set_style(styleStr);
                    if (l._blurActor && (!l._blurActor.get_parent?.() || l._blurActor._isDisposed)) {
                        try {
                            Main.uiGroup.remove_child(l._blurActor);
                            l._blurActor.destroy();
                        } catch (_) {}
                        l._blurActor = null;
                    }
                    if (l._arrowTailActor && (!l._arrowTailActor.get_parent?.() || l._arrowTailActor._isDisposed)) {
                        try {
                            Main.uiGroup.remove_child(l._arrowTailActor);
                            l._arrowTailActor.destroy();
                        } catch (_) {}
                        l._arrowTailActor = null;
                    }
                    if (l._arrowTailActor && !l._blurActor) {
                        if (typeof globalThis._macEnsureDockLabelTail === 'function') {
                            globalThis._macEnsureDockLabelTail(l, l._arrowPos ?? St.Side.BOTTOM);
                        } else if (_sharedEnsureTail) {
                            _sharedEnsureTail(l, l._arrowPos ?? St.Side.BOTTOM);
                        }
                    }
                    if (l._blurActor && l._blurActor._blurEff) {
                        l._blurActor._blurEff.enabled = (blur > 0);
                        l._blurActor._blurEff.radius = blur;
                        l._blurActor._blurEff.queue_repaint?.();
                    }
                    if (l._blurArrowActor && l._blurArrowActor._blurEff) {
                        l._blurArrowActor._blurEff.enabled = (blur > 0);
                        l._blurArrowActor._blurEff.radius = blur;
                        l._blurArrowActor._blurEff.queue_repaint?.();
                    }
                    const effL = l.get_effects?.()?.find(e => e.name === 'tahoe-label-blur');
                    if (effL && l._arrowTailActor) effL.enabled = false;
                    if (l._arrowTailActor) {
                        l._arrowTailActor.queue_repaint();
                    }
                }

                const pills = Main.uiGroup.get_children().filter(
                    a => a && a.has_style_class_name &&
                         (a.has_style_class_name('dash-label-blur-pill') ||
                          a.has_style_class_name('dash-label-blur-arrow') ||
                          a.has_style_class_name('dash-label-blur-unified'))
                );
                for (const p of pills) {
                    if (p._blurEff) {
                        p._blurEff.enabled = (blur > 0);
                        p._blurEff.radius = blur;
                        p._blurEff.queue_repaint?.();
                    }
                }
                const tails = Main.uiGroup.get_children().filter(
                    a => a && a.has_style_class_name && a.has_style_class_name('dash-label-tail')
                );
                for (const t of tails) {
                    t.queue_repaint();
                }

                if (typeof patchDockItems === 'function') {
                    patchDockItems();
                }
            } catch (e) {
                console.error('[EvalHelper] syncAllLabels error: ' + e);
            }
        };
        globalThis._macSyncLabelStyling = syncAllLabels;
        syncAllLabels();


        const syncDockStyling = () => {
            try {
                const confPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
                let conf = {};
                if (GLib.file_test(confPath, GLib.FileTest.EXISTS)) {
                    const [ok, bytes] = GLib.file_get_contents(confPath);
                    if (ok) conf = JSON.parse(new TextDecoder().decode(bytes));
                }
                const iconSize = (typeof conf.dock_icon_size === 'number') ? conf.dock_icon_size : 54;
                const dockSize = (typeof conf.dock_size === 'number') ? conf.dock_size : 12;
                const spacing = (typeof conf.dock_spacing === 'number') ? conf.dock_spacing : 0;
                const edgeDistance = (typeof conf.dock_edge_distance === 'number') ? conf.dock_edge_distance : 0;

                const d2d = Main.uiGroup?.get_children?.()?.find(c => c.name === 'dashtodockContainer');
                const dash = d2d?.dash;
                if (!dash) return;


                if (dash._box?.layout_manager) {
                    dash._box.layout_manager.spacing = spacing;
                }


                if (dash._dashContainer) {
                    dash._dashContainer.set_style(`padding: 0 ${dockSize}px !important;`);
                }



                const padV = dockSize;
                const itemMarginStyle = 'margin: 0px !important;';
                const appPaddingStyle = `padding-top: ${padV}px !important; padding-bottom: ${padV}px !important; margin: 0px !important;`;

                if (dash._box) {
                    for (const item of dash._box.get_children()) {
                        item.set_style(itemMarginStyle);
                        if (item.get_first_child) {
                            const iconChild = item.get_first_child();
                            if (iconChild && iconChild.set_style) {
                                iconChild.set_style(appPaddingStyle);
                            }
                        }
                    }

                    if (!this._macDockChildAddedConnected) {
                        this._macDockChildAddedConnected = true;
                        dash._box.connect('child-added', () => {
                            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                syncDockStyling();
                                return GLib.SOURCE_REMOVE;
                            });
                        });
                    }
                }


                const motionEd = Math.min(8, Math.max(0, edgeDistance));
                try {
                    const schemaMotion = 'org.gnome.shell.extensions.dash2dock-motion';
                    const schemaD2d = 'org.gnome.shell.extensions.dash-to-dock';
                    const schemaLg = 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com';
                    const source = Gio.SettingsSchemaSource.get_default();
                    if (source.lookup(schemaMotion, true)) {
                        const s = new Gio.Settings({ schema_id: schemaMotion });
                        if (s.get_int('dash-max-icon-size') !== iconSize) {
                            s.set_int('dash-max-icon-size', iconSize);
                        }
                        if (s.get_int('edge-distance') !== motionEd) {
                            s.set_int('edge-distance', motionEd);
                        }
                    }
                    if (source.lookup(schemaD2d, true)) {
                        const s2 = new Gio.Settings({ schema_id: schemaD2d });
                        if (s2.get_int('dash-max-icon-size') !== iconSize) {
                            s2.set_int('dash-max-icon-size', iconSize);
                        }
                        if (s2.get_int('edge-distance') !== motionEd) {
                            s2.set_int('edge-distance', motionEd);
                        }
                    }
                    if (source.lookup(schemaLg, true)) {
                        const s3 = new Gio.Settings({ schema_id: schemaLg });
                        if (s3.get_int('dock-margin-bottom') !== motionEd) {
                            s3.set_int('dock-margin-bottom', motionEd);
                        }
                    }
                } catch (_) {}





                const extraEdge = Math.max(0, edgeDistance - 8);
                d2d._macExtraEdge = extraEdge;
                const dockHeight = d2d.height > 0 ? d2d.height : (d2d._box?.height > 0 ? d2d._box.height : 80);
                d2d.translation_y = -(dockHeight + extraEdge);

                if (!d2d._macEdgeHeightConnected) {
                    d2d._macEdgeHeightConnected = true;
                    d2d.connect('notify::height', () => {
                        const extra = d2d._macExtraEdge || 0;
                        if (d2d.height > 0) {
                            d2d.translation_y = -(d2d.height + extra);
                        }
                    });
                }

                dash._box?.queue_relayout?.();
                d2d.queue_relayout?.();


                if (typeof global._liquidGlassDockSync === 'function') {
                    global._liquidGlassDockSync();
                }
            } catch (e) {
                console.error('[EvalHelper] syncDockStyling error: ' + e);
            }
        };
        globalThis._macSyncDockStyling = syncDockStyling;
        syncDockStyling();






        const patchMissionControlOverview = () => {
            try {
                const controls = Main.overview?._overview?.controls;
                if (!controls) return;

                if (Main.overview && !Main.overview._origChangeShownState) {
                    Main.overview._origChangeShownState = Main.overview._changeShownState;
                    Main.overview._changeShownState = function(state) {
                        if (state === this._shownState) return;
                        return this._origChangeShownState(state);
                    };
                }

                const lm = controls.layout_manager;
                if (lm && !lm._macOverviewSpacingPatchedV3) {
                    lm._macOverviewSpacingPatchedV3 = true;
                    const origCompute = lm._origComputeWorkspacesBox || lm._computeWorkspacesBoxForState;
                    lm._origComputeWorkspacesBox = origCompute;
                    lm._computeWorkspacesBoxForState = function(state, box, ...rest) {
                        const mon = Main.layoutManager.primaryMonitor;
                        if (state === 0  ) {
                            const res = new Clutter.ActorBox();
                            res.set_origin(0, 0);
                            res.set_size(mon.width, mon.height);
                            return res;
                        }
                        if (state === 1  ) {
                            const workArea = Main.layoutManager.getWorkAreaForMonitor(mon.index);
                            const topPanelH = 34;
                            const dockH = mon.height - (workArea ? (workArea.y + workArea.height) : (mon.height - 92));
                            const topClearance = Math.round(topPanelH + Math.max(38, mon.height * 0.042));
                            const bottomClearance = Math.round(dockH + Math.max(65, mon.height * 0.070));

                            const res = new Clutter.ActorBox();
                            res.x1 = 0;
                            res.y1 = topClearance;
                            res.x2 = mon.width;
                            res.y2 = mon.height - bottomClearance;
                            return res;
                        }
                        return origCompute.call(this, state, box, ...rest);
                    };
                }



                (async () => {
                    try {
                        const { WorkspaceBackground, WorkspaceLayout } = await import('resource:///org/gnome/shell/ui/workspace.js');
                        if (WorkspaceBackground && !WorkspaceBackground.prototype._macWorkareaPatchedV3) {
                            WorkspaceBackground.prototype._macWorkareaPatchedV3 = true;
                            Object.defineProperty(WorkspaceBackground.prototype, '_workarea', {
                                configurable: true,
                                enumerable: true,
                                get() {
                                    const mon = Main.layoutManager.monitors[this._monitorIndex] || Main.layoutManager.primaryMonitor;
                                    if (!this._macMonWorkarea || this._macMonWidth !== mon.width || this._macMonHeight !== mon.height) {
                                        this._macMonWidth = mon.width;
                                        this._macMonHeight = mon.height;
                                        this._macMonWorkarea = new Mtk.Rectangle({
                                            x: 0,
                                            y: 0,
                                            width: mon.width,
                                            height: mon.height,
                                        });
                                    }
                                    return this._macMonWorkarea;
                                },
                                set(_) {}
                            });
                        }
                        if (WorkspaceLayout && !WorkspaceLayout.prototype._macWorkareaPropPatchedV3) {
                            WorkspaceLayout.prototype._macWorkareaPropPatchedV3 = true;
                            Object.defineProperty(WorkspaceLayout.prototype, '_workarea', {
                                configurable: true,
                                enumerable: true,
                                get() {
                                    const mon = Main.layoutManager.monitors[this._monitorIndex] || Main.layoutManager.primaryMonitor;
                                    if (!this._macMonWorkarea || this._macMonWidth !== mon.width || this._macMonHeight !== mon.height) {
                                        this._macMonWidth = mon.width;
                                        this._macMonHeight = mon.height;
                                        this._macMonWorkarea = new Mtk.Rectangle({
                                            x: 0,
                                            y: 0,
                                            width: mon.width,
                                            height: mon.height,
                                        });
                                    }
                                    return this._macMonWorkarea;
                                },
                                set(_) {}
                            });
                            WorkspaceLayout.prototype._origGetAdjustedWorkarea = WorkspaceLayout.prototype._origGetAdjustedWorkarea || WorkspaceLayout.prototype._getAdjustedWorkarea;
                            WorkspaceLayout.prototype._getAdjustedWorkarea = function(container) {
                                const mon = Main.layoutManager.monitors[this._monitorIndex] || Main.layoutManager.primaryMonitor;
                                return new Mtk.Rectangle({
                                    x: 0,
                                    y: 0,
                                    width: mon.width,
                                    height: mon.height,
                                });
                            };
                        }

                        if (WorkspaceBackground && !WorkspaceBackground.prototype._macVisiblePatched) {
                            WorkspaceBackground.prototype._macVisiblePatched = true;
                            const origInit = WorkspaceBackground.prototype._origInit || WorkspaceBackground.prototype._init;
                            WorkspaceBackground.prototype._origInit = origInit;
                            WorkspaceBackground.prototype._init = function(...args) {
                                origInit.apply(this, args);
                                this.opacity = 255;
                                if (this._bin) {
                                    this._bin.opacity = 255;
                                    this._bin.clip_to_allocation = false;
                                }
                                if (this._backgroundGroup) this._backgroundGroup.opacity = 255;
                            };
                        }

                        if (WorkspaceBackground && !WorkspaceBackground.prototype._macClipPatched) {
                            WorkspaceBackground.prototype._macClipPatched = true;
                            WorkspaceBackground.prototype._origUpdateRoundedClipBounds = WorkspaceBackground.prototype._updateRoundedClipBounds;
                            WorkspaceBackground.prototype._updateRoundedClipBounds = function() {
                                try {
                                    const monitor = Main.layoutManager.monitors[this._monitorIndex] || Main.layoutManager.primaryMonitor;
                                    if (monitor) {
                                        if (this._macClipWidth === monitor.width && this._macClipHeight === monitor.height)
                                            return;
                                        this._macClipWidth = monitor.width;
                                        this._macClipHeight = monitor.height;
                                        const rect = new Graphene.Rect();
                                        rect.origin.x = 0;
                                        rect.origin.y = 0;
                                        rect.size.width = monitor.width;
                                        rect.size.height = monitor.height;
                                        this._bgManager.backgroundActor.content.set_rounded_clip_bounds(rect);
                                        return;
                                    }
                                } catch (_) {}
                                this._origUpdateRoundedClipBounds();
                            };
                        }
                    } catch (e) {
                        console.error('[EvalHelper] Error patching WorkspaceLayout/Background:', e);
                    }
                })();


                if (!Main.overview._macWgHidingConn) {
                    Main.overview._macWgHidingConn = Main.overview.connect('hiding', () => {
                        global.window_group.show();
                    });
                }


                const getDingActors = () => {
                    return (global.window_group?.get_children() || []).filter(c => {
                        const mw = c.meta_window || c.get_meta_window?.();
                        return mw && (mw.get_gtk_application_id?.() === 'com.rastersoft.ding' ||
                                      mw.get_title?.()?.startsWith('Desktop Icons'));
                    });
                };
                const DING_FADE_DURATION = 240;
                const DING_FADE_MODE = Clutter.AnimationMode.EASE_OUT_CUBIC;

                let _dingClones = [];
                const cleanupDingClones = () => {
                    for (const c of _dingClones) {
                        try {
                            c.remove_all_transitions();
                            if (c.get_parent()) {
                                c.get_parent().remove_child(c);
                            }
                            c.destroy();
                        } catch (_) {}
                    }
                    _dingClones = [];
                };
                globalThis._macCleanupDingClones = cleanupDingClones;

                const ensureDingClones = (initialOpacity = 255) => {
                    const dingActors = getDingActors();
                    if (!dingActors.length) {
                        cleanupDingClones();
                        return;
                    }
                    const ovGroup = Main.layoutManager.overviewGroup;
                    if (!ovGroup) return;


                    if (_dingClones.length === dingActors.length && _dingClones.every(c => c && c.get_parent() === ovGroup)) {
                        for (let i = 0; i < dingActors.length; i++) {
                            const actor = dingActors[i];
                            const clone = _dingClones[i];
                            clone.set_position(actor.x, actor.y);
                            clone.set_size(actor.width, actor.height);
                            clone.visible = true;
                        }
                        return;
                    }

                    cleanupDingClones();
                    const bgIdx = ovGroup.get_children().findIndex(c => c.name === 'mac-overview-wallpaper-group');
                    const targetIdx = bgIdx >= 0 ? bgIdx + 1 : 0;

                    for (const actor of dingActors) {
                        try {
                            const clone = new Clutter.Clone({
                                source: actor,
                                reactive: false,
                                opacity: initialOpacity,
                            });
                            clone.set_position(actor.x, actor.y);
                            clone.set_size(actor.width, actor.height);
                            ovGroup.insert_child_at_index(clone, targetIdx);
                            _dingClones.push(clone);
                        } catch (_) {}
                    }
                };

                const animateDingFade = (targetOpacity, duration = DING_FADE_DURATION) => {
                    ensureDingClones(targetOpacity === 0 ? 255 : 0);
                    for (const clone of _dingClones) {
                        clone.remove_all_transitions();
                        clone.ease({
                            opacity: targetOpacity,
                            duration: duration,
                            mode: DING_FADE_MODE,
                            onComplete: () => {
                                if (targetOpacity === 0) {
                                    cleanupDingClones();
                                }
                            },
                        });
                    }
                };

                if (!Main.overview._macDingShowingConn) {
                    Main.overview._macDingShowingConn = Main.overview.connect('showing', () => {
                        animateDingFade(0, DING_FADE_DURATION);
                        for (const actor of getDingActors()) {
                            actor.remove_all_transitions();
                            actor.opacity = 0;
                        }
                    });
                }
                if (!Main.overview._macDingShownConn) {
                    Main.overview._macDingShownConn = Main.overview.connect('shown', () => {
                        cleanupDingClones();
                        for (const actor of getDingActors()) {
                            actor.remove_all_transitions();
                            actor.opacity = 0;
                        }
                    });
                }
                if (!Main.overview._macDingHidingConn) {
                    Main.overview._macDingHidingConn = Main.overview.connect('hiding', () => {
                        animateDingFade(255, DING_FADE_DURATION);
                    });
                }
                if (!Main.overview._macDingHiddenConn) {
                    Main.overview._macDingHiddenConn = Main.overview.connect('hidden', () => {
                        cleanupDingClones();
                        for (const actor of getDingActors()) {
                            actor.remove_all_transitions();
                            actor.opacity = 255;
                        }
                    });
                }


                controls._updateAppDisplayVisibility = function() {
                    if (this._appDisplay) {
                        this._appDisplay.visible = false;
                        this._appDisplay.opacity = 0;
                    }
                };
                if (controls._appDisplay) {
                    controls._appDisplay.visible = false;
                    controls._appDisplay.opacity = 0;
                }


                if (!controls._macControlsPatched) {
                    controls._shiftState = function(direction) {
                        let {currentState, finalState} = this._stateAdjustment.getStateTransitionParams();
                        if (direction === Meta.MotionDirection.DOWN)
                            finalState = Math.max(finalState - 1, 0);
                        else if (direction === Meta.MotionDirection.UP)
                            finalState = Math.min(finalState + 1, 1);

                        if (finalState === currentState)
                            return;

                        if (currentState === 0 && finalState === 1) {
                            Main.overview.show();
                        } else if (finalState === 0) {
                            Main.overview.hide();
                        } else {
                            this._stateAdjustment.ease(finalState, {
                                duration: 250,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            });
                        }
                    };
                }


                controls._toggleAppsPage = function() {
                    if (typeof globalThis.toggleMacApplications === 'function') {
                        globalThis.toggleMacApplications();
                    }
                };
                Main.overview.showApps = function() {
                    if (typeof globalThis.toggleMacApplications === 'function') {
                        globalThis.toggleMacApplications();
                    }
                };


                if (controls._searchEntryBin) {
                    controls._searchEntryBin.visible = false;
                    controls._searchEntryBin.opacity = 0;
                    controls._searchEntryBin.height = 0;
                    controls._searchEntryBin.get_preferred_height = () => [0, 0];
                    controls._searchEntryBin.get_preferred_width = () => [0, 0];
                }
                if (controls._searchEntry) {
                    controls._searchEntry.visible = false;
                    controls._searchEntry.opacity = 0;
                    controls._searchEntry.height = 0;
                    controls._searchEntry.get_preferred_height = () => [0, 0];
                    controls._searchEntry.get_preferred_width = () => [0, 0];
                }


                if (controls._searchController) {
                    controls._searchController._shouldTriggerSearch = () => false;
                    if (controls._searchController._entry) {
                        controls._searchController._entry.visible = false;
                        controls._searchController._entry.opacity = 0;
                    }
                }


                const showWorkspaceBackgrounds = () => {
                    try {
                        const ws = Main.overview?._overview?._controls?._workspacesDisplay;
                        if (!ws || !ws._workspacesViews) return;
                        for (const view of ws._workspacesViews) {
                            for (const wsActor of (view.get_children ? view.get_children() : [])) {
                                if (wsActor._background) {
                                    if (wsActor._background.opacity !== 255) wsActor._background.opacity = 255;
                                    if (!wsActor._background.visible) wsActor._background.visible = true;
                                    if (wsActor._background._bin) {
                                        if (wsActor._background._bin.opacity !== 255) wsActor._background._bin.opacity = 255;
                                        if (!wsActor._background._bin.visible) wsActor._background._bin.visible = true;
                                        wsActor._background._bin.clip_to_allocation = false;
                                    }
                                    if (wsActor._background._backgroundGroup) {
                                        if (wsActor._background._backgroundGroup.opacity !== 255) wsActor._background._backgroundGroup.opacity = 255;
                                        if (!wsActor._background._backgroundGroup.visible) wsActor._background._backgroundGroup.visible = true;
                                        for (const child of (wsActor._background._backgroundGroup.get_children ? wsActor._background._backgroundGroup.get_children() : [])) {
                                            if (child.constructor.name === 'Clutter_Clone') {
                                                child.destroy();
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                };

                if (!Main.overview._macShowWsBgConn) {
                    Main.overview._macShowWsBgConn = Main.overview.connectObject(
                        'showing', showWorkspaceBackgrounds,
                        'shown', showWorkspaceBackgrounds,
                        this
                    );
                }
                showWorkspaceBackgrounds();


            } catch (e) {
                console.error('[EvalHelper] patchMissionControlOverview error: ' + e);
            }
        };
        patchMissionControlOverview();



        try {
            this._overviewWallpaperManager = new OverviewWallpaperManager();
        } catch (e) {
            console.error('[EvalHelper] OverviewWallpaperManager init error: ' + e);
        }


        const patchPanelOverviewAndFolders = () => {
            try {
                const pb = Main.extensionManager?.lookup?.('blur-my-shell@aunetx')?.stateObj?._panel_blur;
                if (!pb) return;
                const proto = Object.getPrototypeOf(pb);
                if (proto._macOverviewPatchedV4) return;
                proto._macOverviewPatchedV4 = true;

                proto._ensure_overview_effects_configured = function(_bg) {};

                proto.set_appfolder_open = function(isOpen) {
                    this._appfolder_is_open = !!isOpen;
                    const overviewRadius = (this.settings.overview?.SIGMA ?? 30.0);
                    const overviewBrightness = (this.settings.overview?.BRIGHTNESS ?? 1.0);
                    const folderSigma = (this.settings.appfolder?.SIGMA ?? 30.0);
                    const targetRadius = isOpen
                        ? Math.round(overviewRadius + folderSigma * 1.5)
                        : overviewRadius;
                    const targetBrightness = isOpen ? 0.90 : overviewBrightness;

                    const ov = global.blur_my_shell?._overview_blur;
                    if (ov && ov.overview_background_group) {
                        const children = ov.overview_background_group.get_children();
                        for (let widget of children) {
                            const effs = widget.get_effects?.() || [];
                            effs.forEach((e, idx) => {
                                const name = e.name || `bms-ov-eff-${idx}`;
                                if (!e.name) e.name = name;
                                try {
                                    widget.remove_transition(`@effects.${name}.radius`);
                                    widget.remove_transition(`@effects.${name}.brightness`);
                                    widget.ease_property(`@effects.${name}.radius`, targetRadius, {
                                        duration: 220,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                    });
                                    widget.ease_property(`@effects.${name}.brightness`, targetBrightness, {
                                        duration: 220,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                    });
                                } catch (_) {
                                    if (typeof e.radius !== 'undefined') e.radius = targetRadius;
                                    if (typeof e.brightness !== 'undefined') e.brightness = targetBrightness;
                                }
                            });
                        }
                    }

                    if (Main.panel) {
                        Main.panel.set_style(
                            `background-color: transparent !important; ` +
                            `background: transparent !important; ` +
                            `box-shadow: none !important; ` +
                            `border-bottom: none !important; ` +
                            `transition-duration: 220ms !important;`
                        );
                    }
                };

                proto.animate_overview_transition = function(isOverview, durationMs = 300) {
                    try {
                        const duration = durationMs;


                        this.actors_list?.forEach(actors => {
                            const bg = actors.widgets?.background;
                            if (!bg) return;
                            bg.remove_all_transitions();
                            bg.opacity = 0;
                            if (bg.visible) bg.hide();
                        });


                        if (Main.panel) {
                            Main.panel.opacity = 255;
                            Main.panel.set_style(
                                `background-color: transparent !important; ` +
                                `background: transparent !important; ` +
                                `box-shadow: none !important; ` +
                                `border-bottom: none !important; ` +
                                `transition-duration: ${duration}ms !important;`
                            );
                        }
                    } catch (e) {
                        console.error(`[PanelOverview] error: ${e}`);
                    }
                };

                proto.on_overview_progress = function(_progress) {

                };

                proto._on_overview_adjustment_changed = function(_stateAdjustment) {

                };

                proto.set_overview_blur = function(enabled) {
                    this.animate_overview_transition(enabled, 300);
                };

                if (!pb._macFixedOverviewConnected) {
                    pb._macFixedOverviewConnected = true;
                    Main.overview.connect('showing', () => {
                        pb.animate_overview_transition(true, 300);
                    });
                    Main.overview.connect('hiding', () => {
                        pb.animate_overview_transition(false, 300);
                    });
                }
            } catch (_) {}
        };
        patchPanelOverviewAndFolders();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            patchPanelOverviewAndFolders();
            return GLib.SOURCE_REMOVE;
        });









        const wah = Main.windowAttentionHandler;
        if (wah && !this._origOnWindowDemandsAttention) {
            this._origOnWindowDemandsAttention = wah._onWindowDemandsAttention.bind(wah);
            wah._onWindowDemandsAttention = function(_display, _window) {

            };
        }


        const ACCENT_COLOR_MAP = {
            'blue': '#007aff',
            'teal': '#00a294',
            'green': '#2ec27e',
            'yellow': '#e5a50a',
            'orange': '#ff6a00',
            'red': '#e01b24',
            'pink': '#d56199',
            'purple': '#9141ac',
            'slate': '#6e7a85',
        };

        const syncAccentColor = () => {
            try {
                if (!this._ifaceSettings)
                    this._ifaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                const accentKey = this._ifaceSettings.get_string('accent-color') || 'orange';
                const hexColor = ACCENT_COLOR_MAP[accentKey] || '#ff6a00';
                if (Main.layoutManager?.uiGroup) {
                    Main.layoutManager.uiGroup.set_style(`-st-accent-color: ${hexColor}; -st-accent-fg-color: #ffffff;`);
                }
            } catch (e) {
                console.error(`[EvalHelper] syncAccentColor error: ${e}`);
            }
        };

        try {
            this._ifaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._accentColorId = this._ifaceSettings.connect('changed::accent-color', syncAccentColor);
            syncAccentColor();
        } catch (_) {}


        if (Main.layoutManager) {

            Main.layoutManager.uiGroup.scale_x = 1.0;
            Main.layoutManager.uiGroup.scale_y = 1.0;
            Main.layoutManager.uiGroup.set_pivot_point(0, 0);
            Main.layoutManager.uiGroup.opacity = 255;


            if (!Main.layoutManager._isMacLayoutOverlay) {
                try {
                    Main.layoutManager._startInOverview = false;
                } catch (_) {}
                try {
                    const shellSchema = Gio.SettingsSchemaSource.get_default()?.lookup('org.gnome.shell', true);
                    if (shellSchema && shellSchema.has_key('start-in-overview')) {
                        const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
                        if (shellSettings.get_boolean('start-in-overview'))
                            shellSettings.set_boolean('start-in-overview', false);
                    }
                } catch (_) {}

                const suppressStartupOverview = () => {
                    try {
                        const ov = Main.overview;
                        const lm = Main.layoutManager;
                        if (lm) lm._startInOverview = false;
                        if (!ov || ov.isDummy) return;
                        const controls = ov._overview?.controls;
                        if (controls?._stateAdjustment) {
                            controls._stateAdjustment.remove_all_transitions();
                            controls._stateAdjustment.value = 0;
                        }
                        if (ov._visible || ov._visibleTarget || ov._shown || lm?._inOverview || ov._shownState) {
                            ov._shown = false;
                            ov._visible = false;
                            ov._visibleTarget = false;
                            try { ov._changeShownState?.(0); } catch (_) {}
                            try { ov.hide?.(); } catch (_) {}
                            try { lm?.hideOverview?.(); } catch (_) {}
                        }
                        if (Main.panel)
                            Main.panel.style = null;
                    } catch (_) {}
                };

                const prepareMacDesktopHidden = async (withBgUpdate = true) => {
                    if (Main.sessionMode.isGreeter) return;
                    const lm = Main.layoutManager;
                    lm._macStartupManaged = true;
                    lm._startInOverview = false;
                    suppressStartupOverview();
                    lm._showSecondaryBackgrounds?.();

                    const screenW = global.stage.width || global.screen_width || 1920;
                    const screenH = global.stage.height || global.screen_height || 1080;
                    let bgUri = 'file:///usr/share/backgrounds/GoldenGate_Day.jpg';
                    try {
                        const bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
                        const uri = bgSettings.get_string('picture-uri-dark') || bgSettings.get_string('picture-uri');
                        if (uri && uri !== '') bgUri = uri;
                    } catch (_) {}

                    const coverStyle = `background-color: #000000; background-image: url("${bgUri}"); background-size: cover; background-position: center;`;
                    if (!lm._coverPane) {
                        lm._coverPane = new St.Widget({
                            name: 'macStartupCoverPane',
                            style: coverStyle,
                            opacity: 255,
                            x: 0,
                            y: 0,
                            width: screenW,
                            height: screenH,
                            reactive: true,
                        });
                        lm.uiGroup.add_child(lm._coverPane);
                    } else {
                        lm._coverPane.remove_all_transitions?.();
                        if (typeof lm._coverPane.set_style === 'function')
                            lm._coverPane.set_style(coverStyle);
                        else
                            lm._coverPane.style = coverStyle;
                        lm._coverPane.set_size?.(screenW, screenH);
                        lm._coverPane.opacity = 255;
                        lm._coverPane.show?.();
                    }
                    lm.uiGroup.set_child_above_sibling(lm._coverPane, null);

                    lm.uiGroup.set_pivot_point(0, 0);
                    lm.uiGroup.scale_x = 1.0;
                    lm.uiGroup.scale_y = 1.0;
                    lm.uiGroup.opacity = 255;

                    if (lm.panelBox) {
                        lm.panelBox.remove_all_transitions();
                        const panelH = lm.panelBox.height > 0 ? lm.panelBox.height : 34;
                        lm.panelBox.translation_y = -panelH;
                        lm.panelBox.opacity = 0;
                        if (lm._coverPane) {
                            lm.uiGroup.set_child_above_sibling(lm.panelBox, lm._coverPane);
                        }
                    }

                    if (global.window_group) {
                        global.window_group.remove_all_transitions();
                        global.window_group.opacity = 255;
                        if (lm._backgroundGroup) {
                            lm._backgroundGroup.remove_all_transitions();
                            lm._backgroundGroup.opacity = 255;
                        }
                        for (const w of global.window_group.get_children()) {
                            if (w !== lm._backgroundGroup) {
                                w.remove_all_transitions();
                                w.opacity = 0;
                            }
                        }
                        if (!lm._macWinGroupChildAddedId) {
                            lm._macWinGroupChildAddedId = global.window_group.connect('child-added', (_group, w) => {
                                if (lm._startingUp && w !== lm._backgroundGroup) {
                                    w.remove_all_transitions();
                                    w.opacity = 0;
                                }
                            });
                        }
                    }

                    for (const child of lm.uiGroup.get_children()) {
                        if (child.name === 'dashtodockContainer' || child.name === 'liquid-glass-bg-actor') {
                            child.remove_all_transitions();
                            child.opacity = 0;
                            if (child.name === 'dashtodockContainer') {
                                for (const sub of child.get_children()) sub.opacity = 0;
                            }
                        }
                    }

                    if (!lm._macDockChildAddedId) {
                        lm._macDockChildAddedId = lm.uiGroup.connect('child-added', (_group, child) => {
                            if (!lm._startingUp) return;
                            if (lm._coverPane && child !== lm._coverPane && child !== lm.panelBox) {
                                lm.uiGroup.set_child_above_sibling(lm._coverPane, null);
                                if (lm.panelBox) lm.uiGroup.set_child_above_sibling(lm.panelBox, lm._coverPane);
                            }
                            if (child.name === 'dashtodockContainer') {
                                child.remove_all_transitions();
                                child.opacity = 0;
                                for (const sub of child.get_children()) sub.opacity = 0;
                            } else if (child.name === 'liquid-glass-bg-actor') {
                                child.remove_all_transitions();
                                child.opacity = 0;
                            }
                        });
                    }

                    if (lm._backgroundGroup && !lm._macBgChildAddedId) {
                        lm._macBgChildAddedId = lm._backgroundGroup.connect('child-added', (_group, child) => {
                            if (!lm._startingUp) return;
                            if ((child.has_style_class_name && child.has_style_class_name('widget-layer')) || child.name === 'widget-layer') {
                                child.remove_all_transitions();
                                child.opacity = 0;
                            }
                        });
                    }

                    const widgetsExt = Main.extensionManager?.lookup('desktop-widgets@r3nhick');
                    const widgetLayer = widgetsExt?.stateObj?._controller?._layer ||
                        lm._backgroundGroup?.get_children().find(c => c.has_style_class_name?.('widget-layer'));
                    if (widgetLayer) {
                        widgetLayer.remove_all_transitions();
                        widgetLayer.opacity = 0;
                    }

                    if (withBgUpdate && lm._updateBackgrounds) {
                        await lm._updateBackgrounds();
                    }
                };

                if (Main.layoutManager._prepareStartupAnimation) {
                    this._origPrepareStartupAnimation = Main.layoutManager._prepareStartupAnimation;
                    Main.layoutManager._prepareStartupAnimation = async function() {
                        await prepareMacDesktopHidden(true);
                        this.emit('startup-prepared');
                    };
                }

                const alreadyRunningStartup = Boolean(
                    Main.layoutManager._coverPane ||
                    Main.layoutManager._systemBackground ||
                    Main.overview?._visible ||
                    Main.overview?._visibleTarget ||
                    Main.overview?._shown ||
                    Main.layoutManager._inOverview
                );

                // If shell startup already began before eval-helper enabled, hide components immediately too
                if ((Main.layoutManager._startingUp || alreadyRunningStartup) && !Main.sessionMode.isGreeter) {
                    prepareMacDesktopHidden(false).catch(() => {});
                }

                if (Main.layoutManager._startupAnimationComplete && !this._origStartupAnimationComplete) {
                    this._origStartupAnimationComplete = Main.layoutManager._startupAnimationComplete;
                    const origComplete = this._origStartupAnimationComplete;
                    Main.layoutManager._startupAnimationComplete = function() {
                        if (this._macStartupRevealActive)
                            return;
                        return origComplete.call(this);
                    };
                }

                this._origStartupAnimationSession = Main.layoutManager._startupAnimationSession;
                this._macSessionRevealPromise = null;
                const runMacStartupSession = () => {
                    if (this._macSessionRevealPromise)
                        return this._macSessionRevealPromise;

                    const lm = Main.layoutManager;
                    lm._macStartupRevealActive = true;
                    lm._macStartupManaged = true;
                    lm._startInOverview = false;
                    suppressStartupOverview();

                    this._macSessionRevealPromise = (async () => {
                        if (!lm._coverPane && (lm._startingUp || lm._macDockChildAddedId === undefined)) {
                            await prepareMacDesktopHidden(false).catch(() => {});
                        }
                        lm.uiGroup.scale_x = 1.0;
                        lm.uiGroup.scale_y = 1.0;
                        lm.uiGroup.set_pivot_point(0, 0);
                        lm.uiGroup.opacity = 255;

                        const STARTUP_TIMEOUT_MS = 12000;

                        const checkExtensions = async () => {
                            const em = Main.extensionManager;
                            if (!em || !em._enabledExtensions || em._enabledExtensions.length === 0)
                                return;
                            const isExtEnabled = (uuid) => {
                                const ext = em.lookup(uuid);
                                return Boolean(ext && (ext.state === 1 || ext.state === 2 || ext.state === 3));
                            };
                            const isPanelVisualReady = () => {
                                const kiwiExt = em.lookup('kiwi@kemma');
                                if (kiwiExt && (kiwiExt.state === 1 || em._enabledExtensions.includes('kiwi@kemma')) && !globalThis._macKiwiReady)
                                    return false;
                                const bmsExt = em.lookup('blur-my-shell@aunetx');
                                if (bmsExt && (bmsExt.state === 1 || em._enabledExtensions.includes('blur-my-shell@aunetx'))) {
                                    const qs = Main.panel?.statusArea?.quickSettings;
                                    if (!globalThis._macMenuBarReady || (qs && !qs.has_style_class_name?.('mac-control-center-button')))
                                        return false;
                                }
                                return true;
                            };
                            const isReady = () => em._enabledExtensions.every(isExtEnabled) && isPanelVisualReady();
                            if (isReady()) return;

                            await new Promise(resolve => {
                                let pollId = 0;
                                let sigId = 0;
                                const finish = () => {
                                    if (pollId) { GLib.source_remove(pollId); pollId = 0; }
                                    if (sigId) { try { em.disconnect(sigId); } catch (_) {} sigId = 0; }
                                    resolve();
                                };
                                sigId = em.connect('extension-state-changed', () => {
                                    if (isReady()) finish();
                                });
                                pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                                    if (isReady()) {
                                        pollId = 0;
                                        finish();
                                        return GLib.SOURCE_REMOVE;
                                    }
                                    return GLib.SOURCE_CONTINUE;
                                });
                            });
                        };

                        const checkDock = async () => {
                            const isDockReady = () => {
                                const dc = lm.uiGroup.get_children().find(c => c.name === 'dashtodockContainer');
                                const dash = dc?.dash || dc?._dock?.dash;
                                return Boolean(dc && dash && dash._macHasItems && dash._macTrashReady);
                            };
                            if (isDockReady()) return;
                            await new Promise(resolve => {
                                let attempts = 0;
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                                    attempts++;
                                    if (isDockReady() || attempts > 250) {
                                        resolve();
                                        return GLib.SOURCE_REMOVE;
                                    }
                                    return GLib.SOURCE_CONTINUE;
                                });
                            });
                        };

                        const checkLiquidGlass = async () => {
                            const isGlassReady = () => {
                                const lg = Main.extensionManager?.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                                if (!lg || lg.state === 3 || lg.state === 2) return true;
                                const docks = lg?.stateObj?._dashDocks;
                                return Boolean(docks && docks.length > 0 && docks[0].manager?.bgActor && docks[0].manager?.effect?._shadersLoaded);
                            };
                            if (isGlassReady()) return;
                            await new Promise(resolve => {
                                let attempts = 0;
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                                    attempts++;
                                    if (isGlassReady() || attempts > 250) {
                                        resolve();
                                        return GLib.SOURCE_REMOVE;
                                    }
                                    return GLib.SOURCE_CONTINUE;
                                });
                            });
                        };

                        const checkWidgets = async () => {
                            const isWidgetsReady = () => {
                                const dw = Main.extensionManager?.lookup('desktop-widgets@r3nhick');
                                if (!dw || dw.state === 3 || dw.state === 2) return true;
                                const layer = dw?.stateObj?._controller?._layer ||
                                    lm._backgroundGroup?.get_children().find(c => c.has_style_class_name?.('widget-layer') || c.name === 'widget-layer');
                                return Boolean(layer && layer.get_children().length > 0);
                            };
                            if (isWidgetsReady()) return;
                            await new Promise(resolve => {
                                let attempts = 0;
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                                    attempts++;
                                    if (isWidgetsReady() || attempts > 250) {
                                        resolve();
                                        return GLib.SOURCE_REMOVE;
                                    }
                                    return GLib.SOURCE_CONTINUE;
                                });
                            });
                        };

                        const checkDing = async () => {
                            const dingExt = Main.extensionManager?.lookup('ding@rastersoft.com');
                            if (!dingExt || dingExt.state === 2 || dingExt.state === 3) return;
                            const isDingReady = () => {
                                const actors = global.get_window_actors?.() || [];
                                return actors.some(a => {
                                    const mw = a.meta_window || a.get_meta_window?.();
                                    return mw && (mw.get_gtk_application_id?.() === 'com.rastersoft.ding' ||
                                        mw.get_title?.()?.startsWith('Desktop Icons'));
                                });
                            };
                            if (isDingReady()) return;
                            await new Promise(resolve => {
                                let attempts = 0;
                                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                                    attempts++;
                                    if (isDingReady() || attempts > 200) {
                                        resolve();
                                        return GLib.SOURCE_REMOVE;
                                    }
                                    return GLib.SOURCE_CONTINUE;
                                });
                            });
                        };

                        const timeoutBarrier = new Promise(resolve => {
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, STARTUP_TIMEOUT_MS, () => {
                                resolve();
                                return GLib.SOURCE_REMOVE;
                            });
                        });

                        try {
                            if (typeof globalThis._macPrewarmSpotlight === 'function')
                                globalThis._macPrewarmSpotlight();
                        } catch (_) {}

                        await Promise.race([
                            Promise.all([checkExtensions(), checkDock(), checkLiquidGlass(), checkWidgets(), checkDing()]),
                            timeoutBarrier,
                        ]);

                        suppressStartupOverview();

                        try {
                            lm._macDockRevealActive = true;
                            global._liquidGlassDockSync?.();
                        } catch (_) {}
                        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                            resolve();
                            return GLib.SOURCE_REMOVE;
                        }));

                        if (lm._macDockChildAddedId) {
                            try { lm.uiGroup.disconnect(lm._macDockChildAddedId); } catch (_) {}
                            lm._macDockChildAddedId = null;
                        }
                        if (lm._macBgChildAddedId && lm._backgroundGroup) {
                            try { lm._backgroundGroup.disconnect(lm._macBgChildAddedId); } catch (_) {}
                            lm._macBgChildAddedId = null;
                        }

                        const DURATION = 560;
                        const MODE = Clutter.AnimationMode.EASE_OUT_CUBIC;

                        if (lm.panelBox) {
                            lm.panelBox.remove_all_transitions();
                            const panelH = lm.panelBox.height > 0 ? lm.panelBox.height : 34;
                            lm.panelBox.translation_y = -panelH;
                            lm.panelBox.opacity = 0;
                            lm.panelBox.show();
                            lm.panelBox.ease({
                                translation_y: 0,
                                opacity: 255,
                                duration: DURATION,
                                mode: MODE,
                                onComplete: () => {
                                    if (lm.panelBox) {
                                        lm.panelBox.translation_y = 0;
                                        lm.panelBox.opacity = 255;
                                    }
                                },
                            });
                        }

                        const dockContainers = lm.uiGroup.get_children().filter(c => c.name === 'dashtodockContainer');
                        const glassActors = lm.uiGroup.get_children().filter(c => c.name === 'liquid-glass-bg-actor');

                        let dockSlideOffset = { translation_x: 0, translation_y: 124 };
                        for (const dc of dockContainers) {
                            const dock = dc._dock || dc;
                            if (typeof dock._trackDock === 'function' && !dock.get_stage()) {
                                try { dock._trackDock(); } catch (_) {}
                            }
                            if (typeof dock._initialize === 'function' && dock._dockState === 0) {
                                try { dock._initialize(); } catch (_) {}
                            }
                            const dockH = dc.height > 0 ? dc.height : 92;
                            dc.remove_all_transitions();
                            if (dock.position === undefined || dock.position === St.Side.BOTTOM) {
                                dc.translation_y = -dockH;
                            }
                            dc.opacity = 255;
                            dc.show();
                            for (const child of dc.get_children()) {
                                child.remove_all_transitions();
                                child.opacity = 255;
                                child.show();
                            }

                            if (dock._slider) {
                                dock._slider.remove_all_transitions?.();
                                dock._slider.visible = true;
                                dock._slider.opacity = 255;
                                dock._slider.slide_x = 1;
                            }
                            if (dock._box) {
                                dock._box.remove_all_transitions?.();
                                dock._box.visible = true;
                                dock._box.opacity = 255;
                            }
                            dock._dockState = 2;
                            dock._startupAnimationRan = true;
                            const slideDist = dockH + 32;
                            dockSlideOffset = typeof dock._getSlideOffset === 'function'
                                ? dock._getSlideOffset(slideDist)
                                : { translation_x: 0, translation_y: slideDist };
                            if (dock.dash) {
                                dock.dash.remove_all_transitions();
                                dock.dash.visible = true;
                                dock.dash.opacity = 0;
                                dock.dash.translation_x = dockSlideOffset.translation_x;
                                dock.dash.translation_y = dockSlideOffset.translation_y;
                                dock.dash.ease({
                                    opacity: 255,
                                    translation_x: 0,
                                    translation_y: 0,
                                    duration: DURATION,
                                    mode: MODE,
                                    onComplete: () => {
                                        Main.layoutManager._macDockRevealActive = false;
                                        try { global._liquidGlassDockSync?.(); } catch (_) {}
                                    },
                                });
                            }
                        }

                        try { global._liquidGlassDockSync?.(); } catch (_) {}

                        for (const ga of glassActors) {
                            ga.remove_all_transitions();
                            ga.translation_x = dockSlideOffset.translation_x;
                            ga.translation_y = dockSlideOffset.translation_y;
                            ga.opacity = 0;
                            ga.show();
                            ga.ease({
                                opacity: 255,
                                translation_x: 0,
                                translation_y: 0,
                                duration: DURATION,
                                mode: MODE,
                                onComplete: () => {
                                    Main.layoutManager._macDockRevealActive = false;
                                    try { global._liquidGlassDockSync?.(); } catch (_) {}
                                },
                            });
                        }

                        const widgetsExt = Main.extensionManager?.lookup('desktop-widgets@r3nhick');
                        const widgetLayer = widgetsExt?.stateObj?._controller?._layer ||
                            lm._backgroundGroup?.get_children().find(c => c.has_style_class_name?.('widget-layer'));
                        if (widgetLayer) {
                            widgetLayer.remove_all_transitions();
                            widgetLayer.show();
                            if (widgetLayer.get_parent() === global.window_group) {
                                widgetLayer.opacity = 255;
                            } else {
                                widgetLayer.opacity = 0;
                                widgetLayer.ease({
                                    opacity: 255,
                                    duration: DURATION,
                                    mode: MODE,
                                });
                            }
                        }

                        if (lm._macWinGroupChildAddedId && global.window_group) {
                            try { global.window_group.disconnect(lm._macWinGroupChildAddedId); } catch (_) {}
                            lm._macWinGroupChildAddedId = null;
                        }
                        if (global.window_group) {
                            global.window_group.remove_all_transitions();
                            global.window_group.opacity = 255;
                            if (lm._backgroundGroup) {
                                lm._backgroundGroup.remove_all_transitions();
                                lm._backgroundGroup.opacity = 255;
                            }
                            for (const w of global.window_group.get_children()) {
                                if (w !== lm._backgroundGroup) {
                                    w.remove_all_transitions();
                                    w.opacity = 0;
                                    w.ease({
                                        opacity: 255,
                                        duration: DURATION,
                                        mode: MODE,
                                    });
                                }
                            }
                        }

                        if (lm._coverPane) {
                            const cover = lm._coverPane;
                            lm._coverPane = null;
                            for (const topActor of [lm.panelBox, ...dockContainers, ...glassActors]) {
                                if (topActor && topActor.get_parent?.() === lm.uiGroup) {
                                    try { lm.uiGroup.set_child_above_sibling(topActor, cover); } catch (_) {}
                                }
                            }
                            cover.remove_all_transitions();
                            cover.ease({
                                opacity: 0,
                                duration: 140,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    try { cover.destroy(); } catch (_) {}
                                },
                            });
                        }

                        if (lm._systemBackground) {
                            try { lm._systemBackground.destroy(); } catch (_) {}
                            lm._systemBackground = null;
                        }
                        lm._macStartupRevealActive = false;
                        lm._startingUp = false;
                        try { lm.emit?.('startup-complete'); } catch (_) {}
                    })();
                    return this._macSessionRevealPromise;
                };

                Main.layoutManager._startupAnimationSession = runMacStartupSession;

                // If GNOME Shell's own _doStartupAnimation() already started/passed _startupAnimationSession
                // before eval-helper.enable() ran (common on Fedora/Arch/CachyOS/Mint without layout.js overlay),
                // launch the coordinated barrier + synchronized reveal directly.
                if ((Main.layoutManager._startingUp || alreadyRunningStartup) && !Main.sessionMode.isGreeter) {
                    this._macDeferredStartupId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._macDeferredStartupId = 0;
                        if (Main.layoutManager && (alreadyRunningStartup || Main.layoutManager._startingUp || Main.overview?._visible || Main.overview?._visibleTarget)) {
                            runMacStartupSession();
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        }







        const setupMacMenuBarInteraction = async () => {
            try {
                const { PopupAnimation } = await import('resource:///org/gnome/shell/ui/boxpointer.js');
                const pmm = Main.panel?.menuManager;
                if (!pmm) return;

                if (!pmm._macOrigChangeMenu) {
                    pmm._macOrigChangeMenu = pmm._changeMenu;
                    pmm._changeMenu = function(newMenu) {
                        const active = this.activeMenu;
                        const qsMenu = Main.panel?.statusArea?.quickSettings?.menu;
                        const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                        const notifOpen = Boolean(globalThis._macNotificationCenter?._notifCenterOpen);


                        if (active === qsMenu || active === dmMenu || notifOpen || newMenu === qsMenu || newMenu === dmMenu) {
                            return;
                        }

                        return this._macOrigChangeMenu(newMenu);
                    };
                }

                if (!pmm._macOrigOnCapturedEvent) {
                    pmm._macOrigOnCapturedEvent = pmm._onCapturedEvent;
                    pmm._onCapturedEvent = function(actor, event) {
                        const menu = actor?._delegate;
                        const targetActor = global.stage.get_event_actor(event);
                        const qsMenu = Main.panel?.statusArea?.quickSettings?.menu;
                        const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                        const notifOpen = Boolean(globalThis._macNotificationCenter?._notifCenterOpen);


                        if (event.type() === Clutter.EventType.ENTER) {
                            if (menu === qsMenu || menu === dmMenu || notifOpen) {
                                return Clutter.EVENT_PROPAGATE;
                            }
                        }


                        if ((event.type() === Clutter.EventType.BUTTON_PRESS ||
                             event.type() === Clutter.EventType.TOUCH_BEGIN) &&
                            targetActor && actor && !actor.contains(targetActor)) {

                            const clickedMenu = this._findMenuForSource(targetActor);
                            if (clickedMenu && clickedMenu !== menu) {


                                this._changeMenu(clickedMenu);
                                return Clutter.EVENT_STOP;
                            }
                        }

                        return this._macOrigOnCapturedEvent(actor, event);
                    };

                    const rewire = () => {
                        for (const m of (pmm._menus || [])) {
                            if (m && m.actor) {
                                try {
                                    m.actor.disconnectObject(pmm);
                                    m.actor.connectObject('captured-event',
                                        pmm._onCapturedEvent.bind(pmm), pmm);
                                } catch (_) {}
                            }
                            if (m && !m._macCloseNotifConnected) {
                                m._macCloseNotifConnected = true;
                                m.connectObject('open-state-changed', (_menu, open) => {
                                    const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                                    if (open && globalThis._macNotificationCenter?._notifCenterOpen && _menu !== dmMenu) {
                                        globalThis._macNotificationCenter._closeNotificationCenter();
                                    }
                                }, pmm);
                            }
                        }
                    };
                    rewire();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                        rewire();
                        return GLib.SOURCE_REMOVE;
                    });
                }


                const wifi = Main.panel?.statusArea?.macWifi;
                if (wifi && typeof wifi._populateMenu === 'function') {
                    try { wifi._populateMenu(); } catch (_) {}
                }
                const bt = Main.panel?.statusArea?.macBluetooth;
                if (bt && typeof bt._populateMenu === 'function') {
                    try { bt._populateMenu(); } catch (_) {}
                }
                const vol = Main.panel?.statusArea?.macVolume;
                if (vol && typeof vol._populateMenu === 'function') {
                    try { vol._populateMenu(); } catch (_) {}
                }
            } catch (_) {}
        };
        setupMacMenuBarInteraction();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            setupMacMenuBarInteraction();
            return GLib.SOURCE_REMOVE;
        });


        try {
            this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._interfaceSettings.connectObject('changed::accent-color', () => {
                const accent = getSystemAccentColor();
                const updatePillActor = (act) => {
                    if (!act) return;
                    if (act.name === 'mac-menu-hover-pill' || act.has_style_class_name?.('mac-menu-hover-pill')) {
                        act.style = `background-color: ${accent} !important; border-radius: 9999px !important; box-shadow: none !important;`;
                    }
                    if (act.get_children) {
                        for (const child of act.get_children()) {
                            updatePillActor(child);
                        }
                    }
                };
                updatePillActor(Main.uiGroup);
                updatePillActor(Main.panel);
                for (let name of Object.keys(Main.panel.statusArea)) {
                    let ind = Main.panel.statusArea[name];
                    if (ind?.menu?._macHoverTracker?._pill) {
                        ind.menu._macHoverTracker._pill.style = `background-color: ${accent} !important; border-radius: 9999px !important; box-shadow: none !important;`;
                    }
                }
            }, this);
        } catch (_) {}


        this._gcIntervalId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 180, () => {
            try {
                if (typeof imports.system.gc === 'function') {
                    imports.system.gc();
                }
            } catch (_) {}
            return GLib.SOURCE_CONTINUE;
        });




        this._setupLaunchpadProtection();
    }

    async _setupLaunchpadProtection() {
        try {
            const { getAppFavorites } = await import('resource:///org/gnome/shell/ui/appFavorites.js');
            const favs = getAppFavorites();
            if (favs) {
                const proto = Object.getPrototypeOf(favs);
                favs.removeFavorite = function(appId) {
                    if (appId === 'launchpad.desktop') {
                        return;
                    }
                    return proto.removeFavorite.call(this, appId);
                };

                favs.moveFavoriteToPos = function(appId, pos) {
                    globalThis._isMovingFavorite = true;
                    try {
                        return proto.moveFavoriteToPos.call(this, appId, pos);
                    } finally {
                        globalThis._isMovingFavorite = false;
                    }
                };
            }

            const ensureLaunchpad = () => {
                if (globalThis._isMovingFavorite) return;
                let current = global.settings.get_strv('favorite-apps');
                if (!current.includes('launchpad.desktop')) {
                    let nautilusIdx = current.indexOf('org.gnome.Nautilus.desktop');
                    if (nautilusIdx !== -1) {
                        current.splice(nautilusIdx + 1, 0, 'launchpad.desktop');
                    } else {
                        current.unshift('launchpad.desktop');
                    }
                    global.settings.set_strv('favorite-apps', current);
                }
            };
            ensureLaunchpad();

            if (!this._favChangedId) {
                this._favChangedId = global.settings.connect('changed::favorite-apps', ensureLaunchpad);
            }

            const { AppMenu } = await import('resource:///org/gnome/shell/ui/appMenu.js');
            if (AppMenu && !this._origUpdateFavoriteItem) {
                this._origUpdateFavoriteItem = AppMenu.prototype._updateFavoriteItem;
                AppMenu.prototype._updateFavoriteItem = function() {
                    if (this._app?.get_id?.() === 'launchpad.desktop') {
                        if (this._favoriteItem) {
                            this._favoriteItem.destroy();
                            this._favoriteItem = null;
                        }
                        return;
                    }
                    return this._origUpdateFavoriteItem ? this._origUpdateFavoriteItem.apply(this, arguments) : null;
                };
            }

            const _getSearchDialogUrl = () => {
                const appMenuExt = Main.extensionManager?.lookup?.('appmenu@ChathurangaBW.github.io');
                const basePath = appMenuExt?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/appmenu@ChathurangaBW.github.io`;
                return `file://${basePath}/searchDialog.js?t=${Date.now()}`;
            };

            import(_getSearchDialogUrl())
                .then(mod => {
                    globalThis.toggleMacApplications = () => mod.toggleSearchDialog('apps');
                    globalThis.toggleApplicationsMenu = () => mod.toggleSearchDialog('apps');
                    globalThis.toggleMacClipboard = () => mod.toggleSearchDialog('clipboard');
                }).catch(e => console.error('[EvalHelper] Error loading searchDialog:', e));

            const toggleLaunchpad = () => {
                const now = Date.now();
                if (globalThis._lastLaunchpadToggle && (now - globalThis._lastLaunchpadToggle < 300)) {
                    return;
                }
                globalThis._lastLaunchpadToggle = now;
                if (typeof globalThis.toggleMacApplications === 'function') {
                    globalThis.toggleMacApplications();
                } else if (typeof globalThis.toggleMacSpotlight === 'function') {
                    globalThis.toggleMacSpotlight('apps');
                } else {
                    import(_getSearchDialogUrl())
                        .then(mod => {
                            globalThis.toggleMacApplications = () => mod.toggleSearchDialog('apps');
                            mod.toggleSearchDialog('apps');
                        }).catch(e => console.error('[EvalHelper] Error toggling launchpad via spotlight:', e));
                }
            };

            const origActivate = Shell.App.prototype._origActivate || Shell.App.prototype.activate;
            Shell.App.prototype._origActivate = origActivate;
            Shell.App.prototype.activate = function(...args) {
                if (this.get_id() === 'launchpad.desktop') {
                    toggleLaunchpad();
                    return;
                }
                return origActivate.apply(this, args);
            };
        } catch (e) {
            console.error(`[EvalHelper] Launchpad protection error: ${e}`);
        }


        try {
            import('resource:///org/gnome/shell/ui/boxpointer.js').then((BoxPointer) => {
                if (!this._origBoxPointerOpen) {
                    this._origBoxPointerOpen = BoxPointer.BoxPointer.prototype.open;
                    this._origBoxPointerClose = BoxPointer.BoxPointer.prototype.close;
                    try {
                        if ('vfunc_captured_event' in BoxPointer.BoxPointer.prototype) {
                            this._origBoxPointerCapturedEvent = BoxPointer.BoxPointer.prototype.vfunc_captured_event;
                        }
                    } catch (_) {
                        this._origBoxPointerCapturedEvent = null;
                    }
                    this._origBoxPointerDrawBorder = BoxPointer.BoxPointer.prototype._drawBorder;
                }
                BoxPointer.BoxPointer.prototype.open = function(animate, onComplete) {
                    if (this._closeTimeoutId) {
                        GLib.source_remove(this._closeTimeoutId);
                        this._closeTimeoutId = 0;
                    }
                    this._isClosingAnimation = false;
                    this.remove_all_transitions();
                    this._muteKeys = false;
                    this._muteInput = false;
                    this.show();

                    const pivotY = (this.arrowSide === St.Side.BOTTOM) ? 1.0 : 0.0;
                    const pivotX = (this.arrowSide === St.Side.RIGHT) ? 1.0 : (this.arrowSide === St.Side.LEFT ? 0.0 : 0.5);
                    this.set_pivot_point(pivotX, pivotY);
                    this.translation_x = 0;
                    this.translation_y = 0;
                    this.opacity = 255;

                    const getMenuUIM = (boxPointer) => {
                        return boxPointer?._delegate?._liquidGlassUIManager ||
                               boxPointer?.bin?._delegate?._liquidGlassUIManager ||
                               boxPointer?._sourceActor?._delegate?._liquidGlassUIManager ||
                               boxPointer?._sourceActor?._menu?._liquidGlassUIManager ||
                               boxPointer?._sourceActor?._liquidGlassUIManager ||
                               boxPointer?._liquidGlassUIManager ||
                               null;
                    };

                    try {
                        const uim = getMenuUIM(this);
                        const bg = uim?.bgActor;
                        if (bg) {
                            bg._isClosingAnimation = false;
                            bg.remove_all_transitions();
                            bg.opacity = 255;
                            bg.visible = true;
                            bg.scale_x = 1.0;
                            bg.scale_y = 1.0;
                            bg.translation_x = 0;
                            bg.translation_y = 0;
                            bg.set_pivot_point(0.0, 0.0);
                        }
                    } catch (_) {}


                    this.scale_x = 1.0;
                    this.scale_y = 1.0;
                    this._muteInput = false;
                    if (onComplete) onComplete();
                    return;
                };

                BoxPointer.BoxPointer.prototype.close = function(animate, onComplete) {
                    if (this._closeTimeoutId) {
                        GLib.source_remove(this._closeTimeoutId);
                        this._closeTimeoutId = 0;
                    }
                    if (!this.visible) {
                        if (onComplete) onComplete();
                        return;
                    }
                    this._isClosingAnimation = true;
                    this.remove_all_transitions();
                    this._muteInput = true;
                    this._muteKeys = true;

                    const getMenuUIM = (boxPointer) => {
                        return boxPointer?._delegate?._liquidGlassUIManager ||
                               boxPointer?.bin?._delegate?._liquidGlassUIManager ||
                               boxPointer?._sourceActor?._delegate?._liquidGlassUIManager ||
                               boxPointer?._sourceActor?._menu?._liquidGlassUIManager ||
                               boxPointer?._sourceActor?._liquidGlassUIManager ||
                               boxPointer?._liquidGlassUIManager ||
                               null;
                    };

                    const finalizeClose = () => {
                        if (this._closeTimeoutId) {
                            GLib.source_remove(this._closeTimeoutId);
                            this._closeTimeoutId = 0;
                        }
                        this._isClosingAnimation = false;
                        this.hide();
                        this.opacity = 0;
                        this.scale_x = 1.0;
                        this.scale_y = 1.0;
                        this.translation_x = 0;
                        this.translation_y = 0;

                        try {
                            const uim = getMenuUIM(this);
                            const bg = uim?.bgActor;
                            if (bg) {
                                bg._isClosingAnimation = false;
                                bg.remove_all_transitions();
                                bg.hide();
                                bg.opacity = 0;
                                bg.scale_x = 1.0;
                                bg.scale_y = 1.0;
                                bg.translation_x = 0;
                                bg.translation_y = 0;
                                bg.set_pivot_point(0.0, 0.0);
                            }
                        } catch (_) {}

                        if (onComplete) onComplete();


                        try {
                            const uiGroup = Main.layoutManager.uiGroup;
                            if (uiGroup) {
                                const hasOpen = Main.panel?.menuManager?._menus?.some(m => m.isOpen);
                                if (!hasOpen) {
                                    for (const c of uiGroup.get_children()) {
                                        if (c.name && c.name.startsWith('liquid-glass-bg-actor')) {
                                            const box = c.get_children ? c.get_children()[0] : null;
                                            const eff = box?.get_effects ? box.get_effects()[0] : null;
                                            const owner = eff?._owner || '';
                                            if (owner === 'menu' || owner.startsWith('menu:') || owner === 'switcher-popup') {
                                                if (c.visible) {
                                                    c.hide();
                                                    c.opacity = 0;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (_) {}
                    };




                    if (animate === 0 || animate === false || animate === BoxPointer.PopupAnimation.FADE) {
                        finalizeClose();
                        return;
                    }


                    this._closeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._closeTimeoutId = 0;
                        finalizeClose();
                        return GLib.SOURCE_REMOVE;
                    });

                    const pivotY = (this.arrowSide === St.Side.BOTTOM) ? 1.0 : 0.0;
                    const pivotX = (this.arrowSide === St.Side.RIGHT) ? 1.0 : (this.arrowSide === St.Side.LEFT ? 0.0 : 0.5);
                    this.set_pivot_point(pivotX, pivotY);


                    try {
                        const uim = getMenuUIM(this);
                        const bg = uim?.bgActor;
                        if (bg && bg.visible) {
                            bg._isClosingAnimation = true;
                            bg.remove_all_transitions();
                            bg.ease({
                                opacity: 0,
                                duration: 70,
                                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                                onComplete: () => {
                                    bg._isClosingAnimation = false;
                                    bg.hide();
                                    bg.opacity = 0;
                                    bg.scale_x = 1.0;
                                    bg.scale_y = 1.0;
                                    bg.translation_x = 0;
                                    bg.translation_y = 0;
                                    bg.set_pivot_point(0.0, 0.0);
                                }
                            });
                        }
                    } catch (_) {}

                    this.ease({
                        opacity: 0,
                        duration: 70,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: finalizeClose
                    });
                };

                if (this._origBoxPointerCapturedEvent) {
                    BoxPointer.BoxPointer.prototype.vfunc_captured_event = function(event) {
                        if (event.type() === Clutter.EventType.ENTER ||
                            event.type() === Clutter.EventType.LEAVE)
                            return Clutter.EVENT_PROPAGATE;


                        if (this.visible && !this._isClosingAnimation) {
                            const type = event.type();
                            if (type !== Clutter.EventType.KEY_PRESS && type !== Clutter.EventType.KEY_RELEASE)
                                return Clutter.EVENT_PROPAGATE;
                        }

                        const mute = event.type() === Clutter.EventType.KEY_PRESS ||
                            event.type() === Clutter.EventType.KEY_RELEASE
                            ? this._muteKeys : this._muteInput;

                        if (mute)
                            return Clutter.EVENT_STOP;

                        return Clutter.EVENT_PROPAGATE;
                    };
                }

                BoxPointer.BoxPointer.prototype._drawBorder = function(area) {
                    const themeNode = this.get_theme_node();

                    if (this._arrowActor) {
                        const [sourceX, sourceY] = this._arrowActor.get_transformed_position();
                        const [sourceWidth, sourceHeight] = this._arrowActor.get_transformed_size();
                        const [absX, absY] = this.get_transformed_position();

                        if (this._arrowSide === St.Side.TOP ||
                            this._arrowSide === St.Side.BOTTOM)
                            this._arrowOrigin = sourceX - absX + sourceWidth / 2;
                        else
                            this._arrowOrigin = sourceY - absY + sourceHeight / 2;
                    }

                    const borderWidth = themeNode.get_length('-arrow-border-width');
                    const base = themeNode.get_length('-arrow-base') || 18.0;
                    const rise = themeNode.get_length('-arrow-rise');
                    const borderRadius = themeNode.get_length('-arrow-border-radius');

                    const halfBorder = borderWidth / 2;
                    const halfBase = Math.floor(base / 2);

                    const [width, height] = area.get_surface_size();
                    let [boxWidth, boxHeight] = [width, height];
                    if (this._arrowSide === St.Side.TOP || this._arrowSide === St.Side.BOTTOM)
                        boxHeight -= rise;
                    else
                        boxWidth -= rise;

                    const cr = area.get_context();
                    cr.setAntialias(cairo.Antialias.SUBPIXEL);
                    cr.setLineCap(cairo.LineCap.ROUND);
                    cr.setLineJoin(cairo.LineJoin.ROUND);

                    // Translate so that box goes from 0,0 to boxWidth,boxHeight,
                    // with the arrow poking out of that
                    if (this._arrowSide === St.Side.TOP)
                        cr.translate(0, rise);
                    else if (this._arrowSide === St.Side.LEFT)
                        cr.translate(rise, 0);

                    const [x1, y1] = [halfBorder, halfBorder];
                    const [x2, y2] = [boxWidth - halfBorder, boxHeight - halfBorder];

                    let skipTopLeft = false;
                    let skipTopRight = false;
                    let skipBottomLeft = false;
                    let skipBottomRight = false;

                    if (rise) {
                        switch (this._arrowSide) {
                        case St.Side.TOP:
                            if (this._arrowOrigin === x1) skipTopLeft = true;
                            else if (this._arrowOrigin === x2) skipTopRight = true;
                            break;
                        case St.Side.RIGHT:
                            if (this._arrowOrigin === y1) skipTopRight = true;
                            else if (this._arrowOrigin === y2) skipBottomRight = true;
                            break;
                        case St.Side.BOTTOM:
                            if (this._arrowOrigin === x1) skipBottomLeft = true;
                            else if (this._arrowOrigin === x2) skipBottomRight = true;
                            break;
                        case St.Side.LEFT:
                            if (this._arrowOrigin === y1) skipTopLeft = true;
                            else if (this._arrowOrigin === y2) skipBottomLeft = true;
                            break;
                        }
                    }

                    // Smoothed organic birteg tail curve parameters
                    const f = Math.min(8.0, halfBase * 0.9);
                    const tipR = 1.8;

                    cr.moveTo(x1 + borderRadius, y1);
                    if (this._arrowSide === St.Side.TOP && rise) {
                        if (skipTopLeft) {
                            cr.moveTo(x1, y2 - borderRadius);
                            cr.lineTo(x1, y1 - rise);
                            cr.lineTo(x1 + halfBase, y1);
                        } else if (skipTopRight) {
                            cr.lineTo(x2 - halfBase, y1);
                            cr.lineTo(x2, y1 - rise);
                            cr.lineTo(x2, y1 + borderRadius);
                        } else {
                            const cx = this._arrowOrigin;
                            cr.lineTo(cx - halfBase - f, y1);
                            cr.curveTo(cx - halfBase - f * 0.5, y1, cx - halfBase - 1.2, y1 - rise * 0.25, cx - halfBase, y1 - rise * 0.55);
                            cr.curveTo(cx - halfBase + 1.2, y1 - rise * 0.85, cx - tipR * 1.3, y1 - rise, cx, y1 - rise);
                            cr.curveTo(cx + tipR * 1.3, y1 - rise, cx + halfBase - 1.2, y1 - rise * 0.85, cx + halfBase, y1 - rise * 0.55);
                            cr.curveTo(cx + halfBase + 1.2, y1 - rise * 0.25, cx + halfBase + f * 0.5, y1, cx + halfBase + f, y1);
                        }
                    }

                    if (!skipTopRight) {
                        cr.lineTo(x2 - borderRadius, y1);
                        cr.arc(x2 - borderRadius, y1 + borderRadius, borderRadius, 3 * Math.PI / 2, Math.PI * 2);
                    }

                    if (this._arrowSide === St.Side.RIGHT && rise) {
                        if (skipTopRight) {
                            cr.lineTo(x2 + rise, y1);
                            cr.lineTo(x2 + rise, y1 + halfBase);
                        } else if (skipBottomRight) {
                            cr.lineTo(x2, y2 - halfBase);
                            cr.lineTo(x2 + rise, y2);
                            cr.lineTo(x2 - borderRadius, y2);
                        } else {
                            const cy = this._arrowOrigin;
                            cr.lineTo(x2, cy - halfBase - f);
                            cr.curveTo(x2, cy - halfBase - f * 0.5, x2 + rise * 0.25, cy - halfBase - 1.2, x2 + rise * 0.55, cy - halfBase);
                            cr.curveTo(x2 + rise * 0.85, cy - halfBase + 1.2, x2 + rise, cy - tipR * 1.3, x2 + rise, cy);
                            cr.curveTo(x2 + rise, cy + tipR * 1.3, x2 + rise * 0.85, cy + halfBase - 1.2, x2 + rise * 0.55, cy + halfBase);
                            cr.curveTo(x2 + rise * 0.25, cy + halfBase + 1.2, x2, cy + halfBase + f * 0.5, x2, cy + halfBase + f);
                        }
                    }

                    if (!skipBottomRight) {
                        cr.lineTo(x2, y2 - borderRadius);
                        cr.arc(x2 - borderRadius, y2 - borderRadius, borderRadius, 0, Math.PI / 2);
                    }

                    if (this._arrowSide === St.Side.BOTTOM && rise) {
                        if (skipBottomLeft) {
                            cr.lineTo(x1 + halfBase, y2);
                            cr.lineTo(x1, y2 + rise);
                            cr.lineTo(x1, y2 - borderRadius);
                        } else if (skipBottomRight) {
                            cr.lineTo(x2, y2 + rise);
                            cr.lineTo(x2 - halfBase, y2);
                        } else {
                            const cx = this._arrowOrigin;
                            cr.lineTo(cx + halfBase + f, y2);
                            cr.curveTo(cx + halfBase + f * 0.5, y2, cx + halfBase + 1.2, y2 + rise * 0.25, cx + halfBase, y2 + rise * 0.55);
                            cr.curveTo(cx + halfBase - 1.2, y2 + rise * 0.85, cx + tipR * 1.3, y2 + rise, cx, y2 + rise);
                            cr.curveTo(cx - tipR * 1.3, y2 + rise, cx - halfBase + 1.2, y2 + rise * 0.85, cx - halfBase, y2 + rise * 0.55);
                            cr.curveTo(cx - halfBase - 1.2, y2 + rise * 0.25, cx - halfBase - f * 0.5, y2, cx - halfBase - f, y2);
                        }
                    }

                    if (!skipBottomLeft) {
                        cr.lineTo(x1 + borderRadius, y2);
                        cr.arc(x1 + borderRadius, y2 - borderRadius, borderRadius, Math.PI / 2, Math.PI);
                    }

                    if (this._arrowSide === St.Side.LEFT && rise) {
                        if (skipTopLeft) {
                            cr.lineTo(x1, y1 + halfBase);
                            cr.lineTo(x1 - rise, y1);
                            cr.lineTo(x1 + borderRadius, y1);
                        } else if (skipBottomLeft) {
                            cr.lineTo(x1 - rise, y2);
                            cr.lineTo(x1 - rise, y2 - halfBase);
                        } else {
                            const cy = this._arrowOrigin;
                            cr.lineTo(x1, cy + halfBase + f);
                            cr.curveTo(x1, cy + halfBase + f * 0.5, x1 - rise * 0.25, cy + halfBase + 1.2, x1 - rise * 0.55, cy + halfBase);
                            cr.curveTo(x1 - rise * 0.85, cy + halfBase - 1.2, x1 - rise, cy + tipR * 1.3, x1 - rise, cy);
                            cr.curveTo(x1 - rise, cy - tipR * 1.3, x1 - rise * 0.85, cy - halfBase + 1.2, x1 - rise * 0.55, cy - halfBase);
                            cr.curveTo(x1 - rise * 0.25, cy - halfBase - 1.2, x1, cy - halfBase - f * 0.5, x1, cy - halfBase - f);
                        }
                    }

                    if (!skipTopLeft) {
                        cr.lineTo(x1, y1 + borderRadius);
                        cr.arc(x1 + borderRadius, y1 + borderRadius, borderRadius, Math.PI, 3 * Math.PI / 2);
                    }

                    const [hasColor, bgColor] = themeNode.lookup_color('-arrow-background-color', false);
                    if (hasColor) {
                        cr.setSourceColor(bgColor);
                        cr.fillPreserve();
                    }

                    if (borderWidth > 0) {
                        const borderColor = themeNode.get_color('-arrow-border-color');
                        cr.setSourceColor(borderColor);
                        cr.setLineWidth(borderWidth);
                        cr.stroke();
                    }

                    cr.$dispose();
                };


                const patchAppIndicators = () => {
                    try {
                        const ext = Main.extensionManager?.lookup('ubuntu-appindicators@ubuntu.com');
                        const uri = ext?.dir ? (ext.dir.get_uri() + '/indicatorStatusIcon.js') : 'file:///usr/share/gnome-shell/extensions/ubuntu-appindicators@ubuntu.com/indicatorStatusIcon.js';
                        import(uri).then(mod => {
                            const proto = mod?.IndicatorStatusIcon?.prototype;
                            if (proto && !proto._macInstantClickPatched) {
                                proto._macInstantClickPatched = true;
                                proto._waitForDoubleClick = async function() {
                                    this.menu?.toggle();
                                };
                                const origBtn = proto.vfunc_button_press_event;
                                proto.vfunc_button_press_event = function(event) {
                                    if (this._waitDoubleClickPromise) {
                                        try { this._waitDoubleClickPromise.cancel(); } catch (_) {}
                                    }
                                    if (event.get_button() === 2) {
                                        if (Main.panel?.menuManager?.activeMenu)
                                            Main.panel.menuManager._closeMenu(true, Main.panel.menuManager.activeMenu);
                                        this._indicator?.secondaryActivate(event.get_time(), ...event.get_coords());
                                        return 1;
                                    }
                                    if (event.get_button() === 3 || event.get_button() === 1) {
                                        if (this.menu) {
                                            this.menu.toggle();
                                            return 0;
                                        }
                                    }
                                    return origBtn ? origBtn.call(this, event) : 0;
                                };
                            }
                        }).catch(() => {});
                    } catch (_) {}
                };
                patchAppIndicators();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    patchAppIndicators();
                    return GLib.SOURCE_REMOVE;
                });
            }).catch(e => console.error(`[EvalHelper] BoxPointer patch error: ${e}`));
        } catch (e) {
            console.error(`[EvalHelper] BoxPointer setup error: ${e}`);
        }


        try {
            if (!this._origWmDestroyWindow && Main.wm?._destroyWindow) {
                this._origWmDestroyWindow = Main.wm._destroyWindow;
                const self = this;
                Main.wm._destroyWindow = function(shellwm, actor) {
                    try {
                        const window = actor?.meta_window;
                        const windowType = window ? window.get_window_type() : (actor?._windowType ?? -1);
                        const isMenuWindow = (
                            windowType === Meta.WindowType.DROPDOWN_MENU ||
                            windowType === Meta.WindowType.POPUP_MENU ||
                            windowType === Meta.WindowType.MENU
                        );

                        if (isMenuWindow && actor.is_mapped() && actor.visible && actor.opacity > 0) {
                            window?.disconnectObject(actor);
                            this._destroying.add(actor);
                            actor.set_pivot_point(0.5, 0.5);
                            actor.ease({
                                opacity: 0,
                                scale_x: 0.95,
                                scale_y: 0.95,
                                duration: 120,
                                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                                onStopped: () => {
                                    this._destroyWindowDone(shellwm, actor);
                                }
                            });
                            return;
                        }
                    } catch (e) {
                        console.error(`[EvalHelper] Menu window exit animation error: ${e}`);
                    }
                    return self._origWmDestroyWindow.call(this, shellwm, actor);
                };
            }
        } catch (e) {
            console.error(`[EvalHelper] wm._destroyWindow setup error: ${e}`);
        }


        this._dimmerWatchdogId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 10, () => {
            try {
                const uiGroup = Main.layoutManager?.uiGroup;
                if (!uiGroup) return GLib.SOURCE_CONTINUE;
                const hasOpen = Main.panel?.menuManager?._menus?.some(m => m.isOpen);
                if (hasOpen) return GLib.SOURCE_CONTINUE;
                for (const c of uiGroup.get_children()) {
                    if (c.name && c.name.startsWith('liquid-glass-bg-actor')) {
                        const box = c.get_children ? c.get_children()[0] : null;
                        const eff = box?.get_effects ? box.get_effects()[0] : null;
                        const owner = eff?._owner || '';
                        if (owner === 'menu' || owner.startsWith('menu:') || owner === 'switcher-popup') {
                            if (c.visible) {
                                c.hide();
                                c.opacity = 0;
                            }
                        }
                    }
                }
            } catch (_) {}
            return GLib.SOURCE_CONTINUE;
        });

        this._setupWineWindowStacking();
        this._setupMinimizedWindowSnapshotManager();
        this._setupMemoryOptimizer();
        this._setupForcedWindowCorners();
        this._setupDynamicMenuAlignment();
        this._setupExtensionUpdateGuard();
    }

    _cleanStagedExtensionUpdates() {
        try {
            const updatesRoot = GLib.build_filenamev([
                GLib.get_user_data_dir(),
                'gnome-shell',
                'extension-updates',
            ]);
            const updatesDir = Gio.File.new_for_path(updatesRoot);
            if (!updatesDir.query_exists(null)) return;

            const userExtRoot = GLib.build_filenamev([
                GLib.get_user_data_dir(),
                'gnome-shell',
                'extensions',
            ]);
            const enumerator = updatesDir.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const uuid = info.get_name();
                const extPath = GLib.build_filenamev([userExtRoot, uuid]);
                if (!GLib.file_test(extPath, GLib.FileTest.IS_DIR)) continue;
                const stagedDir = updatesDir.get_child(uuid);
                try {
                    const rmDirRec = (dirFile) => {
                        const childEnum = dirFile.enumerate_children(
                            'standard::name,standard::type',
                            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                            null
                        );
                        let childInfo;
                        while ((childInfo = childEnum.next_file(null)) !== null) {
                            const childFile = dirFile.get_child(childInfo.get_name());
                            if (childInfo.get_file_type() === Gio.FileType.DIRECTORY)
                                rmDirRec(childFile);
                            else
                                childFile.delete(null);
                        }
                        childEnum.close(null);
                        dirFile.delete(null);
                    };
                    rmDirRec(stagedDir);
                } catch (_) {}
            }
            enumerator.close(null);
        } catch (_) {}
    }

    _setupExtensionUpdateGuard() {
        this._cleanStagedExtensionUpdates();
        try {
            if (!Main.extensionManager) return;
            if (!this._updatesGuardInstalled) {
                this._origUpdatesDesc = Object.getOwnPropertyDescriptor(
                    Main.extensionManager,
                    'updatesSupported'
                ) || null;
                Object.defineProperty(Main.extensionManager, 'updatesSupported', {
                    get: () => false,
                    configurable: true,
                });
                this._updatesGuardInstalled = true;
            }
        } catch (e) {
            console.error(`[EvalHelper] Extension update guard error: ${e}`);
        }
    }

    _teardownExtensionUpdateGuard() {
        this._cleanStagedExtensionUpdates();
        try {
            if (this._updatesGuardInstalled && Main.extensionManager) {
                if (this._origUpdatesDesc)
                    Object.defineProperty(Main.extensionManager, 'updatesSupported', this._origUpdatesDesc);
                else
                    delete Main.extensionManager.updatesSupported;
            }
        } catch (_) {}
        this._origUpdatesDesc = null;
        this._updatesGuardInstalled = false;
    }

    _setupDynamicMenuAlignment() {
        const autoAlignMenu = (menu) => {
            if (!menu || !menu._getMenuItems) return;
            const items = menu._getMenuItems().filter(it => it instanceof PopupMenu.PopupBaseMenuItem && !(it instanceof PopupMenu.PopupSeparatorMenuItem));
            if (!items.length) return;

            const hasCheckbox = items.some(it => {
                if (it._ornament === PopupMenu.Ornament.CHECK || it._ornament === PopupMenu.Ornament.DOT) return true;
                if (it._checkSlot && it._checkSlot.text && it._checkSlot.text.trim().length > 0) return true;
                if (it.has_style_class_name && it.has_style_class_name('mac-menu-item-active')) return true;
                const tt = it._dbusItem?.propertyGet?.('toggle-type');
                if (tt === 'checkmark' || tt === 'radio') return true;
                return false;
            });

            const box = menu.box || menu.actor;
            if (hasCheckbox) {
                box?.add_style_class_name?.('has-checkbox-items');
                for (const it of items) {
                    if (it._ornament === PopupMenu.Ornament.HIDDEN) {
                        it.setOrnament(PopupMenu.Ornament.NONE);
                    }
                }
            } else {
                box?.remove_style_class_name?.('has-checkbox-items');
                for (const it of items) {
                    if (it._ornament === PopupMenu.Ornament.NONE) {
                        it.setOrnament(PopupMenu.Ornament.HIDDEN);
                    }
                    if (it._ornamentIcon) {
                        it._ornamentIcon.visible = false;
                    }
                    if (it.remove_style_class_name) {
                        it.remove_style_class_name('popup-ornamented-menu-item');
                    }
                }
            }
        };

        if (!PopupMenu.PopupMenu.prototype._origMacAutoAlignOpen) {
            PopupMenu.PopupMenu.prototype._origMacAutoAlignOpen = PopupMenu.PopupMenu.prototype.open;
            PopupMenu.PopupMenu.prototype.open = function(animate) {
                try { autoAlignMenu(this); } catch (_) {}
                return this._origMacAutoAlignOpen(animate);
            };
        }

        if (!PopupMenu.PopupSubMenu.prototype._origMacAutoAlignOpen) {
            PopupMenu.PopupSubMenu.prototype._origMacAutoAlignOpen = PopupMenu.PopupSubMenu.prototype.open;
            PopupMenu.PopupSubMenu.prototype.open = function(animate) {
                try { autoAlignMenu(this); } catch (_) {}
                return this._origMacAutoAlignOpen(animate);
            };
        }

        try {
            if (Main.panel?.statusArea) {
                for (const key of Object.keys(Main.panel.statusArea)) {
                    const item = Main.panel.statusArea[key];
                    if (item?.menu) autoAlignMenu(item.menu);
                }
            }
        } catch (_) {}
    }

    disable() {
        this._teardownExtensionUpdateGuard();
        try {
            if (PopupMenu.PopupMenu.prototype._origMacAutoAlignOpen) {
                PopupMenu.PopupMenu.prototype.open = PopupMenu.PopupMenu.prototype._origMacAutoAlignOpen;
                delete PopupMenu.PopupMenu.prototype._origMacAutoAlignOpen;
            }
            if (PopupMenu.PopupSubMenu.prototype._origMacAutoAlignOpen) {
                PopupMenu.PopupSubMenu.prototype.open = PopupMenu.PopupSubMenu.prototype._origMacAutoAlignOpen;
                delete PopupMenu.PopupSubMenu.prototype._origMacAutoAlignOpen;
            }
        } catch (_) {}
        try {
            MacSetupWizard.stopSetupWizard();
        } catch (_) {}
        if (this._memOptimizerCleanups) {
            this._memOptimizerCleanups.forEach(fn => {
                try { fn(); } catch (_) {}
            });
            this._memOptimizerCleanups = null;
        }
        if (this._windowCornerEntries) {
            for (const [win, entry] of this._windowCornerEntries.entries()) {
                if (entry.signals) {
                    entry.signals.forEach(id => {
                        try { win.disconnect(id); } catch (_) {}
                    });
                }
                if (entry.actorSignal && entry.actor) {
                    try { entry.actor.disconnect(entry.actorSignal); } catch (_) {}
                }
                if (entry.actorDestroyId && entry.actor) {
                    try { entry.actor.disconnect(entry.actorDestroyId); } catch (_) {}
                }
                if (entry.actor && entry.effect) {
                    try { entry.actor.remove_effect(entry.effect); } catch (_) {}
                }
            }
            this._windowCornerEntries.clear();
            this._windowCornerEntries = null;
        }
        if (this._cornerCleanups) {
            this._cornerCleanups.forEach(fn => {
                try { fn(); } catch (_) {}
            });
            this._cornerCleanups = null;
        }
        if (this._snapshotCleanups) {
            this._snapshotCleanups.forEach(fn => {
                try { fn(); } catch (_) {}
            });
            this._snapshotCleanups = null;
        }
        if (Main.screenshotUI) {
            try { MacScreenshotUI.destroyMacScreenshotUI(); } catch (_) {}
            if (this._screenshotTakenSignalId) {
                try { Main.screenshotUI.disconnect(this._screenshotTakenSignalId); } catch (_) {}
                this._screenshotTakenSignalId = 0;
            }
            if (this._screencastNotifySignalId) {
                try { Main.screenshotUI.disconnect(this._screencastNotifySignalId); } catch (_) {}
                this._screencastNotifySignalId = 0;
            }
        }
        if (this._origSoundPlayerPlayFromTheme && Meta.SoundPlayer?.prototype) {
            try { Meta.SoundPlayer.prototype.play_from_theme = this._origSoundPlayerPlayFromTheme; } catch (_) {}
            this._origSoundPlayerPlayFromTheme = null;
        }

        if (this._dimmerWatchdogId) {
            GLib.source_remove(this._dimmerWatchdogId);
            this._dimmerWatchdogId = 0;
        }

        if (this._origBoxPointerOpen) {
            try {
                import('resource:///org/gnome/shell/ui/boxpointer.js').then((BoxPointer) => {
                    if (this._origBoxPointerOpen) BoxPointer.BoxPointer.prototype.open = this._origBoxPointerOpen;
                    if (this._origBoxPointerClose) BoxPointer.BoxPointer.prototype.close = this._origBoxPointerClose;
                    if (this._origBoxPointerCapturedEvent) BoxPointer.BoxPointer.prototype.vfunc_captured_event = this._origBoxPointerCapturedEvent;
                    if (this._origBoxPointerDrawBorder) BoxPointer.BoxPointer.prototype._drawBorder = this._origBoxPointerDrawBorder;
                });
            } catch (_) {}
            this._origBoxPointerOpen = null;
            this._origBoxPointerClose = null;
            this._origBoxPointerCapturedEvent = null;
            this._origBoxPointerDrawBorder = null;
        }

        if (this._origWmDestroyWindow && Main.wm) {
            Main.wm._destroyWindow = this._origWmDestroyWindow;
            this._origWmDestroyWindow = null;
        }

        if (this._dbusImpl) {
            try { this._dbusImpl.unexport(); } catch (_) {}
            this._dbusImpl = null;
        }

        if (this._focusSignalId && global.display) {
            try { global.display.disconnect(this._focusSignalId); } catch (_) {}
            this._focusSignalId = 0;
        }

        const fdo = Main.notificationDaemon?._fdoNotificationDaemon;
        if (fdo && this._origGetSourceForPidAndName) {
            fdo._getSourceForPidAndName = this._origGetSourceForPidAndName;
            this._origGetSourceForPidAndName = null;
        }

        const wah = Main.windowAttentionHandler;
        if (wah && this._origOnWindowDemandsAttention) {
            wah._onWindowDemandsAttention = this._origOnWindowDemandsAttention;
            this._origOnWindowDemandsAttention = null;
        }

        if (this._demandsAttentionId) {
            global.display.disconnect(this._demandsAttentionId);
            this._demandsAttentionId = null;
        }

        if (this._markedUrgentId) {
            global.display.disconnect(this._markedUrgentId);
            this._markedUrgentId = null;
        }

        if (this._accentColorId && this._ifaceSettings) {
            try { this._ifaceSettings.disconnect(this._accentColorId); } catch (_) {}
            this._accentColorId = 0;
            this._ifaceSettings = null;
        }

        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = null;
        }

        if (global.display) {
            try { global.display.disconnectObject(this); } catch (_) {}
        }
        const cursorTracker = global.backend?.get_cursor_tracker?.();
        if (cursorTracker) {
            try { cursorTracker.disconnectObject(this); } catch (_) {}
        }
        if (global.window_manager) {
            try { global.window_manager.disconnectObject(this); } catch (_) {}
        }

        try { Main.overview.disconnectObject(this); } catch (_) {}
        if (Main.overview) {
            if (Main.overview._macDingShowingConn) {
                try { Main.overview.disconnect(Main.overview._macDingShowingConn); } catch (_) {}
                Main.overview._macDingShowingConn = null;
            }
            if (Main.overview._macDingShownConn) {
                try { Main.overview.disconnect(Main.overview._macDingShownConn); } catch (_) {}
                Main.overview._macDingShownConn = null;
            }
            if (Main.overview._macDingHidingConn) {
                try { Main.overview.disconnect(Main.overview._macDingHidingConn); } catch (_) {}
                Main.overview._macDingHidingConn = null;
            }
            if (Main.overview._macDingHiddenConn) {
                try { Main.overview.disconnect(Main.overview._macDingHiddenConn); } catch (_) {}
                Main.overview._macDingHiddenConn = null;
            }
            if (Main.overview._macWgHidingConn) {
                try { Main.overview.disconnect(Main.overview._macWgHidingConn); } catch (_) {}
                Main.overview._macWgHidingConn = null;
            }
            const controls = Main.overview._overview?.controls;
            const stateAdj = controls?._stateAdjustment;
            if (stateAdj && stateAdj._macDingStateConn) {
                try { stateAdj.disconnect(stateAdj._macDingStateConn); } catch (_) {}
                stateAdj._macDingStateConn = null;
            }
            if (globalThis._macCleanupDingClones) {
                try { globalThis._macCleanupDingClones(); } catch (_) {}
                globalThis._macCleanupDingClones = null;
            }
        }
        Main.overview._macHideWsBgConn = null;
        Main.overview._macShowWsBgConn = null;

        if (this._dockSignals) {
            this._dockSignals.forEach(id => {
                try { global.window_manager?.disconnect(id); } catch (_) {}
                try { Main.overview?.disconnect(id); } catch (_) {}
            });
            this._dockSignals = null;
            this._macDockSignalsConnected = false;
        }
        if (this._dockMagSignals) {
            this._dockMagSignals.forEach(id => {
                try { Main.overview?.disconnect(id); } catch (_) {}
            });
            this._dockMagSignals = null;
            this._dockMagSignalsConnected = false;
        }

        if (this._overviewWallpaperManager) {
            try { this._overviewWallpaperManager.destroy(); } catch (_) {}
            this._overviewWallpaperManager = null;
        }

        if (this._macDeferredStartupId) {
            GLib.source_remove(this._macDeferredStartupId);
            this._macDeferredStartupId = 0;
        }
        this._macSessionRevealPromise = null;

        if (Main.layoutManager && this._origStartupAnimationComplete) {
            Main.layoutManager._startupAnimationComplete = this._origStartupAnimationComplete;
            this._origStartupAnimationComplete = null;
        }
        if (Main.layoutManager) {
            Main.layoutManager._macStartupRevealActive = false;
        }

        if (Main.layoutManager && this._origStartupAnimationSession) {
            Main.layoutManager._startupAnimationSession = this._origStartupAnimationSession;
            this._origStartupAnimationSession = null;
        }

        if (Main.layoutManager && this._origPrepareStartupAnimation) {
            Main.layoutManager._prepareStartupAnimation = this._origPrepareStartupAnimation;
            this._origPrepareStartupAnimation = null;
        }

        if (Main.layoutManager) {
            if (Main.layoutManager._macWinGroupChildAddedId && global.window_group) {
                try { global.window_group.disconnect(Main.layoutManager._macWinGroupChildAddedId); } catch (_) {}
                Main.layoutManager._macWinGroupChildAddedId = null;
            }
            if (Main.layoutManager._macDockChildAddedId) {
                try { Main.layoutManager.uiGroup.disconnect(Main.layoutManager._macDockChildAddedId); } catch (_) {}
                Main.layoutManager._macDockChildAddedId = null;
            }
            if (Main.layoutManager._macBgChildAddedId && Main.layoutManager._backgroundGroup) {
                try { Main.layoutManager._backgroundGroup.disconnect(Main.layoutManager._macBgChildAddedId); } catch (_) {}
                Main.layoutManager._macBgChildAddedId = null;
            }
            if (Main.layoutManager._coverPane) {
                try { Main.layoutManager._coverPane.destroy(); } catch (_) {}
                Main.layoutManager._coverPane = null;
            }
            Main.layoutManager._macDockRevealActive = false;
            Main.layoutManager._macStartupManaged = false;
        }

        if (this._gcIntervalId) {
            GLib.source_remove(this._gcIntervalId);
            this._gcIntervalId = null;
        }

        if (this._favChangedId) {
            global.settings.disconnect(this._favChangedId);
            this._favChangedId = null;
        }

        if (this._origRemoveFavorite) {
            try {
                import('resource:///org/gnome/shell/ui/appFavorites.js').then(({ getAppFavorites }) => {
                    const favs = getAppFavorites();
                    if (favs) {
                        favs.removeFavorite = this._origRemoveFavorite;
                        favs.moveFavoriteToPos = this._origMoveFavoriteToPos;
                    }
                });
            } catch (_) {}
            this._origRemoveFavorite = null;
            this._origMoveFavoriteToPos = null;
        }

        if (this._disableExtSignalId && this._shellSettings) {
            this._shellSettings.disconnect(this._disableExtSignalId);
            this._disableExtSignalId = null;
        }

        if (this._userThemeSignalId && this._userThemeSettings) {
            this._userThemeSettings.disconnect(this._userThemeSignalId);
            this._userThemeSignalId = null;
        }

        if (this._wackExtStateSignalId && Main.extensionManager) {
            try { Main.extensionManager.disconnect(this._wackExtStateSignalId); } catch (_) {}
            this._wackExtStateSignalId = 0;
        }

        if (this._origUpdateFavoriteItem) {
            try {
                import('resource:///org/gnome/shell/ui/appMenu.js').then(({ AppMenu }) => {
                    if (AppMenu) AppMenu.prototype._updateFavoriteItem = this._origUpdateFavoriteItem;
                });
            } catch (_) {}
            this._origUpdateFavoriteItem = null;
        }

        if (this._dockSignals) {
            for (const id of this._dockSignals) {
                try { global.display.disconnect(id); } catch (_) {}
                try { global.window_manager.disconnect(id); } catch (_) {}
                try { Main.overview.disconnect(id); } catch (_) {}
            }
            this._dockSignals = null;
            this._macDockSignalsConnected = false;
        }

        if (this._dockMagSignals) {
            for (const id of this._dockMagSignals) {
                try { Main.overview.disconnect(id); } catch (_) {}
            }
            this._dockMagSignals = null;
            this._dockMagSignalsConnected = false;
        }

        if (this._origIsPointerOverDock) {
            try {
                const d2d = Main.uiGroup?.get_children?.()?.find(c => c.name === 'dashtodockContainer');
                const mag = d2d?._dock?._magnifier || d2d?._magnifier;
                if (mag && mag.constructor?.prototype) {
                    mag.constructor.prototype._isPointerOverDock = this._origIsPointerOverDock;
                }
            } catch (_) {}
            this._origIsPointerOverDock = null;
        }

        if (this._origBmsUpdateSize) {
            try {
                const bmsExt = Main.extensionManager.lookup('blur-my-shell@aunetx');
                const appsBlur = bmsExt?.stateObj?._applications_blur;
                if (appsBlur?.constructor?.prototype) {
                    appsBlur.constructor.prototype.update_size = this._origBmsUpdateSize;
                }
            } catch (_) {}
            this._origBmsUpdateSize = null;
        }

        if (globalThis._macDlgStageId) {
            try { global.stage.disconnect(globalThis._macDlgStageId); } catch (_) {}
            globalThis._macDlgStageId = 0;
        }
        if (globalThis._macDlgChildId) {
            try { Main.layoutManager.modalDialogGroup?.disconnect(globalThis._macDlgChildId); } catch (_) {}
            globalThis._macDlgChildId = 0;
        }
        if (globalThis._macDlgStates) {
            for (const st of globalThis._macDlgStates) {
                try { st.glass?.hide(); } catch (_) {}
            }
        }

        globalThis._macGlideDisposed = true;
        if (PopupMenu.PopupMenu.prototype._origMacGlideOpen) {
            if (PopupMenu.PopupMenu.prototype.open === PopupMenu.PopupMenu.prototype._macGlideOpenWrapper)
                PopupMenu.PopupMenu.prototype.open = PopupMenu.PopupMenu.prototype._origMacGlideOpen;
            PopupMenu.PopupMenu.prototype._origMacGlideOpen = null;
            PopupMenu.PopupMenu.prototype._macGlideOpenWrapper = null;
        }
        if (PopupMenu.PopupSubMenu?.prototype?._origMacGlideOpen) {
            if (PopupMenu.PopupSubMenu.prototype.open === PopupMenu.PopupSubMenu.prototype._macGlideSubOpenWrapper)
                PopupMenu.PopupSubMenu.prototype.open = PopupMenu.PopupSubMenu.prototype._origMacGlideOpen;
            PopupMenu.PopupSubMenu.prototype._origMacGlideOpen = null;
            PopupMenu.PopupSubMenu.prototype._macGlideSubOpenWrapper = null;
        }
        if (PopupMenu.PopupSwitchMenuItem?.prototype?._origMacActivate) {
            PopupMenu.PopupSwitchMenuItem.prototype.activate = PopupMenu.PopupSwitchMenuItem.prototype._origMacActivate;
            PopupMenu.PopupSwitchMenuItem.prototype._origMacActivate = null;
        }
        if (Main.panel.menuManager?._origMacGlideAddMenu) {
            if (Main.panel.menuManager.addMenu === Main.panel.menuManager._macGlideAddWrapper)
                Main.panel.menuManager.addMenu = Main.panel.menuManager._origMacGlideAddMenu;
            Main.panel.menuManager._origMacGlideAddMenu = null;
            Main.panel.menuManager._macGlideAddWrapper = null;
        }

        if (this._wineWindowCreatedId) {
            try { global.display.disconnect(this._wineWindowCreatedId); } catch (_) {}
            this._wineWindowCreatedId = 0;
        }
        if (this._wineFocusWindowId) {
            try { global.display.disconnect(this._wineFocusWindowId); } catch (_) {}
            this._wineFocusWindowId = 0;
        }

        try {
            MacAnimationCache.destroy();
        } catch (_) {}
    }

    _setupWineWindowStacking() {
        const isWineWindow = (w) => {
            if (!w) return false;
            try {
                const cls = (w.get_wm_class() || '').toLowerCase();
                const instance = (w.get_wm_class_instance() || '').toLowerCase();
                return cls.includes('.exe') || cls.includes('wine') || instance.includes('.exe') || instance.includes('wine');
            } catch (_) {
                return false;
            }
        };

        const sanitizeWineWindow = (w) => {
            if (!isWineWindow(w)) return;
            try {
                if (w.is_above()) {
                    w.unmake_above();
                }
            } catch (_) {}

            if (!w._macWineAboveSignalId) {
                try {
                    w._macWineAboveSignalId = w.connect('notify::above', () => {
                        if (w.is_above()) {
                            w.unmake_above();
                        }
                    });
                } catch (_) {}
            }

            const focused = global.display.focus_window;
            if (focused && !isWineWindow(focused)) {
                try {
                    w.lower_with_transients();
                } catch (_) {
                    try { w.lower(); } catch (_) {}
                }
            }
        };

        for (const actor of global.get_window_actors()) {
            const w = actor.meta_window;
            if (w) sanitizeWineWindow(w);
        }

        try {
            this._wineWindowCreatedId = global.display.connect('window-created', (_display, window) => {
                if (window) sanitizeWineWindow(window);
            });
        } catch (e) {
            console.error(`[EvalHelper] wine window-created connect error: ${e}`);
        }

        try {
            this._wineFocusWindowId = global.display.connect('notify::focus-window', () => {
                const focused = global.display.focus_window;
                if (!focused) return;
                const wineFocused = isWineWindow(focused);
                if (!wineFocused) {
                    for (const actor of global.get_window_actors()) {
                        const w = actor.meta_window;
                        if (!w || w === focused) continue;
                        if (isWineWindow(w)) {
                            try {
                                if (w.is_above()) w.unmake_above();
                                w.lower_with_transients();
                            } catch (_) {
                                try { w.lower(); } catch (_) {}
                            }
                        }
                    }
                    try {
                        focused.raise_and_make_recent_on_workspace();
                    } catch (_) {
                        try { focused.raise(); } catch (_) {}
                    }
                }
            });
        } catch (e) {
            console.error(`[EvalHelper] wine focus-window connect error: ${e}`);
        }
    }

    _setupMinimizedWindowSnapshotManager() {
        const SNAPSHOT_OVERLAY_NAME = 'mac-window-snapshot-overlay';
        const MAGIC_LAMP_EFFECT_NAMES = [
            'minimize-magic-lamp-effect',
            'unminimize-magic-lamp-effect',
        ];

        const hasMagicLampTransition = (actor) =>
            MAGIC_LAMP_EFFECT_NAMES.some(name => actor?.get_effect?.(name));

        const captureWindowSnapshot = (actor) => {
            if (!actor || !actor.mapped || !actor.meta_window) return null;
            try {
                const snap = actor.paint_to_content(null);
                if (snap) {
                    actor.meta_window._macCachedSnapshot = snap;
                    return snap;
                }
            } catch (_) {}
            return actor.meta_window._macCachedSnapshot || null;
        };

        const applySnapshotOverlay = (actor) => {
            if (!actor || !actor.meta_window) return;
            if (globalThis._stageManagerEnabled || actor.meta_window._stageSwitching) return;


            if (hasMagicLampTransition(actor)) return;
            const snap = actor.meta_window._macCachedSnapshot;
            if (!snap) return;

            try {
                let overlay = actor.get_children().find(c => c.name === SNAPSHOT_OVERLAY_NAME);
                if (!overlay) {
                    overlay = new Clutter.Actor({
                        name: SNAPSHOT_OVERLAY_NAME,
                        width: actor.width,
                        height: actor.height,
                        content: snap,
                    });
                    actor.add_child(overlay);
                } else {
                    overlay.width = actor.width;
                    overlay.height = actor.height;
                    overlay.content = snap;
                }
                overlay.show();
            } catch (_) {}
        };

        const removeSnapshotOverlay = (actor) => {
            if (!actor) return;
            try {
                let overlay = actor.get_children().find(c => c.name === SNAPSHOT_OVERLAY_NAME);
                if (overlay) {
                    overlay.destroy();
                }
            } catch (_) {}
            if (actor.meta_window && actor.meta_window._macCachedSnapshot) {
                delete actor.meta_window._macCachedSnapshot;
            }
        };

        this._snapshotCleanups = [];


        this._snapshotMinId = global.window_manager.connect('minimize', (e, actor) => {
            if (actor) {
                captureWindowSnapshot(actor);
                applySnapshotOverlay(actor);
            }
        });
        this._snapshotCleanups.push(() => {
            if (this._snapshotMinId) {
                global.window_manager.disconnect(this._snapshotMinId);
                this._snapshotMinId = null;
            }
        });


        this._snapshotUnminId = global.window_manager.connect('unminimize', (e, actor) => {
            if (actor) {
                applySnapshotOverlay(actor);
            }
        });
        this._snapshotCleanups.push(() => {
            if (this._snapshotUnminId) {
                global.window_manager.disconnect(this._snapshotUnminId);
                this._snapshotUnminId = null;
            }
        });


        const trackWindow = (win) => {
            if (!win || win._macSnapshotTracked) return;
            win._macSnapshotTracked = true;
            const id = win.connect('notify::minimized', () => {
                const actor = win.get_compositor_private?.();
                if (!win.minimized && actor) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        if (!win.minimized && actor) {
                            removeSnapshotOverlay(actor);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                } else if (win.minimized && actor && !hasMagicLampTransition(actor)) {
                    applySnapshotOverlay(actor);
                }
            });
            const unmanId = win.connect('unmanaged', () => {
                if (win._macCachedSnapshot) {
                    delete win._macCachedSnapshot;
                }
            });
            this._snapshotCleanups.push(() => {
                try { win.disconnect(id); } catch (_) {}
                try { win.disconnect(unmanId); } catch (_) {}
                delete win._macSnapshotTracked;
            });
        };

        this._snapshotWinCreatedId = global.display.connect('window-created', (d, win) => trackWindow(win));
        this._snapshotCleanups.push(() => {
            if (this._snapshotWinCreatedId) {
                global.display.disconnect(this._snapshotWinCreatedId);
                this._snapshotWinCreatedId = null;
            }
        });

        global.get_window_actors().forEach(a => {
            if (a.meta_window) {
                trackWindow(a.meta_window);
            }
        });
    }

    _setupMemoryOptimizer() {
        this._memOptimizerCleanups = [];

        let MacMemTrim = null;
        try {
            MacMemTrim = imports.gi.MacMemTrim;
        } catch (_) {}

        const runMemoryTrim = () => {
            try {
                imports.system.gc();
                if (MacMemTrim && MacMemTrim.mem_trim) {
                    MacMemTrim.mem_trim();
                }
            } catch (_) {}
        };


        const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 180, () => {
            runMemoryTrim();
            return GLib.SOURCE_CONTINUE;
        });
        this._memOptimizerCleanups.push(() => {
            GLib.source_remove(timerId);
        });


        let overviewHiddenTimer = 0;
        let lastTrimTime = 0;
        const overviewHiddenId = Main.overview.connect('hidden', () => {
            if (overviewHiddenTimer) {
                GLib.source_remove(overviewHiddenTimer);
                overviewHiddenTimer = 0;
            }
            overviewHiddenTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 15, () => {
                overviewHiddenTimer = 0;
                const now = GLib.get_monotonic_time();
                if ((now - lastTrimTime) > 60000000) {
                    lastTrimTime = now;
                    runMemoryTrim();
                }
                return GLib.SOURCE_REMOVE;
            });
        });
        const overviewShowingId = Main.overview.connect('showing', () => {
            if (overviewHiddenTimer) {
                GLib.source_remove(overviewHiddenTimer);
                overviewHiddenTimer = 0;
            }
        });
        this._memOptimizerCleanups.push(() => {
            if (overviewHiddenTimer) {
                try { GLib.source_remove(overviewHiddenTimer); } catch (_) {}
            }
            try { Main.overview.disconnect(overviewHiddenId); } catch (_) {}
            try { Main.overview.disconnect(overviewShowingId); } catch (_) {}
        });


        GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
            runMemoryTrim();
            return GLib.SOURCE_REMOVE;
        });
    }

    _setupForcedWindowCorners() {
        this._cornerCleanups = [];
        this._windowCornerEntries = new Map();

        const getApplicationCornerRadius = () => {
            try {
                const lgSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com' });
                if (lgSettings.settings_schema?.has_key?.('application-corner-radius')) {
                    const rad = lgSettings.get_double('application-corner-radius');
                    if (rad > 0) return rad;
                }
            } catch (_) {}
            try {
                const bmsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.blur-my-shell.applications' });
                if (bmsSettings.settings_schema?.has_key?.('corner-radius')) {
                    const rad = bmsSettings.get_int('corner-radius');
                    if (rad > 0) return rad;
                }
            } catch (_) {}
            return 24.0;
        };

        let currentRadius = getApplicationCornerRadius();


        try {
            const lgSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com' });
            const lgId = lgSettings.connect('changed::application-corner-radius', () => {
                currentRadius = getApplicationCornerRadius();
                syncAll();
            });
            this._cornerCleanups.push(() => {
                try { lgSettings.disconnect(lgId); } catch (_) {}
            });
        } catch (_) {}

        try {
            const bmsSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.blur-my-shell.applications' });
            const bmsId = bmsSettings.connect('changed::corner-radius', () => {
                currentRadius = getApplicationCornerRadius();
                syncAll();
            });
            this._cornerCleanups.push(() => {
                try { bmsSettings.disconnect(bmsId); } catch (_) {}
            });
        } catch (_) {}

        let CornerEffectClass = null;
        let cornerShaderSource = null;

        const getCornerShaderSource = () => {
            if (cornerShaderSource) return cornerShaderSource;
            try {
                const BMS = Main.extensionManager?.lookup?.('blur-my-shell@aunetx');
                if (BMS?.dir) {
                    const shaderFile = BMS.dir.get_child('effects').get_child('corner.glsl');
                    const [ok, bytes] = shaderFile.load_contents(null);
                    if (ok) cornerShaderSource = new TextDecoder().decode(bytes);
                }
            } catch (_) {}
            return cornerShaderSource;
        };

        const loadCornerEffect = async () => {
            if (CornerEffectClass) return CornerEffectClass;
            try {
                const BMS = Main.extensionManager?.lookup?.('blur-my-shell@aunetx');
                if (BMS?.dir) {
                    const mod = await import('file://' + BMS.dir.get_path() + '/effects/corner.js');
                    CornerEffectClass = mod?.CornerEffect;
                }
            } catch (e) {
                console.error('[EvalHelper] Failed to load BMS CornerEffect:', e);
            }
            return CornerEffectClass;
        };

        const shouldRoundWindow = (win) => {
            if (!win || win.is_override_redirect?.()) return false;
            const type = win.window_type;
            if (type === Meta.WindowType.DESKTOP) return false;
            const wmClass = win.get_wm_class?.();
            if (wmClass === 'com.desktop.ding' || win.title?.startsWith('Desktop Icons')) return false;
            return (
                type === Meta.WindowType.NORMAL ||
                type === Meta.WindowType.DIALOG ||
                type === Meta.WindowType.MODAL_DIALOG ||
                type === Meta.WindowType.UTILITY
            );
        };

        const syncWindow = (win, entry) => {
            if (!entry?.actor || !entry?.effect) return;
            try {
                if (win && typeof win.is_override_redirect === 'function' && win.is_override_redirect()) return;
                const isFullscreen = Boolean(win && (win.is_fullscreen?.() || win.fullscreen));
                if (isFullscreen) {
                    entry.effect.enabled = false;
                    entry.effect.straight_corners = true;
                    entry.effect.radius = 0;
                    const actW = Math.max(1, entry.actor.width || 0);
                    const actH = Math.max(1, entry.actor.height || 0);
                    entry.effect.width = actW;
                    entry.effect.height = actH;
                    entry.effect.clip = [0, 0, actW, actH];
                    return;
                }

                entry.effect.enabled = true;
                entry.effect.straight_corners = false;
                entry.effect.radius = currentRadius;

                if (typeof entry.effect.detach_actor_clip_sync === 'function') {
                    entry.effect.detach_actor_clip_sync(entry.actor);
                }

                let frame = null, buffer = null;
                try {
                    frame = win?.get_frame_rect?.();
                    buffer = win?.get_buffer_rect?.();
                } catch (_) {}

                if (frame && buffer && frame.width > 0 && frame.height > 0) {
                    const clipX = Math.max(0, frame.x - buffer.x);
                    const clipY = Math.max(0, frame.y - buffer.y);
                    const clipW = frame.width;
                    const clipH = frame.height;

                    const actW = Math.max(1, entry.actor.width || clipW);
                    const actH = Math.max(1, entry.actor.height || clipH);
                    entry.effect.width = actW;
                    entry.effect.height = actH;
                    entry.effect.clip = [clipX, clipY, clipW, clipH];
                } else {
                    const actW = Math.max(1, entry.actor.width || 0);
                    const actH = Math.max(1, entry.actor.height || 0);
                    entry.effect.width = actW;
                    entry.effect.height = actH;
                }
            } catch (_) {}
        };

        const syncAll = () => {
            for (const [win, entry] of this._windowCornerEntries.entries()) {
                syncWindow(win, entry);
            }
        };

        const untrackWindow = (win) => {
            const entry = this._windowCornerEntries.get(win);
            if (!entry) return;
            this._windowCornerEntries.delete(win);
            if (entry.signals) {
                entry.signals.forEach(id => {
                    try { win.disconnect(id); } catch (_) {}
                });
                entry.signals = [];
            }







        };

        const doAttach = (win, actor, Clazz) => {
            if (!win || !actor || this._windowCornerEntries.has(win)) return;

            try {
                let existing = actor.get_effect('mac-forced-corner-effect');
                if (existing && existing.get_actor?.() === actor) {
                    actor.remove_effect(existing);
                }

                const isFs = Boolean(win.is_fullscreen?.() || win.fullscreen);
                const effect = new Clazz({
                    radius: isFs ? 0 : currentRadius,
                    corners_top: true,
                    corners_bottom: true,
                    straight_corners: isFs,
                });
                const src = getCornerShaderSource();
                if (src && typeof effect.set_shader_source === 'function') {
                    effect.set_shader_source(src);
                }
                effect.enabled = !isFs;

                actor.add_effect_with_name('mac-forced-corner-effect', effect);
                if (typeof effect.detach_actor_clip_sync === 'function') {
                    effect.detach_actor_clip_sync(actor);
                }

                const entry = { actor, effect, signals: [], actorSignal: null, actorDestroyId: null };

                entry.signals.push(win.connect('size-changed', () => syncWindow(win, entry)));
                entry.signals.push(win.connect('position-changed', () => syncWindow(win, entry)));
                entry.signals.push(win.connect('notify::fullscreen', () => {
                    syncWindow(win, entry);
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        syncWindow(win, entry);
                        return GLib.SOURCE_REMOVE;
                    });
                }));
                entry.signals.push(win.connect('notify::maximized-horizontally', () => syncWindow(win, entry)));
                entry.signals.push(win.connect('notify::maximized-vertically', () => syncWindow(win, entry)));
                entry.signals.push(win.connect('unmanaged', () => untrackWindow(win)));

                entry.actorSignal = actor.connect('notify::size', () => syncWindow(win, entry));


                entry.actorDestroyId = actor.connect('destroy', () => {
                    if (entry.actorSignal) {
                        try { actor.disconnect(entry.actorSignal); } catch (_) {}
                        entry.actorSignal = null;
                    }
                    if (entry.effect) {
                        try { actor.remove_effect(entry.effect); } catch (_) {}
                        entry.effect = null;
                    }
                });

                this._windowCornerEntries.set(win, entry);

                syncWindow(win, entry);
            } catch (e) {
                console.error('[EvalHelper] Error applying forced corner effect:', e);
            }
        };

        const trackWindow = async (win, passedActor = null) => {
            if (!shouldRoundWindow(win) || this._windowCornerEntries.has(win)) return;

            const Clazz = await loadCornerEffect();
            if (!Clazz) return;

            let actor = passedActor || win.get_compositor_private?.();
            if (!actor) {
                let attempts = 0;
                const checkSourceId = GLib.idle_add(GLib.PRIORITY_HIGH, () => {
                    if (!this._windowCornerEntries || this._windowCornerEntries.has(win)) return GLib.SOURCE_REMOVE;
                    actor = win.get_compositor_private?.();
                    if (actor) {
                        doAttach(win, actor, Clazz);
                        return GLib.SOURCE_REMOVE;
                    }
                    attempts++;
                    if (attempts > 30) return GLib.SOURCE_REMOVE;
                    return GLib.SOURCE_CONTINUE;
                });
                this._cornerCleanups.push(() => {
                    try { GLib.source_remove(checkSourceId); } catch (_) {}
                });
                return;
            }

            doAttach(win, actor, Clazz);
        };


        loadCornerEffect();


        const mapId = global.window_manager.connect('map', (wm, actor) => {
            if (actor?.meta_window) {
                trackWindow(actor.meta_window, actor);
            }
        });
        this._cornerCleanups.push(() => {
            try { global.window_manager.disconnect(mapId); } catch (_) {}
        });

        const winCreatedId = global.display.connect('window-created', (d, win) => trackWindow(win));
        this._cornerCleanups.push(() => {
            try { global.display.disconnect(winCreatedId); } catch (_) {}
        });


        global.get_window_actors().forEach(a => {
            if (a.meta_window) {
                trackWindow(a.meta_window, a);
            }
        });
    }
}
