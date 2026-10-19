import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import Mtk from 'gi://Mtk';

const EvalIface = `
<node>
  <interface name="org.gnome.Shell.Extensions.EvalHelper">
    <method name="Eval">
      <arg type="s" direction="in" name="code"/>
      <arg type="s" direction="out" name="result"/>
    </method>
  </interface>
</node>`;

export default class EvalHelper extends Extension {
    enable() {
        globalThis.Clutter = Clutter;
        globalThis.Gio = Gio;
        globalThis.GLib = GLib;
        globalThis.Meta = Meta;
        globalThis.Main = Main;
        globalThis.Mtk = Mtk;
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
                // Connect window movement and overview signals to immediately refresh dock glass
                const triggerAllDocks = (durationMs = 500) => {
                    if (!global._lgGlass?.glassObjects) return;
                    for (const g of global._lgGlass.glassObjects()) {
                        if (g._owner === 'dock' && g.mapped && g.visible && g.width > 10) {
                            g._copier?.clear();
                            if (typeof g.forceRefresh === 'function') g.forceRefresh(durationMs);
                            if (typeof g.syncSources === 'function') g.syncSources(true);
                            g.queue_redraw();
                        }
                    }
                };

                if (!this._macDockSignalsConnected) {
                    this._macDockSignalsConnected = true;
                    this._dockSignals = [
                        global.display.connect('restacked', () => triggerAllDocks(400)),
                        global.display.connect('grab-op-begin', () => triggerAllDocks(1000)),
                        global.display.connect('grab-op-end', () => triggerAllDocks(500)),
                    ];
                    if (global.window_manager) {
                        this._dockSignals.push(
                            global.window_manager.connect('size-change', () => triggerAllDocks(500)),
                            global.window_manager.connect('switch-workspace', () => triggerAllDocks(600))
                        );
                    }
                    this._dockSignals.push(
                        Main.overview.connect('showing', () => triggerAllDocks(600)),
                        Main.overview.connect('hiding', () => triggerAllDocks(600)),
                        Main.overview.connect('shown', () => triggerAllDocks(400)),
                        Main.overview.connect('hidden', () => triggerAllDocks(600))
                    );
                }
            } catch (_) {}
        };
        patchLiquidGlass();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            patchLiquidGlass();
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
                            const mod = await import(`file://${ext.path}/searchDialog_v5.js`);
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

        // Patch SwitcherPopup (Alt+Tab) with LQ-Visual glass
        const patchSwitcherPopupLQVisual = async () => {
            try {
                const SwitcherPopupMod = await import('resource:///org/gnome/shell/ui/switcherPopup.js');
                const SwitcherPopup = SwitcherPopupMod.SwitcherPopup;
                if (!SwitcherPopup) return;

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
                        glass.setCornerRadius(24.0);
                        glass.setTintColor(0.0, 0.0, 0.0);
                        glass.setTintStrength(0.04);
                        glass.setBlurRadius(8.0);
                        glass.setPadding(0);
                        try {
                            glass._renderer.uniforms.set('shadow_intensity', 0.0);
                            glass._renderer.uniforms.set('shadow_radius', 0.0);
                            glass._renderer.uniforms.set('shadow_max_radius', 0.0);
                        } catch (_) {}
                        glass.hide();
                        Main.layoutManager.uiGroup.add_child(glass);
                        globalThis._macSwitcherGlass = glass;
                    }
                    return glass;
                };

                // Preload glass asynchronously
                getSwitcherGlass().catch(() => {});

                if (!SwitcherPopup.prototype._macLQVisualPatchedV3) {
                    SwitcherPopup.prototype._macLQVisualPatchedV3 = true;
                    const origShow = SwitcherPopup.prototype.show;
                    SwitcherPopup.prototype.show = function(backward, binding, mask) {
                        const res = origShow.call(this, backward, binding, mask);
                        if (!res) return res;

                        (async () => {
                            try {
                                const switcherGlass = await getSwitcherGlass();
                                if (!switcherGlass) return;
                                Main.layoutManager.uiGroup.set_child_below_sibling(switcherGlass, this);

                                const syncGlass = () => {
                                    if (!this._switcherList) return;
                                    if (!this.visible || this.opacity <= 0) {
                                        if (switcherGlass.visible) switcherGlass.hide();
                                        return;
                                    }

                                    const slBox = this._switcherList.get_allocation_box();
                                    const w = slBox.get_width();
                                    const h = slBox.get_height();
                                    const x = slBox.x1;
                                    const y = slBox.y1;
                                    if (w <= 0 || h <= 0) return;

                                    const primary = Main.layoutManager.primaryMonitor;
                                    const localX = Math.round(x - primary.x);
                                    const localY = Math.round(y - primary.y);
                                    const bgW = Math.round(w);
                                    const bgH = Math.round(h);

                                    switcherGlass.opacity = this.opacity;
                                    if (!switcherGlass.visible) {
                                        switcherGlass.show();
                                    }

                                    const box = new Clutter.ActorBox();
                                    box.x1 = primary.x;
                                    box.y1 = primary.y;
                                    box.x2 = primary.x + primary.width;
                                    box.y2 = primary.y + primary.height;
                                    switcherGlass.allocate(box);

                                    switcherGlass.set_position(primary.x, primary.y);
                                    switcherGlass.set_size(primary.width, primary.height);
                                    switcherGlass.setResolution(primary.width, primary.height);
                                    switcherGlass.setCornerRadius(24.0);
                                    switcherGlass.setGlassGeometry(localX, localY, bgW, bgH);

                                    const CLIP_PAD = 10;
                                    switcherGlass.set_clip(localX - CLIP_PAD, localY - CLIP_PAD, bgW + CLIP_PAD * 2, bgH + CLIP_PAD * 2);
                                    switcherGlass.syncSources();
                                };

                                if (this._stageSignalId) {
                                    global.stage.disconnect(this._stageSignalId);
                                }
                                this._stageSignalId = global.stage.connect('before-update', syncGlass);

                                this.connect('destroy', () => {
                                    if (this._stageSignalId) {
                                        global.stage.disconnect(this._stageSignalId);
                                        this._stageSignalId = 0;
                                    }
                                    switcherGlass.hide();
                                });
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

        // Ensure Notification Center and Notification Banners use LQ-Visual glass
        const patchNotificationLQVisual = async () => {
            try {
                const notifMod = await import('file:///home/vitaliy/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/notifications_v3.js');
                const menubarMod = await import('file:///home/vitaliy/.local/share/gnome-shell/extensions/blur-my-shell@aunetx/components/menubar_v27.js');

                // 1. Update global card builder and group class
                globalThis._macBuildNotificationCard = notifMod.buildNotificationCard;
                globalThis._MacNotificationGroup = notifMod.MacNotificationGroup;

                // 2. Patch active MenuBarController prototype and instance if needed
                const mbProto = menubarMod.MenuBarController.prototype;
                const nc = globalThis._macNotificationCenter;
                if (nc) {
                    nc._initNotifGlass = mbProto._initNotifGlass.bind(nc);
                    nc._syncNotifGlassRegions = mbProto._syncNotifGlassRegions.bind(nc);
                    nc._updateNotifRealtime = mbProto._updateNotifRealtime.bind(nc);
                    nc._setupCardGeometryTracking = mbProto._setupCardGeometryTracking.bind(nc);
                    nc._openNotificationCenter = mbProto._openNotificationCenter.bind(nc);
                    nc._closeNotificationCenter = mbProto._closeNotificationCenter.bind(nc);

                    if (nc._notifCenterActor && !nc._notifCenterActor._glassListenersConnected) {
                        nc._notifCenterActor._glassListenersConnected = true;
                        nc._notifCenterActor.connect('notify::translation-x', () => {
                            if (nc._notifCenterOpen) nc._syncNotifGlassRegions();
                        });
                        nc._notifCenterActor.connect('notify::opacity', () => {
                            if (nc._notifGlass && !nc._notifGlass.is_finalized?.()) {
                                nc._notifGlass.opacity = nc._notifCenterActor.opacity;
                            }
                        });
                        if (nc._notifScrollView?.vadjustment) {
                            nc._notifScrollView.vadjustment.connect('notify::value', () => {
                                if (nc._notifCenterOpen) nc._syncNotifGlassRegions();
                            });
                        }
                    }

                    if (nc._notifCenterOpen) {
                        nc._populateNotificationCards();
                        await nc._initNotifGlass();
                        nc._syncNotifGlassRegions();
                    }
                }

                // 3. Hot-swap NotificationsController for floating banners ONLY if missing
                const extBms = Main.extensionManager.lookup('blur-my-shell@aunetx');
                if (extBms?.stateObj && !extBms.stateObj._notifications_controller) {
                    const newNotifCtrl = new notifMod.NotificationsController(
                        extBms.stateObj._connections?.[0] || extBms.stateObj._connection,
                        extBms.stateObj._settings,
                        extBms.stateObj._effects_manager
                    );
                    extBms.stateObj._notifications_controller = newNotifCtrl;
                    newNotifCtrl.enable();
                    globalThis._macNotificationsController = newNotifCtrl;
                }
            } catch (e) {
                console.error('[EvalHelper] patchNotificationLQVisual error: ' + e);
            }
        };
        patchNotificationLQVisual();

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
                            // Perfectly symmetric vertical framing (96px top buffer for Spaces Bar, 96px bottom buffer for Dock on 1080p)
                            // Workspaces are centered, enlarged to ~900px height, and never jump when menubar expands/collapses!
                            const vBuffer = Math.max(88, Math.round(h * 0.0888));
                            const res = baseBox.copy();
                            res.x1 = baseBox.x1 || 0;
                            res.y1 = (baseBox.y1 || 0) + vBuffer;
                            res.x2 = res.x1 + w;
                            res.y2 = Math.max(res.y1 + 100, (baseBox.y1 || 0) + h - vBuffer);
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
                    duration: 700,
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
                                    duration: 700,
                                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                });
                            }
                        }
                    }

                    await global.window_group.easeAsync({
                        opacity: 255,
                        duration: 700,
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
                                // Immediately close the active menu and open the clicked menu in one click.
                                menu.close(PopupAnimation.FADE);
                                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                                    if (clickedMenu.isOpen) {
                                        clickedMenu.close(PopupAnimation.FADE);
                                    } else {
                                        clickedMenu.open(PopupAnimation.FADE);
                                    }
                                    return GLib.SOURCE_REMOVE;
                                });
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
            if (favs && !this._origRemoveFavorite) {
                this._origRemoveFavorite = favs.removeFavorite;
                favs.removeFavorite = function(appId) {
                    if (appId === 'launchpad.desktop') {
                        return; // Disallow unpinning Launchpad
                    }
                    return this._origRemoveFavorite.call(this, appId);
                };

                this._origMoveFavoriteToPos = favs.moveFavoriteToPos;
                favs.moveFavoriteToPos = function(appId, pos) {
                    globalThis._isMovingFavorite = true;
                    try {
                        return this._origMoveFavoriteToPos.call(this, appId, pos);
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

            import('file:///home/vitaliy/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu.js')
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
                    import('file:///home/vitaliy/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu.js')
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
                    this.remove_all_transitions();
                    this._muteKeys = false;
                    this.show();

                    this.set_pivot_point(0.5, 0);
                    this.translation_x = 0;
                    this.translation_y = 0;

                    if (animate === 0 || animate === false) {
                        this.opacity = 255;
                        this.scale_x = 1.0;
                        this.scale_y = 1.0;
                        this._muteInput = false;
                        if (onComplete) onComplete();
                        return;
                    }

                    this.scale_x = 0.95;
                    this.scale_y = 0.95;
                    this.opacity = 0;

                    this.ease({
                        opacity: 255,
                        scale_x: 1.0,
                        scale_y: 1.0,
                        translation_x: 0,
                        translation_y: 0,
                        duration: 300, // exactly 0.3s
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            this._muteInput = false;
                            if (onComplete) onComplete();
                        }
                    });
                };

                BoxPointer.BoxPointer.prototype.close = function(animate, onComplete) {
                    if (!this.visible) return;
                    this.remove_all_transitions();

                    if (animate === 0 || animate === false) {
                        this.hide();
                        this.scale_x = 1.0;
                        this.scale_y = 1.0;
                        if (onComplete) onComplete();
                        return;
                    }

                    this.ease({
                        opacity: 0,
                        scale_x: 0.96,
                        scale_y: 0.96,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: () => {
                            this.hide();
                            this.scale_x = 1.0;
                            this.scale_y = 1.0;
                            if (onComplete) onComplete();
                        }
                    });
                };
            }).catch(e => console.error(`[EvalHelper] BoxPointer patch error: ${e}`));
        } catch (e) {
            console.error(`[EvalHelper] BoxPointer setup error: ${e}`);
        }
    }

    disable() {
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
    }
}
