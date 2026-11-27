


// contributors. Distributed under the GNU General Public License,


import cairo from 'cairo';

import {
    Clutter,
    Gio,
    GLib,
    GObject,
    Meta,
    Mtk,
    Shell,
    St,
} from './dependencies/gi.js';

import {
    AppDisplay,
    AppFavorites,
    BoxPointer,
    Dash,
    Main,
    PopupMenu,
} from './dependencies/shell/ui.js';

import {
    ParentalControlsManager,
    Util,
} from './dependencies/shell/misc.js';

import {
    AppIconIndicators,
    DBusMenuUtils,
    Docking,
    IconTint,
    Locations,
    TahoeClock,
    Theming,
    Utils,
    WindowPreview,
} from './imports.js';

import {Extension} from './dependencies/shell/extensions/extension.js';



const {gettext: __, ngettext} = Extension;

const DBusMenu = await DBusMenuUtils.haveDBusMenu();

let Blur = null;
try {
    Blur = (await import('gi://Blur')).default;
} catch (_) {}

const tracker = Shell.WindowTracker.get_default();

const Labels = Object.freeze({
    ISOLATE_MONITORS: Symbol('isolate-monitors'),
    ISOLATE_WORKSPACES: Symbol('isolate-workspaces'),
    URGENT_WINDOWS: Symbol('urgent-windows'),
});

let _cachedRunningComms = null;
let _cachedCommsTime = 0;

function getRunningProcessComms() {
    const now = GLib.get_monotonic_time();
    if (_cachedRunningComms && (now - _cachedCommsTime < 1500000))
        return _cachedRunningComms;

    const comms = new Set();
    try {
        const dir = Gio.File.new_for_path('/proc');
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (/^[0-9]+$/.test(name)) {
                try {
                    const [ok, comm] = GLib.file_get_contents(`/proc/${name}/comm`);
                    if (ok)
                        comms.add(new TextDecoder().decode(comm).trim());
                } catch (_) {}
            }
        }
    } catch (_) {}
    _cachedRunningComms = comms;
    _cachedCommsTime = now;
    return comms;
}

function isAppRunningInBackground(app, windowsCount) {
    if (!app)
        return false;
    if (windowsCount > 0)
        return true;
    if (app.state === Shell.AppState.RUNNING)
        return true;
    const pids = app.get_pids ? app.get_pids() : [];
    if (pids && pids.length > 0)
        return true;

    const id = app.get_id ? app.get_id() : '';
    if (id === 'launchpad.desktop' || id.startsWith('location:'))
        return false;

    const info = app.get_app_info ? app.get_app_info() : null;
    if (!info)
        return false;
    const exec = info.get_executable ? info.get_executable() : null;
    if (!exec)
        return false;
    const base = GLib.path_get_basename(exec);
    if (!base || base.endsWith('.sh'))
        return false;

    const comms = getRunningProcessComms();
    if (comms.has(base) || comms.has(base.slice(0, 15)))
        return true;

    if (base.includes('chrome') && (comms.has('chrome') || comms.has('google-chrome')))
        return true;
    if (base.includes('telegram') && (comms.has('telegram-deskto') || comms.has('Telegram')))
        return true;
    if (base.includes('steam') && (comms.has('steam') || comms.has('steamwebhelper')))
        return true;
    if (base.includes('opencode') && (comms.has('opencode') || comms.has('ai.opencode.desktop')))
        return true;

    return false;
}

const clickAction = Object.freeze({
    SKIP: 0,
    MINIMIZE: 1,
    LAUNCH: 2,
    CYCLE_WINDOWS: 3,
    MINIMIZE_OR_OVERVIEW: 4,
    PREVIEWS: 5,
    MINIMIZE_OR_PREVIEWS: 6,
    FOCUS_OR_PREVIEWS: 7,
    FOCUS_OR_APP_SPREAD: 8,
    FOCUS_MINIMIZE_OR_PREVIEWS: 9,
    FOCUS_MINIMIZE_OR_APP_SPREAD: 10,
    QUIT: 11,
});

const scrollAction = Object.freeze({
    DO_NOTHING: 0,
    CYCLE_WINDOWS: 1,
    SWITCH_WORKSPACE: 2,
});


const DASH_ITEM_LABEL_SHOW_TIME = Dash.DASH_ITEM_LABEL_SHOW_TIME ?? 150;
const DASH_ITEM_LABEL_HIDE_TIME = Dash.DASH_ITEM_LABEL_HIDE_TIME ?? 120;

let recentlyClickedAppLoopId = 0;
let recentlyClickedApp = null;
let recentlyClickedAppWindows = null;
let recentlyClickedAppIndex = 0;
let recentlyClickedAppMonitor = -1;













export const DockAbstractAppIcon = GObject.registerClass({
    GTypeFlags: GObject.TypeFlags.ABSTRACT,
    Properties: {
        'focused': GObject.ParamSpec.boolean(
            'focused', 'focused', 'focused',
            GObject.ParamFlags.READWRITE,
            false),
        'running': GObject.ParamSpec.boolean(
            'running', 'running', 'running',
            GObject.ParamFlags.READWRITE,
            false),
        'urgent': GObject.ParamSpec.boolean(
            'urgent', 'urgent', 'urgent',
            GObject.ParamFlags.READWRITE,
            false),
        'updating': GObject.ParamSpec.boolean(
            'updating', 'updating', 'updating',
            GObject.ParamFlags.READWRITE,
            false),
        'windows-count': GObject.ParamSpec.uint(
            'windows-count', 'windows-count', 'windows-count',
            GObject.ParamFlags.READWRITE,
            0, GLib.MAXUINT32, 0),
    },
}, class DockAbstractAppIcon extends Dash.DashIcon {

    _init(app, monitorIndex, iconAnimator) {
        super._init(app);

        if (this.icon)
            this.icon.translation_y = 0;


        this.monitorIndex = monitorIndex;
        this._signalsHandler = new Utils.GlobalSignalsHandler(this);
        this.iconAnimator = iconAnimator;
        this._indicator = new AppIconIndicators.AppIconIndicator(this);
        this._urgentWindows = new Set();



        if (this._stateChangedId > 0) {
            this.app.disconnect(this._stateChangedId);
            this._stateChangedId = 0;
        }

        this._signalsHandler.add(this.app, 'windows-changed', () => this._updateWindows());
        this._signalsHandler.add(this.app, 'notify::state', () => this._updateRunningState());
        this.connect('destroy', () => this._stopBackgroundWatcher());
        this._signalsHandler.add(global.display, 'window-demands-attention', (_dpy, window) =>
            this._onWindowDemandsAttention(window));
        this._signalsHandler.add(global.display, 'window-marked-urgent', (_dpy, window) =>
            this._onWindowDemandsAttention(window));






        if (Docking.DockManager.settings.isolateMonitors &&
            Main.layoutManager.monitors.length > 1) {
            this._signalsHandler.addWithLabel(Labels.ISOLATE_MONITORS,
                global.display,
                'window-entered-monitor',
                this._onWindowEntered.bind(this));
        }

        this.connect('notify::running', () => {
            if (this.running)
                this.add_style_class_name('running');
            else
                this.remove_style_class_name('running');
        });
        this.notify('running');

        this.connect('notify::focused', () => {
            if (this.focused)
                this.add_style_class_name('focused');
            else
                this.remove_style_class_name('focused');
        });
        this.notify('focused');

        this.connect('notify::updating', () => {
            if (this.updating)
                this.add_style_class_name('updating');
            else
                this.remove_style_class_name('updating');
        });
        this.notify('updating');

        const {notificationsMonitor} = Docking.DockManager.getDefault();

        this.connect('notify::urgent', () => {
            const icon = this.icon._iconBin;
            this._signalsHandler.removeWithLabel(Labels.URGENT_WINDOWS);
            if (this.urgent) {
                if (Docking.DockManager.settings.danceUrgentApplications &&
                    notificationsMonitor.enabled) {
                    icon.set_pivot_point(0.5, 0.5);
                    this.iconAnimator.addAnimation(icon, 'wiggle');
                }
                if (this.running && !this._urgentWindows.size) {
                    const urgentWindows = this.getInterestingWindows();
                    urgentWindows.forEach(w => (w._manualUrgency = true));
                    this._updateUrgentWindows(urgentWindows);
                }
            } else {
                this.iconAnimator.removeAnimation(icon, 'wiggle');
                icon.rotation_angle_z = 0;
                this._urgentWindows.forEach(w => delete w._manualUrgency);
                this._updateUrgentWindows();
            }
        });
        this.notify('urgent');

        this._progressOverlayArea = null;
        this._progress = 0;

        [
            'apply-custom-theme',
            'running-indicator-style',
            'show-icons-emblems',
            'show-icons-notifications-counter',
            'application-counter-overrides-notifications',
        ].forEach(key => {
            this._signalsHandler.add(
                Docking.DockManager.settings,
                `changed::${key}`, () => {
                    this._indicator.destroy();
                    this._indicator = new AppIconIndicators.AppIconIndicator(this);
                }
            );
        });

        this._signalsHandler.add(notificationsMonitor, 'state-changed', () => {
            this._indicator.destroy();
            this._indicator = new AppIconIndicators.AppIconIndicator(this);
        });

        this._updateState();
        this._numberOverlay();

        this._previewMenuManager = null;
        this._previewMenu = null;
    }

    _onDestroy() {
        super._onDestroy();




        this._menu?.close(false);
        delete this._menu;
    }

    ownsWindow(window) {
        return this.app === tracker.get_window_app(window);
    }

    _onWindowEntered(metaScreen, monitorIndex, metaWin) {
        if (this.ownsWindow(metaWin))
            this._updateWindows();
    }

    vfunc_scroll_event(scrollEvent) {
        const {settings} = Docking.DockManager;
        const isEnabled = settings.scrollAction === scrollAction.CYCLE_WINDOWS;
        if (!isEnabled)
            return Clutter.EVENT_PROPAGATE;




        if (!this.running)
            return Clutter.EVENT_PROPAGATE;

        if (this._optionalScrollCycleWindowsDeadTimeId) {
            return Clutter.EVENT_PROPAGATE;
        } else {
            this._optionalScrollCycleWindowsDeadTimeId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, 250, () => {
                    this._optionalScrollCycleWindowsDeadTimeId = 0;
                });
        }

        let direction = null;

        switch (scrollEvent.direction) {
        case Clutter.ScrollDirection.UP:
            direction = Meta.MotionDirection.UP;
            break;
        case Clutter.ScrollDirection.DOWN:
            direction = Meta.MotionDirection.DOWN;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [, dy] = Clutter.get_current_event().get_scroll_delta();
            if (dy < 0)
                direction = Meta.MotionDirection.UP;
            else if (dy > 0)
                direction = Meta.MotionDirection.DOWN;
        }
            break;
        }

        if (!Main.overview.visible) {
            const reversed = direction === Meta.MotionDirection.UP;
            if (this.focused && !this._urgentWindows.size) {
                this._cycleThroughWindows(reversed);
            } else {

                const windows = this.getInterestingWindows();
                if (windows.length > 0) {
                    const [w] = windows;
                    Main.activateWindow(w);
                }
            }
        } else {
            this.app.activate();
        }
        return Clutter.EVENT_STOP;
    }

    _updateWindows() {
        if (this._menu && this._menu.isOpen)
            this._menu.update();

        this._updateState();
        this.updateIconGeometry();
    }

    _updateState() {
        this._urgentWindows.clear();
        const interestingWindows = this.getInterestingWindows();
        this.windowsCount = interestingWindows.length;
        this._updateRunningState();
        this._updateFocusState();
        this._updateUrgentWindows(interestingWindows);

        if (Docking.DockManager.settings.isolateWorkspaces) {
            this._signalsHandler.removeWithLabel(Labels.ISOLATE_WORKSPACES);
            interestingWindows.forEach(window =>
                this._signalsHandler.addWithLabel(Labels.ISOLATE_WORKSPACES,
                    window, 'workspace-changed', () => this._updateWindows()));
        }
    }

    _startBackgroundWatcher() {
        if (this._bgWatcherId)
            return;
        this._bgWatcherId = GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
            if (!this.running || this.windowsCount > 0) {
                this._bgWatcherId = 0;
                return GLib.SOURCE_REMOVE;
            }
            _cachedRunningComms = null;
            const stillRunning = isAppRunningInBackground(this.app, this.windowsCount);
            if (!stillRunning) {
                this.running = false;
                this._bgWatcherId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopBackgroundWatcher() {
        if (this._bgWatcherId) {
            GLib.source_remove(this._bgWatcherId);
            this._bgWatcherId = 0;
        }
    }

    _updateRunningState() {
        this.running = isAppRunningInBackground(this.app, this.windowsCount);
        if (this.running && this.windowsCount === 0)
            this._startBackgroundWatcher();
        else
            this._stopBackgroundWatcher();
    }

    _updateFocusState() {
        this.focused = tracker.focus_app === this.app && this.running;
    }

    _updateUrgentWindows(interestingWindows) {
        this._signalsHandler.removeWithLabel(Labels.URGENT_WINDOWS);
        this._urgentWindows.clear();
        if (interestingWindows === undefined)
            interestingWindows = this.getInterestingWindows();
        interestingWindows.filter(isWindowUrgent).forEach(win => this._addUrgentWindow(win));
        this.urgent = !!this._urgentWindows.size;
    }

    _onWindowDemandsAttention(window) {
        if (this.ownsWindow(window) && isWindowUrgent(window))
            this._addUrgentWindow(window);
    }

    _updateDotStyle() {
        super._updateDotStyle();
        const themeNode = this._dot.get_theme_node();
        this._dot.translationX = themeNode.get_length('offset-x');
    }

    _addUrgentWindow(window) {
        if (this._urgentWindows.has(window))
            return;

        if (window._manualUrgency && window.has_focus()) {
            delete window._manualUrgency;
            return;
        }

        this._urgentWindows.add(window);
        this.urgent = true;

        const onDemandsAttentionChanged = () => {
            if (!isWindowUrgent(window))
                this._updateUrgentWindows();
        };

        if (window.demandsAttention) {
            this._signalsHandler.addWithLabel(Labels.URGENT_WINDOWS, window,
                'notify::demands-attention', () => onDemandsAttentionChanged());
        }
        if (window.urgent) {
            this._signalsHandler.addWithLabel(Labels.URGENT_WINDOWS, window,
                'notify::urgent', () => onDemandsAttentionChanged());
        }
        if (window._manualUrgency) {
            this._signalsHandler.addWithLabel(Labels.URGENT_WINDOWS, window,
                'focus', () => {
                    delete window._manualUrgency;
                    onDemandsAttentionChanged();
                });
        }
    }




    updateIconGeometry() {




        if (!this.get_stage())
            return;

        const rect = new Mtk.Rectangle();






        let baseX = 0, baseY = 0;
        let ancestor = this;
        while (ancestor && ancestor.name !== 'dash') {
            baseX += ancestor.allocation.x1;
            baseY += ancestor.allocation.y1;
            ancestor = ancestor.get_parent();
        }
        if (ancestor) {
            const [dashX, dashY] = ancestor.get_transformed_position();
            rect.x = Math.round(dashX + baseX);
            rect.y = Math.round(dashY + baseY);
            rect.width = Math.round(this.allocation.get_width());
            rect.height = Math.round(this.allocation.get_height());
        } else {
            [rect.x, rect.y] = this.get_transformed_position();
            [rect.width, rect.height] = this.get_transformed_size();
        }

        let windows = this.getWindows();
        if (Docking.DockManager.settings.multiMonitor) {
            const {monitorIndex} = this;
            windows = windows.filter(w => w.get_monitor() === monitorIndex);
        }
        windows.forEach(w => w.set_icon_geometry(rect));
    }

    _updateRunningStyle() {



    }

    notifyAppIconUpdating(monitorIndex) {
        const icon = Gio.Icon.new_for_string('action-unavailable-symbolic');
        const {osdWindowManager} = Main;
        const showOsd = osdWindowManager.showOne ?? osdWindowManager.show;
        showOsd.call(osdWindowManager, monitorIndex ?? this.monitorIndex, icon,
            _('%s is updating, try again later').format(this.name), null);
    }

    popupMenu() {
        this._removeMenuTimeout?.();
        this.fake_release();
        this._draggable.fakeRelease?.();

        if (!this._menu) {
            this._menu = new DockAppIconMenu(this);
            this._menu.connect('activate-window', (menu, window) => {
                if (window) {
                    Main.activateWindow(window);
                } else {
                    Main.overview.hide();
                    Main.panel.closeCalendar();
                }
            });
            this._menu.connect('open-state-changed', (menu, isPoppedUp) => {
                if (!isPoppedUp) {
                    this._onMenuPoppedDown();
                } else {


                    const monitorIndex = Main.layoutManager.findIndexForActor(this);
                    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
                    const position = Utils.getPosition();
                    const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
                    const isHorizontal = position === St.Side.TOP || position === St.Side.BOTTOM;

                    const {dockFixed: fixedDock} = Docking.DockManager.settings;
                    const additionalMargin = isHorizontal && !fixedDock ? Main.overview.dash.height : 0;
                    const verticalMargins = this._menu.actor.margin_top + this._menu.actor.margin_bottom;
                    const maxMenuHeight = workArea.height - additionalMargin - verticalMargins;

                    this._menu.actor.style = 'max-width: 400px; ' +
                        `max-height: ${Math.round(maxMenuHeight / scaleFactor)}px;`;
                }
            });
            const id = Main.overview.connect('hiding', () => {
                this._menu.close();
            });
            this._menu.actor.connect('destroy', () => {
                Main.overview.disconnect(id);
            });

            this._menuManager.addMenu(this._menu);
        }

        this.emit('menu-state-changed', true);

        this.set_hover(true);
        this._menu.popup();

        this._menuManager.ignoreRelease?.();
        this.emit('sync-tooltip');

        return false;
    }

    activate(button) {
        const event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;


        modifiers &= Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK;



        if (modifiers & Clutter.ModifierType.CONTROL_MASK) {



            super.activate(button);
            return;
        }




        let buttonAction = 0;
        const {settings} = Docking.DockManager;
        if (button && button === 2) {
            if (modifiers & Clutter.ModifierType.SHIFT_MASK)
                buttonAction = settings.shiftMiddleClickAction;
            else
                buttonAction = settings.middleClickAction;
        } else if (button && button === 1) {
            if (modifiers & Clutter.ModifierType.SHIFT_MASK)
                buttonAction = settings.shiftClickAction;
            else
                buttonAction = settings.clickAction;
        }

        switch (buttonAction) {
        case clickAction.FOCUS_OR_APP_SPREAD:
            if (!Docking.DockManager.getDefault().appSpread.supported)
                buttonAction = clickAction.FOCUS_OR_PREVIEWS;
            break;

        case clickAction.FOCUS_MINIMIZE_OR_APP_SPREAD:
            if (!Docking.DockManager.getDefault().appSpread.supported)
                buttonAction = clickAction.FOCUS_MINIMIZE_OR_PREVIEWS;
            break;
        }



        const windows = this.getInterestingWindows();



        let shouldHideOverview = true;



        if (this.running && windows.length === 0) {
            const allWindows = this.getWindows();
            if (allWindows.length > 0)
                Main.activateWindow(allWindows[0]);
            this._activateFromBackground();
            if (shouldHideOverview)
                Main.overview.hide();
            return;
        }


        if (this.running) {
            const hasUrgentWindows = !!this._urgentWindows.size;
            const singleOrUrgentWindows = windows.length === 1 || hasUrgentWindows;
            switch (buttonAction) {
            case clickAction.MINIMIZE:


                if (!Main.overview.visible || modifiers) {


                    if (this.focused && !hasUrgentWindows || button === 2 ||
                        modifiers & Clutter.ModifierType.SHIFT_MASK) {


                        let clickCount = 0;
                        if (Clutter.EventType.CLUTTER_BUTTON_PRESS)
                            clickCount = event.get_click_count();
                        const allWindows = (button === 1 && !modifiers) || clickCount > 1;
                        this._minimizeWindow(allWindows);
                    } else {
                        this._activateAllWindows();
                    }
                } else {
                    const [w] = windows;
                    if (w) Main.activateWindow(w);
                }
                break;

            case clickAction.MINIMIZE_OR_OVERVIEW:




                if (singleOrUrgentWindows && !modifiers && button === 1) {
                    const [w] = windows;
                    if (this.focused) {
                        if (buttonAction !== clickAction.FOCUS_OR_APP_SPREAD) {

                            this._minimizeWindow(w);
                        }
                    } else {

                        if (w) Main.activateWindow(w);
                    }


                } else {
                    shouldHideOverview = false;
                    Main.overview.toggle();
                }
                break;

            case clickAction.CYCLE_WINDOWS:
                if (!Main.overview.visible) {
                    if (this.focused && !hasUrgentWindows) {
                        this._cycleThroughWindows();
                    } else {

                        const [w] = windows;
                        if (w) Main.activateWindow(w);
                    }
                } else {
                    this.app.activate();
                }
                break;

            case clickAction.FOCUS_OR_PREVIEWS:
                if (this.focused && !hasUrgentWindows &&
                    (windows.length > 1 || modifiers || button !== 1)) {
                    this._windowPreviews();
                } else {

                    const [w] = windows;
                    if (w) Main.activateWindow(w);
                }
                break;

            case clickAction.FOCUS_MINIMIZE_OR_PREVIEWS:
                if (this.focused && !hasUrgentWindows) {
                    if (windows.length > 1 || modifiers || button !== 1)
                        this._windowPreviews();
                    else if (!Main.overview.visible)
                        this._minimizeWindow();
                } else {

                    const [w] = windows;
                    if (w) Main.activateWindow(w);
                }
                break;

            case clickAction.LAUNCH:
                this.launchNewWindow();
                break;

            case clickAction.PREVIEWS:
                if (!Main.overview.visible) {



                    if (singleOrUrgentWindows && !modifiers && button === 1) {
                        const [w] = windows;
                        if (w) Main.activateWindow(w);
                    } else {
                        this._windowPreviews();
                    }
                } else {
                    this.app.activate();
                }
                break;

            case clickAction.MINIMIZE_OR_PREVIEWS:




                if (!Main.overview.visible) {
                    if (singleOrUrgentWindows && !modifiers && button === 1) {
                        const [w] = windows;
                        if (this.focused) {

                            this._minimizeWindow(w);
                        } else {

                            if (w) Main.activateWindow(w);
                        }
                    } else {

                        this._windowPreviews();
                    }
                } else {
                    this.app.activate();
                }
                break;

            case clickAction.FOCUS_OR_APP_SPREAD:
                if (this.focused && !singleOrUrgentWindows && !modifiers && button === 1) {
                    shouldHideOverview = false;
                    Docking.DockManager.getDefault().appSpread.toggle(this.app);
                } else {

                    if (windows[0]) Main.activateWindow(windows[0]);
                }
                break;

            case clickAction.FOCUS_MINIMIZE_OR_APP_SPREAD:
                if (this.focused && !singleOrUrgentWindows && !modifiers && button === 1) {
                    shouldHideOverview = false;
                    Docking.DockManager.getDefault().appSpread.toggle(this.app);
                } else if (!this.focused) {

                    if (windows[0]) Main.activateWindow(windows[0]);
                } else {
                    this._minimizeWindow();
                }
                break;

            case clickAction.QUIT:
                this.closeAllWindows();
                break;

            case clickAction.SKIP:
                if (windows[0]) Main.activateWindow(windows[0]);
                break;
            }
        } else {
            this.launchNewWindow();
        }


        if (shouldHideOverview)
            Main.overview.hide();
    }

    shouldShowTooltip() {
        return super.shouldShowTooltip() && !this._previewMenu?.isOpen &&
            !Docking.DockManager.settings.hideTooltip;
    }

    _windowPreviews() {
        if (!this._previewMenu) {
            this._previewMenuManager = new PopupMenu.PopupMenuManager(this);

            this._previewMenu = new WindowPreview.WindowPreviewMenu(this);

            this._previewMenuManager.addMenu(this._previewMenu);

            this._previewMenu.connect('open-state-changed', (menu, isPoppedUp) => {
                if (!isPoppedUp)
                    this._onMenuPoppedDown();
            });
            const id = Main.overview.connect('hiding', () => {
                this._previewMenu.close();
            });
            this._previewMenu.actor.connect('destroy', () => {
                Main.overview.disconnect(id);
            });
        }

        this.emit('menu-state-changed', !this._previewMenu.isOpen);

        if (this._previewMenu.isOpen)
            this._previewMenu.close();
        else
            this._previewMenu.popup();

        return false;
    }




    _createIcon(iconSize) {


        if (TahoeClock.isClockApp(this.app)) {
            try {
                return TahoeClock.createClockIcon(iconSize, Utils.getIconOversample());
            } catch (e) {
                console.error(`[dash2dock] clock icon failed, falling back: ${e}`);
            }
        }
        const icon = this.app.create_icon_texture(
            iconSize * Utils.getIconOversample());
        icon.set_size(iconSize, iconSize);


        try {
            if (typeof icon.set_content_scaling_filters === 'function') {
                icon.set_content_scaling_filters(
                    Clutter.ScalingFilter.TRILINEAR,
                    Clutter.ScalingFilter.LINEAR
                );
            }
            icon.connect('notify::content', () => {
                try {
                    icon.set_content_scaling_filters(
                        Clutter.ScalingFilter.TRILINEAR,
                        Clutter.ScalingFilter.LINEAR
                    );
                } catch (_) {}
            });
            icon.connect('child-added', (_, child) => {
                try {
                    if (typeof child.set_content_scaling_filters === 'function') {
                        child.set_content_scaling_filters(
                            Clutter.ScalingFilter.TRILINEAR,
                            Clutter.ScalingFilter.LINEAR
                        );
                    }
                } catch (_) {}
            });
            if (typeof icon.get_children === 'function') {
                icon.get_children().forEach(child => {
                    try {
                        if (typeof child.set_content_scaling_filters === 'function') {
                            child.set_content_scaling_filters(
                                Clutter.ScalingFilter.TRILINEAR,
                                Clutter.ScalingFilter.LINEAR
                            );
                        }
                    } catch (_) {}
                });
            }
        } catch (_) {}


        const unwatch = IconTint.watchIconTint(() => IconTint.refreshIconTint(icon));
        icon.connect('destroy', () => {
            try {
                if (unwatch)
                    unwatch();
            } catch (e) {

            }
        });
        IconTint.refreshIconTint(icon);
        return icon;
    }



    animateLaunch() {
        const cupertinoExt = Main.extensionManager?.lookup?.('cupertino-dock-lite@rinzler69-wastaken.github.com');
        if (cupertinoExt?.stateObj?.animator)
            return;

        const position = Utils.getPosition();
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        const travel = (this.icon?.iconSize ?? 48) * 0.55 * scaleFactor;

        let prop, dir;
        switch (position) {
        case St.Side.TOP:
            prop = 'translation_y';
            dir = 1;
            break;
        case St.Side.LEFT:
            prop = 'translation_x';
            dir = 1;
            break;
        case St.Side.RIGHT:
            prop = 'translation_x';
            dir = -1;
            break;
        case St.Side.BOTTOM:
        default:
            prop = 'translation_y';
            dir = -1;
            break;
        }

        this.remove_transition(prop.replace(/_/g, '-'));
        const label = this.label ?? this.get_parent?.()?.label;
        const tail = label?._arrowTailActor;
        if (label) label.remove_transition(prop.replace(/_/g, '-'));
        if (tail) tail.remove_transition(prop.replace(/_/g, '-'));

        this.ease({
            [prop]: dir * travel,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.ease({
                    [prop]: 0,
                    duration: 600,
                    mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                });
            },
        });
        if (label) {
            label.ease({
                [prop]: dir * travel,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    label.ease({
                        [prop]: 0,
                        duration: 600,
                        mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                    });
                },
            });
        }
        if (tail) {
            tail.ease({
                [prop]: dir * travel,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    tail.ease({
                        [prop]: 0,
                        duration: 600,
                        mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                    });
                },
            });
        }
    }

    _activateFromBackground() {
        this.animateLaunch();


        let indicatorActivated = false;
        try {
            const appId = (this.app.get_id() || '').toLowerCase();
            const appName = (this.app.get_name() || '').toLowerCase();
            const appInfo = this.app.get_app_info();
            const execPath = appInfo && appInfo.get_executable ? appInfo.get_executable() : '';
            const baseExec = execPath ? GLib.path_get_basename(execPath).toLowerCase() : '';

            const clean = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cAppId = clean(appId);
            const cAppName = clean(appName);
            const cExec = clean(baseExec);

            const sa = Main.panel?.statusArea;
            if (sa) {
                for (const [key, item] of Object.entries(sa)) {
                    if (!item || !item._indicator)
                        continue;
                    const cId = clean(item._indicator.id);
                    const cTitle = clean(item._indicator.title);

                    const isMatch = (
                        (cId && (cAppId.includes(cId) || cId.includes(cExec) || (cExec && cExec.includes(cId)))) ||
                        (cTitle && (cAppName.includes(cTitle) || cTitle.includes(cAppName))) ||
                        (cAppId.includes('telegram') && cId.includes('telegram')) ||
                        (cAppId.includes('steam') && cId.includes('steam')) ||
                        (cAppId.includes('discord') && cId.includes('discord'))
                    );

                    if (isMatch) {
                        if (typeof item._indicator.open === 'function') {
                            item._indicator.open(0, 0, 0);
                            indicatorActivated = true;
                        } else if (item._indicator._proxy && typeof item._indicator._proxy.ActivateAsync === 'function') {
                            item._indicator._proxy.ActivateAsync(0, 0, null).catch?.(() => {});
                            indicatorActivated = true;
                        }

                        if (!indicatorActivated && item.menu && typeof item.menu._getMenuItems === 'function') {
                            const menuItems = item.menu._getMenuItems();
                            const openItem = menuItems.find(mi => {
                                const text = (mi.label?.text || mi._label?.text || '').toLowerCase().trim();
                                return /^(відкрити|показати|open|show|main|головне|вікно|window|library|бібліотека)/i.test(text);
                            });
                            if (openItem && typeof openItem.activate === 'function') {
                                openItem.activate(Clutter.get_current_event());
                                indicatorActivated = true;
                            }
                        }
                    }
                }
            }
        } catch (_) {}


        try {
            if (this.app.state === Shell.AppState.RUNNING && this.app.can_open_new_window()) {
                this.app.open_new_window(-1);
            } else {
                this.app.activate();
            }
        } catch (_) {
            try { this.app.activate(); } catch (_) {}
        }
    }




    launchNewWindow() {
        if (this.updating) {
            this.notifyAppIconUpdating();
            return;
        }

        if (this.app.state === Shell.AppState.RUNNING &&
            this.app.can_open_new_window()) {
            this.animateLaunch();
            this.app.open_new_window(-1);
        } else {



            const windows = this.getWindows();
            if (windows.length > 0) {
                Main.activateWindow(windows[0]);
            } else {
                this.app.activate();
                this.animateLaunch();
            }
        }
    }

    _numberOverlay() {

        this._numberOverlayLabel = new St.Label();
        this._numberOverlayBin = new St.Bin({
            child: this._numberOverlayLabel,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: true, y_expand: true,
        });
        this._numberOverlayLabel.add_style_class_name('number-overlay');
        this._numberOverlayOrder = -1;
        this._numberOverlayBin.hide();

        this._iconContainer.add_child(this._numberOverlayBin);
    }

    updateNumberOverlay() {



        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;


        const [minWidth_, natWidth] = this._iconContainer.get_preferred_width(-1);
        const fontSize = Math.round(Math.max(12, 0.3 * natWidth) / scaleFactor);
        const size = Math.round(fontSize * 1.2);
        this._numberOverlayLabel.set_style(
            `font-size: ${fontSize}px;` +
           `border-radius: ${this.icon.iconSize}px;` +
           `width: ${size}px; height: ${size}px;`
        );
    }

    setNumberOverlay(number) {
        this._numberOverlayOrder = number;
        this._numberOverlayLabel.set_text(number.toString());
    }

    toggleNumberOverlay(activate) {
        if (activate && this._numberOverlayOrder > -1) {
            this.updateNumberOverlay();
            this._numberOverlayBin.show();
        } else {
            this._numberOverlayBin.hide();
        }
    }

    _minimizeWindow(param) {

        const windows = this.getInterestingWindows();
        const currentWorkspace = global.workspace_manager.get_active_workspace();
        for (let i = 0; i < windows.length; i++) {
            const w = windows[i];
            if (w.get_workspace() === currentWorkspace && w.showing_on_its_workspace()) {
                w.minimize();


                if (!param)
                    break;
            }
        }
    }



    _activateAllWindows() {


        if (!Docking.DockManager.settings.isolateWorkspaces &&
            !Docking.DockManager.settings.isolateMonitors) {
            if (!this.running)
                this.animateLaunch();
            this.app.activate();
        }


        const windows = this.getInterestingWindows();
        const activeWorkspace = global.workspace_manager.get_active_workspace_index();

        if (windows.length <= 0)
            return;

        for (let i = windows.length - 1; i >= 0; i--) {
            if (windows[i].get_workspace()?.index() === activeWorkspace)
                Main.activateWindow(windows[i]);
        }
    }


    closeAllWindows() {
        const windows = this.getInterestingWindows();
        const time = global.get_current_time();
        windows.forEach(w => w.delete(time));
    }

    _cycleThroughWindows(reversed) {


        const MEMORY_TIME = 3000;

        const appWindows = this.getInterestingWindows();

        if (appWindows.length < 1)
            return;

        if (recentlyClickedAppLoopId > 0)
            GLib.source_remove(recentlyClickedAppLoopId);
        recentlyClickedAppLoopId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, MEMORY_TIME, this._resetRecentlyClickedApp);



        const monitorIsolation = Docking.DockManager.settings.isolateMonitors;
        if (!recentlyClickedApp ||
            recentlyClickedApp.get_id() !== this.app.get_id() ||
            recentlyClickedAppWindows.length !== appWindows.length ||
            (recentlyClickedAppMonitor !== this.monitorIndex && monitorIsolation)) {
            recentlyClickedApp = this.app;
            recentlyClickedAppWindows = appWindows;
            recentlyClickedAppMonitor = this.monitorIndex;
            recentlyClickedAppIndex = 0;
        }

        if (reversed) {
            recentlyClickedAppIndex--;
            if (recentlyClickedAppIndex < 0)
                recentlyClickedAppIndex = recentlyClickedAppWindows.length - 1;
        } else {
            recentlyClickedAppIndex++;
        }
        const index = recentlyClickedAppIndex % recentlyClickedAppWindows.length;
        const window = recentlyClickedAppWindows[index];

        Main.activateWindow(window);
    }

    _resetRecentlyClickedApp() {
        if (recentlyClickedAppLoopId > 0)
            GLib.source_remove(recentlyClickedAppLoopId);
        recentlyClickedAppLoopId = 0;
        recentlyClickedApp = null;
        recentlyClickedAppWindows = null;
        recentlyClickedAppIndex = 0;
        recentlyClickedAppMonitor = -1;

        return false;
    }

    getWindows() {
        return this.app.get_windows();
    }



    getInterestingWindows() {
        const interestingWindows = getInterestingWindows(this.getWindows(),
            this.monitorIndex);

        if (!this._urgentWindows.size)
            return interestingWindows;

        return [...new Set([...this._urgentWindows, ...interestingWindows])];
    }

    getSnapName() {
        return this.app.appInfo?.get_string('X-SnapInstanceName');
    }
});

const DockAppIcon = GObject.registerClass({
}, class DockAppIcon extends DockAbstractAppIcon {
    _init(app, monitorIndex, iconAnimator) {
        super._init(app, monitorIndex, iconAnimator);

        this._signalsHandler.add(tracker, 'notify::focus-app', () => this._updateFocusState());
    }
});

const DockLocationAppIcon = GObject.registerClass({
}, class DockLocationAppIcon extends DockAbstractAppIcon {
    _init(app, monitorIndex, iconAnimator) {
        if (!(app.appInfo instanceof Locations.LocationAppInfo))
            throw new Error('Provided application %s is not a Location'.format(app));

        super._init(app, monitorIndex, iconAnimator);

        if (Docking.DockManager.settings.isolateLocations) {
            this._signalsHandler.add(tracker, 'notify::focus-app', () => this._updateFocusState());
        } else {
            this._signalsHandler.add(global.display, 'notify::focus-window',
                () => this._updateFocusState());
        }

        this._signalsHandler.add(this.app, 'notify::icon', () => this.icon.update());
    }

    get location() {
        return this.app.location;
    }

    _updateFocusState() {
        if (Docking.DockManager.settings.isolateLocations) {
            super._updateFocusState();
            return;
        }

        this.focused = this.app.isFocused && this.running;
    }
});






export function makeAppIcon(app, monitorIndex, iconAnimator) {
    let iconActor;
    if (app.appInfo instanceof Locations.LocationAppInfo)
        iconActor = new DockLocationAppIcon(app, monitorIndex, iconAnimator);
    else
        iconActor = new DockAppIcon(app, monitorIndex, iconAnimator);

    if (iconActor.icon)
        iconActor.icon.translation_y = 0;

    return iconActor;
}










const DockAppIconMenu = class DockAppIconMenu extends PopupMenu.PopupMenu {
    constructor(source) {
        super(source, 0.5, Utils.getPosition());

        this._signalsHandler = new Utils.GlobalSignalsHandler(this);


        this.blockSourceEvents = true;

        this.actor.add_style_class_name('app-menu');
        this.actor.add_style_class_name('dock-app-menu');


        this._signalsHandler.add(source, 'notify::mapped', () => {
            if (!source.mapped)
                this.close();
        });
        source.connect('destroy', () => this.destroy());

        Main.uiGroup.add_child(this.actor);

        const {remoteModel} = Docking.DockManager.getDefault();
        const remoteModelApp = remoteModel?.lookupById(this.sourceActor?.app?.id);
        if (remoteModelApp && DBusMenu) {
            const [onQuickList, onDynamicSection] = Utils.splitHandler((sender,
                {quicklist}, dynamicSection) => {
                dynamicSection.removeAll();
                if (quicklist) {
                    quicklist.get_children().forEach(remoteItem =>
                        dynamicSection.addMenuItem(
                            DBusMenuUtils.makePopupMenuItem(remoteItem, false)));
                }
            });

            this._signalsHandler.add([
                remoteModelApp,
                'quicklist-changed',
                onQuickList,
            ], [
                this,
                'dynamic-section-changed',
                onDynamicSection,
            ]);
        }
    }

    destroy() {
        super.destroy();
        delete this.sourceActor;
        delete this._signalsHandler;
    }

    _appendSeparator() {
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _appendMenuItem(labelText, params) {
        const item = new PopupMenu.PopupMenuItem(labelText, params);
        this.addMenuItem(item);
        return item;
    }

    popup(_activatingButton) {
        this._rebuildMenu();
        this.open(BoxPointer.PopupAnimation.FULL);
    }

    removeAll() {
        super.removeAll();

        delete this._allWindowsMenuItem;
        delete this._quitMenuItem;
    }

    _rebuildMenu() {
        this.removeAll();

        if (this.sourceActor.updating) {
            const appItemLabel = _('%s is being updated…').format(this.sourceActor.name);
            this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(appItemLabel));
        }

        const {app} = this.sourceActor;

        if (Docking.DockManager.settings.showWindowsPreview) {


            const windows = this.sourceActor.getInterestingWindows();

            this._allWindowsMenuItem = new PopupMenu.PopupSubMenuMenuItem(__('All Windows'), false);
            if (this._allWindowsMenuItem.menu?.actor)
                this._allWindowsMenuItem.menu.actor.overlayScrollbars = true;
            this._allWindowsMenuItem.hide();
            if (windows.length > 0)
                this.addMenuItem(this._allWindowsMenuItem);
        } else {
            const windows = this.sourceActor.getInterestingWindows();

            windows.forEach(window => {
                const title = window.title ? window.title : app.get_name();
                const item = this._appendMenuItem(title);
                item.connect('activate', () => {
                    this.emit('activate-window', window);
                });
            });
        }

        if (!app.is_window_backed()) {
            const windows = this.sourceActor.getInterestingWindows();
            if (windows.length > 0)
                this._appendSeparator();

            const appInfo = app.get_app_info();
            const actions = this.sourceActor.updating ? [] : appInfo.list_actions();
            if (!this.sourceActor.updating &&
                app.can_open_new_window() &&
                actions.indexOf('new-window') === -1) {
                const newMenuItem = this._appendMenuItem(_('New Window'));
                newMenuItem.connect('activate', () => {
                    if (app.state === Shell.AppState.STOPPED)
                        this.sourceActor.animateLaunch();

                    app.open_new_window(-1);
                    this.emit('activate-window', null);
                });
                this._appendSeparator();
            }

            if (!this.sourceActor.updating &&
                Docking.DockManager.getDefault().discreteGpuAvailable &&
                app.state === Shell.AppState.STOPPED) {
                const appPrefersNonDefaultGPU = appInfo.get_boolean('PrefersNonDefaultGPU');
                const gpuPref = appPrefersNonDefaultGPU
                    ? Shell.AppLaunchGpu.DEFAULT
                    : Shell.AppLaunchGpu.DISCRETE;
                const gpuMenuItem = this._appendMenuItem(appPrefersNonDefaultGPU
                    ? _('Launch using Integrated Graphics Card')
                    : _('Launch using Discrete Graphics Card'));
                gpuMenuItem.connect('activate', () => {
                    this.sourceActor.animateLaunch();
                    app.launch(0, -1, gpuPref);
                    this.emit('activate-window', null);
                });
            }

            for (let i = 0; i < actions.length; i++) {
                const action = actions[i];
                const item = this._appendMenuItem(appInfo.get_action_name(action));
                item.sensitive = !appInfo.busy;
                item.connect('activate', (emitter, event) => {
                    app.launch_action(action, event.get_time(), -1);
                    this.emit('activate-window', null);
                });
            }

            const canFavorite = global.settings.is_writable('favorite-apps') &&
                (this.sourceActor instanceof DockAppIcon) &&
                ParentalControlsManager.getDefault().shouldShowApp(app.appInfo);

            if (canFavorite) {
                this._appendSeparator();

                const isFavorite = AppFavorites.getAppFavorites().isFavorite(app.get_id());
                if (isFavorite) {
                    const item = this._appendMenuItem(_('Unpin'));
                    item.connect('activate', () => {
                        const favs = AppFavorites.getAppFavorites();
                        favs.removeFavorite(app.get_id());
                    });
                } else {
                    const item = this._appendMenuItem(__('Pin to Dock'));
                    item.connect('activate', () => {
                        const favs = AppFavorites.getAppFavorites();
                        favs.addFavorite(app.get_id());
                    });
                }
            }

            if (Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop') &&
                this.sourceActor instanceof DockAppIcon &&
                !this.sourceActor.getSnapName()) {
                this._appendSeparator();
                const item = this._appendMenuItem(_('App Details'));
                item.connect('activate', () => {
                    const id = app.get_id();
                    const args = GLib.Variant.new('(ss)', [id, '']);
                    Gio.DBus.get(Gio.BusType.SESSION, null,
                        (o, res) => {
                            const bus = Gio.DBus.get_finish(res);
                            bus.call('org.gnome.Software',
                                '/org/gnome/Software',
                                'org.gtk.Actions', 'Activate',
                                GLib.Variant.new('(sava{sv})',
                                    ['details', [args], null]),
                                null, 0, -1, null, null);
                            Main.overview.hide();
                        });
                });
            }

            if (this.sourceActor instanceof DockAppIcon) {
                const snapName = this.sourceActor.getSnapName();
                const snapStore = snapName
                    ? Shell.AppSystem.get_default().lookup_app(
                        'snap-store_snap-store.desktop') : null;

                if (snapStore) {
                    this._appendSeparator();
                    const item = this._appendMenuItem(_('App Details'));
                    item.connect('activate', (_, event) => {
                        snapStore.activate_full(-1, event.get_time());
                        Util.spawnApp(
                            [...snapStore.appInfo.get_commandline().split(' '), snapName]);
                        Main.overview.hide();
                    });
                }
            }
        }


        const items = this._getMenuItems();
        let i = items.length;
        if (Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop'))
            i -= 2;

        if (global.settings.is_writable('favorite-apps'))
            i -= 2;

        if (i < 0)
            i = 0;

        const dynamicSection = new PopupMenu.PopupMenuSection();
        this.addMenuItem(dynamicSection, i);
        this.emit('dynamic-section-changed', dynamicSection);


        this._appendSeparator();
        this._quitMenuItem = this._appendMenuItem(_('Quit'));
        this._quitMenuItem.connect('activate', () => this.sourceActor.closeAllWindows());

        this.update();
    }



    update() {

        if (this.sourceActor.windowsCount > 0) {
            if (this.sourceActor.windowsCount === 1) {
                this._quitMenuItem.label.set_text(_('Quit'));
            } else {
                this._quitMenuItem.label.set_text(ngettext(
                    'Quit %d Window', 'Quit %d Windows', this.sourceActor.windowsCount).format(
                    this.sourceActor.windowsCount));
            }

            this._quitMenuItem.actor.show();
        } else {
            this._quitMenuItem.actor.hide();
        }

        if (Docking.DockManager.settings.showWindowsPreview) {
            const windows = this.sourceActor.getInterestingWindows();





            const oldWindows = this._allWindowsMenuItem.menu._getMenuItems().map(item => {
                return item._window;
            });

            const newWindows = windows.filter(w =>
                oldWindows.indexOf(w) < 0);
            if (newWindows.length > 0) {
                this._populateAllWindowMenu(windows);




                this._allWindowsMenuItem.width =  this._allWindowsMenuItem.menu.actor.width + 15;
            }




            if (windows.length > 0) {
                this._allWindowsMenuItem.show();
                this._allWindowsMenuItem.setSensitive(true);

                if (Docking.DockManager.settings.defaultWindowsPreviewToOpen)
                    this._allWindowsMenuItem.menu.open();
            }
        }


        this._getMenuItems().forEach(item => {
            if ('label' in item)
                this._updateSeparatorVisibility(item);
        });
    }

    _populateAllWindowMenu(windows) {
        this._allWindowsMenuItem.menu.removeAll();

        if (windows.length > 0) {
            const activeWorkspace = global.workspace_manager.get_active_workspace();
            let separatorShown =  windows[0].get_workspace() !== activeWorkspace;

            for (let i = 0; i < windows.length; i++) {
                const window = windows[i];
                if (!separatorShown && window.get_workspace() !== activeWorkspace) {
                    this._allWindowsMenuItem.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    separatorShown = true;
                }

                const item = new WindowPreview.WindowPreviewMenuItem(window,
                    St.Side.LEFT);
                this._allWindowsMenuItem.menu.addMenuItem(item);
                item.connect('activate', () => {
                    this.emit('activate-window', window);
                });



                item.connect('destroy', () => {

                    if (this._allWindowsMenuItem.menu._getMenuItems().length === 1)
                        this._allWindowsMenuItem.setSensitive(false);
                });
            }
        }
    }
};




function isWindowUrgent(w) {
    return w.urgent || w.demandsAttention || w._manualUrgency;
}








export function getInterestingWindows(windows, monitorIndex) {
    const {settings} = Docking.DockManager;



    if (settings.isolateWorkspaces) {
        const showUrgent = settings.workspaceAgnosticUrgentWindows;
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        windows = windows.filter(w => {
            const inWorkspace = w.get_workspace() === activeWorkspace;
            return inWorkspace || (showUrgent && isWindowUrgent(w));
        });
    }

    if (settings.isolateMonitors && monitorIndex >= 0) {
        windows = windows.filter(w => {
            return w.get_monitor() === monitorIndex;
        });
    }

    return windows.filter(w => !w.skipTaskbar);
}











export const DockShowAppsIcon = GObject.registerClass({
    Signals: {
        'menu-state-changed': {param_types: [GObject.TYPE_BOOLEAN]},
        'sync-tooltip': {},
    },
}
, class DockShowAppsIcon extends Dash.ShowAppsIcon {
    _init(position) {
        super._init();

        if (this.icon)
            this.icon.translation_y = 0;


        const {prototype: appIconPrototype} = AppDisplay.AppIcon;
        this.toggleButton.y_expand = false;
        this.toggleButton.connect('popup-menu', () =>
            appIconPrototype._onKeyboardPopupMenu.call(this));
        this.toggleButton.connect('clicked', () =>
            this._removeMenuTimeout());

        this.reactive = true;
        this.toggleButton.popupMenu = (...args) =>
            this.popupMenu(...args);
        this.toggleButton._setPopupTimeout = (...args) =>
            this._setPopupTimeout(...args);
        this.toggleButton._removeMenuTimeout = (...args) =>
            this._removeMenuTimeout(...args);

        this.label?.add_style_class_name(Theming.PositionStyleClass[position]);
        if (Docking.DockManager.settings.customThemeShrink)
            this.label?.add_style_class_name('shrink');

        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuTimeoutId = 0;

        this._maybeEnablePopupGestures();
    }

    _createIcon(size) {
        this._iconActor = super._createIcon(size * Utils.getIconOversample());
        this._iconActor.set_size(size, size);
        this._iconActor.fallbackIconName = this._iconActor.iconName;
        this._iconActor.fallbackGicon = this._iconActor.gicon;
        this._iconActor.iconName = `view-app-grid-${Main.sessionMode.currentMode}-symbolic`;

        const unwatchGrid = IconTint.watchIconTint(() => IconTint.refreshIconTint(this._iconActor));
        this._iconActor.connect('destroy', () => {
            try {
                if (unwatchGrid)
                    unwatchGrid();
            } catch (e) {

            }
        });
        IconTint.refreshIconTint(this._iconActor);
        return this._iconActor;
    }

    vfunc_leave_event(...args) {
        return AppDisplay.AppIcon.prototype.vfunc_leave_event.call(
            this.toggleButton, ...args);
    }

    vfunc_button_press_event(...args) {
        try {


            return AppDisplay.AppIcon.prototype.vfunc_button_press_event.call(
                this.toggleButton, ...args);
        } catch {
            return Clutter.EVENT_PROPAGATE;
        }
    }

    vfunc_touch_event(...args) {
        try {


            return AppDisplay.AppIcon.prototype.vfunc_touch_event.call(
                this.toggleButton, ...args);
        } catch {
            return Clutter.EVENT_PROPAGATE;
        }
    }

    showLabel(...args) {
        itemShowLabel.call(this, ...args);
    }

    hideLabel(...args) {
        itemHideLabel.call(this, ...args);
    }

    setForcedHighlight(...args) {
        AppDisplay.AppIcon.prototype.setForcedHighlight.call(this, ...args);
    }

    _onMenuPoppedDown(...args) {
        AppDisplay.AppIcon.prototype._onMenuPoppedDown.call(this, ...args);
    }

    _setPopupTimeout(...args) {
        AppDisplay.AppIcon.prototype._setPopupTimeout.call(this, ...args);
    }

    _removeMenuTimeout(...args) {
        AppDisplay.AppIcon.prototype._removeMenuTimeout?.call(this, ...args);
    }

    _hasPopupMenu() {
        return Docking.DockManager.extension.uuid !== 'ubuntu-dock@ubuntu.com';
    }

    _maybeEnablePopupGestures() {
        if (!this._hasPopupMenu())
            return;

        if (!Clutter.LongPressGesture || !Clutter.ClickGesture)
            return;

        const longPressGesture = new Clutter.LongPressGesture();
        longPressGesture.connect('recognize', () => this.popupMenu());
        this.add_action(longPressGesture);

        const rightClickGesture = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        rightClickGesture.connect('recognize', () => this.popupMenu());
        this.add_action(rightClickGesture);
    }

    popupMenu() {
        if (!this._hasPopupMenu())
            return false;

        this._removeMenuTimeout();
        this.toggleButton.fake_release();

        if (!this._menu) {
            this._menu = new DockShowAppsIconMenu(this);
            this._menu.connect('open-state-changed', (menu, isPoppedUp) => {
                if (!isPoppedUp)
                    this._onMenuPoppedDown();
            });
            const id = Main.overview.connect('hiding', () => {
                this._menu.close();
            });
            this._menu.actor.connect('destroy', () => {
                Main.overview.disconnect(id);
            });
            this._menuManager.addMenu(this._menu);
        }

        this.emit('menu-state-changed', true);

        this.toggleButton.set_hover(true);
        this._menu.popup();

        this._menuManager.ignoreRelease?.();
        this.emit('sync-tooltip');

        return false;
    }
});





class DockShowAppsIconMenu extends DockAppIconMenu {
    _rebuildMenu() {
        this.removeAll();

        const item = this._appendMenuItem(_('Settings'));
        item.connect('activate', () =>
            Docking.DockManager.extension.openPreferences());
    }
}

function _updateTailPosition(label, position) {
    const tail = label._arrowTailActor;
    if (!tail || !label.get_stage())
        return;
    label._arrowPos = position;

    const [minW, natW] = label.get_preferred_width(-1);
    const pillWidth = Math.ceil(natW > 0 ? natW : (label.width > 0 ? label.width : 50));
    if (pillWidth <= 0)
        return;

    const [minH, natH] = label.get_preferred_height(pillWidth);
    const pillHeight = Math.ceil(natH > 0 ? natH : (label.height > 0 ? label.height : 25));

    const rise = 7.0;
    const padX = 6.0;
    const padY = 6.0;

    let tailW, tailH, posX, posY;
    const lx = Math.round(label.x);
    const ly = Math.round(label.y);

    const arrowW = 18.0;
    const arrowH = rise + 3.0;

    let arrowX = 0, arrowY = 0, arrowBoxW = arrowW, arrowBoxH = arrowH;

    if (position === St.Side.TOP) {
        tailW = pillWidth + 2 * padX;
        tailH = pillHeight + rise + 2 * padY;
        posX = lx - padX;
        posY = ly - rise - padY;

        arrowX = Math.round(lx + (pillWidth - arrowW) / 2.0);
        arrowY = Math.round(ly - rise - 1.0);
        arrowBoxW = arrowW;
        arrowBoxH = arrowH;
    } else if (position === St.Side.LEFT) {
        tailW = pillWidth + rise + 2 * padX;
        tailH = pillHeight + 2 * padY;
        posX = lx - rise - padX;
        posY = ly - padY;

        arrowX = Math.round(lx - rise - 1.0);
        arrowY = Math.round(ly + (pillHeight - arrowW) / 2.0);
        arrowBoxW = arrowH;
        arrowBoxH = arrowW;
    } else if (position === St.Side.RIGHT) {
        tailW = pillWidth + rise + 2 * padX;
        tailH = pillHeight + 2 * padY;
        posX = lx - padX;
        posY = ly - padY;

        arrowX = Math.round(lx + pillWidth - 2.0);
        arrowY = Math.round(ly + (pillHeight - arrowW) / 2.0);
        arrowBoxW = arrowH;
        arrowBoxH = arrowW;
    } else {
        // St.Side.BOTTOM
        tailW = pillWidth + 2 * padX;
        tailH = pillHeight + rise + 2 * padY;
        posX = lx - padX;
        posY = ly - padY;

        arrowX = Math.round(lx + (pillWidth - arrowW) / 2.0);
        arrowY = Math.round(ly + pillHeight - 2.0);
        arrowBoxW = arrowW;
        arrowBoxH = arrowH;
    }

    if (!tail || tail._macDestroyed || tail.is_finalized?.() || !tail.get_stage?.())
        return;

    tail.set_size(Math.round(tailW), Math.round(tailH));
    tail.set_position(Math.round(posX), Math.round(posY));
    if (tail.visible) {
        try {
            const tBox = new Clutter.ActorBox();
            tBox.x1 = posX;
            tBox.y1 = posY;
            tBox.x2 = posX + tailW;
            tBox.y2 = posY + tailH;
            tail.allocate(tBox);
        } catch (_) {}
    }

    const blurActor = label._blurActor;
    if (blurActor && !blurActor._macDestroyed && !blurActor.is_finalized?.() && blurActor.get_stage?.()) {
        blurActor.set_size(pillWidth, pillHeight);
        blurActor.set_position(lx, ly);
        if (blurActor._blurEff && 'corner_radius' in blurActor._blurEff) {
            blurActor._blurEff.corner_radius = Math.round(pillHeight / 2);
        }
    } else if (blurActor && (blurActor._macDestroyed || blurActor.is_finalized?.())) {
        label._blurActor = null;
    }

    tail.queue_repaint();
}

function _ensureLabelTail(label, position) {
    if (!label)
        return;

    if (label._arrowTail && label.contains(label._arrowTail)) {
        label.remove_child(label._arrowTail);
        label._arrowTail.destroy();
        label._arrowTail = null;
    }

    // Disable duplicate blur on label itself if it has a tail
    const labelBlurEff = label.get_effects?.()?.find(e => e.name === 'tahoe-label-blur');
    if (labelBlurEff) {
        labelBlurEff.enabled = false;
    }

    if (label._blurActor && (label._blurActor._macDestroyed || label._blurActor.is_finalized?.()))
        label._blurActor = null;

    if (!label._blurActor) {
        const blurActor = new St.Widget({
            style_class: 'dash-label-blur-pill',
            reactive: false,
        });
        blurActor.set_style('background-color: transparent !important; background: transparent !important; border: none !important; box-shadow: none !important;');
        blurActor.connect('destroy', () => {
            blurActor._macDestroyed = true;
            if (label._blurActor === blurActor)
                label._blurActor = null;
        });
        label._blurActor = blurActor;

        const cfg = globalThis._macLabelStylingConfig || { blur: 20, tint: 20, shadow: 25 };
        const radius = (typeof cfg.blur === 'number') ? cfg.blur : 20;

        if (Blur?.BlurEffect) {
            blurActor._blurEff = new Blur.BlurEffect({
                name: 'dash-label-pill-blur',
                mode: 1,
                radius: radius,
                corner_radius: 13,
                brightness: 1.0,
            });
            blurActor.add_effect(blurActor._blurEff);
            blurActor._blurEff.enabled = (radius > 0);
        } else if (Shell?.BlurEffect) {
            blurActor._blurEff = new Shell.BlurEffect({
                name: 'dash-label-pill-blur',
                mode: Shell.BlurMode.BACKGROUND,
                radius: radius,
            });
            blurActor.add_effect(blurActor._blurEff);
            blurActor._blurEff.enabled = (radius > 0);
        }

        Main.uiGroup.add_child(blurActor);

        label.bind_property('visible', blurActor, 'visible', GObject.BindingFlags.SYNC_CREATE);
        label.bind_property('opacity', blurActor, 'opacity', GObject.BindingFlags.SYNC_CREATE);
    }

    if (!label._arrowTailActor) {
        const tail = new St.DrawingArea({ style_class: 'dash-label-tail', reactive: false });
        label._arrowTailActor = tail;

        tail.connect('repaint', (area) => {
            const cr = area.get_context();
            cr.setAntialias(cairo.Antialias.SUBPIXEL);
            cr.setLineCap(cairo.LineCap.ROUND);
            cr.setLineJoin(cairo.LineJoin.ROUND);

            const cfg = globalThis._macLabelStylingConfig || { blur: 20, tint: 20, shadow: 25 };
            const tintVal = (typeof cfg.tint === 'number') ? cfg.tint : 20;
            const tintAlpha = Math.max(0.05, Math.min(0.95, tintVal / 100.0));
            const shadowVal = (typeof cfg.shadow === 'number') ? cfg.shadow : 25;
            const shadowAlpha = Math.max(0.0, Math.min(1.0, shadowVal / 100.0));

            const isLight = (Main.sessionMode && Main.sessionMode.currentMode === 'light') ||
                            (typeof globalThis._macIsLightMode === 'function' ? globalThis._macIsLightMode() : false);

            let r, g, b, a, br, bg_c, bb, ba;
            if (isLight) {
                r = 0.94; g = 0.94; b = 0.96; a = Math.max(0.18, Math.min(0.95, tintAlpha * 0.85));
                br = 0.0; bg_c = 0.0; bb = 0.0; ba = 0.14;
            } else {
                r = 0.12; g = 0.12; b = 0.15; a = Math.max(0.18, Math.min(0.95, tintAlpha));
                br = 1.0; bg_c = 1.0; bb = 1.0; ba = 0.22;
            }

            const padX = 6.0;
            const padY = 6.0;
            const [minW, natW] = label.get_preferred_width(-1);
            const pw = Math.ceil(natW > 0 ? natW : (label.width > 0 ? label.width : 50));
            const [minH, natH] = label.get_preferred_height(pw);
            const ph = Math.ceil(natH > 0 ? natH : (label.height > 0 ? label.height : 25));
            const rad = ph / 2.0;

            const rise = 7.0;
            const halfBase = 5.0;
            const fillet = 10.0;
            const tipR = 1.8;

            const pos = label._arrowPos ?? position ?? St.Side.BOTTOM;

            function makeUnifiedPath() {
                cr.newPath();
                if (pos === St.Side.TOP) {
                    const ox = padX;
                    const oy = padY + rise;
                    const cx = ox + pw / 2.0;
                    cr.moveTo(ox + rad, oy);
                    cr.lineTo(cx - halfBase - fillet, oy);
                    cr.curveTo(cx - halfBase - fillet * 0.5, oy, cx - halfBase - 1.2, oy - rise * 0.25, cx - halfBase, oy - rise * 0.55);
                    cr.curveTo(cx - halfBase + 1.2, oy - rise * 0.85, cx - tipR * 1.3, oy - rise, cx, oy - rise);
                    cr.curveTo(cx + tipR * 1.3, oy - rise, cx + halfBase - 1.2, oy - rise * 0.85, cx + halfBase, oy - rise * 0.55);
                    cr.curveTo(cx + halfBase + 1.2, oy - rise * 0.25, cx + halfBase + fillet * 0.5, oy, cx + halfBase + fillet, oy);
                    cr.lineTo(ox + pw - rad, oy);
                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                    cr.lineTo(ox + rad, oy + ph);
                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                    cr.closePath();
                } else if (pos === St.Side.LEFT) {
                    const ox = padX + rise;
                    const oy = padY;
                    const cy = oy + ph / 2.0;
                    cr.moveTo(ox + rad, oy);
                    cr.lineTo(ox + pw - rad, oy);
                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                    cr.lineTo(ox + rad, oy + ph);
                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                    cr.lineTo(ox, cy + halfBase + fillet);
                    cr.curveTo(ox, cy + halfBase + fillet * 0.5, ox - rise * 0.25, cy + halfBase + 1.2, ox - rise * 0.55, cy + halfBase);
                    cr.curveTo(ox - rise * 0.85, cy + halfBase - 1.2, ox - rise, cy + tipR * 1.3, ox - rise, cy);
                    cr.curveTo(ox - rise, cy - tipR * 1.3, ox - rise * 0.85, cy - halfBase + 1.2, ox - rise * 0.55, cy - halfBase);
                    cr.curveTo(ox - rise * 0.25, cy - halfBase - 1.2, ox, cy - halfBase - fillet * 0.5, ox, cy - halfBase - fillet);
                    cr.lineTo(ox, oy + rad);
                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                    cr.closePath();
                } else if (pos === St.Side.RIGHT) {
                    const ox = padX;
                    const oy = padY;
                    const cy = oy + ph / 2.0;
                    cr.moveTo(ox + rad, oy);
                    cr.lineTo(ox + pw - rad, oy);
                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                    cr.lineTo(ox + pw, cy - halfBase - fillet);
                    cr.curveTo(ox + pw, cy - halfBase - fillet * 0.5, ox + pw + rise * 0.25, cy - halfBase - 1.2, ox + pw + rise * 0.55, cy - halfBase);
                    cr.curveTo(ox + pw + rise * 0.85, cy - halfBase + 1.2, ox + pw + rise, cy - tipR * 1.3, ox + pw + rise, cy);
                    cr.curveTo(ox + pw + rise, cy + tipR * 1.3, ox + pw + rise * 0.85, cy + halfBase - 1.2, ox + pw + rise * 0.55, cy + halfBase);
                    cr.curveTo(ox + pw + rise * 0.25, cy + halfBase + 1.2, ox + pw, cy + halfBase + fillet * 0.5, ox + pw, cy + halfBase + fillet);
                    cr.lineTo(ox + pw, oy + ph - rad);
                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                    cr.lineTo(ox + rad, oy + ph);
                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                    cr.closePath();
                } else {
                    // St.Side.BOTTOM
                    const ox = padX;
                    const oy = padY;
                    const cx = ox + pw / 2.0;
                    cr.arc(ox + rad, oy + rad, rad, Math.PI, 1.5 * Math.PI);
                    cr.lineTo(ox + pw - rad, oy);
                    cr.arc(ox + pw - rad, oy + rad, rad, 1.5 * Math.PI, 2.0 * Math.PI);
                    cr.arc(ox + pw - rad, oy + ph - rad, rad, 0, 0.5 * Math.PI);
                    cr.lineTo(cx + halfBase + fillet, oy + ph);
                    cr.curveTo(cx + halfBase + fillet * 0.5, oy + ph, cx + halfBase + 1.2, oy + ph + rise * 0.25, cx + halfBase, oy + ph + rise * 0.55);
                    cr.curveTo(cx + halfBase - 1.2, oy + ph + rise * 0.85, cx + tipR * 1.3, oy + ph + rise, cx, oy + ph + rise);
                    cr.curveTo(cx - tipR * 1.3, oy + ph + rise, cx - halfBase + 1.2, oy + ph + rise * 0.85, cx - halfBase, oy + ph + rise * 0.55);
                    cr.curveTo(cx - halfBase - 1.2, oy + ph + rise * 0.25, cx - halfBase - fillet * 0.5, oy + ph, cx - halfBase - fillet, oy + ph);
                    cr.lineTo(ox + rad, oy + ph);
                    cr.arc(ox + rad, oy + ph - rad, rad, 0.5 * Math.PI, Math.PI);
                    cr.closePath();
                }
            }

            if (shadowAlpha > 0.02) {
                for (let s = 3; s >= 1; s--) {
                    cr.save();
                    cr.translate(0, s * 1.5);
                    makeUnifiedPath();
                    cr.setSourceRGBA(0, 0, 0, (shadowAlpha * 0.14) / s);
                    cr.setLineWidth(s * 2.8);
                    cr.stroke();
                    cr.restore();
                }
            }

            makeUnifiedPath();
            cr.setSourceRGBA(r, g, b, a);
            cr.fillPreserve();

            cr.setSourceRGBA(br, bg_c, bb, ba);
            cr.setLineWidth(1.0);
            cr.stroke();

            cr.$dispose();
        });

        Main.uiGroup.add_child(tail);
        Main.uiGroup.set_child_below_sibling(tail, label);

        label.bind_property('visible', tail, 'visible', GObject.BindingFlags.SYNC_CREATE);
        label.bind_property('opacity', tail, 'opacity', GObject.BindingFlags.SYNC_CREATE);

        label.connect('destroy', () => {
            if (label._blurActor) {
                try {
                    Main.uiGroup.remove_child(label._blurActor);
                    label._blurActor.destroy();
                } catch (_) {}
                label._blurActor = null;
            }
            if (label._arrowTailActor) {
                try {
                    Main.uiGroup.remove_child(label._arrowTailActor);
                    label._arrowTailActor.destroy();
                } catch (_) {}
                label._arrowTailActor = null;
            }
        });

        label.connect('notify::position', () => {
            _updateTailPosition(label, label._arrowPos ?? Utils.getPosition());
        });

        label.connect('notify::allocation', () => {
            _updateTailPosition(label, label._arrowPos ?? Utils.getPosition());
        });
    }

    // Ensure stacking order: blur actor below tail, and tail below label
    if (label._blurActor && label._arrowTailActor)
        Main.uiGroup.set_child_below_sibling(label._blurActor, label._arrowTailActor);
    if (label._arrowTailActor)
        Main.uiGroup.set_child_below_sibling(label._arrowTailActor, label);

    _updateTailPosition(label, position);
}

export function positionItemLabel(item) {
    const visual = item.child?.icon?._iconBin ?? item.child?.icon ?? item.child ?? item;
    const extents = visual.get_transformed_extents();
    const stageX = extents.get_x();
    const stageY = extents.get_y();
    const itemWidth = extents.get_width();
    const itemHeight = extents.get_height();

    const node = item.label.get_theme_node();

    const [minW, natW] = item.label.get_preferred_width(-1);
    const labelWidth = Math.ceil(natW > 0 ? natW : (item.label.get_width() || 0));
    const [minH, natH] = item.label.get_preferred_height(labelWidth);
    const labelHeight = Math.ceil(natH > 0 ? natH : (item.label.get_height() || 25));

    let x, y, xOffset, yOffset;

    const position = Utils.getPosition();
    const labelOffset = node ? (node.get_length('-x-offset') || 0) : 0;

    const iconCenterX = stageX + itemWidth / 2;
    const iconCenterY = stageY + itemHeight / 2;

    switch (position) {
    case St.Side.LEFT:
        y = Math.round(iconCenterY - labelHeight / 2);
        xOffset = labelOffset;
        x = stageX + itemWidth + xOffset + 20;
        break;
    case St.Side.RIGHT:
        y = Math.round(iconCenterY - labelHeight / 2);
        xOffset = labelOffset;
        x = Math.round(stageX) - labelWidth - xOffset - 20;
        break;
    case St.Side.TOP:
        y = stageY + itemHeight + labelOffset + 20;
        x = Math.round(iconCenterX - (labelWidth / 2));
        break;
    case St.Side.BOTTOM:
    default:
        y = stageY - labelHeight - labelOffset - 20;
        x = Math.round(iconCenterX - (labelWidth / 2));
        break;
    }

    const gap = 5;
    const monitor = Main.layoutManager.findMonitorForActor(item);
    if (monitor) {
        if (x - monitor.x < gap)
            x += monitor.x - x + labelOffset;
        else if (x + labelWidth > monitor.x + monitor.width - gap)
            x -= x + labelWidth - (monitor.x + monitor.width) + gap;
    }

    x = Math.round(x);
    y = Math.round(y);
    item.label.set_position(x, y);
    _updateTailPosition(item.label, position);
}

export function itemShowLabel() {
    /* eslint-disable no-invalid-this */
    if (!this._labelText || !this.label.get_stage())
        return;

    try {
        const allLabels = Main.uiGroup.get_children().filter(
            a => a && a.has_style_class_name && a.has_style_class_name('dash-label') && a !== this.label
        );
        for (const other of allLabels) {
            other.remove_all_transitions();
            other.opacity = 0;
            other.hide();
            for (const sub of [other._blurActor, other._arrowTailActor]) {
                if (sub && !sub._macDestroyed && !sub.is_finalized?.() && sub.get_stage?.()) {
                    sub.remove_all_transitions();
                    sub.opacity = 0;
                    sub.hide();
                }
            }
        }
        const allTails = Main.uiGroup.get_children().filter(
            a => a && a.has_style_class_name && a.has_style_class_name('dash-label-tail') && a !== this.label._arrowTailActor
        );
        for (const tail of allTails) {
            tail.remove_all_transitions();
            tail.opacity = 0;
            tail.hide();
        }
        const allBlurWidgets = Main.uiGroup.get_children().filter(
            a => a && a.has_style_class_name &&
                 (a.has_style_class_name('dash-label-blur-unified') ||
                  a.has_style_class_name('dash-label-blur-pill') ||
                  a.has_style_class_name('dash-label-blur-arrow')) &&
                 a !== this.label._blurActor
        );
        for (const bw of allBlurWidgets) {
            try {
                bw.remove_all_transitions();
                bw.opacity = 0;
                bw.hide();
                Main.uiGroup.remove_child(bw);
                bw.destroy();
            } catch (_) {}
        }
    } catch (_) {}

    this.label.set_text(this._labelText);
    this.label.remove_all_transitions();
    if (this.label._arrowTailActor)
        this.label._arrowTailActor.remove_all_transitions();
    if (this.label._blurActor)
        this.label._blurActor.remove_all_transitions();

    this.label.opacity = 0;
    this.label.show();
    if (this.label._arrowTailActor) {
        this.label._arrowTailActor.opacity = 0;
        this.label._arrowTailActor.show();
    }
    if (this.label._blurActor) {
        this.label._blurActor.opacity = 0;
        this.label._blurActor.show();
    }

    const transparentStyle =
        'background-color: transparent !important; ' +
        'box-shadow: none !important; ' +
        'border: none !important; ' +
        'color: #ffffff !important; ' +
        'text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.6) !important; ' +
        'margin: 0px !important; ' +
        'padding: 4px 12px !important; ' +
        'font-weight: 500 !important; ' +
        'font-size: 13px !important;';

    this.label.set_style(transparentStyle);

    if (this.label.set_offscreen_redirect)
        this.label.set_offscreen_redirect(0);

    _ensureLabelTail(this.label, Utils.getPosition());
    positionItemLabel(this);

    if (globalThis._macLabelStylingConfig) {
        const { blur } = globalThis._macLabelStylingConfig;
        const eff = this.label._blurActor?._blurEff;
        if (eff) {
            eff.enabled = (blur > 0);
            eff.radius = blur;
            eff.queue_repaint?.();
        }
    }

    if (this.label._arrowTailActor)
        this.label._arrowTailActor.queue_repaint();

    this.label.ease({
        opacity: 255,
        duration: DASH_ITEM_LABEL_SHOW_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            this.label._blurActor?._blurEff?.queue_repaint?.();
            this.label.set_offscreen_redirect?.(0);
        },
    });
    /* eslint-enable no-invalid-this */
}

export function itemHideLabel(immediate = false) {
    /* eslint-disable no-invalid-this */
    if (!this.label || !this.label.get_stage())
        return;

    this.label.remove_all_transitions();
    const subs = [this.label._arrowTailActor, this.label._blurActor];
    for (const sub of subs) {
        if (sub) sub.remove_all_transitions();
    }

    if (immediate) {
        this.label.opacity = 0;
        this.label.hide();
        this.label.translation_x = 0;
        this.label.translation_y = 0;
        for (const sub of subs) {
            if (sub) {
                sub.opacity = 0;
                sub.hide();
                sub.translation_x = 0;
                sub.translation_y = 0;
            }
        }
        return;
    }

    this.label.ease({
        opacity: 0,
        duration: DASH_ITEM_LABEL_HIDE_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            this.label.hide();
            this.label.translation_x = 0;
            this.label.translation_y = 0;
            for (const sub of subs) {
                if (sub) {
                    sub.hide();
                    sub.translation_x = 0;
                    sub.translation_y = 0;
                }
            }
        },
    });
    /* eslint-enable no-invalid-this */
}

if (Dash?.DashItemContainer?.prototype) {
    Dash.DashItemContainer.prototype.showLabel = function(...args) {
        return itemShowLabel.call(this, ...args);
    };
    Dash.DashItemContainer.prototype.hideLabel = function(...args) {
        return itemHideLabel.call(this, ...args);
    };
}
