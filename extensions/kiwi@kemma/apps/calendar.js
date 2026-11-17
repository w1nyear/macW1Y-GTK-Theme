// SPDX-License-Identifier: GPL-3.0-or-later


import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';


let dateMenu;
let enabled = false;
let originalParent;
let originalParentIndex;
let originalMenuBoxStyle;
let origShowNotifSection;
let origShowMediaSection;
let removedSections = null;
let originalBannerBinProps;
let calendarActorRef;


let notificationIndicator = null;
let notificationIndicatorParent = null;
let notificationSignals = [];
let indicatorInsertTimeoutId = null;
let kiwiExtension = null;
let kiwiSettings = null;
let indicatorStyleSignalId = 0;

function applyIndicatorStyle(style) {
    if (!notificationIndicator) return;




    const margin = notificationIndicatorParent === Main.panel._rightBox
        ? ' margin-right: 12px;'
        : '';
    switch (style) {
        case 'accent':
            notificationIndicator.style = 'color: -st-accent-color;' + margin;
            break;
        case 'symbolic':
            notificationIndicator.style = margin || null;
            break;
        case 'default':
        default:
            notificationIndicator.style = 'color: red;' + margin;
            break;
    }
}

function setupNotificationIndicator() {
    if (notificationIndicator) return;
    const keep = kiwiSettings ? kiwiSettings.get_boolean('keep-notification-panel') : false;
    notificationIndicatorParent = keep
        ? Main.panel._rightBox
        : (Main.panel.statusArea.quickSettings && Main.panel.statusArea.quickSettings._indicators);
    if (!notificationIndicatorParent) return;

    const initialStyle = kiwiSettings ? kiwiSettings.get_string('notification-indicator-style') : 'default';

    const iconFile = kiwiExtension?.dir.get_child('icons/message-indicator-symbolic.svg');
    notificationIndicator = new St.Icon({
        gicon: iconFile ? Gio.FileIcon.new(iconFile) : null,
        style_class: 'notification-badge',
        visible: false,
    });
    applyIndicatorStyle(initialStyle);



    notificationIndicator.connect('destroy', () => {
        notificationIndicator = null;
    });


    indicatorInsertTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        indicatorInsertTimeoutId = null;
        let insertIndex = notificationIndicatorParent.get_n_children();



        if (notificationIndicatorParent === Main.panel._rightBox && dateMenu?.container) {
            const dateIdx = notificationIndicatorParent.get_children().indexOf(dateMenu.container);
            if (dateIdx >= 0)
                insertIndex = dateIdx + 1;
        }
        notificationIndicatorParent.insert_child_at_index(notificationIndicator, insertIndex);
        return GLib.SOURCE_REMOVE;
    });


    if (kiwiSettings) {
        indicatorStyleSignalId = kiwiSettings.connect('changed::notification-indicator-style', () => {
            applyIndicatorStyle(kiwiSettings.get_string('notification-indicator-style'));
        });
    }


    connectNotificationSignals();
    updateNotificationIndicator();
}

function cleanupNotificationIndicator() {

    if (indicatorInsertTimeoutId) {
        GLib.Source.remove(indicatorInsertTimeoutId);
        indicatorInsertTimeoutId = null;
    }
    if (indicatorStyleSignalId && kiwiSettings) {
        kiwiSettings.disconnect(indicatorStyleSignalId);
    }
    indicatorStyleSignalId = 0;
    kiwiSettings = null;
    kiwiExtension = null;
    notificationSignals.forEach(signal => {
        if (signal.obj === 'interval') {
            GLib.Source.remove(signal.id);
        } else if (signal.obj && signal.id) {
            signal.obj.disconnect(signal.id);
        }
    });
    notificationSignals = [];

    if (notificationIndicator) {
        if (notificationIndicatorParent && notificationIndicator.get_parent() === notificationIndicatorParent) {
            notificationIndicatorParent.remove_child(notificationIndicator);
        }
        notificationIndicator.destroy();
        notificationIndicator = null;
    }
    notificationIndicatorParent = null;
}





function connectSource(source) {
    const addedId = source.connect('notification-added', () => updateNotificationIndicator());
    notificationSignals.push({ obj: source, id: addedId });
    const removedId = source.connect('notification-removed', () => updateNotificationIndicator());
    notificationSignals.push({ obj: source, id: removedId });
}

function disconnectSource(source) {
    notificationSignals = notificationSignals.filter(signal => {
        if (signal.obj !== source)
            return true;
        source.disconnect(signal.id);
        return false;
    });
}

function connectNotificationSignals() {
    notificationSignals = [];

    if (Main.messageTray) {
        const sourceAddedId = Main.messageTray.connect('source-added', (_tray, source) => {
            connectSource(source);
            updateNotificationIndicator();
        });
        notificationSignals.push({ obj: Main.messageTray, id: sourceAddedId });

        const sourceRemovedId = Main.messageTray.connect('source-removed', (_tray, source) => {
            disconnectSource(source);
            updateNotificationIndicator();
        });
        notificationSignals.push({ obj: Main.messageTray, id: sourceRemovedId });

        for (const source of Main.messageTray._sources.values())
            connectSource(source);
    }


    const checkInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
        updateNotificationIndicator();
        return GLib.SOURCE_CONTINUE;
    });
    notificationSignals.push({ obj: 'interval', id: checkInterval });
}

function updateNotificationIndicator() {
    if (!notificationIndicator) return;

    const hasNotifications = checkForNotifications();
    if (hasNotifications !== notificationIndicator.visible) {
        notificationIndicator.visible = hasNotifications;
    }
}

export function enable(extension) {
    if (enabled)
        return;
    kiwiExtension = extension || null;
    kiwiSettings = kiwiExtension ? kiwiExtension.getSettings() : null;

    dateMenu = Main.panel.statusArea.dateMenu;
    if (!dateMenu)
        return;


    originalParent = dateMenu.container.get_parent();
    if (originalParent) {
        originalParentIndex = originalParent.get_children().indexOf(dateMenu.container);
    }





    if (dateMenu.container.get_parent() === Main.panel._centerBox) {
        Main.panel._centerBox.remove_child(dateMenu.container);
        Main.panel._rightBox.insert_child_at_index(dateMenu.container, Main.panel._rightBox.get_children().length);
    }

    const keepNotificationPanel = kiwiSettings
        ? kiwiSettings.get_boolean('keep-notification-panel')
        : false;


    if (!keepNotificationPanel && dateMenu.menu?.box) {
        originalMenuBoxStyle = originalMenuBoxStyle ?? dateMenu.menu.box.style;
        removedSections = {};

        const parentBox = dateMenu.menu.box;

        if (!calendarActorRef) {
            calendarActorRef = dateMenu._calendar || dateMenu._calendarSection || null;
        }

        function detachOrHideSection(key, actorRefName) {
            const actor = dateMenu[actorRefName];
            if (!actor) return;

            if (calendarActorRef && actor === calendarActorRef)
                return;
            let idx = -1;
            let hidden = false;
            if (actor.get_parent() === parentBox) {
                idx = parentBox.get_children().indexOf(actor);
                parentBox.remove_child(actor);
            } else {

                if (actor.show && actor.hide) {
                    actor.hide();
                    hidden = true;
                }
            }
            removedSections[key] = { actor, index: idx, hidden };
        }
        detachOrHideSection('notification', '_notificationSection');
        detachOrHideSection('media', '_mediaSection');
        detachOrHideSection('messages', '_messageList');


        if (!origShowNotifSection)
            origShowNotifSection = dateMenu._shouldShowNotificationSection;
        if (!origShowMediaSection)
            origShowMediaSection = dateMenu._shouldShowMediaSection;

        dateMenu._shouldShowNotificationSection = () => false;
        dateMenu._shouldShowMediaSection = () => false;


        try {
            const baseWidth = 300;
            let width = baseWidth;

            if (calendarActorRef && calendarActorRef.get_preferred_width) {
                const [_minW, natW] = calendarActorRef.get_preferred_width(-1);

                width = Math.max(width, natW + 20);
            }

            const weekNumbersEnabled = Boolean(
                dateMenu._calendar?.get_show_week_numbers?.() ||
                dateMenu._calendar?._showWeekNumbers
            );
            if (weekNumbersEnabled)
                width = Math.max(width, baseWidth + 24);


            dateMenu.menu.box.style = `min-width: ${width}px;`;
        } catch (_e) {

            dateMenu.menu.box.style = 'width: 330px;';
        }


        if (calendarActorRef && !calendarActorRef.get_parent()) {

            parentBox.insert_child_at_index(calendarActorRef, 0);
        }
    }




    if (Main.messageTray?._bannerBin) {
        const bin = Main.messageTray._bannerBin;
        originalBannerBinProps = originalBannerBinProps || {
            x_align: bin.x_align,
            y_align: bin.y_align,
            x_expand: bin.x_expand,
        };
        try {
            if (bin.set_x_expand)
                bin.set_x_expand(true);
            else
                bin.x_expand = true;
            if (bin.set_x_align)
                bin.set_x_align(Clutter.ActorAlign.END);
            else
                bin.x_align = Clutter.ActorAlign.END;
            if (bin.set_y_align)
                bin.set_y_align(Clutter.ActorAlign.START);
            else
                bin.y_align = Clutter.ActorAlign.START;
        } catch (_e) {

            const newBin = new Clutter.Actor({
                name: 'bannerBin',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.START,
            });

            bin.get_children().forEach(c => bin.remove_child(c) && newBin.add_child(c));
            const parent = bin.get_parent();
            if (parent) {
                parent.remove_child(bin);
                parent.add_child(newBin);
            }
            Main.messageTray._bannerBin = newBin;
        }
    }


    setupNotificationIndicator();

    enabled = true;
}

export function disable() {
    dateMenu = Main.panel.statusArea.dateMenu;

    if (removedSections && dateMenu.menu?.box) {
        const parentBox = dateMenu.menu.box;

        const entries = Object.values(removedSections).filter(Boolean).sort((a, b) => a.index - b.index);
        entries.forEach(({ actor, index, hidden }) => {
            if (!actor) return;
            if (hidden && actor.show) {
                actor.show();
                return;
            }
            if (index >= 0 && !actor.get_parent()) {
                const children = parentBox.get_children();
                const insertIndex = Math.min(index, children.length);
                parentBox.insert_child_at_index(actor, insertIndex);
            }
        });
        removedSections = null;
    }


    if (origShowNotifSection) {
        dateMenu._shouldShowNotificationSection = origShowNotifSection;
        origShowNotifSection = null;
    }
    if (origShowMediaSection) {
        dateMenu._shouldShowMediaSection = origShowMediaSection;
        origShowMediaSection = null;
    }


    if (dateMenu.menu?.box && originalMenuBoxStyle !== undefined) {
        dateMenu.menu.box.style = originalMenuBoxStyle;
        originalMenuBoxStyle = undefined;
    }


    if (originalParent && dateMenu.container.get_parent() !== originalParent) {
        const currentParent = dateMenu.container.get_parent();
        if (currentParent)
            currentParent.remove_child(dateMenu.container);
        const children = originalParent.get_children();
        const insertIndex = Math.min(originalParentIndex ?? 0, children.length);
        originalParent.insert_child_at_index(dateMenu.container, insertIndex);
    }


    if (Main.messageTray?._bannerBin && originalBannerBinProps) {
        const bin = Main.messageTray._bannerBin;
        try {
            if (bin.set_x_expand)
                bin.set_x_expand(originalBannerBinProps.x_expand);
            else
                bin.x_expand = originalBannerBinProps.x_expand;
            if (bin.set_x_align)
                bin.set_x_align(originalBannerBinProps.x_align);
            else
                bin.x_align = originalBannerBinProps.x_align;
            if (bin.set_y_align)
                bin.set_y_align(originalBannerBinProps.y_align);
            else
                bin.y_align = originalBannerBinProps.y_align;
        } catch (_e) {

        }
        originalBannerBinProps = null;
    }


    cleanupNotificationIndicator();

    enabled = false;
}

function checkForNotifications() {

    if (Main.messageTray && Main.messageTray._sources) {
        for (let source of Main.messageTray._sources.values()) {
            if (source && source.notifications && source.notifications.length > 0) {


                const activeNotifications = source.notifications.filter(notification => {

                    return notification && !notification.destroyed && !notification.isDestroyed;
                });

                if (activeNotifications.length > 0) {
                    return true;
                }
            }
        }
    }



    if (Main.messageTray && Main.messageTray._notificationQueue &&
        Main.messageTray._notificationQueue.length > 0) {
        return true;
    }



    if (origShowNotifSection &&
        typeof origShowNotifSection === 'function') {
        try {
            return origShowNotifSection.call(dateMenu);
        } catch (e) {

        }
    }

    return false;
}
