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





export const WackClock = GObject.registerClass(
    class WackClock extends St.BoxLayout {
        _init() {
            super._init({
                style_class: 'unlock-dialog-clock',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.orientation = Clutter.Orientation.VERTICAL;


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


            this._wallClock = new GnomeDesktop.WallClock({ time_only: true });
            this._wallClock.connectObject('notify::clock',
                this._updateTime.bind(this), this);


            this._clockFormatOverride = null;
            this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this._interfaceSettings.connectObject(
                'changed::clock-format', () => this._updateTime(), this);



            const backend = this.get_context ? this.get_context().get_backend() : Clutter.get_default_backend();
            this._seat = backend.get_default_seat();
            this._seat.connectObject('notify::touch-mode',
                this._updateHint.bind(this), this);


            this._monitorManager = global.backend.get_monitor_manager();
            this._monitorManager.connectObject('power-save-mode-changed',
                () => (this._hint.opacity = 0), this);


            this._idleMonitor = global.backend.get_core_idle_monitor();
            this._idleWatchId = this._idleMonitor.add_idle_watch(HINT_TIMEOUT * 1000, () => {
                this._hint.ease({ opacity: 255, duration: CROSSFADE_TIME });
            });


            this._dateTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60,
                () => { this._updateDate(); return GLib.SOURCE_CONTINUE; });

            this._dateStyle = 'full';
            this._weight = '600';
            this._tint = false;
            this._alpha = 0.85;
            this._promptColor = null;


            this._letterSpacing = -4;
            this._colonRisePx = 12.41;
            this._inColonMarkup = false;

            this._updateTime();
            this._updateDate();
            this._updateHint();
            this._applyTextStyle();
        }






        setClockFormat(format) {
            this._clockFormatOverride = format;
            this._updateTime();
        }





        setDateStyle(style) {
            if (this._dateStyle === style)
                return;
            this._dateStyle = style ?? 'full';
            this._updateDate();
        }






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

                this._time.text = now.format('%-I:%M');
            } else {
                this._time.text = now.format('%H:%M');
            }


            this._colonAppliedRise = null;
            this._colonAppliedText = null;
            this._applyColonMarkup();
        }

        _updateDate() {
            this._dateOutput.text = getPrettyDate(this._dateStyle, this._wallClock, this._locale);
        }




        _updateHint() {
            this._hint.text = this._seat.touch_mode
                ? shellGettext('Swipe up to unlock')
                : shellGettext('Click or press a key to unlock');
        }





        getTextLuminance() {
            return 1.0;
        }

        setWeight(weight) {
            this._weight = weight || '600';
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
            const dateColor = '#ffffff';
            const font = "font-family: 'Default Rounded', sans-serif !important;";
            const weight = `font-weight: ${this._weight || '600'} !important;`;
            const timeShadow = 'text-shadow: 0 1px 10px rgba(0, 0, 0, 0.42) !important;';
            const dateShadow = 'text-shadow: 0 1px 10px rgba(0, 0, 0, 0.42) !important;';
            const letterSpacing = (this._letterSpacing != null)
                ? ` letter-spacing: ${this._letterSpacing}px !important;` : '';
            this._time.set_style(`color: ${timeColor} !important; ${font} ${weight} font-size: 128px !important; ${timeShadow}${letterSpacing} margin: 0 !important; padding: 0 !important;`);
            if (this._time.clutter_text)
                this._time.clutter_text.font_name = 'Default Rounded Semi-Bold 128px';
            this._dateOutput.set_style(`color: ${dateColor} !important; font-family: 'Default Display', default, system-ui, sans-serif, sans-serif !important; font-size: 28px !important; font-weight: 600 !important; text-align: center !important; margin-bottom: 0px !important; padding: 4px 8px !important; ${dateShadow}`);

            this._applyColonMarkup();
        }






        setLetterSpacing(px) {
            this._letterSpacing = (typeof px === 'number') ? px : null;
            this._applyTextStyle();
        }








        setColonRise(px) {
            this._colonRisePx = (typeof px === 'number' && px > 0) ? px : null;
            this._updateTime();
        }





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

                clutterText.set_text(text);
                this._colonAppliedRise = null;
                this._colonAppliedText = null;
            } finally {
                this._inColonMarkup = false;
            }
        }






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
