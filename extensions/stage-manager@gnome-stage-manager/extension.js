



import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension, gettext as _, ngettext } from 'resource:///org/gnome/shell/extensions/extension.js';




const THUMB_W = 170;
const THUMB_H = 110;
const ICON_SIZE = 22;
const MAX_GROUPS = 8;
const BELL_SIGMA = 0.9;
const MAX_STACK = 3;
const STACK_H = 14;
const STACK_V = 4;


const MIN_THUMB_W = 48;

const CARD_PAD_X = 14;
const CARD_PAD_Y = 8;
const CARD_MARGIN = 8;
const SCROLL_STEP = 55;
const PERSP_HEADROOM = 0.18;

const THUMB_ASPECT_MIN = 0.7;
const THUMB_ASPECT_MAX = 2.4;
const CARD_REST_OPACITY = 190;
const CARD_HOVER_OPACITY = 255;

const MAX_SNAPSHOTS = 8;
const KEYBIND_NAME = 'toggle-sidebar';
const APP_DRAG_THRESHOLD = 18;

const MON_FALLBACK = { x: 0, y: 0, width: 1920, height: 1080, index: 0 };







function _getMon() {
    const display = global.display;
    const primary = display.get_primary_monitor();
    const index = primary >= 0 ? primary : 0;

    if (display.get_n_monitors() > index) {
        const rect = display.get_monitor_geometry(index);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, index };
    }
    return Main.layoutManager.primaryMonitor ?? MON_FALLBACK;
}


function _isNormal(win) {
    if (!win) return false;
    if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
    if (win.skip_taskbar || win.is_attached_dialog()) return false;
    if (win.is_always_on_all_workspaces()) return false;
    return true;
}

function _nullCloneSources(actor) {
    if (!actor) return;
    if (actor instanceof Clutter.Clone)
        actor.set_source(null);
    for (const child of actor.get_children?.() ?? [])
        _nullCloneSources(child);
}

function _bellCurve(dist, sigma) {
    return Math.exp(-(dist * dist) / (2 * sigma * sigma));
}



function _groupByApp(workspace, focusedWindow, mergeMap = new Map()) {
    const tracker = Shell.WindowTracker.get_default();
    const appMap = new Map();

    const allWins = workspace.list_windows().filter(w => _isNormal(w));
    const sorted = allWins.sort((a, b) =>
        (b.get_user_time() || 0) - (a.get_user_time() || 0)
    );

    const openWins = allWins.filter(w => !w.minimized);
    const openAppIds = new Set(openWins.map(w => tracker.get_window_app(w)?.get_id()).filter(Boolean));

    for (const win of sorted) {
        if (!win.minimized) continue;
        const app = tracker.get_window_app(win);
        if (!app) continue;
        const id = app.get_id();
        if (openAppIds.has(id)) continue;

        if (!appMap.has(id))
            appMap.set(id, { app, windows: [] });
        appMap.get(id).windows.push(win);
    }

    const byGroup = new Map();
    for (const [appId, entry] of appMap) {
        const key = mergeMap.get(appId) ?? appId;
        if (!byGroup.has(key)) byGroup.set(key, { apps: [], windows: [] });
        const bucket = byGroup.get(key);
        bucket.apps.push(entry.app);
        bucket.windows.push(...entry.windows);
    }

    return [...byGroup.entries()].map(([key, g]) =>
        ({ key, app: g.apps[0], apps: g.apps, windows: g.windows }));
}




class MaximizeToWorkspace {
    constructor(settings) {
        this._settings = settings;
        this._sigSources = new Set();
        this._timers = [];
        this._moved = new Set();


        this._origin = new Map();
    }

    enable() {
        this._sig(global.window_manager, 'size-change', this._onSize.bind(this));
        this._sig(global.window_manager, 'destroy', (_wm, actor) => {
            const w = actor?.meta_window;
            if (w) {
                this._moved.delete(w);
                this._origin.delete(w);
            }
        });
    }

    disable() {
        this._sigSources.forEach(o => o.disconnectObject(this));
        this._sigSources.clear();
        this._timers.splice(0).forEach(id => GLib.source_remove(id));
        this._moved.clear();
        this._origin.clear();
    }

    _sig(o, s, cb) {
        o.connectObject(s, cb, this);
        this._sigSources.add(o);
    }



    _untrackTimer(id) {
        const i = this._timers.indexOf(id);
        if (i >= 0) this._timers.splice(i, 1);
    }


    _workspaceAlive(ws) {
        if (!ws) return false;
        const wsm = global.workspace_manager;
        for (let i = 0; i < wsm.get_n_workspaces(); i++) {
            if (wsm.get_workspace_by_index(i) === ws) return true;
        }
        return false;
    }

    _onSize(_wm, actor, change) {
        const win = actor.meta_window;
        if (!win || !_isNormal(win)) return;

        if (change === Meta.SizeChange.MAXIMIZE) {


            if (this._settings.get_string('maximize-behavior') !== 'workspace') return;
            this._handleMaximize(win);
        } else if (change === Meta.SizeChange.UNMAXIMIZE) {
            this._handleUnmaximize(win);
        }
    }

    _handleMaximize(win) {
        if (this._moved.has(win)) return;

        const wsm = global.workspace_manager;
        const ci = wsm.get_active_workspace_index();
        const cws = wsm.get_workspace_by_index(ci);
        const siblings = cws.list_windows().filter(w => w !== win && _isNormal(w) && !w.minimized);
        if (siblings.length === 0) return;

        let ti = -1;
        for (let i = 0; i < wsm.get_n_workspaces(); i++) {
            if (i === ci) continue;
            if (wsm.get_workspace_by_index(i).list_windows().filter(w => w !== win && _isNormal(w)).length === 0) {
                ti = i; break;
            }
        }
        if (ti === -1) {
            wsm.append_new_workspace(false, global.get_current_time());
            ti = wsm.get_n_workspaces() - 1;
        }
        if (ti === ci) return;

        this._moved.add(win);
        this._origin.set(win, cws);
        win.change_workspace_by_index(ti, false);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._untrackTimer(id);
            const ws = wsm.get_workspace_by_index(ti);
            if (ws) { ws.activate(global.get_current_time()); win.activate(global.get_current_time()); }
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(id);
    }

    _handleUnmaximize(win) {
        const originWs = this._origin.get(win);
        if (!originWs) return;

        this._origin.delete(win);
        this._moved.delete(win);



        if (!this._workspaceAlive(originWs)) return;
        if (win.get_workspace() === originWs) return;

        win.change_workspace(originWs);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._untrackTimer(id);
            if (this._workspaceAlive(originWs)) {
                originWs.activate(global.get_current_time());
                win.activate(global.get_current_time());
            }
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(id);
    }
}




class StageSidebar {
    constructor(settings) {
        this._settings = settings;
        this._sigSources = new Set();
        this._cardSigSources = new Set();
        this._cards = [];
        this._panel = null;
        this._edge = null;
        this._box = null;
        this._scroll = null;
        this._preview = null;
        this._timers = [];
        this._hoverTimer = null;
        this._refreshTimer = null;
        this._hideTimer = null;
        this._swapTimer = null;
        this._edgeTimer = null;
        this._visible = false;
        this._flyoutMode = false;
        this._overlapTimer = null;
        this._hovered = false;
        this._hoveredIdx = -1;
        this._keybindingAdded = false;
        this._isSwitching = false;
        this._activeClones = new Set();


        this._scaleFactor = 1;
        this._themeClass = '';



        this._groups = [];
        this._activeIds = new Map();
        this._nextGid = 0;



        this._expectMinimize = new Set();
        this._expectUnminimize = new Set();

        this._signature = null;



        this._chromeAdded = false;
        this._chromeStruts = false;



        this._snapshots = new Map();

        this._appMergeMap = new Map();
        this._appDrag = null;



        this._maxOrigin = new Map();
        this._savedLayouts = new Map();
    }





    _sig(obj, signal, cb) {
        obj.connectObject(signal, cb, this);
        this._sigSources.add(obj);
    }

    _cardSig(obj, signal, cb) {
        obj.connectObject(signal, cb, this);
        this._cardSigSources.add(obj);
    }

    _disconnectCardSigs() {
        this._cardSigSources.forEach(o => o.disconnectObject(this));
        this._cardSigSources.clear();
    }




    get _PANEL_W() { return this._settings.get_int('sidebar-width') * this._scaleFactor; }
    get _SLIDE_MS() { return this._settings.get_int('animation-duration'); }
    get _HIDE_DELAY_MS() { return this._settings.get_int('auto-hide-delay'); }
    get _EDGE_W() { return this._settings.get_int('edge-trigger-width') * this._scaleFactor; }

    get _EDGE_DELAY_MS() { return this._settings.get_int('edge-trigger-delay'); }
    get _BASE_SCALE() { return this._settings.get_int('card-base-scale') / 100.0; }
    get _PERSP_ANGLE() { return this._settings.get_int('perspective-angle'); }
    get _POS() { return this._settings.get_string('stack-panel-position'); }


    get _VERTICAL() { return this._POS !== 'bottom'; }


    get _ROT_SIGN() { return this._POS === 'right' ? -1 : 1; }

    get _isFlatMode() {
        return this._flyoutMode || !this._isAreaClear();
    }

    _isAreaClear() {
        try {
            const ws = global.workspace_manager.get_active_workspace();
            if (!ws) return true;
            const mon = _getMon();
            if (!mon) return true;
            const topH = Main.panel ? Main.panel.height : 0;
            const [panelW, panelH] = this._panelSize(mon, topH);
            const [vx, vy] = this._panelVisiblePos(mon, topH);

            const sf = this._scaleFactor || 1;
            let px1 = vx;
            let py1 = vy;
            let px2 = vx + (this._VERTICAL ? Math.min(panelW, 110 * sf) : panelW);
            let py2 = vy + (this._VERTICAL ? panelH : Math.min(panelH, 110 * sf));

            if (this._box && this._cards && this._cards.length > 0) {
                try {
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    for (const c of this._cards) {
                        if (!c || !c.get_stage?.()) continue;
                        const cpos = c.get_transformed_position?.();
                        const csize = c.get_transformed_size?.();
                        if (cpos && csize && cpos[0] !== null && cpos[1] !== null) {
                            minX = Math.min(minX, cpos[0]);
                            maxX = Math.max(maxX, cpos[0] + csize[0]);
                            minY = Math.min(minY, cpos[1]);
                            maxY = Math.max(maxY, cpos[1] + csize[1]);
                        }
                    }
                    if (maxX > minX && maxY > minY) {
                        if (this._POS === 'right') {
                            px1 = Math.max(vx, minX - 8 * sf);
                            px2 = vx + panelW;
                        } else {
                            px1 = vx;
                            px2 = Math.min(vx + panelW, maxX + 8 * sf);
                        }
                        py1 = Math.max(vy, minY);
                        py2 = Math.min(vy + panelH, maxY);
                    }
                } catch (_) {}
            }

            const windows = ws.list_windows().filter(w => {
                if (!w || w.is_override_redirect()) return false;
                if (w.minimized || w._stageSwitching) return false;
                const t = w.get_window_type();
                if (t === Meta.WindowType.DESKTOP || t === Meta.WindowType.DOCK) return false;
                return true;
            });

            for (const win of windows) {
                const r = win.get_frame_rect();
                if (r && r.x < px2 && r.x + r.width > px1 && r.y < py2 && r.y + r.height > py1) {
                    return false;
                }
            }
            return true;
        } catch (_) {
            return true;
        }
    }

    _checkOverlap() {
        if (!this._panel) return;
        if (this._isSwitching) return;
        if (Main.overview.visible || Main.overview.visibleTarget) {
            if (this._panel.visible) this._panel.hide();
            return;
        }
        const clear = this._isAreaClear();
        if (clear) {
            if (this._flyoutMode) {
                this._flyoutMode = false;
                this._resetAllCardScales();
            }
            if (!this._visible && !this._settings.get_boolean('sidebar-auto-hide')) {
                this._show();
            }
        } else {
            if (!this._flyoutMode) {
                if (this._visible) {
                    this._hide();
                }
            }
        }
    }

    _armOverlapTimer() {
        this._killOverlapTimer();
        this._overlapTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this._flyoutMode) {
                this._checkOverlap();
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._timers.push(this._overlapTimer);
    }

    _killOverlapTimer() {
        if (this._overlapTimer) {
            GLib.source_remove(this._overlapTimer);
            this._untrackTimer(this._overlapTimer);
            this._overlapTimer = null;
        }
    }



    _panelSize(mon, topH) {
        return this._VERTICAL
            ? [this._PANEL_W, mon.height - topH]
            : [mon.width, this._PANEL_W];
    }
    _panelVisiblePos(mon, topH) {
        if (!this._VERTICAL) return [mon.x, mon.y + mon.height - this._PANEL_W];
        return [this._POS === 'right' ? mon.x + mon.width - this._PANEL_W : mon.x, mon.y + topH];
    }
    _panelHiddenPos(mon, topH) {
        if (!this._VERTICAL) return [mon.x, mon.y + mon.height];
        return [this._POS === 'right' ? mon.x + mon.width : mon.x - this._PANEL_W, mon.y + topH];
    }

    _edgeGeom(mon, topH) {
        const t = this._EDGE_W;
        return this._VERTICAL
            ? [this._POS === 'right' ? mon.x + mon.width - t : mon.x, mon.y + topH, t, mon.height - topH]
            : [mon.x, mon.y + mon.height - t, mon.width, t];
    }

    _previewPos(mon, topH, previewW, previewH, gap, cardX, cardY) {
        if (!this._VERTICAL) {
            const x = Math.max(mon.x + gap,
                Math.min(cardX, mon.x + mon.width - previewW - gap));
            return [x, mon.y + mon.height - this._PANEL_W - previewH - gap];
        }
        const x = this._POS === 'right'
            ? mon.x + mon.width - this._PANEL_W - previewW - gap
            : mon.x + this._PANEL_W + gap;
        return [x, Math.max(mon.y + topH + gap,
            Math.min(cardY, mon.y + mon.height - previewH - 20 * this._scaleFactor))];
    }

    enable() {
        globalThis._stageManager = this;
        globalThis._stageManagerEnabled = true;
        this._recomputeScale();
        this._recomputeThemeClass();
        this._loadAppMergeMap();
        this._build();
        this._wire();
        this._initGroups();
        this._addKeybinding();
        this._armOverlapTimer();

        if (this._isAreaClear() && !this._settings.get_boolean('sidebar-auto-hide'))
            this._show();
        else if (this._shouldForceShow())
            this._show();
        this._syncEdge();
    }

    disable() {
        globalThis._stageManager = null;
        globalThis._stageManagerEnabled = false;

        this._killRefreshTimer();
        this._killHideTimer();
        this._killHoverTimer();
        this._killSwapTimer();
        this._killEdgeTimer();
        this._killOverlapTimer();

        this._timers.splice(0).forEach(id => GLib.source_remove(id));

        this._removeKeybinding();

        this._sigSources.forEach(o => o.disconnectObject(this));
        this._sigSources.clear();
        this._disconnectCardSigs();
        this._cancelAppDrag();

        this._destroyPreview();
        this._safeDestroyContent();
        this._isSwitching = false;
        if (this._activeClones) {
            for (const c of this._activeClones) {
                try { c.destroy(); } catch (_) {}
            }
            this._activeClones.clear();
        }
        this._cards = [];
        this._groups = [];
        this._activeIds.clear();
        this._expectMinimize.clear();
        this._expectUnminimize.clear();
        this._snapshots.clear();
        this._savedLayouts.clear();
        this._appMergeMap.clear();
        this._maxOrigin.clear();
        this._signature = null;


        if (this._box) {
            this._box.destroy();
            this._box = null;
        }
        if (this._scroll) {
            this._scroll.destroy();
            this._scroll = null;
        }
        if (this._panel) {
            Main.layoutManager.removeChrome(this._panel);
            this._panel.destroy();
            this._panel = null;
        }
        if (this._edge) {
            Main.layoutManager.removeChrome(this._edge);
            this._edge.destroy();
            this._edge = null;
        }
    }

    _onEdgeTriggered() {
        if (this._fullscreen() || Main.overview.visible || Main.overview.visibleTarget) return;
        if (!this._isAreaClear()) {
            this._flyoutMode = true;
        }
        this._show();
    }

    _build() {
        const mon = _getMon();
        const topH = Main.panel ? Main.panel.height : 0;
        const vertical = this._VERTICAL;
        const [panelW, panelH] = this._panelSize(mon, topH);
        const [edgeX, edgeY, edgeW, edgeH] = this._edgeGeom(mon, topH);



        this._edge = new St.Widget({
            reactive: true,
            style: 'background-color: transparent;',
        });
        this._edge.set_size(edgeW, edgeH);
        this._edge.set_position(edgeX, edgeY);
        Main.layoutManager.addChrome(this._edge, { trackFullscreen: false });
        this._sig(this._edge, 'enter-event', () => {
            if (this._fullscreen() || Main.overview.visible || Main.overview.visibleTarget) return;
            const delay = this._EDGE_DELAY_MS;
            if (delay <= 0) {
                this._onEdgeTriggered();
                return;
            }
            this._killEdgeTimer();
            this._edgeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._untrackTimer(this._edgeTimer); this._edgeTimer = null;


                if (!this._fullscreen() && !Main.overview.visible && !Main.overview.visibleTarget)
                    this._onEdgeTriggered();
                return GLib.SOURCE_REMOVE;
            });
            this._timers.push(this._edgeTimer);
        });


        this._sig(this._edge, 'leave-event', () => this._killEdgeTimer());



        this._panel = new St.Widget({
            reactive: false,
            opacity: 0,
            clip_to_allocation: false,
            style: 'background-color: transparent;',
        });
        this._panel.set_size(panelW, panelH);
        this._panel.set_position(...this._panelHiddenPos(mon, topH));
        this._visible = false;
        this._applyChrome();





        this._scroll = new St.ScrollView({
            reactive: false,
            overlay_scrollbars: true,
            hscrollbar_policy: vertical ? St.PolicyType.NEVER : St.PolicyType.EXTERNAL,
            vscrollbar_policy: vertical ? St.PolicyType.EXTERNAL : St.PolicyType.NEVER,
            clip_to_allocation: false,
        });
        this._scroll.set_size(panelW, panelH);
        this._panel.add_child(this._scroll);

        const sf = this._scaleFactor;


        this._box = new St.BoxLayout({
            reactive: true,
            clip_to_allocation: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: vertical
                ? `padding: ${Math.round(24 * sf)}px 0px; spacing: ${Math.round(10 * sf)}px;`
                : `padding: 0px ${Math.round(24 * sf)}px; spacing: ${Math.round(10 * sf)}px;`,
        });
        this._setOrientation(this._box, vertical);
        this._scroll.set_child(this._box);



        this._sig(this._box, 'scroll-event', (_actor, event) => this._onScrollEvent(event));
        this._sig(this._scroll, 'scroll-event', (_actor, event) => this._onScrollEvent(event));
        this._sig(this._box, 'button-release-event', () => { this._endAppDragCandidate(); return Clutter.EVENT_PROPAGATE; });


        this._sig(this._panel, 'enter-event', () => {
            this._hovered = true;
            this._killHideTimer();
            return Clutter.EVENT_PROPAGATE;
        });
        this._sig(this._panel, 'leave-event', (_actor, event) => {


            if (this._insidePanel(this._crossingRelated(event)))
                return Clutter.EVENT_PROPAGATE;

            this._hovered = false;
            this._hoveredIdx = -1;
            this._killHoverTimer();
            this._resetAllCardScales();
            this._destroyPreview();
            if (this._flyoutMode || !this._isAreaClear() || (this._settings.get_boolean('sidebar-auto-hide') && !this._shouldForceShow()))
                this._scheduleHide();
            return Clutter.EVENT_PROPAGATE;
        });
    }



    _wantStruts() {
        return this._settings.get_boolean('sidebar-reserve-space') &&
               !this._settings.get_boolean('sidebar-auto-hide') &&
               this._visible && !this._fullscreen() &&
               !Main.overview.visible && !Main.overview.visibleTarget;
    }



    _applyChrome() {
        if (!this._panel) return;
        const wanted = this._wantStruts();
        if (this._chromeAdded && this._chromeStruts === wanted) return;

        if (this._chromeAdded)
            Main.layoutManager.removeChrome(this._panel);
        Main.layoutManager.addChrome(this._panel, {
            trackFullscreen: false,
            affectsStruts: wanted,
        });
        this._chromeAdded = true;
        this._chromeStruts = wanted;
    }



    _onScrollEvent(event) {


        const adj = this._VERTICAL ? this._scroll?.vadjustment : this._scroll?.hadjustment;
        if (!adj) return Clutter.EVENT_PROPAGATE;



        let delta = 0;
        const vertical = this._VERTICAL;
        const dir = event.get_scroll_direction();
        if (dir === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();

            delta = vertical ? dy : (dx || dy);
        } else if (dir === Clutter.ScrollDirection.UP) {
            delta = -1;
        } else if (dir === Clutter.ScrollDirection.DOWN) {
            delta = 1;
        } else if (!vertical && dir === Clutter.ScrollDirection.LEFT) {
            delta = -1;
        } else if (!vertical && dir === Clutter.ScrollDirection.RIGHT) {
            delta = 1;
        }


        if (delta === 0) return Clutter.EVENT_PROPAGATE;

        const step = SCROLL_STEP * this._scaleFactor;
        const max = Math.max(0, adj.upper - adj.page_size);
        adj.value = Math.max(0, Math.min(max, adj.value + delta * step));
        return Clutter.EVENT_STOP;
    }



    _startAppDragCandidate(group, card) {
        this._cancelAppDrag();
        const [px, py] = global.get_pointer();
        this._appDrag = { group, card, startX: px, startY: py, moved: false };
        this._sig(global.stage, 'motion-event', (_a, event) => this._onAppDragMotion(event));
    }

    _onAppDragMotion(event) {
        if (!this._appDrag) return Clutter.EVENT_PROPAGATE;
        const [px, py] = event.get_coords();
        const dx = px - this._appDrag.startX;
        const dy = py - this._appDrag.startY;
        if (Math.hypot(dx, dy) > APP_DRAG_THRESHOLD * this._scaleFactor)
            this._appDrag.moved = true;
        return Clutter.EVENT_PROPAGATE;
    }



    _endAppDragCandidate() {
        const drag = this._appDrag;
        if (!drag) return false;
        this._cancelAppDrag();
        if (!drag.moved) return false;
        const releaseGroup = this._appCardGroupAtPointer();
        if (releaseGroup && releaseGroup !== drag.group) this._onDragCommit(drag.group, releaseGroup);
        return true;
    }



    _appCardGroupAtPointer() {
        const [px, py] = global.get_pointer();
        let actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, px, py);
        while (actor) {
            if (actor._group) return actor._group;
            actor = actor.get_parent();
        }
        return null;
    }

    _cancelAppDrag() {
        this._appDrag = null;
        global.stage.disconnectObject(this);
    }

    _onDragCommit(sourceGroup, targetGroup) {
        for (const app of sourceGroup.apps) this._applyMerge(app.get_id(), targetGroup.key);
        this._saveAppMergeMap();
        this._scheduleRefresh();
    }


    _crossingRelated(event) {
        return event?.get_related() ?? null;
    }

    _insidePanel(actor) {
        if (!actor || !this._panel) return false;
        return actor === this._panel || this._panel.contains(actor);
    }



    _rotProp(angle) {
        return this._VERTICAL ? { rotation_angle_y: angle } : { rotation_angle_x: angle };
    }

    _applyPerspective(card, factor = 1.0) {
        if (!card || !card._thumb || !card._thumb._previewBox) return;
        const box = card._thumb._previewBox;
        box.set_transform(null);
        if (!this._VERTICAL || this._isFlatMode || factor <= 0) {
            box.rotation_angle_y = 0;
            return;
        }
        const pivotX = (this._POS === 'right') ? 1.0 : 0.0;
        box.set_pivot_point(pivotX, 0.5);
        box.rotation_angle_y = this._ROT_SIGN * 10 * factor;
    }



    _setOrientation(box, vertical) {
        if ('orientation' in St.BoxLayout.prototype)
            box.orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        else
            box.vertical = vertical;
    }



    _syncEdge() {
        if (!this._edge) return;
        const wanted = !this._visible && !this._fullscreen() &&
                       !Main.overview.visible && !Main.overview.visibleTarget;
        if (wanted) this._edge.show();
        else this._edge.hide();
    }



    _rebuildLayout() {
        if (!this._panel || !this._edge || !this._scroll) return;
        const mon = _getMon();
        const topH = Main.panel ? Main.panel.height : 0;
        const vertical = this._VERTICAL;
        const [panelW, panelH] = this._panelSize(mon, topH);
        const [edgeX, edgeY, edgeW, edgeH] = this._edgeGeom(mon, topH);

        this._edge.set_size(edgeW, edgeH);
        this._edge.set_position(edgeX, edgeY);



        const sf = this._scaleFactor;
        this._setOrientation(this._box, vertical);
        this._box.x_align = this._POS === 'right' ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
        this._box.y_align = Clutter.ActorAlign.CENTER;
        this._box.x_expand = true;
        this._box.y_expand = true;
        this._box.set_style(vertical
            ? (this._POS === 'right'
                ? `padding: ${Math.round(24 * sf)}px ${Math.round(4 * sf)}px ${Math.round(24 * sf)}px 0px; spacing: ${Math.round(10 * sf)}px;`
                : `padding: ${Math.round(24 * sf)}px 0px ${Math.round(24 * sf)}px ${Math.round(4 * sf)}px; spacing: ${Math.round(10 * sf)}px;`)
            : `padding: 0px ${Math.round(24 * sf)}px; spacing: ${Math.round(10 * sf)}px;`);
        this._scroll.hscrollbar_policy = vertical ? St.PolicyType.NEVER : St.PolicyType.EXTERNAL;
        this._scroll.vscrollbar_policy = vertical ? St.PolicyType.EXTERNAL : St.PolicyType.NEVER;



        this._panel.remove_all_transitions();
        this._panel.set_size(panelW, panelH);
        this._panel.set_position(...(this._visible
            ? this._panelVisiblePos(mon, topH)
            : this._panelHiddenPos(mon, topH)));
        this._scroll.set_size(panelW, panelH);
        this._syncEdge();

        if (this._visible) this._refresh();
    }

    _recomputeScale() {
        this._scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    }

    _recomputeThemeClass() {

        const cs = St.Settings.get().color_scheme;
        this._themeClass = (cs === St.SystemColorScheme.PREFER_LIGHT) ? 'light' : '';
    }



    _wire() {
        this._sig(global.window_manager, 'map', (_wm, actor) => {
            const win = actor?.meta_window;
            if (win) {
                this._sig(win, 'position-changed', () => this._checkOverlap());
                this._sig(win, 'size-changed', () => this._checkOverlap());
                this._onWindowMap(win);
            }
            this._checkOverlap();
        });
        this._sig(global.display, 'window-created', (_d, win) => {
            if (win) {
                this._sig(win, 'position-changed', () => this._checkOverlap());
                this._sig(win, 'size-changed', () => this._checkOverlap());
            }
            this._checkOverlap();
        });
        this._sig(global.display, 'grab-op-begin', () => this._checkOverlap());
        this._sig(global.display, 'grab-op-end', () => this._checkOverlap());
        this._sig(global.window_manager, 'destroy', (_wm, actor) => {
            const win = actor?.meta_window;
            if (win) this._onWindowDestroy(win);
            this._checkOverlap();
        });
        this._sig(global.window_manager, 'minimize', (_wm, actor) => {
            const win = actor?.meta_window;
            if (win) this._onWindowMinimize(win);
            this._checkOverlap();
        });
        this._sig(global.window_manager, 'unminimize', (_wm, actor) => {
            const win = actor?.meta_window;
            if (win) this._onWindowUnminimize(win);
            this._checkOverlap();
        });
        this._sig(global.window_manager, 'size-change', (_wm, actor, change) => {
            const win = actor?.meta_window;
            if (win) this._onWindowSizeChange(win, change);
            this._checkOverlap();
        });

        this._sig(global.display, 'notify::focus-window', () => {
            this._scheduleRefresh();
            this._checkOverlap();
        });
        this._sig(global.workspace_manager, 'active-workspace-changed', () => {
            this._initGroups();
            this._checkOverlap();
        });
        this._sig(global.workspace_manager, 'workspace-added', () => this._scheduleRefresh());
        this._sig(global.workspace_manager, 'workspace-removed', () => {

            this._pruneDeadWorkspaces();
            this._scheduleRefresh();
        });
        this._sig(global.display, 'in-fullscreen-changed', () => this._onFullscreen());
        this._sig(Main.layoutManager, 'monitors-changed', () => this._rebuildLayout());

        this._sig(Main.overview, 'showing', () => {
            this._destroyPreview();
            this._killHideTimer();
            if (this._edge) this._edge.hide();
            if (this._panel) {
                this._panel.remove_all_transitions();
                this._panel.opacity = 0;
                this._panel.hide();
            }
        });

        this._sig(Main.overview, 'shown', () => {
            if (this._panel) {
                this._panel.remove_all_transitions();
                this._panel.opacity = 0;
                this._panel.hide();
            }
            if (this._edge) this._edge.hide();
        });

        this._sig(Main.overview, 'hiding', () => {
            if (this._panel) {
                this._panel.show();
                this._panel.remove_all_transitions();
                if (this._visible && !this._fullscreen() && this._isAreaClear()) {
                    this._panel.ease({
                        opacity: 255,
                        duration: 220,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            }
        });

        this._sig(Main.overview, 'hidden', () => {
            if (this._panel) {
                this._panel.show();
            }
            this._checkOverlap();
            this._syncEdge();
        });

        const themeCtx = St.ThemeContext.get_for_stage(global.stage);
        this._sig(themeCtx, 'notify::scale-factor', () => {
            this._recomputeScale();
            this._rebuildLayout();
        });

        this._sig(St.Settings.get(), 'notify::color-scheme', () => {
            this._recomputeThemeClass();
            if (this._visible) this._refresh();
        });

        this._sig(this._settings, 'changed::sidebar-reserve-space', () => this._applyChrome());
        this._sig(this._settings, 'changed::sidebar-mode', () => {
            this._initGroups();
            if (this._visible) this._refresh();
        });
        this._sig(this._settings, 'changed::app-merge-map', () => {
            this._loadAppMergeMap();
            if (this._visible) this._refresh();
        });

        this._sig(this._settings, 'changed::sidebar-width', () => this._rebuildLayout());
        this._sig(this._settings, 'changed::edge-trigger-width', () => this._rebuildLayout());
        this._sig(this._settings, 'changed::stack-panel-position', () => this._rebuildLayout());
        this._sig(this._settings, 'changed::sidebar-auto-hide', () => {
            if (this._settings.get_boolean('sidebar-auto-hide')) {
                if (!this._hovered && !this._shouldForceShow()) this._scheduleHide();
                else if (this._shouldForceShow()) this._show();
            } else {
                this._show();
            }
            this._applyChrome();
        });
        this._sig(this._settings, 'changed::show-on-empty-workspace', () => {
            this._syncForceShow();
        });
        this._sig(this._settings, 'changed::show-app-icons', () => {
            if (this._visible) this._refresh();
        });
        this._sig(this._settings, 'changed::show-group-count', () => {
            if (this._visible) this._refresh();
        });
        this._sig(this._settings, 'changed::card-base-scale', () => {
            if (this._visible) this._refresh();
        });
        this._sig(this._settings, 'changed::perspective-angle', () => {
            if (this._visible) this._refresh();
        });
    }



    _activeWs() {
        return global.workspace_manager.get_active_workspace();
    }


    _groupsFor(ws) {
        return this._groups.filter(g => g.ws === ws);
    }



    _initGroups() {
        this._pruneDeadWorkspaces();
        this._reapMovedWindows();
        const ws = this._activeWs();
        if (!ws) return;

        if (this._groupsFor(ws).length === 0)
            this._seedGroups(ws);
        else
            this._adoptStrayWindows(ws);

        if (this._visible) this._refresh();
        this._syncForceShow();
    }

    _seedGroups(ws) {
        const allWins = ws.list_windows().filter(w => _isNormal(w));

        const visible = allWins.filter(w => !w.minimized);
        if (visible.length > 0) {
            const g = { id: this._nextGid++, ws, windows: new Set(visible) };
            this._groups.push(g);
            this._activeIds.set(ws, g.id);
        }

        const tracker = Shell.WindowTracker.get_default();
        const byApp = new Map();
        for (const win of allWins.filter(w => w.minimized)) {
            const app = tracker.get_window_app(win);
            const key = app ? app.get_id() : `_anon_${win.get_id()}`;
            if (!byApp.has(key)) byApp.set(key, []);
            byApp.get(key).push(win);
        }
        for (const [, wins] of byApp) {
            this._groups.push({ id: this._nextGid++, ws, windows: new Set(wins) });
        }
    }


    _adoptStrayWindows(ws) {
        const known = new Set();
        for (const g of this._groupsFor(ws)) {
            for (const win of g.windows) known.add(win);
        }

        const strays = ws.list_windows().filter(w => _isNormal(w) && !known.has(w));
        if (strays.length === 0) return;

        const visible = strays.filter(w => !w.minimized);
        if (visible.length > 0) {
            const active = this._ensureActiveGroup(ws);
            for (const win of visible) active.windows.add(win);
        }
        for (const win of strays.filter(w => w.minimized))
            this._groups.push({ id: this._nextGid++, ws, windows: new Set([win]) });
    }


    _pruneDeadWorkspaces() {
        const wsm = global.workspace_manager;
        const live = new Set();
        for (let i = 0; i < wsm.get_n_workspaces(); i++)
            live.add(wsm.get_workspace_by_index(i));

        this._groups = this._groups.filter(g => live.has(g.ws));
        for (const ws of [...this._activeIds.keys()]) {
            if (!live.has(ws)) this._activeIds.delete(ws);
        }
    }

    _getActiveGroup(ws = this._activeWs()) {
        const id = this._activeIds.get(ws);
        if (id === undefined) return null;
        return this._groups.find(g => g.id === id) || null;
    }

    _ensureActiveGroup(ws = this._activeWs()) {
        let active = this._getActiveGroup(ws);
        if (!active) {
            active = { id: this._nextGid++, ws, windows: new Set() };
            this._groups.push(active);
            this._activeIds.set(ws, active.id);
        }
        return active;
    }

    _getInactiveGroups() {
        const ws = this._activeWs();
        const activeId = this._activeIds.get(ws);
        return this._groups.filter(g =>
            g.ws === ws && g.id !== activeId && this._groupWindows(g).length > 0);
    }



    _groupWindows(group) {
        return [...group.windows]
            .filter(w => w.get_workspace() === group.ws && w.minimized)
            .sort((a, b) => (b.get_user_time() || 0) - (a.get_user_time() || 0));
    }

    _findGroupForWindow(win) {
        return this._groups.find(g => g.windows.has(win)) || null;
    }

    _isActiveGroup(group) {
        return !!group && this._activeIds.get(group.ws) === group.id;
    }



    _loadAppMergeMap() {
        const raw = this._settings.get_string('app-merge-map');
        let obj = {};


        try { obj = JSON.parse(raw); } catch (_e) { obj = {}; }
        this._appMergeMap = new Map(Object.entries(obj));
    }

    _saveAppMergeMap() {
        const obj = Object.fromEntries(this._appMergeMap);
        this._settings.set_string('app-merge-map', JSON.stringify(obj));
    }



    _applyMerge(sourceAppId, targetKey) {
        if (sourceAppId === targetKey) return;
        this._appMergeMap.set(sourceAppId, targetKey);
        for (const [appId, key] of [...this._appMergeMap]) {
            if (key === sourceAppId) this._appMergeMap.set(appId, targetKey);
        }
    }

    _mergeApp(sourceAppId, targetKey) {
        this._applyMerge(sourceAppId, targetKey);
        this._saveAppMergeMap();
    }

    _unmergeGroup(group) {
        if (group.apps.length <= 1) return;
        for (const app of group.apps) this._appMergeMap.delete(app.get_id());
        this._saveAppMergeMap();
    }

    _workspaceOf(win) {
        return win.get_workspace();
    }



    _evictIfMoved(win) {
        const group = this._findGroupForWindow(win);
        if (!group) return;
        const ws = this._workspaceOf(win);
        if (ws && group.ws !== ws) {
            group.windows.delete(win);
            this._cleanupEmptyGroups();
        }
    }


    _reapMovedWindows() {
        for (const group of this._groups) {
            for (const win of [...group.windows]) {
                if (this._workspaceOf(win) !== group.ws) group.windows.delete(win);
            }
        }
        this._cleanupEmptyGroups();
    }

    _cleanupEmptyGroups() {
        this._groups = this._groups.filter(g => g.windows.size > 0);
        for (const [ws, id] of [...this._activeIds]) {
            if (!this._groups.some(g => g.id === id)) this._activeIds.delete(ws);
        }
    }

    _onWindowMinimize(win) {
        if (!_isNormal(win)) return;

        if (this._expectMinimize.delete(win)) return;

        this._captureSnapshot(win);

        if (this._settings.get_string('sidebar-mode') === 'groups') {
            const ws = this._workspaceOf(win);
            this._evictIfMoved(win);
            const group = this._findGroupForWindow(win);
            if (!group) {
                if (ws) this._groups.push({ id: this._nextGid++, ws, windows: new Set([win]) });
            } else if (this._isActiveGroup(group)) {
                group.windows.delete(win);
                this._groups.push({ id: this._nextGid++, ws: group.ws, windows: new Set([win]) });
                this._cleanupEmptyGroups();
            }
        }

        const rect = win.get_frame_rect();
        const bufRect = win.get_buffer_rect();
        const actor = win.get_compositor_private();
        if (actor && rect && rect.width > 0 && rect.height > 0) {
            const mon = _getMon();
            const topH = Main.panel ? Main.panel.height : 0;
            const sf = this._scaleFactor || 1;
            const cardW = 140 * sf;
            const cardH = 90 * sf;
            const cardX = this._POS === 'right' ? (mon.x + mon.width - 200 * sf) : (mon.x + 24 * sf);

            let cardY;
            if (this._cards && this._cards.length > 0) {
                let totalH = cardH;
                for (const c of this._cards) {
                    const [, ch] = c.get_transformed_size();
                    totalH += (ch || (cardH + 30 * sf)) + 10 * sf;
                }
                const availH = mon.height - topH;
                cardY = mon.y + topH + Math.max(10 * sf, Math.round((availH - totalH) / 2));

                const shiftY = Math.round((cardH + 10 * sf) / 2);
                for (const c of this._cards) {
                    c.ease({
                        translation_y: shiftY,
                        duration: 280,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                }
            } else {
                cardY = Math.round(mon.y + topH + (mon.height - topH - cardH) / 2);
            }

            const winW = (bufRect && bufRect.width > 0) ? bufRect.width : rect.width;
            const winH = (bufRect && bufRect.height > 0) ? bufRect.height : rect.height;
            const winX = (bufRect && bufRect.width > 0) ? bufRect.x : rect.x;
            const winY = (bufRect && bufRect.height > 0) ? bufRect.y : rect.y;

            let content = this._snapshots.get(win)?.content;
            const clone = content
                ? new St.Widget({ content })
                : new Clutter.Clone({ source: actor });
            clone.set_content_gravity?.(Clutter.ContentGravity.RESIZE_FILL);
            clone.set_position(winX, winY);
            clone.set_size(winW, winH);
            const pivotX = (this._POS === 'right') ? 1.0 : 0.0;
            clone.set_pivot_point(pivotX, 0.5);
            clone.scale_z = 1.0;
            Main.uiGroup.add_child(clone);
            this._activeClones?.add(clone);

            // Pre-refresh Stage Manager so destination card is created and positioned
            this._signature = null;
            this._refresh();
            const targetCard = this._cards.find(c => {
                if (c._windows && c._windows.includes(win)) return true;
                if (c._group?.windows) {
                    if (Array.isArray(c._group.windows) && c._group.windows.includes(win)) return true;
                    if (c._group.windows.has && c._group.windows.has(win)) return true;
                }
                return false;
            });
            if (targetCard) {
                targetCard.opacity = 0;
                try {
                    let targetActor = targetCard._thumb?._frontLayer ?? targetCard._thumb?._previewBox ?? targetCard._thumb ?? targetCard;
                    if (targetActor.get_children?.().length > 0)
                        targetActor = targetActor.get_children()[0];
                    const [cx, cy] = targetActor.get_transformed_position();
                    const [cw, ch] = targetActor.get_transformed_size();
                    if (cw > 0 && ch > 0) {
                        cardX = cx; cardY = cy; cardW = cw; cardH = ch;
                    }
                } catch (_) {}
            }

            // Animate other cards moving down to make room for targetCard
            if (this._cards && this._cards.length > 1) {
                const shiftY = Math.round((cardH + 10 * sf) / 2);
                for (const c of this._cards) {
                    if (c !== targetCard) {
                        c.translation_y = -shiftY;
                        c.ease({
                            translation_x: 0,
                            translation_y: 0,
                            duration: 280,
                            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        });
                    }
                }
            }

            const destScale = Math.min(cardW / winW, cardH / winH);
            const fitW = winW * destScale;
            const fitH = winH * destScale;
            const destX = cardX + Math.round((cardW - fitW) / 2);
            const destY = cardY + Math.round((cardH - fitH) / 2);

            clone.ease({
                x: destX,
                y: destY,
                scale_x: destScale,
                scale_y: destScale,
                scale_z: destScale,
                rotation_angle_y: this._ROT_SIGN * 10,
                opacity: 255,
                duration: 280,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    if (targetCard) targetCard.opacity = 255;
                    clone.destroy();
                    this._activeClones?.delete(clone);
                },
            });
        } else {
            this._scheduleRefresh();
        }

        this._syncForceShow();
    }

    _onWindowUnminimize(win) {
        if (!_isNormal(win)) return;

        if (this._expectUnminimize.delete(win)) {
            this._dropSnapshot(win);
            return;
        }

        // Unminimized from outside Stage Manager (e.g. clicked in Dock):
        const tracker = Shell.WindowTracker.get_default();
        const app = tracker ? tracker.get_window_app(win) : null;
        const appId = app ? app.get_id() : null;

        let targetCard = null;
        let targetWins = [win];

        if (this._cards && this._cards.length > 0) {
            targetCard = this._cards.find(c => {
                if (c._windows && c._windows.includes(win)) return true;
                if (c._group) {
                    if (c._group.windows) {
                        if (Array.isArray(c._group.windows) && c._group.windows.includes(win)) return true;
                        if (c._group.windows.has && c._group.windows.has(win)) return true;
                    }
                    if (appId && c._group.apps) {
                        if (c._group.apps.some(a => a?.get_id?.() === appId)) return true;
                    }
                }
                return false;
            }) ?? null;

            if (targetCard?._group?.windows) {
                targetWins = Array.isArray(targetCard._group.windows)
                    ? targetCard._group.windows
                    : [...targetCard._group.windows];
            } else if (targetCard?._windows) {
                targetWins = targetCard._windows;
            }
        }

        this._switchWindows(targetWins, targetCard);
    }

    _onWindowMap(win) {
        if (!_isNormal(win)) return;
        if (!win._stageSwitching) {
            const ws = win.get_workspace() || global.workspace_manager.get_active_workspace();
            const tracker = Shell.WindowTracker.get_default();
            const newApp = tracker.get_window_app(win);
            const newAppId = newApp ? newApp.get_id() : null;
            const openWins = ws ? ws.list_windows().filter(w =>
                _isNormal(w) && !w.minimized && w !== win
            ) : [];
            for (const other of openWins) {
                const otherApp = tracker.get_window_app(other);
                const otherAppId = otherApp ? otherApp.get_id() : null;
                if (otherAppId !== newAppId) {
                    other._stageManaged = false;
                    other._stageCardRect = null;
                    other.minimize();
                }
            }
        }
        if (this._settings.get_string('sidebar-mode') === 'groups') {
            const ws = win.get_workspace();
            if (ws) this._ensureActiveGroup(ws).windows.add(win);
        }
        this._scheduleRefresh();
        this._syncForceShow();
    }




    _onWindowSizeChange(win, change) {
        if (!_isNormal(win)) return;



        if (change === Meta.SizeChange.UNMAXIMIZE) { this._returnFromOwnGroup(win); return; }
        if (change !== Meta.SizeChange.MAXIMIZE) return;



        if (this._settings.get_string('maximize-behavior') !== 'stage') return;
        if (this._settings.get_string('sidebar-mode') !== 'groups') return;
        this._promoteToOwnGroup(win);
    }

    _promoteToOwnGroup(win) {
        const group = this._findGroupForWindow(win);

        if (!group || this._groupWindows(group).length < 2) return;


        if (group.ws !== this._activeWs()) return;

        group.windows.delete(win);
        this._maxOrigin.set(win, group.id);
        const promoted = { id: this._nextGid++, ws: group.ws, windows: new Set([win]) };
        this._groups.push(promoted);
        this._swapToGroup(promoted);
    }

    _returnFromOwnGroup(win) {
        const originId = this._maxOrigin.get(win);
        if (originId === undefined) return;
        this._maxOrigin.delete(win);

        const origin = this._groups.find(g => g.id === originId);


        if (!origin || origin.ws !== this._workspaceOf(win)) return;

        const promoted = this._findGroupForWindow(win);

        const onPromoted = this._isActiveGroup(promoted);
        promoted?.windows.delete(win);
        origin.windows.add(win);
        this._cleanupEmptyGroups();


        if (onPromoted) this._swapToGroup(origin);
        else this._scheduleRefresh();
    }

    _onWindowDestroy(win) {
        this._expectMinimize.delete(win);
        this._expectUnminimize.delete(win);
        this._maxOrigin.delete(win);
        this._dropSnapshot(win);
        for (const group of this._groups) {
            group.windows.delete(win);
        }
        this._cleanupEmptyGroups();
        this._scheduleRefresh();
        this._syncForceShow();
    }

    _switchWindows(targetWins, card = null) {
        if (!targetWins || targetWins.length === 0) return;
        if (this._isSwitching) return;
        this._isSwitching = true;

        if (this._activeClones) {
            for (const c of this._activeClones) {
                try { c.destroy(); } catch (_) {}
            }
            this._activeClones.clear();
        } else {
            this._activeClones = new Set();
        }

        const ws = this._activeWs();
        if (!ws) {
            this._isSwitching = false;
            return;
        }

        this._destroyPreview();

        const allWsWins = ws.list_windows().filter(w => _isNormal(w));
        const activeWins = allWsWins.filter(w => !w.minimized && !targetWins.includes(w));

        // Find matching card if not explicitly provided
        if (!card && targetWins.length > 0) {
            const targetWin = targetWins[0];
            const tracker = Shell.WindowTracker.get_default();
            const targetApp = tracker?.get_window_app(targetWin);
            const targetAppId = targetApp ? targetApp.get_id() : null;

            card = this._cards.find(c => {
                if (c._windows && c._windows.includes(targetWin)) return true;
                if (c._group) {
                    if (c._group.windows) {
                        if (Array.isArray(c._group.windows) && c._group.windows.includes(targetWin)) return true;
                        if (c._group.windows.has && c._group.windows.has(targetWin)) return true;
                    }
                    if (targetAppId && c._group.apps) {
                        if (c._group.apps.some(a => a?.get_id?.() === targetAppId)) return true;
                    }
                }
                return false;
            }) ?? null;
        }

        let cardX, cardY, cardW, cardH;
        if (card) {
            try {
                let targetActor = card._thumb?._frontLayer ?? card._thumb?._previewBox ?? card._thumb ?? card;
                if (targetActor.get_children?.().length > 0)
                    targetActor = targetActor.get_children()[0];
                const [cx, cy] = targetActor.get_transformed_position();
                const [cw, ch] = targetActor.get_transformed_size();
                cardX = cx; cardY = cy; cardW = cw; cardH = ch;
            } catch (_) {}
            card.opacity = 0;
        }
        if (!cardX || !cardW || cardW <= 0) {
            const mon = _getMon();
            const topH = Main.panel ? Main.panel.height : 0;
            const sf = this._scaleFactor || 1;
            cardX = this._POS === 'right' ? (mon.x + mon.width - 200 * sf) : (mon.x + 24 * sf);
            cardY = Math.round(mon.y + topH + (mon.height - topH) / 2 - 50 * sf);
            cardW = 140 * sf; cardH = 90 * sf;
        }

        // If unfolding from an empty desktop, remaining cards smoothly slide to re-center
        if (activeWins.length === 0 && card && this._cards && this._cards.length > 1) {
            const sf = this._scaleFactor || 1;
            const shiftY = Math.round((cardH + 10 * sf) / 2);
            const targetIdx = this._cards.indexOf(card);
            for (let i = 0; i < this._cards.length; i++) {
                const c = this._cards[i];
                if (c !== card) {
                    const dir = (targetIdx !== -1 && i < targetIdx) ? 1 : -1;
                    c.ease({
                        translation_x: 0,
                        translation_y: dir * shiftY,
                        duration: 280,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                }
            }
        }

        // 1. Fold active windows from desktop into Stage Manager sidebar
        for (const win of activeWins) {
            try {
                const rect = win.get_frame_rect();
                const bufRect = win.get_buffer_rect();
                if (rect && rect.width > 0 && rect.height > 0)
                    this._savedLayouts.set(win, {
                        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                        bufX: bufRect.x, bufY: bufRect.y, bufW: bufRect.width, bufH: bufRect.height,
                    });

                this._captureSnapshot(win);
                this._expectMinimize.add(win);

                const actor = win.get_compositor_private();
                win._stageSwitching = true;
                win._stageManaged = true;
                win._stageCardRect = { x: cardX, y: cardY, width: cardW, height: cardH };

                const winW = (bufRect && bufRect.width > 0) ? bufRect.width : rect.width;
                const winH = (bufRect && bufRect.height > 0) ? bufRect.height : rect.height;
                const winX = (bufRect && bufRect.width > 0) ? bufRect.x : rect.x;
                const winY = (bufRect && bufRect.height > 0) ? bufRect.y : rect.y;

                if (actor && winW > 0 && winH > 0) {
                    let content = this._snapshots.get(win)?.content;
                    const clone = content
                        ? new St.Widget({ content })
                        : new Clutter.Clone({ source: actor });
                    clone.set_content_gravity?.(Clutter.ContentGravity.RESIZE_FILL);
                    clone.set_position(winX, winY);
                    clone.set_size(winW, winH);
                    const pivotX = (this._POS === 'right') ? 1.0 : 0.0;
                    clone.set_pivot_point(pivotX, 0.5);
                    clone.scale_z = 1.0;
                    actor.opacity = 0;
                    Main.uiGroup.add_child(clone);
                    this._activeClones.add(clone);

                    const destScale = Math.min(cardW / winW, cardH / winH);
                    const fitW = winW * destScale;
                    const fitH = winH * destScale;
                    const destX = cardX + Math.round((cardW - fitW) / 2);
                    const destY = cardY + Math.round((cardH - fitH) / 2);

                    clone.ease({
                        x: destX,
                        y: destY,
                        scale_x: destScale,
                        scale_y: destScale,
                        scale_z: destScale,
                        rotation_angle_y: this._ROT_SIGN * 10,
                        opacity: 255,
                        duration: 280,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onComplete: () => {
                            clone.destroy();
                            this._activeClones?.delete(clone);
                            win.minimize();
                            actor.opacity = 255;
                            win._stageSwitching = false;
                        },
                    });
                } else {
                    win.minimize();
                    win._stageSwitching = false;
                }
            } catch (_) {
                win._stageSwitching = false;
                win.minimize();
            }
        }

        // 2. Unfold target windows from Stage Manager sidebar onto desktop
        for (let i = 0; i < targetWins.length; i++) {
            const win = targetWins[i];
            try {
                const saved = this._savedLayouts.get(win);
                const targetFrame = saved ?? win.get_frame_rect();

                this._expectUnminimize.add(win);
                win._stageSwitching = true;
                win._stageManaged = true;
                win._stageCardRect = { x: cardX, y: cardY, width: cardW, height: cardH };

                const actor = win.get_compositor_private();
                if (actor) {
                    actor.remove_all_transitions();
                    actor.opacity = 0;
                }

                if (win.minimized) win.unminimize();
                if (actor) {
                    actor.opacity = 0;
                }

                if (targetFrame && targetFrame.width > 0 && targetFrame.height > 0)
                    win.move_resize_frame?.(true, targetFrame.x, targetFrame.y, targetFrame.width, targetFrame.height);

                const bufRect = win.get_buffer_rect();
                const [aw, ah] = actor ? actor.get_size() : [0, 0];
                const targetW = (aw > 0) ? aw : (saved?.bufW ?? (bufRect.width > 0 ? bufRect.width : targetFrame.width));
                const targetH = (ah > 0) ? ah : (saved?.bufH ?? (bufRect.height > 0 ? bufRect.height : targetFrame.height));
                const targetX = (actor && actor.width > 0) ? actor.x : (saved?.bufX ?? (bufRect.width > 0 ? bufRect.x : targetFrame.x));
                const targetY = (actor && actor.height > 0) ? actor.y : (saved?.bufY ?? (bufRect.height > 0 ? bufRect.y : targetFrame.y));

                if (actor && targetW > 0 && targetH > 0) {
                    actor.opacity = 0;
                    let content = this._snapshots.get(win)?.content;
                    const clone = content
                        ? new St.Widget({ content })
                        : new Clutter.Clone({ source: actor });
                    clone.set_content_gravity?.(Clutter.ContentGravity.RESIZE_FILL);

                    const startScale = Math.min(cardW / targetW, cardH / targetH);
                    const fitW = targetW * startScale;
                    const fitH = targetH * startScale;
                    const startX = cardX + Math.round((cardW - fitW) / 2);
                    const startY = cardY + Math.round((cardH - fitH) / 2);

                    clone.set_position(startX, startY);
                    clone.set_size(targetW, targetH);
                    clone.set_scale(startScale, startScale);
                    clone.scale_z = startScale;
                    const pivotX = (this._POS === 'right') ? 1.0 : 0.0;
                    clone.set_pivot_point(pivotX, 0.5);
                    clone.rotation_angle_y = this._ROT_SIGN * 10;
                    clone.opacity = 255;
                    Main.uiGroup.add_child(clone);
                    this._activeClones.add(clone);

                    clone.ease({
                        x: targetX,
                        y: targetY,
                        scale_x: 1.0,
                        scale_y: 1.0,
                        scale_z: 1.0,
                        rotation_angle_y: 0,
                        opacity: 255,
                        duration: 280,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onComplete: () => {
                            clone.destroy();
                            this._activeClones?.delete(clone);
                            actor.opacity = 255;
                            this._dropSnapshot(win);
                            win._stageSwitching = false;
                            this._isSwitching = false;
                            if (i === 0) win.activate(global.get_current_time());
                        },
                    });
                } else {
                    win._stageSwitching = false;
                    this._isSwitching = false;
                    if (actor) actor.opacity = 255;
                    if (i === 0) win.activate(global.get_current_time());
                }
            } catch (_) {
                win._stageSwitching = false;
                this._isSwitching = false;
                const actor = win.get_compositor_private();
                if (actor) actor.opacity = 255;
                if (win.minimized) win.unminimize();
                if (i === 0) win.activate(global.get_current_time());
            }
        }

        this._killSwapTimer();
        this._swapTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._untrackTimer(this._swapTimer); this._swapTimer = null;
            this._expectMinimize.clear();
            this._expectUnminimize.clear();
            this._isSwitching = false;
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(this._swapTimer);

        this._hovered = false;

        this._killRefreshTimer();
        this._refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 290, () => {
            this._untrackTimer(this._refreshTimer); this._refreshTimer = null;
            if (this._visible) this._refresh();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(this._refreshTimer);
    }

    _swapToGroup(targetGroup, card = null) {
        const ws = this._activeWs();
        if (!targetGroup || targetGroup.ws !== ws) return;
        if (targetGroup.id === this._activeIds.get(ws)) return;

        this._activeIds.set(ws, targetGroup.id);
        const targetWins = this._groupWindows(targetGroup);
        this._switchWindows(targetWins, card);
    }



    _fullscreen() {
        return global.display.get_monitor_in_fullscreen(_getMon().index);
    }

    _onFullscreen() {
        if (this._fullscreen()) {
            this._destroyPreview();
            if (this._visible) {
                this._visible = false;
                if (this._panel) {
                    this._panel.remove_all_transitions();
                    const m = _getMon();
                    this._panel.set_position(
                        ...this._panelHiddenPos(m, Main.panel ? Main.panel.height : 0));
                }
            }
            this._syncEdge();
            this._applyChrome();
        } else {
            this._syncEdge();


            if (!this._settings.get_boolean('sidebar-auto-hide') || this._shouldForceShow())
                this._show();
        }
    }



    _addKeybinding() {
        Main.wm.addKeybinding(
            KEYBIND_NAME,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggleVisible(),
        );
        this._keybindingAdded = true;
    }

    _removeKeybinding() {
        if (!this._keybindingAdded) return;
        Main.wm.removeKeybinding(KEYBIND_NAME);
        this._keybindingAdded = false;
    }

    _toggleVisible() {
        if (this._visible) this._hide();
        else this._show();
    }





    _show() {
        if (this._visible || !this._panel) return;
        if (this._fullscreen() || Main.overview.visible || Main.overview.visibleTarget) return;

        this._visible = true;
        this._killHideTimer();
        this._refresh();
        this._syncEdge();

        const [vx, vy] = this._panelVisiblePos(_getMon(), Main.panel ? Main.panel.height : 0);
        this._panel.remove_all_transitions();
        this._panel.ease({
            x: vx, y: vy,
            opacity: 255,
            duration: this._SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._panel.opacity = 255;
                this._applyChrome();
            },
        });
    }

    _hide() {
        if (!this._visible || !this._panel) return;

        this._visible = false;
        this._flyoutMode = false;
        this._destroyPreview();
        this._syncEdge();


        this._applyChrome();


        this._signature = null;

        const [hx, hy] = this._panelHiddenPos(_getMon(), Main.panel ? Main.panel.height : 0);
        this._panel.remove_all_transitions();
        this._panel.ease({
            x: hx, y: hy,
            opacity: 0,
            duration: this._SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._panel.opacity = 0;
            },
        });
    }

    _scheduleHide() {
        if (this._isAreaClear() && !this._settings.get_boolean('sidebar-auto-hide')) return;
        if (this._shouldForceShow()) return;
        this._killHideTimer();
        this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._HIDE_DELAY_MS, () => {
            this._untrackTimer(this._hideTimer); this._hideTimer = null;
            if (!this._hovered && !this._shouldForceShow()) {
                if (this._flyoutMode || !this._isAreaClear() || this._settings.get_boolean('sidebar-auto-hide'))
                    this._hide();
            }
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(this._hideTimer);
    }

    _scheduleRefresh() {


        if (this._refreshTimer) { GLib.source_remove(this._refreshTimer); this._untrackTimer(this._refreshTimer); this._refreshTimer = null; }
        this._refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._untrackTimer(this._refreshTimer); this._refreshTimer = null;
            if (this._visible && !this._hovered) this._refresh();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(this._refreshTimer);
    }



    _refresh() {
        if (!this._box) return;



        const signature = this._renderSignature();
        if (signature === this._signature) return;
        this._signature = signature;



        this._killHoverTimer();
        this._destroyPreview();
        this._hovered = false;

        this._disconnectCardSigs();
        this._cards = [];
        this._hoveredIdx = -1;
        this._safeDestroyContent();

        const mode = this._settings.get_string('sidebar-mode');

        if (mode === 'workspaces')
            this._refreshWorkspaces();
        else if (mode === 'apps')
            this._refreshApps();
        else if (mode === 'all-windows')
            this._refreshAllWindows();
        else
            this._refreshGroups();

        this._animateCardsEntrance();
    }



    _renderSignature() {
        const mode = this._settings.get_string('sidebar-mode');
        const parts = [
            mode, this._scaleFactor, this._themeClass, this._PANEL_W, this._POS,
            this._BASE_SCALE, this._PERSP_ANGLE,
            this._settings.get_boolean('show-app-icons') ? 1 : 0,
            this._settings.get_boolean('show-group-count') ? 1 : 0,
        ];



        const ids = wins => {
            const shape = wins.length > 0
                ? Math.round((this._windowAspect(wins[0]) ?? 0) * 20)
                : 0;
            return `${wins.map(w => w.get_id()).join('.')}@${shape}`;
        };

        if (mode === 'workspaces') {
            const wsm = global.workspace_manager;
            const activeIdx = wsm.get_active_workspace_index();
            parts.push(activeIdx, this._settings.get_boolean('show-workspace-current') ? 1 : 0);
            for (let i = 0; i < wsm.get_n_workspaces(); i++) {
                const ws = wsm.get_workspace_by_index(i);
                parts.push(`${i}:${ids(ws.list_windows().filter(w => _isNormal(w)))}`);
            }
        } else if (mode === 'apps') {
            const groups = _groupByApp(this._activeWs(), global.display.get_focus_window(), this._appMergeMap);
            for (const g of groups)
                parts.push(`${g.key}:${ids(g.windows)}`);
        } else if (mode === 'all-windows') {


            const wsm = global.workspace_manager;
            const focused = global.display.get_focus_window();
            const winSig = w =>
                `${w.get_id()}@${Math.round((this._windowAspect(w) ?? 0) * 20)}`;
            parts.push(focused ? focused.get_id() : 0);
            for (let i = 0; i < wsm.get_n_workspaces(); i++) {
                const ws = wsm.get_workspace_by_index(i);
                if (!ws) continue;
                const wins = ws.list_windows().filter(w => _isNormal(w) && w !== focused && w.minimized);
                parts.push(`${i}:${wins.map(winSig).join('.')}`);
            }
        } else {
            for (const g of this._getInactiveGroups())
                parts.push(`${g.id}:${ids(this._groupWindows(g))}`);
        }
        return parts.join('|');
    }

    _refreshGroups() {
        const all = this._getInactiveGroups();
        for (const group of all.slice(0, MAX_GROUPS)) {
            const card = this._makeGroupCard(group);
            if (card) { this._box.add_child(card); this._cards.push(card); }
        }
        this._addOverflowLabel(all.length - MAX_GROUPS);
    }

    _refreshApps() {
        const focusedWin = global.display.get_focus_window();
        const all = _groupByApp(this._activeWs(), focusedWin, this._appMergeMap);
        for (const group of all.slice(0, MAX_GROUPS)) {
            const card = this._makeAppCard(group);
            if (card) { this._box.add_child(card); this._cards.push(card); }
        }
        this._addOverflowLabel(all.length - MAX_GROUPS);
    }



    _refreshAllWindows() {
        const wsm = global.workspace_manager;
        const focused = global.display.get_focus_window();
        const n = wsm.get_n_workspaces();
        let shown = 0;
        let total = 0;

        for (let i = 0; i < n; i++) {
            const ws = wsm.get_workspace_by_index(i);
            if (!ws) continue;


            const wins = ws.list_windows()
                .filter(w => _isNormal(w) && w !== focused && w.minimized)
                .sort((a, b) => (b.get_user_time() || 0) - (a.get_user_time() || 0));
            total += wins.length;
            if (wins.length === 0) continue;



            if (shown >= MAX_GROUPS) continue;
            this._addWorkspaceHeader(i);

            for (const win of wins) {
                if (shown >= MAX_GROUPS) break;
                const card = this._makeWindowCard(win);
                if (card) { this._box.add_child(card); this._cards.push(card); shown++; }
            }
        }
        this._addOverflowLabel(total - shown);
    }



    _addWorkspaceHeader(wsIndex) {
        const text = _('Workspace %d').replace('%d', `${wsIndex + 1}`);
        if (this._box)
            this._box.add_child(new St.Label({
                text, reactive: false,
                x_align: Clutter.ActorAlign.CENTER,
                style_class: this._cls('stage-ws-header'),
            }));
    }


    _makeWindowCard(win) {
        const windows = [win];
        const card = this._wrapCard();
        card._windows = windows;
        const app = Shell.WindowTracker.get_default().get_window_app(win);
        card._app = app;
        const thumb = this._makeStackedThumb(windows, app ? [app] : []);
        card.add_child(thumb);
        card._thumb = thumb;

        card.set_pivot_point(0.5, 0.5);
        this._applyPerspective(card, 1.0);
        const idx = this._cards.length;
        this._wireCardEvents(card, thumb, windows, idx);
        this._cardSig(card, 'button-release-event', () => {
            this._destroyPreview();
            this._activateWindow(win, card);
            return Clutter.EVENT_STOP;
        });
        return card;
    }



    _activateWindow(win, card = null) {
        if (!win) return;
        this._switchWindows([win], card);
    }



    _addOverflowLabel(hidden) {
        if (hidden <= 0) return;
        if (!this._box) return;
        this._box.add_child(new St.Label({
            text: `+${hidden}`,
            reactive: false,
            x_align: Clutter.ActorAlign.CENTER,
            style_class: this._cls('stage-overflow'),
        }));
    }

    _refreshWorkspaces() {
        const wsm = global.workspace_manager;
        const activeIdx = wsm.get_active_workspace_index();
        const n = wsm.get_n_workspaces();
        const showCurrent = this._settings.get_boolean('show-workspace-current');
        for (let i = 0; i < n; i++) {
            if (!showCurrent && i === activeIdx) continue;
            const ws = wsm.get_workspace_by_index(i);
            const wins = ws.list_windows().filter(w => _isNormal(w));
            if (wins.length === 0 && i !== activeIdx) continue;
            const card = this._makeWorkspaceCard(ws, wins, i, i === activeIdx);
            if (card) { this._box.add_child(card); this._cards.push(card); }
        }
    }

    _safeDestroyContent() {
        if (!this._box) return;
        _nullCloneSources(this._box);
        this._box.destroy_all_children();
    }



    _animateCardsEntrance() {
        const base = this._BASE_SCALE;

        for (let i = 0; i < this._cards.length; i++) {
            const card = this._cards[i];

            card.remove_all_transitions();
            card.set_opacity(255);
            card.translation_y = 0;
            card.translation_x = 0;
            card.set_scale(base, base);
            card.rotation_angle_y = 0;
            card.rotation_angle_x = 0;
            this._applyPerspective(card, 1.0);
        }
    }





    _wrapCard() {
        const card = new St.BoxLayout({
            reactive: true,
            x_align: this._POS === 'right' ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
            style_class: this._cls('stage-card'),
        });


        this._setOrientation(card, true);
        return card;
    }


    _cls(...names) {
        if (this._themeClass)
            return [...names, this._themeClass].join(' ');
        return names.join(' ');
    }

    _makeGroupCard(group) {
        const windows = this._groupWindows(group);
        if (windows.length === 0) return null;

        const card = this._wrapCard();
        card._group = group;
        card._windows = windows;
        const tracker = Shell.WindowTracker.get_default();
        const seenApps = new Set();
        const apps = [];
        for (const win of windows) {
            const app = tracker.get_window_app(win);
            if (app && !seenApps.has(app.get_id())) {
                seenApps.add(app.get_id());
                apps.push(app);
            }
        }
        const thumb = this._makeStackedThumb(windows, apps);
        card.add_child(thumb);
        card._thumb = thumb;

        card.set_pivot_point(0.5, 0.5);
        this._applyPerspective(card, 1.0);

        const idx = this._cards.length;
        this._wireCardEvents(card, thumb, windows, idx);

        this._cardSig(card, 'button-release-event', () => {
            this._destroyPreview();
            this._swapToGroup(group, card);
            return Clutter.EVENT_STOP;
        });

        return card;
    }

    _makeAppCard(group) {
        const { windows } = group;
        const card = this._wrapCard();

        card._group = group;
        card._windows = windows;
        const thumb = this._makeStackedThumb(windows, group.apps);
        card.add_child(thumb);
        card._thumb = thumb;

        card.set_pivot_point(0.5, 0.5);
        this._applyPerspective(card, 1.0);
        const idx = this._cards.length;
        this._wireCardEvents(card, thumb, windows, idx);

        this._cardSig(card, 'button-press-event', (_a, event) => {
            if (event.get_button() === 3 && group.apps.length > 1) {
                this._unmergeGroup(group);
                return Clutter.EVENT_STOP;
            }
            if (event.get_button() === 1) this._startAppDragCandidate(group, card);
            return Clutter.EVENT_PROPAGATE;
        });
        this._cardSig(card, 'button-release-event', () => {
            this._destroyPreview();
            if (this._endAppDragCandidate()) return Clutter.EVENT_STOP;
            this._activateApp(group, card);
            return Clutter.EVENT_STOP;
        });

        return card;
    }

    _activateApp(group, card = null) {
        const { windows } = group;
        if (windows.length === 0) return;
        this._switchWindows(windows, card);
    }



    _makeWindowClone(win, maxW, maxH, maxScale = Infinity) {
        let geom = this._snapshots.get(win);
        if (!geom || !geom.content) {
            this._captureSnapshot(win);
            geom = this._snapshots.get(win);
        }
        if (!geom) geom = this._windowGeometry(win);
        if (!geom) return null;

        const { aw, ah } = geom;
        if (!(aw > 0) || !(ah > 0)) return null;
        const scale = Math.min(maxW / aw, maxH / ah, maxScale);
        const w = Math.round(aw * scale);
        const h = Math.round(ah * scale);

        if (geom.content) {
            const inner = new St.Widget({
                reactive: false,
                content: geom.content,
            });
            inner.set_content_gravity?.(Clutter.ContentGravity.RESIZE_FILL);
            inner.set_size(w, h);
            return inner;
        }

        if (geom.actor) {
            const clone = new Clutter.Clone({ source: geom.actor, reactive: false });
            clone.set_size(aw, ah);
            clone.set_pivot_point(0, 0);
            clone.set_scale(scale, scale);
            return clone;
        }

        return null;
    }


    _windowGeometry(win) {
        const actor = win.get_compositor_private?.();
        if (!actor) return null;

        const [aw, ah] = actor.get_size();
        if (!(aw > 0) || !(ah > 0)) return null;

        return { aw, ah, actor, content: null };
    }



    _captureSnapshot(win) {
        const geom = this._windowGeometry(win);
        if (!geom) return;



        const content = geom.actor.paint_to_content(null);
        if (!content) return;
        this._snapshots.delete(win);
        this._snapshots.set(win, { aw: geom.aw, ah: geom.ah, actor: null, content });
        while (this._snapshots.size > MAX_SNAPSHOTS)
            this._snapshots.delete(this._snapshots.keys().next().value);
    }

    _dropSnapshot(win) {
        this._snapshots.delete(win);
    }


    _clampAspect(ratio) {
        if (!(ratio > 0)) return null;
        return Math.min(THUMB_ASPECT_MAX, Math.max(THUMB_ASPECT_MIN, ratio));
    }



    _windowAspect(win) {
        const geom = this._windowGeometry(win) ?? this._snapshots.get(win);
        if (geom) return this._clampAspect(geom.aw / geom.ah);
        const r = win.get_frame_rect();
        if (r && r.width > 0 && r.height > 0)
            return this._clampAspect(r.width / r.height);
        return null;
    }


    _monitorAspect() {
        const mon = _getMon();
        return (mon && this._clampAspect(mon.width / mon.height)) ??
               this._clampAspect(THUMB_W / THUMB_H);
    }



    _thumbSize(count, aspect = null) {
        const sf = this._scaleFactor;
        const layers = Math.min(Math.max(count, 1), MAX_STACK);
        const perspective = 1 + (this._PERSP_ANGLE / 45) * PERSP_HEADROOM;
        const ratio = aspect ?? this._monitorAspect();



        if (!this._VERTICAL) {



            const iconRow = this._settings.get_boolean('show-app-icons')
                ? (ICON_SIZE + 5) * sf : 0;
            const budgetH = (this._PANEL_W - CARD_MARGIN * sf) / perspective -
                            2 * CARD_PAD_Y * sf - iconRow;
            const kv = STACK_V / THUMB_W;
            const fittedH = budgetH / (1 + (layers - 1) * kv);
            const h = Math.round(Math.max(MIN_THUMB_W * sf / THUMB_ASPECT_MAX, fittedH));
            return [Math.round(h * ratio), h];
        }

        const budget = (this._PANEL_W - CARD_MARGIN * sf) / perspective - 2 * CARD_PAD_X * sf;
        const k = STACK_H / THUMB_W;
        const fitted = budget / (1 + (layers - 1) * k);


        const w = Math.round(Math.max(MIN_THUMB_W * sf, fitted));
        return [w, Math.round(w / ratio)];
    }


    _stackStep(thumbW) {
        return [thumbW * (STACK_H / THUMB_W), thumbW * (STACK_V / THUMB_W)];
    }

    _makeStackedThumb(windows, apps = []) {
        const sf = this._scaleFactor;


        const aspect = windows.length > 0 ? this._windowAspect(windows[0]) : null;
        const [tw, th] = this._thumbSize(windows.length, aspect);
        const [sh, sv] = this._stackStep(tw);
        const n = Math.min(windows.length, MAX_STACK);


        const layers = Math.max(n, 1);
        const totalH = (layers - 1) * sh;
        const totalV = (layers - 1) * sv;
        const container = new St.Widget({ reactive: false, clip_to_allocation: false });
        container.set_size(tw + totalH, th + totalV);

        const previewBox = new St.Widget({ reactive: false, clip_to_allocation: false });
        previewBox.set_size(tw + totalH, th + totalV);
        container.add_child(previewBox);
        container._previewBox = previewBox;

        for (let i = n - 1; i >= 0; i--) {
            const win = windows[i];
            const x = i * sh;
            const y = i * sv;
            const isFront = (i === 0);
            const layerOpacity = isFront ? 255 : Math.max(140, 210 - i * 30);

            const layer = new St.Widget({
                reactive: false,
                clip_to_allocation: true,
                style_class: this._cls(isFront ? 'stage-thumb-layer' : 'stage-thumb-layer-back'),
                opacity: layerOpacity,
            });
            layer.set_size(tw, th);
            layer.set_position(x, y);

            const content = this._makeWindowClone(win, tw, th);
            if (content) {
                content.set_position(
                    Math.round((tw - content.width) / 2),
                    Math.round((th - content.height) / 2));
                layer.add_child(content);
            } else {
                this._addIconFallback(layer, win, tw, th);
            }

            previewBox.add_child(layer);
        }

        const previewChildren = previewBox.get_children();
        container._frontLayer = previewChildren.length > 0 ? previewChildren[previewChildren.length - 1] : null;

        if (windows.length > 1 && this._settings.get_boolean('show-group-count')) {
            const badge = new St.Label({
                text: `${windows.length}`,
                style_class: this._cls('stage-badge'),
                reactive: false,
            });
            badge.set_position(Math.round(tw - 22 * sf), Math.round(4 * sf));
            container.add_child(badge);
        }

        if (this._settings.get_boolean('show-app-icons') && apps && apps.length > 0) {
            const badgeSize = Math.round(44 * sf);
            const badgeOffset = Math.round(20 * sf);
            const pad = Math.round(4 * sf);
            const frontClone = container._frontLayer?.get_children()?.[0];
            const frontX = frontClone ? frontClone.x : 0;
            const frontY = frontClone ? frontClone.y : 0;
            const frontH = frontClone ? frontClone.height : th;
            const badgeY = Math.round(frontY + frontH - badgeSize + 6 * sf);

            for (let idx = 0; idx < apps.length; idx++) {
                const app = apps[idx];
                const icon = app.create_icon_texture(badgeSize);
                if (icon) {
                    icon.add_style_class_name('stage-app-icon-badge');
                    icon.set_position(frontX + pad + idx * badgeOffset, badgeY);
                    container.add_child(icon);
                }
            }
        }

        return container;
    }

    _addIconFallback(layer, win, tw, th) {
        const tracker = Shell.WindowTracker.get_default();
        const app = tracker.get_window_app(win);
        if (app) {
            const sf = this._scaleFactor;
            const iconPx = 48 * sf;
            const icon = app.create_icon_texture(48);
            icon.set_position((tw - iconPx) / 2, (th - iconPx) / 2);
            layer.add_child(icon);
        }
    }

    _makeWorkspaceCard(ws, wins, wsIndex, isCurrent) {
        const card = this._wrapCard();
        const tracker = Shell.WindowTracker.get_default();
        const apps = [...new Set(wins.map(w => tracker.get_window_app(w)).filter(Boolean))];
        const thumb = this._makeStackedThumb(wins, apps);
        card.add_child(thumb);
        card._thumb = thumb;

        const wsName = isCurrent
            ? _('Workspace %d (current)').replace('%d', `${wsIndex + 1}`)
            : _('Workspace %d').replace('%d', `${wsIndex + 1}`);
        card.add_child(new St.Label({
            text: wsName,
            x_align: Clutter.ActorAlign.CENTER,
            style_class: this._cls(isCurrent ? 'stage-ws-label-current' : 'stage-ws-label'),
        }));
        if (wins.length > 0) {
            card.add_child(new St.Label({
                text: ngettext('%d window', '%d windows', wins.length)
                    .replace('%d', `${wins.length}`),
                x_align: Clutter.ActorAlign.CENTER,
                style_class: this._cls('stage-ws-meta'),
            }));
        }

        card.set_pivot_point(0.5, 0.5);
        this._applyPerspective(card, 1.0);
        const idx = this._cards.length;
        this._wireCardEvents(card, thumb, wins, idx);
        this._cardSig(card, 'button-release-event', () => {
            this._destroyPreview();
            if (!isCurrent) ws.activate(global.get_current_time());
            if (this._settings.get_boolean('sidebar-auto-hide')) this._scheduleHide();
            this._scheduleRefresh();
            return Clutter.EVENT_STOP;
        });
        return card;
    }





    _resetAllCardScales() {
        const base = this._BASE_SCALE;
        for (const card of this._cards) {
            card.ease({
                scale_x: base, scale_y: base,
                opacity: CARD_REST_OPACITY,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _applyBellCurve(_hoveredIdx) {
        // Bell-curve across cards disabled; individual card scaling used instead
    }

    _wireCardEvents(card, thumb, windows, cardIdx) {
        this._cardSig(card, 'scroll-event', (_actor, event) => this._onScrollEvent(event));

        this._cardSig(card, 'enter-event', () => {
            this._hovered = true;
            this._killHideTimer();
            this._hoveredIdx = cardIdx;

            const base = this._BASE_SCALE;
            card.ease({
                scale_x: base * 1.05,
                scale_y: base * 1.05,
                opacity: CARD_HOVER_OPACITY,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            const front = thumb._frontLayer;
            if (front)
                front.set_style_class_name(this._cls('stage-thumb-layer-front-hover'));
            card.set_style_class_name(this._cls('stage-card', 'stage-card-hover'));
        });

        this._cardSig(card, 'leave-event', (_actor, event) => {
            this._hoveredIdx = -1;
            const base = this._BASE_SCALE;
            card.ease({
                scale_x: base,
                scale_y: base,
                opacity: CARD_REST_OPACITY,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            const front = thumb._frontLayer;
            if (front)
                front.set_style_class_name(this._cls('stage-thumb-layer'));
            card.set_style_class_name(this._cls('stage-card'));

            this._killHoverTimer();
            this._destroyPreview();

            if (!this._insidePanel(this._crossingRelated(event))) {
                this._hovered = false;
                if (this._settings.get_boolean('sidebar-auto-hide'))
                    this._scheduleHide();
            }
        });
    }





    _showPreview(_card, _windows) {
        this._destroyPreview();
    }

    _showIconPreview(_windows, _cardX, _cardY) {
        this._destroyPreview();
    }

    _destroyPreview() {
        if (this._preview) {
            _nullCloneSources(this._preview);
            Main.layoutManager.removeChrome(this._preview);
            this._preview.destroy();
            this._preview = null;
        }
    }





    _untrackTimer(id) {
        const i = this._timers.indexOf(id);
        if (i >= 0) this._timers.splice(i, 1);
    }

    _killRefreshTimer() {
        if (this._refreshTimer) { GLib.source_remove(this._refreshTimer); this._untrackTimer(this._refreshTimer); this._refreshTimer = null; }
    }

    _killHideTimer() {
        if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._untrackTimer(this._hideTimer); this._hideTimer = null; }
    }

    _killHoverTimer() {
        if (this._hoverTimer) { GLib.source_remove(this._hoverTimer); this._untrackTimer(this._hoverTimer); this._hoverTimer = null; }
    }

    _killSwapTimer() {
        if (this._swapTimer) { GLib.source_remove(this._swapTimer); this._untrackTimer(this._swapTimer); this._swapTimer = null; }
    }

    _killEdgeTimer() {
        if (this._edgeTimer) { GLib.source_remove(this._edgeTimer); this._untrackTimer(this._edgeTimer); this._edgeTimer = null; }
    }








    _wsHasVisibleWindows() {
        const ws = this._activeWs();
        if (!ws) return false;
        return ws.list_windows().some(w => _isNormal(w) && !w.minimized);
    }









    _shouldForceShow() {
        return this._settings.get_boolean('show-on-empty-workspace') &&
            !this._wsHasVisibleWindows();
    }






    _syncForceShow() {
        if (this._fullscreen()) return;

        if (this._shouldForceShow()) {

            this._killHideTimer();
            if (!this._visible) this._show();
        } else if (this._settings.get_boolean('sidebar-auto-hide') &&
            this._visible && !this._hovered) {

            this._scheduleHide();
        }
    }
}






const ARC_BASE_GRID_W    = 158;
const ARC_BASE_GRID_H    = 89;
const ARC_BASE_ICON_SIZE = 42;
const ARC_ICON_OVL       = 20;
const ARC_PAD_H          = 12;
const ARC_MAX_ANGLE      = 52;
const ARC_SCROLL_FRICTION = 0.82;
const ARC_SCROLL_MIN_VEL  = 0.005;
const ARC_DRAG_THRESHOLD  = 18;
const ARC_GHOST_SIZE      = 100;
const ARC_RADIUS_RATIO   = 0.48;
const ARC_MIN_RADIUS     = 200;

const ARC_KEYBINDINGS = [
    'toggle-sidebar',
    'keybinding-arc-next',
    'keybinding-arc-prev',
    'keybinding-arc-activate',
    'keybinding-arc-close',
];

class ArcSidebar {
    constructor(settings) {
        this._settings = settings;
        this._sigSources = new Set();
        this._cardSigSources = new Set();

        this._monitor = null;
        this._isVisible = false;
        this._persistMode = false;
        this._persistEnabled = false;
        this._scaleFactor = 1;

        this._timers = [];
        this._hideTimer = null;
        this._physicsTimer = null;
        this._persistTimer = null;
        this._scrollTimer = null;
        this._refreshTimer = null;
        this._dragPollTimer = null;
        this._edgeTimer = null;

        this._groups = [];
        this._offset = 0;
        this._velocity = 0;
        this._containers = [];
        this._drag = null;
        this._dragGhost = null;

        this._mergeMap = new Map();
        this._orderMap = new Map();
        this._groupStates = new Map();

        this._panel = null;
        this._edge = null;
        this._geo = null;

        this._boundKeys = [];
    }

    enable() {
        this._scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        this._monitor = this._pickMonitor();
        this._loadMergeMap();
        this._loadOrderMap();
        this._loadConfig();
        this._buildUI();
        this._addKeybindings();

        this._sig(global.display, 'notify::focus-window', () => {
            this._trackFocus();
            this._scheduleRefresh();
        });
        this._sig(Main.layoutManager, 'monitors-changed', () => this._rebuild());
        this._sig(Main.overview, 'showing', () => {
            if (this._panel) this._panel.hide();
            if (this._edge) this._edge.hide();
        });
        this._sig(Main.overview, 'shown', () => {
            if (this._panel) this._panel.hide();
            if (this._edge) this._edge.hide();
        });
        this._sig(Main.overview, 'hidden', () => {
            if (this._panel) this._panel.show();
            if (this._edge) this._edge.show();
        });
        this._sig(this._settings, 'changed', (_s, key) => {
            if (key === 'arc-order-map') { this._loadOrderMap(); this._scheduleRefresh(); }
            else if (key === 'arc-merge-map') { this._loadMergeMap(); this._scheduleRefresh(); }
            else if (key === 'arc-persistent-mode') {
                this._persistEnabled = this._settings.get_boolean('arc-persistent-mode');
                if (this._persistEnabled) this._armPersistTimer();
                else { this._killPersistTimer(); this._persistMode = false; }
            }
            else if (ARC_KEYBINDINGS.includes(key)) { this._removeKeybindings(); this._addKeybindings(); }
            else this._rebuild();
        });

        this._scheduleRefresh();
        if (this._settings.get_boolean('arc-persistent-mode')) this._armPersistTimer();
    }

    disable() {
        this._cancelDrag();
        this._removeKeybindings();
        this._killHideTimer();
        this._killPhysicsTimer();
        this._killScrollTimer();
        this._killPersistTimer();
        this._killRefreshTimer();
        this._killEdgeTimer();
        this._killCardTimers();

        this._timers.splice(0).forEach(id => GLib.source_remove(id));

        this._sigSources.forEach(o => o.disconnectObject(this));
        this._sigSources.clear();
        this._disconnectCardSigs();

        this._destroyUI();
        this._settings = null;
    }



    _sig(obj, signal, cb) {
        obj.connectObject(signal, cb, this);
        this._sigSources.add(obj);
    }

    _cardSig(obj, signal, cb) {
        obj.connectObject(signal, cb, this);
        this._cardSigSources.add(obj);
    }

    _disconnectCardSigs() {
        this._cardSigSources.forEach(o => o.disconnectObject(this));
        this._cardSigSources.clear();
    }

    _untrackTimer(id) {
        const i = this._timers.indexOf(id);
        if (i >= 0) this._timers.splice(i, 1);
    }

    _killHideTimer() { if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._untrackTimer(this._hideTimer); this._hideTimer = null; } }
    _killPhysicsTimer() { if (this._physicsTimer) { GLib.source_remove(this._physicsTimer); this._untrackTimer(this._physicsTimer); this._physicsTimer = null; } }
    _killScrollTimer() { if (this._scrollTimer) { GLib.source_remove(this._scrollTimer); this._untrackTimer(this._scrollTimer); this._scrollTimer = null; } }
    _killPersistTimer() { if (this._persistTimer) { GLib.source_remove(this._persistTimer); this._untrackTimer(this._persistTimer); this._persistTimer = null; } }
    _killRefreshTimer() { if (this._refreshTimer) { GLib.source_remove(this._refreshTimer); this._untrackTimer(this._refreshTimer); this._refreshTimer = null; } }
    _killDragPollTimer() { if (this._dragPollTimer) { GLib.source_remove(this._dragPollTimer); this._untrackTimer(this._dragPollTimer); this._dragPollTimer = null; } }
    _killEdgeTimer() { if (this._edgeTimer) { GLib.source_remove(this._edgeTimer); this._untrackTimer(this._edgeTimer); this._edgeTimer = null; } }

    _killCardTimers() {
        this._containers.forEach(c => this._killGridTimers(c._grid));
    }



    _killGridTimers(g) {
        if (!g) return;
        if (g._fanTimer) { GLib.source_remove(g._fanTimer); this._untrackTimer(g._fanTimer); g._fanTimer = null; }
        if (g._closeTimer) { GLib.source_remove(g._closeTimer); this._untrackTimer(g._closeTimer); g._closeTimer = null; }
    }

    _armPersistTimer() {
        this._killPersistTimer();
        this._persistTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._checkPersistence();
            return GLib.SOURCE_CONTINUE;
        });
        this._timers.push(this._persistTimer);
    }



    _pickMonitor() { return _getMon(); }

    _loadMergeMap() {
        const raw = this._settings.get_string('arc-merge-map');
        try {
            this._mergeMap = new Map(Object.entries(JSON.parse(raw)));
        } catch (_) {
            this._mergeMap = new Map();
        }



        for (const [aId, gKey] of [...this._mergeMap]) {
            if (aId.includes('|')) this._mergeMap.delete(aId);
            else this._mergeMap.set(aId, [...new Set(gKey.split('|'))].sort().join('|'));
        }
    }

    _saveMergeMap() {
        this._settings.set_string('arc-merge-map', JSON.stringify(Object.fromEntries(this._mergeMap)));
    }

    _loadOrderMap() {
        const raw = this._settings.get_string('arc-order-map');
        try {
            this._orderMap = new Map(Object.entries(JSON.parse(raw)).map(([k, v]) => [k, Number(v)]));
        } catch (_) {
            this._orderMap = new Map();
        }
    }

    _saveOrderMap() {
        this._settings.set_string('arc-order-map', JSON.stringify(Object.fromEntries(this._orderMap)));
    }

    _mergeApps(sourceAppId, targetAppId) {
        const targetKey = this._mergeMap.get(targetAppId) ?? targetAppId;


        const members = new Set([targetAppId, sourceAppId]);
        this._mergeMap.forEach((gKey, aId) => { if (gKey === targetKey) members.add(aId); });
        const newKey = [...members].sort().join('|');
        members.forEach(aId => this._mergeMap.set(aId, newKey));
        this._saveMergeMap();
    }

    _unmergeApp(appId) {
        this._mergeMap.delete(appId);
        const counts = new Map();
        this._mergeMap.forEach(gKey => counts.set(gKey, (counts.get(gKey) ?? 0) + 1));
        const toDelete = [];
        this._mergeMap.forEach((gKey, aId) => { if ((counts.get(gKey) ?? 0) <= 1) toDelete.push(aId); });
        toDelete.forEach(aId => this._mergeMap.delete(aId));
        this._saveMergeMap();
    }

    _buildGroups() {
        const workspace = global.workspace_manager.get_active_workspace();
        const tracker   = Shell.WindowTracker.get_default();
        const byApp     = new Map();

        workspace.list_windows().forEach(win => {
            if (!_isNormal(win)) return;
            const app = tracker.get_window_app(win);
            if (!app) return;
            const id = app.get_id();
            if (!byApp.has(id)) byApp.set(id, { app, windows: [] });
            byApp.get(id).windows.push(win);
        });

        const byGroup = new Map();
        byApp.forEach(({ app, windows }, appId) => {
            const groupKey = this._mergeMap.get(appId) ?? appId;
            if (!byGroup.has(groupKey)) byGroup.set(groupKey, { appIds: [], apps: [], windows: [], key: groupKey });
            const g = byGroup.get(groupKey);
            g.appIds.push(appId);
            g.apps.push(app);
            g.windows.push(...windows);
        });

        this._groups = [...byGroup.values()].map(g => {
            g.appIds.sort();
            g.app = g.apps[0];
            return g;
        });

        const liveAppIds = new Set(byApp.keys());
        this._groupStates.forEach((_, id) => { if (!liveAppIds.has(id)) this._groupStates.delete(id); });

        this._groups.sort((a, b) => {
            const oa = this._orderMap.has(a.key) ? this._orderMap.get(a.key) : Number.MAX_SAFE_INTEGER;
            const ob = this._orderMap.has(b.key) ? this._orderMap.get(b.key) : Number.MAX_SAFE_INTEGER;
            return oa - ob;
        });

        this._offset = Math.max(0, Math.min(this._offset, this._groups.length - 1));

        const focused = global.display.get_focus_window();
        if (focused) {
            this._groups.forEach(g => {
                const fi = g.windows.indexOf(focused);
                if (fi > 0) {
                    g.windows.splice(fi, 1);
                    g.windows.unshift(focused);
                    const fApp = Shell.WindowTracker.get_default().get_window_app(focused);
                    if (fApp) g.app = fApp;
                }
            });
        }
    }

    _loadConfig() {
        const s   = this._settings;
        const pct = s.get_int('arc-card-scale') / 100;

        this._gW        = Math.round(ARC_BASE_GRID_W * pct * this._scaleFactor);
        this._gH        = Math.round(ARC_BASE_GRID_H * pct * this._scaleFactor);
        this._iS        = Math.round(ARC_BASE_ICON_SIZE * pct * this._scaleFactor);
        this._panelSize = Math.ceil(this._gW * 1.12 + ARC_PAD_H * this._scaleFactor * 2);
        this._cxOffset  = ARC_PAD_H * this._scaleFactor + this._gW / 2;
        this._angleStep = s.get_int('arc-angle-step');
        this._hideDelay = s.get_int('auto-hide-delay');
        this._scrollStep = this._mapSpeed(s.get_int('arc-scroll-speed'));
        this._pos       = s.get_string('arc-panel-position');
        this._persistEnabled = s.get_boolean('arc-persistent-mode');
        this._geo       = this._computeGeo();
    }

    _mapSpeed(val) {
        return 0.01 + (val - 1) * (0.15 - 0.01) / 19;
    }

    get _EDGE_W() { return this._settings.get_int('edge-trigger-width') * this._scaleFactor; }

    get _EDGE_DELAY_MS() { return this._settings.get_int('edge-trigger-delay'); }

    _computeGeo() {
        const mon = this._monitor;
        const PS  = this._panelSize;
        const CX  = this._cxOffset;
        const sf  = this._scaleFactor;

        const monIdx = Main.layoutManager.monitors.indexOf(mon);
        const wa = Main.layoutManager.getWorkAreaForMonitor(monIdx >= 0 ? monIdx : 0);

        const R_side   = Math.max(Math.round(ARC_MIN_RADIUS * sf), Math.round(wa.height * ARC_RADIUS_RATIO));
        const R_bottom = Math.max(Math.round(ARC_MIN_RADIUS * sf), Math.round(wa.width  * ARC_RADIUS_RATIO));

        const waCY = wa.y - mon.y + wa.height / 2;
        const waCX = wa.x - mon.x + wa.width  / 2;
        const hotLen = Math.round(Math.min(wa.height, wa.width) * 0.35);
        const latY = wa.y - mon.y;
        const latH = wa.height;

        switch (this._pos) {
            case 'right':
                return {
                    panelX: mon.x + mon.width,       panelY: mon.y + latY,
                    panelW: PS,                       panelH: latH,
                    visX:   mon.x + mon.width - PS,   visY:   mon.y + latY,
                    hidX:   mon.x + mon.width,        hidY:   mon.y + latY,
                    edgeX:  mon.x + mon.width - this._EDGE_W,
                    edgeY:  mon.y + waCY - hotLen / 2,
                    edgeW:  this._EDGE_W, edgeH: hotLen,
                    arcCX:  PS - CX + R_side,
                    arcCY:  waCY - latY,
                    centerAngle: 180,
                    arcR: R_side,
                };
            case 'bottom':
                return {
                    panelX: mon.x,      panelY: mon.y + mon.height,
                    panelW: mon.width,  panelH: PS,
                    visX:   mon.x,      visY:   mon.y + mon.height - PS,
                    hidX:   mon.x,      hidY:   mon.y + mon.height,
                    edgeX:  mon.x + waCX - hotLen / 2,
                    edgeY:  mon.y + mon.height - this._EDGE_W,
                    edgeW:  hotLen, edgeH: this._EDGE_W,
                    arcCX:  waCX,
                    arcCY:  PS - CX + R_bottom,
                    centerAngle: -90,
                    arcR: R_bottom,
                };
            default:
                return {
                    panelX: mon.x - PS, panelY: mon.y + latY,
                    panelW: PS,         panelH: latH,
                    visX:   mon.x,      visY:   mon.y + latY,
                    hidX:   mon.x - PS, hidY:   mon.y + latY,
                    edgeX:  mon.x,
                    edgeY:  mon.y + waCY - hotLen / 2,
                    edgeW:  this._EDGE_W, edgeH: hotLen,
                    arcCX:  CX - R_side,
                    arcCY:  waCY - latY,
                    centerAngle: 0,
                    arcR: R_side,
                };
        }
    }

    _buildGrid(group, gridW, gridH, scale) {
        const windows = group.windows.slice(0, 4);
        const r = Math.round(10 * scale);

        const grid = new St.Widget({
            reactive: false,
            width: gridW, height: gridH,
            clip_to_allocation: false,
            style: `border-radius: ${Math.round(14 * scale)}px;`,
        });
        grid._cards = [];
        grid._fanned = false;
        grid._fanTimer = null;
        grid._closeTimer = null;
        this._cardSig(grid, 'destroy', () => this._killGridTimers(grid));
        grid._gridW = gridW;
        grid._gridH = gridH;
        grid._scale = scale;

        windows.forEach((win, idx) => {
            const actor = win.get_compositor_private();
            const fr    = win.get_frame_rect();
            const winW  = fr.width  || gridW;
            const winH  = fr.height || gridH;
            const s     = Math.min(gridW / winW, gridH / winH);
            const cW    = Math.round(winW * s);
            const cH    = Math.round(winH * s);

            const card = new St.Widget({
                reactive: true, width: cW, height: cH,
                clip_to_allocation: true,
                style: `border-radius: ${r}px;`,
            });
            card.set_pivot_point(0.5, 0.5);

            if (actor)
                card.add_child(new Clutter.Clone({ source: actor, width: cW, height: cH }));
            else
                card.add_child(new St.Widget({ style: `background-color:#2a2a2a; border-radius:${r}px;`, width: cW, height: cH }));

            const dim = new St.Widget({
                reactive: false, width: cW, height: cH,
                style: 'background-color: rgba(0,0,0,0.45); border-radius: inherit;',
                opacity: 0,
            });

            this._cardSig(card, 'button-release-event', (_a, ev) => {
                if (ev.get_button() === 2) {
                    win.delete(global.get_current_time());
                    this._scheduleRefresh();
                    return Clutter.EVENT_STOP;
                }
                if (ev.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                if (idx > 0) { group.windows.splice(idx, 1); group.windows.unshift(win); }
                this._activateGroup(group, win);
                return Clutter.EVENT_STOP;
            });

            grid._cards.push({ card, dim, win, cW, cH });
        });

        [...grid._cards].reverse().forEach(({ card, dim }) => {
            grid.add_child(card);
            grid.add_child(dim);
        });

        this._positionStack(grid, false);
        return grid;
    }

    _positionStack(grid, animate = true) {
        const scale = grid._scale;
        const OFFSETS = [
            { dx: 0,                      dy: 0,                      rot:  0.0 },
            { dx: Math.round(10 * scale), dy: Math.round( 7 * scale), rot:  3.8 },
            { dx: Math.round(19 * scale), dy: Math.round(13 * scale), rot: -2.6 },
            { dx: Math.round(27 * scale), dy: Math.round(18 * scale), rot:  2.0 },
        ];
        grid._cards.forEach(({ card, dim, icon, iconBaseX, iconBaseY }, i) => {
            const off = OFFSETS[i] ?? OFFSETS[OFFSETS.length - 1];
            if (animate) {
                card.ease({
                    x: off.dx, y: off.dy, rotation_angle_z: off.rot, opacity: 255,
                    duration: 240, mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            } else {
                card.set_position(off.dx, off.dy);
                card.opacity = 255;
            }
            dim.set_position(off.dx, off.dy);
            if (icon && iconBaseX !== undefined) {
                if (animate) icon.ease({ x: iconBaseX, y: iconBaseY, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                else icon.set_position(iconBaseX, iconBaseY);
            }
        });
        grid._fanned = false;
    }

    _positionFan(grid) {
        const count = grid._cards.length;
        if (count <= 1) return { shift: 0, isBottom: this._pos === 'bottom' };
        const isBottom = this._pos === 'bottom';
        const step = isBottom ? Math.round(grid._gridW * 0.90) : Math.round(grid._gridH * 0.88);

        const padH = grid._padH ?? 0;
        const sz   = grid._iconSz ?? 0;
        const ovf  = grid._iconOvf ?? 0;

        grid._cards.forEach(({ card, dim, icon, cW, cH }, i) => {
            const dx = isBottom ? i * step : 0;
            const dy = isBottom ? 0 : i * step;
            card.ease({
                x: dx, y: dy, rotation_angle_z: 0, opacity: 255,
                duration: 280, mode: Clutter.AnimationMode.EASE_OUT_BACK
            });
            dim.set_position(dx, dy);
            if (icon && sz) {
                let ix, iy;
                if (isBottom) { ix = padH + dx - ovf; iy = dy - ovf; }
                else if (this._pos === 'right') { ix = padH + dx + cW - sz + ovf; iy = dy + cH - sz + ovf; }
                else { ix = padH + dx - ovf; iy = dy + cH - sz + ovf; }
                icon.ease({ x: ix, y: iy, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_BACK });
            }
        });
        grid._fanned = true;
        return { shift: (count - 1) * step, isBottom };
    }

    _buildIconRow(container, group, gridW, iconSize, iconOvl, padH, scale, grid) {
        const tracker = Shell.WindowTracker.get_default();
        const sz  = Math.round(iconSize * 0.92);
        const ovf = Math.round(sz * 0.28);
        const dX  = Math.round(sz * 0.72);
        const dY  = Math.round(sz * 0.14);

        grid._padH = padH;
        grid._iconSz = sz;
        grid._iconOvf = ovf;

        grid._cards.forEach(({ win, cW, cH }, i) => {
            const app = tracker.get_window_app(win);
            if (!app) return;



            let bx, by;
            if (this._pos === 'right') { bx = padH + cW - sz + ovf - i * dX; by = cH - sz + ovf - i * dY; }
            else if (this._pos === 'bottom') { bx = padH - ovf + i * dX; by = -ovf + i * dY; }
            else { bx = padH - ovf + i * dX; by = cH - sz + ovf - i * dY; }

            const icon = new St.Widget({ width: sz, height: sz, reactive: true });
            icon.add_child(app.create_icon_texture(sz));
            icon.set_position(bx, by);
            container.add_child(icon);

            this._cardSig(icon, 'button-release-event', (_a, ev) => {
                if (ev.get_button() === 2) {
                    win.delete(global.get_current_time());
                    this._scheduleRefresh();
                    return Clutter.EVENT_STOP;
                }
                if (ev.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                if (i > 0) { group.windows.splice(i, 1); group.windows.unshift(win); }
                this._activateGroup(group, win);
                return Clutter.EVENT_STOP;
            });

            grid._cards[i].icon = icon;
            grid._cards[i].iconBaseX = bx;
            grid._cards[i].iconBaseY = by;
        });
    }

    _buildUI() {
        const geo = this._geo;



        this._panel = new St.Widget({
            reactive: true, clip_to_allocation: false,
            width: geo.panelW, height: geo.panelH,
        });
        this._panel.set_position(geo.panelX, geo.panelY);
        Main.layoutManager.addChrome(this._panel, { trackFullscreen: true });

        this._edge = new St.Widget({ reactive: true, width: geo.edgeW, height: geo.edgeH });
        this._edge.set_position(geo.edgeX, geo.edgeY);
        Main.layoutManager.addChrome(this._edge, { trackFullscreen: false });


        this._sig(this._edge, 'enter-event', () => {
            if (this._isVisible) return;
            const delay = this._EDGE_DELAY_MS;
            if (delay <= 0) {
                this._showPanel();
                return;
            }
            this._killEdgeTimer();
            this._edgeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._untrackTimer(this._edgeTimer); this._edgeTimer = null;
                if (!this._isVisible) this._showPanel();
                return GLib.SOURCE_REMOVE;
            });
            this._timers.push(this._edgeTimer);
        });
        this._sig(this._edge, 'leave-event', () => this._killEdgeTimer());
        this._sig(this._panel, 'enter-event', () => { if (!this._drag) this._cancelHide(); });
        this._sig(this._panel, 'leave-event', () => { if (this._isVisible && !this._drag) this._startHide(); });
        this._sig(this._panel, 'scroll-event', (_a, event) => { this._handleScroll(event); return Clutter.EVENT_STOP; });
    }

    _destroyUI() {
        this._cancelHide();
        this._containers.forEach(c => c.destroy());
        this._containers = [];
        if (this._edge)  { this._edge.destroy();  this._edge = null; }
        if (this._panel) { this._panel.destroy(); this._panel = null; }
    }

    _rebuild() {
        const wasVisible = this._isVisible;
        this._isVisible = false;
        this._monitor = this._pickMonitor();
        this._destroyUI();
        this._loadConfig();
        this._buildUI();
        if (wasVisible) this._showPanel();
        else this._scheduleRefresh();
    }

    _scheduleRefresh() {
        this._killRefreshTimer();
        this._refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._untrackTimer(this._refreshTimer); this._refreshTimer = null;
            this._buildGroups();
            this._redraw();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(this._refreshTimer);
    }

    _trackFocus() {
        const focused = global.display.get_focus_window();
        if (!focused) return;
        const app = Shell.WindowTracker.get_default().get_window_app(focused);
        if (!app) return;
        const id = app.get_id();
        if (!this._groupStates.has(id)) this._groupStates.set(id, { savedLayout: new Map(), lastFocused: focused });
        else this._groupStates.get(id).lastFocused = focused;
    }

    _redraw() {
        if (!this._panel) return;

        this._killCardTimers();
        this._disconnectCardSigs();
        this._containers.forEach(c => c.destroy());
        this._containers = [];
        if (this._groups.length === 0) return;

        const geo = this._geo;

        this._groups.forEach((group, idx) => {
            const relIdx = idx - this._offset;
            if (Math.abs(relIdx * this._angleStep) > ARC_MAX_ANGLE + this._angleStep) return;

            const angleDeg = geo.centerAngle + relIdx * this._angleStep;
            const angleRad = angleDeg * Math.PI / 180;
            const itemCX = geo.arcCX + geo.arcR * Math.cos(angleRad);
            const itemCY = geo.arcCY + geo.arcR * Math.sin(angleRad);

            const dist  = Math.abs(relIdx);
            const scale = Math.pow(0.78, dist);

            const sW = Math.round(this._gW * scale);
            const sH = Math.round(this._gH * scale);
            const sI = Math.round(this._iS * scale);
            const sOvl = Math.round(ARC_ICON_OVL * this._scaleFactor * scale);
            const sP = Math.round(ARC_PAD_H * this._scaleFactor * scale);
            const totH = sH + sI - sOvl;

            const baseX = Math.round(itemCX - sW / 2 - sP);
            const baseY = Math.round(itemCY - totH / 2);

            const container = new St.Widget({
                reactive: true, track_hover: true,
                width: sW + sP * 2, height: totH,
            });
            container.set_pivot_point(0.5, 0.5);
            container.set_position(baseX, baseY);
            container._baseX = baseX;
            container._baseY = baseY;
            container._groupRef = group;

            const grid = this._buildGrid(group, sW, sH, scale);
            grid.set_position(sP, 0);
            container.add_child(grid);
            container._grid = grid;

            this._buildIconRow(container, group, sW, sI, sOvl, sP, scale, grid);

            this._cardSig(container, 'notify::hover', () => this._onCardHover(container));
            this._cardSig(container, 'button-press-event', (_a, event) => this._onCardPress(container, group, event));
            this._cardSig(container, 'button-release-event', (_a, event) => this._onCardRelease(container, group, idx, event));

            this._containers.push(container);
            this._panel.add_child(container);
        });
    }

    _onCardHover(container) {
        if (container.hover) {
            this._containers.forEach(c => {
                const isThis = c === container;
                c.ease({
                    scale_x: isThis ? 1.08 : 0.95, scale_y: isThis ? 1.08 : 0.95,
                    duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            });
            this._panel.set_child_above_sibling(container, null);
            const g = container._grid;
            if (g && !g._fanned && !g._fanTimer) {
                g._fanTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                    this._untrackTimer(g._fanTimer); g._fanTimer = null;
                    if (container.hover) {
                        const { shift, isBottom } = this._positionFan(g);
                        this._pushSiblings(container, shift, isBottom);
                    }
                    return GLib.SOURCE_REMOVE;
                });
                this._timers.push(g._fanTimer);
            }
        } else {
            const g = container._grid;
            this._killGridTimers(g);
            if (g?._fanned) {
                if (g._closeTimer) { GLib.source_remove(g._closeTimer); this._untrackTimer(g._closeTimer); g._closeTimer = null; }
                g._closeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 470, () => {
                    this._untrackTimer(g._closeTimer); g._closeTimer = null;
                    if (!container.hover) {
                        this._positionStack(g);
                        this._pushSiblings(container, 0, this._pos === 'bottom');
                    }
                    return GLib.SOURCE_REMOVE;
                });
                this._timers.push(g._closeTimer);
            }
        }
    }



    _pushSiblings(container, shift, isBottom) {
        const idx = this._containers.indexOf(container);
        this._containers.forEach((c, i) => {
            if (c === container || i <= idx) return;
            c.ease({
                x: c._baseX + (isBottom ? shift : 0),
                y: c._baseY + (isBottom ? 0 : shift),
                duration: 240, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }

    _activateGroup(group, focusWin = null) {
        const tracker = Shell.WindowTracker.get_default();
        const focused = global.display.get_focus_window();
        if (focused) {
            const app = tracker.get_window_app(focused);
            if (app) {
                const fid = app.get_id();
                if (!this._groupStates.has(fid)) this._groupStates.set(fid, { savedLayout: new Map(), lastFocused: focused });
                const state = this._groupStates.get(fid);
                state.savedLayout.clear();
                global.workspace_manager.get_active_workspace().list_windows().forEach(win => {
                    const wa = tracker.get_window_app(win);
                    if (wa && wa.get_id() === fid) state.savedLayout.set(win, win.get_frame_rect());
                });
            }
        }

        global.workspace_manager.get_active_workspace().list_windows().forEach(win => {
            if (_isNormal(win) && !group.windows.includes(win) && !win.minimized) win.minimize();
        });

        group.windows.forEach(win => {
            if (win.minimized) win.unminimize();
            const app = tracker.get_window_app(win);
            if (app) {
                const state = this._groupStates.get(app.get_id());
                if (state?.savedLayout.has(win)) {
                    const rect = state.savedLayout.get(win);
                    win.move_resize_frame?.(true, rect.x, rect.y, rect.width, rect.height);
                }
            }
        });

        let target = focusWin ?? null;
        if (!target) group.appIds.forEach(id => { if (!target) target = this._groupStates.get(id)?.lastFocused; });
        (target ?? group.windows[0])?.activate(global.get_current_time());

        this._hidePanel();
    }

    _onCardPress(container, group, event) {
        if (event.get_button() === 3 && group.appIds.length > 1) {
            group.appIds.forEach(id => this._unmergeApp(id));
            this._scheduleRefresh();
            return Clutter.EVENT_STOP;
        }
        if (event.get_button() === 1) {
            this._cancelDrag();
            const [px, py] = global.get_pointer();
            this._drag = { group, card: container, startX: px, startY: py, moved: false };
            this._sig(global.stage, 'motion-event', (_a, ev) => this._onDragMotion(ev));
            this._armDragPollTimer();
        }
        return Clutter.EVENT_PROPAGATE;
    }



    _armDragPollTimer() {
        this._killDragPollTimer();
        this._dragPollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (!this._drag) { this._untrackTimer(this._dragPollTimer); this._dragPollTimer = null; return GLib.SOURCE_REMOVE; }
            const [px, py, mask] = global.get_pointer();
            if (mask & Clutter.ModifierType.BUTTON1_MASK) return GLib.SOURCE_CONTINUE;

            this._dragPollTimer = null;
            const drag = this._drag;
            this._cancelDrag();
            if (drag.moved) this._commitDrag(drag.group, px, py);
            else this._activateGroup(drag.group);
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(this._dragPollTimer);
    }

    _onDragMotion(event) {
        if (!this._drag) return Clutter.EVENT_PROPAGATE;
        const [px, py] = event.get_coords();
        const dx = px - this._drag.startX;
        const dy = py - this._drag.startY;
        if (!this._drag.moved && Math.hypot(dx, dy) > ARC_DRAG_THRESHOLD * this._scaleFactor) {
            this._drag.moved = true;
            this._startDragGhost(this._drag.group);
        }
        if (this._drag.moved) this._updateDragGhost(px, py);
        return Clutter.EVENT_PROPAGATE;
    }

    _onCardRelease(_container, group, idx, event) {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        const drag = this._drag;
        if (!drag) return Clutter.EVENT_PROPAGATE;
        const [px, py] = global.get_pointer();
        this._cancelDrag();

        if (!drag.moved) {
            if (idx !== Math.round(this._offset)) this._scrollTo(idx, () => this._activateGroup(group));
            else this._activateGroup(group);
            return Clutter.EVENT_STOP;
        }

        this._commitDrag(drag.group, px, py);
        return Clutter.EVENT_STOP;
    }

    _commitDrag(group, px, py) {
        const geo = this._geo;
        const inside = px >= geo.visX && px <= geo.visX + geo.panelW &&
                       py >= geo.visY && py <= geo.visY + geo.panelH;
        if (inside) this._reorderGroup(group, px, py);
        else this._mergeIntoActive(group);
    }

    _mergeIntoActive(sourceGroup) {
        const focused = global.display.get_focus_window();
        const activeApp = focused ? Shell.WindowTracker.get_default().get_window_app(focused) : null;
        const sourceAppId = sourceGroup.app.get_id ? sourceGroup.app.get_id() : sourceGroup.appIds[0];
        const activeAppId = activeApp?.get_id();



        if (!activeApp || activeAppId === sourceAppId) {
            this._activateGroup(sourceGroup);
            return;
        }

        this._mergeApps(sourceAppId, activeAppId);
        sourceGroup.windows.forEach(win => { if (win.minimized) win.unminimize(); win.raise?.(); });
        this._hidePanel();
        this._scheduleRefresh();
    }

    _reorderGroup(group, px, py) {
        if (this._groups.length < 2 || this._containers.length < 2) return;
        const sourceIdx = this._groups.indexOf(group);
        if (sourceIdx === -1) return;

        let targetIdx = sourceIdx;
        let minDist = Infinity;
        this._containers.forEach((c, i) => {
            const cx = c.x + c.width / 2;
            const cy = c.y + c.height / 2;
            const dist = this._pos === 'bottom' ? Math.abs(px - cx) : Math.abs(py - cy);
            if (dist < minDist) { minDist = dist; targetIdx = i; }
        });
        if (targetIdx === sourceIdx) return;

        const ordered = [...this._groups];
        const [moved] = ordered.splice(sourceIdx, 1);
        ordered.splice(targetIdx, 0, moved);
        this._orderMap.clear();
        ordered.forEach((g, i) => this._orderMap.set(g.key, i));
        this._saveOrderMap();
        this._scheduleRefresh();
    }

    _startDragGhost(group) {
        const size = Math.round(ARC_GHOST_SIZE * this._scaleFactor);
        const ghost = new St.Widget({
            width: size, height: size, opacity: 220,
            style: 'background-color: rgba(30,30,30,0.88); border-radius: 18px; border: 2px solid rgba(255,255,255,0.28);',
        });
        ghost.set_pivot_point(0.5, 0.5);
        const iconSize = Math.round(48 * this._scaleFactor);
        const icon = new St.Widget({ width: iconSize, height: iconSize });
        icon.add_child(group.app.create_icon_texture(iconSize));
        icon.set_position(size / 2 - iconSize / 2, size / 2 - iconSize / 2);
        ghost.add_child(icon);
        Main.uiGroup.add_child(ghost);
        this._dragGhost = ghost;
    }

    _updateDragGhost(px, py) {
        if (!this._dragGhost) return;
        const size = Math.round(ARC_GHOST_SIZE * this._scaleFactor);
        this._dragGhost.set_position(px - size / 2, py - size / 2);
    }

    _killDragGhost() { if (this._dragGhost) { this._dragGhost.destroy(); this._dragGhost = null; } }

    _cancelDrag() {
        this._killDragPollTimer();
        this._killDragGhost();


        this._drag = null;
        global.stage.disconnectObject(this);
    }

    _handleScroll(event) {
        const dir = event.get_scroll_direction();
        const isBottom = this._pos === 'bottom';
        if (dir === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            const delta = isBottom ? dx : dy;
            if (Math.abs(delta) > 0.01) { this._velocity += delta * this._scrollStep; this._startPhysics(); }
        } else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT) {
            this._velocity += this._scrollStep; this._startPhysics();
        } else if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT) {
            this._velocity -= this._scrollStep; this._startPhysics();
        }
    }

    _startPhysics() {
        this._killScrollTimer();


        if (this._physicsTimer) { GLib.source_remove(this._physicsTimer); this._untrackTimer(this._physicsTimer); this._physicsTimer = null; }
        this._physicsTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            this._offset += this._velocity;
            this._velocity *= ARC_SCROLL_FRICTION;
            const max = Math.max(0, this._groups.length - 1);
            if (this._offset < 0) { this._offset = 0; this._velocity = 0; }
            if (this._offset > max) { this._offset = max; this._velocity = 0; }
            this._redraw();
            if (Math.abs(this._velocity) < ARC_SCROLL_MIN_VEL) {
                this._velocity = 0;
                this._untrackTimer(this._physicsTimer); this._physicsTimer = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._timers.push(this._physicsTimer);
    }

    _scrollTo(targetIdx, onComplete) {
        this._velocity = 0;
        targetIdx = Math.max(0, Math.min(targetIdx, this._groups.length - 1));
        const start = this._offset;
        const frames = Math.max(8, Math.round(Math.abs(targetIdx - start) * 12));
        let frame = 0;
        this._killPhysicsTimer();


        if (this._scrollTimer) { GLib.source_remove(this._scrollTimer); this._untrackTimer(this._scrollTimer); this._scrollTimer = null; }
        this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            frame++;
            this._offset = start + (targetIdx - start) * (1 - Math.pow(1 - frame / frames, 3));
            this._redraw();
            if (frame >= frames) {
                this._offset = targetIdx;
                this._untrackTimer(this._scrollTimer); this._scrollTimer = null;
                this._redraw();
                onComplete?.();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._timers.push(this._scrollTimer);
    }

    _showPanel() {
        if (this._isVisible || !this._panel) return;
        this._isVisible = true;
        this._cancelHide();
        this._scheduleRefresh();
        const geo = this._geo;
        this._panel.ease({ x: geo.visX, y: geo.visY, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

    _hidePanel() {
        if (!this._isVisible || !this._panel) return;
        this._isVisible = false;
        this._cancelHide();
        const geo = this._geo;
        this._panel.ease({ x: geo.hidX, y: geo.hidY, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
    }

    _startHide() {
        if (this._persistMode) return;
        this._cancelHide();
        this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._hideDelay, () => {
            this._hidePanel();
            this._untrackTimer(this._hideTimer); this._hideTimer = null;
            return GLib.SOURCE_REMOVE;
        });
        this._timers.push(this._hideTimer);
    }

    _cancelHide() { this._killHideTimer(); }

    _checkPersistence() {
        if (!this._persistEnabled) {
            if (this._persistMode) { this._persistMode = false; this._hidePanel(); }
            return;
        }
        const ws = global.workspace_manager.get_active_workspace();
        const geo = this._geo;
        const px1 = geo.visX, py1 = geo.visY, px2 = geo.visX + geo.panelW, py2 = geo.visY + geo.panelH;
        const clear = !ws.list_windows().some(win => {
            if (win.minimized || !_isNormal(win)) return false;
            const r = win.get_frame_rect();
            return r.x < px2 && r.x + r.width > px1 && r.y < py2 && r.y + r.height > py1;
        });
        if (clear && !this._persistMode) { this._persistMode = true; if (!this._isVisible) this._showPanel(); }
        else if (!clear && this._persistMode) { this._persistMode = false; this._hidePanel(); }
    }

    _addKeybindings() {
        this._boundKeys = [];
        ARC_KEYBINDINGS.forEach(key => {
            const binding = this._settings.get_strv(key)[0];
            if (!binding || binding === '') return;
            Main.wm.addKeybinding(
                key, this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                this._keybindingCallback(key),
            );
            this._boundKeys.push(key);
        });
    }

    _keybindingCallback(key) {
        switch (key) {
            case 'toggle-sidebar': return () => this._toggleVisible();
            case 'keybinding-arc-next': return () => this._scrollTo(Math.round(this._offset) + 1);
            case 'keybinding-arc-prev': return () => this._scrollTo(Math.round(this._offset) - 1);
            case 'keybinding-arc-activate': return () => {
                const idx = Math.round(this._offset);
                if (this._groups[idx]) { if (!this._isVisible) this._showPanel(); this._activateGroup(this._groups[idx]); }
            };
            case 'keybinding-arc-close': return () => {
                const idx = Math.round(this._offset);
                const grp = this._groups[idx];
                if (grp?.windows[0]) {
                    grp.windows[0].delete(global.get_current_time());
                    this._scheduleRefresh();
                }
            };
        }
        return () => {};
    }

    _removeKeybindings() {
        this._boundKeys.forEach(key => Main.wm.removeKeybinding(key));
        this._boundKeys = [];
    }

    _toggleVisible() {
        if (this._isVisible) this._hidePanel();
        else this._showPanel();
    }
}




export default class StageManagerExtension extends Extension {
    enable() {
        this._sigSources = new Set();
        this._settings = this.getSettings();
        this._migrateMaximize();
        this._max = new MaximizeToWorkspace(this._settings);
        this._max.enable();
        this._buildActiveSidebar();
        this._sig(this._settings, 'changed::sidebar-layout', () => this._swapSidebar());
    }



    _migrateMaximize() {
        if (this._settings.get_boolean('maximize-migrated')) return;
        if (this._settings.get_boolean('enable-maximize-to-workspace'))
            this._settings.set_string('maximize-behavior', 'workspace');
        else if (this._settings.get_boolean('maximize-to-new-group'))
            this._settings.set_string('maximize-behavior', 'stage');
        this._settings.set_boolean('maximize-migrated', true);
    }

    _sig(obj, signal, cb) {
        obj.connectObject(signal, cb, this);
        this._sigSources.add(obj);
    }

    _buildActiveSidebar() {
        const arc = this._settings.get_string('sidebar-layout') === 'arc';
        this._side = arc ? new ArcSidebar(this._settings) : new StageSidebar(this._settings);
        this._side.enable();
    }

    _swapSidebar() {
        if (this._side) this._side.disable();
        this._buildActiveSidebar();
    }

    disable() {
        globalThis._stageManager = null;
        globalThis._stageManagerEnabled = false;

        if (this._side) this._side.disable();
        if (this._max) this._max.disable();
        this._side = null;
        this._max = null;
        this._sigSources.forEach(o => o.disconnectObject(this));
        this._sigSources.clear();
        this._settings = null;
    }
}
