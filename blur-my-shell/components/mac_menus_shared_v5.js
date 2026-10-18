import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import NM from 'gi://NM';
import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { t, tf } from './mac_i18n.js';

const ACCENT_COLOR_MAP = {
    'blue': '#007aff',
    'teal': '#30b0c7',
    'green': '#34c759',
    'yellow': '#ffcc00',
    'orange': '#ff9500',
    'red': '#ff3b30',
    'pink': '#ff2d55',
    'purple': '#af52de',
    'slate': '#8e8e93',
    'brown': '#a27447',
};

export function getSystemAccentColor() {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#007aff';
    } catch (_e) {
        return '#007aff';
    }
}

export function getBluetoothDeviceIcon(icon, name) {
    icon = (icon || '').toLowerCase();
    name = (name || '').toLowerCase();
    if (icon.includes('headset') || name.includes('headset') || icon.includes('headphones') || name.includes('headphone') || name.includes('airpods') || name.includes('buds')) {
        return 'audio-headphones-symbolic';
    }
    if (icon.includes('audio') || icon.includes('sound') || name.includes('speaker') || name.includes('soundbar') || name.includes('audio')) {
        return 'audio-speakers-symbolic';
    }
    if (icon.includes('phone') || name.includes('iphone') || name.includes('phone') || name.includes('galaxy') || name.includes('pixel')) {
        return 'phone-symbolic';
    }
    if (icon.includes('mouse') || name.includes('mouse') || name.includes('trackpad')) {
        return 'input-mouse-symbolic';
    }
    if (icon.includes('keyboard') || name.includes('keyboard') || name.includes('keychron')) {
        return 'input-keyboard-symbolic';
    }
    if (icon.includes('gaming') || icon.includes('gamepad') || name.includes('playstation') || name.includes('dualshock') || name.includes('dualsense') || name.includes('xbox') || name.includes('controller')) {
        return 'input-gaming-symbolic';
    }
    return 'bluetooth-active-symbolic';
}

export function createCircleBadge(iconName, isActive = false, iconSize = 14) {
    const accent = getSystemAccentColor();
    const badge = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        style_class: isActive ? 'mac-menu-circle-badge-accent mac-cc-pill-icon-btn' : 'mac-menu-circle-badge mac-cc-pill-icon-btn',
        style: isActive ? `background-color: ${accent} !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 13px !important; margin-right: 10px !important;` : 'background-color: rgba(255, 255, 255, 0.15) !important; width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 13px !important; margin-right: 10px !important;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    if (isActive) {
        icon.style = 'color: #ffffff !important;';
    } else {
        icon.style = 'color: #ffffff !important;';
    }
    badge.add_child(icon);
    return badge;
}

export function setupMacMenuItem(item) {
    if (!item) return;
    item.can_focus = false;
    item.reactive = true;
    item.track_hover = true;
    item.x_expand = true;
    item.x_align = Clutter.ActorAlign.FILL;

    if (item._ornamentLabel) {
        try { item.remove_child(item._ornamentLabel); } catch (_) {}
        try { item._ornamentLabel.destroy(); } catch (_) {}
        item._ornamentLabel = null;
    }

    const updateVisuals = () => {
        if (item.hover) {
            item.style = 'padding: 6px 10px !important; margin: 1px 2px !important; border-radius: 8px !important; background-color: rgba(255, 255, 255, 0.12) !important; transition-duration: 100ms !important;';
        } else {
            item.style = 'padding: 6px 10px !important; margin: 1px 2px !important; border-radius: 8px !important; background-color: transparent !important; transition-duration: 100ms !important;';
        }
    };
    item.connectObject('notify::hover', updateVisuals, item);
    updateVisuals();
}

export function createMacSectionHeader(title) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
    });
    item.style = 'margin: 6px 0px 2px 0px !important; padding: 4px 10px 2px 10px !important; min-height: 18px !important; background: transparent !important;';
    item.x_expand = true;
    item.x_align = Clutter.ActorAlign.FILL;
    if (item._ornamentLabel) {
        try { item.remove_child(item._ornamentLabel); } catch (_) {}
        try { item._ornamentLabel.destroy(); } catch (_) {}
        item._ornamentLabel = null;
    }
    const label = new St.Label({
        text: title.toUpperCase(),
        style_class: 'mac-menu-section-label',
        style: 'font-size: 11px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.45) !important; text-transform: uppercase !important; letter-spacing: 0.3px !important; padding: 0 !important; margin: 0 !important;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    item.add_child(label);
    return item;
}

export function createMacStatusText(text) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
    });
    item.style = 'margin: 2px 0px !important; padding: 6px 10px !important; min-height: 20px !important; background: transparent !important;';
    item.x_expand = true;
    item.x_align = Clutter.ActorAlign.FILL;
    if (item._ornamentLabel) {
        try { item.remove_child(item._ornamentLabel); } catch (_) {}
        try { item._ornamentLabel.destroy(); } catch (_) {}
        item._ornamentLabel = null;
    }
    const label = new St.Label({
        text: text,
        style_class: 'mac-menu-status-text',
        style: 'font-size: 12px !important; font-weight: 400 !important; color: rgba(255, 255, 255, 0.45) !important; padding: 0 !important; margin: 0 !important;',
        y_align: Clutter.ActorAlign.CENTER,
    });
    item.add_child(label);
    return item;
}

export function createMacSeparator() {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    if (sep._ornamentLabel) {
        try { sep.remove_child(sep._ornamentLabel); } catch (_) {}
        try { sep._ornamentLabel.destroy(); } catch (_) {}
        sep._ornamentLabel = null;
    }
    sep.style = 'margin: 4px 6px !important; padding: 0 !important; min-height: 1px !important;';
    return sep;
}

export function createMacFooterButton(label, onClick, isControlCenter = false) {
    if (isControlCenter) {
        const btn = new St.Button({
            label: label,
            style_class: 'mac-cc-footer-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.90); font-size: 12px; font-weight: 500; text-align: center;',
        });
        btn.connect('clicked', () => { if (onClick) onClick(); });
        btn.connect('button-press-event', () => {
            if (onClick) onClick();
            return Clutter.EVENT_STOP;
        });
        const updateBtnHover = () => {
            btn.style = btn.hover
                ? 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.16); color: #ffffff; font-size: 12px; font-weight: 500; text-align: center;'
                : 'margin-top: 10px; margin-bottom: 2px; padding: 7px 12px; border-radius: 8px; background-color: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.90); font-size: 12px; font-weight: 500; text-align: center;';
        };
        btn.connect('notify::hover', updateBtnHover);
        return btn;
    }

    const item = new PopupMenu.PopupMenuItem(label, { style_class: 'mac-menu-footer-button' });
    setupMacMenuItem(item);
    item.connect('activate', () => {
        if (onClick) onClick();
    });
    return item;
}

export function createMacToggleSwitch(initialState, onToggle) {
    let state = Boolean(initialState);
    const accent = getSystemAccentColor();

    const switchBtn = new St.Button({
        style_class: 'mac-cc-switch-btn',
        style: 'width: 38px !important; height: 22px !important; padding: 0 !important; margin: 0 !important; background: transparent !important; background-color: transparent !important; border: none !important; box-shadow: none !important;',
        reactive: true,
        can_focus: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const track = new St.Widget({
        style_class: 'mac-cc-switch-track',
        style: `width: 38px !important; height: 22px !important; border-radius: 11px !important; background-color: ${state ? accent : 'rgba(255, 255, 255, 0.28)'} !important;`,
        clip_to_allocation: true,
        width: 38,
        height: 22,
    });
    switchBtn.set_child(track);

    const thumb = new St.Widget({
        style_class: 'mac-cc-switch-thumb',
        style: 'width: 18px !important; height: 18px !important; border-radius: 9px !important; background-color: #ffffff !important;',
        x: 2,
        y: 2,
        width: 18,
        height: 18,
        translation_x: state ? 16 : 0,
    });
    track.add_child(thumb);

    const updateVisuals = (newState, animate = true) => {
        state = newState;
        const curAccent = getSystemAccentColor();
        track.style = `width: 38px !important; height: 22px !important; border-radius: 11px !important; background-color: ${state ? curAccent : 'rgba(255, 255, 255, 0.28)'} !important;`;
        thumb.remove_all_transitions();
        if (animate) {
            thumb.ease({
                translation_x: state ? 16 : 0,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            thumb.translation_x = state ? 16 : 0;
        }
    };

    switchBtn.connect('clicked', () => {
        updateVisuals(!state, true);
        if (onToggle) onToggle(state);
    });
    switchBtn.connect('button-press-event', () => {
        updateVisuals(!state, true);
        if (onToggle) onToggle(state);
        return Clutter.EVENT_STOP;
    });

    return {
        actor: switchBtn,
        getState: () => state,
        setState: (val, animate = false) => {
            updateVisuals(Boolean(val), animate);
        },
    };
}

function addItemToContainer(container, item) {
    if (typeof container.addMenuItem === 'function') {
        container.addMenuItem(item);
    } else if (typeof container.add_child === 'function') {
        container.add_child(item);
    }
}

/**
 * Universal Wi-Fi Menu Builder
 */
export function populateUniversalWifiContent(container, options = {}) {
    const {
        nmClient,
        wifiDevice,
        isEnabled,
        onToggle,
        isControlCenter = false,
        onBack = null,
        onClose = null,
        onOpenSettings = null,
    } = options;

    const activeAp = wifiDevice?.get_active_access_point();
    const activeSsid = activeAp?.get_ssid() ? NM.utils_ssid_to_utf8(activeAp.get_ssid().get_data()) : null;

    // 1. Header Row
    const headerItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: 'mac-menu-header-row',
    });
    if (headerItem._ornamentLabel) {
        try { headerItem.remove_child(headerItem._ornamentLabel); } catch (_) {}
        try { headerItem._ornamentLabel.destroy(); } catch (_) {}
        headerItem._ornamentLabel = null;
    }
    headerItem.style = 'padding: 2px 2px 6px 2px !important; margin: 0 !important; min-height: 28px !important; background: transparent !important;';
    headerItem.x_expand = true;
    headerItem.x_align = Clutter.ActorAlign.FILL;

    const headerBox = new St.BoxLayout({
        vertical: false,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    headerItem.add_child(headerBox);

    if (isControlCenter) {
        // Left: Back button (fixed 82px)
        const leftSlot = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            style: 'width: 82px; min-width: 82px; max-width: 82px;',
        });
        const backBtn = new St.Button({
            style_class: 'mac-cc-back-btn',
            label: t('back', '◀ Назад'),
            reactive: true,
            can_focus: true,
            track_hover: true,
            style: 'font-size: 12px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.85) !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.12) !important;',
        });
        const updateBackHover = () => {
            backBtn.style = backBtn.hover
                ? 'font-size: 12px !important; font-weight: 600 !important; color: #ffffff !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.22) !important;'
                : 'font-size: 12px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.85) !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.12) !important;';
        };
        backBtn.connect('notify::hover', updateBackHover);
        backBtn.connect('clicked', () => { if (onBack) onBack(); });
        backBtn.connect('button-press-event', () => {
            if (onBack) onBack();
            return Clutter.EVENT_STOP;
        });
        leftSlot.add_child(backBtn);
        headerBox.add_child(leftSlot);

        // Center: Title
        const titleLbl = new St.Label({
            text: 'Wi-Fi',
            style_class: 'mac-menu-header-title',
            style: 'font-size: 14px !important; font-weight: 700 !important; color: #ffffff !important; text-align: center !important;',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(titleLbl);

        // Right: Toggle Switch (fixed 82px)
        const rightSlot = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
            style: 'width: 82px; min-width: 82px; max-width: 82px;',
        });
        const sw = createMacToggleSwitch(isEnabled, onToggle);
        rightSlot.add_child(sw.actor);
        headerBox.add_child(rightSlot);
    } else {
        // Menubar style: Title left, Switch right
        const titleLbl = new St.Label({
            text: 'Wi-Fi',
            style_class: 'mac-menu-header-title',
            style: 'font-size: 14px !important; font-weight: 700 !important; color: #ffffff !important;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(titleLbl);

        const sw = createMacToggleSwitch(isEnabled, onToggle);
        headerBox.add_child(sw.actor);
    }

    addItemToContainer(container, headerItem);
    addItemToContainer(container, createMacSeparator());

    // 2. Networks List
    if (isEnabled && wifiDevice) {
        // Active / Known network
        if (activeSsid) {
            const knownHeader = createMacSectionHeader(t('known_network', 'Відома мережа'));
            addItemToContainer(container, knownHeader);

            const activeItem = new PopupMenu.PopupBaseMenuItem({
                reactive: true,
                can_focus: false,
                style_class: 'mac-menu-item-row mac-menu-item-active',
            });
            setupMacMenuItem(activeItem);

            const badgeBox = createCircleBadge('network-wireless-signal-excellent-symbolic', true, 14);
            activeItem.add_child(badgeBox);

            const nameLbl = new St.Label({
                text: activeSsid,
                style_class: 'mac-menu-item-title',
                style: 'font-size: 13px; font-weight: 600; color: #ffffff;',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            activeItem.add_child(nameLbl);

            if (activeAp && (activeAp.get_flags() !== 0 || activeAp.get_wpa_flags() !== 0 || activeAp.get_rsn_flags() !== 0)) {
                const lockIcon = new St.Icon({
                    icon_name: 'channel-secure-symbolic',
                    icon_size: 12,
                    style: 'color: rgba(255, 255, 255, 0.45); margin-right: 8px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                activeItem.add_child(lockIcon);
            }

            const okIcon = new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                icon_size: 14,
                style: 'color: #ffffff;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            activeItem.add_child(okIcon);

            activeItem.connect('activate', () => {
                if (onClose) onClose();
                if (onOpenSettings) onOpenSettings('wifi');
            });
            activeItem.connect('button-press-event', () => {
                if (onClose) onClose();
                if (onOpenSettings) onOpenSettings('wifi');
                return Clutter.EVENT_STOP;
            });

            addItemToContainer(container, activeItem);
            addItemToContainer(container, createMacSeparator());
        }

        // Other networks
        const otherHeader = createMacSectionHeader(t('other_networks', 'Інші мережі'));
        addItemToContainer(container, otherHeader);

        const aps = wifiDevice.get_access_points() || [];
        const apMap = new Map();
        for (const ap of aps) {
            const ssidBytes = ap.get_ssid();
            if (!ssidBytes) continue;
            const ssid = NM.utils_ssid_to_utf8(ssidBytes.get_data());
            if (!ssid || ssid.trim() === '' || ssid === activeSsid) continue;
            if (!apMap.has(ssid) || apMap.get(ssid).strength < ap.get_strength()) {
                apMap.set(ssid, {
                    ssid,
                    ap,
                    strength: ap.get_strength(),
                    isSecure: ap.get_flags() !== 0 || ap.get_wpa_flags() !== 0 || ap.get_rsn_flags() !== 0,
                });
            }
        }

        const sortedAps = Array.from(apMap.values()).sort((a, b) => b.strength - a.strength);

        if (sortedAps.length === 0) {
            const noAps = createMacStatusText(t('no_networks_found', 'Мереж не знайдено'));
            addItemToContainer(container, noAps);
        } else {
            for (const info of sortedAps.slice(0, 6)) {
                const apItem = new PopupMenu.PopupBaseMenuItem({
                    reactive: true,
                    can_focus: false,
                    style_class: 'mac-menu-item-row',
                });
                setupMacMenuItem(apItem);

                let strengthIcon = 'network-wireless-signal-excellent-symbolic';
                if (info.strength <= 25) strengthIcon = 'network-wireless-signal-weak-symbolic';
                else if (info.strength <= 50) strengthIcon = 'network-wireless-signal-ok-symbolic';
                else if (info.strength <= 75) strengthIcon = 'network-wireless-signal-good-symbolic';

                const badgeBox = createCircleBadge(strengthIcon, false, 13);
                apItem.add_child(badgeBox);

                const label = new St.Label({
                    text: info.ssid,
                    style_class: 'mac-menu-item-title',
                    style: 'font-size: 13px; font-weight: 500; color: #ffffff;',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                apItem.add_child(label);

                if (info.isSecure) {
                    const lockIcon = new St.Icon({
                        icon_name: 'channel-secure-symbolic',
                        icon_size: 12,
                        style: 'color: rgba(255, 255, 255, 0.45);',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    apItem.add_child(lockIcon);
                }

                const connectNetwork = () => {
                    if (onClose) onClose();
                    const connections = nmClient?.get_connections() || [];
                    const conn = connections.find(c => {
                        const s = c.get_setting_wireless();
                        if (!s) return false;
                        const s_ssid = s.get_ssid();
                        return s_ssid && NM.utils_ssid_to_utf8(s_ssid.get_data()) === info.ssid;
                    });
                    if (conn) {
                        nmClient.activate_connection_async(conn, wifiDevice, null, null, null);
                    } else {
                        Util.spawnCommandLine(`nmcli device wifi connect "${info.ssid}"`);
                    }
                };

                apItem.connect('activate', connectNetwork);
                apItem.connect('button-press-event', () => {
                    connectNetwork();
                    return Clutter.EVENT_STOP;
                });

                addItemToContainer(container, apItem);
            }
        }
    }

    addItemToContainer(container, createMacSeparator());

    // 3. Settings Footer
    const settingsItem = createMacFooterButton(t('wifi_settings', 'Параметри Wi-Fi...'), () => {
        if (onClose) onClose();
        if (onOpenSettings) onOpenSettings('wifi');
    }, isControlCenter);
    addItemToContainer(container, settingsItem);
}

/**
 * Universal Bluetooth Menu Builder
 */
export function populateUniversalBluetoothContent(container, options = {}) {
    const {
        btClient,
        isPowered,
        onToggle,
        isControlCenter = false,
        onBack = null,
        onClose = null,
        onOpenSettings = null,
    } = options;

    // 1. Header Row
    const headerItem = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: 'mac-menu-header-row',
    });
    if (headerItem._ornamentLabel) {
        try { headerItem.remove_child(headerItem._ornamentLabel); } catch (_) {}
        try { headerItem._ornamentLabel.destroy(); } catch (_) {}
        headerItem._ornamentLabel = null;
    }
    headerItem.style = 'padding: 2px 2px 6px 2px !important; margin: 0 !important; min-height: 28px !important; background: transparent !important;';
    headerItem.x_expand = true;
    headerItem.x_align = Clutter.ActorAlign.FILL;

    const headerBox = new St.BoxLayout({
        vertical: false,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    headerItem.add_child(headerBox);

    if (isControlCenter) {
        // Left: Back button (fixed 82px)
        const leftSlot = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            style: 'width: 82px; min-width: 82px; max-width: 82px;',
        });
        const backBtn = new St.Button({
            style_class: 'mac-cc-back-btn',
            label: t('back', '◀ Назад'),
            reactive: true,
            can_focus: true,
            track_hover: true,
            style: 'font-size: 12px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.85) !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.12) !important;',
        });
        const updateBackHover = () => {
            backBtn.style = backBtn.hover
                ? 'font-size: 12px !important; font-weight: 600 !important; color: #ffffff !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.22) !important;'
                : 'font-size: 12px !important; font-weight: 600 !important; color: rgba(255, 255, 255, 0.85) !important; padding: 4px 8px !important; border-radius: 9999px !important; background-color: rgba(255, 255, 255, 0.12) !important;';
        };
        backBtn.connect('notify::hover', updateBackHover);
        backBtn.connect('clicked', () => { if (onBack) onBack(); });
        backBtn.connect('button-press-event', () => {
            if (onBack) onBack();
            return Clutter.EVENT_STOP;
        });
        leftSlot.add_child(backBtn);
        headerBox.add_child(leftSlot);

        // Center: Title
        const titleLbl = new St.Label({
            text: 'Bluetooth',
            style_class: 'mac-menu-header-title',
            style: 'font-size: 14px !important; font-weight: 700 !important; color: #ffffff !important; text-align: center !important;',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(titleLbl);

        // Right: Toggle Switch (fixed 82px)
        const rightSlot = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
            style: 'width: 82px; min-width: 82px; max-width: 82px;',
        });
        const sw = createMacToggleSwitch(isPowered, onToggle);
        rightSlot.add_child(sw.actor);
        headerBox.add_child(rightSlot);
    } else {
        // Menubar style: Title left, Switch right
        const titleLbl = new St.Label({
            text: 'Bluetooth',
            style_class: 'mac-menu-header-title',
            style: 'font-size: 14px !important; font-weight: 700 !important; color: #ffffff !important;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(titleLbl);

        const sw = createMacToggleSwitch(isPowered, onToggle);
        headerBox.add_child(sw.actor);
    }

    addItemToContainer(container, headerItem);
    addItemToContainer(container, createMacSeparator());

    // 2. Devices List
    if (isPowered) {
        const devList = [];
        try {
            if (btClient) {
                const model = btClient.get_devices?.();
                if (model && model.get_n_items) {
                    for (let i = 0; i < model.get_n_items(); i++) {
                        devList.push(model.get_item(i));
                    }
                }
            }
        } catch (e) {
            console.error('[Bluetooth] get_devices error:', e);
        }

        if (devList.length === 0) {
            const emptyItem = createMacStatusText(t('no_devices_found', 'Пристроїв не знайдено'));
            addItemToContainer(container, emptyItem);
        } else {
            const devHeader = createMacSectionHeader(t('devices', 'Пристрої'));
            addItemToContainer(container, devHeader);

            for (const dev of devList) {
                try {
                    const isConnected = Boolean(dev.connected);
                    const devItem = new PopupMenu.PopupBaseMenuItem({
                        reactive: true,
                        can_focus: false,
                        style_class: isConnected ? 'mac-menu-item-row mac-menu-item-active' : 'mac-menu-item-row',
                    });
                    setupMacMenuItem(devItem);

                    const devName = dev.name || dev.alias || t('device', 'Пристрій');
                    const iconName = getBluetoothDeviceIcon(dev.icon, devName);

                    const badgeBox = createCircleBadge(iconName, isConnected, 14);
                    devItem.add_child(badgeBox);

                    const label = new St.Label({
                        text: devName,
                        style_class: isConnected ? 'mac-menu-item-title' : 'mac-menu-item-title-muted',
                        style: isConnected ? 'font-size: 13px; font-weight: 600; color: #ffffff;' : 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.85);',
                        x_expand: true,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    devItem.add_child(label);

                    if (isConnected) {
                        const okIcon = new St.Icon({
                            icon_name: 'emblem-ok-symbolic',
                            icon_size: 14,
                            style: 'color: #ffffff;',
                            y_align: Clutter.ActorAlign.CENTER,
                        });
                        devItem.add_child(okIcon);
                    }

                    const connectDevice = () => {
                        if (onClose) onClose();
                        try {
                            const path = dev.get_object_path?.();
                            if (btClient && path) {
                                btClient.connect_service(path, !isConnected, null, null);
                            } else {
                                const address = dev.address;
                                if (address) {
                                    Util.spawnCommandLine(`bluetoothctl ${isConnected ? 'disconnect' : 'connect'} ${address}`);
                                }
                            }
                        } catch (e) {
                            console.error('[Bluetooth] Connect error:', e);
                        }
                    };

                    devItem.connect('activate', connectDevice);
                    devItem.connect('button-press-event', () => {
                        connectDevice();
                        return Clutter.EVENT_STOP;
                    });

                    addItemToContainer(container, devItem);
                } catch (e) {
                    console.error('[Bluetooth] dev item error:', e);
                }
            }
        }
        addItemToContainer(container, createMacSeparator());
    }

    // 3. Settings Footer
    const settingsItem = createMacFooterButton(t('bluetooth_settings', 'Параметри Bluetooth...'), () => {
        if (onClose) onClose();
        if (onOpenSettings) onOpenSettings('bluetooth');
    }, isControlCenter);
    addItemToContainer(container, settingsItem);
}
