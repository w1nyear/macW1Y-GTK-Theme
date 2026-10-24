export class AvatarManager {
    constructor(extension) {
        this._extension = extension;
        this.cupertinoAvatarSetup = false;
        this.origUpdateUser = null;
        this.origMethodName = null;
    }

    setupCupertinoAvatarOverride() {
        if (this.cupertinoAvatarSetup) return;
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
                if (authPrompt._userWell) {
                    authPrompt._userWell.opacity = 0;
                    const uw = authPrompt._userWell.get_child();
                    if (uw) {
                        uw.opacity = 0;
                        if (uw._avatar) uw._avatar.opacity = 0;
                        if (uw._label) uw._label.opacity = 0;
                    }
                }
            };
            if (authPrompt._userWell) {
                authPrompt._userWell.opacity = 0;
                const promptUserWidget = authPrompt._userWell.get_child();
                if (promptUserWidget) {
                    promptUserWidget.opacity = 0;
                    if (promptUserWidget._avatar) promptUserWidget._avatar.opacity = 0;
                    if (promptUserWidget._label) promptUserWidget._label.opacity = 0;
                }
            }
        }

        authPrompt.connectObject('destroy', () => this.teardownCupertinoAvatarOverride(), this);
    }

    teardownCupertinoAvatarOverride() {
        const dialog = this._extension._dialog;
        const authPrompt = dialog?._authPrompt ?? dialog?._promptBox?._authPrompt;
        if (authPrompt) authPrompt.disconnectObject(this);

        if (authPrompt && this.origUpdateUser && this.origMethodName) {
            authPrompt[this.origMethodName] = this.origUpdateUser;
        }
        this.origUpdateUser = null;
        this.origMethodName = null;

        if (authPrompt?._userWell) {
            authPrompt._userWell.opacity = 255;
            const promptUserWidget = authPrompt._userWell.get_child();
            if (promptUserWidget) {
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
