import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { getUserLabelStyle } from '../main/colorUtils.js';
import { _log } from './gdmUtils.js';





























function _readableIconPath(candidatePath) {
    try {
        if (!candidatePath || !GLib.file_test(candidatePath, GLib.FileTest.EXISTS))
            return false;
        const file = Gio.File.new_for_path(candidatePath);
        const info = file.query_info(
            Gio.FILE_ATTRIBUTE_ACCESS_CAN_READ, Gio.FileQueryInfoFlags.NONE, null);
        return info ? info.get_attribute_boolean(Gio.FILE_ATTRIBUTE_ACCESS_CAN_READ) : false;
    } catch (_) {
        return false;
    }
}

export class GdmAvatarManager {
    constructor(gdmManager) {
        this._gdm = gdmManager;
        this.gdmAvatarSetup = false;
        this.gdmOrigUpdateUser = null;
        this.gdmOrigMethodName = null;
        this.gdmOrigUserWellYAlign = null;
        this._lastAvatarColor = null;
        this._connectedUser = null;
        this._dialog = null;
        this._updatingVibrancy = false;
    }

    setup(dialog = null) {
        if (this.gdmAvatarSetup) return;
        this._dialog = dialog || this._gdm._dialog;
        const authPrompt = this._dialog?._authPrompt;
        this.gdmAvatarSetup = true;

        if (authPrompt) {
            if (authPrompt._userWell) {
                this.gdmOrigUserWellYAlign = authPrompt._userWell.y_align;
                authPrompt._userWell.y_align = Clutter.ActorAlign.START;
            }

            if (!this.gdmOrigUpdateUser) {
                const methodName = authPrompt.setUser ? 'setUser' : 'updateUser';
                this.gdmOrigMethodName = methodName;
                this.gdmOrigUpdateUser = authPrompt[methodName].bind(authPrompt);
                authPrompt[methodName] = (user) => {
                    this.gdmOrigUpdateUser(user);
                    this.wrapGdmAvatar();
                };
                this.wrapGdmAvatar();
            }

            authPrompt.connectObject('destroy', () => this.teardown(), this);
        }

        const userList = this._dialog?._userList;
        if (userList) {
            userList.connectObject(
                'item-added', (_ul, item) => this._setupUserListItem(item),
                this
            );
            if (userList._items) {
                for (const item of userList._items.values()) {
                    this._setupUserListItem(item);
                }
            }
        }
    }

    teardown() {
        const authPrompt = this._dialog?._authPrompt || this._gdm._dialog?._authPrompt;
        if (authPrompt) authPrompt.disconnectObject(this);

        if (authPrompt && authPrompt._userWell && this.gdmOrigUserWellYAlign !== undefined && this.gdmOrigUserWellYAlign !== null) {
            authPrompt._userWell.y_align = this.gdmOrigUserWellYAlign;
        }
        this.gdmOrigUserWellYAlign = null;

        if (authPrompt && this.gdmOrigUpdateUser && this.gdmOrigMethodName) {
            authPrompt[this.gdmOrigMethodName] = this.gdmOrigUpdateUser;
        }
        this.gdmOrigUpdateUser = null;
        this.gdmOrigMethodName = null;

        if (this._connectedUser) {
            this._connectedUser.disconnectObject(this);
            this._connectedUser = null;
        }

        this.unwrapGdmAvatar();


        const userList = this._dialog?._userList || this._gdm._dialog?._userList;
        if (userList) {
            userList.disconnectObject(this);
            if (userList._items) {
                for (const item of userList._items.values()) {
                    const userWidget = item?._userWidget;
                    const label = userWidget?._label;
                    const user = userWidget?._user;
                    if (user)
                        user.disconnectObject(this);
                    if (label)
                        label.set_style(null);


                    this._unwrapAvatarWell(userWidget);
                }
            }
        }

        this.gdmAvatarSetup = false;
        this._lastAvatarColor = null;
        this._dialog = null;
    }





    _wrapAvatarInWell(userWidget, opts = {}) {
        if (!userWidget?._avatar)
            return null;

        const existingWell = userWidget._wackAvatarWell;
        if (existingWell && existingWell.get_child() === userWidget._avatar)
            return existingWell;

        const avatar = userWidget._avatar;
        userWidget.remove_child(avatar);

        const well = new St.Button({
            style_class: opts.clickable ? 'wack-avatar-well wack-avatar-clickable' : 'wack-avatar-well',
            x_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            can_focus: false,
            child: avatar,
            reactive: Boolean(opts.clickable),
        });
        userWidget._wackAvatarWell = well;
        userWidget.insert_child_at_index(well, 0);
        return well;
    }

    _unwrapAvatarWell(userWidget) {
        const well = userWidget?._wackAvatarWell;
        if (!well) return;
        const avatar = well.get_child();
        well.set_style(null);
        if (avatar) {
            well.set_child(null);
            userWidget.remove_child(well);
            userWidget.insert_child_at_index(avatar, 0);
        }
        delete userWidget._wackAvatarWell;
    }

    _setupUserListItem(item) {
        if (!item) return;

        const userWidget = item._userWidget;
        const avatar = userWidget?._avatar;

        if (userWidget) {
            try {
                if (typeof userWidget.set_vertical === 'function')
                    userWidget.set_vertical(true);
            } catch (_) {}
            try {
                userWidget.orientation = Clutter.Orientation.VERTICAL;
                userWidget.x_align = Clutter.ActorAlign.CENTER;
                userWidget.style_class = 'user-widget vertical';
            } catch (_) {}

            if (avatar)
                avatar.x_align = Clutter.ActorAlign.CENTER;

            if (userWidget._wackSubtitle) {
                userWidget._wackSubtitle.destroy();
                delete userWidget._wackSubtitle;
            }
        }

        if (!avatar) return;


        const well = this._wrapAvatarInWell(userWidget, {});


        const user = avatar._user || userWidget?._user;
        if (user && !user.is_loaded) {
            user.connectObject(
                'notify::is-loaded', () => this.updateAvatarVibrancy(),
                'changed', () => this.updateAvatarVibrancy(),
                this
            );
        }

        const label = userWidget?._label;
        if (label) {
            label.set_style(this._lastAvatarColor ? getUserLabelStyle(this._lastAvatarColor) : null);
        }

        if (well)
            this._colorForWell(well, this._lastAvatarColor);
    }



    _colorForWell(well, color) {
        if (!well) return;
        const targetBg = color
            ? (color.rgba || `rgba(${color.r}, ${color.g}, ${color.b}, 1.0)`)
            : null;
        const targetStyle = targetBg
            ? `background-color: ${targetBg} !important; border-radius: 999px !important;`
            : 'background-color: transparent !important;';



        try {
            if (this._getIconFile(well.get_child()))
                return;
        } catch (_) {}

        if (well.get_style() !== targetStyle)
            well.set_style(targetStyle);
        well.visible = true;
        well.opacity = 255;
    }

    updateAvatarVibrancy(avatarColor) {
        if (avatarColor !== undefined)
            this._lastAvatarColor = avatarColor;
        if (this._updatingVibrancy) return;

        this._updatingVibrancy = true;

        const color = this._lastAvatarColor;

        const authPrompt = this._dialog?._authPrompt || this._gdm._dialog?._authPrompt;
        const userWidget = authPrompt?._userWell?.get_child();


        const well = userWidget?._wackAvatarWell || userWidget?._avatarButton || null;
        if (well)
            this._colorForWell(well, color);

        if (userWidget?._label) {
            userWidget._label.set_style(color ? getUserLabelStyle(color) : null);
        }

        this.updateUserListVibrancy();
        this._updatingVibrancy = false;
    }

    updateUserListVibrancy() {
        const userList = this._dialog?._userList || this._gdm._dialog?._userList;
        if (!userList?._items) return;

        for (const item of userList._items.values()) {
            const userWidget = item?._userWidget;
            const well = userWidget?._wackAvatarWell ?? this._wrapAvatarInWell(userWidget, {});
            if (well)
                this._colorForWell(well, this._lastAvatarColor);

            const label = userWidget?._label;
            if (label && this._lastAvatarColor)
                label.set_style(getUserLabelStyle(this._lastAvatarColor));
        }
    }

    wrapGdmAvatar() {
        const authPrompt = this._dialog?._authPrompt || this._gdm._dialog?._authPrompt;
        if (!authPrompt) {
            _log('[WACK/GdmManager] _wrapGdmAvatar: no authPrompt');
            return;
        }

        const uw = authPrompt._userWell?.get_child();
        if (uw && uw._avatar) {

            const well = this._wrapAvatarInWell(uw, {});
            if (well) uw._avatarButton = well;


            const label = uw?._label;
            if (label && label.vfunc_allocate && label._wackOrigVfuncAllocate === undefined) {
                label._wackOrigVfuncAllocate = label.vfunc_allocate;
                label.vfunc_allocate = function (box) {
                    this.set_allocation(box);
                    const availWidth = box.x2 - box.x1;
                    const availHeight = box.y2 - box.y1;
                    const childBox = new Clutter.ActorBox();
                    this._currentLabel = this._userNameLabel;
                    this.label_actor = this._currentLabel;
                    this._realNameLabel.allocate(childBox);
                    childBox.set_size(availWidth, availHeight);
                    this._userNameLabel.allocate(childBox);
                };
            }


            const avatar = uw._avatar;
            const user = avatar?._user;
            if (user) {
                if (this._connectedUser) {
                    this._connectedUser.disconnectObject(this);
                    this._connectedUser = null;
                }
                this._connectedUser = user;
                user.connectObject(
                    'notify::is-loaded', () => this.updateAvatarVibrancy(),
                    'changed', () => this.updateAvatarVibrancy(),
                    this
                );
            }
        }

        this.updateAvatarVibrancy();
    }

    unwrapGdmAvatar() {
        if (this._connectedUser) {
            this._connectedUser.disconnectObject(this);
            this._connectedUser = null;
        }

        const authPrompt = this._dialog?._authPrompt || this._gdm._dialog?._authPrompt;
        if (!authPrompt) return;

        const uw = authPrompt._userWell?.get_child();

        const label = uw?._label;
        if (label && label._wackOrigVfuncAllocate !== undefined) {
            label.vfunc_allocate = label._wackOrigVfuncAllocate;
            delete label._wackOrigVfuncAllocate;
        }

        if (uw) {
            this._unwrapAvatarWell(uw);
            uw._avatarButton = null;
        }
    }

    _hasImageAvatar(avatar) {
        return Boolean(this._getIconFile(avatar));
    }





    _getIconFile(avatar) {
        if (!avatar) return null;
        const user = avatar._user || null;

        let iconFile = user?.get_icon_file ? user.get_icon_file() : null;
        if (iconFile && _readableIconPath(iconFile))
            return iconFile;

        const userName = user?.get_user_name ? user.get_user_name() : (this._dialog?._user?.get_user_name?.() || null);
        if (userName) {
            const asIcon = `/var/lib/AccountsService/icons/${userName}`;
            if (_readableIconPath(asIcon))
                return asIcon;
        }
        return null;
    }
}
