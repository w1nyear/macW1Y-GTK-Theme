// Tahoe live clock for the dock: real macOS Clock built from vector layers.
// Face + 3 hands + cap are separate SVGs (tahoe-clock-*.svg in kiwi's icons),
// each rasterized by St.Icon at 3x and GPU-downscaled - crisp at any
// magnification, down to the minute ticks. Hands move via rotation_angle_z
// (pure GPU transform, zero repaints, zero Cairo - nothing to segfault).
// The container allocates children itself, so no St.Bin clamp can shrink
// the oversampled layers back to icon size.

import {
    St,
    Clutter,
    Gio,
    GLib,
    GObject,
} from './dependencies/gi.js';

const CLOCK_APP_ID = 'org.gnome.clocks.desktop';
const CLOCK_DIR = 'file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/kiwi@kemma/icons/';

export function isClockApp(app) {
    try {
        return app?.get_id?.() === CLOCK_APP_ID;
    } catch (e) {
        return false;
    }
}

// Fixed icon-size footprint for the dock layout, oversampled layers inside.
const ClockBin = GObject.registerClass({
    GTypeName: 'TahoeClockBin',
}, class TahoeClockBin extends St.Widget {
    _init(iconSize, layerPx) {
        super._init({reactive: false});
        this._clockSize = iconSize;
        this._layerPx = layerPx;
    }

    vfunc_get_preferred_width(_forHeight) {
        return [this._clockSize, this._clockSize];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [this._clockSize, this._clockSize];
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        try {
            const w = box.x2 - box.x1;
            const h = box.y2 - box.y1;
            const cw = this._layerPx;
            for (const child of this.get_children()) {
                const cb = new Clutter.ActorBox();
                cb.x1 = Math.round((w - cw) / 2);
                cb.y1 = Math.round((h - cw) / 2);
                cb.x2 = cb.x1 + cw;
                cb.y2 = cb.y1 + cw;
                child.allocate(cb);
            }
        } catch (e) {
            // layout stays
        }
    }
});

function _layer(file, px) {
    const icon = new St.Icon({
        gicon: Gio.icon_new_for_string(CLOCK_DIR + file),
        icon_size: px,
        reactive: false,
    });
    icon.set_pivot_point(0.5, 0.5);
    return icon;
}

function _tick(bin, hour, min, sec) {
    try {
        const now = GLib.DateTime.new_now_local();
        hour.rotation_angle_z = ((now.get_hour() % 12) + now.get_minute() / 60) * 30;
        min.rotation_angle_z = (now.get_minute() + now.get_second() / 60) * 6;
        sec.rotation_angle_z = now.get_second() * 6;
        // self-correct layer scale if the bin footprint ever changes
        const bw = bin.width || bin._clockSize;
        const s = bw / bin._layerPx;
        for (const l of [hour, min, sec]) {
            if (Math.abs(s - l.scale_x) > 0.001)
                l.set_scale(s, s);
        }
    } catch (e) {
        // clock gone
    }
}

export function createClockIcon(iconSize, oversample) {
    const over = Math.max(3, Math.round(oversample || 3));
    const px = Math.max(1, Math.round(iconSize * over));
    const s0 = 1 / over;

    const bin = new ClockBin(iconSize, px);
    // shims so dock code treating this as an icon keeps working
    bin.iconSize = iconSize;
    bin._iconBin = bin;
    bin.update = () => {};

    const layers = [
        _layer('tahoe-clock5-face.svg', px),
        _layer('tahoe-clock2-hour.svg', px),
        _layer('tahoe-clock2-minute.svg', px),
        _layer('tahoe-clock2-second.svg', px),
        _layer('tahoe-clock2-cap.svg', px),
    ];
    const [face, hour, min, sec, cap] = layers;
    for (const l of layers) {
        l.set_scale(s0, s0);
        bin.add_child(l);
    }

    _tick(bin, hour, min, sec);
    const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        try {
            _tick(bin, hour, min, sec);
        } catch (e) {
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
    bin.connect('destroy', () => {
        try {
            GLib.Source.remove(timer);
        } catch (e) {
            // gone
        }
    });
    return bin;
}
