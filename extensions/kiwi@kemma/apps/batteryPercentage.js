// SPDX-License-Identifier: GPL-3.0-or-later


import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BATTERY_TRIGGER_PERCENTAGE = 20;

class BatteryPercentage {
    constructor() {

        this._batteryLabel = new St.Label({
            style_class: 'battery-percentage-label',
            text: '',
            opacity: 0,
            y_align: Clutter.ActorAlign.CENTER
        });

        Main.panel.statusArea.quickSettings._indicators.add_child(this._batteryLabel);
        this._batteryLabel.visible = false;


    this._propertiesChangedId = null;
    this._initBatteryProxy();

        this._lastPercentage = null;
        this._lastState = null;
    }

    _initBatteryProxy() {


        const upowerProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.system,
            g_interface_name: 'org.freedesktop.UPower',
            g_object_path: '/org/freedesktop/UPower',
            g_name: 'org.freedesktop.UPower',
            g_flags: Gio.DBusProxyFlags.NONE,
        });

        upowerProxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
            try {
                proxy.init_finish(res);


                let variant = null;
                try {
                    variant = proxy.call_sync('EnumerateDevices', null, Gio.DBusCallFlags.NONE, -1, null);
                } catch (e) {
                    variant = null;
                }

                let devices = [];
                if (variant) {
                    try {
                        devices = variant.deep_unpack ? variant.deep_unpack() : variant.unpack();
                    } catch (e) {
                        devices = [];
                    }
                }


                let batteryPath = null;
                if (Array.isArray(devices)) {
                    batteryPath = devices.find(p => /battery_BAT\d+/i.test(p) || /battery/i.test(p));
                }


                if (!batteryPath) {

                    const fallback0 = '/org/freedesktop/UPower/devices/battery_BAT0';
                    const fallback1 = '/org/freedesktop/UPower/devices/battery_BAT1';
                    batteryPath = devices && devices.indexOf(fallback0) !== -1 ? fallback0 : (devices && devices.indexOf(fallback1) !== -1 ? fallback1 : fallback0);
                }


                this._batteryProxy = new Gio.DBusProxy({
                    g_connection: Gio.DBus.system,
                    g_interface_name: 'org.freedesktop.UPower.Device',
                    g_object_path: batteryPath,
                    g_name: 'org.freedesktop.UPower',
                    g_flags: Gio.DBusProxyFlags.NONE,
                });

                this._batteryProxy.init_async(GLib.PRIORITY_DEFAULT, null, (deviceProxy, deviceRes) => {
                    try {
                        deviceProxy.init_finish(deviceRes);

                        this._updateBatteryPercentage();

                        this._propertiesChangedId = this._batteryProxy.connect('g-properties-changed', () => {
                            this._updateBatteryPercentage();
                        });
                    } catch (e) {

                    }
                });
            } catch (e) {

                const fallbackPath = '/org/freedesktop/UPower/devices/battery_BAT0';
                this._batteryProxy = new Gio.DBusProxy({
                    g_connection: Gio.DBus.system,
                    g_interface_name: 'org.freedesktop.UPower.Device',
                    g_object_path: fallbackPath,
                    g_name: 'org.freedesktop.UPower',
                    g_flags: Gio.DBusProxyFlags.NONE,
                });

                this._batteryProxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy2, result2) => {
                    try {
                        proxy2.init_finish(result2);
                        this._updateBatteryPercentage();
                        this._propertiesChangedId = this._batteryProxy.connect('g-properties-changed', () => {
                            this._updateBatteryPercentage();
                        });
                    } catch (e2) {

                    }
                });
            }
        });
    }

    _updateBatteryPercentage() {

        const percentageProperty = this._batteryProxy.get_cached_property('Percentage');
        const stateProperty = this._batteryProxy.get_cached_property('State');


        if (!percentageProperty || !stateProperty) {
            return;
        }

        const percentage = percentageProperty.unpack();
        const state = stateProperty.unpack();


        this._batteryLabel.text = `${percentage}%`;


        if (percentage === BATTERY_TRIGGER_PERCENTAGE && state === 2 && percentage !== this._lastPercentage) {
            this._animateIn();
        }


        if (percentage <= BATTERY_TRIGGER_PERCENTAGE && state !== this._lastState) {
            if (state === 1 || state === 2) {
                if (state === 1) {
                    this._animateOut();
                } else if (state === 2) {
                    this._animateIn();
                }
            }
        }


        this._lastPercentage = percentage;
        this._lastState = state;
    }

    _animateIn() {

        this._batteryLabel.visible = true;
        this._batteryLabel.translation_x = this._batteryLabel.width;
        this._batteryLabel.ease({
            translation_x: 0,
            opacity: 255,
            duration: 250,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                this._batteryLabel.translation_x = 0;
            }
        });
    }

    destroy() {
        if (this._propertiesChangedId && this._batteryProxy) {
            this._batteryProxy.disconnect(this._propertiesChangedId);
            this._propertiesChangedId = null;
        }
        if (this._batteryProxy) {
            this._batteryProxy = null;
        }
        if (this._batteryLabel) {
            this._batteryLabel.destroy();
            this._batteryLabel = null;
        }
    }

    _animateOut() {

        this._batteryLabel.ease({
            translation_x: this._batteryLabel.width,
            opacity: 0,
            duration: 250,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                this._batteryLabel.translation_x = this._batteryLabel.width;
                this._batteryLabel.visible = false;
            }
        });
    }
}

let batteryPercentageInstance = null;

export const enable = () => {

    if (!batteryPercentageInstance) {
        batteryPercentageInstance = new BatteryPercentage();
    }
};

export const disable = () => {

    if (batteryPercentageInstance) {
        if (batteryPercentageInstance._batteryLabel && batteryPercentageInstance._batteryLabel.get_parent()) {
            Main.panel.statusArea.quickSettings._indicators.remove_child(batteryPercentageInstance._batteryLabel);
        }

        batteryPercentageInstance.destroy();
        batteryPercentageInstance = null;
    }
};
