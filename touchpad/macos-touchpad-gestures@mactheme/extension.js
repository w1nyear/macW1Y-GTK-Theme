import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MacOSTouchpadGestures extends Extension {
    async enable() {
        try {
            const module = await import(`./gestureImpl.js?v=${Date.now()}`);
            this._impl = new module.default(this);
            this._impl.enable();
        } catch (e) {
            log(`[macOS Gestures] Error loading gestureImpl: ${e}`);
        }
    }

    disable() {
        if (this._impl) {
            this._impl.disable();
            this._impl = null;
        }
    }
}
