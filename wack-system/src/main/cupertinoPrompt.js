import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as UserWidget from 'resource:///org/gnome/shell/ui/userWidget.js';
import { getUserLabelStyle, getHintTextStyle } from './colorUtils.js';

export const WackCupertinoRestPrompt = GObject.registerClass(
    class WackCupertinoRestPrompt extends St.BoxLayout {
        _init(user, extension) {
            super._init({
                style_class: 'login-dialog-prompt-layout',
                vertical: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                reactive: false,
            });

            this._extension = extension;
            this._avatarButton = null;
            this._currentText = '';
            this._currentCount = 0;
            this._lastAvatarColor = null;
            this._lastVisualState = null;
            this._lastClockAlpha = null;

            this._userWell = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START,
                reactive: false,
            });
            this.add_child(this._userWell);

            // Inline hint box
            this._hintBox = new St.BoxLayout({
                style_class: 'wack-cupertino-hint',
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                opacity: 255,
            });

            this._hintLabel = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
            });

            // Prevent layout shift by ensuring consistent line metrics
            this._hintLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._hintLabel.clutter_text.line_wrap = true;
            this._hintBox.add_child(this._hintLabel);

            this._hintBoxWrapper = new St.Bin({
                x_expand: true,
                opacity: 255,
                child: this._hintBox,
            });
            this.add_child(this._hintBoxWrapper);

            this._user = null;
            this.connectObject('destroy', () => {
                if (this._user) {
                    this._user.disconnectObject(this);
                    this._user = null;
                }
            }, this);

            this.setUser(user);
        }

        setUser(user) {
            if (this._user) {
                this._user.disconnectObject(this);
                this._user = null;
            }
            this._user = user;
            if (this._user) {
                this._user.connectObject(
                    'notify::is-loaded', () => this.updateAvatarVibrancy(),
                    'changed', () => this.updateAvatarVibrancy(),
                    this
                );
            }

            const oldChild = this._userWell.get_child();
            if (oldChild) {
                if (this._avatarButton) {
                    this._avatarButton.disconnectObject(this);
                    this._avatarButton = null;
                }
                oldChild.destroy();
            }

            const userWidget = new UserWidget.UserWidget(user, Clutter.Orientation.VERTICAL);
            const avatar = userWidget._avatar;

            if (avatar) {
                userWidget.remove_child(avatar);
                this._avatarButton = new St.Button({
                    style_class: 'wack-avatar-well wack-avatar-clickable',
                    x_expand: false,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.START,
                    can_focus: false,
                    child: avatar,
                    reactive: true,
                });
                userWidget.insert_child_at_index(this._avatarButton, 0);
                /* ВАЖЛИВО (fix recursion): avatar.update() НІКОЛИ не перезаписується.
                   Нативний Avatar.update() сам рендерить фото icon-file та
                   фолбек person-icon; наші кольори — лише на this._avatarButton. */

                this._avatarButton.connectObject('clicked', () => {
                    if (!this._extension?._promptActive) {
                        this._extension?._dialog?._showPrompt();
                    } else {
                        this._extension?.triggerSwitchUser();
                    }
                }, this);
            }

            this._userWell.reactive = true;
            this._userWell.connectObject('button-press-event', (_actor, event) => {
                if (event.get_button() === 1 && !this._extension?._promptActive) {
                    this._extension?._dialog?._showPrompt();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this._userWell.set_child(userWidget);
            this._applyUserLabelStyle();
            this._applyHintLabelStyle();
            this.updateAvatarVibrancy();
        }

        _applyUserLabelStyle() {
            const userWidget = this._userWell?.get_child();
            const label = userWidget?._label;
            if (!label) return;
            if (this._lastVisualState || this._lastClockAlpha != null) {
                label.set_style(getUserLabelStyle(this._lastVisualState ?? this._lastClockAlpha));
            }
        }

        _applyHintLabelStyle() {
            if (!this._hintLabel) return;
            if (this._lastVisualState || this._lastClockAlpha != null) {
                this._hintLabel.set_style(getHintTextStyle(this._lastVisualState, this._lastClockAlpha));
            }
        }

        updateVisuals(promptColor, alpha = null) {
            if (promptColor)
                this._lastVisualState = promptColor;
            if (alpha != null)
                this._lastClockAlpha = alpha;

            this._applyUserLabelStyle();
            this._applyHintLabelStyle();

            const avColor = promptColor?.avatarColor ?? promptColor;
            if (avColor)
                this.updateAvatarVibrancy(avColor);
        }

        _hasImageAvatar(avatar) {
            return Boolean(this._getIconFile(avatar));
        }

        _getIconFile(avatar) {
            if (!avatar) return null;
            const iconFile = avatar._user?.get_icon_file ? avatar._user.get_icon_file() : null;
            if (iconFile && this._pathReadable(iconFile))
                return iconFile;
            const userName = avatar._user?.get_user_name() ?? this._user?.get_user_name?.();
            if (userName) {
                const asIcon = `/var/lib/AccountsService/icons/${userName}`;
                if (this._pathReadable(asIcon))
                    return asIcon;
            }
            return null;
        }

        /* Файл має бути не лише наявним, а й читабельним для gdm-процесу,
           інакше St не намалює фото і користувач побачить порожнє коло. */
        _pathReadable(candidatePath) {
            try {
                if (!candidatePath || !GLib.file_test(candidatePath, GLib.FileTest.EXISTS))
                    return false;
                return Gio.File.new_for_path(candidatePath)
                    .query_info(Gio.FILE_ATTRIBUTE_ACCESS_CAN_READ, Gio.FileQueryInfoFlags.NONE, null)
                    .get_attribute_boolean(Gio.FILE_ATTRIBUTE_ACCESS_CAN_READ);
            } catch (_) {
                return false;
            }
        }

        /* Вібраність (fix recursion 23.10.2026): кольори ставимо ЛИШЕ на
           this._avatarButton (St.Button). Актcr Avatar чіпаємо хіба що для
           visibility/opacity — більше жодних avatar.set_style/child=null,
           бо нативний vfunc_style_changed → update() перетворює такий
           обмін стилями на «too much recursion». */
        updateAvatarVibrancy(avatarColor) {
            if (avatarColor)
                this._lastAvatarColor = avatarColor;
            const color = this._lastAvatarColor;
            if (!this._avatarButton || this._updatingVibrancy) return;

            this._updatingVibrancy = true;
            const avatar = this._avatarButton.get_child();
            const iconFile = this._getIconFile(avatar);

            const TRANSPARENT_WELL = 'background-color: transparent !important; border-radius: 999px !important;';

            try {
                if (iconFile) {
                    // Фото рендериться нативно — кнопка лишається прозорою.
                    this._avatarButton.remove_style_class_name('wack-vibrancied');
                    if (this._avatarButton.get_style() !== TRANSPARENT_WELL)
                        this._avatarButton.set_style(TRANSPARENT_WELL);
                    this._avatarButton.visible = true;
                    this._avatarButton.opacity = 255;
                    if (avatar) {
                        avatar.visible = true;
                        avatar.opacity = 255;
                    }
                } else if (color) {
                    this._avatarButton.add_style_class_name('wack-vibrancied');
                    const bgRgba = color.rgba || `rgba(${color.r}, ${color.g}, ${color.b}, 1.0)`;
                    const btnStyle = `background-color: ${bgRgba} !important; border-radius: 999px !important;`;
                    if (this._avatarButton.get_style() !== btnStyle)
                        this._avatarButton.set_style(btnStyle);
                    this._avatarButton.visible = true;
                    this._avatarButton.opacity = 255;
                    if (avatar) {
                        avatar.visible = true;
                        avatar.opacity = 255;
                    }
                } else {
                    this._avatarButton.remove_style_class_name('wack-vibrancied');
                    if (this._avatarButton.get_style() !== TRANSPARENT_WELL)
                        this._avatarButton.set_style(TRANSPARENT_WELL);
                }
            } finally {
                this._updatingVibrancy = false;
            }
        }



        setHintText(text) {
            this._currentText = text ?? '';
            this._updateHintLabel();
        }

        setNotifCount(count) {
            this._currentCount = count ?? 0;
            this._updateHintLabel();
        }

        setHint(text, count = 0) {
            this._currentText = text ?? '';
            this._currentCount = count ?? 0;
            this._updateHintLabel();
        }

        _updateHintLabel() {
            if (!this._hintLabel) return;

            // Invalidate StLabel's cached shadow pipeline (st_label_set_text clears text_shadow_pipeline)
            this._hintLabel.text = '';

            // Escape the text to prevent markup injection errors
            const safeText = GLib.markup_escape_text(this._currentText, -1);

            // Always use the same markup structure so Pango's line metrics are
            // constant whether or not the bell emoji is present. Without this,
            // switching between "N 🔔 · hint" and plain hint nudges the widget
            // by ~2 px because the emoji has taller ascent/descent metrics.
            if (this._currentCount > 0) {
                this._hintLabel.clutter_text.use_markup = true;
                this._hintLabel.clutter_text.set_markup(
                    `${this._currentCount} <span size="8625">🔔\uFE0E</span>  ·  ${safeText}`
                );
            } else {
                this._hintLabel.clutter_text.use_markup = false;
                this._hintLabel.text = this._currentText;
            }
        }
    });

