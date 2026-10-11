/**
 * passwordField.js - Support for password indicators and shake effects in GDM
 */
import Clutter from "gi://Clutter";

export class PasswordIndicators {
    constructor(authPrompt) {
        this._authPrompt = authPrompt;
    }

    destroy() {
        this._authPrompt = null;
    }
}

export function connectFailureShake(authPrompt, gdmManager, isCupertinoFn) {
    if (!authPrompt) return;
    try {
        if (typeof authPrompt.connect === "function") {
            authPrompt.connect("failed", () => {
                if (isCupertinoFn && isCupertinoFn() && gdmManager?._cupertinoRestPromptContainer) {
                    const actor = gdmManager._cupertinoRestPromptContainer;
                    actor.translation_x = 0;
                    actor.ease({
                        translation_x: -12,
                        duration: 50,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            actor.ease({
                                translation_x: 12,
                                duration: 100,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onComplete: () => {
                                    actor.ease({
                                        translation_x: 0,
                                        duration: 50,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }
    } catch (e) {
        // Fallback gracefully
    }
}
