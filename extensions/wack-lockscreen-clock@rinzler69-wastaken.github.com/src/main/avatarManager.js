export class AvatarManager {
    constructor(extension) {
        this._extension = extension;
        this.cupertinoAvatarSetup = false;
        this.origUpdateUser = null;
        this.origMethodName = null;
        this._childAddedId = 0;
    }

    _suppressUserWell(authPrompt) {
        if (!authPrompt?._userWell) return;
        authPrompt._userWell.visible = true;
        authPrompt._userWell.opacity = 0;
        authPrompt._userWell.reactive = false;
        authPrompt._userWell.can_focus = false;
        authPrompt._userWell.y_expand = false;
        authPrompt._userWell.y_align = Clutter.ActorAlign.START;
        const uw = authPrompt._userWell.get_child();
        if (uw) {
            uw.visible = true;
            uw.opacity = 0;
            uw.reactive = false;
            uw.can_focus = false;
            if (uw._avatar) {
                uw._avatar.visible = true;
                uw._avatar.opacity = 0;
                uw._avatar.reactive = false;
            }
            if (uw._label) {
                uw._label.visible = true;
                uw._label.opacity = 0;
                uw._label.reactive = false;
            }
        }
    }

    setupCupertinoAvatarOverride() {
        const dialog = this._extension._dialog;
        const authPrompt = dialog?._authPrompt ?? dialog?._promptBox?._authPrompt;
        if (!authPrompt) return;
        this.cupertinoAvatarSetup = true;

        if (!this.origUpdateUser) {
            const methodName = authPrompt.setUser ? 'setUser' : 'updateUser';
            this.origMethodName = methodName;
            this.origUpdateUser = authPrompt[methodName].bind(authPrompt);
            authPrompt[methodName] = (user) => {
                this.origUpdateUser(user);
                this._suppressUserWell(authPrompt);
            };
        }

        if (authPrompt._userWell && !this._childAddedId) {
            this._childAddedId = authPrompt._userWell.connect('child-added', () => {
                this._suppressUserWell(authPrompt);
            });
        }

        this._suppressUserWell(authPrompt);

        authPrompt.connectObject('destroy', () => this.teardownCupertinoAvatarOverride(), this);
    }

    teardownCupertinoAvatarOverride() {
        const dialog = this._extension._dialog;
        const authPrompt = dialog?._authPrompt ?? dialog?._promptBox?._authPrompt;
        if (authPrompt) authPrompt.disconnectObject(this);

        if (authPrompt?._userWell && this._childAddedId) {
            try { authPrompt._userWell.disconnect(this._childAddedId); } catch (_) {}
            this._childAddedId = 0;
        }

        if (authPrompt && this.origUpdateUser && this.origMethodName) {
            authPrompt[this.origMethodName] = this.origUpdateUser;
        }
        this.origUpdateUser = null;
        this.origMethodName = null;

        if (authPrompt?._userWell) {
            authPrompt._userWell.visible = true;
            authPrompt._userWell.opacity = 255;
            authPrompt._userWell.reactive = true;
            authPrompt._userWell.can_focus = true;
            authPrompt._userWell.y_expand = true;
            const promptUserWidget = authPrompt._userWell.get_child();
            if (promptUserWidget) {
                promptUserWidget.visible = true;
                promptUserWidget.opacity = 255;
                promptUserWidget.reactive = true;
                promptUserWidget.can_focus = true;
                if (promptUserWidget._avatar) {
                    promptUserWidget._avatar.visible = true;
                    promptUserWidget._avatar.opacity = 255;
                    promptUserWidget._avatar.reactive = true;
                }
                if (promptUserWidget._label) {
                    promptUserWidget._label.visible = true;
                    promptUserWidget._label.opacity = 255;
                    promptUserWidget._label.reactive = true;
                }
            }
        }
        this.cupertinoAvatarSetup = false;
    }
}
