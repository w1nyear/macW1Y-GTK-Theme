import Cairo from 'cairo';
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
        this._batteryDrawingArea = null;
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

        try {
            this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            const id = this._interfaceSettings.connect('changed::show-battery-percentage', () => {
                this._updateBattery();
            });
            this._signals.push({ obj: this._interfaceSettings, id });
        } catch (_) {}

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
            right: ['keyboard', 'quickSettings', 'dateMenu']
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
            } else {
                this._restoreDesktopPanel();
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

    _onRepaintBattery() {
        if (!this._batteryDrawingArea)
            return;
        const cr = this._batteryDrawingArea.get_context();
        const [sw, sh] = this._batteryDrawingArea.get_surface_size();
        const aw = this._batteryDrawingArea.width || 27;
        const ah = this._batteryDrawingArea.height || 16;

        cr.save();
        cr.scale(sw / aw, sh / ah);
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        let percentage = 100;
        let state = 0;
        if (this._batteryProxy) {
            try {
                const pctProp = this._batteryProxy.get_cached_property('Percentage');
                const stateProp = this._batteryProxy.get_cached_property('State');
                if (pctProp) percentage = pctProp.unpack();
                if (stateProp) state = stateProp.unpack();
            } catch (_) {}
        }


        const charging = (state === 1 || state === 5);
        const pct = Math.max(0, Math.min(1.0, percentage / 100.0));

        const bw = 22.0;
        const bh = 11.5;
        const br = 3.6;
        const bx = 1.0;
        const by = (ah - bh) / 2.0;

        const gap = 1.2;
        const nw = 1.6;
        const nh = 4.8;
        const nr = 0.8;
        const nx = bx + bw + gap;
        const ny = by + (bh - nh) / 2.0;

        function roundedRect(x, y, w, h, r) {
            cr.newSubPath();
            cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
            cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
            cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
            cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
            cr.closePath();
        }


        roundedRect(bx, by, bw, bh, br);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.40);
        cr.fill();


        cr.newSubPath();
        cr.arc(nx + nw - nr, ny + nr, nr, -Math.PI / 2, 0);
        cr.arc(nx + nw - nr, ny + nh - nr, nr, 0, Math.PI / 2);
        cr.lineTo(nx, ny + nh);
        cr.lineTo(nx, ny);
        cr.closePath();
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.40);
        cr.fill();


        if (pct > 0.005) {
            cr.save();
            roundedRect(bx, by, bw, bh, br);
            cr.clip();

            const fillW = bw * pct;
            cr.rectangle(bx, by, fillW, bh);

            if (charging) {

                cr.setSourceRGBA(40 / 255, 205 / 255, 65 / 255, 1.0);
            } else if (pct <= 0.10) {
                cr.setSourceRGBA(255 / 255, 59 / 255, 48 / 255, 1.0);
            } else if (pct <= 0.20) {
                cr.setSourceRGBA(255 / 255, 204 / 255, 0 / 255, 1.0);
            } else {
                cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
            }
            cr.fill();
            cr.restore();
        }


        if (charging) {
            cr.save();
            const cx = bx + bw / 2.0;
            const cy = by + bh / 2.0;

            const boltPath = () => {
                cr.newPath();
                cr.moveTo(cx + 0.2, cy - 4.6);
                cr.lineTo(cx - 2.5, cy - 0.5);
                cr.lineTo(cx + 0.1, cy + 0.7);
                cr.lineTo(cx - 0.2, cy + 4.6);
                cr.lineTo(cx + 2.5, cy + 0.5);
                cr.lineTo(cx - 0.1, cy - 0.7);
                cr.closePath();
            };


            boltPath();
            cr.setLineWidth(1.2);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setSourceRGBA(0.0, 0.0, 0.0, 0.75);
            cr.stroke();


            boltPath();
            cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
            cr.fill();
            cr.restore();
        }

        cr.restore();
        cr.$dispose();
    }

    _updateBattery() {
        if (!this._batteryProxy || !this._batteryLabel || !this._batteryDrawingArea)
            return;
        try {
            const pctProp = this._batteryProxy.get_cached_property('Percentage');
            if (!pctProp) return;
            const percentage = pctProp.unpack();

            let showPercentage = false;
            try {
                if (!this._interfaceSettings)
                    this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                showPercentage = this._interfaceSettings.get_boolean('show-battery-percentage');
            } catch (_) {
                showPercentage = false;
            }

            if (showPercentage) {
                this._batteryLabel.text = `${Math.round(percentage)}%`;
                this._batteryLabel.visible = true;
                this._batteryLabel.opacity = 255;
                this._batteryLabel.width = -1;
                this._batteryLabel.margin_right = 6;
            } else {
                this._batteryLabel.text = '';
                this._batteryLabel.visible = false;
                this._batteryLabel.opacity = 0;
                this._batteryLabel.width = 0;
                this._batteryLabel.margin_right = 0;
            }

            this._batteryDrawingArea.queue_repaint();
            if (this._batteryWidget) {
                this._batteryWidget.visible = true;
                this._batteryWidget.show();
            }
        } catch (_) {}
    }

    _ensureBatteryWidget() {
        if (this._batteryWidget) return this._batteryWidget;

        this._batteryWidget = new St.Bin({
            name: 'wack-lockscreen-battery',
            style_class: 'panel-button wack-lockscreen-battery',
            reactive: false,
            can_focus: false,
            track_hover: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin: 0 !important; padding: 0 6px !important; height: 34px !important; min-height: 34px !important;',
        });

        const box = new St.BoxLayout({
            style_class: 'wack-battery-box kiwi-battery-box',
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 6px;',
        });

        let showPctInitial = false;
        try {
            if (!this._interfaceSettings)
                this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            showPctInitial = this._interfaceSettings.get_boolean('show-battery-percentage');
        } catch (_) {}

        this._batteryLabel = new St.Label({
            style_class: 'wack-battery-label kiwi-battery-label',
            text: '',
            visible: showPctInitial,
            opacity: showPctInitial ? 255 : 0,
            width: showPctInitial ? -1 : 0,
            margin_right: showPctInitial ? 6 : 0,
            y_align: Clutter.ActorAlign.CENTER,
            style: "font-family: 'Default', default, system-ui, sans-serif, sans-serif !important; font-size: 14px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.95) !important; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45) !important;",
        });

        this._batteryDrawingArea = new St.DrawingArea({
            width: 27,
            height: 16,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-icon wack-battery-icon kiwi-battery-icon',
        });
        this._batteryDrawingArea.connect('repaint', () => this._onRepaintBattery());

        box.add_child(this._batteryLabel);
        box.add_child(this._batteryDrawingArea);
        this._batteryWidget.set_child(box);

        return this._batteryWidget;
    }

    _setupQuickSettings(qs) {
        if (!qs) return;


        if (qs._indicators) {
            qs._indicators.visible = false;
            qs._indicators.opacity = 0;
            qs._indicators.style = 'margin: 0 !important; padding: 0 !important; width: 0px !important; min-width: 0px !important; height: 0px !important; min-height: 0px !important;';
        }


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
                '/usr/share/themes/macW1Y-Dark/icons/control-center.png',
                GLib.get_home_dir() + '/.themes/macW1Y-Dark/icons/control-center.png',
                GLib.get_home_dir() + '/.local/share/macW1Y/icons/controlcenter.png',
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

    _setupKeyboard(kb) {
        if (!kb) return;
        kb.visible = true;
        kb.show();
        kb.opacity = 255;
        kb.reactive = true;
        kb.can_focus = true;
        kb.track_hover = true;
        kb.y_align = Clutter.ActorAlign.CENTER;
        kb.style = 'margin: 0 !important; padding: 0 4px !important; height: 34px !important; min-height: 34px !important;';
        if (kb.container) {
            kb.container.visible = true;
            kb.container.show();
            kb.container.opacity = 255;
            kb.container.y_align = Clutter.ActorAlign.CENTER;
            kb.container.style = 'margin: 0 !important; padding: 0 4px !important; height: 34px !important; min-height: 34px !important;';
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
            dm._clockDisplay.style = "font-family: 'Default', default, system-ui, sans-serif, sans-serif !important; font-size: 14px !important; font-weight: 500 !important; color: rgba(255, 255, 255, 0.95) !important; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45) !important;";
        }

        if (!this._dateMenuClickId) {
            this._dateMenuClickId = dm.connect('button-press-event', () => {
                const currentMode = Main.sessionMode?.currentMode;
                const isLockscreen = currentMode === 'unlock-dialog' || currentMode === 'gdm' || (Main.screenShield && Main.screenShield.active);
                if (isLockscreen) {
                    try {
                        this._extension?.triggerToggleNotifications?.();
                    } catch (_) {}
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }
    }

    _restoreDesktopPanel() {
        if (this._panelIdleId) {
            GLib.source_remove(this._panelIdleId);
            this._panelIdleId = 0;
        }

        if (this._batteryWidget) {
            try {
                const p = this._batteryWidget.get_parent();
                if (p) p.remove_child(this._batteryWidget);
            } catch (_) {}
        }

        if (this._ccIcon) {
            try {
                const p = this._ccIcon.get_parent();
                if (p) p.remove_child(this._ccIcon);
            } catch (_) {}
        }

        if (this._origSessionModePanel && Main.sessionMode) {
            Main.sessionMode.panel = this._origSessionModePanel;
        }

        const boxes = [Main.panel?._leftBox, Main.panel?._centerBox, Main.panel?._rightBox].filter(Boolean);
        for (const box of boxes) {
            for (const child of box.get_children()) {
                if (child === this._batteryWidget) continue;
                const role = Object.entries(Main.panel.statusArea || {}).find(([_, v]) => {
                    try { return v?.container === child || v === child; } catch (_) { return false; }
                })?.[0] || '';

                if (['macBattery', 'macWifi', 'macBluetooth', 'macVolume', 'macScreenCast'].includes(role)) {
                    continue;
                }
                child.visible = true;
                child.show();
                child.opacity = 255;
            }
        }
    }

    _applyMenuBar() {
        if (!this._isActive || this._isApplying) return;
        const currentMode = Main.sessionMode?.currentMode;
        const isLockscreen = currentMode === 'unlock-dialog' || currentMode === 'gdm' || (Main.screenShield && Main.screenShield.active);
        if (!isLockscreen) return;

        this._isApplying = true;

        try {

            if (Main.panel?._leftBox) {
                for (const child of Main.panel._leftBox.get_children()) {
                    child.visible = false;
                    child.hide();
                }
            }


            if (Main.panel?._centerBox) {
                for (const child of Main.panel._centerBox.get_children()) {
                    child.visible = false;
                    child.hide();
                }
            }


            const rightBox = Main.panel?._rightBox;
            if (!rightBox) return;

            let kb = Main.panel.statusArea?.keyboard;
            let kbActor = kb?.container || kb;
            if (!kbActor && Main.panel?._rightBox) {
                kbActor = Main.panel._rightBox.get_children().find(c => {
                    const cls = c.get_style_class_name ? (c.get_style_class_name() || '') : '';
                    return cls.includes('input') || cls.includes('keyboard') || c.constructor?.name?.includes('InputSource');
                });
            }

            const qs = Main.panel.statusArea?.quickSettings;
            const dm = Main.panel.statusArea?.dateMenu;

            this._setupKeyboard(kb);
            const battery = this._ensureBatteryWidget();
            this._setupQuickSettings(qs);
            this._setupDateMenu(dm);

            const qsActor = qs?.container || qs;
            const dmActor = dm?.container || dm;


            if (kbActor && kbActor.get_parent() !== rightBox) {
                if (kbActor.get_parent()) kbActor.get_parent().remove_child(kbActor);
                rightBox.add_child(kbActor);
            }
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

            const allowed = [kbActor, battery, qsActor, dmActor].filter(Boolean);


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

        this._restoreDesktopPanel();

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
            this._batteryDrawingArea = null;
            this._batteryLabel = null;
        }

        if (this._ccIcon) {
            try {
                const p = this._ccIcon.get_parent();
                if (p) p.remove_child(this._ccIcon);
                this._ccIcon.destroy();
            } catch (_) {}
            this._ccIcon = null;
        }

        const dm = Main.panel?.statusArea?.dateMenu;
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
    }
}
