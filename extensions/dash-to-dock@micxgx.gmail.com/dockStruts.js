

































import GObject from 'gi://GObject';

import {registerDestroyableType} from 'resource:///org/gnome/shell/misc/signalTracker.js';

import {Main} from './dependencies/shell/ui.js';









export const DashToDockStruts = GObject.registerClass({
    Signals: {
        'updated': {param_types: [GObject.TYPE_INT]},
        'destroy': {},
    },
}, class DashToDockStruts extends GObject.Object {
    #manager;

    constructor(manager) {
        super();
        this.#manager = manager;
    }

    /**
     * The per-monitor reserved extents, keyed by monitor index.
     *
     * Each entry is `{side, x, y, width, height, affectsStruts}` in global
     * coordinates. The object is frozen and replaced whenever it changes.
     *
     * @type {Readonly<Record<number, object>>}
     */
    get monitors() {
        return this.#manager.monitors;
    }
});
registerDestroyableType(DashToDockStruts);

export class StrutsManager {
    #monitors = new Map();
    #frozenMonitors = Object.freeze({});
    #struts = new DashToDockStruts(this);

    constructor() {
        Main.layoutManager.dashToDockStruts = this.#struts;
    }


    get monitors() {
        return this.#frozenMonitors;
    }

    /**
     * Set or clear the reserved extent for the dock on a monitor.
     *
     * The extent is the dock's full-size rectangle, independent of its
     * current slide offset, so callers may push it on every geometry update:
     * only genuine changes are published.
     *
     * @param {number} monitorIndex - the monitor the dock is on.
     * @param {object|null} extent - `{side, x, y, width, height,
     *     affectsStruts}` in global coordinates, or `null` to drop the entry.
     */
    setMonitorExtent(monitorIndex, extent) {
        const previous = this.#monitors.get(monitorIndex) ?? null;
        const unchanged = previous !== null && extent !== null &&
            previous.side === extent.side &&
            previous.x === extent.x && previous.y === extent.y &&
            previous.width === extent.width && previous.height === extent.height &&
            previous.affectsStruts === extent.affectsStruts;

        if (unchanged)
            return;

        if (extent === null)
            this.#monitors.delete(monitorIndex);
        else
            this.#monitors.set(monitorIndex, extent);

        this.#publish(monitorIndex);
    }

    clear() {
        if (this.#monitors.size === 0)
            return;

        this.#monitors.clear();
        this.#publish(-1);
    }

    destroy() {
        this.clear();
        if (Main.layoutManager.dashToDockStruts === this.#struts)
            delete Main.layoutManager.dashToDockStruts;

        this.#struts.emit('destroy');
    }






    #publish(monitorIndex) {
        this.#frozenMonitors = Object.freeze(Object.fromEntries(this.#monitors));
        this.#struts.emit('updated', monitorIndex);
    }
}
