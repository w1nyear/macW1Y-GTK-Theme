import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import { trackViewPaints } from '../src/glass/dist/rendering/backdropGlass.js';
import { GlassClock } from '../src/glass/dist/desktop/clock.js';

/**
 * GdmGlassClock wraps the liquid glass clock engine from ryohsuke1231/liquid-glass
 * specifically for the GDM lockscreen time text.
 * It renders high-fidelity refractive liquid glass digits with specular highlights,
 * rim edge lighting, and soft drop shadow over the lockscreen wallpaper.
 */
export class GdmGlassClock {
    constructor(extensionPath, onRelayout = null) {
        this._extensionPath = extensionPath;
        this._glassPath = `${extensionPath}/src/glass`;
        this._onRelayout = onRelayout;
        this._clock = null;
        this._stageSignalId = 0;
        this._isReady = false;

        try {
            trackViewPaints();
        } catch (e) {
            console.error(`[WACK/GDM] trackViewPaints error: ${e}`);
        }

        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            `${this._glassPath}/schemas`,
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        const schema = schemaSource.lookup('org.gnome.shell.extensions.liquid-glass@thinkingcoding1231.gmail.com', false);
        this._settings = new Gio.Settings({ settings_schema: schema });

        const safeSet = (setter) => {
            try { setter(); } catch (_) {}
        };

        // Typography: Open Runde SemiBold / SF Pro Rounded (GDM lockscreen design)
        safeSet(() => this._settings.set_string('glass-clock-font', 'Open Runde SemiBold'));
        safeSet(() => this._settings.set_int('glass-clock-size', 128));
        safeSet(() => this._settings.set_double('glass-clock-stretch', 1.0));
        safeSet(() => this._settings.set_double('glass-clock-height', 1.0));
        safeSet(() => this._settings.set_string('glass-clock-tall-style', 'even'));
        safeSet(() => this._settings.set_boolean('glass-clock-show-date', false)); // wack-lockscreen-clock manages dateLabel

        // Optical glass parameters: macOS Tahoe liquid glass
        safeSet(() => this._settings.set_string('glass-clock-tint-color', '#ffffff'));
        safeSet(() => this._settings.set_double('glass-clock-tint-strength', 0.35));
        safeSet(() => this._settings.set_int('glass-clock-blur-radius', 35));
        safeSet(() => this._settings.set_double('glass-clock-brightness', 1.20));
        safeSet(() => this._settings.set_double('glass-clock-contrast', 1.10));
        safeSet(() => this._settings.set_double('glass-clock-saturation', 1.0));

        const env = {
            path: this._glassPath,
            settings: this._settings,
            logger: {
                log: msg => console.log(`[WACK/GlassClock] ${msg}`),
                error: msg => console.error(`[WACK/GlassClock] ${msg}`),
                warn: msg => console.warn(`[WACK/GlassClock] ${msg}`),
            },
            menu: () => {},
            relayout: () => {
                if (typeof this._onRelayout === 'function')
                    this._onRelayout();
            },
        };

        this._clock = new GlassClock(env);
        this.actor = this._clock.actor;
        this.actor.reactive = false;

        this._stageSignalId = global.stage.connect('before-update', () => {
            if (this._clock && this.actor && this.actor.mapped) {
                this._clock.sync();
            }
        });
    }

    setText(timeText) {
        if (!this._clock || !timeText) return;
        this._clock._setText(timeText).then(() => {
            this._isReady = true;
            this._clock.sync();
            if (typeof this._onRelayout === 'function')
                this._onRelayout();
        }).catch(err => {
            console.error(`[WACK/GlassClock] setText error: ${err}`);
        });
    }

    get isReady() {
        return this._isReady;
    }

    get fieldSize() {
        return this._clock?._fieldSize || [1, 1];
    }

    sync() {
        if (this._clock) {
            return this._clock.sync();
        }
        return false;
    }

    destroy() {
        if (this._stageSignalId) {
            global.stage.disconnect(this._stageSignalId);
            this._stageSignalId = 0;
        }
        if (this._clock) {
            try { this._clock.destroy(); } catch (_) {}
            this._clock = null;
        }
        this._isReady = false;
    }
}
