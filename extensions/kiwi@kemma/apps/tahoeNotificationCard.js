// SPDX-License-Identifier: GPL-3.0-or-later
// Конструктор картки сповіщення macOS Tahoe (kiwi@kemma).
// ВЕРСІЯ v4: у режимі переробки UI сповіщень залишено ТІЛЬКИ картку —
// MacNotificationGroup і NotificationsController видалено (стеки банерів
// та старий контролер перероблятимуться заново).
// Центр повідомлень використовує buildNotificationCard.

import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';


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


// ── Новий вигляд повідомлень (адаптовано з MacShell / MacBar.qml NotifBody) ──
// Розкладка: іконка-тайл 44×44 (radius 10), текстова колона, правий рейл
// з відносним часом («тільки що», «5 хв тому») або круглою кнопкою ✕ при наведенні.
export function formatRelativeNotifAge(datetime) {
    const now = GLib.DateTime.new_now_local();
    let dt = datetime;
    if (!dt)
        dt = now;
    const diffSec = Math.max(0, now.to_unix() - dt.to_unix());
    const min = Math.floor(diffSec / 60);
    if (min < 1)
        return 'тільки що';
    if (min < 60)
        return `${min} хв тому`;
    const h = Math.floor(min / 60);
    if (h < 24)
        return `${h} год тому`;
    const d = Math.floor(h / 24);
    if (d < 7)
        return `${d} дн тому`;
    return formatNotificationTimestamp(dt);
}

export function buildNotificationCard(source, notification, options = {}) {
    const {
        width = 440,
        onClose = null,
        onClick = null,
    } = options;

    // Канонічні стилі картки: темний матовий акрил, radius 16 (наш дизайн-канон)
    const CARD_BASE_STYLE = 'background-color: rgba(45, 45, 47, 0.76) !important; border: 1px solid rgba(255, 255, 255, 0.12) !important; border-radius: 16px !important; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35) !important;';
    const CARD_HOVER_STYLE = 'background-color: rgba(56, 56, 58, 0.84) !important; border: 1px solid rgba(255, 255, 255, 0.18) !important; border-radius: 16px !important; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.42) !important;';
    // Пілюля → картка (морф банерів)
    const CARD_PILL_STYLE = CARD_BASE_STYLE.replace('border-radius: 16px !important;', 'border-radius: 9999px !important;');
    const CARD_MID_STYLE = CARD_BASE_STYLE.replace('border-radius: 16px !important;', 'border-radius: 22px !important;');

    const banner = new St.Button({
        style_class: 'mac-notification-banner',
        can_focus: true,
        reactive: true,
        track_hover: true,
        x_expand: false,
        y_expand: false,
        clip_to_allocation: true,
    });
    banner.set_style(CARD_BASE_STYLE);
    if (width) {
        try { banner.set_width(width); } catch (_) {}
    }

    // Головна розкладка в стилі macOS: [іконка 44×44] [тексти] [правий рейл]
    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style: 'padding: 13px 14px !important; spacing: 12px !important;',
    });
    banner.set_child(mainBox);

    // 1. Тайл іконки 44×44, заокруглення 10 (новий вигляд MacShell)
    const gicon = notification.gicon || source?.icon || source?.app?.get_app_info()?.get_icon() || null;
    const iconBin = new St.Bin({
        style_class: 'mac-notification-icon-bin',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
        clip_to_allocation: true,
        style: 'width: 44px !important; height: 44px !important; border-radius: 10px !important; background-color: rgba(255, 255, 255, 0.12) !important; margin-top: 2px !important;',
    });
    const iconParams = {
        icon_size: 44,
        style_class: 'mac-notification-app-icon',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    };
    if (gicon) {
        iconParams.gicon = gicon;
    } else {
        iconParams.icon_name = 'dialog-information-symbolic';
    }
    const icon = new St.Icon(iconParams);
    iconBin.set_child(icon);
    mainBox.add_child(iconBin);

    // 2. Колона текстів
    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
        style_class: 'mac-notification-content-box',
        style: 'spacing: 2px !important;',
    });
    mainBox.add_child(contentBox);

    // Рядок заголовка: [Ім'я програми / ТЕРМІНОВО] [Лічильник стопки]
    const appHeaderBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    contentBox.add_child(appHeaderBox);

    const isUrgent = (notification.urgency === 2); // MessageTray.Urgency.CRITICAL

    const appLabel = new St.Label({
        text: isUrgent ? 'ТЕРМІНОВО' : (source?.title || 'Повідомлення'),
        style_class: isUrgent ? 'mac-notification-urgent' : 'mac-notification-app-name',
        y_align: Clutter.ActorAlign.CENTER,
    });
    appLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    appHeaderBox.add_child(appLabel);

    const countBadge = new St.Label({
        text: '',
        style_class: 'mac-notification-count-badge',
        style: 'color: rgba(255, 255, 255, 0.90); background-color: rgba(255, 255, 255, 0.20); font-size: 10px !important; font-weight: 600 !important; border-radius: 9999px !important; padding: 1px 6px !important; margin-left: 6px !important;',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    appHeaderBox.add_child(countBadge);

    // 3. Правий рейл: відносний час («тільки що», «5 хв тому») вгорі; при наведенні
    // на його місці — кругла кнопка закриття ✕ (22px), як у MacShell.
    const rightRail = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        y_align: Clutter.ActorAlign.START,
        x_align: Clutter.ActorAlign.END,
    });
    rightRail.set_width(76);
    mainBox.add_child(rightRail);

    const timeLabel = new St.Label({
        text: formatRelativeNotifAge(notification.datetime),
        style_class: 'mac-notification-time',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        style: 'color: rgba(255, 255, 255, 0.55) !important; font-size: 12px !important; margin-top: 3px !important;',
    });
    timeLabel.opacity = 255;
    timeLabel.visible = true;

    const extDir = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/blur-my-shell@aunetx`;
    const closeIconPath = `${extDir}/assets/close.png`;
    const closeHoverIconPath = `${extDir}/assets/close-button-hover.png`;
    const giconNormal = Gio.icon_new_for_string(closeIconPath);
    const giconHover = Gio.icon_new_for_string(closeHoverIconPath);
    let closeIcon = new St.Icon({
        gicon: giconNormal,
        icon_size: 12,
    });
    const closeBtn = new St.Button({
        style_class: 'mac-notification-close-btn',
        child: closeIcon,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        reactive: true,
        can_focus: true,
        style: 'background-color: rgba(255, 255, 255, 0.14) !important; border: none !important; box-shadow: none !important; border-radius: 9999px !important; padding: 5px !important; width: 22px !important; height: 22px !important; margin-top: 1px !important;',
    });
    closeBtn.opacity = 0;
    closeBtn.visible = false;
    closeBtn.connect('notify::hover', () => {
        closeIcon.gicon = closeBtn.hover ? giconHover : giconNormal;
        try {
            closeBtn.set_style(closeBtn.hover
                ? 'background-color: rgba(255, 255, 255, 0.26) !important; border: none !important; border-radius: 9999px !important; padding: 5px !important; width: 22px !important; height: 22px !important; margin-top: 1px !important;'
                : 'background-color: rgba(255, 255, 255, 0.14) !important; border: none !important; border-radius: 9999px !important; padding: 5px !important; width: 22px !important; height: 22px !important; margin-top: 1px !important;');
        } catch (_) {}
    });
    rightRail.add_child(timeLabel);
    rightRail.add_child(closeBtn);

    // Заголовок (тільки якщо відрізняється від імені застосунку — як у macOS)
    const rawTitle = (notification.title || '').trim();
    const appName = (source?.title || '').trim();
    const isDuplicateTitle = rawTitle.toLowerCase() === appName.toLowerCase();
    const titleLabel = new St.Label({
        style_class: 'mac-notification-title',
        x_expand: true,
    });
    if (rawTitle && !isDuplicateTitle) {
        setLabelMarkup(titleLabel, rawTitle);
        titleLabel.clutter_text.line_wrap = true;
        titleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        titleLabel.visible = true;
        contentBox.add_child(titleLabel);
    } else {
        titleLabel.visible = false;
    }

    // Тіло: багаторядкове перенесення, ніколи не обрізається трикрапкою (канон!)
    const bodyText = notification.bannerBodyText || notification.body || '';
    const bodyLabel = new St.Label({
        style_class: 'mac-notification-body',
        x_expand: true,
    });
    setLabelMarkup(bodyLabel, bodyText);
    bodyLabel.clutter_text.single_line_mode = false;
    bodyLabel.clutter_text.line_wrap = true;
    bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    contentBox.add_child(bodyLabel);

    // 4. Кнопки дій (внизу праворуч від тексту) — канонічні капсули 7px
    let actionsBox = null;
    if (notification.actions && notification.actions.length > 0) {
        actionsBox = new St.BoxLayout({
            style_class: 'mac-notification-actions-box',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-top: 7px !important; margin-bottom: 2px !important; spacing: 8px !important;',
            visible: true,
            opacity: 255,
        });
        for (const action of notification.actions) {
            const actBtn = new St.Button({
                style_class: 'mac-notification-action-btn',
                label: action.label,
                reactive: true,
                can_focus: true,
                style: 'background-color: rgba(255, 255, 255, 0.16) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; border-radius: 7px !important; padding: 4px 12px !important; font-size: 11.5px !important; font-weight: 500 !important; margin-left: 6px;',
            });
            actBtn.connect('notify::hover', () => {
                actBtn.set_style(actBtn.hover
                    ? 'background-color: rgba(255, 255, 255, 0.26) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.20) !important; border-radius: 7px !important; padding: 4px 12px !important; font-size: 11.5px !important; font-weight: 500 !important; margin-left: 6px;'
                    : 'background-color: rgba(255, 255, 255, 0.16) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; border-radius: 7px !important; padding: 4px 12px !important; font-size: 11.5px !important; font-weight: 500 !important; margin-left: 6px;');
            });
            actBtn.connect('clicked', () => {
                try { action.activate(); } catch (e) { logError(e); }
                if (onClose) onClose(cardData);
            });
            actionsBox.add_child(actBtn);
        }
        contentBox.add_child(actionsBox);
    }

    // Живе оновлення відносного часу кожні 30с
    let agoTimerId = 0;
    const updateAgo = () => {
        try {
            timeLabel.set_text(formatRelativeNotifAge(notification.datetime));
        } catch (_) {}
    };
    updateAgo();
    agoTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
        updateAgo();
        return GLib.SOURCE_CONTINUE;
    });

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
        content: mainBox,
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

    // При наведенні час м'яко поступається місцем кнопці закриття (канон) — 150мс
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
        if (agoTimerId) {
            try { GLib.Source.remove(agoTimerId); } catch (_) {}
            agoTimerId = 0;
        }
    });

    // Внутрішні стилі для споживачів (пілюля → картка морф у tahoeNotifications)
    cardData.baseStyle = CARD_BASE_STYLE;
    cardData.hoverStyle = CARD_HOVER_STYLE;
    cardData.pillStyle = CARD_PILL_STYLE;
    cardData.midStyle = CARD_MID_STYLE;

    cardData.updateExpansion = () => {};
    cardData.updateHoverState = updateHoverState;
    cardData.refreshAgo = updateAgo;
    banner._updateExpansion = cardData.updateExpansion;
    banner._updateHoverState = updateHoverState;

    return cardData;
}
