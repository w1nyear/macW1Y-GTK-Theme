import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as utils from '../conveniences/utils.js';

const BlurModule = await utils.import_in_shell_only('gi://Blur');
const Shell = await utils.import_in_shell_only('gi://Shell');
const BlurOrShell = utils.is_usable_blur_module(BlurModule) ? BlurModule : Shell;

const MAX_VISIBLE_BANNERS = 4;
const DEFAULT_TIMEOUT_MS = 6000;
const HIDE_TIMEOUT_MS = 3000;
const SLIDE_DISTANCE = 450;
const ANIM_IN_DURATION = 320;
const ANIM_OUT_DURATION = 260;

export function buildNotificationCard(source, notification, options = {}) {
    const {
        sigma = 3,
        onClose = null,
        onClick = null,
    } = options;

    const banner = new St.Button({
        style_class: 'mac-notification-banner',
        can_focus: true,
        reactive: true,
        track_hover: true,
        x_expand: false,
        y_expand: false,
        clip_to_allocation: true,
    });

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
    });
    banner.set_child(mainBox);

    // Top Row: [ Icon ] [ Texts ] [ CloseButton ]
    const topRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });
    mainBox.add_child(topRow);

    // 1. App Icon
    const gicon = notification.gicon || source?.icon || source?.app?.get_app_info()?.get_icon() || null;
    const iconBin = new St.Bin({
        style_class: 'mac-notification-icon-bin',
        y_align: Clutter.ActorAlign.START,
    });
    const iconParams = {
        icon_size: 38,
        style_class: 'mac-notification-app-icon',
    };
    if (gicon) {
        iconParams.gicon = gicon;
    } else {
        iconParams.icon_name = 'dialog-information-symbolic';
    }
    const icon = new St.Icon(iconParams);
    iconBin.set_child(icon);
    topRow.add_child(iconBin);

    // 2. Texts Column
    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style_class: 'mac-notification-content-box',
    });
    topRow.add_child(contentBox);

    // App Name on top
    const appLabel = new St.Label({
        text: source?.title || _('Notification'),
        style_class: 'mac-notification-app-name',
    });
    contentBox.add_child(appLabel);

    // Title
    const titleLabel = new St.Label({
        text: notification.title || '',
        style_class: 'mac-notification-title',
    });
    contentBox.add_child(titleLabel);

    // Body
    const bodyText = notification.bannerBodyText || notification.body || '';
    const bodyLabel = new St.Label({
        text: bodyText,
        style_class: 'mac-notification-body',
    });
    bodyLabel.clutter_text.line_wrap = false;
    bodyLabel.clutter_text.ellipsize = 3; // END
    contentBox.add_child(bodyLabel);

    // 3. Close Button ('x')
    const extDir = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx`;
    const closeIconPath = `${extDir}/assets/close.png`;
    const closeHoverIconPath = `${extDir}/assets/close-button-hover.png`;
    const giconNormal = Gio.icon_new_for_string(closeIconPath);
    const giconHover = Gio.icon_new_for_string(closeHoverIconPath);
    let closeIcon = new St.Icon({
        gicon: giconNormal,
        icon_size: 20,
    });
    const closeBtn = new St.Button({
        style_class: 'mac-notification-close-btn',
        child: closeIcon,
        y_align: Clutter.ActorAlign.START,
        x_align: Clutter.ActorAlign.END,
        reactive: true,
        can_focus: true,
    });
    closeBtn.set_style('background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important; border-radius: 9999px !important; padding: 0 !important; width: 22px !important; height: 22px !important;');
    closeBtn.opacity = 0; // Hidden by default, shown on hover
    closeBtn.visible = false;
    closeBtn.connect('notify::hover', () => {
        closeIcon.gicon = closeBtn.hover ? giconHover : giconNormal;
    });
    topRow.add_child(closeBtn);

    // 4. Action Buttons (if notification has actions)
    let actionsBox = null;
    if (notification.actions && notification.actions.length > 0) {
        actionsBox = new St.BoxLayout({
            style_class: 'mac-notification-actions-box',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            visible: true,
            opacity: 255,
        });
        for (const action of notification.actions) {
            const actBtn = new St.Button({
                style_class: 'mac-notification-action-btn',
                label: action.label,
                reactive: true,
                can_focus: true,
            });
            actBtn.connect('clicked', () => {
                try { action.activate(); } catch (e) { logError(e); }
                if (onClose) onClose(cardData);
            });
            actionsBox.add_child(actBtn);
        }
        mainBox.add_child(actionsBox);
    }

    // Pure liquid glass translucent container: transparent background so BackdropGlass shader shines cleanly
    banner.set_style('background-color: transparent !important; background: transparent !important; box-shadow: none !important; border: 1px solid rgba(255, 255, 255, 0.20) !important; border-radius: 24px !important;');

    const cardData = {
        banner,
        notification,
        source,
        closeBtn,
        titleLabel,
        bodyLabel,
        actionsBox,
        isClosing: false,
    };

    const dismissCardNow = () => {
        if (cardData.isClosing)
            return Clutter.EVENT_STOP;
        cardData.isClosing = true;
        if (onClose)
            onClose(cardData);
        return Clutter.EVENT_STOP;
    };
    closeBtn.connect('clicked', dismissCardNow);
    closeBtn.connect('button-press-event', dismissCardNow);

    banner.connect('clicked', () => {
        if (cardData.isClosing)
            return;
        if (onClick)
            onClick(cardData);
    });

    const isCardHovered = () => {
        if (banner.hover || closeBtn.hover) return true;
        if (actionsBox && actionsBox.visible) {
            const btns = actionsBox.get_children();
            for (let b of btns) {
                if (b.hover) return true;
            }
        }
        return false;
    };

    const updateHoverState = () => {
        if (cardData.isClosing)
            return;
        const hovered = isCardHovered();

        closeBtn.remove_all_transitions();
        if (hovered) {
            closeBtn.visible = true;
            closeBtn.ease({
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            closeBtn.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!cardData.isClosing && !isCardHovered()) {
                        closeBtn.visible = false;
                    }
                },
            });
        }
    };

    banner.connect('notify::hover', updateHoverState);
    closeBtn.connect('notify::hover', updateHoverState);
    if (actionsBox) {
        actionsBox.connect('notify::hover', updateHoverState);
        for (const actBtn of actionsBox.get_children()) {
            actBtn.connect('notify::hover', updateHoverState);
        }
    }

    banner.connect('destroy', () => {
        cardData.isClosing = true;
    });

    cardData.updateExpansion = () => {};
    cardData.updateHoverState = updateHoverState;
    banner._updateExpansion = cardData.updateExpansion;
    banner._updateHoverState = updateHoverState;

    return cardData;
}
globalThis._macBuildNotificationCard = buildNotificationCard;

export const NotificationsController = class NotificationsController {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.enabled = false;
        this._stackBox = null;
        this._glass = null;
        this._activeBanners = [];
        this._pendingQueue = [];
        this._origOnRequestBanner = null;
        this._origAddSource = null;
        this.sigma = 3;
        this._bannerStageLoopId = 0;
    }

    enable() {
        if (this.enabled)
            return;

        if (!Main.messageTray) {
            this.connections.connect(Main.layoutManager, 'startup-complete', () => {
                this.enable();
            });
            return;
        }

        this.enabled = true;
        globalThis._macNotificationsController = this;



        // Create the vertical stack box in top-right of primary monitor work area
        this._stackBox = new St.BoxLayout({
            name: 'mac-notification-stack',
            style_class: 'mac-notification-stack',
            orientation: Clutter.Orientation.VERTICAL,
            style: 'spacing: 10px;',
            y_align: Clutter.ActorAlign.START,
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
            reactive: false,
            track_hover: false,
            visible: false,
            clip_to_allocation: false,
        });

        // Constrain to primary monitor work area (below top panel)
        const constraint = new Layout.MonitorConstraint({ primary: true });
        Main.layoutManager.panelBox.bind_property('visible',
            constraint, 'work-area',
            GObject.BindingFlags.SYNC_CREATE);
        this._stackBox.add_constraint(constraint);

        // Add above all windows as top chrome
        Main.layoutManager.addTopChrome(this._stackBox, {
            trackFullscreen: true,
        });

        // Hide GNOME default banner bin so it never shows in center
        if (Main.messageTray?._bannerBin) {
            Main.messageTray._bannerBin.visible = false;
        }

        // Intercept banner requests from MessageTray
        this._origOnRequestBanner = Main.messageTray._onNotificationRequestBanner.bind(Main.messageTray);
        Main.messageTray._onNotificationRequestBanner = (source, notification) => {
            this._handleNotificationRequest(source, notification);
        };

        // Hook _addSource on MessageTray for newly added sources
        this._origAddSource = Main.messageTray._addSource.bind(Main.messageTray);
        Main.messageTray._addSource = (source) => {
            this._origAddSource(source);
            this._hookSource(source);
        };

        // Re-hook all existing sources
        for (const source of Main.messageTray.getSources()) {
            this._hookSource(source);
        }

        // Initialize Liquid Glass for floating notification banners
        this._initGlass();

        // Real-time sigma change listener
        if (this.settings?.notification?.settings) {
            this.connections.connect(
                this.settings.notification.settings,
                'changed::sigma',
                () => {
                    const s = this.settings.notification.SIGMA ?? 20;
                    this.sigma = s;
                    if (this._glass && !this._glass.is_finalized?.()) {
                        this._glass.setBlurRadius(Math.max(1, Math.round(s / 6)));
                    }
                }
            );
        }
    }

    _getNotifThemeParams() {
        let isDark = true;
        try {
            const iface = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
            const scheme = iface.get_string('color-scheme');
            if (scheme === 'prefer-dark') isDark = true;
            else if (scheme === 'prefer-light') isDark = false;
            else {
                const gtk = iface.get_string('gtk-theme') || '';
                isDark = gtk.toLowerCase().includes('dark');
            }
        } catch (_) {
            isDark = true;
        }

        const tintVal = isDark ? 0.0 : 1.0;
        const baseStrength = isDark ? 0.05 : 0.06;
        const tintStrength = isDark ? 0.05 : 0.06;
        return { isDark, tintVal, baseStrength, tintStrength };
    }

    async _initGlass() {
        if (this._glass && !this._glass.is_finalized?.()) return;
        try {
            const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
            const path = ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
            const mod = await import(`file://${path}/dist/rendering/backdropGlass.js`);
            const BackdropGlass = mod.BackdropGlass;

            this._glass = new BackdropGlass({
                extensionPath: path,
                settings: ext?.stateObj?._settings || null,
                logger: console,
                owner: 'notification-banner',
            });
            const { tintVal, tintStrength } = this._getNotifThemeParams();
            this._glass.setIsDock(true);
            this._glass.setMultiRegionMode(true);
            this._glass.setCornerRadius(24.0);
            this._glass.setBlurRadius(3.0);
            this._glass.setTintStrength(tintStrength);
            this._glass.setTintColor(tintVal, tintVal, tintVal);
            this._glass.setBrightness(1.0);
            this._glass.setSaturation(1.0);
            this._glass.setContrast(1.0);
            this._glass.setPadding(0);
            try {
                this._glass._renderer.uniforms.set('shadow_intensity', 0.0);
                this._glass._renderer.uniforms.set('shadow_radius', 0.0);
                this._glass._renderer.uniforms.set('shadow_max_radius', 0.0);
            } catch (_) {}
            this._glass.hide();

            if (this._stackBox) {
                Main.layoutManager.uiGroup.insert_child_below(this._glass, this._stackBox);
            }
        } catch (e) {
            console.error(`[NotificationsController] Error initializing BackdropGlass: ${e}`);
        }
    }

    _syncGlass() {
        if (!this._glass || this._glass.is_finalized?.()) return;
        if (!this.enabled || !this._activeBanners || this._activeBanners.length === 0) {
            if (this._glass.visible) this._glass.hide();
            if (this._bannerStageLoopId) {
                try { global.stage.disconnect(this._bannerStageLoopId); } catch (_) {}
                this._bannerStageLoopId = 0;
            }
            return;
        }

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        this._glass.set_position(monitor.x, monitor.y);
        this._glass.set_size(monitor.width, monitor.height);
        this._glass.setResolution(monitor.width, monitor.height);

        const regions = [];
        const { tintVal, baseStrength, tintStrength } = this._getNotifThemeParams();

        for (const b of this._activeBanners) {
            const banner = b.banner;
            if (!banner.visible) continue;
            const [absX, absY] = banner.get_transformed_position();
            const [w, h] = banner.get_transformed_size();
            if (w <= 0 || h <= 0 || !Number.isFinite(absX) || !Number.isFinite(absY)) continue;

            regions.push({
                x: absX - monitor.x,
                y: absY - monitor.y,
                w: w,
                h: h,
                tintR: tintVal,
                tintG: tintVal,
                tintB: tintVal,
                baseStrength: baseStrength,
            });
        }

        if (regions.length > 0) {
            this._glass.setTintColor(tintVal, tintVal, tintVal);
            this._glass.setTintStrength(tintStrength);
            this._glass.setBrightness(1.0);
            this._glass.setIsDock(true);
            this._glass.setGlassRegions(regions);
            if (!this._glass.visible) {
                this._glass.show();
                this._glass.opacity = 255;
            }
            if (typeof this._glass.forceRefresh === 'function') {
                this._glass.forceRefresh(400);
            }
            this._glass.syncSources(true);
            this._glass.queue_redraw();

            if (!this._bannerStageLoopId) {
                this._bannerStageLoopId = global.stage.connect('before-update', () => {
                    if (this._activeBanners && this._activeBanners.length > 0) {
                        this._syncGlass();
                    }
                });
            }
        } else {
            this._glass.hide();
            if (this._bannerStageLoopId) {
                try { global.stage.disconnect(this._bannerStageLoopId); } catch (_) {}
                this._bannerStageLoopId = 0;
            }
        }
    }

    _hookSource(source) {
        if (!source || source._macBannerHooked) return;
        source._macBannerHooked = true;
        source.connectObject(
            'notification-request-banner', (s, n) => {
                this._handleNotificationRequest(s, n);
            },
            this
        );
    }

    _handleNotificationRequest(source, notification) {
        if (!this.enabled) {
            this._origOnRequestBanner(source, notification);
            return;
        }

        const notifCenter = globalThis._macNotificationCenter ||
            Main.extensionManager?.lookup?.('blur-my-shell@aunetx')?.stateObj?._menubar_controller;

        // Check Do Not Disturb (Не турбувати)
        let showBanners = true;
        try {
            const notifSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
            showBanners = notifSettings.get_boolean('show-banners');
        } catch (_) {}

        if (!showBanners) {
            // DND active: quietly transfer to Notification Center, no popups, no sounds, no animations
            notification.acknowledged = true;
            if (notifCenter && typeof notifCenter.addNotificationQuiet === 'function') {
                notifCenter.addNotificationQuiet(source, notification);
            }
            return;
        }

        // If Notification Center is currently open, don't overlap floating banners onto it!
        // Animate the notification directly into the top of the open Notification Center.
        const isCenterOpen = (notifCenter?.isOpen ?? false) || (Main.panel?.statusArea?.dateMenu?.menu?.isOpen ?? false);
        if (isCenterOpen) {
            notification.acknowledged = true;
            try { notification.playSound(); } catch (_e) { /* ignore */ }

            if (notifCenter && typeof notifCenter.addNotificationAnimated === 'function') {
                notifCenter.addNotificationAnimated(source, notification);
            }
            return;
        }

        // Validate policy & state
        if (notification.acknowledged)
            return;
        if (notification.urgency === 0) // LOW
            return;
        if (!notification.source?.policy?.showBanners && notification.urgency !== 2) // CRITICAL
            return;
        if (Main.sessionMode.isLocked && !notification.source?.policy?.showInLockScreen)
            return;
        if (Main.layoutManager.primaryMonitor?.inFullscreen && notification.urgency !== 2)
            return;

        // Play sound and mark acknowledged so default tray doesn't re-show
        notification.acknowledged = true;
        try { notification.playSound(); } catch (_e) { /* ignore */ }

        // If banner for this notification is already displayed, update it
        const existing = this._activeBanners.find(b => b.notification === notification);
        if (existing) {
            this._updateBanner(existing);
            return;
        }

        // Display or queue
        if (this._activeBanners.length < MAX_VISIBLE_BANNERS) {
            this._showBanner(source, notification);
        } else {
            this._pendingQueue.push({ source, notification });
        }
    }

    _showBanner(source, notification) {
        const bannerData = buildNotificationCard(source, notification, {
            sigma: this.sigma,
            onClose: () => {
                this._dismissBanner(bannerData, true);
            },
            onClick: () => {
                try { notification.activate(); } catch (e) { logError(e); }
                this._dismissBanner(bannerData, false);
            },
        });

        bannerData.timeoutId = 0;
        bannerData.hovered = false;

        const updateHoverState = () => {
            if (bannerData.isClosing)
                return;
            const isHovered = bannerData.banner.hover || bannerData.closeBtn.hover;
            if (isHovered && !bannerData.hovered) {
                bannerData.hovered = true;
                this._pauseTimer(bannerData);
            } else if (!isHovered && bannerData.hovered) {
                bannerData.hovered = false;
                this._startTimer(bannerData, HIDE_TIMEOUT_MS);
            }
        };

        bannerData.banner.connect('notify::hover', updateHoverState);
        bannerData.closeBtn.connect('notify::hover', updateHoverState);

        notification.connectObject('destroy', () => {
            this._dismissBanner(bannerData, false);
        }, bannerData.banner);

        bannerData.banner.connect('notify::translation-x', () => this._syncGlass());
        bannerData.banner.connect('notify::opacity', () => this._syncGlass());
        bannerData.banner.connect('notify::height', () => this._syncGlass());
        bannerData.banner.connect('notify::width', () => this._syncGlass());
        bannerData.banner.connect('notify::allocation', () => this._syncGlass());

        this._activeBanners.push(bannerData);
        this._stackBox.add_child(bannerData.banner);
        this._updateVisibility();

        if (this._glass && typeof this._glass.forceRefresh === 'function') {
            this._glass.forceRefresh(500);
        }
        this._syncGlass();

        bannerData.banner.opacity = 0;
        bannerData.banner.translation_x = SLIDE_DISTANCE;
        bannerData.banner.ease({
            opacity: 255,
            translation_x: 0,
            duration: ANIM_IN_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._syncGlass();
            },
        });

        if (notification.urgency !== 2) {
            this._startTimer(bannerData, DEFAULT_TIMEOUT_MS);
        }
    }

    _updateBanner(bannerData) {
        const { banner, notification, titleLabel, bodyLabel } = bannerData;
        titleLabel.text = notification.title || '';
        bodyLabel.text = notification.bannerBodyText || notification.body || '';

        // Reset timer
        if (!bannerData.hovered && notification.urgency !== 2) {
            this._startTimer(bannerData, DEFAULT_TIMEOUT_MS);
        }
    }

    _startTimer(bannerData, ms) {
        this._pauseTimer(bannerData);
        bannerData.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            bannerData.timeoutId = 0;
            this._dismissBanner(bannerData, false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _pauseTimer(bannerData) {
        if (bannerData.timeoutId) {
            GLib.source_remove(bannerData.timeoutId);
            bannerData.timeoutId = 0;
        }
    }

    _dismissBanner(bannerData, userDismissed) {
        const idx = this._activeBanners.indexOf(bannerData);
        if (idx === -1 || bannerData.isClosing)
            return;

        bannerData.isClosing = true;
        this._pauseTimer(bannerData);

        const banner = bannerData.banner;
        banner.remove_all_transitions();

        // Slide back out past the right edge of the screen
        banner.ease({
            opacity: 0,
            translation_x: SLIDE_DISTANCE,
            duration: ANIM_OUT_DURATION,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                const curIdx = this._activeBanners.indexOf(bannerData);
                if (curIdx !== -1) {
                    this._activeBanners.splice(curIdx, 1);
                }
                if (banner.get_parent() === this._stackBox)
                    this._stackBox.remove_child(banner);
                banner.destroy();

                try {
                    if (userDismissed) {
                        bannerData.notification.destroy(2); // DISMISSED
                    } else if (bannerData.notification.isTransient) {
                        bannerData.notification.destroy(1); // EXPIRED
                    }
                } catch (e) {
                    console.error(`[BlurMyShell] Notification destroy error: ${e}`);
                }

                this._updateVisibility();
                this._checkPendingQueue();
            },
        });
    }

    _checkPendingQueue() {
        if (this._pendingQueue.length > 0 && this._activeBanners.length < MAX_VISIBLE_BANNERS) {
            const next = this._pendingQueue.shift();
            this._showBanner(next.source, next.notification);
        }
    }

    _updateVisibility() {
        const hasBanners = this._activeBanners.length > 0;
        this._stackBox.visible = hasBanners;
        this._syncGlass();
    }

    getActiveBanners() {
        return this._activeBanners ? [...this._activeBanners] : [];
    }

    takeActiveBanners() {
        if (!this._activeBanners || this._activeBanners.length === 0)
            return [];
        const list = [...this._activeBanners];
        this._activeBanners = [];
        this._pendingQueue = [];
        for (const b of list) {
            this._pauseTimer(b);
        }
        return list;
    }

    dismissAllBanners(immediate = false) {
        if (!this._activeBanners || this._activeBanners.length === 0)
            return;

        const bannersToDismiss = [...this._activeBanners];
        this._activeBanners = [];
        this._pendingQueue = [];

        for (const bannerData of bannersToDismiss) {
            this._pauseTimer(bannerData);
            const banner = bannerData.banner;
            banner.remove_all_transitions();

            if (immediate) {
                if (banner.get_parent() === this._stackBox)
                    this._stackBox.remove_child(banner);
                banner.destroy();
            } else {
                banner.ease({
                    opacity: 0,
                    translation_x: SLIDE_DISTANCE,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    onComplete: () => {
                        if (banner.get_parent() === this._stackBox)
                            this._stackBox.remove_child(banner);
                        banner.destroy();
                    },
                });
            }
        }
        this._updateVisibility();
    }

    disable() {
        if (!this.enabled)
            return;
        this.enabled = false;
        if (globalThis._macNotificationsController === this) {
            globalThis._macNotificationsController = null;
        }

        // Restore GNOME default banner bin
        if (Main.messageTray?._bannerBin) {
            Main.messageTray._bannerBin.visible = true;
        }

        // Restore original handlers
        if (this._origOnRequestBanner && Main.messageTray) {
            Main.messageTray._onNotificationRequestBanner = this._origOnRequestBanner;
            this._origOnRequestBanner = null;
        }
        if (this._origAddSource && Main.messageTray) {
            Main.messageTray._addSource = this._origAddSource;
            this._origAddSource = null;
        }

        // Restore source connections
        for (const source of Main.messageTray.getSources()) {
            source.disconnectObject(this);
            delete source._macBannerHooked;
            source.disconnectObject(Main.messageTray);
            source.connectObject(
                'notification-request-banner', Main.messageTray._onNotificationRequestBanner.bind(Main.messageTray),
                'notification-removed', Main.messageTray._onNotificationRemoved.bind(Main.messageTray),
                'destroy', () => Main.messageTray._removeSource(source),
                Main.messageTray
            );
        }

        // Dismiss all active banners immediately
        for (const b of [...this._activeBanners]) {
            this._pauseTimer(b);
            b.banner.destroy();
        }
        this._activeBanners = [];
        this._pendingQueue = [];

        // Remove stack box
        if (this._stackBox) {
            Main.layoutManager.untrackChrome(this._stackBox);
            if (this._stackBox.get_parent() === Main.layoutManager.uiGroup)
                Main.layoutManager.uiGroup.remove_child(this._stackBox);
            this._stackBox = null;
        }

        // Remove glass
        if (this._bannerStageLoopId) {
            try { global.stage.disconnect(this._bannerStageLoopId); } catch (_) {}
            this._bannerStageLoopId = 0;
        }
        if (this._glass) {
            this._glass.cleanup();
            if (this._glass.get_parent()) {
                this._glass.get_parent().remove_child(this._glass);
            }
            this._glass.destroy();
            this._glass = null;
        }

        this.connections.disconnect_all();
    }
};
