import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Mtk from 'gi://Mtk';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const EvalIface = `
<node>
  <interface name="org.gnome.Shell.Extensions.EvalHelper">
    <method name="Eval">
      <arg type="s" direction="in" name="code"/>
      <arg type="s" direction="out" name="result"/>
    </method>
  </interface>
</node>`;

class OverviewWallpaperManager {
    constructor() {
        this._bgManagers = [];
        this._bgGroup = null;
        this._build();

        Main.layoutManager.connectObject(
            'monitors-changed', () => this._build(),
            this
        );

        Main.layoutManager.overviewGroup.connectObject(
            'child-added', () => {
                if (this._bgGroup && this._bgGroup.get_parent() === Main.layoutManager.overviewGroup) {
                    Main.layoutManager.overviewGroup.set_child_below_sibling(this._bgGroup, null);
                }
            },
            this
        );
    }

    _build() {
        for (const mgr of this._bgManagers) {
            try { mgr.destroy(); } catch (_) {}
        }
        this._bgManagers = [];

        if (this._bgGroup) {
            try { this._bgGroup.destroy(); } catch (_) {}
            this._bgGroup = null;
        }

        if (!Main.layoutManager?.overviewGroup) return;

        this._bgGroup = new Meta.BackgroundGroup({ name: 'mac-overview-wallpaper-group', reactive: false });
        Main.layoutManager.overviewGroup.insert_child_at_index(this._bgGroup, 0);

        for (const monitor of (Main.layoutManager.monitors || [])) {
            const monBin = new Clutter.Actor({
                name: 'mac-overview-monitor-bin',
                reactive: false,
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
            });
            this._bgGroup.add_child(monBin);

            const bgMgr = new Background.BackgroundManager({
                container: monBin,
                monitorIndex: monitor.index,
                controlPosition: false,
            });
            this._bgManagers.push(bgMgr);
        }
    }

    destroy() {
        try { Main.layoutManager.disconnectObject(this); } catch (_) {}
        try { Main.layoutManager.overviewGroup.disconnectObject(this); } catch (_) {}

        for (const mgr of this._bgManagers) {
            try { mgr.destroy(); } catch (_) {}
        }
        this._bgManagers = [];

        if (this._bgGroup) {
            try { this._bgGroup.destroy(); } catch (_) {}
            this._bgGroup = null;
        }
    }
}

class MacMenuHoverGlide {
    constructor(menu) {
        this._menu = menu;
        this._pill = null;
        this._itemSignals = [];
        this._hideTimeoutId = 0;
        this._activeItem = null;

        if (!menu || !menu.box) return;
        this._setup();
    }

    _setup() {
        if (!this._menuOpenSignalId) {
            this._menuOpenSignalId = this._menu.connectObject('open-state-changed', (_m, open) => {
                if (open) {
                    this._ensurePill();
                    this._updateItems();
                    const activeChild = this._findActiveChild();
                    if (activeChild) {
                        this._glideTo(activeChild);
                    }
                } else {
                    this._hidePill(true);
                }
            }, this);
        }

        if (this._menu.box) {
            this._menu.box.add_style_class_name('mac-menu-hover-glide-active');
            this._menu.box.connectObject(
                'child-added', () => this._updateItems(),
                'child-removed', () => this._updateItems(),
                this
            );
        }

        if (this._menu.isOpen) {
            this._ensurePill();
            this._updateItems();
            const activeChild = this._findActiveChild();
            if (activeChild) {
                this._glideTo(activeChild);
            }
        }
    }

    _findActiveChild() {
        if (!this._menu?.box) return null;
        for (const child of this._menu.box.get_children()) {
            if (this._isItemEligible(child) && (child.hover || child.active)) {
                return child;
            }
        }
        return null;
    }

    _ensurePill() {
        if (this._pill && this._pill.get_parent()) return;
        const box = this._menu.box;
        const parent = box ? box.get_parent() : null;
        if (!parent) return;

        // Clean up any stray duplicate pills in parent first
        for (const c of parent.get_children()) {
            if (c !== this._pill && c.name === 'mac-menu-hover-pill') {
                try { c.destroy(); } catch (_) {}
            }
        }

        this._pill = new St.Widget({
            name: 'mac-menu-hover-pill',
            style_class: 'mac-menu-hover-pill',
            style: 'background-color: #007aff !important; border-radius: 9999px !important; box-shadow: 0 1px 4px rgba(0, 122, 255, 0.40) !important;',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: false,
            y_expand: false,
            opacity: 0,
            reactive: false,
        });

        try {
            parent.insert_child_below(this._pill, box);
        } catch (_e) {
            try { parent.add_child(this._pill); } catch (_e2) {}
        }
    }

    _isItemEligible(child) {
        if (!child || !child.visible) return false;
        if (!child.reactive) return false;
        if (child.sensitive === false) return false;
        if (child.has_style_class_name) {
            if (child.has_style_class_name('popup-separator-menu-item') ||
                child.has_style_class_name('appmenu-separator-menu-item') ||
                child.has_style_class_name('popup-inactive-menu-item') ||
                child.has_style_class_name('popup-sub-menu') ||
                child.has_style_class_name('mac-menu-section-label') ||
                child.has_style_class_name('mac-menu-hover-pill')) {
                return false;
            }
        }
        return true;
    }

    _updateItems() {
        this._cleanupItemSignals();
        const box = this._menu.box;
        if (!box) return;

        const children = box.get_children();
        for (const child of children) {
            if (!this._isItemEligible(child)) continue;

            if (child.menu && !child.menu._macHoverTracker && child.menu.box) {
                child.menu._macHoverTracker = new MacMenuHoverGlide(child.menu);
            }

            const hoverId = child.connect('notify::hover', () => this._onItemState(child));
            const activeId = child.connect('notify::active', () => this._onItemState(child));
            this._itemSignals.push({ actor: child, id: hoverId });
            this._itemSignals.push({ actor: child, id: activeId });
        }
    }

    _onItemState(child) {
        if (child.hover || child.active) {
            if (this._hideTimeoutId) {
                GLib.source_remove(this._hideTimeoutId);
                this._hideTimeoutId = 0;
            }
            this._glideTo(child);
        } else {
            if (!this._hideTimeoutId) {
                this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                    this._hideTimeoutId = 0;
                    const anyActive = this._findActiveChild();
                    if (!anyActive) {
                        this._hidePill(false);
                    } else if (anyActive !== this._activeItem) {
                        this._glideTo(anyActive);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _glideTo(child) {
        if (!this._isItemEligible(child) || !child.get_stage()) return;
        this._ensurePill();
        if (!this._pill) return;
        const parent = this._menu.box?.get_parent();
        if (!parent || !parent.get_stage()) return;

        try {
            const [px, py] = parent.get_transformed_position();
            const [cx, cy] = child.get_transformed_position();
            if (isNaN(cx) || isNaN(cy) || isNaN(px) || isNaN(py)) return;

            const ab = child.get_allocation_box ? child.get_allocation_box() : null;
            let w = (ab && ab.x2 > ab.x1) ? (ab.x2 - ab.x1) : child.width;
            let h = (ab && ab.y2 > ab.y1) ? (ab.y2 - ab.y1) : child.height;
            if (w <= 0 || h <= 0) return;

            // Correct for pill's own allocation origin inside parent:
            const pillAb = this._pill.get_allocation_box ? this._pill.get_allocation_box() : null;
            const originX = (pillAb && pillAb.x2 >= pillAb.x1) ? pillAb.x1 : 0;
            const originY = (pillAb && pillAb.y2 >= pillAb.y1) ? pillAb.y1 : 0;

            const tx = (cx - px) - originX;
            const ty = (cy - py) - originY;

            this._activeItem = child;
            this._pill.remove_all_transitions();

            if (this._pill.opacity === 0) {
                this._pill.translation_x = tx;
                this._pill.translation_y = ty;
                this._pill.width = w;
                this._pill.height = h;
                this._pill.scale_x = 0.95;
                this._pill.scale_y = 0.95;
                this._pill.ease({
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 100,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                this._pill.ease({
                    translation_x: tx,
                    translation_y: ty,
                    width: w,
                    height: h,
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 130, // 130ms authentic macOS glide
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
        } catch (_e) {}
    }

    _hidePill(immediate = false) {
        this._activeItem = null;
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
        if (!this._pill) return;
        this._pill.remove_all_transitions();
        if (immediate) {
            this._pill.opacity = 0;
        } else {
            this._pill.ease({
                opacity: 0,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _cleanupItemSignals() {
        for (const s of this._itemSignals) {
            try { s.actor.disconnect(s.id); } catch (_) {}
        }
        this._itemSignals = [];
    }

    destroy() {
        this._cleanupItemSignals();
        if (this._hideTimeoutId) {
            try { GLib.source_remove(this._hideTimeoutId); } catch (_) {}
            this._hideTimeoutId = 0;
        }
        if (this._pill) {
            try { this._pill.destroy(); } catch (_) {}
            this._pill = null;
        }
        try {
            if (this._menu) {
                delete this._menu._macHoverTracker;
                delete this._menu._hasHoverTracker;
                if (this._menu.box) {
                    this._menu.box.remove_style_class_name('mac-menu-hover-glide-active');
                    this._menu.box.disconnectObject(this);
                }
            }
        } catch (_) {}
        try { this._menu?.disconnectObject(this); } catch (_) {}
    }
}

export default class EvalHelper extends Extension {
    enable() {
        globalThis.Clutter = Clutter;
        globalThis.Gio = Gio;
        globalThis.GLib = GLib;
        globalThis.Meta = Meta;
        globalThis.Main = Main;
        globalThis.Mtk = Mtk;
        globalThis.Shell = Shell;
        globalThis.Pango = Pango;
        try {
            const nodeInfo = Gio.DBusNodeInfo.new_for_xml(EvalIface);
            this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(nodeInfo.interfaces[0], {
                Eval: async (code) => {
                    try {
                        let res = eval(code);
                        if (res && typeof res.then === 'function')
                            res = await res;
                        return JSON.stringify(res !== undefined ? res : null) ?? 'null';
                    } catch (e) {
                        return `ERROR: ${e?.name}: ${e?.message}\n${e?.stack || e}`;
                    }
                }
            });
            this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/EvalHelper');
        } catch (e) {
            console.error(`[EvalHelper] DBus export error: ${e}`);
        }

        // Permanently prevent GNOME from disabling user extensions or resetting theme
        try {
            this._shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            if (this._shellSettings.get_boolean('disable-user-extensions')) {
                this._shellSettings.set_boolean('disable-user-extensions', false);
            }
            this._disableExtSignalId = this._shellSettings.connect('changed::disable-user-extensions', () => {
                if (this._shellSettings.get_boolean('disable-user-extensions')) {
                    this._shellSettings.set_boolean('disable-user-extensions', false);
                }
            });
        } catch (_) {}

        try {
            this._userThemeSettings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.user-theme' });
            let curTheme = this._userThemeSettings.get_string('name');
            if (!curTheme) {
                this._userThemeSettings.set_string('name', 'macW1Y-Dark-solid');
            }
            this._userThemeSignalId = this._userThemeSettings.connect('changed::name', () => {
                let name = this._userThemeSettings.get_string('name');
                if (!name) {
                    this._userThemeSettings.set_string('name', 'macW1Y-Dark-solid');
                }
            });
        } catch (_) {}

        // Group notifications by application name so multiple notifications from the same app stack together
        const fdo = Main.notificationDaemon?._fdoNotificationDaemon;
        if (fdo && !this._origGetSourceForPidAndName) {
            this._origGetSourceForPidAndName = fdo._getSourceForPidAndName.bind(fdo);
            const origFn = this._origGetSourceForPidAndName;
            fdo._getSourceForPidAndName = function(sender, pid, appName) {
                const key = (appName && appName.trim()) ? appName.trim() : (pid || sender || 'generic');
                let source = this._sourceForPidAndName.get(key);
                if (source)
                    return source;

                source = origFn(sender, null, key);
                this._sourceForPidAndName.set(key, source);
                source.connect('destroy', () => {
                    this._sourceForPidAndName.delete(key);
                });
                return source;
            };
        }

        // Ensure liquid-glass covers macOS Control Center submenu cards and sound drawer
        const patchLiquidGlass = () => {
            try {
                const lg = Main.extensionManager?.lookup?.('liquid-glass@thinkingcoding1231.gmail.com')?.stateObj;
                const qsm = lg?._quickSettingsManager;
                if (qsm?._toggleStyles) {
                    const proto = Object.getPrototypeOf(qsm._toggleStyles);
                    if (!proto._macPatched) {
                        proto._macPatched = true;
                        const origLeafKind = proto._toggleLeafKind;
                        proto._toggleLeafKind = function(actor, inSystemItem) {
                            if (actor && actor.has_style_class_name) {
                                if (actor.has_style_class_name('mac-cc-submenu-card') ||
                                    actor.has_style_class_name('mac-cc-sound-drawer')) {
                                    return 'toggle';
                                }
                            }
                            return origLeafKind.call(this, actor, inSystemItem);
                        };
                    }
                    if (!proto._macSubActorsPatched) {
                        proto._macSubActorsPatched = true;
                        proto._getStylableSubActors = function(pod) {
                            const found = [];
                            const walk = (actor) => {
                                if (actor instanceof Clutter.Actor && actor.has_style_class_name) {
                                    if (actor !== pod && (
                                        actor.has_style_class_name('mac-cc-pill-icon-btn') ||
                                        actor.has_style_class_name('mac-cc-slider-track') ||
                                        actor.has_style_class_name('mac-cc-media-art') ||
                                        actor.has_style_class_name('mac-cc-airplay-btn') ||
                                        actor.has_style_class_name('slider') ||
                                        actor.has_style_class_name('mac-cc-transport-btn') ||
                                        actor.has_style_class_name('mac-cc-back-btn') ||
                                        actor.has_style_class_name('mac-cc-route-btn') ||
                                        actor.has_style_class_name('mac-cc-switch-track') ||
                                        actor.has_style_class_name('mac-cc-switch-thumb') ||
                                        actor.has_style_class_name('mac-cc-switch-btn') ||
                                        actor.has_style_class_name('toggle-switch')
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
                        };
                    }
                }
                if (lg && lg._searchGlassManager) {
                    lg._searchGlassManager.cleanup();
                    lg._searchGlassManager = null;
                }
                if (lg && (!lg._dashDocks || lg._dashDocks.length === 0)) {
                    lg._findDashToDock();
                }

                // Apply StageCopier backdrop caching & throttling to avoid 60fps GPU blit/blur when idle
                if (global._lgGlass && global._lgGlass.glassObjects) {
                    for (const glass of global._lgGlass.glassObjects()) {
                        if (glass._copier && !glass._copier.constructor._macThrottled) {
                            const CopierProto = glass._copier.constructor.prototype;
                            glass._copier.constructor._macThrottled = true;
                            const origTake = CopierProto.take;
                            CopierProto.take = function(actor, root, paintContext, stageRect) {
                                if (!actor.mapped || !actor.visible || actor.opacity === 0 || (actor.get_paint_opacity && actor.get_paint_opacity() === 0)) {
                                    return { copy: this.lastCopy, missed: false };
                                }
                                const fb = paintContext.get_framebuffer();
                                const view = this.constructor.liveView(actor, fb);
                                if (!view) {
                                    this.offStageCount++;
                                    return { copy: this.lastCopy, missed: false };
                                }
                                let copy = this._copies.get(view) ?? null;

                                // 1. Strict backdrop lock: If locked and we already have a backdrop, NEVER re-blit
                                if (actor._backdropLocked && copy?.texture) {
                                    this.reuseCount++;
                                    return { copy, missed: false };
                                }

                                const layout = view.layout;
                                const x0 = Math.max(stageRect[0], layout.x);
                                const y0 = Math.max(stageRect[1], layout.y);
                                const x1 = Math.min(stageRect[2], layout.x + layout.width);
                                const y1 = Math.min(stageRect[3], layout.y + layout.height);
                                if (!(x1 > x0) || !(y1 > y0))
                                    return { copy, missed: false };

                                const scale = view.get_scale();
                                const ox = Math.round(-layout.x * scale);
                                const oy = Math.round(-layout.y * scale);
                                const fx0 = Math.floor(x0 * scale) + ox;
                                const fy0 = Math.floor(y0 * scale) + oy;
                                const fx1 = Math.ceil(x1 * scale) + ox;
                                const fy1 = Math.ceil(y1 * scale) + oy;
                                const rect = [(fx0 - ox) / scale, (fy0 - oy) / scale, (fx1 - ox) / scale, (fy1 - oy) / scale];

                                const inOverview = Boolean(Main?.overview?.visible || Main?.overview?._animationInProgress);
                                const overviewChanged = copy && copy.inOverview !== undefined && copy.inOverview !== inOverview;
                                if (overviewChanged) {
                                    copy = null;
                                    this._copies.delete(view);
                                    if (typeof this.forceRefresh === 'function') {
                                        this.forceRefresh(500);
                                    }
                                }

                                const nowUs = GLib.get_monotonic_time();
                                const sameGeometry = copy?.rect &&
                                    Math.abs(copy.rect[0] - rect[0]) < 1.0 &&
                                    Math.abs(copy.rect[1] - rect[1]) < 1.0 &&
                                    Math.abs(copy.rect[2] - rect[2]) < 1.0 &&
                                    Math.abs(copy.rect[3] - rect[3]) < 1.0;

                                const isForced = nowUs < (this._forceUntilUs || 0);
                                const mustCopy = !copy?.texture || !copy?.rect || overviewChanged;

                                // 2. Throttle blits to ~60 FPS (16ms interval) when geometry is stable and not forced.
                                // If less than 16ms has elapsed since the last blit, reuse existing copy to avoid excessive blits.
                                if (!mustCopy && !isForced && sameGeometry && copy?.texture && (nowUs - (copy.lastTimeUs || 0) < 16000)) {
                                    this.reuseCount++;
                                    return { copy, missed: false };
                                }

                                // 3. Redraw clip check: if clip doesn't touch our glass rect and we have a copy,
                                // Mutter only redrew an unrelated area on the screen; reuse existing copy.
                                const clip = paintContext.get_redraw_clip();
                                const clipX = Math.floor(rect[0]);
                                const clipY = Math.floor(rect[1]);
                                const _Mtk = globalThis.Mtk || (typeof Mtk !== 'undefined' ? Mtk : imports.gi.Mtk);
                                let touchesClip = true;
                                if (clip && _Mtk) {
                                    try {
                                        const overlap = clip.contains_rectangle(new _Mtk.Rectangle({
                                            x: clipX, y: clipY, width: Math.max(1, Math.ceil(rect[2]) - clipX), height: Math.max(1, Math.ceil(rect[3]) - clipY),
                                        }));
                                        touchesClip = (overlap !== _Mtk.RegionOverlap.OUT);
                                    } catch (_) {
                                        touchesClip = true;
                                    }
                                }

                                if (!mustCopy && !isForced && copy?.texture && !touchesClip) {
                                    this.reuseCount++;
                                    return { copy, missed: false };
                                }

                                const savedForce = this._forceUntilUs;
                                this._forceUntilUs = nowUs + 10000000;
                                const res = origTake.call(this, actor, root, paintContext, stageRect);
                                this._forceUntilUs = savedForce;
                                if (res.copy) {
                                    res.copy.lastTimeUs = nowUs;
                                    res.copy.inOverview = inOverview;
                                }
                                return res;
                            };
                        }
                    }
                }
                // Gentle dock glass sync on workspace switch / overview transitions without hammering GPU
                const syncDockGlass = () => {
                    if (typeof global._liquidGlassDockSync === 'function') {
                        try { global._liquidGlassDockSync(); } catch (_) {}
                    }
                };

                if (!this._macDockSignalsConnected) {
                    this._macDockSignalsConnected = true;
                    this._dockSignals = [];
                    if (global.window_manager) {
                        this._dockSignals.push(
                            global.window_manager.connect('switch-workspace', () => syncDockGlass())
                        );
                    }
                    this._dockSignals.push(
                        Main.overview.connect('shown', () => syncDockGlass()),
                        Main.overview.connect('hidden', () => syncDockGlass())
                    );
                }
            } catch (_) {}
        };
        patchLiquidGlass();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            patchLiquidGlass();
            return GLib.SOURCE_REMOVE;
        });

        // Ensure dock icon magnification never stays stuck after opening/closing Overview
        const setupDockMagnifierGuard = () => {
            try {
                const getMag = () => {
                    const d2d = Main.uiGroup?.get_children?.()?.find(c => c.name === 'dashtodockContainer');
                    return d2d?._dock?._magnifier || d2d?._magnifier || null;
                };

                const mag = getMag();
                if (mag && mag.constructor?.prototype && !this._origIsPointerOverDock) {
                    this._origIsPointerOverDock = mag.constructor.prototype._isPointerOverDock;
                    mag.constructor.prototype._isPointerOverDock = function() {
                        if (!this._hoverBox || !this._hoverBox.has_allocation())
                            return false;
                        if (Main.overview.visibleTarget || Main.overview.visible)
                            return false;
                        try {
                            const [x, y] = this._debugPointer ?? global.get_pointer();
                            const [boxX, boxY] = this._hoverBox.get_transformed_position();
                            const [w, h] = this._hoverBox.get_transformed_size?.() || [this._hoverBox.width, this._hoverBox.height];
                            const margin = 12;
                            const inBounds = x >= boxX - margin && x <= boxX + w + margin &&
                                             y >= boxY - margin && y <= boxY + h + margin;
                            if (!inBounds)
                                return false;
                            return true;
                        } catch (_) {
                            return false;
                        }
                    };
                }

                const resetMag = () => {
                    try {
                        const m = getMag();
                        if (m) {
                            m._stopTimeline?.();
                            m._target = 0;
                            m._envelope = 0;
                            m._velocity = 0;
                            m._cursor = null;
                            m._clearTransforms?.();
                        }
                    } catch (_) {}
                };

                const syncMag = () => {
                    try {
                        const m = getMag();
                        if (m) {
                            m._stopTimeline?.();
                            m._target = 0;
                            m._envelope = 0;
                            m._velocity = 0;
                            m._cursor = null;
                            m._clearTransforms?.();
                            if (typeof m._isPointerOverDock === 'function' && m._isPointerOverDock()) {
                                m._syncTarget?.();
                            }
                        }
                    } catch (_) {}
                };

                if (!this._dockMagSignalsConnected && Main.overview) {
                    this._dockMagSignalsConnected = true;
                    this._dockMagSignals = [
                        Main.overview.connect('showing', resetMag),
                        Main.overview.connect('hiding', resetMag),
                        Main.overview.connect('hidden', syncMag),
                    ];
                }
            } catch (_) {}
        };
        setupDockMagnifierGuard();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            setupDockMagnifierGuard();
            return GLib.SOURCE_REMOVE;
        });

        // Ensure dialog and modal windows for apps with sidebars (e.g. Nautilus "Empty Trash")
        // get full-width blur across the entire element instead of being clipped to sidebar width (240px)
        const setupAppDialogBlurGuard = () => {
            try {
                const bmsExt = Main.extensionManager.lookup('blur-my-shell@aunetx');
                const appsBlur = bmsExt?.stateObj?._applications_blur;
                if (!appsBlur) return;

                const isDialogOrModalWindow = (meta_window) => {
                    if (!meta_window) return false;
                    const type = typeof meta_window.get_window_type === 'function'
                        ? meta_window.get_window_type()
                        : meta_window.window_type;
                    if (type !== Meta.WindowType.NORMAL) return true;
                    if (typeof meta_window.get_transient_for === 'function' && meta_window.get_transient_for()) return true;
                    if (typeof meta_window.is_attached_dialog === 'function' && meta_window.is_attached_dialog()) return true;
                    if (typeof meta_window.can_maximize === 'function' && !meta_window.can_maximize()) return true;
                    if (typeof meta_window.allows_resize === 'function' && !meta_window.allows_resize()) return true;
                    return false;
                };

                const applyFullBlurToDialog = (mw) => {
                    try {
                        if (!mw || !isDialogOrModalWindow(mw)) return;
                        const blur_actor = mw.blur_actor;
                        if (!blur_actor) return;
                        const alloc = appsBlur.compute_allocation(mw);
                        blur_actor.x = alloc.x;
                        blur_actor.y = alloc.y;
                        blur_actor.width = alloc.width;
                        blur_actor.height = alloc.height;
                        blur_actor.remove_clip?.();
                    } catch (_) {}
                };

                const proto = appsBlur.constructor.prototype;
                if (proto && !this._origBmsUpdateSize) {
                    this._origBmsUpdateSize = proto.update_size;
                    const origUpdateSize = proto.update_size;
                    proto.update_size = function(pid) {
                        origUpdateSize.call(this, pid);
                        try {
                            if (this.meta_window_map?.has(pid)) {
                                const mw = this.meta_window_map.get(pid);
                                applyFullBlurToDialog(mw);
                            }
                        } catch (_) {}
                    };
                }

                if (appsBlur.meta_window_map) {
                    for (const [pid, mw] of appsBlur.meta_window_map) {
                        try {
                            if (isDialogOrModalWindow(mw)) {
                                appsBlur.update_size(pid);
                            }
                        } catch (_) {}
                    }
                }
            } catch (_) {}
        };
        setupAppDialogBlurGuard();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            setupAppDialogBlurGuard();
            return GLib.SOURCE_REMOVE;
        });

        // macOS Tahoe context & popup menus: single gliding hover pill following cursor
        const setupMenuHoverGlide = () => {
            try {
                const attachToMenu = (menu) => {
                    if (!menu || !menu.box || menu._macHoverTracker || menu._hasHoverTracker || menu._appMenuHoverGlide) return;
                    const isQuickSettings = menu.constructor.name === 'QuickSettingsMenu' || !!menu._grid;
                    if (isQuickSettings) return;
                    menu._macHoverTracker = new MacMenuHoverGlide(menu);
                };

                for (const m of (Main.panel.menuManager?._menus || [])) {
                    attachToMenu(m);
                }

                for (const key of Object.keys(Main.panel.statusArea || {})) {
                    const btn = Main.panel.statusArea[key];
                    if (btn?.menu) {
                        attachToMenu(btn.menu);
                    }
                }

                if (!PopupMenu.PopupMenu.prototype._origMacGlideOpen) {
                    PopupMenu.PopupMenu.prototype._origMacGlideOpen = PopupMenu.PopupMenu.prototype.open;
                    const origOpen = PopupMenu.PopupMenu.prototype._origMacGlideOpen;
                    PopupMenu.PopupMenu.prototype.open = function(animate) {
                        try {
                            attachToMenu(this);
                        } catch (e) {
                            console.error(`[EvalHelper] MacMenuHoverGlide open error: ${e}`);
                        }
                        return origOpen.call(this, animate);
                    };
                }

                if (Main.panel.menuManager && !Main.panel.menuManager._origMacGlideAddMenu) {
                    Main.panel.menuManager._origMacGlideAddMenu = Main.panel.menuManager.addMenu;
                    const origAdd = Main.panel.menuManager._origMacGlideAddMenu;
                    Main.panel.menuManager.addMenu = function(menu, position) {
                        try {
                            attachToMenu(menu);
                        } catch (_) {}
                        return origAdd.call(this, menu, position);
                    };
                }
            } catch (e) {
                console.error(`[EvalHelper] setupMenuHoverGlide error: ${e}`);
            }
        };
        setupMenuHoverGlide();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            setupMenuHoverGlide();
            return GLib.SOURCE_REMOVE;
        });


        // Ensure search-shortcut Ctrl+Space connects to redesigned macOS Liquid Glass Spotlight
        const patchSpotlightKeybinding = async () => {
            try {
                // Ensure ibus doesn't intercept Control+space
                try {
                    const ibusSettings = new Gio.Settings({ schema_id: 'org.freedesktop.ibus.general.hotkey' });
                    let trig = ibusSettings.get_strv('trigger');
                    if (trig.some(t => t.toLowerCase() === 'control+space')) {
                        ibusSettings.set_strv('trigger', trig.filter(t => t.toLowerCase() !== 'control+space'));
                    }
                } catch (_) {}

                const ext = Main.extensionManager.lookup('appmenu@ChathurangaBW.github.io');
                if (!ext?.stateObj?._settings) return;

                try {
                    ext.stateObj._settings.set_strv('search-shortcut', ['<Control>space', '<Primary>space']);
                } catch (_) {}

                Main.wm.removeKeybinding('search-shortcut');
                Main.wm.addKeybinding(
                    'search-shortcut',
                    ext.stateObj._settings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.ALL,
                    async () => {
                        try {
                            if (typeof globalThis._macSpotlightToggle === 'function') {
                                globalThis._macSpotlightToggle();
                                return;
                            }
                            if (typeof globalThis.toggleMacSpotlight === 'function') {
                                globalThis.toggleMacSpotlight();
                                return;
                            }
                            const mod = await import(`file://${ext.path}/searchDialog_v5.js?t=${Date.now()}`);
                            if (mod?.toggleSearchDialog) {
                                mod.toggleSearchDialog();
                            }
                        } catch (e) {
                            console.error(`[EvalHelper] toggleSearchDialog error: ${e}`);
                        }
                    }
                );
            } catch (e) {
                console.error(`[EvalHelper] patchSpotlightKeybinding error: ${e}`);
            }
        };
        patchSpotlightKeybinding();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            patchSpotlightKeybinding();
            return GLib.SOURCE_REMOVE;
        });

        // Patch SwitcherPopup (Alt+Tab) with macOS Liquid Glass & Focused Label
        const patchSwitcherPopupLQVisual = async () => {
            try {
                const SwitcherPopupMod = await import('resource:///org/gnome/shell/ui/switcherPopup.js');
                const AltTabMod = await import('resource:///org/gnome/shell/ui/altTab.js');
                const ShellMod = await import('gi://Shell');
                const Shell = ShellMod.default || ShellMod;
                const PangoMod = await import('gi://Pango');
                const Pango = PangoMod.default || PangoMod;
                const ClutterMod = await import('gi://Clutter');
                const Clutter = ClutterMod.default || ClutterMod;
                const SwitcherPopup = SwitcherPopupMod.SwitcherPopup;
                const SwitcherList = SwitcherPopupMod.SwitcherList;
                if (!SwitcherPopup || !SwitcherList) return;

                // 1. Patch SwitcherList.prototype.highlight so ONLY the focused item shows its program name underneath
                if (!SwitcherList.prototype._macHighlightPatched) {
                    SwitcherList.prototype._macHighlightPatched = true;
                    const origHighlight = SwitcherList.prototype.highlight;
                    SwitcherList.prototype.highlight = function(index, justOutline) {
                        origHighlight.call(this, index, justOutline);
                        if (!Array.isArray(this._items)) return;
                        for (let i = 0; i < this._items.length; i++) {
                            const item = this._items[i];
                            if (!item) continue;
                            const child = item.get_child ? item.get_child() : null;
                            const label = child?.label || item.label_actor;
                            if (label) {
                                if (i === index) {
                                    label.opacity = 255;
                                    if (!label.visible) label.show();
                                } else {
                                    label.opacity = 0;
                                }
                            }
                        }
                    };
                }

                // 2. Patch SwitcherList.prototype.addItem to hide labels by default and hide scroll arrows
                if (!SwitcherList.prototype._macAddItemPatched) {
                    SwitcherList.prototype._macAddItemPatched = true;
                    const origAddItem = SwitcherList.prototype.addItem;
                    SwitcherList.prototype.addItem = function(item, label) {
                        const bbox = origAddItem.call(this, item, label);
                        if (label) label.opacity = 0;
                        const child = bbox.get_child ? bbox.get_child() : null;
                        if (child?.label) child.label.opacity = 0;
                        if (this._leftArrow) this._leftArrow.opacity = 0;
                        if (this._rightArrow) this._rightArrow.opacity = 0;
                        return bbox;
                    };
                }

                // 3. Patch AppIcon to format label and hide by default
                if (AltTabMod.AppIcon && !AltTabMod.AppIcon.prototype._macPatched) {
                    AltTabMod.AppIcon.prototype._macPatched = true;
                    const origAppIconInit = AltTabMod.AppIcon.prototype._init;
                    AltTabMod.AppIcon.prototype._init = function(app) {
                        origAppIconInit.call(this, app);
                        if (this.label) {
                            this.label.opacity = 0;
                            this.label.style = 'font-family: "SF Pro Display", "SF Pro Text", -apple-system, sans-serif !important; font-size: 11px !important; font-weight: 600 !important; color: #ffffff !important; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85) !important; text-align: center !important; margin-top: 4px !important;';
                            if (this.label.clutter_text) {
                                this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                                this.label.clutter_text.line_wrap = false;
                            }
                        }
                    };
                }

                // 4. Patch WindowIcon & WindowSwitcher for touchpad gestures & fallback switcher
                if (AltTabMod.WindowIcon && !AltTabMod.WindowIcon.prototype._macPatched) {
                    AltTabMod.WindowIcon.prototype._macPatched = true;
                    const origWindowIconInit = AltTabMod.WindowIcon.prototype._init;
                    AltTabMod.WindowIcon.prototype._init = function(window, mode) {
                        origWindowIconInit.call(this, window, mode);
                        if (this.label) {
                            try {
                                const tracker = Shell.WindowTracker.get_default();
                                const app = tracker.get_window_app(window);
                                const name = app?.get_name() || window.get_title();
                                this.label.text = name;
                            } catch (_) {}
                            this.label.x_align = Clutter.ActorAlign.CENTER;
                            this.label.opacity = 0;
                            this.label.style = 'font-family: "SF Pro Display", "SF Pro Text", -apple-system, sans-serif !important; font-size: 11px !important; font-weight: 600 !important; color: #ffffff !important; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85) !important; text-align: center !important; margin-top: 4px !important;';
                            if (this.label.clutter_text) {
                                this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                                this.label.clutter_text.line_wrap = false;
                            }
                            if (!this.label.get_parent()) {
                                this.add_child(this.label);
                            }
                        }
                    };
                }

                // 5. Hide multi-window arrows in AppSwitcher
                try {
                    const dummyPopup = new AltTabMod.AppSwitcherPopup();
                    const AppSwitcherProto = dummyPopup._switcherList ? Object.getPrototypeOf(dummyPopup._switcherList) : null;
                    if (AppSwitcherProto && !AppSwitcherProto._macPatched) {
                        AppSwitcherProto._macPatched = true;
                        const origAddIcon = AppSwitcherProto._addIcon;
                        AppSwitcherProto._addIcon = function(appIcon) {
                            origAddIcon.call(this, appIcon);
                            if (Array.isArray(this._arrows)) {
                                for (const arrow of this._arrows) {
                                    if (arrow) arrow.hide();
                                }
                            }
                        };
                        const origHighlight = AppSwitcherProto.highlight;
                        AppSwitcherProto.highlight = function(n, justOutline) {
                            origHighlight.call(this, n, justOutline);
                            if (Array.isArray(this._arrows)) {
                                for (const arrow of this._arrows) {
                                    if (arrow) arrow.hide();
                                }
                            }
                        };
                    }
                    dummyPopup.destroy();
                } catch (_) {}

                // 6. Hide label in WindowSwitcher
                try {
                    const dummyWinPopup = new AltTabMod.WindowSwitcherPopup();
                    const WinSwitcherProto = dummyWinPopup._switcherList ? Object.getPrototypeOf(dummyWinPopup._switcherList) : null;
                    if (WinSwitcherProto && !WinSwitcherProto._macPatched) {
                        WinSwitcherProto._macPatched = true;
                        const origWinSwitcherInit = WinSwitcherProto._init;
                        WinSwitcherProto._init = function(windows, mode) {
                            origWinSwitcherInit.call(this, windows, mode);
                            if (this._label) {
                                this._label.hide();
                                this._label.opacity = 0;
                            }
                        };
                    }
                    dummyWinPopup.destroy();
                } catch (_) {}

                const getSwitcherGlass = async () => {
                    let glass = globalThis._macSwitcherGlass;
                    if (!glass || !glass.get_parent() || glass.is_finalized?.()) {
                        const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                        const path = ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
                        const glassMod = await import(`file://${path}/dist/rendering/backdropGlass.js`);
                        const BackdropGlass = glassMod.BackdropGlass;

                        glass = new BackdropGlass({
                            extensionPath: path,
                            settings: ext?.stateObj?._settings || null,
                            logger: console,
                            owner: 'switcher-popup',
                        });
                        glass.setIsDock(false);
                        glass.setCornerSmoothingEnabled(0.0);
                        glass.setCornerRadius(28.0);
                        glass.setTintColor(0.0, 0.0, 0.0);
                        glass.setTintStrength(0.03);
                        glass.setBlurRadius(15.0);
                        glass.setPadding(0);
                        try {
                            glass._effect?.setSurfaceLightEnabled?.(true);
                            glass._effect?._setFloat?.('displacement_scale', 40.0);
                            glass._effect?._setFloat?.('ior', 1.50);
                            glass._effect?._setFloat?.('rim_intensity', 0.15);
                            glass._effect?._setFloat?.('rim_width', 4.5);
                            glass._effect?._setFloat?.('rim_power', 5.0);
                            glass._effect?._setFloat?.('rim_directional_power', 2.7);
                            glass._effect?._setFloat?.('rim_light_color_intensity', 1.5);
                            glass._effect?._setFloat?.('specular_intensity', 0.12);
                            glass._effect?._setFloat?.('sheen_intensity', 0.10);
                            glass._effect?._setFloat?.('chroma_strength', 0.005);
                            glass._effect?._setFloat?.('shadow_intensity', 0.0);
                            glass._effect?._setFloat?.('ao_intensity', 0.0);
                        } catch (_) {}
                        glass.hide();
                        Main.layoutManager.uiGroup.add_child(glass);
                        globalThis._macSwitcherGlass = glass;
                    }
                    return glass;
                };

                // Preload glass asynchronously
                getSwitcherGlass().catch(() => {});

                if (!SwitcherPopup.prototype._macLQVisualPatchedV4) {
                    SwitcherPopup.prototype._macLQVisualPatchedV4 = true;
                    const origShow = SwitcherPopup.prototype.show;
                    SwitcherPopup.prototype.show = function(backward, binding, mask) {
                        const res = origShow.call(this, backward, binding, mask);
                        if (!res) return res;

                        (async () => {
                            try {
                                const switcherGlass = await getSwitcherGlass();
                                if (!switcherGlass) return;
                                Main.layoutManager.uiGroup.set_child_below_sibling(switcherGlass, this);
                                try { switcherGlass.addExclusion(this); } catch (_) {}
                                if (this._switcherList) {
                                    try { switcherGlass.addExclusion(this._switcherList); } catch (_) {}
                                }

                                const syncGlass = () => {
                                    if (!this._switcherList || this._switcherList.is_finalized?.()) return;
                                    if (!this.visible || this.opacity <= 0) {
                                        if (switcherGlass.visible) switcherGlass.hide();
                                        return;
                                    }

                                    const [slX, slY] = this._switcherList.get_transformed_position();
                                    const [slW, slH] = this._switcherList.get_transformed_size();
                                    if (slX == null || slY == null || Number.isNaN(slX) || Number.isNaN(slY) || slW <= 1 || slH <= 1) return;

                                    const primary = Main.layoutManager.primaryMonitor;
                                    if (!primary) return;

                                    const localX = Math.round(slX - primary.x);
                                    const localY = Math.round(slY - primary.y);
                                    const bgW = Math.round(slW);
                                    const bgH = Math.round(slH);

                                    switcherGlass.opacity = this.opacity;
                                    if (!switcherGlass.visible) {
                                        switcherGlass.show();
                                    }

                                    switcherGlass.set_position(primary.x, primary.y);
                                    switcherGlass.set_size(primary.width, primary.height);
                                    switcherGlass.setResolution(primary.width, primary.height);
                                    switcherGlass.setCornerRadius(28.0);
                                    switcherGlass.setGlassGeometry(localX, localY, bgW, bgH);

                                    const CLIP_PAD = 160;
                                    switcherGlass.set_clip(localX - CLIP_PAD, localY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);

                                    if (typeof switcherGlass.syncSources === 'function') {
                                        switcherGlass.syncSources();
                                    }
                                };

                                try {
                                    if (typeof switcherGlass.forceRefresh === 'function') {
                                        switcherGlass.forceRefresh(1);
                                    }
                                } catch (_) {}

                                if (this._stageSignalId) {
                                    global.stage.disconnect(this._stageSignalId);
                                }
                                this._stageSignalId = global.stage.connect('before-update', syncGlass);

                                const allocId = this._switcherList ? this._switcherList.connect('notify::allocation', syncGlass) : 0;

                                this.connect('destroy', () => {
                                    if (this._stageSignalId) {
                                        global.stage.disconnect(this._stageSignalId);
                                        this._stageSignalId = 0;
                                    }
                                    if (allocId && this._switcherList) {
                                        try { this._switcherList.disconnect(allocId); } catch (_) {}
                                    }
                                    switcherGlass.hide();
                                    switcherGlass.opacity = 0;
                                });

                                syncGlass();
                            } catch (err) {
                                console.error('[EvalHelper] SwitcherPopup show error: ' + err);
                            }
                        })();
                        return res;
                    };
                }
            } catch (e) {
                console.error('[EvalHelper] patchSwitcherPopupLQVisual error: ' + e);
            }
        };
        patchSwitcherPopupLQVisual();

        // Patch ModalDialog (confirmation/system dialogs) with LQ-Visual glass
        // The dialog keeps its own rgba(30,30,30,0.40) fill; only the BackdropGlass
        // shader is added behind the dialog box (same engine as Tahoe widgets).
        const patchModalDialogLQVisual = async () => {
            try {
                const ModalDialogMod = await import('resource:///org/gnome/shell/ui/modalDialog.js');
                const ModalDialog = ModalDialogMod.ModalDialog;
                if (!ModalDialog) return;

                const getLiquidGlassPath = () => {
                    const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                    return ext?.path || `${GLib.get_user_data_dir()}/gnome-shell/extensions/liquid-glass@thinkingcoding1231.gmail.com`;
                };

                const createDialogGlass = async (dialogActor) => {
                    const path = getLiquidGlassPath();
                    const ext = Main.extensionManager.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                    const glassMod = await import(`file://${path}/dist/rendering/backdropGlass.js`);
                    const BackdropGlass = glassMod.BackdropGlass;

                    const stack = dialogActor.backgroundStack;
                    const dialogLayout = dialogActor.dialogLayout;
                    const dialogBox = dialogLayout?._dialog;
                    if (!stack || !dialogBox) return null;

                    // Remove any lingering glass from previous runs
                    for (const child of stack.get_children()) {
                        if (child.name === 'liquid-glass-dialog-actor') {
                            stack.remove_child(child);
                            try { child.destroy(); } catch (_) {}
                        }
                    }

                    const glass = new BackdropGlass({
                        extensionPath: path,
                        settings: ext?.stateObj?._settings || null,
                        logger: console,
                        owner: 'modal-dialog',
                    });
                    glass.name = 'liquid-glass-dialog-actor';

                    stack.insert_child_below(glass, dialogLayout);
                    try { glass.set_pivot_point(0, 0); } catch (_) {}
                    try { glass.x_expand = true; glass.y_expand = true; } catch (_) {}

                    glass.setIsDock(false);
                    glass.setCornerSmoothingEnabled(0.0);
                    glass.setPadding(0);
                    try {
                        glass._effect?._setFloat?.('shadow_intensity', 0.0);
                        glass._effect?._setFloat?.('shadow_radius', 0.0);
                        glass._effect?._setFloat?.('shadow_max_radius', 0.0);
                        glass._effect?._setFloat?.('ao_intensity', 0.0);
                        glass._effect?._setFloat?.('ao_radius', 0.0);
                    } catch (_) {}
                    glass.hide();

                    const state = {
                        dialogActor, dialogLayout, dialogBox, glass,
                        lastX: null, lastY: null, lastW: null, lastH: null,
                    };
                    const cleanUpState = () => {
                        globalThis._macDlgStates?.delete(state);
                        try { glass.destroy(); } catch (_) {}
                        if (dialogActor._macDlgGlassState === state)
                            delete dialogActor._macDlgGlassState;
                    };
                    dialogLayout.connect('destroy', cleanUpState);
                    dialogActor.connect('destroy', cleanUpState);
                    return state;
                };

                const syncDialogGlass = (state) => {
                    const { dialogActor, dialogBox, glass } = state;
                    // Actor validity guards
                    if (!dialogActor || !dialogBox || !glass) return;
                    if (dialogActor.is_finalized?.() || dialogBox.is_finalized?.() || glass.is_finalized?.()) return;

                    const isOpeningOrOpen = dialogActor.visible && dialogActor.mapped && dialogActor.opacity > 0;
                    if (!isOpeningOrOpen) {
                        if (glass.visible) glass.hide();
                        return;
                    }

                    glass.opacity = dialogActor.opacity;
                    if (!glass.visible) glass.show();

                    let monitorIndex = -1;
                    try {
                        const mc = dialogActor._monitorConstraint;
                        if (mc && mc.index !== undefined) monitorIndex = mc.index;
                    } catch (_) {}
                    if (monitorIndex < 0) monitorIndex = global.display.get_current_monitor();
                    let monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
                    const monitorX = monitor?.x ?? 0;
                    const monitorY = monitor?.y ?? 0;
                    const screenW = Math.max(1, monitor?.width ?? 1);
                    const screenH = Math.max(1, monitor?.height ?? 1);

                    const [diagAbsX, diagAbsY] = dialogBox.get_transformed_position();
                    const [w, h] = dialogBox.get_size();
                    if (diagAbsX == null || diagAbsY == null || Number.isNaN(diagAbsX) || Number.isNaN(diagAbsY) || w <= 1 || h <= 1) return;

                    const localBgX = Math.round(diagAbsX - monitorX);
                    const localBgY = Math.round(diagAbsY - monitorY);
                    const bgW = Math.round(w);
                    const bgH = Math.round(h);

                    if (state.lastX !== localBgX || state.lastY !== localBgY || state.lastW !== bgW || state.lastH !== bgH) {
                        state.lastX = localBgX;
                        state.lastY = localBgY;
                        state.lastW = bgW;
                        state.lastH = bgH;

                        // Tahoe-widget look: same engine/defaults as SwitcherPopup glass
                        glass.setResolution(screenW, screenH);
                        glass.setCornerRadius(35.0);
                        glass.setTintColor(0.0, 0.0, 0.0);
                        glass.setTintStrength(0.02);
                        glass.setBlurRadius(15.0);
                        glass.setPadding(0);
                        glass.setGlassGeometry(localBgX, localBgY, bgW, bgH);

                        try {
                            glass._effect?._setFloat?.('shadow_intensity', 0.0);
                            glass._effect?._setFloat?.('shadow_radius', 0.0);
                            glass._effect?._setFloat?.('shadow_max_radius', 0.0);
                            glass._effect?._setFloat?.('ao_intensity', 0.0);
                            glass._effect?._setFloat?.('ao_radius', 0.0);
                        } catch (_) {}

                        // Generous clip padding so drop shadows and blur never get hard-clipped
                        const CLIP_PAD = 160;
                        glass.set_clip(localBgX - CLIP_PAD, localBgY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);
                    }

                    if (typeof glass.syncSources === 'function') glass.syncSources();
                };

                const syncAllDialogs = () => {
                    if (!globalThis._macDlgStates || globalThis._macDlgStates.size === 0) return;
                    for (const state of [...globalThis._macDlgStates]) {
                        try { syncDialogGlass(state); } catch (_) {}
                    }
                };

                const attachDialogGlass = (dialogActor) => {
                    try {
                        if (!dialogActor) return;
                        if (dialogActor._macDlgGlassState) {
                            if (dialogActor._macDlgGlassState !== 'pending') {
                                if (globalThis._macDlgStates && !globalThis._macDlgStates.has(dialogActor._macDlgGlassState)) {
                                    globalThis._macDlgStates.add(dialogActor._macDlgGlassState);
                                }
                            }
                            return;
                        }
                        const stack = dialogActor.backgroundStack;
                        const dialogLayout = dialogActor.dialogLayout;
                        if (!stack || !dialogLayout?._dialog) return;
                        dialogActor._macDlgGlassState = 'pending';
                        createDialogGlass(dialogActor).then((state) => {
                            if (!state) { delete dialogActor._macDlgGlassState; return; }
                            globalThis._macDlgStates.add(state);
                            dialogActor._macDlgGlassState = state;
                        }).catch(() => { delete dialogActor._macDlgGlassState; });
                    } catch (_) {}
                };

                const attachIfSystemDialog = (child) => {
                    try {
                        if (child?.backgroundStack && child?.dialogLayout) attachDialogGlass(child);
                    } catch (_) {}
                };

                if (!globalThis._macDlgStates) {
                    globalThis._macDlgStates = new Set();
                } else {
                    // stale states from a previous extension run
                    globalThis._macDlgStates.clear();
                }
                if (globalThis._macDlgStageId) {
                    try { global.stage.disconnect(globalThis._macDlgStageId); } catch (_) {}
                    globalThis._macDlgStageId = 0;
                }
                if (globalThis._macDlgChildId) {
                    try {
                        Main.layoutManager.modalDialogGroup?.disconnect(globalThis._macDlgChildId);
                    } catch (_) {}
                    globalThis._macDlgChildId = 0;
                }

                globalThis._macDlgStageId = global.stage.connect('before-update', syncAllDialogs);

                const mg = Main.layoutManager.modalDialogGroup;
                if (mg) {
                    globalThis._macDlgChildId = mg.connect('child-added', (_, child) => attachIfSystemDialog(child));
                    for (const child of mg.get_children()) attachIfSystemDialog(child);
                }
                try { if (Main.endSessionDialog) attachIfSystemDialog(Main.endSessionDialog); } catch (_) {}

                if (!ModalDialog.prototype._macDlgGlassPatchedV1) {
                    ModalDialog.prototype._macDlgGlassPatchedV1 = true;
                    const origOpen = ModalDialog.prototype.open;
                    ModalDialog.prototype.open = function (...args) {
                        try { attachDialogGlass(this); } catch (_) {}
                        return origOpen.call(this, ...args);
                    };
                }
            } catch (e) {
                console.error('[EvalHelper] patchModalDialogLQVisual error: ' + e);
            }
        };
        patchModalDialogLQVisual();

        // Notification Center and Notification Banners are natively handled by blur-my-shell (menubar_v29 & notifications_v4)

        // Ensure GNOME Overview is strictly Mission Control (Window/Workspace picker only)
        // Ensure GNOME Overview is strictly Mission Control (Window/Workspace picker only)
        // Completely remove GNOME app grid and top "Введіть текст для пошуку" search bar
        const patchMissionControlOverview = () => {
            try {
                const controls = Main.overview?._overview?.controls;
                if (!controls) return;

                // 1. Stable, enlarged and lowered Workspaces Box (independent of panel expand/collapse)
                const lm = controls.layout_manager;
                if (lm && !lm._macOverviewSpacingPatchedV2) {
                    lm._macOverviewSpacingPatchedV2 = true;
                    const origCompute = lm._origComputeWorkspacesBox || lm._computeWorkspacesBoxForState;
                    lm._origComputeWorkspacesBox = origCompute;
                    lm._computeWorkspacesBoxForState = function(state, box, ...rest) {
                        if (state === 0 /* ControlsState.HIDDEN (Desktop) */) {
                            const mon = Main.layoutManager.primaryMonitor;
                            const res = new Clutter.ActorBox();
                            res.set_origin(0, 0);
                            res.set_size(mon.width, mon.height);
                            return res;
                        }
                        if (state === 1 /* OverviewControls.ControlsState.WINDOW_PICKER */) {
                            const baseBox = box || this._workAreaBox;
                            const [w, h] = baseBox.get_size();
                            // Raised workspaces: compact top buffer below Spaces Bar, generous bottom buffer to clear Dock and app icon badges!
                            const topBuffer = Math.max(48, Math.round(h * 0.046));
                            const bottomBuffer = Math.max(145, Math.round(h * 0.138));
                            const res = baseBox.copy();
                            res.x1 = baseBox.x1 || 0;
                            res.y1 = (baseBox.y1 || 0) + topBuffer;
                            res.x2 = res.x1 + w;
                            res.y2 = Math.max(res.y1 + 100, (baseBox.y1 || 0) + h - bottomBuffer);
                            return res;
                        }
                        return origCompute.call(this, state, box, ...rest);
                    };
                }

                // 2. Full-monitor workspace layout and background (eliminates gaps under menubar and dock)
                (async () => {
                    try {
                        const { WorkspaceBackground, WorkspaceLayout } = await import('resource:///org/gnome/shell/ui/workspace.js');
                        if (WorkspaceLayout && !WorkspaceLayout.prototype._macWorkareaPatched) {
                            WorkspaceLayout.prototype._macWorkareaPatched = true;
                            WorkspaceLayout.prototype._origGetAdjustedWorkarea = WorkspaceLayout.prototype._getAdjustedWorkarea;
                            WorkspaceLayout.prototype._getAdjustedWorkarea = function(container) {
                                const mon = Main.layoutManager.monitors[this._monitorIndex] || Main.layoutManager.primaryMonitor;
                                return new Mtk.Rectangle({
                                    x: 0,
                                    y: 0,
                                    width: mon.width,
                                    height: mon.height,
                                });
                            };
                        }
                        if (WorkspaceBackground && !WorkspaceBackground.prototype._macClipPatched) {
                            WorkspaceBackground.prototype._macClipPatched = true;
                            WorkspaceBackground.prototype._origUpdateRoundedClipBounds = WorkspaceBackground.prototype._updateRoundedClipBounds;
                            WorkspaceBackground.prototype._updateRoundedClipBounds = function() {
                                try {
                                    const monitor = Main.layoutManager.monitors[this._monitorIndex] || Main.layoutManager.primaryMonitor;
                                    if (monitor) {
                                        const rect = new Graphene.Rect();
                                        rect.origin.x = 0;
                                        rect.origin.y = 0;
                                        rect.size.width = monitor.width;
                                        rect.size.height = monitor.height;
                                        this._bgManager.backgroundActor.content.set_rounded_clip_bounds(rect);
                                        return;
                                    }
                                } catch (_) {}
                                this._origUpdateRoundedClipBounds();
                            };
                        }
                    } catch (e) {
                        console.error('[EvalHelper] Error patching WorkspaceLayout/Background:', e);
                    }
                })();

                // 3. Unhide window_group on overview hiding so wallpaper is continuously visible behind overview exit
                if (!Main.overview._macWgHidingConn) {
                    Main.overview._macWgHidingConn = Main.overview.connect('hiding', () => {
                        global.window_group.show();
                    });
                }

                // 4. Hide and keep AppDisplay hidden
                controls._updateAppDisplayVisibility = function() {
                    if (this._appDisplay) {
                        this._appDisplay.visible = false;
                        this._appDisplay.opacity = 0;
                    }
                };
                if (controls._appDisplay) {
                    controls._appDisplay.visible = false;
                    controls._appDisplay.opacity = 0;
                }

                // 5. Override _shiftState: Down closes overview, Up does NOT go to APP_GRID
                controls._shiftState = function(direction) {
                    if (direction === Meta.MotionDirection.DOWN) {
                        Main.overview.hide();
                    }
                };

                // 6. Override showApps and _toggleAppsPage to toggle our Mac Applications Menu
                controls._toggleAppsPage = function() {
                    if (typeof globalThis.toggleMacApplications === 'function') {
                        globalThis.toggleMacApplications();
                    }
                };
                Main.overview.showApps = function() {
                    if (typeof globalThis.toggleMacApplications === 'function') {
                        globalThis.toggleMacApplications();
                    }
                };

                // 7. Hide search entry and searchEntryBin completely (no "Введіть текст для пошуку")
                if (controls._searchEntryBin) {
                    controls._searchEntryBin.visible = false;
                    controls._searchEntryBin.opacity = 0;
                    controls._searchEntryBin.height = 0;
                    controls._searchEntryBin.get_preferred_height = () => [0, 0];
                    controls._searchEntryBin.get_preferred_width = () => [0, 0];
                }
                if (controls._searchEntry) {
                    controls._searchEntry.visible = false;
                    controls._searchEntry.opacity = 0;
                    controls._searchEntry.height = 0;
                    controls._searchEntry.get_preferred_height = () => [0, 0];
                    controls._searchEntry.get_preferred_width = () => [0, 0];
                }

                // 8. Disable search controller triggering in overview
                if (controls._searchController) {
                    controls._searchController._shouldTriggerSearch = () => false;
                    if (controls._searchController._entry) {
                        controls._searchController._entry.visible = false;
                        controls._searchController._entry.opacity = 0;
                    }
                }
            } catch (e) {
                console.error('[EvalHelper] patchMissionControlOverview error: ' + e);
            }
        };
        patchMissionControlOverview();

        // Ensure GNOME Overview always has a solid, crisp desktop wallpaper background behind all workspaces
        // Completely eliminates window ghosting, Solitaire Win98 trails, and transparent stage margins on physical display
        try {
            this._overviewWallpaperManager = new OverviewWallpaperManager();
        } catch (e) {
            console.error('[EvalHelper] OverviewWallpaperManager init error: ' + e);
        }

        // Ensure blur-my-shell panel overview and folder transitions are smooth, seamless and dynamic
        const patchPanelOverviewAndFolders = () => {
            try {
                const pb = Main.extensionManager?.lookup?.('blur-my-shell@aunetx')?.stateObj?._panel_blur;
                if (!pb) return;
                const proto = Object.getPrototypeOf(pb);
                if (proto._macOverviewPatchedV4) return;
                proto._macOverviewPatchedV4 = true;

                proto._ensure_overview_effects_configured = function(_bg) {};

                proto.set_appfolder_open = function(isOpen) {
                    this._appfolder_is_open = !!isOpen;
                    const overviewRadius = (this.settings.overview?.SIGMA ?? 30.0);
                    const overviewBrightness = (this.settings.overview?.BRIGHTNESS ?? 1.0);
                    const folderSigma = (this.settings.appfolder?.SIGMA ?? 30.0);
                    const targetRadius = isOpen
                        ? Math.round(overviewRadius + folderSigma * 1.5)
                        : overviewRadius;
                    const targetBrightness = isOpen ? 0.90 : overviewBrightness;

                    const ov = global.blur_my_shell?._overview_blur;
                    if (ov && ov.overview_background_group) {
                        const children = ov.overview_background_group.get_children();
                        for (let widget of children) {
                            const effs = widget.get_effects?.() || [];
                            effs.forEach((e, idx) => {
                                const name = e.name || `bms-ov-eff-${idx}`;
                                if (!e.name) e.name = name;
                                try {
                                    widget.remove_transition(`@effects.${name}.radius`);
                                    widget.remove_transition(`@effects.${name}.brightness`);
                                    widget.ease_property(`@effects.${name}.radius`, targetRadius, {
                                        duration: 220,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                    });
                                    widget.ease_property(`@effects.${name}.brightness`, targetBrightness, {
                                        duration: 220,
                                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                    });
                                } catch (_) {
                                    if (typeof e.radius !== 'undefined') e.radius = targetRadius;
                                    if (typeof e.brightness !== 'undefined') e.brightness = targetBrightness;
                                }
                            });
                        }
                    }

                    if (Main.panel) {
                        Main.panel.set_style(
                            `background-color: transparent !important; ` +
                            `background: transparent !important; ` +
                            `box-shadow: none !important; ` +
                            `border-bottom: none !important; ` +
                            `transition-duration: 220ms !important;`
                        );
                    }
                };

                proto.animate_overview_transition = function(isOverview, durationMs = 300) {
                    try {
                        const duration = durationMs;

                        // 1. Panel Blur Actors: ALWAYS HIDDEN on desktop and overview!
                        this.actors_list?.forEach(actors => {
                            const bg = actors.widgets?.background;
                            if (!bg) return;
                            bg.remove_all_transitions();
                            bg.opacity = 0;
                            if (bg.visible) bg.hide();
                        });

                        // 2. Main.panel: Clean transparent bar without dark gradient overlay
                        if (Main.panel) {
                            Main.panel.opacity = 255;
                            Main.panel.set_style(
                                `background-color: transparent !important; ` +
                                `background: transparent !important; ` +
                                `box-shadow: none !important; ` +
                                `border-bottom: none !important; ` +
                                `transition-duration: ${duration}ms !important;`
                            );
                        }
                    } catch (e) {
                        console.error(`[PanelOverview] error: ${e}`);
                    }
                };

                proto.on_overview_progress = function(_progress) {
                    // Disabled continuous polling to eliminate GPU/CPU lag
                };

                proto._on_overview_adjustment_changed = function(_stateAdjustment) {
                    // Disabled dynamic adjustment tracking - fixed 0.3s transition used instead
                };

                proto.set_overview_blur = function(enabled) {
                    this.animate_overview_transition(enabled, 300);
                };

                if (!pb._macFixedOverviewConnected) {
                    pb._macFixedOverviewConnected = true;
                    Main.overview.connect('showing', () => {
                        pb.animate_overview_transition(true, 300);
                    });
                    Main.overview.connect('hiding', () => {
                        pb.animate_overview_transition(false, 300);
                    });
                }
            } catch (_) {}
        };
        patchPanelOverviewAndFolders();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            patchPanelOverviewAndFolders();
            return GLib.SOURCE_REMOVE;
        });



        // Steal focus / automatically raise windows that demand attention or are newly opened
        const wah = Main.windowAttentionHandler;
        if (wah && !this._origOnWindowDemandsAttention) {
            this._origOnWindowDemandsAttention = wah._onWindowDemandsAttention.bind(wah);
            wah._onWindowDemandsAttention = function(display, window) {
                if (!window || window.has_focus() || window.is_skip_taskbar())
                    return;
                Main.activateWindow(window);
            };
        }

        this._demandsAttentionId = global.display.connect('window-demands-attention', (display, window) => {
            if (window && !window.has_focus() && !window.is_skip_taskbar()) {
                Main.activateWindow(window);
            }
        });

        this._markedUrgentId = global.display.connect('window-marked-urgent', (display, window) => {
            if (window && !window.has_focus() && !window.is_skip_taskbar()) {
                Main.activateWindow(window);
            }
        });

        this._mapId = global.window_manager.connect('map', (wm, windowActor) => {
            let window = windowActor.get_meta_window ? windowActor.get_meta_window() : null;
            if (!window)
                return;
            let type = window.get_window_type();
            if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG && type !== Meta.WindowType.MODAL_DIALOG)
                return;
            if (window.is_skip_taskbar())
                return;
            if (window.customJS_ding && window.customJS_ding.keepAtBottom)
                return;

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (window && !window.has_focus() && !window.is_skip_taskbar()) {
                    Main.activateWindow(window);
                }
                return GLib.SOURCE_REMOVE;
            });
        });

        // macOS Startup Transition: Smooth opacity fade-in, rock-solid wallpaper (no zoom/scale)
        if (Main.layoutManager?.panelBox) {
            Main.layoutManager.panelBox.opacity = 255;
            Main.layoutManager.panelBox.visible = true;
        }

        Main.overview.connectObject('hiding', () => {
            if (Main.layoutManager?.panelBox && Main.layoutManager.panelBox.opacity !== 255) {
                Main.layoutManager.panelBox.opacity = 255;
            }
        }, this);

        if (Main.layoutManager) {
            this._origStartupAnimationSession = Main.layoutManager._startupAnimationSession;
            Main.layoutManager._startupAnimationSession = async function() {
                this.panelBox.ease({
                    opacity: 255,
                    duration: 400,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                if (this._startInOverview) {
                    await Main.overview.runStartupAnimation();
                } else {

                    for (const child of this.uiGroup.get_children()) {
                        if (child !== this._backgroundGroup && child !== this._systemBackground && child !== this._coverPane) {
                            if (child.opacity !== 255) {
                                child.ease({
                                    opacity: 255,
                                    duration: 400,
                                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                });
                            }
                        }
                    }

                    await global.window_group.easeAsync({
                        opacity: 255,
                        duration: 400,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    }).catch(() => {});
                }
            };
        }

        // macOS MenuBar Interaction Model:
        // When Control Center (QuickSettings) or Notification Center (DateMenu) is open:
        // 1. Hover-switching is strictly disabled. Moving the mouse across other buttons
        //    (Wi-Fi, Bluetooth, Sound, Battery, Keyboard, AppIndicators) does NOT open them.
        // 2. Opening any other menu requires explicitly pressing that button ("потрібно натиснути на іншу кнопку").
        // 3. When the user clicks on another button in the menu bar, it immediately switches in ONE single click.
        const setupMacMenuBarInteraction = async () => {
            try {
                const { PopupAnimation } = await import('resource:///org/gnome/shell/ui/boxpointer.js');
                const pmm = Main.panel?.menuManager;
                if (!pmm) return;

                if (!pmm._macOrigChangeMenu) {
                    pmm._macOrigChangeMenu = pmm._changeMenu;
                    pmm._changeMenu = function(newMenu) {
                        const active = this.activeMenu;
                        const qsMenu = Main.panel?.statusArea?.quickSettings?.menu;
                        const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                        const notifOpen = Boolean(globalThis._macNotificationCenter?._notifCenterOpen);

                        // If Control Center or Notification Center is active, or if hovering onto them: NO hover switching!
                        if (active === qsMenu || active === dmMenu || notifOpen || newMenu === qsMenu || newMenu === dmMenu) {
                            return;
                        }

                        return this._macOrigChangeMenu(newMenu);
                    };
                }

                if (!pmm._macOrigOnCapturedEvent) {
                    pmm._macOrigOnCapturedEvent = pmm._onCapturedEvent;
                    pmm._onCapturedEvent = function(actor, event) {
                        const menu = actor?._delegate;
                        const targetActor = global.stage.get_event_actor(event);
                        const qsMenu = Main.panel?.statusArea?.quickSettings?.menu;
                        const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                        const notifOpen = Boolean(globalThis._macNotificationCenter?._notifCenterOpen);

                        // Block hover switching from Control Center or Notification Center
                        if (event.type() === Clutter.EventType.ENTER) {
                            if (menu === qsMenu || menu === dmMenu || notifOpen) {
                                return Clutter.EVENT_PROPAGATE;
                            }
                        }

                        // On Click outside the active popup menu
                        if ((event.type() === Clutter.EventType.BUTTON_PRESS ||
                             event.type() === Clutter.EventType.TOUCH_BEGIN) &&
                            targetActor && actor && !actor.contains(targetActor)) {

                            const clickedMenu = this._findMenuForSource(targetActor);
                            if (clickedMenu && clickedMenu !== menu) {
                                // User intentionally clicked on another menu in the panel!
                                // Immediately change to the clicked menu atomically without desync.
                                this._changeMenu(clickedMenu);
                                return Clutter.EVENT_STOP;
                            }
                        }

                        return this._macOrigOnCapturedEvent(actor, event);
                    };

                    const rewire = () => {
                        for (const m of (pmm._menus || [])) {
                            if (m && m.actor) {
                                try {
                                    m.actor.disconnectObject(pmm);
                                    m.actor.connectObject('captured-event',
                                        pmm._onCapturedEvent.bind(pmm), pmm);
                                } catch (_) {}
                            }
                            if (m && !m._macCloseNotifConnected) {
                                m._macCloseNotifConnected = true;
                                m.connectObject('open-state-changed', (_menu, open) => {
                                    const dmMenu = Main.panel?.statusArea?.dateMenu?.menu;
                                    if (open && globalThis._macNotificationCenter?._notifCenterOpen && _menu !== dmMenu) {
                                        globalThis._macNotificationCenter._closeNotificationCenter();
                                    }
                                }, pmm);
                            }
                        }
                    };
                    rewire();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                        rewire();
                        return GLib.SOURCE_REMOVE;
                    });
                }

                // Ensure Wifi, Bluetooth, Volume menus are populated and ready
                const wifi = Main.panel?.statusArea?.macWifi;
                if (wifi && typeof wifi._populateMenu === 'function') {
                    try { wifi._populateMenu(); } catch (_) {}
                }
                const bt = Main.panel?.statusArea?.macBluetooth;
                if (bt && typeof bt._populateMenu === 'function') {
                    try { bt._populateMenu(); } catch (_) {}
                }
                const vol = Main.panel?.statusArea?.macVolume;
                if (vol && typeof vol._populateMenu === 'function') {
                    try { vol._populateMenu(); } catch (_) {}
                }
            } catch (_) {}
        };
        setupMacMenuBarInteraction();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            setupMacMenuBarInteraction();
            return GLib.SOURCE_REMOVE;
        });

        // Periodic GNOME Shell memory compaction / Garbage Collection every 3 minutes
        this._gcIntervalId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 180, () => {
            try {
                if (typeof imports.system.gc === 'function') {
                    imports.system.gc();
                }
            } catch (_) {}
            return GLib.SOURCE_CONTINUE;
        });

        // Permanent Launchpad ("Програми") dock icon protection:
        // Ensures launchpad.desktop cannot be unpinned, and is always present in favorite-apps,
        // while allowing free drag-and-drop reordering anywhere on the dock.
        this._setupLaunchpadProtection();
    }

    async _setupLaunchpadProtection() {
        try {
            const { getAppFavorites } = await import('resource:///org/gnome/shell/ui/appFavorites.js');
            const favs = getAppFavorites();
            if (favs) {
                const proto = Object.getPrototypeOf(favs);
                favs.removeFavorite = function(appId) {
                    if (appId === 'launchpad.desktop') {
                        return; // Disallow unpinning Launchpad
                    }
                    return proto.removeFavorite.call(this, appId);
                };

                favs.moveFavoriteToPos = function(appId, pos) {
                    globalThis._isMovingFavorite = true;
                    try {
                        return proto.moveFavoriteToPos.call(this, appId, pos);
                    } finally {
                        globalThis._isMovingFavorite = false;
                    }
                };
            }

            const ensureLaunchpad = () => {
                if (globalThis._isMovingFavorite) return;
                let current = global.settings.get_strv('favorite-apps');
                if (!current.includes('launchpad.desktop')) {
                    let nautilusIdx = current.indexOf('org.gnome.Nautilus.desktop');
                    if (nautilusIdx !== -1) {
                        current.splice(nautilusIdx + 1, 0, 'launchpad.desktop');
                    } else {
                        current.unshift('launchpad.desktop');
                    }
                    global.settings.set_strv('favorite-apps', current);
                }
            };
            ensureLaunchpad();

            if (!this._favChangedId) {
                this._favChangedId = global.settings.connect('changed::favorite-apps', ensureLaunchpad);
            }

            const { AppMenu } = await import('resource:///org/gnome/shell/ui/appMenu.js');
            if (AppMenu && !this._origUpdateFavoriteItem) {
                this._origUpdateFavoriteItem = AppMenu.prototype._updateFavoriteItem;
                AppMenu.prototype._updateFavoriteItem = function() {
                    if (this._app?.get_id?.() === 'launchpad.desktop') {
                        if (this._favoriteItem) {
                            this._favoriteItem.destroy();
                            this._favoriteItem = null;
                        }
                        return;
                    }
                    return this._origUpdateFavoriteItem ? this._origUpdateFavoriteItem.apply(this, arguments) : null;
                };
            }

            import('file:///home/vitaliy/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu_v5.js?t=' + Date.now())
                .then(mod => {
                    globalThis.toggleMacApplications = mod.toggleApplicationsDialog;
                }).catch(e => console.error('[EvalHelper] Error loading applications_menu:', e));

            const toggleLaunchpad = () => {
                const now = Date.now();
                if (globalThis._lastLaunchpadToggle && (now - globalThis._lastLaunchpadToggle < 300)) {
                    return;
                }
                globalThis._lastLaunchpadToggle = now;
                if (typeof globalThis.toggleMacApplications === 'function') {
                    globalThis.toggleMacApplications();
                } else {
                    import('file:///home/vitaliy/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu_v5.js?t=' + Date.now())
                        .then(mod => {
                            globalThis.toggleMacApplications = mod.toggleApplicationsDialog;
                            mod.toggleApplicationsDialog();
                        }).catch(e => console.error('[EvalHelper] Error toggling applications menu:', e));
                }
            };

            const origActivate = Shell.App.prototype._origActivate || Shell.App.prototype.activate;
            Shell.App.prototype._origActivate = origActivate;
            Shell.App.prototype.activate = function(...args) {
                if (this.get_id() === 'launchpad.desktop') {
                    toggleLaunchpad();
                    return;
                }
                return origActivate.apply(this, args);
            };
        } catch (e) {
            console.error(`[EvalHelper] Launchpad protection error: ${e}`);
        }

        // Menubar Context & Popup Menu Appearance Animation (authentic 0.3s scale & fade)
        try {
            import('resource:///org/gnome/shell/ui/boxpointer.js').then((BoxPointer) => {
                if (!this._origBoxPointerOpen) {
                    this._origBoxPointerOpen = BoxPointer.BoxPointer.prototype.open;
                    this._origBoxPointerClose = BoxPointer.BoxPointer.prototype.close;
                }
                BoxPointer.BoxPointer.prototype.open = function(animate, onComplete) {
                    if (this._closeTimeoutId) {
                        GLib.source_remove(this._closeTimeoutId);
                        this._closeTimeoutId = 0;
                    }
                    this.remove_all_transitions();
                    this._muteKeys = false;
                    this.show();

                    const pivotY = (this.arrowSide === St.Side.BOTTOM) ? 1.0 : 0.0;
                    const pivotX = (this.arrowSide === St.Side.RIGHT) ? 1.0 : (this.arrowSide === St.Side.LEFT ? 0.0 : 0.5);
                    this.set_pivot_point(pivotX, pivotY);
                    this.translation_x = 0;
                    this.translation_y = 0;

                    // When animate is explicitly disabled (0 or false), show instantly
                    if (animate === 0 || animate === false) {
                        this.opacity = 255;
                        this.scale_x = 1.0;
                        this.scale_y = 1.0;
                        this._muteInput = false;
                        if (onComplete) onComplete();
                        return;
                    }

                    // Authentic macOS Tahoe appearance animation: scale 0.95 -> 1.0, fade-in 0 -> 255
                    this.opacity = 0;
                    this.scale_x = 0.95;
                    this.scale_y = 0.95;

                    this.ease({
                        opacity: 255,
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onComplete: () => {
                            this._muteInput = false;
                            if (onComplete) onComplete();
                        }
                    });
                };

                BoxPointer.BoxPointer.prototype.close = function(animate, onComplete) {
                    if (this._closeTimeoutId) {
                        GLib.source_remove(this._closeTimeoutId);
                        this._closeTimeoutId = 0;
                    }
                    if (!this.visible) {
                        if (onComplete) onComplete();
                        return;
                    }
                    this.remove_all_transitions();
                    this._muteInput = true;
                    this._muteKeys = true;

                    const finalizeClose = () => {
                        if (this._closeTimeoutId) {
                            GLib.source_remove(this._closeTimeoutId);
                            this._closeTimeoutId = 0;
                        }
                        this.hide();
                        this.opacity = 0;
                        this.scale_x = 1.0;
                        this.scale_y = 1.0;
                        this.translation_x = 0;
                        this.translation_y = 0;
                        if (onComplete) onComplete();

                        // Guard against lingering dimming glass overlays
                        try {
                            const uiGroup = Main.layoutManager.uiGroup;
                            if (uiGroup) {
                                const hasOpen = Main.panel?.menuManager?._menus?.some(m => m.isOpen);
                                if (!hasOpen) {
                                    for (const c of uiGroup.get_children()) {
                                        if (c.name && c.name.startsWith('liquid-glass-bg-actor')) {
                                            const box = c.get_children ? c.get_children()[0] : null;
                                            const eff = box?.get_effects ? box.get_effects()[0] : null;
                                            const owner = eff?._owner || '';
                                            if (owner === 'menu' || owner.startsWith('menu:') || owner === 'switcher-popup') {
                                                if (c.visible) {
                                                    c.hide();
                                                    c.opacity = 0;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (_) {}
                    };

                    // Synchronous instant close when:
                    // 1) animate is 0 or false
                    // 2) animate is PopupAnimation.FADE (used during menu switching in PopupMenuManager._changeMenu)
                    // 3) FULL bit is not set
                    if (animate === 0 || animate === false || animate === BoxPointer.PopupAnimation.FADE || !(animate & BoxPointer.PopupAnimation.FULL)) {
                        finalizeClose();
                        return;
                    }

                    // For animated close (PopupAnimation.FULL):
                    // Safety timer to guarantee hide() even if transition is interrupted or dropped
                    this._closeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
                        this._closeTimeoutId = 0;
                        finalizeClose();
                        return GLib.SOURCE_REMOVE;
                    });

                    const pivotY = (this.arrowSide === St.Side.BOTTOM) ? 1.0 : 0.0;
                    const pivotX = (this.arrowSide === St.Side.RIGHT) ? 1.0 : (this.arrowSide === St.Side.LEFT ? 0.0 : 0.5);
                    this.set_pivot_point(pivotX, pivotY);

                    this.ease({
                        opacity: 0,
                        scale_x: 0.96,
                        scale_y: 0.96,
                        duration: 140,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: finalizeClose
                    });
                };
            }).catch(e => console.error(`[EvalHelper] BoxPointer patch error: ${e}`));
        } catch (e) {
            console.error(`[EvalHelper] BoxPointer setup error: ${e}`);
        }

        // Anti-dimming watchdog: continuously ensure no stuck full-screen glass dimmer dims the screen
        this._dimmerWatchdogId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, () => {
            try {
                const uiGroup = Main.layoutManager.uiGroup;
                if (uiGroup) {
                    const hasOpen = Main.panel?.menuManager?._menus?.some(m => m.isOpen);
                    for (const c of uiGroup.get_children()) {
                        if (c.name && c.name.startsWith('liquid-glass-bg-actor')) {
                            const box = c.get_children ? c.get_children()[0] : null;
                            const eff = box?.get_effects ? box.get_effects()[0] : null;
                            const owner = eff?._owner || '';
                            if (owner === 'menu' || owner.startsWith('menu:') || owner === 'switcher-popup') {
                                if (!hasOpen && c.visible) {
                                    c.hide();
                                    c.opacity = 0;
                                }
                            }
                        }
                    }
                }
            } catch (_) {}
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._dimmerWatchdogId) {
            GLib.source_remove(this._dimmerWatchdogId);
            this._dimmerWatchdogId = 0;
        }

        if (this._origBoxPointerOpen) {
            try {
                import('resource:///org/gnome/shell/ui/boxpointer.js').then((BoxPointer) => {
                    if (this._origBoxPointerOpen) BoxPointer.BoxPointer.prototype.open = this._origBoxPointerOpen;
                    if (this._origBoxPointerClose) BoxPointer.BoxPointer.prototype.close = this._origBoxPointerClose;
                });
            } catch (_) {}
            this._origBoxPointerOpen = null;
            this._origBoxPointerClose = null;
        }

        if (this._dbusImpl) {
            try { this._dbusImpl.unexport(); } catch (_) {}
            this._dbusImpl = null;
        }

        const fdo = Main.notificationDaemon?._fdoNotificationDaemon;
        if (fdo && this._origGetSourceForPidAndName) {
            fdo._getSourceForPidAndName = this._origGetSourceForPidAndName;
            this._origGetSourceForPidAndName = null;
        }

        const wah = Main.windowAttentionHandler;
        if (wah && this._origOnWindowDemandsAttention) {
            wah._onWindowDemandsAttention = this._origOnWindowDemandsAttention;
            this._origOnWindowDemandsAttention = null;
        }

        if (this._demandsAttentionId) {
            global.display.disconnect(this._demandsAttentionId);
            this._demandsAttentionId = null;
        }

        if (this._markedUrgentId) {
            global.display.disconnect(this._markedUrgentId);
            this._markedUrgentId = null;
        }

        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = null;
        }

        try { Main.overview.disconnectObject(this); } catch (_) {}

        if (this._overviewWallpaperManager) {
            try { this._overviewWallpaperManager.destroy(); } catch (_) {}
            this._overviewWallpaperManager = null;
        }

        if (Main.layoutManager && this._origStartupAnimationSession) {
            Main.layoutManager._startupAnimationSession = this._origStartupAnimationSession;
            this._origStartupAnimationSession = null;
        }

        if (this._gcIntervalId) {
            GLib.source_remove(this._gcIntervalId);
            this._gcIntervalId = null;
        }

        if (this._favChangedId) {
            global.settings.disconnect(this._favChangedId);
            this._favChangedId = null;
        }

        if (this._origRemoveFavorite) {
            try {
                import('resource:///org/gnome/shell/ui/appFavorites.js').then(({ getAppFavorites }) => {
                    const favs = getAppFavorites();
                    if (favs) {
                        favs.removeFavorite = this._origRemoveFavorite;
                        favs.moveFavoriteToPos = this._origMoveFavoriteToPos;
                    }
                });
            } catch (_) {}
            this._origRemoveFavorite = null;
            this._origMoveFavoriteToPos = null;
        }

        if (this._disableExtSignalId && this._shellSettings) {
            this._shellSettings.disconnect(this._disableExtSignalId);
            this._disableExtSignalId = null;
        }

        if (this._userThemeSignalId && this._userThemeSettings) {
            this._userThemeSettings.disconnect(this._userThemeSignalId);
            this._userThemeSignalId = null;
        }

        if (this._origUpdateFavoriteItem) {
            try {
                import('resource:///org/gnome/shell/ui/appMenu.js').then(({ AppMenu }) => {
                    if (AppMenu) AppMenu.prototype._updateFavoriteItem = this._origUpdateFavoriteItem;
                });
            } catch (_) {}
            this._origUpdateFavoriteItem = null;
        }

        if (this._dockSignals) {
            for (const id of this._dockSignals) {
                try { global.display.disconnect(id); } catch (_) {}
                try { global.window_manager.disconnect(id); } catch (_) {}
                try { Main.overview.disconnect(id); } catch (_) {}
            }
            this._dockSignals = null;
            this._macDockSignalsConnected = false;
        }

        if (this._dockMagSignals) {
            for (const id of this._dockMagSignals) {
                try { Main.overview.disconnect(id); } catch (_) {}
            }
            this._dockMagSignals = null;
            this._dockMagSignalsConnected = false;
        }

        if (this._origIsPointerOverDock) {
            try {
                const d2d = Main.uiGroup?.get_children?.()?.find(c => c.name === 'dashtodockContainer');
                const mag = d2d?._dock?._magnifier || d2d?._magnifier;
                if (mag && mag.constructor?.prototype) {
                    mag.constructor.prototype._isPointerOverDock = this._origIsPointerOverDock;
                }
            } catch (_) {}
            this._origIsPointerOverDock = null;
        }

        if (this._origBmsUpdateSize) {
            try {
                const bmsExt = Main.extensionManager.lookup('blur-my-shell@aunetx');
                const appsBlur = bmsExt?.stateObj?._applications_blur;
                if (appsBlur?.constructor?.prototype) {
                    appsBlur.constructor.prototype.update_size = this._origBmsUpdateSize;
                }
            } catch (_) {}
            this._origBmsUpdateSize = null;
        }

        if (globalThis._macDlgStageId) {
            try { global.stage.disconnect(globalThis._macDlgStageId); } catch (_) {}
            globalThis._macDlgStageId = 0;
        }
        if (globalThis._macDlgChildId) {
            try { Main.layoutManager.modalDialogGroup?.disconnect(globalThis._macDlgChildId); } catch (_) {}
            globalThis._macDlgChildId = 0;
        }
        if (globalThis._macDlgStates) {
            for (const st of globalThis._macDlgStates) {
                try { st.glass?.hide(); } catch (_) {}
            }
        }

        if (PopupMenu.PopupMenu.prototype._origMacGlideOpen) {
            PopupMenu.PopupMenu.prototype.open = PopupMenu.PopupMenu.prototype._origMacGlideOpen;
            PopupMenu.PopupMenu.prototype._origMacGlideOpen = null;
        }
        if (Main.panel.menuManager?._origMacGlideAddMenu) {
            Main.panel.menuManager.addMenu = Main.panel.menuManager._origMacGlideAddMenu;
            Main.panel.menuManager._origMacGlideAddMenu = null;
        }
    }
}
