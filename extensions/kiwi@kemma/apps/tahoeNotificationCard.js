// SPDX-License-Identifier: GPL-3.0-or-later






import St from 'gi://St';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import { t, tf } from './mac_i18n.js';







export function safePangoMarkup(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.replace(/\r\n/g, '\n');


    text = text.replace(/&lt;(\/?[a-zA-Z0-9]+(?:\s+[^&>]*)?)&gt;/gi, '<$1>');
    text = text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");


    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<p\b[^>]*>/gi, '').replace(/<\/p>/gi, '\n');


    text = text.replace(/<strong\b[^>]*>(.*?)<\/strong>/gi, '<b>$1</b>');
    text = text.replace(/<em\b[^>]*>(.*?)<\/em>/gi, '<i>$1</i>');
    text = text.replace(/<code\b[^>]*>(.*?)<\/code>/gi, '<tt>$1</tt>');
    text = text.replace(/<pre\b[^>]*>(.*?)<\/pre>/gi, '<tt>$1</tt>');
    text = text.replace(/<strike\b[^>]*>(.*?)<\/strike>/gi, '<s>$1</s>');
    text = text.replace(/<del\b[^>]*>(.*?)<\/del>/gi, '<s>$1</s>');
    text = text.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '<u>$1</u>');



    text = text.replace(/(\*\*|__)(.*?)\1/g, '<b>$2</b>');

    text = text.replace(/(~~)(.*?)\1/g, '<s>$2</s>');

    text = text.replace(/`([^`]+)`/g, '<tt>$1</tt>');

    text = text.replace(/(^|[^\w])(\*|_)([^\*_]+?)\2([^\w]|$)/g, '$1<i>$3</i>$4');


    text = text.replace(/<\/?(?!b\b|i\b|u\b|s\b|tt\b|span\b|sub\b|sup\b|big\b|small\b)[a-zA-Z0-9_-]+(?:\s+[^>]*)?>/gi, '');


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


    text = text.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');

    try {
        Pango.parse_markup(text, -1, '');
        return text;
    } catch (e) {

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
        return tf('yesterday_time', { time: timeStr }, `Вчора, ${timeStr}`);
    } else if (dt.get_year() === now.get_year()) {
        return `${dt.format('%d.%m')}, ${timeStr}`;
    } else {
        return `${dt.format('%d.%m.%Y')}, ${timeStr}`;
    }
}





export function formatRelativeNotifAge(datetime) {
    const now = GLib.DateTime.new_now_local();
    let dt = datetime;
    if (!dt)
        dt = now;
    const diffSec = Math.max(0, now.to_unix() - dt.to_unix());
    const min = Math.floor(diffSec / 60);
    if (min < 1)
        return t('just_now', 'тільки що');
    if (min < 60)
        return tf('min_ago', { min }, `${min} хв тому`);
    const h = Math.floor(min / 60);
    if (h < 24)
        return tf('hour_ago', { hour: h }, `${h} год тому`);
    const d = Math.floor(h / 24);
    if (d < 7)
        return `${d} d`;
    return formatNotificationTimestamp(dt);
}



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
            return t('just_now', 'Щойно');
        const min = Math.floor(sec / 60);
        if (min < 60)
            return tf('min_ago', { min }, `${min} хв тому`);
        const hr = Math.floor(min / 60);
        if (hr < 24)
            return tf('hour_ago', { hour: hr }, `${hr} год тому`);
        if (hr < 48)
            return tf('yesterday_time', { time: dt.format('%H:%M') }, `Вчора, ${dt.format('%H:%M')}`);
        return formatNotificationTimestamp(dt);
    } catch (_) {
        return t('just_now', 'Щойно');
    }
}

export function buildNotificationCard(source, notification, options = {}) {
    const width = options.width || 440;
    const onClose = options.onClose || null;
    const onClick = options.onClick || null;




    const CARD_BASE_STYLE = (typeof globalThis._macGetNotifCardStyle === 'function')
        ? globalThis._macGetNotifCardStyle()
        : 'background-color: transparent !important; border: 1px solid rgba(255, 255, 255, 0.16) !important; border-radius: 24px !important; box-shadow: none !important; padding: 0 !important;';
    const CARD_HOVER_STYLE = CARD_BASE_STYLE;

    const CARD_PILL_STYLE = CARD_BASE_STYLE.replace(/border-radius:\s*[^;]+;/, 'border-radius: 9999px !important;');
    const CARD_MID_STYLE = CARD_BASE_STYLE.replace(/border-radius:\s*[^;]+;/, 'border-radius: 22px !important;');
    const CLOSE_BASE = 'width: 22px !important; height: 22px !important; border-radius: 11px !important; background-color: rgba(255, 255, 255, 0.18) !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25) !important; padding: 0 !important; margin: 0px !important;';
    const CLOSE_HOVER = CLOSE_BASE.replace('0.18', '0.28');

    const appName = String(source?.title ?? '').trim();
    const rawTitle = (notification.title || '').trim();
    const bodyText = notification.body || notification.bannerBodyText || '';
    const isScreenshot = /знім|screenshot|screen\s*capture/i.test(appName) ||
                         /знім|screenshot/i.test(rawTitle) ||
                         (source?.id && /screenshot/i.test(source.id));

    const banner = new St.Button({
        style_class: 'mac-notification-banner',
        can_focus: true,
        reactive: true,
        track_hover: true,
        x_expand: true,
        y_expand: false,
        clip_to_allocation: false,
        layout_manager: new Clutter.BinLayout(),
    });
    banner.set_style(isScreenshot
        ? (CARD_BASE_STYLE + ' min-height: 54px !important;')
        : CARD_BASE_STYLE);
    if (width) {
        try { banner.set_width(width); } catch (_) {}
    }


    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style: isScreenshot
            ? 'padding: 10px 10px !important; border-radius: 20px !important;'
            : 'padding: 14px 10px 16px 14px !important; border-radius: 24px !important;',
    });
    banner.set_child(mainBox);


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
    const iconSize = isScreenshot ? 38 : 44;
    const bannerWidth = width || 440;
    const padH = 28;
    const iconW = iconSize + 12;
    const railW = 76;
    const contentW = Math.max(120, bannerWidth - padH - iconW - railW);

    const iconTile = new St.Widget({
        width: iconSize,
        height: iconSize,
        y_align: Clutter.ActorAlign.CENTER,
        style: gicon ? 'border-radius: 9px !important;'
                     : 'background-color: rgba(28, 30, 36, 0.62) !important; border-radius: 9px !important;',
        layout_manager: new Clutter.BinLayout(),
    });
    try { iconTile.set_clip_to_allocation(true); } catch (_) {}
    iconTile.add_child(gicon
        ? new St.Icon({gicon, icon_size: iconSize})
        : new St.Icon({
            icon_name: isScreenshot ? 'camera-photo-symbolic' : 'org.gnome.Settings-notifications-symbolic',
            icon_size: Math.round(iconSize * 0.55),
            style: 'color: #ffffff !important;',
        }));
    try { iconTile.style += 'margin-right: 12px;'; } catch (_) {}
    mainBox.add_child(iconTile);


    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
        style: isScreenshot ? 'spacing: 2px !important;' : 'spacing: 4px !important;',
    });
    contentBox.set_width(contentW);
    contentBox.min_width = contentW;
    contentBox.max_width = contentW;
    mainBox.add_child(contentBox);


    const isCritical = (notification.urgency ?? 1) >= 2;

    let appLabel = null;
    let titleLabel = null;
    let bodyLabel = null;

    if (isScreenshot) {




        const shotApp = appName && !appName.includes('Захоплення') ? appName : 'Скріншот';
        appLabel = new St.Label({
            text: shotApp,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style: 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: #ffffff !important; font-size: 12.5px !important; font-weight: 700 !important;',
        });
        try { appLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}
        contentBox.add_child(appLabel);

        const shotTitle = rawTitle || t('screenshot_taken', 'Скріншот створено');
        titleLabel = new St.Label({
            x_expand: true,
            style: 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: rgba(255, 255, 255, 0.95) !important; font-size: 13.5px !important; font-weight: 400 !important;',
        });
        setLabelMarkup(titleLabel, shotTitle);
        try { titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}
        contentBox.add_child(titleLabel);

        if (bodyText) {
            bodyLabel = new St.Label({
                x_expand: true,
                style: 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: rgba(255, 255, 255, 0.78) !important; font-size: 12px !important; font-weight: 400 !important;',
            });
            setLabelMarkup(bodyLabel, bodyText);
            bodyLabel.clutter_text.single_line_mode = false;
            bodyLabel.clutter_text.line_wrap = true;
            bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            contentBox.add_child(bodyLabel);
        }
    } else {

        const isDuplicateTitle = rawTitle.toLowerCase() === appName.toLowerCase();
        const hasBody = !!bodyText;

        if (appName && (!isDuplicateTitle || hasBody || isCritical)) {
            appLabel = new St.Label({
                text: isCritical ? `⚠ ${t('urgent', 'ТЕРМІНОВО')}` : appName,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: isCritical
                    ? 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: #ff453a !important; font-size: 13px !important; font-weight: 700 !important;'
                    : 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: #ffffff !important; font-size: 12.5px !important; font-weight: 700 !important;',
            });
            try { appLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}
            contentBox.add_child(appLabel);
        }


        const displayTitle = rawTitle || (!hasBody ? (appName || 'Повідомлення') : '');
        if (displayTitle && (!isDuplicateTitle || !hasBody)) {
            titleLabel = new St.Label({
                x_expand: true,
                style: 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: rgba(255, 255, 255, 0.95) !important; font-size: 13.5px !important; font-weight: 400 !important;',
            });
            setLabelMarkup(titleLabel, displayTitle);
            try { titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}
            contentBox.add_child(titleLabel);
        }

        if (hasBody) {
            bodyLabel = new St.Label({
                x_expand: true,
                style: 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: rgba(255, 255, 255, 0.85) !important; font-size: 12.5px !important; font-weight: 400 !important;',
            });
            setLabelMarkup(bodyLabel, bodyText);
            bodyLabel.clutter_text.single_line_mode = false;
            bodyLabel.clutter_text.line_wrap = true;
            bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            contentBox.add_child(bodyLabel);
        }
    }


    let actionsBox = null;
    if (notification.actions && notification.actions.length > 0) {
        actionsBox = new St.BoxLayout({
            style_class: 'mac-notification-actions-box',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
            opacity: 0,
            style: isScreenshot
                ? 'margin-top: 6px !important; margin-bottom: 4px !important; spacing: 6px !important;'
                : 'margin-top: 8px !important; margin-bottom: 4px !important; spacing: 8px !important;',
        });
        actionsBox.set_width(contentW);
        actionsBox.max_width = contentW;
        const btnStyleBase = isScreenshot
            ? 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; background-color: rgba(255, 255, 255, 0.16) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; border-radius: 9999px !important; padding: 4px 14px !important; font-size: 11px !important; font-weight: 500 !important; margin-right: 6px !important;'
            : 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; background-color: rgba(255, 255, 255, 0.16) !important; color: #ffffff !important; border: 1px solid rgba(255, 255, 255, 0.14) !important; border-radius: 9999px !important; padding: 5px 16px !important; font-size: 11.5px !important; font-weight: 500 !important; margin-right: 6px !important;';
        const btnStyleHover = btnStyleBase.replace('0.16', '0.26').replace('0.14', '0.20');

        for (const action of notification.actions) {
            const actBtn = new St.Button({
                style_class: 'mac-notification-action-btn',
                label: action.label,
                reactive: true,
                can_focus: true,
                x_expand: false,
                style: btnStyleBase,
            });
            actBtn.connect('notify::hover', () => {
                actBtn.set_style(actBtn.hover ? btnStyleHover : btnStyleBase);
                updateHoverState();
            });
            actBtn.connect('clicked', () => {
                try { action.activate(); } catch (e) { logError(e); }
                if (onClose) onClose(cardData);
            });
            actionsBox.add_child(actBtn);
        }
        contentBox.add_child(actionsBox);
    }


    const timeLabel = new St.Label({
        text: formatToastAge(notification.datetime),
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        style: 'font-family: "Default", "Default Display", default, system-ui, sans-serif, sans-serif !important; color: rgba(255, 255, 255, 0.55) !important; font-size: 12px !important; font-weight: 500 !important; margin-top: 5px !important; margin-right: 0px !important;',
    });
    try { timeLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END; } catch (_) {}

    const closeBtn = new St.Button({
        opacity: 0,
        visible: false,
        reactive: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.START,
        style: CLOSE_BASE,
    });
    closeBtn.set_size(22, 22);
    closeBtn.min_width = 22;
    closeBtn.min_height = 22;
    closeBtn.translation_x = 6;
    closeBtn.translation_y = -6;
    try {
        closeBtn.set_child(new St.Label({
            text: '✕',
            style: 'font-size: 11px; color: rgba(255, 255, 255, 0.90); font-weight: 600;',
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
        style: 'margin-top: -5px !important; margin-right: -2px !important;',
    });
    rightRail.set_width(railW);
    rightRail.min_width = railW;
    rightRail.max_width = railW;
    rightRail.x_expand = false;
    rightRail.add_child(timeLabel);
    mainBox.add_child(rightRail);
    banner.add_child(closeBtn);


    const cardData = {
        banner,
        notification,
        source,
        closeBtn,
        timeLabel,
        appLabel,
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
        try {
            if (banner._macGroupIntercept) {
                banner._macGroupIntercept();
                return;
            }
        } catch (_) {}
        if (cardData.isClosing)
            return;
        if (onClick)
            onClick(cardData);
    });

    const isCardHovered = () => {
        try {
            if (cardData.isClosing || !banner.get_stage() || !closeBtn.get_stage()) return false;
            if (banner.hover || closeBtn.hover) return true;
            if (actionsBox && actionsBox.get_stage()) {
                if (actionsBox.hover) return true;
                for (const b of actionsBox.get_children()) {
                    if (b.hover) return true;
                }
            }
        } catch (_) {}
        return false;
    };



    const updateHoverState = () => {
        try {
            if (cardData.isClosing || !banner.get_stage() || !closeBtn.get_stage())
                return;
            const hovered = isCardHovered();

            closeBtn.remove_all_transitions();
            timeLabel.remove_all_transitions();
            if (actionsBox) actionsBox.remove_all_transitions();

            if (hovered) {
                closeBtn.visible = true;
                closeBtn.ease({
                    opacity: 255,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                timeLabel.opacity = 255;
                timeLabel.visible = true;
                if (actionsBox) {
                    actionsBox.visible = true;
                    actionsBox.ease({
                        opacity: 255,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
                measureCard(true, true);
            } else {
                timeLabel.opacity = 255;
                timeLabel.visible = true;
                closeBtn.ease({
                    opacity: 0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        try {
                            if (!cardData.isClosing && !isCardHovered() && closeBtn.get_stage()) {
                                closeBtn.visible = false;
                            }
                        } catch (_) {}
                    },
                });
                if (actionsBox) {
                    actionsBox.ease({
                        opacity: 0,
                        duration: 140,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            try {
                                if (!isCardHovered() && actionsBox.get_stage()) {
                                    actionsBox.visible = false;
                                }
                            } catch (_) {}
                        },
                    });
                }
                measureCard(false, true);
            }
        } catch (_) {}
    };

    banner.connect('notify::hover', updateHoverState);
    closeBtn.connect('notify::hover', updateHoverState);
    if (actionsBox) {
        actionsBox.connect('notify::hover', updateHoverState);
        for (const actBtn of actionsBox.get_children()) {
            actBtn.connect('notify::hover', updateHoverState);
        }
    }


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







    const computeCardTargetHeight = (isHover = false) => {
        const colW = Math.max(80, Math.round((width ?? 484)) - 28 - (isScreenshot ? 38 : 44) - 12 - 76);
        let total = isScreenshot ? 20 : 30;
        let count = 0;
        for (const l of [appLabel, titleLabel, bodyLabel]) {
            if (!l)
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
            return isScreenshot ? 54 : 72;

        if (actionsBox && isHover) {

            total += isScreenshot ? 30 : 34;
        }
        total += (isScreenshot ? 2 : 4) * Math.max(0, count - 1);
        const minH = isScreenshot ? (isHover && actionsBox ? 88 : 54) : (isHover && actionsBox ? 96 : 72);
        return Math.max(minH, Math.ceil(total));
    };

    const measureCard = (hovered = null, animate = false) => {
        try {
            const isHover = hovered !== null ? hovered : isCardHovered();
            const target = computeCardTargetHeight(isHover);
            if (Math.abs(target - banner.height) > 1) {
                if (animate && banner.get_parent() && banner.get_stage()) {
                    try {
                        banner.remove_all_transitions();
                        banner.ease({
                            height: target,
                            duration: 180,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        });
                    } catch (_) {
                        try { banner.set_height(target); } catch (_) {}
                    }
                } else {
                    try {
                        banner.remove_all_transitions();
                        banner.set_height(target);
                        banner.min_height = target;
                    } catch (_) {}
                }
            }
        } catch (_) {}
    };




    const initialH = computeCardTargetHeight(false);
    banner.set_height(initialH);
    banner.min_height = initialH;

    for (const d of [80, 200, 400]) {
        try {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, d, () => {
                try {
                    if (!isCardHovered()) {
                        measureCard(false, false);
                    }
                } catch (_) {}
                return GLib.SOURCE_REMOVE;
            });
        } catch (_) {}
    }


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
