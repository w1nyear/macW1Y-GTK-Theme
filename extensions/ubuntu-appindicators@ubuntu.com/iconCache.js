


// modify it under the terms of the GNU General Public License

// of the License, or (at your option) any later version.




// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License



import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as PromiseUtils from './promiseUtils.js';
import * as Util from './util.js';







const GC_INTERVAL = 100;
const LIFETIME_TIMESPAN = 120;


export class IconCache {
    constructor() {
        this._cache = new Map();
        this._activeIcons = Object.create(null);
        this._lifetime = new Map();
    }

    add(id, icon) {
        if (!(icon instanceof Gio.Icon)) {
            Util.Logger.critical('IconCache: Only Gio.Icons are supported');
            return null;
        }

        if (!id) {
            Util.Logger.critical('IconCache: Invalid ID provided');
            return null;
        }

        const oldIcon = this._cache.get(id);
        if (!oldIcon || !oldIcon.equal(icon)) {
            Util.Logger.debug(`IconCache: adding ${id}: ${icon}`);
            this._cache.set(id, icon);
        } else {
            icon = oldIcon;
        }

        this._renewLifetime(id);
        this._checkGC();

        return icon;
    }

    updateActive(iconType, gicon, isActive) {
        if (!gicon)
            return;

        const previousActive = this._activeIcons[iconType];

        if (isActive && [...this._cache.values()].some(icon => icon === gicon))
            this._activeIcons[iconType] = gicon;
        else if (previousActive === gicon)
            delete this._activeIcons[iconType];
        else
            return;

        if (previousActive) {
            this._cache.forEach((icon, id) => {
                if (icon === previousActive)
                    this._renewLifetime(id);
            });
        }
    }

    _remove(id) {
        Util.Logger.debug(`IconCache: removing ${id}`);

        this._cache.delete(id);
        this._lifetime.delete(id);
    }

    _renewLifetime(id) {
        this._lifetime.set(id, new Date().getTime() + LIFETIME_TIMESPAN * 1000);
    }

    forceDestroy(id) {
        const gicon = this._cache.has(id);
        if (gicon) {
            Object.keys(this._activeIcons).forEach(iconType =>
                this.updateActive(iconType, gicon, false));
            this._remove(id);
            this._checkGC();
        }
    }


    weakClear() {
        this._activeIcons = Object.create(null);
        this._checkGC();
    }


    clear() {
        this._activeIcons = Object.create(null);
        this._cache.forEach((_icon, id) => this._remove(id));
        this._checkGC();
    }


    get(id) {
        const icon = this._cache.get(id);
        if (icon) {
            Util.Logger.debug(`IconCache: retrieving ${id}: ${icon}`);
            this._renewLifetime(id);
            return icon;
        }

        return null;
    }

    async _checkGC() {
        const cacheIsEmpty = this._cache.size === 0;

        if (!cacheIsEmpty && !this._gcTimeout) {
            Util.Logger.debug('IconCache: garbage collector started');
            let anyUnusedInCache = false;
            this._gcTimeout = new PromiseUtils.TimeoutSecondsPromise(GC_INTERVAL,
                GLib.PRIORITY_LOW);
            try {
                await this._gcTimeout;
                anyUnusedInCache = this._gc();
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e, 'IconCache: garbage collector');
            } finally {
                delete this._gcTimeout;
            }

            if (anyUnusedInCache)
                this._checkGC();
        } else if (cacheIsEmpty && this._gcTimeout) {
            Util.Logger.debug('IconCache: garbage collector stopped');
            this._gcTimeout.cancel();
        }
    }

    _gc() {
        const time = new Date().getTime();
        let anyUnused = false;

        this._cache.forEach((icon, id) => {
            if (Object.values(this._activeIcons).includes(icon)) {
                Util.Logger.debug(`IconCache: ${id} is in use.`);
            } else if (this._lifetime.get(id) < time) {
                this._remove(id);
            } else {
                anyUnused = true;
                Util.Logger.debug(`IconCache: ${id} survived this round.`);
            }
        });

        return anyUnused;
    }

    destroy() {
        this.clear();
    }
}
