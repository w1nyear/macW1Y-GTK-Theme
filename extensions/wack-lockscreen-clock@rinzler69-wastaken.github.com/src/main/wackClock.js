import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gettext from 'gettext';

import { HINT_TIMEOUT, CROSSFADE_TIME, getPrettyDate } from './constants.js';
import { getHintTextStyle } from './colorUtils.js';

const shellGettext = Gettext.domain('gnome-shell').gettext.bind(Gettext.domain('gnome-shell'));

/**
 * WackClock handles the custom clock widget for the lock screen.
 * It manages the time, date, and the interaction hint (e.g., "Swipe up to unlock").
 */
export const WackClock = GObject.registerClass(
    class WackClock extends St.BoxLayout {
        _init() {
            super._init({
                style_class: 'unlock-dialog-clock',
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            // Initialize UI components for the clock
            this._dateOutput = new St.Label({
                style_class: 'wack-date',
                x_align: Clutter.ActorAlign.CENTER,
            });

            this._time = new St.Label({
                style_class: 'unlock-dialog-clock-time wack-time',
                x_align: Clutter.ActorAlign.CENTER,
            });

            this._hint = new St.Label({
                style_class: 'unlock-dialog-clock-hint',
                x_align: Clutter.ActorAlign.CENTER,
                opacity: 0,
                visible: true,
            });

            this.add_child(this._dateOutput);
            this.add_child(this._time);

            // Setup the wall clock to update every minute
            this._wallClock = new GnomeDesktop.WallClock({ time_only: true });
            this._wallClock.connectObject('notify::clock',
                this._updateTime.bind(this), this);

            // 12h/24h preference — may be overridden externally via setClockFormat()
            this._clockFormatOverride = null;
            this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._interfaceSettings.connectObject(
                'changed::clock-format', () => this._updateTime(), this);

            // Update the hint based on whether the device is in touch mode
            // get_context() was added in GNOME 48; fall back to Clutter.get_default_backend() on 47.
            const backend = this.get_context ? this.get_context().get_backend() : Clutter.get_default_backend();
            this._seat = backend.get_default_seat();
            this._seat.connectObject('notify::touch-mode',
                this._updateHint.bind(this), this);

            // Handle power save mode changes to prevent flicker
            this._monitorManager = global.backend.get_monitor_manager();
            this._monitorManager.connectObject('power-save-mode-changed',
                () => (this._hint.opacity = 0), this);

            // Show the hint only after a period of user inactivity
            this._idleMonitor = global.backend.get_core_idle_monitor();
            this._idleWatchId = this._idleMonitor.add_idle_watch(HINT_TIMEOUT * 1000, () => {
                this._hint.ease({ opacity: 255, duration: CROSSFADE_TIME });
            });

            // Periodically refresh the date string
            this._dateTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60,
                () => { this._updateDate(); return GLib.SOURCE_CONTINUE; });

            this._dateStyle = 'full';
            this._weight = 'bold';
            this._tint = false;
            this._alpha = 0.85;
            this._promptColor = null;
            // GDM-типографіка (активується лише викликами setLetterSpacing/setColonRise,
            // тому звичайний екран блокування у сесії працює як раніше).
            this._letterSpacing = null;
            this._colonRisePx = null;
            this._inColonMarkup = false;

            this._updateTime();
            this._updateDate();
            this._updateHint();
            this._applyTextStyle();
        }

        /**
         * Override the 12h/24h format independently of the system gsettings.
         * Pass null to revert to the system setting.
         * @param {'12h'|'24h'|null} format
         */
        setClockFormat(format) {
            this._clockFormatOverride = format;
            this._updateTime();
        }

        /**
         * Set the date style ('short' or 'full').
         * @param {'short'|'full'} style
         */
        setDateStyle(style) {
            if (this._dateStyle === style)
                return;
            this._dateStyle = style ?? 'full';
            this._updateDate();
        }

        /**
         * Set the locale override for date formatting.
         * Pass null or undefined to follow the system/environment default.
         * @param {string|null} locale
         */
        setLocale(locale) {
            if (this._locale === locale)
                return;
            this._locale = locale ?? null;
            this._updateDate();
            this._updateHint();
        }

        _updateTime() {
            const clockFormat = this._clockFormatOverride
                ?? this._interfaceSettings.get_string('clock-format');

            const now = GLib.DateTime.new_now_local();

            if (clockFormat === '12h') {
                // %-I strips leading zero on hour (Linux only)
                this._time.text = now.format('%-I:%M');
            } else {
                this._time.text = now.format('%H:%M');
            }

            // Setting .text скидає Pango-атрибути — двокрапку потрібно підняти заново.
            this._colonAppliedRise = null;
            this._colonAppliedText = null;
            this._applyColonMarkup();
        }

        _updateDate() {
            this._dateOutput.text = getPrettyDate(this._dateStyle, this._wallClock, this._locale);
        }

        /**
         * Standardizes the unlock hint text for desktop and touch devices.
         */
        _updateHint() {
            this._hint.text = this._seat.touch_mode
                ? shellGettext('Swipe up to unlock')
                : shellGettext('Click or press a key to unlock');
        }

        /**
         * Gets the relative luminance of the clock's current base text color.
         * @returns {number}
         */
        getTextLuminance() {
            return 1.0; // Statically white text
        }

        setWeight(weight) {
            this._weight = weight || 'bold';
            this._applyTextStyle();
        }

        setTint(tint) {
            this._tint = Boolean(tint);
            this._applyTextStyle();
        }

        setWallpaperAlpha(alpha, promptColor = null) {
            this._alpha = typeof alpha === 'number' ? alpha : 0.85;
            this._promptColor = promptColor;
            this._applyTextStyle();
            if (this._hint)
                this._hint.set_style(getHintTextStyle(promptColor, alpha));
        }

        _applyTextStyle() {
            const timeColor = '#ffffff';
            const dateColor = 'rgba(255, 255, 255, 0.98)';
            const font = "font-family: Open Runde, SF Pro Rounded, SF Pro Display, Cantarell, sans-serif;";
            const weight = `font-weight: ${this._weight || 'bold'};`;
            const timeShadow = 'text-shadow: 0 1px 10px rgba(0, 0, 0, 0.42);';
            const dateShadow = 'text-shadow: 0 1px 5px rgba(0, 0, 0, 0.38);';
            const letterSpacing = (this._letterSpacing != null)
                ? ` letter-spacing: ${this._letterSpacing}px;` : '';
            this._time.set_style(`color: ${timeColor}; ${font} ${weight} ${timeShadow}${letterSpacing}`);
            this._dateOutput.set_style(`color: ${dateColor}; font-family: SF Pro Display, Cantarell, sans-serif; font-weight: 600; margin-bottom: 0px; ${dateShadow}`);
            // Після зміни стилю шрифт може перерахуватись — піднімаємо двокрапку заново.
            this._applyColonMarkup();
        }

        /**
         * Set extra letter spacing (px) for the time label.
         * Negative values tighten the digits; null restores the stylesheet value.
         * @param {number|null} px
         */
        setLetterSpacing(px) {
            this._letterSpacing = (typeof px === 'number') ? px : null;
            this._applyTextStyle();
        }

        /**
         * Lift the ':' glyph so its optical center matches the vertical center
         * of the digits (macOS-style clock colon).
         * @param {number|null} px rise in CSS pixels (масштабується темою):
         *   12.41px для .wack-time 128px — метрика Open Runde
         *   (центр цифр 0.36169em мінус центр двокрапки 0.26474em = 0.09695em).
         */
        setColonRise(px) {
            this._colonRisePx = (typeof px === 'number' && px > 0) ? px : null;
            this._updateTime();
        }

        /**
         * Apply Pango markup that raises ':' by _colonRisePx (Pango units: 1024 == 1px).
         * Повторне застосування відбувається лише коли rise/текст реально змінились.
         */
        _applyColonMarkup() {
            if (this._colonRisePx == null || this._inColonMarkup)
                return;
            const label = this._time;
            const text = label?.text;
            if (!text)
                return;
            const colonIndex = text.indexOf(':');
            if (colonIndex === -1)
                return;
            // CSS px → device px через масштаб теми (global.stage існує завжди,
            // тому rise коректний з першого кадру, до розв'язання шрифту).
            const scale = St.ThemeContext.get_for_stage(global.stage)?.scale_factor || 1;
            const rise = Math.round(this._colonRisePx * scale * 1024);
            if (rise <= 0)
                return;
            if (rise === this._colonAppliedRise && text === this._colonAppliedText)
                return;
            const clutterText = label.get_clutter_text();
            if (!clutterText)
                return;
            const markup = `${text.slice(0, colonIndex)}<span rise="${rise}">:</span>${text.slice(colonIndex + 1)}`;
            this._inColonMarkup = true;
            try {
                clutterText.set_markup(markup);
                this._colonAppliedRise = rise;
                this._colonAppliedText = text;
            } catch (e) {
                // Збій розмітки ніколи не має ламати годинник — відкат на звичайний текст.
                clutterText.set_text(text);
                this._colonAppliedRise = null;
                this._colonAppliedText = null;
            } finally {
                this._inColonMarkup = false;
            }
        }



        /**
         * Clean up timers, monitors, and signal handlers.
         */
        destroy() {
            this._wallClock.disconnectObject(this);
            this._wallClock = null;

            this._interfaceSettings.disconnectObject(this);
            this._interfaceSettings = null;
            this._clockFormatOverride = null;

            this._seat.disconnectObject(this);
            this._seat = null;

            this._monitorManager.disconnectObject(this);
            this._monitorManager = null;

            if (this._idleMonitor && this._idleWatchId) {
                this._idleMonitor.remove_watch(this._idleWatchId);
                this._idleWatchId = null;
            }
            this._idleMonitor = null;

            if (this._dateTimeoutId) {
                GLib.source_remove(this._dateTimeoutId);
                this._dateTimeoutId = null;
            }

            this._letterSpacing = null;
            this._colonRisePx = null;
            this._inColonMarkup = false;
            this._colonAppliedRise = null;
            this._colonAppliedText = null;

            super.destroy();
        }
    });
