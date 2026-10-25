import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class LockscreenMenuBarManager {
    constructor(extension) {
        this._extension = extension;
        this._isActive = false;
        this._batteryProxy = null;
        this._batteryChangedId = 0;
        this._batteryWidget = null;
        this._batteryLabel = null;
        this._batteryIcon = null;
        this._ccIcon = null;
        this._signals = [];
        this._origSessionModePanel = null;
        this._dateMenuClickId = 0;
        this._isApplying = false;
        this._panelIdleId = 0;
    }

    setup() {
        if (this._isActive) return;
        this._isActive = true;

        this._overrideSessionMode();
        this._initBattery();
        this._applyMenuBar();
        this._watchPanelBoxes();
    }

    _overrideSessionMode() {
        if (!Main.sessionMode) return;
        if (!this._origSessionModePanel) {
            this._origSessionModePanel = Main.sessionMode.panel;
        }

        const desiredPanel = {
            left: [],
            center: [],
            right: ['quickSettings', 'dateMenu']
        };

        const mode = Main.sessionMode.currentMode;
        if (mode === 'unlock-dialog' || mode === 'gdm' || Main.sessionMode.isLocked || Main.sessionMode.isGreeter) {
            Main.sessionMode.panel = desiredPanel;
        }

        const id = Main.sessionMode.connectObject('updated', () => {
            if (!this._isActive) return;
            const currentMode = Main.sessionMode.currentMode;
            if (currentMode === 'unlock-dialog' || currentMode === 'gdm' || Main.sessionMode.isLocked || Main.sessionMode.isGreeter) {
                Main.sessionMode.panel = desiredPanel;
                this._applyMenuBar();
            }
        }, this);
        this._signals.push({ obj: Main.sessionMode, id });
    }

    _watchPanelBoxes() {
        const boxes = [Main.panel?._leftBox, Main.panel?._centerBox, Main.panel?._rightBox].filter(Boolean);
        for (const box of boxes) {
            try {
                const id = box.connect('child-added', () => {
                    if (!this._isActive || this._isApplying) return;
                    if (this._panelIdleId) return;
                    this._panelIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._panelIdleId = 0;
                        if (this._isActive) this._applyMenuBar();
                        return GLib.SOURCE_REMOVE;
                    });
                });
                this._signals.push({ obj: box, id });
            } catch (e) {
                console.error(`[WACK] Error connecting child-added on panel box: ${e}`);
            }
        }
    }

    _initBattery() {
        try {
            const upower = new Gio.DBusProxy({
                g_connection: Gio.DBus.system,
                g_interface_name: 'org.freedesktop.UPower',
                g_object_path: '/org/freedesktop/UPower',
                g_name: 'org.freedesktop.UPower',
                g_flags: Gio.DBusProxyFlags.NONE,
            });
            upower.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
                try {
                    proxy.init_finish(res);
                    const variant = proxy.call_sync('EnumerateDevices', null, Gio.DBusCallFlags.NONE, -1, null);
                    const devices = variant ? (variant.deep_unpack ? variant.deep_unpack()[0] : []) : [];
                    let batPath = devices.find(p => /battery_BAT\d+/i.test(p) || /battery/i.test(p)) || null;
                    if (!batPath && devices.some(p => p.includes('BAT1')))
                        batPath = '/org/freedesktop/UPower/devices/battery_BAT1';
                    if (!batPath)
                        batPath = '/org/freedesktop/UPower/devices/battery_BAT0';

                    this._initDevice(batPath);
                } catch (_) {}
            });
        } catch (_) {}
    }

    _initDevice(batPath) {
        if (!batPath) return;
        try {
            const dev = new Gio.DBusProxy({
                g_connection: Gio.DBus.system,
                g_interface_name: 'org.freedesktop.UPower.Device',
                g_object_path: batPath,
                g_name: 'org.freedesktop.UPower',
                g_flags: Gio.DBusProxyFlags.NONE,
            });
            dev.init_async(GLib.PRIORITY_DEFAULT, null, (dp, dr) => {
                try {
                    dp.init_finish(dr);
                    this._batteryProxy = dp;
                    this._updateBattery();
                    if (this._batteryChangedId && this._batteryProxy) {
                        try { this._batteryProxy.disconnect(this._batteryChangedId); } catch (_) {}
                    }
                    this._batteryChangedId = this._batteryProxy.connect('g-properties-changed', () => this._updateBattery());
                } catch (_) {
                    if (batPath.endsWith('BAT0')) {
                        this._initDevice('/org/freedesktop/UPower/devices/battery_BAT1');
                    }
                }
            });
        } catch (_) {}
    }

    _iconForLevel(percentage, state) {
        const charging = state === 1 || state === 5;
        const full = state === 4 || percentage >= 99.5;
        if (full)
            return 'battery-level-100-charged-symbolic';
        let level = Math.round(percentage / 10) * 10;
        level = Math.max(0, Math.min(90, level));
        if (charging)
            return `battery-level-${level}-charging-symbolic`;
        return `battery-level-${level}-symbolic`;
    }

    _updateBattery() {
        if (!this._batteryProxy || !this._batteryLabel || !this._batteryIcon)
            return;
        try {
            const pctProp = this._batteryProxy.get_cached_property('Percentage');
            const stateProp = this._batteryProxy.get_cached_property('State');
            if (!pctProp) return;
            const percentage = pctProp.unpack();
            const state = stateProp ? stateProp.unpack() : 0;
            this._batteryLabel.text = `${Math.round(percentage)}%`;
            this._batteryIcon.icon_name = this._iconForLevel(percentage, state);
            if (this._batteryWidget) {
                this._batteryWidget.visible = true;
                this._batteryWidget.show();
            }
        } catch (_) {}
    }

    _ensureBatteryWidget() {
        if (this._batteryWidget) return this._batteryWidget;

        this._batteryWidget = new St.Widget({
            name: 'wack-lockscreen-battery',
            style_class: 'panel-button wack-lockscreen-battery',
            reactive: false,
            can_focus: false,
            track_hover: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin: 0 !important; padding: 0 6px !important; height: 34px !important;',
        });

        const box = new St.BoxLayout({
            style_class: 'wack-battery-box kiwi-battery-box',
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 6px;',
        });

        this._batteryLabel = new St.Label({
            style_class: 'wack-battery-label kiwi-battery-label',
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
            style: "font-family: 'SF Pro Text', -apple-system, sans-serif !important; font-size: 14px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.95) !important; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45) !important;",
        });

        this._batteryIcon = new St.Icon({
            icon_name: 'battery-level-100-charged-symbolic',
            style_class: 'system-status-icon wack-battery-icon kiwi-battery-icon',
            icon_size: 20,
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(this._batteryLabel);
        box.add_child(this._batteryIcon);
        this._batteryWidget.add_child(box);

        return this._batteryWidget;
    }

    _setupQuickSettings(qs) {
        if (!qs) return;

        // Hide multi-indicator clutter inside quickSettings button
        if (qs._indicators) {
            qs._indicators.visible = false;
            qs._indicators.opacity = 0;
            qs._indicators.style = 'margin: 0 !important; padding: 0 !important; width: 0px !important; min-width: 0px !important; height: 0px !important; min-height: 0px !important;';
        }

        // Attach or update CC icon if needed
        if (!this._ccIcon || this._ccIcon.get_parent() !== qs) {
            if (this._ccIcon) {
                try {
                    if (this._ccIcon.get_parent())
                        this._ccIcon.get_parent().remove_child(this._ccIcon);
                    this._ccIcon.destroy();
                } catch (_) {}
                this._ccIcon = null;
            }

            const CC_PATHS = [
                '/usr/share/mactheme/icons/controlcenter.png',
                '/home/vitaliy/.themes/macW1Y-Dark/icons/control-center.png',
                '/home/vitaliy/.themes/MacTahoe-Dark/icons/control-center.png',
                GLib.get_home_dir() + '/.themes/macW1Y-Dark/icons/control-center.png',
            ];
            let ccFile = null;
            for (const p of CC_PATHS) {
                if (GLib.file_test(p, GLib.FileTest.EXISTS)) {
                    ccFile = p;
                    break;
                }
            }

            if (ccFile) {
                const f = Gio.File.new_for_path(ccFile);
                this._ccIcon = new St.Icon({
                    gicon: new Gio.FileIcon({ file: f }),
                    style_class: 'system-status-icon mac-control-center-icon wack-cc-icon',
                    icon_size: 18,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
            } else {
                this._ccIcon = new St.Icon({
                    icon_name: 'preferences-system-symbolic',
                    style_class: 'system-status-icon mac-control-center-icon wack-cc-icon',
                    icon_size: 18,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                });
            }

            this._ccIcon.visible = true;
            this._ccIcon.show();
            qs.insert_child_at_index(this._ccIcon, 0);
        }

        qs.visible = true;
        qs.show();
        qs.reactive = true;
        qs.can_focus = true;
        qs.track_hover = true;
        qs.style = 'margin: 0 !important; padding: 0 4px !important; height: 34px !important; min-height: 34px !important;';
        if (qs.container) {
            qs.container.visible = true;
            qs.container.show();
            qs.container.style = 'margin: 0 !important; padding: 0 4px !important; height: 34px !important; min-height: 34px !important;';
        }
    }

    _setupDateMenu(dm) {
        if (!dm) return;
        dm.visible = true;
        dm.show();
        dm.reactive = true;
        dm.can_focus = true;
        dm.track_hover = true;
        dm.style = 'margin: 0 !important; padding: 0 6px !important; height: 34px !important; min-height: 34px !important;';
        if (dm.container) {
            dm.container.visible = true;
            dm.container.show();
            dm.container.style = 'margin: 0 !important; padding: 0 6px !important; height: 34px !important; min-height: 34px !important;';
        }
        if (dm._clockDisplay) {
            dm._clockDisplay.style = "font-family: 'SF Pro Text', -apple-system, sans-serif !important; font-size: 14px !important; font-weight: 500 !important; color: rgba(255, 255, 255, 0.95) !important; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45) !important;";
        }

        if (!this._dateMenuClickId) {
            this._dateMenuClickId = dm.connect('button-press-event', () => {
                try {
                    this._extension?.triggerToggleNotifications?.();
                } catch (_) {}
                return Clutter.EVENT_STOP;
            });
        }
    }

    _applyMenuBar() {
        if (!this._isActive || this._isApplying) return;
        this._isApplying = true;

        try {
            // 1. Hide everything in leftBox
            if (Main.panel?._leftBox) {
                for (const child of Main.panel._leftBox.get_children()) {
                    child.visible = false;
                    child.hide();
                }
            }

            // 2. Hide everything in centerBox (including misplaced dateMenu)
            if (Main.panel?._centerBox) {
                for (const child of Main.panel._centerBox.get_children()) {
                    child.visible = false;
                    child.hide();
                }
            }

            // 3. RightBox management
            const rightBox = Main.panel?._rightBox;
            if (!rightBox) return;

            const qs = Main.panel.statusArea?.quickSettings;
            const dm = Main.panel.statusArea?.dateMenu;

            const battery = this._ensureBatteryWidget();
            this._setupQuickSettings(qs);
            this._setupDateMenu(dm);

            const qsActor = qs?.container || qs;
            const dmActor = dm?.container || dm;

            // Ensure our 3 items are inside rightBox
            if (battery && battery.get_parent() !== rightBox) {
                if (battery.get_parent()) battery.get_parent().remove_child(battery);
                rightBox.add_child(battery);
            }
            if (qsActor && qsActor.get_parent() !== rightBox) {
                if (qsActor.get_parent()) qsActor.get_parent().remove_child(qsActor);
                rightBox.add_child(qsActor);
            }
            if (dmActor && dmActor.get_parent() !== rightBox) {
                if (dmActor.get_parent()) dmActor.get_parent().remove_child(dmActor);
                rightBox.add_child(dmActor);
            }

            const allowed = [battery, qsActor, dmActor].filter(Boolean);

            // Hide any other child in rightBox (e.g. keyboard "uk", a11y, dwellClick, appindicators)
            for (const child of rightBox.get_children()) {
                if (!allowed.includes(child)) {
                    child.visible = false;
                    child.hide();
                    child.opacity = 0;
                } else {
                    child.visible = true;
                    child.show();
                    child.opacity = 255;
                }
            }

            // Strictly order the 3 allowed items:
            // 0: Battery
            // 1: Control Center (quickSettings)
            // 2: Date & Time (dateMenu)
            for (let i = 0; i < allowed.length; i++) {
                try {
                    rightBox.set_child_at_index(allowed[i], i);
                } catch (_) {}
            }

            this._updateBattery();
        } finally {
            this._isApplying = false;
        }
    }

    teardown() {
        if (!this._isActive) return;
        this._isActive = false;

        if (this._panelIdleId) {
            GLib.source_remove(this._panelIdleId);
            this._panelIdleId = 0;
        }

        if (this._batteryChangedId && this._batteryProxy) {
            try { this._batteryProxy.disconnect(this._batteryChangedId); } catch (_) {}
            this._batteryChangedId = 0;
        }
        this._batteryProxy = null;

        if (this._batteryWidget) {
            try {
                const p = this._batteryWidget.get_parent();
                if (p) p.remove_child(this._batteryWidget);
                this._batteryWidget.destroy();
            } catch (_) {}
            this._batteryWidget = null;
        }

        if (this._ccIcon) {
            try {
                const p = this._ccIcon.get_parent();
                if (p) p.remove_child(this._ccIcon);
                this._ccIcon.destroy();
            } catch (_) {}
            this._ccIcon = null;
        }

        const dm = Main.panel.statusArea?.dateMenu;
        if (dm && this._dateMenuClickId) {
            try { dm.disconnect(this._dateMenuClickId); } catch (_) {}
            this._dateMenuClickId = 0;
        }

        for (const sig of this._signals) {
            try {
                if (sig.obj?.disconnectObject) sig.obj.disconnectObject(this);
                else sig.obj?.disconnect?.(sig.id);
            } catch (_) {}
        }
        this._signals = [];

        if (this._origSessionModePanel && Main.sessionMode) {
            Main.sessionMode.panel = this._origSessionModePanel;
            this._origSessionModePanel = null;
        }

        const qs = Main.panel?.statusArea?.quickSettings;
        if (qs?._indicators) {
            qs._indicators.visible = true;
            qs._indicators.opacity = 255;
            qs._indicators.style = null;
        }
    }
}
