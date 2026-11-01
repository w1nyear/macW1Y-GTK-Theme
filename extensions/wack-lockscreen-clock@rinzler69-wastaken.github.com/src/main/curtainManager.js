import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

export class ScreenShieldCurtainManager {
    constructor(extension) {
        this._extension = extension;
        this.origContinueDeactivate = null;
        this.origHideLockScreen = null;
        this.origResetLockScreen = null;
        this.origActivateFade = null;
        this._installed = false;
    }

    install(screenShield) {
        if (!screenShield || this._installed) return;
        this._installed = true;

        // Pin translation_y to 0 immediately so no curtain slides up/down
        if (screenShield._lockDialogGroup) {
            screenShield._lockDialogGroup.remove_all_transitions();
            screenShield._lockDialogGroup.translation_y = 0;
        }

        // Neutralize lightbox vignette/dimming
        if (screenShield._shortLightbox) {
            screenShield._shortLightbox.remove_all_transitions();
            screenShield._shortLightbox.opacity = 0;
            screenShield._shortLightbox.hide();
        }
        if (screenShield._longLightbox) {
            screenShield._longLightbox.remove_all_transitions();
            screenShield._longLightbox.opacity = 0;
            screenShield._longLightbox.hide();
        }

        // 1. _continueDeactivate: eliminate the upward sliding curtain ease (-global.screen_height)
        if (screenShield._continueDeactivate) {
            this.origContinueDeactivate = screenShield._continueDeactivate.bind(screenShield);
            screenShield._continueDeactivate = (animate) => {
                screenShield._isActive = false;

                screenShield._hideLockScreen(false);

                if (Main.sessionMode.currentMode === 'unlock-dialog')
                    Main.sessionMode.popMode('unlock-dialog');

                screenShield.emit('wake-up-screen');

                if (screenShield._isGreeter) {
                    screenShield._activationTime = 0;
                    screenShield._setActive(false);
                    return;
                }

                if (!screenShield._isLocked) {
                    screenShield._completeDeactivate();
                    return;
                }

                if (screenShield._dialog && !screenShield._isGreeter)
                    screenShield._dialog.popModal();

                if (screenShield._grab) {
                    Main.popModal(screenShield._grab);
                    screenShield._grab = null;
                }

                screenShield._longLightbox.lightOff();
                screenShield._shortLightbox.lightOff();
                screenShield._longLightbox.opacity = 0;
                screenShield._shortLightbox.opacity = 0;
                screenShield._longLightbox.hide();
                screenShield._shortLightbox.hide();

                // Strictly keep translation_y at 0 — no sliding curtain from bottom to top!
                screenShield._lockDialogGroup.remove_all_transitions();
                screenShield._lockDialogGroup.translation_y = 0;

                if (animate && screenShield._lockDialogGroup.opacity > 0 && screenShield.actor.visible) {
                    screenShield._lockDialogGroup.ease({
                        opacity: 0,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            screenShield._lockDialogGroup.opacity = 255;
                            screenShield._completeDeactivate();
                        },
                    });
                } else {
                    screenShield._completeDeactivate();
                }
            };
        }

        // 2. _hideLockScreen: eliminate upward ease (-height)
        if (screenShield._hideLockScreen) {
            this.origHideLockScreen = screenShield._hideLockScreen.bind(screenShield);
            screenShield._hideLockScreen = (animate) => {
                if (screenShield._lockScreenState === MessageTray.State.HIDDEN)
                    return;

                screenShield._lockScreenState = MessageTray.State.HIDING;

                screenShield._lockDialogGroup.remove_all_transitions();
                screenShield._lockDialogGroup.translation_y = 0;

                if (animate && screenShield._lockScreenGroup.visible) {
                    screenShield._lockScreenGroup.ease({
                        opacity: 0,
                        duration: 180,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            screenShield._lockScreenGroup.opacity = 255;
                            screenShield._hideLockScreenComplete();
                        },
                    });
                } else {
                    screenShield._hideLockScreenComplete();
                }

                screenShield._showPointer();
            };
        }

        // 3. _resetLockScreen: eliminate downward ease from -global.screen_height
        if (screenShield._resetLockScreen) {
            this.origResetLockScreen = screenShield._resetLockScreen.bind(screenShield);
            screenShield._resetLockScreen = (params) => {
                if (screenShield._lockScreenState !== MessageTray.State.HIDDEN)
                    return;

                screenShield._lockScreenGroup.show();
                screenShield._lockScreenState = MessageTray.State.SHOWING;

                screenShield._lockDialogGroup.remove_all_transitions();
                screenShield._lockDialogGroup.translation_y = 0;

                if (params?.animateLockScreen) {
                    screenShield._lockDialogGroup.opacity = 0;
                    screenShield._lockDialogGroup.ease({
                        opacity: 255,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            screenShield._lockScreenShown({fadeToBlack: false, animateFade: false});
                        },
                    });
                } else {
                    screenShield._lockDialogGroup.opacity = 255;
                    screenShield._lockScreenShown({fadeToBlack: false, animateFade: false});
                }

                if (screenShield._isGreeter)
                    screenShield._dialog.activate();
                else
                    screenShield._dialog?.grab_key_focus?.();
            };
        }

        // 4. _activateFade: eliminate dark vignette curtain when dimmer is disabled
        if (screenShield._activateFade) {
            this.origActivateFade = screenShield._activateFade.bind(screenShield);
            screenShield._activateFade = (lightbox, time) => {
                const settings = this._extension?._settings;
                const dimmerEnabled = settings?.get_boolean('gdm-background-dimmer') ?? false;
                if (!dimmerEnabled) {
                    if (lightbox) {
                        lightbox.remove_all_transitions();
                        lightbox.opacity = 0;
                        lightbox.hide();
                    }
                    return;
                }
                Main.uiGroup.set_child_above_sibling(lightbox, null);
                lightbox.lightOn(time);
            };
        }
    }

    uninstall(screenShield) {
        if (!this._installed) return;
        this._installed = false;

        if (screenShield) {
            if (this.origContinueDeactivate) {
                screenShield._continueDeactivate = this.origContinueDeactivate;
                this.origContinueDeactivate = null;
            }
            if (this.origHideLockScreen) {
                screenShield._hideLockScreen = this.origHideLockScreen;
                this.origHideLockScreen = null;
            }
            if (this.origResetLockScreen) {
                screenShield._resetLockScreen = this.origResetLockScreen;
                this.origResetLockScreen = null;
            }
            if (this.origActivateFade) {
                screenShield._activateFade = this.origActivateFade;
                this.origActivateFade = null;
            }
            if (screenShield._lockDialogGroup) {
                screenShield._lockDialogGroup.remove_all_transitions();
                screenShield._lockDialogGroup.translation_y = 0;
                screenShield._lockDialogGroup.opacity = 255;
            }
        }
    }
}
