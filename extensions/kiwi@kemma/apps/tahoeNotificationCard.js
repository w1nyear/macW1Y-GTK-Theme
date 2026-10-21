// SPDX-License-Identifier: GPL-3.0-or-later
// Конструктор картки сповіщення macOS Tahoe (kiwi@kemma).
// ВЕРСІЯ v4: у режимі переробки UI сповіщень залишено ТІЛЬКИ картку —
// MacNotificationGroup і NotificationsController видалено (стеки банерів
// та старий контролер перероблятимуться заново).
// Центр повідомлень використовує buildNotificationCard.

import St from 'gi://St';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
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

// Відносний час у тост-каноні: «Щойно», «5 хв тому», «3 год тому»,
// для старіших - дата/час як у Центрі.
export function formatToastAge(datetime) {
    try {
        const now = GLib.DateTime.new_now_local();
        let dt = datetime;
        if (!dt) {
            dt = now;
        } else if (typeof dt.to_local === 'function') {
            dt = dt.to_local();
        }
        const sec = Math.max(0, now.to_unix() - dt.to_unix());
        if (sec < 60)
            return 'Щойно';
        const min = Math.floor(sec / 60);
        if (min < 60)
            return `${min} хв тому`;
        const hr = Math.floor(min / 60);
        if (hr < 24)
            return `${hr} год тому`;
        if (hr < 48)
            return `Вчора, ${dt.format('%H:%M')}`;
        return formatNotificationTimestamp(dt);
    } catch (_) {
        return 'Щойно';
    }
}

export function buildNotificationCard(source, notification, options = {}) {
    const {
        width = 440,
        onClose = null,
        onClick = null,
    } = options;

    // Канон нового вигляду = тости v5 (етапи 2.2-2.4): картка ПРОЗОРА,
    // під нею власна плитка скла (стек 'nc-cards', ті самі параметри
    // віджет-конфігу, що в тостів); білий текст; іконка того, хто
    // надіслав; час -> ✕ крос-фейд при наведенні.
    const CARD_BASE_STYLE = 'background-color: rgba(0, 0, 0, 0) !important; border: none !important; border-radius: 24px !important; box-shadow: none !important; padding: 0 !important;';
    const CARD_HOVER_STYLE = CARD_BASE_STYLE;
    // Пілюля → картка (морф банерів): стілі сумісні зі старим API
    const CARD_PILL_STYLE = CARD_BASE_STYLE.replace('border-radius: 24px !important;', 'border-radius: 9999px !important;');
    const CARD_MID_STYLE = CARD_BASE_STYLE.replace('border-radius: 24px !important;', 'border-radius: 22px !important;');
    const CLOSE_BASE = 'width: 22px !important; height: 22px !important; border-radius: 11px !important; background-color: rgba(255, 255, 255, 0.14) !important; border: none !important; box-shadow: none !important; padding: 0 !important;';
    const CLOSE_HOVER = CLOSE_BASE.replace('0.14', '0.26');

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

    // Головна розкладка тоста: [іконка 44×44] [тексти], паддінг 14/14/16
    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style: 'padding: 16px 14px 18px 14px !important; border-radius: 24px !important;',
    });
    banner.set_child(mainBox);

    // 1. Іконка ХТО надіслав: gicon повідомлення -> source.icon ->
    //    додаток джерела -> AppSystem (lookup <title>.desktop + скан по
    //    get_installed) -> createIcon джерела. Без іконки - нейтральна
    //    темна плитка (не акцентно-синя), як у тостів.
    let gicon = null;
    try { gicon = notification.gicon ?? null; } catch (_) {}
    try { if (!gicon) gicon = source?.icon ?? null; } catch (_) {}
    try { if (!gicon) gicon = source?.app?.get_icon?.() ?? null; } catch (_) {}
    try {
        if (!gicon) {
            const name = String(source?.title ?? '').trim();
            if (name && Shell.AppSystem) {
                const appSys = Shell.AppSystem.get_default();
                let app = appSys.lookup_app(`${name}.desktop`)
                    ?? appSys.lookup_app(`${name.toLowerCase()}.desktop`);
                if (!app) {
                    const lower = name.toLowerCase();
                    for (const cand of appSys.get_installed?.() ?? []) {
                        try {
                            const nm = String(cand.get_name() ?? '').toLowerCase();
                            const id = String(cand.get_id() ?? '').toLowerCase();
                            if (nm === lower || id.startsWith(`${lower}.`)) {
                                app = cand;
                                break;
                            }
                        } catch (_) {}
                    }
                }
                gicon = app?.get_app_info?.()?.get_icon?.()
                    ?? app?.get_icon?.() ?? null;
            }
        }
    } catch (_) {}
    if (!gicon) {
        try { gicon = source?.createIcon?.(44) ?? null; } catch (_) {}
    }
    const iconTile = new St.Widget({
        width: 44,
        height: 44,
        y_align: Clutter.ActorAlign.START,
        style: gicon ? 'border-radius: 10px !important;'
                     : 'background-color: rgba(28, 30, 36, 0.62) !important; border-radius: 10px !important;',
        layout_manager: new Clutter.BinLayout(),
    });
    try { iconTile.set_clip_to_allocation(true); } catch (_) {}
    iconTile.add_child(gicon
        ? new St.Icon({gicon, icon_size: 44})
        : new St.Icon({
            icon_name: 'org.gnome.Settings-notifications-symbolic',
            icon_size: 22,
            style: 'color: #ffffff !important;',
        }));
    try { iconTile.style += 'margin-right: 12px;'; } catch (_) {}
    mainBox.add_child(iconTile);

    // 2. Текст-колонка (тост-канон, spacing 4)
    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
        style: 'spacing: 4px !important;',
    });
    mainBox.add_child(contentBox);

    // GNOME 50: критичні мають urgency=3 (>=2 - HIGH і вище)
    const isCritical = (notification.urgency ?? 1) >= 2;
    const appName = String(source?.title ?? '').trim();

    // Рядок A: ТЕРМІНОВО (червоним) або ім'я застосунку (напівпрозорий білий)
    const appLabel = new St.Label({
        text: isCritical ? '⚠ ТЕРМІНОВО' : (appName || 'Повідомлення'),
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: isCritical
            ? 'color: #ff453a !important; font-size: 13px !important; font-weight: 700 !important;'
            : 'color: rgba(255, 255, 255, 0.60) !important; font-size: 12px !important; font-weight: 600 !important;',
    });
    try { appLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}
    contentBox.add_child(appLabel);

    // Заголовок (тільки якщо відрізняється від імені застосунку)
    const rawTitle = (notification.title || '').trim();
    const isDuplicateTitle = rawTitle.toLowerCase() === appName.toLowerCase();
    let titleLabel = null;
    if (rawTitle && !isDuplicateTitle) {
        titleLabel = new St.Label({
            x_expand: true,
            style: 'color: #ffffff !important; font-size: 14px !important; font-weight: 700 !important;',
        });
        setLabelMarkup(titleLabel, rawTitle);
        try { titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}
        contentBox.add_child(titleLabel);
    }

    // Тіло: перенесення рядків, трикрапкою НІКОЛИ (канон Центру)
    // body (повний) перший: GNOME-трімає bannerBodyText підрізаним
    const bodyText = notification.body || notification.bannerBodyText || '';
    let bodyLabel = null;
    if (bodyText) {
        bodyLabel = new St.Label({
            x_expand: true,
            style: 'color: #ffffff !important; font-size: 13px !important; font-weight: 500 !important;',
        });
        setLabelMarkup(bodyLabel, bodyText);
        bodyLabel.clutter_text.single_line_mode = false;
        bodyLabel.clutter_text.line_wrap = true;
        bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        contentBox.add_child(bodyLabel);
    }

    // 3. Кнопки дій — ті самі нейтральні капсули (працюють і на склі)
    let actionsBox = null;
    if (notification.actions && notification.actions.length > 0) {
        actionsBox = new St.BoxLayout({
            style_class: 'mac-notification-actions-box',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-top: 7px !important; margin-bottom: 2px !important; spacing: 8px !important;',
        });
        for (const action of notification.actions) {
            const actBtn = new St.Button({
                style_class: 'mac-notification-action-btn',
                label: action.label,
                reactive: true,
                can_focus: true,
                style: 'background-color: rgba(255, 255, 255, 0.16) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; border-radius: 7px !important; padding: 4px 12px !important; font-size: 11.5px !important; font-weight: 500 !important; margin-left: 6px !important;',
            });
            actBtn.connect('notify::hover', () => {
                actBtn.set_style(actBtn.hover
                    ? 'background-color: rgba(255, 255, 255, 0.26) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.20) !important; border-radius: 7px !important; padding: 4px 12px !important; font-size: 11.5px !important; font-weight: 500 !important; margin-left: 6px !important;'
                    : 'background-color: rgba(255, 255, 255, 0.16) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; border-radius: 7px !important; padding: 4px 12px !important; font-size: 11.5px !important; font-weight: 500 !important; margin-left: 6px !important;');
            });
            actBtn.connect('clicked', () => {
                try { action.activate(); } catch (e) { logError(e); }
                if (onClose) onClose(cardData);
            });
            actionsBox.add_child(actBtn);
        }
        contentBox.add_child(actionsBox);
    }

    // 4. ✕ 22×22 + час у правому рейлі (тост-стиль, гліф ✕, без PNG)
    const timeLabel = new St.Label({
        text: formatToastAge(notification.datetime),
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        style: 'color: rgba(255, 255, 255, 0.55) !important; font-size: 12px !important; font-weight: 500 !important; margin-top: 3px !important;',
    });
    try { timeLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}

    const closeBtn = new St.Button({
        opacity: 0,
        visible: false,
        reactive: false,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        style: CLOSE_BASE,
    });
    try {
        closeBtn.set_child(new St.Label({
            text: '✕',
            style: 'font-size: 11px; color: rgba(255, 255, 255, 0.85); font-weight: 600;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    } catch (_) {}
    closeBtn.connect('notify::hover', () => {
        try { closeBtn.set_style(closeBtn.hover ? CLOSE_HOVER : CLOSE_BASE); } catch (_) {}
    });

    const rightRail = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        y_align: Clutter.ActorAlign.START,
        x_align: Clutter.ActorAlign.END,
    });
    rightRail.set_width(76);
    rightRail.add_child(timeLabel);
    rightRail.add_child(closeBtn);
    mainBox.add_child(rightRail);

    // Заглушка cardData (для замикань нижче)
    const cardData = {
        banner,
        notification,
        source,
        closeBtn,
        timeLabel,
        titleLabel,
        bodyLabel,
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
            for (const b of actionsBox.get_children()) {
                if (b.hover) return true;
            }
        }
        return false;
    };

    // При наведенні час м'яко поступається кнопці закриття (150мс)
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

    // Живе оновлення відносного часу кожні 30с
    let agoTimerId = 0;
    const updateAgo = () => {
        try {
            timeLabel.set_text(formatToastAge(notification.datetime));
        } catch (_) {}
    };
    updateAgo();
    agoTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
        updateAgo();
        return GLib.SOURCE_CONTINUE;
    });

    banner.connect('destroy', () => {
        cardData.isClosing = true;
        if (agoTimerId) {
            try { GLib.Source.remove(agoTimerId); } catch (_) {}
            agoTimerId = 0;
        }
    });

    // Ремір висоти картки: перенесені рядки тіла St.BoxLayout меряє
    // БЕЗ переносу (natural width), тому перший лейаут нищий і другомий
    // рядок тіла обрізає клип банера. Міряю рядки напряму по ширині
    // текст-колонки (як у тостів: get_preferred_height(colW)) іuju
    // ставлю висоту банера явно.
    const measureCard = () => {
        try {
            if (!banner.get_parent())
                return;
            const colW = Math.max(80, Math.round((width ?? 484)) - 28 - 44 - 12 - 76);
            let total = 34; // паддінги 16+18
            let count = 0;
            for (const l of [appLabel, titleLabel, bodyLabel]) {
                if (!l || !l.get_parent?.())
                    continue;
                try { l.ensure_style?.(); } catch (_) {}
                try { l.clutter_text?.layout?.set_text(l.clutter_text.get_text()); } catch (_) {}
                const [, hh] = l.get_preferred_height(colW);
                if (isFinite(hh) && hh > 0) {
                    total += hh;
                    count++;
                }
            }
            if (!count)
                return;
            if (actionsBox?.visible) {
                total += 7 + 24;
            }
            total += 4 * Math.max(0, count - 1);
            const target = Math.max(72, Math.ceil(total));
            if (Math.abs(target - banner.height) > 1) {
                try { banner.set_height(target); } catch (_) {}
            }
        } catch (_) {}
    };
    for (const d of [80, 200, 400]) {
        try {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, d, () => {
                try { measureCard(); } catch (_) {}
                return GLib.SOURCE_REMOVE;
            });
        } catch (_) {}
    }

    // Внутрішні стілі для споживачів (пілюля → картка морф у tahoeNotifications)
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
