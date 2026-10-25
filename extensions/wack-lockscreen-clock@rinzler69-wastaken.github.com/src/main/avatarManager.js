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
        authPrompt._userWell.visible = false;
        authPrompt._userWell.opacity = 0;
        const uw = authPrompt._userWell.get_child();
        if (uw) {
            uw.visible = false;
            uw.opacity = 0;
            if (uw._avatar) {
                uw._avatar.visible = false;
                uw._avatar.opacity = 0;
            }
            if (uw._label) {
                uw._label.visible = false;
                uw._label.opacity = 0;
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
            const promptUserWidget = authPrompt._userWell.get_child();
            if (promptUserWidget) {
                promptUserWidget.visible = true;
                promptUserWidget.opacity = 255;
                if (promptUserWidget._avatar) {
                    promptUserWidget._avatar.visible = true;
                    promptUserWidget._avatar.opacity = 255;
                }
                if (promptUserWidget._label) {
                    promptUserWidget._label.visible = true;
                    promptUserWidget._label.opacity = 255;
                }
            }
        }
        this.cupertinoAvatarSetup = false;
    }
}
