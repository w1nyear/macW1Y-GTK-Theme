import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Signals from '../misc/signals.js';

import * as Background from './background.js';
import * as BackgroundMenu from './backgroundMenu.js';

import * as DND from './dnd.js';
import * as Main from './main.js';
import * as Params from '../misc/params.js';
import * as Ripples from './ripples.js';

import {logErrorUnlessCancelled} from '../misc/errorUtils.js';

export const STARTUP_ANIMATION_TIME = 500;
export const BACKGROUND_FADE_ANIMATION_TIME = 1000;

const HOT_CORNER_PRESSURE_THRESHOLD = 100;
const HOT_CORNER_PRESSURE_TIMEOUT = 1000;

const SCREEN_TRANSITION_DELAY = 250;
const SCREEN_TRANSITION_DURATION = 500;

function _safeSetStageBlack() {
    try {
        if (typeof Cogl !== 'undefined' && Cogl && Cogl.Color) {
            const c = new Cogl.Color({ red: 0, green: 0, blue: 0, alpha: 255 });
            global.stage.background_color = c;
        }
    } catch (_) {}
}

function isPopupMetaWindow(actor) {
    switch (actor.meta_window.get_window_type()) {
    case Meta.WindowType.DROPDOWN_MENU:
    case Meta.WindowType.POPUP_MENU:
    case Meta.WindowType.COMBO:
        return true;
    default:
        return false;
    }
}

export const MonitorConstraint = GObject.registerClass({
    Properties: {
        'primary': GObject.ParamSpec.boolean(
            'primary', null, null,
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
            false),
        'index': GObject.ParamSpec.int(
            'index', null, null,
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
            -1, 64, -1),
        'work-area': GObject.ParamSpec.boolean(
            'work-area', null, null,
            GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
            false),
    },
}, class MonitorConstraint extends Clutter.Constraint {
    _init(props) {
        this._primary = false;
        this._index = -1;
        this._workArea = false;

        super._init(props);
    }

    get primary() {
        return this._primary;
    }

    set primary(v) {
        if (v)
            this._index = -1;
        this._primary = v;
        if (this.actor)
            this.actor.queue_relayout();
        this.notify('primary');
    }

    get index() {
        return this._index;
    }

    set index(v) {
        this._primary = false;
        this._index = v;
        if (this.actor)
            this.actor.queue_relayout();
        this.notify('index');
    }

    get workArea() {
        return this._workArea;
    }

    set workArea(v) {
        if (v === this._workArea)
            return;
        this._workArea = v;
        if (this.actor)
            this.actor.queue_relayout();
        this.notify('work-area');
    }

    vfunc_set_actor(actor) {
        if (actor) {
            if (!this._monitorsChangedId) {
                this._monitorsChangedId =
                    Main.layoutManager.connect('monitors-changed', () => {
                        this.actor.queue_relayout();
                    });
            }

            if (!this._workareasChangedId) {
                this._workareasChangedId =
                    global.display.connect('workareas-changed', () => {
                        if (this._workArea)
                            this.actor.queue_relayout();
                    });
            }
        } else {
            if (this._monitorsChangedId)
                Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;

            if (this._workareasChangedId)
                global.display.disconnect(this._workareasChangedId);
            this._workareasChangedId = 0;
        }

        super.vfunc_set_actor(actor);
    }

    vfunc_update_allocation(actor, actorBox) {
        if (!this._primary && this._index < 0)
            return;

        if (!Main.layoutManager.primaryMonitor)
            return;

        let index;
        if (this._primary)
            index = Main.layoutManager.primaryIndex;
        else
            index = Math.min(this._index, Main.layoutManager.monitors.length - 1);

        let rect;
        if (this._workArea) {
            const workspaceManager = global.workspace_manager;
            const ws = workspaceManager.get_workspace_by_index(0);
            rect = ws.get_work_area_for_monitor(index);
        } else {
            rect = Main.layoutManager.monitors[index];
        }

        actorBox.init_rect(rect.x, rect.y, rect.width, rect.height);
    }
});

class Monitor {
    constructor(index, geometry, geometryScale) {
        this.index = index;
        this.x = geometry.x;
        this.y = geometry.y;
        this.width = geometry.width;
        this.height = geometry.height;
        this.geometry_scale = geometryScale;
    }

    get inFullscreen() {
        return global.display.get_monitor_in_fullscreen(this.index);
    }
}

const UiActor = GObject.registerClass(
class UiActor extends St.Widget {
    vfunc_get_preferred_width(_forHeight) {
        const width = global.stage.width;
        return [width, width];
    }

    vfunc_get_preferred_height(_forWidth) {
        const height = global.stage.height;
        return [height, height];
    }
});

const defaultParams = {
    trackFullscreen: false,
    affectsStruts: false,
};

export const LayoutManager = GObject.registerClass({
    Signals: {
        'hot-corners-changed': {},
        'startup-complete': {},
        'startup-prepared': {},
        'monitors-changed': {},
        'system-modal-opened': {},
    },
}, class LayoutManager extends GObject.Object {
    _init() {
        super._init();

        this._rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        this.monitors = [];
        this.primaryMonitor = null;
        this._primaryMonitorReadyResolver = null;
        this.primaryIndex = -1;
        this.hotCorners = [];

        this._keyboardIndex = -1;
        this._rightPanelBarrier = null;

        this._inOverview = false;
        this._updateRegionIdle = 0;

        this._trackedActors = [];
        this._topActors = [];
        this._isPopupWindowVisible = false;
        this._startingUp = true;
        this._isMacLayoutOverlay = true;
        this._startInOverview =
            Main.sessionMode.hasOverview &&
            global.settings.get_boolean('start-in-overview');


        this.uiGroup = new UiActor({name: 'uiGroup'});
        this.uiGroup.set_no_layout(true);


        _safeSetStageBlack();
        global.stage.add_child(this.uiGroup);

        global.stage.remove_child(global.window_group);
        this.uiGroup.add_child(global.window_group);
        global.connect('shutdown', () => {
            const monitorManager = global.backend.get_monitor_manager();
            monitorManager.disconnectObject(this);

            const adoptedUiGroupActors = [
                global.window_group,
                global.top_window_group,
                global.compositor.get_feedback_group(),
            ];

            for (const adoptedActor of adoptedUiGroupActors) {
                this.uiGroup.remove_child(adoptedActor);
                global.stage.add_child(adoptedActor);
            }

            this._destroyHotCorners();
            this._destroyPanelBarrier();
            this.uiGroup.destroy();
        });





        global.stage.remove_child(global.top_window_group);
        this.uiGroup.add_child(global.top_window_group);

        this.overviewGroup = new St.Widget({
            name: 'overviewGroup',
            visible: false,
            reactive: true,
            constraints: new Clutter.BindConstraint({
                source: this.uiGroup,
                coordinate: Clutter.BindCoordinate.ALL,
            }),
        });
        this.addChrome(this.overviewGroup);

        this.screenShieldGroup = new St.Widget({
            name: 'screenShieldGroup',
            visible: false,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
            constraints: new Clutter.BindConstraint({
                source: this.uiGroup,
                coordinate: Clutter.BindCoordinate.ALL,
            }),
        });
        this.addChrome(this.screenShieldGroup);

        this.panelBox = new St.BoxLayout({
            name: 'panelBox',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this.addChrome(this.panelBox, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this.panelBox.connect('notify::allocation',
            this._panelBoxChanged.bind(this));

        this.modalDialogGroup = new St.Widget({
            name: 'modalDialogGroup',
            layout_manager: new Clutter.BinLayout(),
        });
        this.uiGroup.add_child(this.modalDialogGroup);

        this.keyboardBox = new St.BoxLayout({
            name: 'keyboardBox',
            reactive: true,
            track_hover: true,
        });
        this.addTopChrome(this.keyboardBox);
        this._keyboardHeightNotifyId = 0;

        this.screenshotUIGroup = new St.Widget({
            name: 'screenshotUIGroup',
            layout_manager: new Clutter.BinLayout(),
        });
        this.addTopChrome(this.screenshotUIGroup);



        this.dummyCursor = new St.Widget({width: 0, height: 0, opacity: 0, name: 'Dummy Cursor'});
        this.uiGroup.add_child(this.dummyCursor);

        const feedbackGroup = global.compositor.get_feedback_group();
        global.stage.remove_child(feedbackGroup);
        this.uiGroup.add_child(feedbackGroup);

        this._backgroundGroup = new Meta.BackgroundGroup();
        global.window_group.add_child(this._backgroundGroup);
        global.window_group.set_child_below_sibling(this._backgroundGroup, null);
        this._bgManagers = [];

        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        this._interfaceSettings.connect('changed::enable-hot-corners',
            this._updateHotCorners.bind(this));


        const workspaceManager = global.workspace_manager;
        workspaceManager.connect('notify::n-workspaces',
            this._queueUpdateRegions.bind(this));

        const display = global.display;
        display.connect('restacked',
            this._windowsRestacked.bind(this));
        display.connect('in-fullscreen-changed',
            this._updateFullscreen.bind(this));

        const monitorManager = global.backend.get_monitor_manager();
        monitorManager.connectObject(
            'monitors-changed', this._monitorsChanged.bind(this),
            this);
        this._monitorsChanged();

        this.screenTransition = new ScreenTransition();
        this.uiGroup.add_child(this.screenTransition);
        this.screenTransition.add_constraint(new Clutter.BindConstraint({
            source: this.uiGroup,
            coordinate: Clutter.BindCoordinate.ALL,
        }));
    }


    init() {
        Main.sessionMode.connect('updated', this._sessionUpdated.bind(this));

        this._doStartupAnimation().catch(logError);
    }

    showOverview() {
        this.overviewGroup.show();
        this.screenTransition.hide();

        this._inOverview = true;
        this._updateVisibility();
    }

    hideOverview() {
        this.overviewGroup.hide();
        this.screenTransition.hide();

        this._inOverview = false;
        this._updateVisibility();
    }

    _sessionUpdated() {
        this._updateVisibility();
        this._queueUpdateRegions();
    }

    async _ensurePrimaryMonitor() {
        if (this.primaryMonitor)
            return;

        const {promise, resolve} = Promise.withResolvers();
        this._primaryMonitorReadyResolver = resolve;
        await promise;
    }

    _updateMonitors() {
        const display = global.display;

        this.monitors = [];
        const nMonitors = display.get_n_monitors();
        for (let i = 0; i < nMonitors; i++) {
            this.monitors.push(new Monitor(i,
                display.get_monitor_geometry(i),
                display.get_monitor_scale(i)));
        }

        if (nMonitors === 0) {
            this.primaryIndex = this.bottomIndex = -1;
        } else if (nMonitors === 1) {
            this.primaryIndex = this.bottomIndex = 0;
        } else {


            this.primaryIndex = this.bottomIndex = display.get_primary_monitor();
            for (let i = 0; i < this.monitors.length; i++) {
                const monitor = this.monitors[i];
                if (this._isAboveOrBelowPrimary(monitor)) {
                    if (monitor.y > this.monitors[this.bottomIndex].y)
                        this.bottomIndex = i;
                }
            }
        }
        if (this.primaryIndex !== -1) {
            this.primaryMonitor = this.monitors[this.primaryIndex];
            this.bottomMonitor = this.monitors[this.bottomIndex];

            this._primaryMonitorReadyResolver?.call();
        } else {
            this.primaryMonitor = null;
            this.bottomMonitor = null;
        }
    }

    _destroyHotCorners() {
        this.hotCorners.forEach(corner => corner?.destroy());
        this.hotCorners = [];
    }

    _updateHotCorners() {

        this._destroyHotCorners();

        if (!this._interfaceSettings.get_boolean('enable-hot-corners')) {
            this.emit('hot-corners-changed');
            return;
        }

        const size = this.panelBox.height;


        for (let i = 0; i < this.monitors.length; i++) {
            const monitor = this.monitors[i];
            const cornerX = this._rtl ? monitor.x + monitor.width : monitor.x;
            const cornerY = monitor.y;

            let haveTopLeftCorner = true;

            if (i !== this.primaryIndex) {


                const besideX = this._rtl ? monitor.x + 1 : cornerX - 1;
                const besideY = cornerY;
                const aboveX = cornerX;
                const aboveY = cornerY - 1;

                for (let j = 0; j < this.monitors.length; j++) {
                    if (i === j)
                        continue;
                    const otherMonitor = this.monitors[j];
                    if (besideX >= otherMonitor.x &&
                        besideX < otherMonitor.x + otherMonitor.width &&
                        besideY >= otherMonitor.y &&
                        besideY < otherMonitor.y + otherMonitor.height) {
                        haveTopLeftCorner = false;
                        break;
                    }
                    if (aboveX >= otherMonitor.x &&
                        aboveX < otherMonitor.x + otherMonitor.width &&
                        aboveY >= otherMonitor.y &&
                        aboveY < otherMonitor.y + otherMonitor.height) {
                        haveTopLeftCorner = false;
                        break;
                    }
                }
            }

            if (haveTopLeftCorner) {
                const corner = new HotCorner(this, monitor, cornerX, cornerY);
                corner.setBarrierSize(size);
                this.hotCorners.push(corner);
            } else {
                this.hotCorners.push(null);
            }
        }

        this.emit('hot-corners-changed');
    }

    _addBackgroundMenu(bgManager) {
        BackgroundMenu.addBackgroundMenu(bgManager.backgroundActor, this);
    }

    _createBackgroundManager(monitorIndex) {
        const bgManager = new Background.BackgroundManager({
            container: this._backgroundGroup,
            layoutManager: this,
            monitorIndex,
        });

        bgManager.connect('changed', this._addBackgroundMenu.bind(this));
        this._addBackgroundMenu(bgManager);

        return bgManager;
    }

    _showSecondaryBackgrounds() {
        for (let i = 0; i < this.monitors.length; i++) {
            if (i !== this.primaryIndex) {
                const backgroundActor = this._bgManagers[i].backgroundActor;
                backgroundActor.show();
                backgroundActor.opacity = 0;
                backgroundActor.ease({
                    opacity: 255,
                    duration: BACKGROUND_FADE_ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
    }

    _waitLoaded(bgManager, cancellable) {
        const {promise, resolve, reject} = Promise.withResolvers();
        const cancelId = cancellable.connect(() => {
            reject(new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED,
                'Background loading was cancelled'));
        });
        const loadedId = bgManager.connect('loaded', () => {
            bgManager.disconnect(loadedId);
            cancellable.disconnect(cancelId);
            resolve();
        });

        return promise;
    }

    async _updateBackgrounds() {
        this._bgLoadCancellable?.cancel();
        this._bgLoadCancellable = null;

        for (let i = 0; i < this._bgManagers.length; i++)
            this._bgManagers[i].destroy();

        this._bgManagers = [];

        if (Main.sessionMode.isGreeter)
            return Promise.resolve();

        const cancellable = new Gio.Cancellable();
        this._bgLoadCancellable = cancellable;

        for (let i = 0; i < this.monitors.length; i++) {
            const bgManager = this._createBackgroundManager(i);
            this._bgManagers.push(bgManager);

            if (i !== this.primaryIndex && this._startingUp)
                bgManager.backgroundActor.hide();
        }

        if (!this._updateBackgroundsResolvers)
            this._updateBackgroundsResolvers = Promise.withResolvers();

        const {promise, resolve} = this._updateBackgroundsResolvers;
        try {
            await Promise.all(
                this._bgManagers.map(mgr => this._waitLoaded(mgr, cancellable)));

            delete this._updateBackgroundsResolvers;
            resolve();
        } catch {}

        return promise;
    }

    _updateKeyboardBox() {
        this.keyboardBox.set_position(
            this.keyboardMonitor.x,
            this.keyboardMonitor.y + this.keyboardMonitor.height);
        this.keyboardBox.set_size(this.keyboardMonitor.width, -1);
    }

    _updateBoxes() {
        if (!this.primaryMonitor)
            return;

        this.panelBox.set_position(this.primaryMonitor.x, this.primaryMonitor.y);
        this.panelBox.set_size(this.primaryMonitor.width, -1);

        this.keyboardIndex = this.primaryIndex;
    }

    _panelBoxChanged() {
        this._updatePanelBarrier();

        const size = this.panelBox.height;
        this.hotCorners.forEach(corner => {
            if (corner)
                corner.setBarrierSize(size);
        });
    }

    _destroyPanelBarrier() {
        if (this._rightPanelBarrier) {
            this._rightPanelBarrier.destroy();
            this._rightPanelBarrier = null;
        }
    }

    _updatePanelBarrier() {
        this._destroyPanelBarrier();

        if (!this.primaryMonitor)
            return;

        if (this.panelBox.height) {
            const primary = this.primaryMonitor;

            this._rightPanelBarrier = new Meta.Barrier({
                backend: global.backend,
                x1: primary.x + primary.width, y1: primary.y,
                x2: primary.x + primary.width, y2: primary.y + this.panelBox.height,
                directions: Meta.BarrierDirection.NEGATIVE_X,
            });
        }
    }

    _monitorsChanged() {
        this._updateMonitors();
        this._updateBoxes();
        this._updateHotCorners();
        this._updateBackgrounds().catch(logError);
        this._updateFullscreen();
        this._updateVisibility();
        this._queueUpdateRegions();

        this.emit('monitors-changed');
    }

    _isAboveOrBelowPrimary(monitor) {
        const primary = this.monitors[this.primaryIndex];
        const monitorLeft = monitor.x, monitorRight = monitor.x + monitor.width;
        const primaryLeft = primary.x, primaryRight = primary.x + primary.width;

        if ((monitorLeft >= primaryLeft && monitorLeft < primaryRight) ||
            (monitorRight > primaryLeft && monitorRight <= primaryRight) ||
            (primaryLeft >= monitorLeft && primaryLeft < monitorRight) ||
            (primaryRight > monitorLeft && primaryRight <= monitorRight))
            return true;

        return false;
    }

    get currentMonitor() {
        const index = global.display.get_current_monitor();
        return this.monitors[index];
    }

    get keyboardMonitor() {
        return this.monitors[this.keyboardIndex];
    }

    get focusIndex() {
        let i = Main.layoutManager.primaryIndex;

        if (global.stage.key_focus != null)
            i = this.findIndexForActor(global.stage.key_focus);
        else if (global.display.focus_window != null)
            i = global.display.focus_window.get_monitor();
        return i;
    }

    get focusMonitor() {
        if (this.focusIndex < 0)
            return null;
        return this.monitors[this.focusIndex];
    }

    set keyboardIndex(v) {
        this._keyboardIndex = v;
        this._updateKeyboardBox();
    }

    get keyboardIndex() {
        return this._keyboardIndex;
    }

    async _doStartupAnimation() {
        this._isMacLayoutOverlay = true;
        await this._loadBackground();

        try {
            await this._prepareStartupAnimation();
            this._systemBackground.show();
            global.stage.show();
            await this._startupAnimation();
        } catch (e) {
            logError(e);
            this._systemBackground.show();
            global.stage.show();
        } finally {
            this._startupAnimationComplete();
        }
    }

    async _loadBackground() {
        await this._ensurePrimaryMonitor();

        this._systemBackground = new Background.SystemBackground();
        this._systemBackground.hide();

        global.stage.insert_child_below(this._systemBackground, null);

        const constraint = new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        });
        this._systemBackground.add_constraint(constraint);

        const {promise, resolve} = Promise.withResolvers();
        const signalId = this._systemBackground.connect('loaded', () => {
            this._systemBackground.disconnect(signalId);
            resolve();
        });

        await promise;
    }
















    async _prepareStartupAnimation() {
        await this._ensurePrimaryMonitor();

        const screenW = global.stage.width || global.screen_width || 1920;
        const screenH = global.stage.height || global.screen_height || 1080;

        let bgUri = 'file:///usr/share/backgrounds/GoldenGate_Day.jpg';
        if (!Main.sessionMode.isGreeter) {
            try {
                const bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
                const uri = bgSettings.get_string('picture-uri-dark') || bgSettings.get_string('picture-uri');
                if (uri && uri !== '') bgUri = uri;
            } catch (_) {}
        }


        this._coverPane = new St.Widget({
            name: 'macStartupCoverPane',
            style: Main.sessionMode.isGreeter
                ? 'background-color: transparent;'
                : `background-color: #000000; background-image: url("${bgUri}"); background-size: cover; background-position: center;`,
            opacity: Main.sessionMode.isGreeter ? 0 : 255,
            x: 0,
            y: 0,
            width: screenW,
            height: screenH,
            reactive: true,
        });
        this.uiGroup.add_child(this._coverPane);
        this.uiGroup.set_child_above_sibling(this._coverPane, null);

        this._updateRegions();

        if (Main.sessionMode.isGreeter) {

            if (this.panelBox) {
                this.panelBox.remove_all_transitions();
                const panelH = this.panelBox.height > 0 ? this.panelBox.height : 34;
                this.panelBox.translation_y = -panelH;
                this.panelBox.opacity = 0;
            }


            if (!this._gdmBootCover) {
                this._gdmBootCover = new St.Widget({
                    name: 'gdmBootCover',
                    style: 'background-color: #000000;',
                    layout_manager: new Clutter.FixedLayout(),
                    x: 0,
                    y: 0,
                    width: screenW,
                    height: screenH,
                    reactive: true,
                });

                try {
                    const logoPaths = [
                        '/usr/share/plymouth/themes/macw1y-boot/logo.png',
                        '/usr/share/plymouth/themes/apple-mac/logo.png',
                    ];
                    const foundLogo = logoPaths.find(p => GLib.file_test(p, GLib.FileTest.EXISTS));
                    if (foundLogo) {
                        const logoOverlay = new St.Widget({
                            name: 'macBootLogoOverlay',
                            layout_manager: new Clutter.FixedLayout(),
                            x: 0,
                            y: 0,
                            width: screenW,
                            height: screenH,
                            opacity: 255,
                        });
                        const logoH = Math.max(50, Math.round(screenH * 0.092));
                        const logoW = Math.round(logoH * 0.8125);
                        logoOverlay.add_child(new St.Widget({
                            style: `background-image: url("file://${foundLogo}"); background-size: contain; background-repeat: no-repeat; background-position: center;`,
                            x: Math.round((screenW - logoW) / 2),
                            y: Math.round((screenH - logoH) / 2),
                            width: logoW,
                            height: logoH,
                        }));
                        const barW = Math.min(400, Math.max(180, Math.round(screenW * 0.14)));
                        const barH = Math.min(10, Math.max(4, Math.round(screenH * 0.0056)));
                        logoOverlay.add_child(new St.Widget({
                            style: `background-color: rgba(255, 255, 255, 0.92); border-radius: ${Math.max(2, Math.round(barH / 2))}px;`,
                            x: Math.round((screenW - barW) / 2),
                            y: Math.round(screenH * 0.93),
                            width: barW,
                            height: barH,
                        }));
                        this._gdmBootCover.add_child(logoOverlay);
                    }
                } catch (_) {}

                this.uiGroup.add_child(this._gdmBootCover);
                this.uiGroup.set_child_above_sibling(this._gdmBootCover, null);
            }
        } else {
            this._macStartupManaged = true;
            this.keyboardBox.hide();


            _safeSetStageBlack();


            this._showSecondaryBackgrounds();
            this.uiGroup.set_pivot_point(0, 0);
            this.uiGroup.scale_x = 1.0;
            this.uiGroup.scale_y = 1.0;
            this.uiGroup.opacity = 255;


            if (this.panelBox) {
                this.panelBox.remove_all_transitions();
                const panelH = this.panelBox.height > 0 ? this.panelBox.height : 34;
                this.panelBox.translation_y = -panelH;
                this.panelBox.opacity = 0;
                if (this._coverPane) {
                    this.uiGroup.set_child_above_sibling(this.panelBox, this._coverPane);
                }
            }


            if (global.window_group) {
                global.window_group.remove_all_transitions();
                global.window_group.opacity = 255;
                if (this._backgroundGroup) {
                    this._backgroundGroup.remove_all_transitions();
                    this._backgroundGroup.opacity = 255;
                }
                for (const w of global.window_group.get_children()) {
                    if (w !== this._backgroundGroup) {
                        w.remove_all_transitions();
                        w.opacity = 0;
                    }
                }
                if (!this._macWinGroupChildAddedId) {
                    this._macWinGroupChildAddedId = global.window_group.connect('child-added', (_group, w) => {
                        if (this._startingUp && w !== this._backgroundGroup) {
                            w.remove_all_transitions();
                            w.opacity = 0;
                        }
                    });
                }
            }


            for (const child of this.uiGroup.get_children()) {
                if (child.name === 'dashtodockContainer' || child.name === 'liquid-glass-bg-actor') {
                    child.remove_all_transitions();
                    child.opacity = 0;
                    if (child.name === 'dashtodockContainer') {
                        for (const sub of child.get_children()) {
                            sub.opacity = 0;
                        }
                    }
                }
            }


            if (!this._macUiGroupChildAddedId) {
                this._macUiGroupChildAddedId = this.uiGroup.connect('child-added', (_group, child) => {
                    if (!this._startingUp) return;
                    if (this._coverPane && child !== this._coverPane && child !== this.panelBox) {
                        this.uiGroup.set_child_above_sibling(this._coverPane, null);
                        if (this.panelBox) {
                            this.uiGroup.set_child_above_sibling(this.panelBox, this._coverPane);
                        }
                    }
                    if (child.name === 'dashtodockContainer') {
                        child.remove_all_transitions();
                        child.opacity = 0;
                        for (const sub of child.get_children()) {
                            sub.opacity = 0;
                        }
                    }
                    if (child.name === 'liquid-glass-bg-actor') {
                        child.remove_all_transitions();
                        child.opacity = 0;
                    }
                });
            }


            if (this._backgroundGroup && !this._macBgChildAddedId) {
                this._macBgChildAddedId = this._backgroundGroup.connect('child-added', (_group, child) => {
                    if (!this._startingUp) return;
                    if ((child.has_style_class_name && child.has_style_class_name('widget-layer')) || child.name === 'widget-layer') {
                        child.remove_all_transitions();
                        child.opacity = 0;
                    }
                });
            }

            const widgetsExt = Main.extensionManager?.lookup('desktop-widgets@r3nhick');
            const widgetLayer = widgetsExt?.stateObj?._controller?._layer ||
                this._backgroundGroup?.get_children().find(c => c.has_style_class_name?.('widget-layer'));
            if (widgetLayer) {
                widgetLayer.remove_all_transitions();
                widgetLayer.opacity = 0;
            }

            await this._updateBackgrounds();
        }



        if (!Main.sessionMode.isGreeter) {
            this.emit('startup-prepared');
        }
    }

    async _startupAnimation() {
        if (Main.sessionMode.isGreeter)
            await this._startupAnimationGreeter();
        else
            await this._startupAnimationSession();
    }

    async _startupAnimationGreeter() {
        const waitForGreeterExtensions = async () => {
            let em = Main.extensionManager;
            let attempts = 0;
            while ((!em || !em._enabledExtensions || em._enabledExtensions.length === 0) && attempts < 40) {
                await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    r();
                    return GLib.SOURCE_REMOVE;
                }));
                em = Main.extensionManager;
                attempts++;
            }

            if (!em || !em._enabledExtensions || em._enabledExtensions.length === 0)
                return;

            const isReady = () => em._enabledExtensions.every(uuid => {
                const ext = em.lookup(uuid);
                return ext && (ext.state === 1 || ext.state === 2 || ext.state === 3);
            });

            if (isReady()) return;

            await new Promise(resolve => {
                let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    timeoutId = 0;
                    try { em.disconnect(sigId); } catch (_) {}
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });

                const sigId = em.connect('extension-state-changed', () => {
                    if (isReady()) {
                        if (timeoutId) GLib.source_remove(timeoutId);
                        try { em.disconnect(sigId); } catch (_) {}
                        resolve();
                    }
                });
            });
        };

        await waitForGreeterExtensions();


        const wackUuid = 'wack-lockscreen-clock@rinzler69-wastaken.github.com';
        if (Main.extensionManager) {
            const wackExt = Main.extensionManager.lookup(wackUuid);
            if (wackExt && wackExt.state !== 1) {
                try {
                    await Main.extensionManager._callExtensionEnable(wackUuid);
                } catch (e) {
                    logError(e, `[LayoutOverlay] Proactive enable error for ${wackUuid}`);
                }
            }
        }

        let wackAttempts = 0;
        while (wackAttempts < 30) {
            const wack = Main.extensionManager?.lookup(wackUuid);
            if (wack && wack.state === 1) break;
            if (wack && wack.state !== 1 && Main.extensionManager) {
                try {
                    await Main.extensionManager._callExtensionEnable(wackUuid);
                } catch (_) {}
            }
            await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                r();
                return GLib.SOURCE_REMOVE;
            }));
            wackAttempts++;
        }


        this.emit('startup-prepared');

        if (globalThis._wackHandlesBootCover && this._gdmBootCover) {
            // Let wack-lockscreen-clock crossfade the boot cover once prompt + single-user selection are ready
            globalThis._wackGdmBootCover = this._gdmBootCover;
            this._gdmBootCover = null;
            if (this.panelBox) {
                this.panelBox.remove_all_transitions();
                this.panelBox.translation_y = 0;
                this.panelBox.opacity = 255;
            }
            return;
        }


        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));

        const DURATION = 950;
        const MODE = Clutter.AnimationMode.EASE_IN_OUT_CUBIC;


        if (this._gdmBootCover) {
            const cover = this._gdmBootCover;
            this._gdmBootCover = null;
            cover.remove_all_transitions();
            const fadeBlackBackdrop = () => {
                if (!cover.get_stage?.()) return;
                cover.ease({
                    opacity: 0,
                    duration: 680,
                    mode: MODE,
                    onComplete: () => cover.destroy(),
                });
            };
            const logoOverlay = cover.get_children?.().find(c => c.name === 'macBootLogoOverlay');
            if (logoOverlay) {
                logoOverlay.remove_all_transitions();
                logoOverlay.ease({
                    opacity: 0,
                    duration: 280,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        try { logoOverlay.destroy(); } catch (_) {}
                        fadeBlackBackdrop();
                    },
                });
            } else {
                fadeBlackBackdrop();
            }
        }


        if (this.panelBox) {
            this.panelBox.remove_all_transitions();
            this.panelBox.ease({
                translation_y: 0,
                opacity: 255,
                duration: DURATION,
                mode: MODE,
                onComplete: () => {
                    if (this.panelBox) {
                        this.panelBox.translation_y = 0;
                        this.panelBox.opacity = 255;
                    }
                },
                onStopped: () => {
                    if (this.panelBox) {
                        this.panelBox.translation_y = 0;
                        this.panelBox.opacity = 255;
                    }
                },
            });
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                if (this.panelBox) {
                    this.panelBox.translation_y = 0;
                    this.panelBox.opacity = 255;
                    this.panelBox.visible = true;
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    async _startupAnimationSession() {
        this.uiGroup.scale_x = 1.0;
        this.uiGroup.scale_y = 1.0;
        this.uiGroup.set_pivot_point(0, 0);
        this.uiGroup.opacity = 255;



        const STARTUP_TIMEOUT_MS = 12000;

        const checkExtensions = async () => {
            const em = Main.extensionManager;
            if (!em) return;
            const isExtEnabled = (uuid) => {
                const ext = em.lookup(uuid);
                return Boolean(ext && (ext.state === 1 || ext.state === 2 || ext.state === 3));
            };
            const isPanelVisualReady = () => {
                const kiwiExt = em.lookup('kiwi@kemma');
                if (kiwiExt && (kiwiExt.state === 1 || em._enabledExtensions?.includes('kiwi@kemma')) && !globalThis._macKiwiReady)
                    return false;
                const bmsExt = em.lookup('blur-my-shell@aunetx');
                if (bmsExt && (bmsExt.state === 1 || em._enabledExtensions?.includes('blur-my-shell@aunetx'))) {
                    const qs = Main.panel?.statusArea?.quickSettings;
                    if (!globalThis._macMenuBarReady || (qs && !qs.has_style_class_name?.('mac-control-center-button')))
                        return false;
                }
                return true;
            };
            const isReady = () => (em._enabledExtensions || []).every(isExtEnabled) && isPanelVisualReady();
            if (isReady()) return;
            return new Promise(resolve => {
                let pollId = 0;
                let sigId = 0;
                const finish = () => {
                    if (pollId) { GLib.source_remove(pollId); pollId = 0; }
                    if (sigId) { try { em.disconnect(sigId); } catch (_) {} sigId = 0; }
                    resolve();
                };
                sigId = em.connect('extension-state-changed', () => {
                    if (isReady()) finish();
                });
                pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                    if (isReady()) {
                        pollId = 0;
                        finish();
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            });
        };

        const checkDock = async () => {
            const isDockReady = () => {
                const dc = this.uiGroup.get_children().find(c => c.name === 'dashtodockContainer');
                const dash = dc?.dash || dc?._dock?.dash;
                return Boolean(dc && dash && dash._macHasItems && dash._macTrashReady);
            };
            if (isDockReady()) return;
            return new Promise(resolve => {
                let attempts = 0;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                    attempts++;
                    if (isDockReady() || attempts > 250) {
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            });
        };

        const checkLiquidGlass = async () => {
            const isGlassReady = () => {
                const lg = Main.extensionManager?.lookup('liquid-glass@thinkingcoding1231.gmail.com');
                if (!lg || lg.state === 3 || lg.state === 2) return true;
                const docks = lg?.stateObj?._dashDocks;
                return Boolean(docks && docks.length > 0 && docks[0].manager?.bgActor && docks[0].manager?.effect?._shadersLoaded);
            };
            if (isGlassReady()) return;
            return new Promise(resolve => {
                let attempts = 0;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                    attempts++;
                    if (isGlassReady() || attempts > 250) {
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            });
        };

        const checkWidgets = async () => {
            const isWidgetsReady = () => {
                const dw = Main.extensionManager?.lookup('desktop-widgets@r3nhick');
                if (!dw || dw.state === 3 || dw.state === 2) return true;
                const layer = dw?.stateObj?._controller?._layer ||
                    this._backgroundGroup?.get_children().find(c => c.has_style_class_name?.('widget-layer') || c.name === 'widget-layer');
                return Boolean(layer && layer.get_children().length > 0);
            };
            if (isWidgetsReady()) return;
            return new Promise(resolve => {
                let attempts = 0;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                    attempts++;
                    if (isWidgetsReady() || attempts > 250) {
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            });
        };

        const checkDing = async () => {
            const dingExt = Main.extensionManager?.lookup('ding@rastersoft.com');
            if (!dingExt || dingExt.state === 2 || dingExt.state === 3) return;
            const isDingReady = () => {
                const actors = global.get_window_actors?.() || [];
                return actors.some(a => {
                    const mw = a.meta_window || a.get_meta_window?.();
                    return mw && (mw.get_gtk_application_id?.() === 'com.rastersoft.ding' ||
                        mw.get_title?.()?.startsWith('Desktop Icons'));
                });
            };
            if (isDingReady()) return;
            return new Promise(resolve => {
                let attempts = 0;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    attempts++;
                    if (isDingReady() || attempts > 200) {
                        resolve();
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            });
        };

        const timeoutBarrier = new Promise(resolve => {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, STARTUP_TIMEOUT_MS, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });


        try {
            if (typeof globalThis._macPrewarmSpotlight === 'function') {
                globalThis._macPrewarmSpotlight();
            }
        } catch (_) {}


        await Promise.race([
            Promise.all([checkExtensions(), checkDock(), checkLiquidGlass(), checkWidgets(), checkDing()]),
            timeoutBarrier
        ]);

        // Settle one frame so Top Bar Organizer and Liquid Glass geometry sync cleanly before synchronized slide-in
        try {
            Main.layoutManager._macDockRevealActive = true;
            global._liquidGlassDockSync?.();
        } catch (_) {}
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));


        if (this._macBgChildAddedId && this._backgroundGroup) {
            try { this._backgroundGroup.disconnect(this._macBgChildAddedId); } catch (_) {}
            this._macBgChildAddedId = null;
        }
        if (this._macUiGroupChildAddedId) {
            try { this.uiGroup.disconnect(this._macUiGroupChildAddedId); } catch (_) {}
            this._macUiGroupChildAddedId = null;
        }


        const DURATION = 560;
        const MODE = Clutter.AnimationMode.EASE_OUT_CUBIC;


        if (this.panelBox) {
            this.panelBox.remove_all_transitions();
            const panelH = this.panelBox.height > 0 ? this.panelBox.height : 34;
            this.panelBox.translation_y = -panelH;
            this.panelBox.opacity = 0;
            this.panelBox.show();
            this.panelBox.ease({
                translation_y: 0,
                opacity: 255,
                duration: DURATION,
                mode: MODE,
                onComplete: () => {
                    if (this.panelBox) {
                        this.panelBox.translation_y = 0;
                        this.panelBox.opacity = 255;
                    }
                },
                onStopped: () => {
                    if (this.panelBox) {
                        this.panelBox.translation_y = 0;
                        this.panelBox.opacity = 255;
                    }
                },
            });
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                if (this.panelBox) {
                    this.panelBox.translation_y = 0;
                    this.panelBox.opacity = 255;
                    this.panelBox.visible = true;
                }
                return GLib.SOURCE_REMOVE;
            });
        }
        if (Main.panel && Main.panel !== this.panelBox) {
            Main.panel.remove_all_transitions();
            Main.panel.translation_y = 0;
            Main.panel.opacity = 255;
        }


        const widgetsExt = Main.extensionManager?.lookup('desktop-widgets@r3nhick');
        const widgetLayer = widgetsExt?.stateObj?._controller?._layer ||
            this._backgroundGroup?.get_children().find(c => c.has_style_class_name?.('widget-layer'));
        if (widgetLayer) {
            widgetLayer.remove_all_transitions();
            widgetLayer.show();
            if (widgetLayer.get_parent() === global.window_group) {
                widgetLayer.opacity = 255;
            } else {
                widgetLayer.opacity = 0;
                widgetLayer.ease({
                    opacity: 255,
                    duration: DURATION,
                    mode: MODE,
                });
            }
        }


        if (this._macWinGroupChildAddedId && global.window_group) {
            try { global.window_group.disconnect(this._macWinGroupChildAddedId); } catch (_) {}
            this._macWinGroupChildAddedId = null;
        }
        if (global.window_group) {
            global.window_group.remove_all_transitions();
            global.window_group.opacity = 255;
            if (this._backgroundGroup) {
                this._backgroundGroup.remove_all_transitions();
                this._backgroundGroup.opacity = 255;
            }
            for (const w of global.window_group.get_children()) {
                if (w !== this._backgroundGroup) {
                    w.remove_all_transitions();
                    w.opacity = 0;
                    w.ease({
                        opacity: 255,
                        duration: DURATION,
                        mode: MODE,
                    });
                }
            }
        }


        const dockContainers = this.uiGroup.get_children().filter(c => c.name === 'dashtodockContainer');
        const glassActors = this.uiGroup.get_children().filter(c => c.name === 'liquid-glass-bg-actor');

        let dockSlideOffset = { translation_x: 0, translation_y: 124 };
        for (const dc of dockContainers) {
            const dock = dc._dock || dc;
            if (typeof dock._trackDock === 'function' && !dock.get_stage()) {
                try { dock._trackDock(); } catch (_) {}
            }
            if (typeof dock._initialize === 'function' && dock._dockState === 0) {
                try { dock._initialize(); } catch (_) {}
            }
            const dockH = dc.height > 0 ? dc.height : 92;
            dc.remove_all_transitions();
            if (dock.position === undefined || dock.position === St.Side.BOTTOM) {
                dc.translation_y = -dockH;
            }
            dc.opacity = 255;
            dc.show();
            for (const child of dc.get_children()) {
                child.remove_all_transitions();
                child.opacity = 255;
                child.show();
            }

            if (dock._slider) {
                dock._slider.remove_all_transitions?.();
                dock._slider.visible = true;
                dock._slider.opacity = 255;
                dock._slider.slide_x = 1;
            }
            if (dock._box) {
                dock._box.remove_all_transitions?.();
                dock._box.visible = true;
                dock._box.opacity = 255;
            }
            dock._dockState = 2;
            dock._startupAnimationRan = true;
            const slideDist = dockH + 32;
            dockSlideOffset = typeof dock._getSlideOffset === 'function'
                ? dock._getSlideOffset(slideDist)
                : { translation_x: 0, translation_y: slideDist };
            if (dock.dash) {
                dock.dash.remove_all_transitions();
                dock.dash.visible = true;
                dock.dash.opacity = 0;
                dock.dash.translation_x = dockSlideOffset.translation_x;
                dock.dash.translation_y = dockSlideOffset.translation_y;
                dock.dash.ease({
                    opacity: 255,
                    translation_x: 0,
                    translation_y: 0,
                    duration: DURATION,
                    mode: MODE,
                    onComplete: () => {
                        Main.layoutManager._macDockRevealActive = false;
                        try { global._liquidGlassDockSync?.(); } catch (_) {}
                    },
                });
            }
        }

        try { global._liquidGlassDockSync?.(); } catch (_) {}

        for (const ga of glassActors) {
            ga.remove_all_transitions();
            ga.translation_x = dockSlideOffset.translation_x;
            ga.translation_y = dockSlideOffset.translation_y;
            ga.opacity = 0;
            ga.show();
            ga.ease({
                opacity: 255,
                translation_x: 0,
                translation_y: 0,
                duration: DURATION,
                mode: MODE,
                onComplete: () => {
                    Main.layoutManager._macDockRevealActive = false;
                    try { global._liquidGlassDockSync?.(); } catch (_) {}
                },
            });
        }

        // Crossfade static wallpaper cover cleanly while reveal actors animate unobstructed above it
        if (this._coverPane) {
            const cover = this._coverPane;
            this._coverPane = null;
            for (const topActor of [this.panelBox, ...dockContainers, ...glassActors]) {
                if (topActor && topActor.get_parent?.() === this.uiGroup) {
                    try { this.uiGroup.set_child_above_sibling(topActor, cover); } catch (_) {}
                }
            }
            cover.remove_all_transitions();
            cover.ease({
                opacity: 0,
                duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try { cover.destroy(); } catch (_) {}
                },
            });
        }


        this._startingUp = false;


        try {
            const runtimeDir = GLib.getenv('XDG_RUNTIME_DIR');
            const paths = [
                runtimeDir ? `${runtimeDir}/mactheme-overlay-launching` : null,
                runtimeDir ? `${runtimeDir}/mactheme-overlay-failed` : null,
                '/var/tmp/mactheme-overlay-launching',
                '/var/tmp/mactheme-overlay-failed',
            ];
            for (const p of paths) {
                if (p) {
                    const f = Gio.File.new_for_path(p);
                    if (f.query_exists(null)) f.delete(null);
                }
            }
        } catch (_) {}
        if (!this._hasEmittedStartupComplete) {
            this._hasEmittedStartupComplete = true;
            this.emit('startup-complete');
        }


        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, DURATION, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
    }

    _startupAnimationComplete() {
        if (this._coverPane) {
            this._coverPane.destroy();
            this._coverPane = null;
        }

        if (this._gdmBootCover) {
            this._gdmBootCover.destroy();
            this._gdmBootCover = null;
        }

        this._systemBackground.destroy();
        this._systemBackground = null;

        this._startingUp = false;


        try {
            const runtimeDir = GLib.getenv('XDG_RUNTIME_DIR');
            const paths = [
                runtimeDir ? `${runtimeDir}/mactheme-overlay-launching` : null,
                runtimeDir ? `${runtimeDir}/mactheme-overlay-failed` : null,
                '/var/tmp/mactheme-overlay-launching',
                '/var/tmp/mactheme-overlay-failed',
            ];
            for (const p of paths) {
                if (p) {
                    const f = Gio.File.new_for_path(p);
                    if (f.query_exists(null)) f.delete(null);
                }
            }
        } catch (_) {}

        this.keyboardBox.show();

        if (!Main.sessionMode.isGreeter) {
            this._showSecondaryBackgrounds();
            global.window_group.remove_clip();
        }

        this._queueUpdateRegions();

        if (!this._hasEmittedStartupComplete) {
            this._hasEmittedStartupComplete = true;
            this.emit('startup-complete');
        }
    }











    setDummyCursorGeometry(x, y, w, h) {
        this.dummyCursor.set_position(Math.round(x), Math.round(y));
        this.dummyCursor.set_size(Math.round(w), Math.round(h));
    }



















    addChrome(actor, params) {
        this.uiGroup.add_child(actor);
        if (this.uiGroup.contains(global.top_window_group))
            this.uiGroup.set_child_below_sibling(actor, global.top_window_group);
        this._trackActor(actor, params);
    }






    addTopChrome(actor, params) {
        this.uiGroup.add_child(actor);
        this._trackActor(actor, params);
    }











    trackChrome(actor, params = {}) {
        let ancestor = actor.get_parent();
        let index = this._findActor(ancestor);
        while (ancestor && index === -1) {
            ancestor = ancestor.get_parent();
            index = this._findActor(ancestor);
        }

        const ancestorData = ancestor
            ? this._trackedActors[index]
            : defaultParams;


        for (const prop in defaultParams) {
            if (!Object.prototype.hasOwnProperty.call(params, prop))
                params[prop] = ancestorData[prop];
        }

        this._trackActor(actor, params);
    }





    untrackChrome(actor) {
        this._untrackActor(actor);
    }





    removeChrome(actor) {
        this.uiGroup.remove_child(actor);
        this._untrackActor(actor);
    }

    _findActor(actor) {
        for (let i = 0; i < this._trackedActors.length; i++) {
            const actorData = this._trackedActors[i];
            if (actorData.actor === actor)
                return i;
        }
        return -1;
    }

    _trackActor(actor, params) {
        if (this._findActor(actor) !== -1)
            throw new Error('trying to re-track existing chrome actor');

        const actorData = Params.parse(params, defaultParams);
        actorData.actor = actor;
        actor.connectObject(
            'notify::visible', this._queueUpdateRegions.bind(this),
            'notify::allocation', this._queueUpdateRegions.bind(this),
            'destroy', this._untrackActor.bind(this), this);



        this._trackedActors.push(actorData);
        this._updateActorVisibility(actorData);
        this._queueUpdateRegions();
    }

    _untrackActor(actor) {
        const i = this._findActor(actor);

        if (i === -1)
            return;

        this._trackedActors.splice(i, 1);
        actor.disconnectObject(this);

        this._queueUpdateRegions();
    }

    _updateActorVisibility(actorData) {
        if (!actorData.trackFullscreen)
            return;

        const monitor = this.findMonitorForActor(actorData.actor);
        actorData.actor.visible = !(global.window_group.visible &&
                                    monitor &&
                                    monitor.inFullscreen);
    }

    _updateVisibility() {
        const windowsVisible = Main.sessionMode.hasWindows && !this._inOverview;

        global.window_group.visible = windowsVisible;
        global.top_window_group.visible = windowsVisible;

        this._trackedActors.forEach(this._updateActorVisibility.bind(this));
    }

    getWorkAreaForMonitor(monitorIndex) {


        const workspaceManager = global.workspace_manager;
        const ws = workspaceManager.get_workspace_by_index(0);
        return ws.get_work_area_for_monitor(monitorIndex);
    }

    _findIndexForRect(x, y, width, height) {
        const rect = new Mtk.Rectangle({
            x: Math.floor(x),
            y: Math.floor(y),
            width: Math.ceil(x + width) - Math.floor(x),
            height: Math.ceil(y + height) - Math.floor(y),
        });
        return global.display.get_monitor_index_for_rect(rect);
    }



    findIndexForActor(actor) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        return this._findIndexForRect(x, y, w, h);
    }

    _findMonitorForIndex(index) {
        if (index >= 0 && index < this.monitors.length)
            return this.monitors[index];
        return null;
    }

    findMonitorForActor(actor) {
        return this._findMonitorForIndex(this.findIndexForActor(actor));
    }

    findMonitorForPoint(x, y) {
        return this._findMonitorForIndex(this._findIndexForRect(x, y, 1, 1));
    }

    _queueUpdateRegions() {
        if (!this._updateRegionIdle) {
            const laters = global.compositor.get_laters();
            this._updateRegionIdle = laters.add(
                Meta.LaterType.BEFORE_REDRAW, this._updateRegions.bind(this));
        }
    }

    _updateFullscreen() {
        this._updateVisibility();
        this._queueUpdateRegions();
    }

    _windowsRestacked() {
        let changed = false;

        if (this._isPopupWindowVisible !== global.top_window_group.get_children().some(isPopupMetaWindow))
            changed = true;

        if (changed) {
            this._updateVisibility();
            this._queueUpdateRegions();
        }
    }

    _updateRegions() {
        if (this._updateRegionIdle) {
            const laters = global.compositor.get_laters();
            laters.remove(this._updateRegionIdle);
            delete this._updateRegionIdle;
        }

        const struts = [];
        const isPopupMenuVisible = global.top_window_group.get_children().some(isPopupMetaWindow);

        for (let i = 0; i < this._trackedActors.length; i++) {
            const actorData = this._trackedActors[i];
            if (!actorData.affectsStruts)
                continue;

            actorData.actor.get_allocation_box();
            let [x, y] = actorData.actor.get_transformed_position();
            let [w, h] = actorData.actor.get_transformed_size();
            x = Math.round(x);
            y = Math.round(y);
            w = Math.round(w);
            h = Math.round(h);

            let monitor = null;
            if (actorData.affectsStruts)
                monitor = this.findMonitorForActor(actorData.actor);

            if (monitor) {

                const x1 = Math.max(x, 0);
                const x2 = Math.min(x + w, global.screen_width);
                const y1 = Math.max(y, 0);
                const y2 = Math.min(y + h, global.screen_height);











                let side;
                if (x1 <= monitor.x && x2 >= monitor.x + monitor.width) {
                    if (y1 <= monitor.y)
                        side = Meta.Side.TOP;
                    else if (y2 >= monitor.y + monitor.height)
                        side = Meta.Side.BOTTOM;
                    else
                        continue;
                } else if (y1 <= monitor.y && y2 >= monitor.y + monitor.height) {
                    if (x1 <= monitor.x)
                        side = Meta.Side.LEFT;
                    else if (x2 >= monitor.x + monitor.width)
                        side = Meta.Side.RIGHT;
                    else
                        continue;
                } else if (x1 <= monitor.x) {
                    side = Meta.Side.LEFT;
                } else if (y1 <= monitor.y) {
                    side = Meta.Side.TOP;
                } else if (x2 >= monitor.x + monitor.width) {
                    side = Meta.Side.RIGHT;
                } else if (y2 >= monitor.y + monitor.height) {
                    side = Meta.Side.BOTTOM;
                } else {
                    continue;
                }

                const strutRect = new Mtk.Rectangle({x: x1, y: y1, width: x2 - x1, height: y2 - y1});
                const strut = new Meta.Strut({rect: strutRect, side});
                struts.push(strut);
            }
        }

        this._isPopupWindowVisible = isPopupMenuVisible;

        const workspaceManager = global.workspace_manager;
        for (let w = 0; w < workspaceManager.n_workspaces; w++) {
            const workspace = workspaceManager.get_workspace_by_index(w);
            workspace.set_builtin_struts(struts);
        }

        return GLib.SOURCE_REMOVE;
    }

    modalEnded() {


        this._queueUpdateRegions();
    }
});






export const HotCorner = GObject.registerClass(
class HotCorner extends Clutter.Actor {
    _init(layoutManager, monitor, x, y) {
        super._init();

        this._monitor = monitor;

        this._x = x;
        this._y = y;

        this._pressureBarrier = new PressureBarrier(
            HOT_CORNER_PRESSURE_THRESHOLD,
            HOT_CORNER_PRESSURE_TIMEOUT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        this._pressureBarrier.connect('trigger', this._toggleOverview.bind(this));

        let px = 0.0;
        let py = 0.0;
        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL) {
            px = 1.0;
            py = 0.0;
        }

        this._ripples = new Ripples.Ripples(px, py, 'ripple-box');
        this._ripples.addTo(layoutManager.uiGroup);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    setBarrierSize(size) {
        if (this._verticalBarrier) {
            this._pressureBarrier.removeBarrier(this._verticalBarrier);
            this._verticalBarrier.destroy();
            this._verticalBarrier = null;
        }

        if (this._horizontalBarrier) {
            this._pressureBarrier.removeBarrier(this._horizontalBarrier);
            this._horizontalBarrier.destroy();
            this._horizontalBarrier = null;
        }

        if (size > 0) {
            if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL) {
                this._verticalBarrier = new Meta.Barrier({
                    backend: global.backend,
                    x1: this._x, x2: this._x, y1: this._y, y2: this._y + size,
                    directions: Meta.BarrierDirection.NEGATIVE_X,
                });
                this._horizontalBarrier = new Meta.Barrier({
                    backend: global.backend,
                    x1: this._x - size, x2: this._x, y1: this._y, y2: this._y,
                    directions: Meta.BarrierDirection.POSITIVE_Y,
                });
            } else {
                this._verticalBarrier = new Meta.Barrier({
                    backend: global.backend,
                    x1: this._x, x2: this._x, y1: this._y, y2: this._y + size,
                    directions: Meta.BarrierDirection.POSITIVE_X,
                });
                this._horizontalBarrier = new Meta.Barrier({
                    backend: global.backend,
                    x1: this._x, x2: this._x + size, y1: this._y, y2: this._y,
                    directions: Meta.BarrierDirection.POSITIVE_Y,
                });
            }

            this._pressureBarrier.addBarrier(this._verticalBarrier);
            this._pressureBarrier.addBarrier(this._horizontalBarrier);
        }
    }

    _onDestroy() {
        this.setBarrierSize(0);
        this._pressureBarrier.destroy();
        this._pressureBarrier = null;

        this._ripples.destroy();
    }

    _toggleOverview() {
        if (this._monitor.inFullscreen && !Main.overview.visible)
            return;

        if (Main.overview.shouldToggleByCornerOrButton()) {
            Main.overview.toggle();
            if (Main.overview.animationInProgress)
                this._ripples.playAnimation(this._x, this._y);
        }
    }

    handleDragOver(source, _actor, _x, _y, _time) {
        if (source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        this._toggleOverview();

        return DND.DragMotionResult.CONTINUE;
    }
});

export class PressureBarrier extends Signals.EventEmitter {
    constructor(threshold, timeout, actionMode) {
        super();

        this._threshold = threshold;
        this._timeout = timeout;
        this._actionMode = actionMode;
        this._barriers = [];
        this._eventFilter = null;

        this._isTriggered = false;
        this._reset();
    }

    addBarrier(barrier) {
        barrier._pressureHitId = barrier.connect('hit', this._onBarrierHit.bind(this));
        barrier._pressureLeftId = barrier.connect('left', this._onBarrierLeft.bind(this));

        this._barriers.push(barrier);
    }

    _disconnectBarrier(barrier) {
        barrier.disconnect(barrier._pressureHitId);
        barrier.disconnect(barrier._pressureLeftId);
    }

    removeBarrier(barrier) {
        this._disconnectBarrier(barrier);
        this._barriers.splice(this._barriers.indexOf(barrier), 1);
    }

    destroy() {
        this._barriers.forEach(this._disconnectBarrier.bind(this));
        this._barriers = [];
    }

    setEventFilter(filter) {
        this._eventFilter = filter;
    }

    _reset() {
        this._barrierEvents = [];
        this._currentPressure = 0;
        this._lastTime = 0;
    }

    _isHorizontal(barrier) {
        return barrier.y1 === barrier.y2;
    }

    _getDistanceAcrossBarrier(barrier, event) {
        if (this._isHorizontal(barrier))
            return Math.abs(event.dy);
        else
            return Math.abs(event.dx);
    }

    _getDistanceAlongBarrier(barrier, event) {
        if (this._isHorizontal(barrier))
            return Math.abs(event.dx);
        else
            return Math.abs(event.dy);
    }

    _trimBarrierEvents() {



        let i = 0;
        const threshold = this._lastTime - this._timeout;

        while (i < this._barrierEvents.length) {
            const [time, distance_] = this._barrierEvents[i];
            if (time >= threshold)
                break;
            i++;
        }

        const firstNewEvent = i;

        for (i = 0; i < firstNewEvent; i++) {
            const [time_, distance] = this._barrierEvents[i];
            this._currentPressure -= distance;
        }

        this._barrierEvents = this._barrierEvents.slice(firstNewEvent);
    }

    _onBarrierLeft(barrier, _event) {
        barrier._isHit = false;
        if (this._barriers.every(b => !b._isHit)) {
            this._reset();
            this._isTriggered = false;
        }
    }

    _trigger() {
        this._isTriggered = true;
        this.emit('trigger');
        this._reset();
    }

    _onBarrierHit(barrier, event) {
        barrier._isHit = true;



        if (this._isTriggered)
            return;

        if (this._eventFilter && this._eventFilter(event))
            return;


        if (!(this._actionMode & Main.actionMode))
            return;

        const slide = this._getDistanceAlongBarrier(barrier, event);
        let distance = this._getDistanceAcrossBarrier(barrier, event);

        if (distance >= this._threshold) {
            this._trigger();
            return;
        }




        if (slide > distance)
            return;

        this._lastTime = event.time;

        this._trimBarrierEvents();
        distance = Math.min(15, distance);

        this._barrierEvents.push([event.time, distance]);
        this._currentPressure += distance;

        if (this._currentPressure >= this._threshold)
            this._trigger();
    }
}

const ScreenTransition = GObject.registerClass(
class ScreenTransition extends Clutter.Actor {
    _init() {
        super._init({visible: false});
    }

    vfunc_hide() {
        this.content = null;
        super.vfunc_hide();
    }

    run() {
        if (this.visible)
            return;

        Main.uiGroup.set_child_above_sibling(this, null);

        const rect = new Mtk.Rectangle({
            x: 0,
            y: 0,
            width: global.screen_width,
            height: global.screen_height,
        });
        const [, , , scale] = global.stage.get_capture_final_size(rect);
        this.content = global.stage.paint_to_content(rect, scale, null, Clutter.PaintFlag.NO_CURSORS);

        this.opacity = 255;
        this.show();

        this.ease({
            opacity: 0,
            duration: SCREEN_TRANSITION_DURATION,
            delay: SCREEN_TRANSITION_DELAY,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => this.hide(),
        });
    }
});
