import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as UserWidget from 'resource:///org/gnome/shell/ui/userWidget.js';
import {
    GDM_USER_STACK_VERTICAL_FRACTION_WITH_CSA,
    GDM_USER_STACK_VERTICAL_FRACTION_NO_CSA,
    GDM_USER_LIST_CAP_WITH_CSA,
    GDM_USER_LIST_CAP_NO_CSA,
} from './gdmUtils.js';

// Defensively guard against unallocated paint attempts in UserWidgetLabel
if (UserWidget?.UserWidgetLabel?.prototype?.vfunc_paint) {
    const origPaint = UserWidget.UserWidgetLabel.prototype.vfunc_paint;
    UserWidget.UserWidgetLabel.prototype.vfunc_paint = function(paintContext) {
        if (!this._currentLabel) {
            this._currentLabel = this._realNameLabel || this._userNameLabel;
        }
        if (this._currentLabel) {
            origPaint.call(this, paintContext);
        }
    };
}

export class GdmUserListManager {
    constructor(gdmManager) {
        this._gdm = gdmManager;
        this.userListItemAddedId = null;
    }

    setup(dialog) {
        this.setupUserListWidths(dialog);
    }

    teardown(dialog) {
        this.teardownUserListWidths(dialog);
    }

    positionUserList(dialogBox = null) {
        const dialog = this._gdm._dialog;
        if (!dialog?._userSelectionBox) return;
        const box = dialog._userSelectionBox;

        const monitor = Main.layoutManager?.primaryMonitor || { x: 0, y: 0, width: 1920, height: 1080 };
        const alloc = dialogBox || (dialog ? dialog.get_allocation_box() : null);
        let w = alloc ? (alloc.x2 - alloc.x1) : monitor.width;
        let h = alloc ? (alloc.y2 - alloc.y1) : monitor.height;
        if (w <= 0 || w > 32768) w = monitor.width;
        if (h <= 0 || h > 32768) h = monitor.height;
        let startX = (alloc && alloc.x1 >= 0 && alloc.x1 < 32768) ? alloc.x1 : monitor.x;

        const [, , natW, natH] = box.get_preferred_size();
        const effectiveW = natW > 0 ? natW : 180;
        const effectiveH = natH > 0 ? natH : 90;

        const targetX = startX + Math.floor((w - effectiveW) / 2);

        // Anchor user avatar and name near bottom edge (~65px bottom margin) matching user reference photo
        const bottomMargin = 65;
        const targetY = Math.max(50, Math.floor(h - effectiveH - bottomMargin));

        const currentX = box.x || 0;
        const currentY = box.y || 0;
        box.translation_x = 0;
        box.translation_y = targetY - currentY;
    }

    getItemTightWidth(item) {
        const userWidget = item._userWidget;
        if (!userWidget) return item.get_preferred_width(-1)[1];

        const avatar = userWidget._avatar;
        const labelWidget = userWidget._label;
        if (!avatar || !labelWidget) return item.get_preferred_width(-1)[1];

        const [, avatarNatW] = avatar.get_preferred_width(-1);
        const visibleLabel = labelWidget._realNameLabel ?? labelWidget._userNameLabel;
        const [, labelNatW] = visibleLabel ? visibleLabel.get_preferred_width(-1) : [0, 0];

        const spacing = userWidget.get_theme_node().get_length('spacing');

        const itemNode = item.get_theme_node();
        const padLeft = itemNode.get_padding(St.Side.LEFT);
        const padRight = itemNode.get_padding(St.Side.RIGHT);

        return Math.ceil(Math.max(avatarNatW, labelNatW) + padLeft + padRight + 32);
    }

    applyUserListWidths(dialog = null) {
        const targetDialog = dialog || this._gdm._dialog;
        const userList = targetDialog?._userList;
        if (!userList || userList._items.size === 0) return;

        let maxW = 0;
        for (const item of userList._items.values()) {
            const w = this.getItemTightWidth(item);
            if (w > maxW) maxW = w;
        }

        for (const item of userList._items.values()) {
            item.x_expand = false;
            item.set_width(maxW);
        }

        const hasCsa = Boolean(this._gdm._powerButtons?.actor?.visible);
        const cap = hasCsa ? GDM_USER_LIST_CAP_WITH_CSA : GDM_USER_LIST_CAP_NO_CSA;

        const items = Array.from(userList._items.values());
        if (items.length > cap) {
            let capHeight = 0;
            for (let i = 0; i < cap; i++) {
                const [, h] = items[i].get_preferred_height(-1);
                capHeight += h;
            }
            userList.set_height(capHeight);
        } else {
            userList.set_height(-1);
        }
    }

    setupUserListWidths(dialog = null) {
        const targetDialog = dialog || this._gdm._dialog;
        const userList = targetDialog?._userList;
        if (!userList) return;

        userList.vscrollbar_policy = St.PolicyType.NEVER;
        userList.hscrollbar_policy = St.PolicyType.NEVER;
        userList.enable_mouse_scrolling = true;

        this.applyUserListWidths(targetDialog);

        this.userListItemAddedId = userList.connect('item-added', () => {
            this.applyUserListWidths(targetDialog);
        });
    }

    teardownUserListWidths(dialog = null) {
        const targetDialog = dialog || this._gdm._dialog;
        const userList = targetDialog?._userList;
        if (this.userListItemAddedId) {
            if (userList)
                userList.disconnect(this.userListItemAddedId);
            this.userListItemAddedId = null;
        }
        if (userList) {
            userList.set_height(-1);
            userList.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            userList.hscrollbar_policy = St.PolicyType.AUTOMATIC;
            for (const item of userList._items.values()) {
                item.x_expand = true;
                item.set_width(-1);
            }
        }
    }
}
