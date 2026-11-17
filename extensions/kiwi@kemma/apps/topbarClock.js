// SPDX-License-Identifier: GPL-3.0-or-later





import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getTopbarInk, watchInk} from './tahoeInk.js';

let enabled = false;
let clockSource = null;
let clockId = 0;
let inkUnwatch = null;
let savedStyle = null;



function applyInk() {
    try {
        const d = Main.panel?.statusArea?.dateMenu?._clockDisplay;
        if (!d)
            return;
        if (savedStyle === null) {
            try {
                savedStyle = d.get_style() ?? '';
            } catch (_) {
                savedStyle = '';
            }
        }
        const col = getTopbarInk() === 'dark' ? '#1d1d1f' : '#ffffff';
        const base = (savedStyle ?? '').trim();
        d.set_style(`${base}${base && !base.endsWith(';') ? ';' : ''}color: ${col};`);
    } catch (_) {

    }
}

function apply() {
    const dateMenu = Main.panel.statusArea.dateMenu;
    if (!dateMenu?._clockDisplay)
        return;
    try {
        const dt = GLib.DateTime.new_now_local();
        if (dt) {
            const dayStr = dt.format('%a');
            const dayNum = dt.format('%-e') || dt.format('%d');
            const monthStr = dt.format('%b');
            const timeStr = dt.format('%-H:%M') || dt.format('%H:%M');
            dateMenu._clockDisplay.text = `${dayStr} ${dayNum} ${monthStr} ${timeStr}`;
            return;
        }
    } catch (_) {}
    const now = new Date();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    dateMenu._clockDisplay.text = `${now.getDate()} ${now.getHours()}:${minutes}`;
}

export function enable() {
    if (enabled)
        return;
    enabled = true;

    const dateMenu = Main.panel.statusArea.dateMenu;
    if (!dateMenu?._clock || !dateMenu._clockDisplay)
        return;

    clockSource = dateMenu._clock;
    clockId = clockSource.connect('notify::clock', apply);
    apply();
    try {
        if (!inkUnwatch)
            inkUnwatch = watchInk(() => applyInk());
    } catch (_) {
        inkUnwatch = null;
    }
    applyInk();
}

export function disable() {
    if (!enabled)
        return;
    enabled = false;

    if (clockId) {
        try {
            clockSource.disconnect(clockId);
        } catch (e) {

        }
    }
    clockSource = null;
    clockId = 0;
    if (inkUnwatch) {
        try {
            inkUnwatch();
        } catch (e) {

        }
        inkUnwatch = null;
    }

    try {
        const dateMenu = Main.panel?.statusArea?.dateMenu;
        if (dateMenu?._clockDisplay) {
            if (savedStyle)
                dateMenu._clockDisplay.set_style(savedStyle);
            else {
                try {
                    dateMenu._clockDisplay.set_style(null);
                } catch (_) {
                    dateMenu._clockDisplay.set_style('');
                }
            }
        }
    } catch (e) {

    }
    savedStyle = null;


    const dateMenu = Main.panel.statusArea.dateMenu;
    if (dateMenu?._clock && dateMenu._clockDisplay)
        dateMenu._clockDisplay.text = dateMenu._clock.clock;
}
