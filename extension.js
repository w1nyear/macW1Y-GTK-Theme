import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';

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
                            if (typeof globalThis.toggleMacSpotlight === 'function') {
                                globalThis.toggleMacSpotlight();
                                return;
                            }
                            const mod = await import(`file://${ext.path}/searchDialog_v4.js`);
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
                        glass.setIsDock(true);
                        glass.setCornerSmoothingEnabled(0.0);
                        glass.setCornerRadius(24.0);
                        glass.setTintColor(0.0, 0.0, 0.0);
                        glass.setTintStrength(0.05); // LQ-Visual: 5% tint
                        glass.setBlurRadius(3.0); // LQ-Visual: 3px blur
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

        // Ensure GNOME Overview is strictly Mission Control (Window/Workspace picker only)
        // Completely remove GNOME app grid and top "Введіть текст для пошуку" search bar
        const patchMissionControlOverview = () => {
            try {
                const controls = Main.overview?._overview?.controls;
                if (!controls) return;

                // 1. Permanently limit overview state adjustment to WINDOW_PICKER (state 1)
                if (controls._stateAdjustment) {
                    controls._stateAdjustment.upper = 1;
                }

                // 2. Hide and keep AppDisplay hidden
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

                // 3. Override _shiftState so upward gestures/keys stop at WINDOW_PICKER
                controls._shiftState = function(direction) {
                    let {currentState, finalState} = this._stateAdjustment.getStateTransitionParams();
                    if (direction === Meta.MotionDirection.DOWN)
                        finalState = Math.max(finalState - 1, 0 /* HIDDEN */);
                    else if (direction === Meta.MotionDirection.UP)
                        finalState = Math.min(finalState + 1, 1 /* WINDOW_PICKER */);

                    if (finalState === currentState)
                        return;

                    if (currentState === 0 && finalState === 1) {
                        Main.overview.show();
                    } else if (finalState === 0) {
                        Main.overview.hide();
                    } else {
                        this._stateAdjustment.ease(finalState, {
                            duration: 250,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    }
                };

                // 4. Override showApps and _toggleAppsPage to toggle our Mac Applications Menu
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

                // 5. Hide search entry and searchEntryBin completely (no "Введіть текст для пошуку")
                if (controls._searchEntryBin) {
                    controls._searchEntryBin.visible = false;
                    controls._searchEntryBin.opacity = 0;
                    controls._searchEntryBin.height = 0;
                    controls._searchEntryBin.get_preferred_height = () => [0, 0];
                }
                if (controls._searchEntry) {
                    controls._searchEntry.visible = false;
                    controls._searchEntry.opacity = 0;
                    controls._searchEntry.height = 0;
                }

                // 6. Disable search controller triggering in overview
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
        Main.overview.connectObject('showing', patchMissionControlOverview, this);

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
                    const overviewBrightness = (this.settings.overview?.BRIGHTNESS ?? 0.60);
                    const folderSigma = (this.settings.appfolder?.SIGMA ?? 30.0);
                    const targetRadius = isOpen
                        ? Math.round(overviewRadius + folderSigma * 1.5)
                        : overviewRadius;
                    const targetBrightness = isOpen ? 0.48 : overviewBrightness;

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
                            `background-gradient-direction: vertical !important; ` +
                            `background-gradient-start: rgba(0, 0, 0, 0.12) !important; ` +
                            `background-gradient-end: transparent !important; ` +
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
                        // User explicitly requested: "меню не при огляді на робочому столі має якийсь блюр на ввесь елемент. видалити."
                        this.actors_list?.forEach(actors => {
                            const bg = actors.widgets?.background;
                            if (!bg) return;
                            bg.remove_all_transitions();
                            bg.opacity = 0;
                            if (bg.visible) bg.hide();
                        });

                        // 2. Main.panel gradient:
                        // In overview: NOT dark, seamlessly blends with blurred wallpaper, no box-shadow
                        // On desktop: clean gradient tint, no blur
                        if (Main.panel) {
                            Main.panel.opacity = 255;
                            if (isOverview) {
                                Main.panel.set_style(
                                    `background-color: transparent !important; ` +
                                    `background-gradient-direction: vertical !important; ` +
                                    `background-gradient-start: rgba(0, 0, 0, 0.12) !important; ` +
                                    `background-gradient-end: transparent !important; ` +
                                    `box-shadow: none !important; ` +
                                    `border-bottom: none !important; ` +
                                    `transition-duration: ${duration}ms !important;`
                                );
                            } else {
                                let baseDesktopTint = 0.35;
                                if (this._baseDesktopTint !== undefined) {
                                    baseDesktopTint = this._baseDesktopTint;
                                } else {
                                    try {
                                        const configPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'mac-styling', 'styling.json']);
                                        if (GLib.file_test(configPath, GLib.FileTest.EXISTS)) {
                                            const [ok, content] = GLib.file_get_contents(configPath);
                                            if (ok) {
                                                const data = JSON.parse(new TextDecoder().decode(content));
                                                if (typeof data.panel_tint === 'number') {
                                                    baseDesktopTint = Math.min(Math.max(data.panel_tint * 0.6, 0.25), 0.50);
                                                }
                                            }
                                        }
                                    } catch (_) {}
                                    this._baseDesktopTint = baseDesktopTint;
                                }

                                Main.panel.set_style(
                                    `background-color: transparent !important; ` +
                                    `background-gradient-direction: vertical !important; ` +
                                    `background-gradient-start: rgba(0, 0, 0, ${baseDesktopTint.toFixed(3)}) !important; ` +
                                    `background-gradient-end: rgba(0, 0, 0, 0.0) !important; ` +
                                    `box-shadow: none !important; ` +
                                    `border-bottom: none !important; ` +
                                    `transition-duration: ${duration}ms !important;`
                                );
                            }
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
                    Main.overview.connect('hidden', () => {
                        pb.animate_overview_transition(false, 0);
                    });
                }
            } catch (_) {}
        };
        patchPanelOverviewAndFolders();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            patchPanelOverviewAndFolders();
            return GLib.SOURCE_REMOVE;
        });

        // Ensure overview search entry bin height is strictly locked at 60px to prevent any workspace shudder on hover/focus
        const lockSearchEntryHeight = () => {
            try {
                const controls = Main.overview?._overview?.controls;
                const bin = controls?._searchEntryBin;
                const entry = controls?._searchEntry;
                if (bin && !bin._macHeightLocked) {
                    bin._macHeightLocked = true;
                    bin.set_height(60);
                }
                if (entry && !entry._macBorderLocked) {
                    entry._macBorderLocked = true;
                    entry.connect('notify::hover', () => {
                        if (bin && bin.height !== 60) bin.set_height(60);
                    });
                }
            } catch (_) {}
        };
        lockSearchEntryHeight();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            lockSearchEntryHeight();
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
        if (Main.layoutManager) {
            this._origStartupAnimationSession = Main.layoutManager._startupAnimationSession;
            Main.layoutManager._startupAnimationSession = async function() {
                if (this._startInOverview) {
                    await Main.overview.runStartupAnimation();
                } else {
                    this.panelBox.ease({
                        opacity: 255,
                        duration: 700,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });

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
    }

    disable() {
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

        if (this._origUpdateFavoriteItem) {
            try {
                import('resource:///org/gnome/shell/ui/appMenu.js').then(({ AppMenu }) => {
                    if (AppMenu) AppMenu.prototype._updateFavoriteItem = this._origUpdateFavoriteItem;
                });
            } catch (_) {}
            this._origUpdateFavoriteItem = null;
        }
    }
}
