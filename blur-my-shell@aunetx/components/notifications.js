import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
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

/**
 * Sanitizes and converts markdown and HTML tags into valid Pango markup.
 * Properly decodes HTML entities, strips orphan/malformed tags (like </b>),
 * balances open/close tags, and ensures formatting characters are never leaked into notification text.
 */
export function safePangoMarkup(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.replace(/\r\n/g, '\n');

    // 1. Unescape HTML tags if entity-encoded (e.g. &lt;b&gt; or &lt;/b&gt; from Telegram/Discord/browsers)
    text = text.replace(/&lt;(\/?[a-zA-Z0-9]+(?:\s+[^&>]*)?)&gt;/gi, '<$1>');
    text = text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");

    // 2. Normalize <br> and <p>
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<p\b[^>]*>/gi, '').replace(/<\/p>/gi, '\n');

    // 3. Convert rich-text HTML tags to valid Pango tags
    text = text.replace(/<strong\b[^>]*>(.*?)<\/strong>/gi, '<b>$1</b>');
    text = text.replace(/<em\b[^>]*>(.*?)<\/em>/gi, '<i>$1</i>');
    text = text.replace(/<code\b[^>]*>(.*?)<\/code>/gi, '<tt>$1</tt>');
    text = text.replace(/<pre\b[^>]*>(.*?)<\/pre>/gi, '<tt>$1</tt>');
    text = text.replace(/<strike\b[^>]*>(.*?)<\/strike>/gi, '<s>$1</s>');
    text = text.replace(/<del\b[^>]*>(.*?)<\/del>/gi, '<s>$1</s>');
    text = text.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '<u>$1</u>');

    // 4. Markdown conversions:
    // **bold** or __bold__
    text = text.replace(/(\*\*|__)(.*?)\1/g, '<b>$2</b>');
    // ~~strikethrough~~
    text = text.replace(/(~~)(.*?)\1/g, '<s>$2</s>');
    // `inline code`
    text = text.replace(/`([^`]+)`/g, '<tt>$1</tt>');
    // *italic* or _italic_ (not inside word identifiers)
    text = text.replace(/(^|[^\w])(\*|_)([^\*_]+?)\2([^\w]|$)/g, '$1<i>$3</i>$4');

    // 5. Remove any remaining unsupported HTML tags, keeping only allowed pango tags
    text = text.replace(/<\/?(?!b\b|i\b|u\b|s\b|tt\b|span\b|sub\b|sup\b|big\b|small\b)[a-zA-Z0-9_-]+(?:\s+[^>]*)?>/gi, '');

    // 6. Balance allowed tags and strip orphan closing tags (e.g. </b> without <b>)
    const allowedTags = ['b', 'i', 'u', 's', 'tt', 'span', 'sub', 'sup', 'big', 'small'];
    for (const tag of allowedTags) {
        const openMatches = text.match(new RegExp('<' + tag + '(?:\\s+[^>]*)?>', 'gi')) || [];
        const closeMatches = text.match(new RegExp('<\/' + tag + '>', 'gi')) || [];
        const openCount = openMatches.length;
        const closeCount = closeMatches.length;

        if (closeCount > openCount) {
            let excess = closeCount - openCount;
            text = text.replace(new RegExp('<\/' + tag + '>', 'gi'), (match) => {
                if (excess > 0) {
                    excess--;
                    return '';
                }
                return match;
            });
        } else if (openCount > closeCount) {
            const deficit = openCount - closeCount;
            for (let d = 0; d < deficit; d++) {
                text += '</' + tag + '>';
            }
        }
    }

    // 7. Escape stray & that is not an existing XML entity
    text = text.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');

    try {
        Pango.parse_markup(text, -1, '');
        return text;
    } catch (e) {
        // Fallback: completely strip tags, entity-tags, and markdown markers so formatting tokens never leak to user
        let stripped = rawText
            .replace(/&lt;(\/?[a-zA-Z0-9_-]+(?:\s+[^&>]*)?)&gt;/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/(\*\*|__|\*|_|~~|`)/g, '');
        return GLib.markup_escape_text(stripped, -1);
    }
}

export function setLabelMarkup(label, rawText) {
    if (!label || !label.clutter_text) return;
    try {
        const markup = safePangoMarkup(rawText);
        label.clutter_text.use_markup = true;
        label.clutter_text.set_markup(markup);
    } catch (_) {
        label.clutter_text.use_markup = false;
        let clean = (rawText || '')
            .replace(/&lt;(\/?[a-zA-Z0-9_-]+(?:\s+[^&>]*)?)&gt;/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/(\*\*|__|\*|_|~~|`)/g, '');
        label.clutter_text.set_text(clean);
    }
}

/**
 * Formats notification timestamp:
 * - Today: HH:mm (e.g. "14:31")
 * - Yesterday: "Вчора, 14:31"
 * - Older (same year): "16.10, 14:31"
 * - Older (previous year): "16.10.2025, 14:31"
 */
export function formatNotificationTimestamp(datetime) {
    let dt = datetime;
    if (!dt) {
        dt = GLib.DateTime.new_now_local();
    } else if (typeof dt.to_local === 'function') {
        dt = dt.to_local();
    }

    const now = GLib.DateTime.new_now_local();
    const today = GLib.DateTime.new_local(now.get_year(), now.get_month(), now.get_day_of_month(), 0, 0, 0);
    const notifDay = GLib.DateTime.new_local(dt.get_year(), dt.get_month(), dt.get_day_of_month(), 0, 0, 0);

    const diffSeconds = today.to_unix() - notifDay.to_unix();
    const diffDays = Math.round(diffSeconds / 86400);

    const timeStr = dt.format('%H:%M');

    if (diffDays <= 0) {
        return timeStr;
    } else if (diffDays === 1) {
        return `Вчора, ${timeStr}`;
    } else if (dt.get_year() === now.get_year()) {
        return `${dt.format('%d.%m')}, ${timeStr}`;
    } else {
        return `${dt.format('%d.%m.%Y')}, ${timeStr}`;
    }
}


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

    // Top Row: [ Icon ] [ Texts ] [ TopRightArea: TimeLabel / CloseButton ]
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

    // App Header: App Name + Count Badge (for grouped stacks)
    const appHeaderBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    contentBox.add_child(appHeaderBox);

    const appLabel = new St.Label({
        text: source?.title || 'Notification',
        style_class: 'mac-notification-app-name',
        y_align: Clutter.ActorAlign.CENTER,
    });
    appHeaderBox.add_child(appLabel);

    const countBadge = new St.Label({
        text: '',
        style_class: 'mac-notification-count-badge',
        style: 'color: rgba(255, 255, 255, 0.75); background-color: rgba(255, 255, 255, 0.16); font-size: 10px; font-weight: 600; border-radius: 9999px; padding: 1px 7px; margin-left: 6px;',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    appHeaderBox.add_child(countBadge);

    // Title
    const titleLabel = new St.Label({
        style_class: 'mac-notification-title',
    });
    setLabelMarkup(titleLabel, notification.title || '');
    contentBox.add_child(titleLabel);

    // Body
    const bodyText = notification.bannerBodyText || notification.body || '';
    const bodyLabel = new St.Label({
        style_class: 'mac-notification-body',
    });
    setLabelMarkup(bodyLabel, bodyText);
    bodyLabel.clutter_text.line_wrap = false;
    bodyLabel.clutter_text.ellipsize = 3; // END
    contentBox.add_child(bodyLabel);

    // 3. Top-Right Bin (Time + Close button)
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
    closeBtn.opacity = 0;
    closeBtn.visible = false;
    closeBtn.connect('notify::hover', () => {
        closeIcon.gicon = closeBtn.hover ? giconHover : giconNormal;
    });

    const timeLabel = new St.Label({
        text: formatNotificationTimestamp(notification.datetime),
        style_class: 'mac-notification-time',
        y_align: Clutter.ActorAlign.START,
        x_align: Clutter.ActorAlign.END,
        style: 'color: rgba(255, 255, 255, 0.45); font-size: 11px; margin-top: 1px; margin-right: 2px;',
    });
    timeLabel.opacity = 255;
    timeLabel.visible = true;

    const topRightBin = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        y_align: Clutter.ActorAlign.START,
        x_align: Clutter.ActorAlign.END,
    });
    topRightBin.add_child(timeLabel);
    topRightBin.add_child(closeBtn);
    topRow.add_child(topRightBin);

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
        timeLabel,
        titleLabel,
        bodyLabel,
        countBadge,
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
        timeLabel.remove_all_transitions();

        if (hovered) {
            closeBtn.visible = true;
            closeBtn.ease({
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            timeLabel.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (isCardHovered()) timeLabel.visible = false;
                },
            });
        } else {
            timeLabel.visible = true;
            timeLabel.ease({
                opacity: 255,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
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

/**
 * MacNotificationGroup:
 * Manages multiple notifications belonging to the same application or conversation.
 * In collapsed state: shows top card with macOS layered card stack underneath.
 * On click: cascades downwards to show all notifications with smooth staggered animation.
 */
export class MacNotificationGroup {
    constructor(groupKey, options = {}) {
        this.groupKey = groupKey;
        this.options = options;
        this.isExpanded = false;
        this.items = []; // [{ source, notification, cardData, banner }] newest first
        this.isClosing = false;
        this.hovered = false;
        this.timeoutId = 0;

        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: false,
            clip_to_allocation: false,
            reactive: false,
        });
        this.actor._macGroup = this;
        this.actor.getGlassSubcards = () => this.getGlassSubcards();
        this.actor.getGlassRegions = (mon) => this.getGlassRegions(mon);

        // Top card container
        this.topCardBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            reactive: false,
        });
        this.actor.add_child(this.topCardBox);

        // Stack layers box (positioned right below the top card)
        this.stackLayersBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: false,
            visible: false,
            reactive: true,
            style: 'margin-top: -6px;',
        });
        this.actor.add_child(this.stackLayersBox);

        // Click to expand from stack layers
        const handleExpandClick = () => {
            if (!this.isExpanded && this.items.length > 1) {
                this.expand();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        };
        this.stackLayersBox.connect('button-press-event', handleExpandClick);

        // Layer 1 (immediately below top card)
        this.layer1 = new St.Widget({
            style: 'background-color: rgba(36, 36, 36, 0.70); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 20px; margin-left: 10px; margin-right: 10px; height: 10px;',
            x_expand: true,
            visible: false,
            reactive: true,
        });
        this.layer1.connect('button-press-event', handleExpandClick);
        this.stackLayersBox.add_child(this.layer1);

        // Layer 2 (bottom layer for 3+ items)
        this.layer2 = new St.Widget({
            style: 'background-color: rgba(26, 26, 26, 0.70); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 18px; margin-left: 20px; margin-right: 20px; height: 8px; margin-top: -4px;',
            x_expand: true,
            visible: false,
            reactive: true,
        });
        this.layer2.connect('button-press-event', handleExpandClick);
        this.stackLayersBox.add_child(this.layer2);

        // Expanded cards box
        this.expandedCardsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: false,
            style: 'spacing: 8px;',
            visible: false,
        });
        this.actor.add_child(this.expandedCardsBox);

        // Collapse button
        this.collapseBtn = new St.Button({
            style_class: 'mac-notification-collapse-btn',
            label: 'Згорнути',
            style: 'background-color: rgba(255, 255, 255, 0.14); color: rgba(255, 255, 255, 0.85); font-size: 11px; font-weight: 500; border-radius: 9999px; padding: 4px 18px; margin: 6px auto 2px auto; border: 1px solid rgba(255, 255, 255, 0.18);',
            x_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        this.collapseBtn.connect('notify::hover', () => {
            this.collapseBtn.set_style(this.collapseBtn.hover
                ? 'background-color: rgba(255, 255, 255, 0.24); color: #ffffff; font-size: 11px; font-weight: 500; border-radius: 9999px; padding: 4px 18px; margin: 6px auto 2px auto; border: 1px solid rgba(255, 255, 255, 0.30);'
                : 'background-color: rgba(255, 255, 255, 0.14); color: rgba(255, 255, 255, 0.85); font-size: 11px; font-weight: 500; border-radius: 9999px; padding: 4px 18px; margin: 6px auto 2px auto; border: 1px solid rgba(255, 255, 255, 0.18);');
        });
        this.collapseBtn.connect('clicked', () => {
            this.collapse();
        });
    }

    addNotification(source, notification, isPrepend = true) {
        const cardData = buildNotificationCard(source, notification, {
            sigma: this.options.sigma || 3,
            isBanner: this.options.isBanner ?? true,
            onClose: () => {
                this.removeNotification(notification, true);
            },
            onClick: () => {
                if (this.isExpanded) {
                    try { notification.activate(); } catch (e) { logError(e); }
                    this.removeNotification(notification, false);
                } else {
                    if (this.items.length > 1) {
                        this.expand();
                    } else {
                        try { notification.activate(); } catch (e) { logError(e); }
                        this.removeNotification(notification, false);
                    }
                }
            },
        });

        const item = { source, notification, cardData, banner: cardData.banner };

        if (isPrepend) {
            this.items.unshift(item);
        } else {
            this.items.push(item);
        }

        notification.connectObject('destroy', () => {
            this.removeNotification(notification, false);
        }, cardData.banner);

        this._updateView();
        return item;
    }

    removeNotification(notification, userDismissed = false) {
        const idx = this.items.findIndex(it => it.notification === notification);
        if (idx === -1) return;

        const [removed] = this.items.splice(idx, 1);

        try {
            if (removed?.banner) {
                removed.banner.remove_all_transitions();
                const parent = removed.banner.get_parent();
                if (parent) parent.remove_child(removed.banner);
                removed.banner.destroy();
            }
        } catch (_) {}

        try {
            if (userDismissed) {
                notification.destroy(2); // DISMISSED
            } else if (notification.isTransient) {
                notification.destroy(1); // EXPIRED
            }
        } catch (_) {}

        if (this.items.length === 0) {
            this.destroy();
            if (this.options.onEmpty) this.options.onEmpty(this);
        } else {
            if (this.isExpanded && this.items.length === 1) {
                this.collapse();
            } else {
                this._updateView();
            }
        }
    }

    _updateView() {
        if (this.items.length === 0) {
            if (this.options.onEmpty) this.options.onEmpty(this);
            return;
        }

        if (this.isExpanded) {
            this._renderExpanded();
        } else {
            this._renderCollapsed();
        }
    }

    _renderCollapsed() {
        this.expandedCardsBox.visible = false;
        this.expandedCardsBox.remove_all_children();

        this.topCardBox.visible = true;
        this.topCardBox.remove_all_children();

        const topItem = this.items[0];
        if (topItem) {
            this.topCardBox.add_child(topItem.banner);
            topItem.banner.visible = true;
            topItem.banner.opacity = 255;
            topItem.banner.translation_y = 0;
            topItem.banner.scale_x = 1.0;
            topItem.banner.scale_y = 1.0;

            if (topItem.cardData?.countBadge) {
                if (this.items.length > 1) {
                    topItem.cardData.countBadge.text = `${this.items.length}`;
                    topItem.cardData.countBadge.visible = true;
                } else {
                    topItem.cardData.countBadge.visible = false;
                }
            }
        }

        if (this.items.length >= 2) {
            this.stackLayersBox.visible = true;
            this.stackLayersBox.opacity = 255;
            this.layer1.visible = true;
            this.layer2.visible = (this.items.length >= 3);
        } else {
            this.stackLayersBox.visible = false;
            this.layer1.visible = false;
            this.layer2.visible = false;
        }

        if (this.options.onGeometryChanged) {
            this.options.onGeometryChanged();
        }
    }

    _renderExpanded() {
        this.topCardBox.visible = false;
        this.topCardBox.remove_all_children();
        this.stackLayersBox.visible = false;

        this.expandedCardsBox.visible = true;
        this.expandedCardsBox.remove_all_children();

        for (const item of this.items) {
            if (item.cardData?.countBadge) {
                item.cardData.countBadge.visible = false;
            }
            this.expandedCardsBox.add_child(item.banner);
            item.banner.visible = true;
            item.banner.opacity = 255;
            item.banner.translation_y = 0;
            item.banner.scale_x = 1.0;
            item.banner.scale_y = 1.0;
        }
        this.expandedCardsBox.add_child(this.collapseBtn);
        this.collapseBtn.visible = true;
        this.collapseBtn.opacity = 255;

        if (this.options.onGeometryChanged) {
            this.options.onGeometryChanged();
        }
    }

    expand() {
        if (this.isExpanded || this.items.length <= 1) return;
        this.isExpanded = true;

        this.stackLayersBox.ease({
            opacity: 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.stackLayersBox.visible = false;
            }
        });

        this.topCardBox.visible = false;
        this.topCardBox.remove_all_children();

        this.expandedCardsBox.visible = true;
        this.expandedCardsBox.remove_all_children();

        // Cascading waterfall entrance
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const banner = item.banner;
            if (item.cardData?.countBadge) {
                item.cardData.countBadge.visible = false;
            }
            this.expandedCardsBox.add_child(banner);
            banner.visible = true;

            banner.opacity = 0;
            banner.translation_y = -20 * (i + 1);
            banner.scale_x = 0.96;
            banner.scale_y = 0.96;

            banner.ease({
                opacity: 255,
                translation_y: 0,
                scale_x: 1.0,
                scale_y: 1.0,
                duration: 240 + i * 40,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    if (this.options.onGeometryChanged) this.options.onGeometryChanged();
                }
            });
        }

        this.collapseBtn.opacity = 0;
        this.expandedCardsBox.add_child(this.collapseBtn);
        this.collapseBtn.ease({
            opacity: 255,
            duration: 280,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        if (this.options.onExpand) this.options.onExpand(this);
        if (this.options.onGeometryChanged) this.options.onGeometryChanged();
    }

    collapse() {
        if (!this.isExpanded) return;
        this.isExpanded = false;

        const count = this.items.length;
        for (let i = 1; i < count; i++) {
            const item = this.items[i];
            item.banner.ease({
                opacity: 0,
                translation_y: -16 * i,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        }
        this.collapseBtn.ease({
            opacity: 0,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
            this._renderCollapsed();
            return GLib.SOURCE_REMOVE;
        });

        if (this.options.onCollapse) this.options.onCollapse(this);
        if (this.options.onGeometryChanged) this.options.onGeometryChanged();
    }

    getGlassSubcards() {
        if (!this.actor.visible || this.isClosing) return [];
        if (!this.isExpanded) {
            const top = this.items[0];
            return top && top.banner.visible ? [top.banner] : [];
        } else {
            return this.items.map(it => it.banner).filter(b => b.visible);
        }
    }

    getGlassRegions(monitor) {
        if (!this.actor.visible || this.isClosing) return [];
        const regions = [];

        if (!this.isExpanded) {
            const topItem = this.items[0];
            if (topItem && topItem.banner.visible) {
                const [absX, absY] = topItem.banner.get_transformed_position();
                const [w, h] = topItem.banner.get_transformed_size();
                if (w > 0 && h > 0 && Number.isFinite(absX) && Number.isFinite(absY) && Number.isFinite(w) && Number.isFinite(h)) {
                    const extraBottom = (this.items.length >= 3) ? 14 : (this.items.length >= 2 ? 8 : 0);
                    regions.push({
                        x: Math.round(absX - monitor.x),
                        y: Math.round(absY - monitor.y),
                        w: Math.max(1, Math.round(w)),
                        h: Math.max(1, Math.round(h + extraBottom)),
                        tintR: 0.0,
                        tintG: 0.0,
                        tintB: 0.0,
                        baseStrength: 0.06,
                    });
                }
            }
        } else {
            for (const item of this.items) {
                const b = item.banner;
                if (!b.visible) continue;
                const [absX, absY] = b.get_transformed_position();
                const [w, h] = b.get_transformed_size();
                if (w > 0 && h > 0 && Number.isFinite(absX) && Number.isFinite(absY) && Number.isFinite(w) && Number.isFinite(h)) {
                    regions.push({
                        x: Math.round(absX - monitor.x),
                        y: Math.round(absY - monitor.y),
                        w: Math.max(1, Math.round(w)),
                        h: Math.max(1, Math.round(h)),
                        tintR: 0.0,
                        tintG: 0.0,
                        tintB: 0.0,
                        baseStrength: 0.06,
                    });
                }
            }
        }
        return regions;
    }

    destroy() {
        this.isClosing = true;
        this.items.forEach(it => {
            try { it.notification.disconnectObject(it.banner); } catch (_) {}
            try {
                it.banner.remove_all_transitions();
                it.cardData?.closeBtn?.remove_all_transitions();
                it.cardData?.timeLabel?.remove_all_transitions();
                it.banner.destroy();
            } catch (_) {}
        });
        this.items = [];
        this.collapseBtn.remove_all_transitions();
        this.stackLayersBox.remove_all_transitions();
        this.actor.remove_all_transitions();
        this.actor.destroy();
    }
}

globalThis._MacNotificationGroup = MacNotificationGroup;

export const NotificationsController = class NotificationsController {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.enabled = false;
        this._stackBox = null;
        this._glass = null;
        this._activeGroups = new Map(); // groupKey -> MacNotificationGroup
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
            style: 'spacing: 12px;',
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
        const baseStrength = 0.03; // Exactly 3% as requested by user
        const tintStrength = 0.03; // Exactly 3% as requested by user
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
        if (!this.enabled || !this._activeGroups || this._activeGroups.size === 0) {
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

        for (const [key, group] of this._activeGroups) {
            if (!group.actor.visible) continue;
            const groupRegions = group.getGlassRegions(monitor);
            for (const r of groupRegions) {
                r.tintR = tintVal;
                r.tintG = tintVal;
                r.tintB = tintVal;
                r.baseStrength = baseStrength;
                regions.push(r);
            }
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
            if (!this._glass._backdropLocked) {
                this._glass.syncSources();
            }

            if (!this._bannerStageLoopId) {
                this._bannerStageLoopId = global.stage.connect('before-update', () => {
                    if (this._activeGroups && this._activeGroups.size > 0) {
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
            notification.acknowledged = true;
            if (notifCenter && typeof notifCenter.addNotificationQuiet === 'function') {
                notifCenter.addNotificationQuiet(source, notification);
            }
            return;
        }

        // If Notification Center is open, animate into Notification Center directly
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

        notification.acknowledged = true;
        try { notification.playSound(); } catch (_e) { /* ignore */ }

        // Grouping key: by application / source
        const groupKey = source?.id || source?.title || 'app';
        let group = this._activeGroups.get(groupKey);

        if (group) {
            // Group already active: add new notification to group
            group.addNotification(source, notification, true);
            this._startGroupTimer(group, DEFAULT_TIMEOUT_MS);
            this._syncGlass();
        } else {
            if (this._activeGroups.size < MAX_VISIBLE_BANNERS) {
                this._showNewGroup(source, notification, groupKey);
            } else {
                this._pendingQueue.push({ source, notification });
            }
        }
    }

    _showNewGroup(source, notification, groupKey) {
        const group = new MacNotificationGroup(groupKey, {
            sigma: this.sigma,
            isBanner: true,
            onGeometryChanged: () => this._syncGlass(),
            onExpand: (grp) => {
                this._pauseGroupTimer(grp);
                this._syncGlass();
            },
            onCollapse: (grp) => {
                this._startGroupTimer(grp, DEFAULT_TIMEOUT_MS);
                this._syncGlass();
            },
            onEmpty: (grp) => {
                this._dismissGroup(grp);
            },
        });

        group.addNotification(source, notification, true);
        this._activeGroups.set(groupKey, group);
        this._stackBox.add_child(group.actor);
        this._updateVisibility();

        if (this._glass) {
            this._glass._backdropLocked = false;
            if (typeof this._glass.forceRefresh === 'function') {
                this._glass.forceRefresh(1);
            }
            this._syncGlass();
            this._glass._backdropLocked = true;
        } else {
            this._syncGlass();
        }

        group.actor.opacity = 0;
        group.actor.translation_x = SLIDE_DISTANCE;
        group.actor.ease({
            opacity: 255,
            translation_x: 0,
            duration: ANIM_IN_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._syncGlass();
                if (this._glass) {
                    this._glass._backdropLocked = true;
                }
            },
        });

        if (notification.urgency !== 2) {
            this._startGroupTimer(group, DEFAULT_TIMEOUT_MS);
        }
    }

    _startGroupTimer(group, ms) {
        this._pauseGroupTimer(group);
        if (group.isExpanded) return;

        group.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            group.timeoutId = 0;
            this._dismissGroup(group);
            return GLib.SOURCE_REMOVE;
        });
    }

    _pauseGroupTimer(group) {
        if (group.timeoutId) {
            GLib.source_remove(group.timeoutId);
            group.timeoutId = 0;
        }
    }

    _dismissGroup(group) {
        if (!this._activeGroups.has(group.groupKey) || group.isClosing) return;
        group.isClosing = true;
        this._pauseGroupTimer(group);

        group.actor.remove_all_transitions();
        group.actor.ease({
            opacity: 0,
            translation_x: SLIDE_DISTANCE,
            duration: ANIM_OUT_DURATION,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                this._activeGroups.delete(group.groupKey);
                if (group.actor.get_parent() === this._stackBox) {
                    this._stackBox.remove_child(group.actor);
                }
                group.destroy();
                this._updateVisibility();
                this._checkPendingQueue();
            },
        });
    }

    _checkPendingQueue() {
        if (this._pendingQueue.length > 0 && this._activeGroups.size < MAX_VISIBLE_BANNERS) {
            const next = this._pendingQueue.shift();
            const groupKey = next.source?.id || next.source?.title || 'app';
            let existing = this._activeGroups.get(groupKey);
            if (existing) {
                existing.addNotification(next.source, next.notification, true);
            } else {
                this._showNewGroup(next.source, next.notification, groupKey);
            }
        }
    }

    _updateVisibility() {
        const hasBanners = this._activeGroups.size > 0;
        this._stackBox.visible = hasBanners;
        this._syncGlass();
    }

    getActiveBanners() {
        const all = [];
        for (const [k, group] of this._activeGroups) {
            for (const item of group.items) {
                all.push({ source: item.source, notification: item.notification, banner: item.banner });
            }
        }
        return all;
    }

    takeActiveBanners() {
        const all = this.getActiveBanners();
        for (const [k, group] of this._activeGroups) {
            this._pauseGroupTimer(group);
            if (group.actor.get_parent() === this._stackBox) {
                this._stackBox.remove_child(group.actor);
            }
            group.destroy();
        }
        this._activeGroups.clear();
        this._pendingQueue = [];
        this._updateVisibility();
        return all;
    }

    dismissAllBanners(immediate = false) {
        if (!this._activeGroups || this._activeGroups.size === 0)
            return;

        const groups = Array.from(this._activeGroups.values());
        this._activeGroups.clear();
        this._pendingQueue = [];

        for (const group of groups) {
            this._pauseGroupTimer(group);
            group.actor.remove_all_transitions();

            if (immediate) {
                if (group.actor.get_parent() === this._stackBox)
                    this._stackBox.remove_child(group.actor);
                group.destroy();
            } else {
                group.actor.ease({
                    opacity: 0,
                    translation_x: SLIDE_DISTANCE,
                    duration: 180,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                    onComplete: () => {
                        if (group.actor.get_parent() === this._stackBox)
                            this._stackBox.remove_child(group.actor);
                        group.destroy();
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
        globalThis._macNotificationsController = null;

        if (this._bannerStageLoopId) {
            try { global.stage.disconnect(this._bannerStageLoopId); } catch (_) {}
            this._bannerStageLoopId = 0;
        }

        if (this._origOnRequestBanner && Main.messageTray) {
            Main.messageTray._onNotificationRequestBanner = this._origOnRequestBanner;
            this._origOnRequestBanner = null;
        }

        if (this._origAddSource && Main.messageTray) {
            Main.messageTray._addSource = this._origAddSource;
            this._origAddSource = null;
        }

        for (const source of (Main.messageTray?.getSources() || [])) {
            if (source._macBannerHooked) {
                source._macBannerHooked = false;
                source.disconnectObject(this);
            }
        }

        this.dismissAllBanners(true);

        if (this._glass) {
            try {
                this._glass.hide();
                this._glass.destroy();
            } catch (_) {}
            this._glass = null;
        }

        if (this._stackBox) {
            Main.layoutManager.removeChrome(this._stackBox);
            this._stackBox.destroy();
            this._stackBox = null;
        }

        if (Main.messageTray?._bannerBin) {
            Main.messageTray._bannerBin.visible = true;
        }
    }
};
