import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let BlurModule = null;
try {
    BlurModule = globalThis.imports?.gi?.Blur;
} catch (_) {}












export class MacFeatheredBackdropBlur {
    constructor(name = 'mac-feathered-backdrop-blur') {
        this.name = name;
        this.padOrange = 12.0;
        this.fadeWidth = 75.0;
        this.steps = 10;
        this.blurRadius = 10;

        this.actor = new St.Widget({
            name: this.name,
            reactive: false,
            can_focus: false,
            visible: false,
            opacity: 0,
            style: 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;',
        });

        this._lastX = -1;
        this._lastY = -1;
        this._lastW = -1;
        this._lastH = -1;
    }

    _createBlurEffect(radius = 10) {
        if (BlurModule?.BlurEffect) {
            try {
                return new BlurModule.BlurEffect({
                    mode: BlurModule.BlurMode?.BACKGROUND ?? 1,
                    radius: radius,
                });
            } catch (_) {}
        }
        return new Shell.BlurEffect({
            mode: Shell.BlurMode.BACKGROUND,
            radius: radius,
        });
    }

    updateGeometry(contentX, contentY, contentW, contentH) {
        if (!this.actor || this.actor.is_finalized?.()) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        contentX = Math.round(contentX);
        contentY = Math.round(contentY);
        contentW = Math.round(contentW);
        contentH = Math.round(contentH);

        if (this._lastX === contentX &&
            this._lastY === contentY &&
            this._lastW === contentW &&
            this._lastH === contentH) {
            return;
        }

        this._lastX = contentX;
        this._lastY = contentY;
        this._lastW = contentW;
        this._lastH = contentH;

        this.actor.destroy_all_children();

        const monX = monitor.x;
        const monY = monitor.y;
        const rightEdge = monX + monitor.width;

        const orangeX = Math.round(contentX - this.padOrange);
        const orangeBottomY = Math.round(contentY + contentH + this.padOrange);

        const fade = this.fadeWidth;
        const steps = this.steps;
        const stepSize = fade / steps;


        this.actor.set_position(0, 0);
        this.actor.set_size(monitor.width, monitor.height);

        const stripStyle = 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;';



        const topH = Math.max(1, contentY - monY + 2);
        const topStrip = new St.Widget({
            x: orangeX,
            y: monY,
            width: Math.max(10, rightEdge - orangeX),
            height: topH,
            opacity: 255,
            style: stripStyle,
        });
        topStrip.add_effect(this._createBlurEffect(this.blurRadius));
        this.actor.add_child(topStrip);


        if (this.padOrange > 0) {
            const leftPadStrip = new St.Widget({
                x: orangeX,
                y: contentY,
                width: Math.max(1, contentX - orangeX),
                height: contentH,
                opacity: 255,
                style: stripStyle,
            });
            leftPadStrip.add_effect(this._createBlurEffect(this.blurRadius));
            this.actor.add_child(leftPadStrip);
        }


        if (this.padOrange > 0) {
            const bottomPadStrip = new St.Widget({
                x: orangeX,
                y: contentY + contentH,
                width: Math.max(10, rightEdge - orangeX),
                height: Math.max(1, orangeBottomY - (contentY + contentH)),
                opacity: 255,
                style: stripStyle,
            });
            bottomPadStrip.add_effect(this._createBlurEffect(this.blurRadius));
            this.actor.add_child(bottomPadStrip);
        }



        for (let i = 0; i < steps; i++) {
            const stripX = Math.round(orangeX - (i + 1) * stepSize);
            const t = 1.0 - (i / steps);
            const smoothT = t * t * (3.0 - 2.0 * t);
            const op = Math.round(255 * smoothT);
            if (op < 3) continue;

            const strip = new St.Widget({
                x: stripX,
                y: monY,
                width: Math.ceil(stepSize) + 1,
                height: Math.max(1, orangeBottomY - monY),
                opacity: op,
                style: stripStyle,
            });
            strip.add_effect(this._createBlurEffect(this.blurRadius));
            this.actor.add_child(strip);
        }



        for (let j = 0; j < steps; j++) {
            const stripY = Math.round(orangeBottomY + j * stepSize);
            const t = 1.0 - (j / steps);
            const smoothT = t * t * (3.0 - 2.0 * t);
            const op = Math.round(255 * smoothT);
            if (op < 3) continue;

            const strip = new St.Widget({
                x: orangeX,
                y: stripY,
                width: Math.max(10, rightEdge - orangeX),
                height: Math.ceil(stepSize) + 1,
                opacity: op,
                style: stripStyle,
            });
            strip.add_effect(this._createBlurEffect(this.blurRadius));
            this.actor.add_child(strip);
        }


        for (let i = 0; i < steps; i++) {
            for (let j = 0; j < steps; j++) {
                const dist = Math.hypot(i + 0.5, j + 0.5);
                if (dist <= steps) {
                    const t = Math.max(0.0, 1.0 - (dist / steps));
                    const smoothT = t * t * (3.0 - 2.0 * t);
                    const op = Math.round(255 * smoothT);
                    if (op > 5) {
                        const cell = new St.Widget({
                            x: Math.round(orangeX - (i + 1) * stepSize),
                            y: Math.round(orangeBottomY + j * stepSize),
                            width: Math.ceil(stepSize) + 1,
                            height: Math.ceil(stepSize) + 1,
                            opacity: op,
                            style: stripStyle,
                        });
                        cell.add_effect(this._createBlurEffect(this.blurRadius));
                        this.actor.add_child(cell);
                    }
                }
            }
        }



    }

    show() {
        if (!this.actor || this.actor.is_finalized?.()) return;
        this.actor.visible = true;
        this.actor.show();
    }

    hide() {
        if (!this.actor || this.actor.is_finalized?.()) return;
        this.actor.remove_all_transitions();
        this.actor.visible = false;
        this.actor.hide();
        this.actor.opacity = 0;
        this.actor.translation_x = 0;
    }

    animateSlideIn(fromX = 220, duration = 240) {
        if (!this.actor || this.actor.is_finalized?.()) return;
        this.show();
        this.actor.remove_all_transitions();
        this.actor.translation_x = fromX;
        this.actor.opacity = 0;
        this.actor.ease({
            translation_x: 0,
            opacity: 255,
            duration: duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    animateSlideOut(toX = 220, duration = 200, onComplete = null) {
        if (!this.actor || this.actor.is_finalized?.()) {
            onComplete?.();
            return;
        }
        this.actor.remove_all_transitions();
        this.actor.ease({
            translation_x: toX,
            opacity: 0,
            duration: duration,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                this.hide();
                onComplete?.();
            },
        });
    }

    destroy() {
        if (this.actor && !this.actor.is_finalized?.()) {
            this.actor.remove_all_transitions();
            this.actor.destroy_all_children();
            if (this.actor.get_parent()) {
                this.actor.get_parent().remove_child(this.actor);
            }
            this.actor.destroy();
        }
        this.actor = null;
    }
}
