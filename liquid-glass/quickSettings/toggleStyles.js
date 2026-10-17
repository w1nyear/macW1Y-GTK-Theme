import St from 'gi://St';
import GLib from 'gi://GLib';
import { QS_MENU_TOGGLE_CLASS } from '../shellVersion.js';
// Quick Settings' toggle-button mode: every toggle pod gets its own piece of
// glass. This finds the pods, samples each pod's own colour (it changes with
// ON/OFF and hover) for the glass's base colour, and makes the pod's own
// backgrounds transparent so the glass shows through.
const TRANSPARENT_OVERRIDE = 'background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;';

function _withOverride(origStyle) {
    return origStyle ? `${origStyle} ${TRANSPARENT_OVERRIDE}` : TRANSPARENT_OVERRIDE;
}

function _releaseEntry(pod, entry) {
    if (entry.destroyId)
        pod.disconnect(entry.destroyId);
    for (const { actor, origStyle } of entry.styledSubs) {
        if (actor instanceof St.Widget)
            actor.set_style(origStyle || null);
    }
}

export class ToggleStyles {
    _logger;
    _isOpen;

    constructor(_logger, _isOpen) {
        this._logger = _logger;
        this._isOpen = _isOpen;
    }

    sync(root) {
        const toggles = this._findAllToggleContainers(root);
        this._collectActiveSubmenus(root, toggles);
        this._ensureToggleStyles(toggles);
        return toggles;
    }

    _collectActiveSubmenus(actor, found) {
        if (!actor) return;
        if (actor instanceof St.Widget && actor.has_style_class_name('quick-toggle-menu')) {
            if (actor.visible && actor.mapped && !found.includes(actor)) {
                found.push(actor);
            }
        }
        for (let child of actor.get_children()) {
            this._collectActiveSubmenus(child, found);
        }
    }

    colorFor(actor) {
        return this._toggleRegions.get(actor);
    }

    // Logs the sampled colours for the next few passes (with logging on).
    resetDiagnostics() {
        this._debugToggleColorLogFrames = 15;
    }

    // How often each pod's colour is re-read, i.e. how quickly the glass
    // follows a toggle's ON/OFF and hover state. Pods whose state is unchanged
    // are skipped, so a steady tick is cheap.
    static TOGGLE_COLOR_SAMPLE_MS = 100;
    // Every Nth pass re-samples every pod anyway, to catch a theme change,
    // which changes colours without changing any state.
    static TOGGLE_COLOR_FULL_PASS_EVERY = 8;
    // Pod -> its sampled colour and the actors whose backgrounds were made
    // transparent, with their original inline styles.
    _toggleRegions = new Map();
    _toggleColorTimerId = 0;
    _resamplePassCount = 0;
    _debugToggleColorLogFrames = 15;

    // Finds the pods under `actor`, without descending into a pod:
    //  - a `.quick-toggle-has-menu` wrapper (`.quick-menu-toggle` before GNOME
    //    48; Wi-Fi, Bluetooth): the main button, the separator and the arrow
    //    button together form one shape;
    //  - a standalone `.quick-toggle` (Night Light, Do Not Disturb, ...);
    //  - an `.icon-button` inside `.quick-settings-system-item` (screenshot,
    //    settings, lock, power), which themes also draw as pills. Elsewhere
    //    `.icon-button` is also used by slider and submenu buttons;
    //  - a `.quick-slider` row, but only on themes that paint a pill around it
    //    (see _paintsOwnBackground()).
    _findAllToggleContainers(actor, found = [], inSystemItem = false) {
        if (!actor)
            return found;
        try {
            const leaf = this._toggleLeafKind(actor, inSystemItem);
            if (leaf === 'slider') {
                if (actor.visible)
                    found.push(actor);
                return found;
            }
            if (leaf === 'toggle') {
                if (actor.visible)
                    found.push(actor);
                return found;
            }
            if (leaf === 'submenu') {
                if (actor.visible && actor.mapped)
                    found.push(actor);
                return found;
            }
            let entersSystemItem = inSystemItem ||
                (actor instanceof St.Widget && actor.has_style_class_name('quick-settings-system-item'));
            for (let child of actor.get_children())
                this._findAllToggleContainers(child, found, entersSystemItem);
        } catch (_) {}
        return found;
    }

    _toggleLeafKind(actor, inSystemItem) {
        if (!(actor instanceof St.Widget))
            return null;
        if (actor.has_style_class_name('mac-cc-submenu-header') ||
            actor.has_style_class_name('mac-cc-submenu-item') ||
            actor.has_style_class_name('mac-cc-back-btn'))
            return null;
        if (actor.has_style_class_name('mac-cc-submenu-card'))
            return 'toggle';
        if (actor.has_style_class_name(QS_MENU_TOGGLE_CLASS))
            return 'toggle';
        if (actor.has_style_class_name('quick-toggle'))
            return 'toggle';
        if (actor.has_style_class_name('mac-cc-pill'))
            return 'toggle';
        if (actor.has_style_class_name('mac-cc-circle-btn-large'))
            return 'toggle';
        if (actor.has_style_class_name('mac-cc-card'))
            return 'toggle';
        // Screenshot, settings, lock and power.
        if (inSystemItem && actor.has_style_class_name('icon-button'))
            return 'toggle';
        if (actor.has_style_class_name('quick-slider'))
            return 'slider';
        if (actor.has_style_class_name('quick-toggle-menu'))
            return 'submenu';
        return null;
    }

    _paintsOwnBackground(_actor) {
        return true;
    }

    // Every St.Widget in the pod, at any depth. All of them get the
    // transparency override, which is harmless for icons and labels and does
    // not depend on the theme's exact structure.
    _getStylableSubActors(pod) {
        const found = [];
        const walk = (actor) => {
            if (actor instanceof St.Widget) {
                if (actor !== pod && (
                    actor.has_style_class_name('mac-cc-pill-icon-btn') ||
                    actor.has_style_class_name('mac-cc-slider-track') ||
                    actor.has_style_class_name('mac-cc-media-art') ||
                    actor.has_style_class_name('mac-cc-airplay-btn') ||
                    actor.has_style_class_name('slider') ||
                    actor.has_style_class_name('mac-cc-transport-btn')
                )) {
                    return;
                }
                found.push(actor);
            }
            for (let child of actor.get_children())
                walk(child);
        };
        walk(pod);
        return found;
    }

    // The actor whose colour represents the pod: for a has-menu pod, its main
    // `.quick-toggle` button, which may sit more than one level down.
    _getPrimaryToggleButton(pod) {
        if (pod instanceof St.Widget && pod.has_style_class_name(QS_MENU_TOGGLE_CLASS)) {
            let found = null;
            const search = (actor) => {
                if (found)
                    return;
                for (let child of actor.get_children()) {
                    if (found)
                        return;
                    if (child instanceof St.Widget && child.has_style_class_name('quick-toggle')) {
                        found = child;
                        return;
                    }
                    search(child);
                }
            };
            search(pod);
            if (found)
                return found;
        }
        return pod;
    }

    // Some themes put a toggle's ON/OFF colour on its `.quick-toggle-icon`.
    _getToggleIconActors(root) {
        const found = [];
        const walk = (actor) => {
            if (actor instanceof St.Widget && actor.has_style_class_name('quick-toggle-icon')) {
                found.push(actor);
            }
            for (let child of actor.get_children())
                walk(child);
        };
        if (root)
            walk(root);
        return found;
    }

    // The theme background as normalized {r, g, b, a}, falling back to the
    // average of a background gradient when the flat colour is transparent.
    _readThemeBg(actor) {
        if (!(actor instanceof St.Widget))
            return null;
        actor.ensure_style();
        let themeNode = actor.get_theme_node();
        let bg = themeNode.get_background_color();
        if (bg.alpha / 255 > 0.02)
            return { r: bg.red / 255, g: bg.green / 255, b: bg.blue / 255, a: bg.alpha / 255 };
        let [gradType, start, end] = themeNode.get_background_gradient();
        if (gradType !== St.GradientType.NONE) {
            let a = ((start.alpha + end.alpha) / 2) / 255;
            if (a > 0.02) {
                return {
                    r: ((start.red + end.red) / 2) / 255,
                    g: ((start.green + end.green) / 2) / 255,
                    b: ((start.blue + end.blue) / 2) / 255,
                    a,
                };
            }
        }
        return { r: bg.red / 255, g: bg.green / 255, b: bg.blue / 255, a: bg.alpha / 255 };
    }

    // What is actually visible at `actor`: its own background composited over
    // its ancestors' until opaque. A transparent background still reports RGB
    // (usually black) that the theme never paints; this replaces it with the
    // colour really showing there. `a` is the accumulated coverage.
    _compositeOverAncestors(actor, own) {
        // Front-to-back "over" accumulation.
        let outR = 0, outG = 0, outB = 0, outA = 0;
        const add = (c) => {
            if (!c || !(c.a > 0))
                return;
            let w = c.a * (1 - outA);
            outR += c.r * w;
            outG += c.g * w;
            outB += c.b * w;
            outA += w;
        };
        add(own);
        let node = actor ? actor.get_parent() : null;
        // Bounds the walk, which runs on every sampling pass.
        let guard = 32;
        while (node && outA < 0.995 && guard-- > 0) {
            if (node instanceof St.Widget)
                add(this._readThemeBg(node));
            node = node.get_parent();
        }
        if (outA <= 0)
            return { r: 0, g: 0, b: 0, a: 0 };
        return { r: outR / outA, g: outG / outA, b: outB / outA, a: outA };
    }

    // The pod's visible colour. Themes put a toggle's state colour in different
    // places: Adwaita on the inner `.quick-toggle`, MacTahoe on the has-menu
    // wrapper (whose inner button is `background: none`) or only on the
    // `.quick-toggle-icon`. Every candidate is read, the most opaque wins
    // (ties go to the earlier one), and the result is composited over what is
    // behind it. `a` only tells the caller whether any real paint was found.
    _samplePodColor(pod, primary) {
        let isHasMenu = pod instanceof St.Widget && pod.has_style_class_name(QS_MENU_TOGGLE_CLASS);
        let candidates = [primary];
        if (isHasMenu && pod !== primary)
            candidates.push(pod);
        for (let icon of this._getToggleIconActors(pod !== primary ? primary : pod)) {
            if (icon !== primary && icon !== pod)
                candidates.push(icon);
        }
        let bestActor = null;
        let bestOwn = null;
        for (let candidate of candidates) {
            let own = this._readThemeBg(candidate);
            if (!own)
                continue;
            if (!bestOwn || own.a > bestOwn.a) {
                bestOwn = own;
                bestActor = candidate;
            }
        }
        if (bestOwn && bestOwn.a > 0.02) {
            return this._compositeOverAncestors(bestActor, bestOwn);
        }
        // Nothing in the pod paints; its colour is whatever shows through.
        return this._compositeOverAncestors(pod, null);
    }

    // Tracks every pod and keeps the transparency override on each of its
    // current sub-actors. Runs every frame, and checks each actor's own style
    // rather than remembering a pod as done, because the shell rebuilds the
    // inner actors of has-menu pods (on connection changes, for example).
    _ensureToggleStyles(toggles) {
        for (let pod of toggles) {
            if (!(pod instanceof St.Widget))
                continue;
            const entry = this._ensureEntry(pod);
            const primary = this._getPrimaryToggleButton(pod);
            this._updateBaseColor(entry, pod, primary);
            this._overrideSubStyles(entry, pod);
        }
    }

    _ensureEntry(pod) {
        let entry = this._toggleRegions.get(pod);
        if (entry)
            return entry;
        entry = { destroyId: 0, checkedId: 0, baseColor: [1.0, 1.0, 1.0], baseAlpha: 0, styledSubs: [], stateKey: '' };
        this._toggleRegions.set(pod, entry);
        entry.destroyId = pod.connect('destroy', () => {
            if (entry.checkedId && primary && primary.disconnect) {
                try { primary.disconnect(entry.checkedId); } catch (_) {}
            }
            this._toggleRegions.delete(pod);
        });

        const primary = this._getPrimaryToggleButton(pod);
        const updateCheckedState = () => {
            const isChecked = (primary && primary.has_style_pseudo_class && primary.has_style_pseudo_class('checked')) ||
                              (pod.has_style_pseudo_class && pod.has_style_pseudo_class('checked')) ||
                              (primary && primary.checked);
            if (isChecked) {
                entry.baseColor = [0.21, 0.52, 0.89];
                entry.baseAlpha = 1.0;
            } else {
                entry.baseColor = [1.0, 1.0, 1.0];
                entry.baseAlpha = 0.0;
            }
        };
        updateCheckedState();

        if (primary && primary.connect) {
            try {
                entry.checkedId = primary.connect('notify::checked', updateCheckedState);
            } catch (_) {}
        }
        return entry;
    }

    _hasOverride(actor) {
        const style = actor.get_style();
        return !!style && style.includes('transparent !important');
    }

    _updateBaseColor(entry, pod, primary) {
        const isChecked = (primary && primary.has_style_pseudo_class && primary.has_style_pseudo_class('checked')) ||
                          (pod.has_style_pseudo_class && pod.has_style_pseudo_class('checked')) ||
                          (primary && primary.checked) ||
                          (pod.has_style_class_name && pod.has_style_class_name('active')) ||
                          (pod.style && pod.style.includes('#007aff'));
        if (isChecked) {
            entry.baseColor = [0.0, 0.48, 1.0];
            entry.baseAlpha = 1.0;
        } else {
            entry.baseColor = [1.0, 1.0, 1.0];
            entry.baseAlpha = 0.0;
        }
    }

    _overrideSubStyles(entry, pod) {
        const known = new Set(entry.styledSubs.map(s => s.actor));
        for (let sub of this._getStylableSubActors(pod)) {
            if (!(sub instanceof St.Widget))
                continue;
            if (sub.has_style_class_name && sub.has_style_class_name('active'))
                continue;
            if (this._hasOverride(sub))
                continue;
            const origStyle = sub.get_style() || '';
            sub.set_style(_withOverride(origStyle));
            if (!known.has(sub))
                entry.styledSubs.push({ actor: sub, origStyle });
        }
    }

    // Re-samples each pod's colour
    _resampleToggleColors() {
        // Kept no-op to eliminate 100ms style mutations and flickering
    }

    _resamplePod(pod, entry, forceFull) {
        // No-op: styles are managed purely by theme and state
    }

    // A theme switch does not rebuild the Quick Settings actors, so a slider
    // adopted under a theme that draws a pill would stay glassed after
    // switching to one that does not. While the override is lifted its real
    // theme is readable: if it no longer paints a pill, it is released (its
    // styles are already restored).
    _releaseIfSliderLostPill(pod, entry) {
        if (!(pod instanceof St.Widget) || !pod.has_style_class_name('quick-slider'))
            return false;
        const pill = this._readThemeBg(pod);
        if (pill && pill.a > 0.02)
            return false;
        this._logger.log(`[Liquid Glass][toggle-color] releasing .quick-slider pod — theme no longer paints a pill ` +
            `(bg=${JSON.stringify(pill)})`);
        if (entry.destroyId)
            pod.disconnect(entry.destroyId);
        this._toggleRegions.delete(pod);
        return true;
    }

    _logPodColor(pod, primary, entry, sampled) {
        let isHasMenu = pod instanceof St.Widget && pod.has_style_class_name(QS_MENU_TOGGLE_CLASS);
        let podCls = pod instanceof St.Widget ? (pod.get_style_class_name() || '') : '';
        let primaryCls = primary.get_style_class_name() || '';
        let checked = primary.has_style_pseudo_class('checked');
        // Every candidate, not only the winner (see _samplePodColor()).
        let wrapperBg = isHasMenu ? this._readThemeBg(pod) : null;
        let iconBgs = this._getToggleIconActors(pod !== primary ? primary : pod)
            .map(a => JSON.stringify(this._readThemeBg(a))).join(' ');
        this._logger.log(`[Liquid Glass][toggle-color] pod class="${podCls}" isHasMenu=${isHasMenu} ` +
            `primary class="${primaryCls}" checked=${checked} ` +
            `primaryBg=${JSON.stringify(this._readThemeBg(primary))} ` +
            `wrapperBg=${wrapperBg ? JSON.stringify(wrapperBg) : 'n/a'} ` +
            `iconBg=[${iconBgs || 'none'}] ` +
            `chosen.a=${sampled.a.toFixed(2)} trusted=${sampled.a > 0.02} ` +
            `entry.baseColor=[${entry.baseColor.map(v => v.toFixed(2)).join(',')}] entry.baseAlpha=${entry.baseAlpha.toFixed(2)}`);
    }

    start() {
        // No periodic timeout loop needed
    }

    // The pseudo-classes of the actors _samplePodColor() can pick from.
    _podStateKey(pod, primary) {
        const STATES = ['checked', 'hover', 'active', 'insensitive', 'focus', 'selected'];
        let actors = [pod];
        if (primary !== pod)
            actors.push(primary);
        for (let icon of this._getToggleIconActors(pod !== primary ? primary : pod))
            actors.push(icon);
        let key = '';
        for (let actor of actors) {
            if (!(actor instanceof St.Widget)) {
                key += '?|';
                continue;
            }
            for (let state of STATES)
                key += actor.has_style_pseudo_class(state) ? '1' : '0';
            key += '|';
        }
        return key;
    }

    stop() {
        if (this._toggleColorTimerId !== 0) {
            GLib.source_remove(this._toggleColorTimerId);
            this._toggleColorTimerId = 0;
        }
    }

    // Restores the original inline styles and forgets every pod.
    clear() {
        this.stop();
        for (const [pod, entry] of this._toggleRegions.entries())
            _releaseEntry(pod, entry);
        this._toggleRegions.clear();
    }
}
