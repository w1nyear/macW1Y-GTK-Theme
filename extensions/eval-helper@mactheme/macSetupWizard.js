import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

const USER_CONFIG_FILE = `${GLib.get_home_dir()}/.config/mac-styling/macSetupWizard`;
const USER_LOCAL_FILE = `${GLib.get_home_dir()}/.local/share/macW1Y/macSetupWizard`;
const SYSTEM_FILE = '/etc/macW1Y/macSetupWizard';
const VERSION_FILE = `${GLib.get_home_dir()}/.config/mac-styling/version`;
const ICON_PATH = `${GLib.get_home_dir()}/.local/share/icons/MacTahoe-dark/apps/scalable/preferences-desktop-theme.svg`;

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

export function getAccentColor() {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#ff6a00';
    } catch (_) {
        return '#ff6a00';
    }
}

export function hexToRgba(hex, alpha) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getModpackVersion() {
    try {
        if (GLib.file_test(VERSION_FILE, GLib.FileTest.EXISTS)) {
            const [ok, bytes] = GLib.file_get_contents(VERSION_FILE);
            if (ok) {
                const s = new TextDecoder().decode(bytes).trim();
                if (s) return s;
            }
        }
    } catch (_) {}
    return '0.6';
}

export function getSetupWizardFlag() {
    for (const f of [USER_CONFIG_FILE, USER_LOCAL_FILE]) {
        try {
            if (GLib.file_test(f, GLib.FileTest.EXISTS)) {
                const [ok, bytes] = GLib.file_get_contents(f);
                if (ok) {
                    const s = new TextDecoder().decode(bytes).trim();
                    if (s === '0') return false;
                    if (s === '1') return true;
                }
            }
        } catch (_) {}
    }
    try {
        if (GLib.file_test(SYSTEM_FILE, GLib.FileTest.EXISTS)) {
            const [ok, bytes] = GLib.file_get_contents(SYSTEM_FILE);
            if (ok) {
                const s = new TextDecoder().decode(bytes).trim();
                return s === '1';
            }
        }
    } catch (_) {}
    return false;
}

export function setSetupWizardFlag(val) {
    const str = val ? '1' : '0';
    for (const f of [USER_CONFIG_FILE, USER_LOCAL_FILE]) {
        try {
            const dir = GLib.path_get_dirname(f);
            GLib.mkdir_with_parents(dir, 0o755);
            GLib.file_set_contents(f, `${str}\n`);
        } catch (e) {
            console.error(`[macSetupWizard] Error writing to ${f}: ${e}`);
        }
    }
    try {
        if (GLib.file_test(SYSTEM_FILE, GLib.FileTest.EXISTS)) {
            GLib.file_set_contents(SYSTEM_FILE, `${str}\n`);
        }
    } catch (_) {}
}

export function hasTouchpadGestures() {
    try {
        const seat = Clutter.get_default_backend().get_default_seat();
        if (seat && typeof seat.list_devices === 'function') {
            const devs = seat.list_devices();
            for (const d of devs) {
                if (d.get_device_type() === Clutter.InputDeviceType.TOUCHPAD_DEVICE) {
                    return true;
                }
            }
        }
    } catch (_) {}
    const sockPath = `/run/user/${GLib.get_uid()}/mac_touchpad.sock`;
    if (GLib.file_test(sockPath, GLib.FileTest.EXISTS)) return true;
    return false;
}

export class MacSetupWizard {
    constructor() {
        this._overlay = null;
        this._blurClone = null;
        this._welcomeBox = null;
        this._continueBtnBox = null;
        this._dialogCard = null;
        this._pageContainer = null;
        this._currentPage = 1;
        this._totalPages = 3;
        this._hiddenElements = [];
        this._miniWin = null;
        this._gestureSuccess = false;
        this._gestureDistance = 0;
        this._step2ContinueBtn = null;
        this._step2StatusLabel = null;
        this._isDark = true;
    }

    start({ force = false } = {}) {
        if (!force && !getSetupWizardFlag()) {
            return false;
        }

        // Clean up any stale overlay instances in uiGroup
        try {
            const existing = Main.layoutManager.uiGroup.get_children().filter(c => c.name === 'macSetupWizardOverlay');
            for (const o of existing) {
                try { o.destroy(); } catch (_) {}
            }
        } catch (_) {}

        if (this._overlay) {
            this.destroy();
        }

        globalThis.macSetupWizardActive = true;
        globalThis._macSetupWizardInstance = this;

        try {
            const scheme = Gio.Settings.new('org.gnome.desktop.interface').get_string('color-scheme');
            this._isDark = scheme !== 'prefer-light';
        } catch (_) {
            this._isDark = true;
        }

        // Hide desktop elements
        this._isolateDesktop();

        // Build fullscreen overlay with blurred background
        this._buildOverlay();

        // Build Screen 1: Welcome to Mac (Photo 1)
        this._buildScreen1();

        return true;
    }

    _isolateDesktop() {
        this._hiddenElements = [];

        // Top Panel
        if (Main.panel) {
            this._hiddenElements.push({
                actor: Main.panel,
                origOpacity: 255,
                origReactive: true
            });
            Main.panel.opacity = 0;
            Main.panel.reactive = false;
        }

        // Desktop Icons (DING) smooth fade-out animation
        try {
            const dingActors = (global.window_group?.get_children() || []).filter(c => {
                const mw = c.meta_window || c.get_meta_window?.();
                return mw && (mw.get_gtk_application_id?.() === 'com.rastersoft.ding' ||
                              mw.get_title?.()?.startsWith('Desktop Icons'));
            });
            for (const actor of dingActors) {
                this._hiddenElements.push({
                    actor,
                    origOpacity: 255,
                    origReactive: true
                });
                actor.ease({
                    opacity: 0,
                    duration: 350,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        actor.opacity = 0;
                        actor.reactive = false;
                    }
                });
            }
        } catch (_) {}
    }

    _restoreDesktop() {
        for (const item of this._hiddenElements) {
            try {
                const targetOpacity = item.origOpacity !== undefined ? item.origOpacity : 255;
                if (item.actor && item.actor.ease) {
                    item.actor.ease({
                        opacity: targetOpacity,
                        duration: 400,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            if (item.actor) {
                                item.actor.opacity = targetOpacity;
                                item.actor.reactive = true;
                            }
                        }
                    });
                } else if (item.actor) {
                    item.actor.opacity = targetOpacity;
                    item.actor.reactive = true;
                }
            } catch (_) {}
        }
        this._hiddenElements = [];

        // Safety fallback: ensure Main.panel is fully visible and reactive
        if (Main.panel) {
            Main.panel.opacity = 255;
            Main.panel.reactive = true;
        }

        // Safety fallback: ensure Dock, Liquid Glass, and Desktop Icons are 100% restored
        try {
            for (const child of Main.layoutManager.uiGroup.get_children()) {
                const name = child.name || '';
                const cname = child.constructor.name || '';
                if (name === 'dashtodockContainer' || cname === 'DashToDock' || name === 'dock-container' ||
                    name === 'iconsContainer' || cname === 'DesktopIcons' || name === 'ding-container' ||
                    name.includes('liquid-glass')) {
                    child.opacity = 255;
                    child.reactive = true;
                }
            }
        } catch (_) {}
    }

    _buildOverlay() {
        const stageW = global.stage.width;
        const stageH = global.stage.height;

        this._overlay = new St.Widget({
            name: 'macSetupWizardOverlay',
            x: 0,
            y: 0,
            width: stageW,
            height: stageH,
            reactive: true,
            opacity: 0
        });

        // Blurred Background Clone
        try {
            const bgGroup = Main.layoutManager._backgroundGroup;
            if (bgGroup) {
                this._blurClone = new Clutter.Clone({
                    source: bgGroup,
                    width: stageW,
                    height: stageH
                });
                const blurEffect = new Shell.BlurEffect({
                    mode: Shell.BlurMode.ACTOR,
                    radius: 60
                });
                this._blurClone.add_effect(blurEffect);
                this._overlay.add_child(this._blurClone);
            }
        } catch (e) {
            console.error(`[macSetupWizard] Could not clone background: ${e}`);
        }

        // Deep Scrim Layer
        const scrim = new St.Widget({
            width: stageW,
            height: stageH,
            style: 'background-color: rgba(0, 0, 0, 0.32);'
        });
        this._overlay.add_child(scrim);

        Main.layoutManager.uiGroup.add_child(this._overlay);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._overlay, null);

        this._overlay.ease({
            opacity: 255,
            duration: 450,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _buildScreen1() {
        const stageW = global.stage.width;
        const stageH = global.stage.height;

        // Welcome Text Box (Centered vertically and horizontally)
        const textH = 120;
        this._welcomeBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            width: stageW,
            height: textH,
            x: 0,
            y: Math.round((stageH - textH) / 2) - 30,
            opacity: 0
        });

        const welcomeLabel = new St.Label({
            text: 'Welcome to macW1Y',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: "font-family: 'SF Pro Rounded', 'SF Pro Display', -apple-system, sans-serif; " +
                   "font-size: 64px; font-weight: 600; color: #ffffff; text-align: center; " +
                   "text-shadow: 0 4px 28px rgba(0, 0, 0, 0.60); letter-spacing: -0.5px;"
        });
        this._welcomeBox.add_child(welcomeLabel);
        this._overlay.add_child(this._welcomeBox);

        // Continue Button at Bottom (Reference: Photo 1 / GRUB menu)
        const btnBoxW = 140;
        const btnBoxH = 90;
        this._continueBtnBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x: Math.round((stageW - btnBoxW) / 2),
            y: stageH - 130,
            width: btnBoxW,
            height: btnBoxH,
            opacity: 0
        });

        const circleBtn = new St.Button({
            style: "width: 46px; height: 46px; border-radius: 9999px; " +
                   "background-color: rgba(255, 255, 255, 0.22); " +
                   "border: 1px solid rgba(255, 255, 255, 0.35); " +
                   "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.30);",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            reactive: true
        });

        // Use a 46x46 St.Bin to guarantee perfect pixel-level centering of the arrow icon
        const iconBin = new St.Bin({
            width: 46,
            height: 46,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        const arrowIcon = new St.Icon({
            icon_name: 'go-next-symbolic',
            icon_size: 18,
            style: 'color: #ffffff;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        iconBin.set_child(arrowIcon);
        circleBtn.set_child(iconBin);

        circleBtn.connect('enter-event', () => {
            circleBtn.style = "width: 46px; height: 46px; border-radius: 9999px; " +
                              "background-color: rgba(255, 255, 255, 0.38); " +
                              "border: 1px solid rgba(255, 255, 255, 0.50); " +
                              "box-shadow: 0 4px 20px rgba(255, 255, 255, 0.25);";
        });
        circleBtn.connect('leave-event', () => {
            circleBtn.style = "width: 46px; height: 46px; border-radius: 9999px; " +
                              "background-color: rgba(255, 255, 255, 0.22); " +
                              "border: 1px solid rgba(255, 255, 255, 0.35); " +
                              "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.30);";
        });

        const labelText = new St.Label({
            text: 'Продовжити',
            style: "font-family: 'SF Pro Text', -apple-system, sans-serif; " +
                   "font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.92); " +
                   "text-align: center; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.60); margin-top: 6px;"
        });

        circleBtn.connect('clicked', () => {
            this._transitionToScreen2();
        });

        this._continueBtnBox.add_child(circleBtn);
        this._continueBtnBox.add_child(labelText);
        this._overlay.add_child(this._continueBtnBox);

        // Animate elements in
        this._welcomeBox.ease({
            opacity: 255,
            duration: 600,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
        this._continueBtnBox.ease({
            opacity: 255,
            duration: 600,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _transitionToScreen2() {
        if (this._welcomeBox) {
            this._welcomeBox.ease({
                opacity: 0,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._welcomeBox) {
                        this._welcomeBox.destroy();
                        this._welcomeBox = null;
                    }
                }
            });
        }
        if (this._continueBtnBox) {
            this._continueBtnBox.ease({
                opacity: 0,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._continueBtnBox) {
                        this._continueBtnBox.destroy();
                        this._continueBtnBox = null;
                    }
                    this._buildScreen2();
                }
            });
        }
    }

    _applyNextBtnStyle() {
        if (!this._nextBtn) return;
        const bg = this._accentColor || '#ff6a00';
        const shadow = hexToRgba(bg, 0.38);
        this._nextBtn.style = `padding: 7px 26px; border-radius: 9999px; font-size: 13px; font-weight: 600; ` +
                              `background-color: ${bg}; color: #ffffff; border: none; box-shadow: 0 2px 10px ${shadow};`;
    }

    _applyBackBtnStyle() {
        if (!this._backBtn) return;
        const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
        const bg = this._isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)';
        const border = this._isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)';
        this._backBtn.style = `padding: 7px 22px; border-radius: 9999px; font-size: 13px; font-weight: 500; ` +
                              `background-color: ${bg}; color: ${titleColor}; border: 1px solid ${border};`;
    }

    _buildScreen2() {
        const stageW = global.stage.width;
        const stageH = global.stage.height;
        this._cardW = 760;
        this._cardH = 550;
        const cardW = this._cardW;
        const cardH = this._cardH;
        const padX = 22;
        const contentW = cardW - (padX * 2);
        const version = getModpackVersion();
        this._accentColor = getAccentColor();

        const cardBg = this._isDark ? '#28282a' : '#ffffff';
        const cardBorder = this._isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
        const cardShadow = this._isDark ? '0 24px 72px rgba(0, 0, 0, 0.65)' : '0 24px 72px rgba(0, 0, 0, 0.25)';
        const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
        const subColor = this._isDark ? '#a1a1a6' : '#86868b';

        this._dialogCard = new St.Widget({
            name: 'macSetupWizardCard',
            x: Math.round((stageW - cardW) / 2),
            y: Math.round((stageH - cardH) / 2) + 20,
            width: cardW,
            height: cardH,
            reactive: true,
            opacity: 0,
            style: `background-color: ${cardBg}; border: 1px solid ${cardBorder}; ` +
                   `border-radius: 22px; box-shadow: ${cardShadow};`
        });

        const mainLayout = new St.BoxLayout({
            vertical: true,
            width: cardW,
            height: cardH,
            style: 'padding: 46px 22px 20px 22px;'
        });

        // 1. Top Header: App icon + Title + Subtitle
        const headerBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 20px;'
        });

        // macOS App Icon (squircle preferences-desktop-theme)
        let appIconWidget;
        try {
            const iconFile = Gio.File.new_for_path(ICON_PATH);
            const gicon = new Gio.FileIcon({ file: iconFile });
            appIconWidget = new St.Icon({
                gicon: gicon,
                icon_size: 64,
                style: 'margin-bottom: 10px;'
            });
        } catch (_) {
            appIconWidget = new St.Icon({
                icon_name: 'preferences-desktop-theme-symbolic',
                icon_size: 64,
                style: `color: ${this._accentColor}; margin-bottom: 10px;`
            });
        }
        headerBox.add_child(appIconWidget);

        this._titleLabel = new St.Label({
            text: `macW1Y ${version} успішно встановлено`,
            style: `font-family: 'SF Pro Display', -apple-system, sans-serif; font-size: 22px; font-weight: 700; color: ${titleColor}; text-align: center;`
        });
        headerBox.add_child(this._titleLabel);

        this._subtitleLabel = new St.Label({
            text: 'Налаштування та оптимізація робочого простору',
            style: `font-family: 'SF Pro Text', -apple-system, sans-serif; font-size: 13px; font-weight: 400; color: ${subColor}; text-align: center; margin-top: 3px;`
        });
        headerBox.add_child(this._subtitleLabel);
        mainLayout.add_child(headerBox);

        // 2. Middle Content Stack Container
        this._pageContainer = new St.BoxLayout({
            vertical: true,
            width: contentW,
            height: 270,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            y_expand: true
        });
        mainLayout.add_child(this._pageContainer);

        // 3. Bottom Action Bar: Back button on the LEFT, Continue button on the RIGHT
        this._bottomBar = new St.BoxLayout({
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            width: contentW,
            style: 'spacing: 12px; margin-top: auto; margin-bottom: 2px;'
        });

        this._backBtn = new St.Button({
            label: 'Назад',
            can_focus: true,
            reactive: false,
            visible: false,
            opacity: 0
        });
        this._applyBackBtnStyle();
        this._backBtn.connect('clicked', () => {
            this._prevPage();
        });
        this._backBtn.connect('enter-event', () => {
            const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
            const bg = this._isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.10)';
            const border = this._isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.16)';
            this._backBtn.style = `padding: 7px 22px; border-radius: 9999px; font-size: 13px; font-weight: 500; ` +
                                  `background-color: ${bg}; color: ${titleColor}; border: 1px solid ${border};`;
        });
        this._backBtn.connect('leave-event', () => {
            this._applyBackBtnStyle();
        });
        this._bottomBar.add_child(this._backBtn);

        const spacer = new St.Widget({ x_expand: true });
        this._bottomBar.add_child(spacer);

        this._nextBtn = new St.Button({
            label: 'Продовжити',
            can_focus: true,
            reactive: true
        });
        this._applyNextBtnStyle();
        this._nextBtn.connect('clicked', () => {
            this._nextPage();
        });
        this._nextBtn.connect('enter-event', () => {
            const bg = this._accentColor || '#ff6a00';
            this._nextBtn.style = `padding: 7px 26px; border-radius: 9999px; font-size: 13px; font-weight: 600; ` +
                                  `background-color: ${bg}; color: #ffffff; border: none; box-shadow: 0 4px 16px ${hexToRgba(bg, 0.55)};`;
        });
        this._nextBtn.connect('leave-event', () => {
            this._applyNextBtnStyle();
        });
        this._bottomBar.add_child(this._nextBtn);
        mainLayout.add_child(this._bottomBar);

        this._dialogCard.add_child(mainLayout);
        this._overlay.add_child(this._dialogCard);

        // Render Page 1
        this._currentPage = 1;
        this._renderCurrentPage();

        // Animate Dialog Card in
        this._dialogCard.ease({
            opacity: 255,
            y: Math.round((stageH - cardH) / 2),
            duration: 400,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    _renderCurrentPage() {
        this._pageContainer.destroy_all_children();
        globalThis.macSetupWizardGestureHook = null;

        const titleColor = this._isDark ? '#ffffff' : '#1d1d1f';
        const subColor = this._isDark ? '#a1a1a6' : '#86868b';
        const rowBg = this._isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.03)';
        const rowBorder = this._isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

        if (this._currentPage === 1) {
            this._titleLabel.text = `macW1Y ${getModpackVersion()} успішно встановлено`;
            this._subtitleLabel.text = 'Оновлена конфігурація та нативні компоненти macOS Tahoe';
            this._backBtn.visible = false;
            this._backBtn.opacity = 0;
            this._backBtn.reactive = false;
            this._nextBtn.set_label('Продовжити');
            this._applyNextBtnStyle();

            const page1Box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.FILL,
                style: 'spacing: 12px;'
            });

            const items = [
                {
                    icon: 'preferences-desktop-theme-symbolic',
                    title: 'macOS Tahoe Liquid Glass & SSOT',
                    desc: 'Повний набір єдиних стилів GTK3/GTK4, плавні вікна, шрифти Apple SF Pro та нативні віджети.'
                },
                {
                    icon: 'preferences-system-performance-symbolic',
                    title: 'Апаратне прискорення та відгук',
                    desc: 'Стабільні 60-120 FPS, високошвидкісна частота опитування миші та плавна анімація інтерфейсу.'
                },
                {
                    icon: 'input-touchpad-symbolic',
                    title: 'Підтримка жестів Apple Trackpad',
                    desc: 'Нативне 3-пальцеве переміщення вікон, 4-пальцеві віртуальні столи та розумний буфер обміну.'
                }
            ];

            for (const item of items) {
                const row = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `background-color: ${rowBg}; border: 1px solid ${rowBorder}; border-radius: 14px; padding: 14px 20px; spacing: 16px;`
                });

                const icon = new St.Icon({
                    icon_name: item.icon,
                    icon_size: 26,
                    style: `color: ${this._accentColor}; min-width: 30px;`
                });
                row.add_child(icon);

                const textBox = new St.BoxLayout({ vertical: true, x_expand: true });
                const rTitle = new St.Label({
                    text: item.title,
                    style: `font-size: 13px; font-weight: 600; color: ${titleColor};`
                });
                const rDesc = new St.Label({
                    text: item.desc,
                    style: `font-size: 11px; font-weight: 400; color: ${subColor}; margin-top: 3px;`
                });
                textBox.add_child(rTitle);
                textBox.add_child(rDesc);
                row.add_child(textBox);

                page1Box.add_child(row);
            }

            this._pageContainer.add_child(page1Box);

        } else if (this._currentPage === 2 && hasTouchpadGestures()) {
            this._titleLabel.text = 'Жест переміщення трьома пальцями';
            this._subtitleLabel.text = 'Спробуйте перемістити міні-вікно macOS всередині області трьома пальцями на тачпаді.';
            this._backBtn.visible = true;
            this._backBtn.opacity = 255;
            this._backBtn.reactive = true;
            this._applyBackBtnStyle();
            this._nextBtn.set_label('Продовжити');
            this._applyNextBtnStyle();

            const page2Box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.FILL
            });

            // Interactive Container Area (Wider: 716px)
            const areaW = this._cardW - 44; // 716px
            const areaH = 185;
            const areaBg = this._isDark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.04)';
            const areaBorder = this._isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';

            const testArea = new St.Widget({
                width: areaW,
                height: areaH,
                reactive: true,
                style: `background-color: ${areaBg}; border: 1px dashed ${areaBorder}; border-radius: 14px;`
            });

            // Mini macOS Window Actor inside Test Area
            const miniW = 240;
            const miniH = 125;
            let miniX = Math.round((areaW - miniW) / 2);
            let miniY = Math.round((areaH - miniH) / 2);

            this._miniWin = new St.Widget({
                name: 'macMiniPreviewWindow',
                x: miniX,
                y: miniY,
                width: miniW,
                height: miniH,
                reactive: true,
                style: `background-color: ${this._isDark ? '#323236' : '#ffffff'}; ` +
                       `border: 1px solid ${this._isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.10)'}; ` +
                       `border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.40);`
            });

            const miniLayout = new St.BoxLayout({
                vertical: true,
                width: miniW,
                height: miniH
            });

            // Mini Window Titlebar
            const miniTitlebar = new St.BoxLayout({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.CENTER,
                height: 24,
                style: `padding: 6px 8px; border-bottom: 1px solid ${this._isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}; spacing: 5px;`
            });

            // Traffic lights
            const tlRed = new St.Widget({ style: 'width: 8px; height: 8px; border-radius: 9999px; background-color: #ff5f56;' });
            const tlYellow = new St.Widget({ style: 'width: 8px; height: 8px; border-radius: 9999px; background-color: #ffbd2e;' });
            const tlGreen = new St.Widget({ style: 'width: 8px; height: 8px; border-radius: 9999px; background-color: #27c93f;' });
            miniTitlebar.add_child(tlRed);
            miniTitlebar.add_child(tlYellow);
            miniTitlebar.add_child(tlGreen);

            const miniTitle = new St.Label({
                text: 'macOS Finder',
                x_expand: true,
                style: `font-size: 10px; font-weight: 600; color: ${titleColor}; text-align: center; margin-right: 24px;`
            });
            miniTitlebar.add_child(miniTitle);
            miniLayout.add_child(miniTitlebar);

            // Mini Window Body
            const miniBody = new St.BoxLayout({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                height: miniH - 24,
                style: 'spacing: 8px;'
            });
            const folderIcon = new St.Icon({
                icon_name: 'folder-symbolic',
                icon_size: 28,
                style: `color: ${this._accentColor};`
            });
            const folderLabel = new St.Label({
                text: 'Документи',
                style: `font-size: 11px; font-weight: 500; color: ${titleColor};`
            });
            miniBody.add_child(folderIcon);
            miniBody.add_child(folderLabel);
            miniLayout.add_child(miniBody);

            this._miniWin.add_child(miniLayout);

            // User clicks with normal cursor: prompt them to use 3 fingers!
            this._miniWin.connect('button-press-event', () => {
                if (this._step2StatusLabel && !this._gestureSuccess) {
                    this._step2StatusLabel.text = '⚠️ Переміщення працює виключно жестом трьох пальців по тачпаду!';
                    this._step2StatusLabel.style = 'font-size: 12px; font-weight: 600; color: #ff9f0a; margin-top: 8px;';
                }
                return Clutter.EVENT_PROPAGATE;
            });

            testArea.add_child(this._miniWin);
            page2Box.add_child(testArea);

            // Status Label
            this._gestureDistance = 0;
            this._gestureSuccess = false;
            this._step2StatusLabel = new St.Label({
                text: 'Очікування жесту: покладіть три пальці на тачпад і проведіть у будь-який бік',
                style: `font-size: 12px; font-weight: 500; color: ${subColor}; text-align: center; margin-top: 8px;`
            });
            page2Box.add_child(this._step2StatusLabel);

            // Setup Gesture Hook for 3-finger drag
            globalThis.macSetupWizardGestureHook = (cmd, dx = 0, dy = 0) => {
                if (!this._miniWin) return false;

                if (cmd === 'DRAG_MOVE') {
                    miniX = Math.max(8, Math.min(areaW - miniW - 8, miniX + dx));
                    miniY = Math.max(8, Math.min(areaH - miniH - 8, miniY + dy));
                    this._miniWin.set_position(miniX, miniY);

                    this._gestureDistance += Math.hypot(dx, dy);
                    if (this._gestureDistance > 25 && !this._gestureSuccess) {
                        this._gestureSuccess = true;
                        if (this._step2StatusLabel) {
                            this._step2StatusLabel.text = '✓ Чудово! Жест трьома пальцями працює бездоганно.';
                            this._step2StatusLabel.style = 'font-size: 12px; font-weight: 600; color: #34c759; margin-top: 8px;';
                        }
                    }
                    return true;
                }
                if (cmd === 'DRAG_START' || cmd === 'DRAG_END') {
                    return true;
                }
                return false;
            };

            this._pageContainer.add_child(page2Box);

        } else {
            // Step 3: Setup Complete
            this._currentPage = 3;
            this._titleLabel.text = 'Цей Mac налаштовано';
            this._subtitleLabel.text = 'Першопочаткове налаштування macW1Y завершено. Можна продовжувати роботу.';
            this._backBtn.visible = true;
            this._backBtn.opacity = 255;
            this._backBtn.reactive = true;
            this._applyBackBtnStyle();
            this._nextBtn.set_label('Почати роботу');
            this._applyNextBtnStyle();

            const page3Box = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.FILL,
                style: 'spacing: 12px;'
            });

            // Success Badge Banner
            const banner = new St.BoxLayout({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'background-color: rgba(52, 199, 89, 0.12); border: 1px solid rgba(52, 199, 89, 0.30); border-radius: 14px; padding: 14px 20px; spacing: 16px;'
            });
            const checkIcon = new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                icon_size: 28,
                style: 'color: #34c759;'
            });
            banner.add_child(checkIcon);

            const bannerText = new St.BoxLayout({ vertical: true, x_expand: true });
            const bTitle = new St.Label({
                text: 'Система готова до роботи',
                style: `font-size: 13px; font-weight: 600; color: ${titleColor};`
            });
            const bDesc = new St.Label({
                text: 'Усі системні розширення, нативні стилі та драйвери жестів синхронізовані.',
                style: `font-size: 11px; font-weight: 400; color: ${subColor}; margin-top: 2px;`
            });
            bannerText.add_child(bTitle);
            bannerText.add_child(bDesc);
            banner.add_child(bannerText);
            page3Box.add_child(banner);

            // Quick Tips Box
            const tipsBox = new St.BoxLayout({
                vertical: true,
                style: `background-color: ${rowBg}; border: 1px solid ${rowBorder}; border-radius: 14px; padding: 14px 20px; spacing: 10px;`
            });
            const tipsTitle = new St.Label({
                text: 'Корисні комбінації та підказки:',
                style: `font-size: 12px; font-weight: 600; color: ${titleColor}; margin-bottom: 4px;`
            });
            tipsBox.add_child(tipsTitle);

            const tips = [
                { key: 'Ctrl + Пробіл', desc: 'Розумний швидкий пошук Spotlight' },
                { key: 'F4 або Super', desc: 'Повноекранне меню програм Launchpad' },
                { key: 'Правий верхній кут', desc: 'Швидкі перемикачі та Центр керування' }
            ];

            for (const t of tips) {
                const tr = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 12px;'
                });
                const kBadge = new St.Label({
                    text: t.key,
                    style: `font-size: 11px; font-weight: 600; color: ${this._accentColor}; background-color: ${hexToRgba(this._accentColor, this._isDark ? 0.20 : 0.12)}; padding: 3px 10px; border-radius: 6px;`
                });
                const dLabel = new St.Label({
                    text: t.desc,
                    style: `font-size: 11px; font-weight: 400; color: ${subColor};`
                });
                tr.add_child(kBadge);
                tr.add_child(dLabel);
                tipsBox.add_child(tr);
            }
            page3Box.add_child(tipsBox);

            this._pageContainer.add_child(page3Box);
        }
    }

    _nextPage() {
        if (this._currentPage === 1) {
            if (hasTouchpadGestures()) {
                this._currentPage = 2;
            } else {
                this._currentPage = 3;
            }
            this._renderCurrentPage();
        } else if (this._currentPage === 2) {
            this._currentPage = 3;
            this._renderCurrentPage();
        } else if (this._currentPage === 3) {
            this.finish();
        }
    }

    _prevPage() {
        if (this._currentPage === 3) {
            if (hasTouchpadGestures()) {
                this._currentPage = 2;
            } else {
                this._currentPage = 1;
            }
            this._renderCurrentPage();
        } else if (this._currentPage === 2) {
            this._currentPage = 1;
            this._renderCurrentPage();
        }
    }

    finish() {
        // Mark wizard as completed (0)
        setSetupWizardFlag(false);
        globalThis.macSetupWizardActive = false;
        globalThis.macSetupWizardGestureHook = null;

        if (this._dialogCard) {
            this._dialogCard.ease({
                opacity: 0,
                duration: 350,
                mode: Clutter.AnimationMode.EASE_IN_QUAD
            });
        }

        if (this._overlay) {
            this._overlay.ease({
                opacity: 0,
                duration: 450,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    this.destroy();
                }
            });
        } else {
            this.destroy();
        }

        // Restore desktop elements smoothly
        this._restoreDesktop();
    }

    destroy() {
        globalThis.macSetupWizardActive = false;
        globalThis.macSetupWizardGestureHook = null;
        this._restoreDesktop();

        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this._blurClone = null;
        this._welcomeBox = null;
        this._continueBtnBox = null;
        this._dialogCard = null;
        this._pageContainer = null;
        this._miniWin = null;
    }
}

let _wizardInstance = null;

export function getSetupWizardInstance() {
    if (!_wizardInstance) {
        _wizardInstance = new MacSetupWizard();
    }
    return _wizardInstance;
}

export function startSetupWizard(force = false) {
    const inst = getSetupWizardInstance();
    return inst.start({ force });
}

export function stopSetupWizard() {
    if (_wizardInstance) {
        _wizardInstance.finish();
    }
}
