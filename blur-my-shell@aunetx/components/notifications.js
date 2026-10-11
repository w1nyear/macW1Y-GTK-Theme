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

export const NotificationsController = class NotificationsController {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.enabled = false;
        this._stackBox = null;
        this._activeBanners = [];
        this._pendingQueue = [];
        this._origOnRequestBanner = null;
        this._origAddSource = null;
        this.sigma = 20;
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

        // Real-time sigma change listener
        if (this.settings?.notification?.settings) {
            this.connections.connect(
                this.settings.notification.settings,
                'changed::sigma',
                () => {
                    const s = this.settings.notification.SIGMA ?? 20;
                    this.sigma = s;
                    const theme_context = St.ThemeContext.get_for_stage(global.stage);
                    const scale = theme_context ? theme_context.scale_factor : 1;
                    const radius = Math.max(1, this.sigma * scale);
                    for (const b of this._activeBanners) {
                        try {
                            const eff = b.banner.get_effect('mac-notification-blur');
                            if (eff) eff.radius = radius;
                        } catch (_e) {}
                    }
                }
            );
        }
    }

    _hookSource(source) {
        if (!source || source._macBannerHooked) return;
        source._macBannerHooked = true;
    }

    _handleNotificationRequest(source, notification) {
        if (!this.enabled) {
            this._origOnRequestBanner(source, notification);
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
        const banner = new St.Button({
            style_class: 'mac-notification-banner',
            can_focus: true,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: false,
        });

        const mainBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
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
        bodyLabel.clutter_text.line_wrap = true;
        bodyLabel.clutter_text.ellipsize = 3; // END
        contentBox.add_child(bodyLabel);

        // 3. Close Button ('x')
        const closeIconPath = '/home/vitaliy/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/assets/close.png';
        const closeHoverIconPath = '/home/vitaliy/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/assets/close-button-hover.png';
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
        closeBtn.connect('notify::hover', () => {
            closeIcon.gicon = closeBtn.hover ? giconHover : giconNormal;
        });
        topRow.add_child(closeBtn);

        // 4. Action Buttons (if notification has actions)
        if (notification.actions && notification.actions.length > 0) {
            const actionsBox = new St.BoxLayout({
                style_class: 'mac-notification-actions-box',
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
            });
            for (const action of notification.actions) {
                const actBtn = new St.Button({
                    style_class: 'mac-notification-action-btn',
                    label: action.label,
                });
                actBtn.connect('clicked', () => {
                    try { action.activate(); } catch (e) { logError(e); }
                    this._dismissBanner(bannerData, false);
                });
                actionsBox.add_child(actBtn);
            }
            mainBox.add_child(actionsBox);
        }

        // Apply native liquid glass Blur with rounded corners
        if (BlurOrShell?.BlurEffect) {
            const theme_context = St.ThemeContext.get_for_stage(global.stage);
            const scale = theme_context ? theme_context.scale_factor : 1;
            const radius = Math.max(1, this.sigma * scale);

            const has_corner_radius = Boolean(
                BlurOrShell?.BlurEffect?.list_properties()
                    .some(property => property.name === 'corner-radius')
            );

            const params = {
                name: 'mac-notification-blur',
                radius: radius,
                mode: BlurOrShell.BlurMode.BACKGROUND,
            };
            if (has_corner_radius) {
                params.corner_radius = Math.round(18 * scale);
            }

            try {
                const blurEffect = new BlurOrShell.BlurEffect(params);
                banner.add_effect(blurEffect);
            } catch (err) {
                console.error(`[BlurMyShell] NotificationsController blur error: ${err}`);
            }
        }

        const bannerData = {
            banner,
            notification,
            source,
            closeBtn,
            titleLabel,
            bodyLabel,
            timeoutId: 0,
            hovered: false,
            isClosing: false,
        };

        // Click on close button: dismiss immediately
        const dismissBannerNow = () => {
            if (bannerData.isClosing)
                return Clutter.EVENT_STOP;
            bannerData.isClosing = true;
            this._dismissBanner(bannerData, true);
            return Clutter.EVENT_STOP;
        };
        closeBtn.connect('clicked', dismissBannerNow);
        closeBtn.connect('button-press-event', dismissBannerNow);

        // Click on banner body: activate app (only if not closing via 'x')
        banner.connect('clicked', () => {
            if (bannerData.isClosing)
                return;
            try { notification.activate(); } catch (e) { logError(e); }
            this._dismissBanner(bannerData, false);
        });

        // Hover handling (track hover on both banner and closeBtn)
        const updateHoverState = () => {
            if (bannerData.isClosing)
                return;
            const isHovered = banner.hover || closeBtn.hover;
            if (isHovered && !bannerData.hovered) {
                bannerData.hovered = true;
                closeBtn.ease({
                    opacity: 255,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                this._pauseTimer(bannerData);
            } else if (!isHovered && bannerData.hovered) {
                bannerData.hovered = false;
                closeBtn.ease({
                    opacity: 0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                this._startTimer(bannerData, HIDE_TIMEOUT_MS);
            }
        };

        banner.connect('notify::hover', updateHoverState);
        closeBtn.connect('notify::hover', updateHoverState);

        // Listen for notification destruction from elsewhere
        notification.connectObject('destroy', () => {
            this._dismissBanner(bannerData, false);
        }, banner);

        // Add to stack and active list
        this._activeBanners.push(bannerData);
        this._stackBox.add_child(banner);
        this._updateVisibility();

        // Slide in animation from beyond the right edge of the screen
        banner.opacity = 0;
        banner.translation_x = SLIDE_DISTANCE;
        banner.ease({
            opacity: 255,
            translation_x: 0,
            duration: ANIM_IN_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });

        // Start auto-hide timer (unless critical)
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
        if (idx === -1)
            return;

        this._activeBanners.splice(idx, 1);
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
    }

    disable() {
        if (!this.enabled)
            return;
        this.enabled = false;

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
            this._stackBox.destroy();
            this._stackBox = null;
        }

        this.connections.disconnect_all();
    }
};
