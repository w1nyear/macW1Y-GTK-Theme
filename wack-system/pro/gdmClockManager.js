import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WackClock } from '../main/wackClock.js';
import {
    DATE_LABEL_HEIGHT,
    centerClockLabel,
} from '../main/constants.js';
import { GDM_DATETIME_TOP_FRACTION } from './gdmUtils.js';

export class GdmClockManager {
    constructor(gdmManager) {
        this._gdm = gdmManager;
        this.clock = null;
        this.clockWrapper = null;
        this.timeLabel = null;
        this.clockPressed = false;
        this.menuWasOpenOnPress = false;
        this.dateMenuOpenStateId = 0;
    }

    setup(dialog, dialogParent) {
        if (!dialogParent) {
            dialogParent = dialog?.get_parent() || Main.screenShield?._lockDialogGroup || Main.layoutManager?.uiGroup;
        }

        if (this.clockWrapper) {
            try { this.clockWrapper.destroy(); } catch (_) {}
            this.clockWrapper = null;
        }
        if (this.clock) {
            try { this.clock.destroy(); } catch (_) {}
            this.clock = null;
        }


        if (dialogParent?.get_children) {
            for (const child of dialogParent.get_children()) {
                if (child.has_style_class_name && child.has_style_class_name('wack-gdm-clock-wrapper')) {
                    try { child.destroy(); } catch (_) {}
                }
            }
        }


        if (dialog?._clock) {
            dialog._clock.visible = false;
            dialog._clock.opacity = 0;
            dialog._clock.hide();
        }
        if (dialog?._stack?._clock) {
            dialog._stack._clock.visible = false;
            dialog._stack._clock.opacity = 0;
            dialog._stack._clock.hide();
        }

        this.clock = new WackClock();
        const metadata = this._gdm._currentWallpaperMetadata;
        const dateStyle = metadata?.dateStyle ?? 'full';
        const userLocale = dialog?._user?.get_language() || metadata?.userLocale || null;
        this.clock.setDateStyle(dateStyle);
        this.clock.setLocale(userLocale);
        if (metadata?.clockWeight !== undefined && typeof this.clock.setWeight === 'function')
            this.clock.setWeight(metadata.clockWeight);
        if (metadata?.clockFormat !== undefined && typeof this.clock.setClockFormat === 'function')
            this.clock.setClockFormat(metadata.clockFormat);
        if (metadata?.clockTint !== undefined && typeof this.clock.setTint === 'function')
            this.clock.setTint(metadata.clockTint);
        if (metadata?.clockAlpha !== undefined && metadata?.clockAlpha !== null && typeof this.clock.setWallpaperAlpha === 'function')
            this.clock.setWallpaperAlpha(metadata.clockAlpha, metadata?.promptColor ?? null);




        if (typeof this.clock.setWeight === 'function')
            this.clock.setWeight('600');
        if (typeof this.clock.setLetterSpacing === 'function')
            this.clock.setLetterSpacing(-6);
        if (typeof this.clock.setColonRise === 'function')
            this.clock.setColonRise(13.0);

        const dateLabel = this.clock._dateOutput;
        const timeLabel = this.clock._time;
        this.timeLabel = timeLabel;
        this.clock.remove_child(dateLabel);
        this.clock.remove_child(timeLabel);

        this.clockWrapper = new St.Widget({
            style_class: 'wack-gdm-clock-wrapper',
            reactive: false,
            track_hover: false,
        });
        this.clockWrapper._delegate = this;
        this.clockWrapper.set_pivot_point(0.5, 0.5);
        this.clockWrapper.add_child(dateLabel);
        this.clockWrapper.add_child(timeLabel);

        centerClockLabel(timeLabel, this.clockWrapper);
        centerClockLabel(dateLabel, this.clockWrapper);

        if (!dialogParent) {
            dialogParent = dialog?.get_parent() || Main.screenShield?._lockDialogGroup || Main.layoutManager?.uiGroup;
        }
        if (this.clockWrapper.get_parent()) {
            this.clockWrapper.get_parent().remove_child(this.clockWrapper);
        }
        dialogParent.add_child(this.clockWrapper);
        dialogParent.set_child_above_sibling(this.clockWrapper, null);

        this.clockWrapper.visible = true;
        this.clockWrapper.opacity = 255;
        dateLabel.set_style("color: #ffffff !important; font-family: 'Default Display', default, system-ui, sans-serif, sans-serif !important; font-size: 28px !important; font-weight: 600 !important; text-align: center !important; text-shadow: 0 1px 10px rgba(0, 0, 0, 0.42) !important; padding: 4px 8px !important;");
        dateLabel.visible = true;
        dateLabel.opacity = 255;
        timeLabel.add_style_class_name('wack-time');
        timeLabel.set_style("color: #ffffff !important; font-family: 'Default Rounded', 'Default Display', default, system-ui, sans-serif, sans-serif !important; font-size: 128px !important; font-weight: 600 !important; text-align: center !important; text-shadow: 0 1px 10px rgba(0, 0, 0, 0.42) !important; letter-spacing: -4px !important; margin: 0 !important; padding: 0 !important;");
        timeLabel.ensure_style();
        timeLabel.visible = true;
        timeLabel.opacity = 255;

        dateLabel.connectObject('notify::text', () => this.positionClock(), this);

        if (dialog)
            this._gdm._connectAllocation(dialog, () => this.positionClock());

        this.timeLabel.connectObject('notify::text', () => {
            this.positionClock();
        }, this);

        this.clock._dateOutput.connectObject('notify::text', () => {
            this.positionClock();
        }, this);

        this.positionClock();

        if (Main.panel?.statusArea?.dateMenu) {
            Main.panel.statusArea.dateMenu.hide();
        }

        this.clockWrapper.opacity = 255;
    }

    teardown() {

        if (this.timeLabel) {
            this.timeLabel.disconnectObject(this);
            this.timeLabel = null;
        }

        if (this.clock?._dateOutput) {
            this.clock._dateOutput.disconnectObject(this);
        }

        if (this.dateMenuOpenStateId && Main.panel?.statusArea?.dateMenu?.menu) {
            Main.panel.statusArea.dateMenu.menu.disconnect(this.dateMenuOpenStateId);
            this.dateMenuOpenStateId = 0;
        }

        if (Main.panel?.statusArea?.dateMenu) {
            const dateMenuBtn = Main.panel.statusArea.dateMenu;
            if (dateMenuBtn.menu) {
                if (dateMenuBtn.menu.sourceActor === this.clockWrapper)
                    dateMenuBtn.menu.sourceActor = dateMenuBtn;
                if (dateMenuBtn.menu._boxPointer) {
                    dateMenuBtn.menu._boxPointer.updateArrowSide(St.Side.TOP);
                    dateMenuBtn.menu._boxPointer.setSourceAlignment(0.5);
                    dateMenuBtn.menu._boxPointer.setPosition(dateMenuBtn, 0.5);
                }
                if (dateMenuBtn.menu.actor)
                    dateMenuBtn.menu.actor.style = null;
            }
            dateMenuBtn.show();
        }

        if (this.clockWrapper) {
            this.clockWrapper.disconnectObject(this);
            this.clockWrapper.destroy();
            this.clockWrapper = null;
        }

        if (this.clock) {
            this.clock.destroy();
            this.clock = null;
        }

        this.clockPressed = false;
        this.menuWasOpenOnPress = false;
    }

    positionClock(dialogBox = null) {
        if (!this.clock || !this.clockWrapper) return;
        const monitor = Main.layoutManager.primaryMonitor || { x: 0, y: 0, width: 1920, height: 1080 };
        const alloc = dialogBox || (this._gdm._dialog ? this._gdm._dialog.get_allocation_box() : null);
        let w = alloc ? (alloc.x2 - alloc.x1) : monitor.width;
        let h = alloc ? (alloc.y2 - alloc.y1) : monitor.height;
        if (w <= 0 || w > 32768) w = monitor.width;
        if (h <= 0 || h > 32768) h = monitor.height;
        let startX = (alloc && alloc.x1 >= 0 && alloc.x1 < 32768) ? alloc.x1 : monitor.x;

        const topY = monitor.y + Math.floor(h * GDM_DATETIME_TOP_FRACTION);
        this.clock._dateOutput.ensure_style();
        const rawDateH = this.clock._dateOutput.get_preferred_height(-1)[1];
        const preferredDateH = (rawDateH > 0 && rawDateH < 500) ? rawDateH : 36;
        const effectiveDateH = Math.max(42, Math.min(80, Math.ceil(preferredDateH)));
        const timeY = effectiveDateH - 4;

        const oldDateConstraint = this.clock._dateOutput.get_constraint('wack-clock-center-x');
        if (oldDateConstraint) {
            this.clock._dateOutput.remove_constraint(oldDateConstraint);
        }
        const [, rawDateW] = this.clock._dateOutput.get_preferred_width(-1);
        const preferredDateW = (rawDateW > 0 && rawDateW < w) ? Math.ceil(rawDateW) : Math.min(600, w);
        const dateX = Math.round((w - preferredDateW) / 2);

        this.clock._dateOutput.set_position(dateX, 0);
        this.clock._dateOutput.set_size(preferredDateW, effectiveDateH);
        if (this.clock._dateOutput.clutter_text) {
            this.clock._dateOutput.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            this.clock._dateOutput.clutter_text.set_x_align(Clutter.ActorAlign.CENTER);
        }
        this.clock._dateOutput.set_x_align(Clutter.ActorAlign.CENTER);

        const oldTimeConstraint = this.clock._time.get_constraint('wack-clock-center-x');
        if (oldTimeConstraint) {
            this.clock._time.remove_constraint(oldTimeConstraint);
        }

        this.timeLabel.ensure_style();
        const pSize = this.timeLabel.clutter_text?.get_layout()?.get_pixel_size();
        const rawTimeW = (pSize && pSize[0] > 0) ? pSize[0] : (this.timeLabel.get_preferred_width(-1)[1] || 350);
        const rawTimeH = (pSize && pSize[1] > 0) ? pSize[1] : (this.timeLabel.get_preferred_height(-1)[1] || 166);
        const effectiveTimeW = Math.min(rawTimeW, w);
        const effectiveTimeH = Math.max(120, Math.min(250, Math.ceil(rawTimeH)));
        const timeX = Math.round((w - effectiveTimeW) / 2);

        this.clockWrapper.set_size(w, timeY + effectiveTimeH + 20);
        this.timeLabel.set_position(timeX, timeY);
        this.timeLabel.set_size(effectiveTimeW, effectiveTimeH);
        if (this.timeLabel.clutter_text) {
            this.timeLabel.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            this.timeLabel.clutter_text.set_x_align(Clutter.ActorAlign.CENTER);
        }
        this.timeLabel.set_x_align(Clutter.ActorAlign.CENTER);
        this.timeLabel.visible = true;
        this.timeLabel.opacity = 255;

        this.clockWrapper.set_position(startX, topY);
        this.clockWrapper.set_pivot_point(0.5, 0.5);
        this.clockWrapper.opacity = 255;
        this.clockWrapper.visible = true;


    }

    isPointInsideClock(_stageX, _stageY) {
        return false;
    }

    syncClockGlowState(_animate = true) {
        if (!this.clockWrapper) return;
        this.clockWrapper.scale_x = 1.0;
        this.clockWrapper.scale_y = 1.0;
    }

    toggleDateMenu() {

        return;
    }

    setUserLocale(locale) {
        if (this.clock) {
            this.clock.setLocale(locale);
        }
    }

    setWallpaperAlpha(alpha, promptColor = null) {
        if (this.clock) {
            this.clock.setWallpaperAlpha(alpha, promptColor);
        }
    }

    setClockFormat(format) {
        if (typeof this.clock?.setClockFormat === 'function') {
            this.clock.setClockFormat(format);
        }
    }

    setWeight(weight) {


        if (typeof this.clock?.setWeight === 'function') {
            this.clock.setWeight('600');
        }
    }

    setTint(tint) {
        if (this.clock) {
            this.clock.setTint(tint);
        }
    }

    setDateStyle(style) {
        if (this.clock) {
            this.clock.setDateStyle(style);
        }
    }
}
