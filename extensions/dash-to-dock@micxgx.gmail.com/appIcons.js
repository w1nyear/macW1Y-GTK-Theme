

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
    Locations,
    Theming,
    Utils,
    WindowPreview,
} from './imports.js';

import {Extension} from './dependencies/shell/extensions/extension.js';



const {gettext: __, ngettext: N__} = Extension;

const DBusMenu = await DBusMenuUtils.haveDBusMenu();

const Labels = Object.freeze({
    ISOLATE_MONITORS: Symbol('isolate-monitors'),
    ISOLATE_WORKSPACES: Symbol('isolate-workspaces'),
    URGENT_WINDOWS: Symbol('urgent-windows'),
});

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


        if (Clutter.ClickGesture) {
            const doubleClickGesture = new Clutter.ClickGesture({nClicksRequired: 2});
            doubleClickGesture.connect('recognize', () => {
                this._activate({
                    button: doubleClickGesture.get_button(),
                    modifiers: doubleClickGesture.get_state(),
                    clickCount: doubleClickGesture.get_n_presses(),
                });
            });
            this.add_action(doubleClickGesture);
            this._doubleClickGesture = doubleClickGesture;
        }
    }

    _onDestroy() {
        super._onDestroy();

        delete this._menu;

        this._doubleClickGesture?.cancel();
        delete this._doubleClickGesture;
    }

    ownsWindow(window) {
        return this.app === Docking.DockManager.windowTracker.get_window_app(window);
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

    _updateRunningState() {
        this.running = (this.app.state === Shell.AppState.RUNNING) && this.windowsCount;
    }

    _updateFocusState() {
        this.focused = this.running &&
            Docking.DockManager.windowTracker.focus_app === this.app;
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
        this._dot.translationY = 0;
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

        [rect.x, rect.y] = this.get_transformed_position();
        [rect.width, rect.height] = this.get_transformed_size();

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
            __('%s is updating, try again later').format(this.name), null);
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
        this._activate({
            button,
            modifiers: event?.get_state() ?? 0,
            clickCount: event?.get_click_count?.() ?? 1,
        });
    }

    _activate({button, modifiers, clickCount = 1}) {
        if (this.app?.get_id() === 'launchpad.desktop') {
            if (typeof globalThis.toggleMacApplications === 'function') {
                globalThis.toggleMacApplications();
            } else if (typeof globalThis._macSpotlightToggle === 'function') {
                globalThis._macSpotlightToggle('apps');
            } else {
                const appMenuPath = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/searchDialog.js`;
                import(`file://${appMenuPath}`)
                    .then(mod => {
                        globalThis.toggleMacApplications = () => mod.toggleSearchDialog('apps');
                        mod.toggleSearchDialog('apps');
                    }).catch(() => {});
            }
            return;
        }


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


        if (this.running) {
            const hasUrgentWindows = !!this._urgentWindows.size;
            const singleOrUrgentWindows = windows.length === 1 || hasUrgentWindows;
            switch (buttonAction) {
            case clickAction.MINIMIZE:


                if (!Main.overview.visible || modifiers) {


                    if (this.focused && !hasUrgentWindows || button === 2 ||
                        modifiers & Clutter.ModifierType.SHIFT_MASK) {


                        const allWindows = (button === 1 && !modifiers) || clickCount > 1;
                        this._minimizeWindow(allWindows);
                    } else {
                        this._activateAllWindows();
                    }
                } else {
                    const [w] = windows;
                    Main.activateWindow(w);
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

                        Main.activateWindow(w);
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
                        Main.activateWindow(w);
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
                    Main.activateWindow(w);
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
                    Main.activateWindow(w);
                }
                break;

            case clickAction.LAUNCH:
                this.launchNewWindow();
                break;

            case clickAction.PREVIEWS:
                if (!Main.overview.visible) {



                    if (singleOrUrgentWindows && !modifiers && button === 1) {
                        const [w] = windows;
                        Main.activateWindow(w);
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

                            Main.activateWindow(w);
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
                    this._doubleClickGesture?.cancel();
                    Docking.DockManager.getDefault().appSpread.toggle(this.app);
                } else {

                    Main.activateWindow(windows[0]);
                }
                break;

            case clickAction.FOCUS_MINIMIZE_OR_APP_SPREAD:
                if (this.focused && !singleOrUrgentWindows && !modifiers && button === 1) {
                    shouldHideOverview = false;
                    this._doubleClickGesture?.cancel();
                    Docking.DockManager.getDefault().appSpread.toggle(this.app);
                } else if (!this.focused) {

                    Main.activateWindow(windows[0]);
                } else {
                    this._minimizeWindow();
                }
                break;

            case clickAction.QUIT:
                this.closeAllWindows();
                break;

            case clickAction.SKIP:
                Main.activateWindow(windows[0]);
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

        const {windowTracker} = Docking.DockManager;
        this._signalsHandler.add(windowTracker, 'notify::focus-app',
            () => this._updateFocusState());
    }
});

const DockLocationAppIcon = GObject.registerClass({
}, class DockLocationAppIcon extends DockAbstractAppIcon {
    _init(app, monitorIndex, iconAnimator) {
        if (!(app.appInfo instanceof Locations.LocationAppInfo))
            throw new Error('Provided application %s is not a Location'.format(app));

        super._init(app, monitorIndex, iconAnimator);

        if (Docking.DockManager.settings.isolateLocations) {
            const {windowTracker} = Docking.DockManager;
            this._signalsHandler.add(windowTracker, 'notify::focus-app',
                () => this._updateFocusState());
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
    if (app.appInfo instanceof Locations.LocationAppInfo)
        return new DockLocationAppIcon(app, monitorIndex, iconAnimator);

    return new DockAppIcon(app, monitorIndex, iconAnimator);
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
        this._signalsHandler.add(source, 'destroy', () => this.destroy());

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

        const appItemLabel = this.sourceActor.updating
            ? __('%s is being updated…').format(this.sourceActor.name)
            : this.sourceActor.name;
        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(appItemLabel));

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

            if (windows.length > 0) {
                this.addMenuItem(

                    new PopupMenu.PopupSeparatorMenuItem(_('Open Windows')));
            }

            windows.forEach(window => {
                const title = window.title ? window.title : app.get_name();
                const item = this._appendMenuItem(title);
                item.connect('activate', () => {
                    this.emit('activate-window', window);
                });
            });
        }

        if (!app.is_window_backed()) {
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
                    ? __('Launch using Integrated Graphics Card')
                    : __('Launch using Discrete Graphics Card'));
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

            if (canFavorite && app.get_id() !== 'launchpad.desktop') {
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
        const {windowsCount} = this.sourceActor;


        if (windowsCount > 0) {
            if (windowsCount === 1) {
                this._quitMenuItem.label.set_text(_('Quit'));
            } else {
                this._quitMenuItem.label.set_text(N__(
                    'Quit %d Window', 'Quit %d Windows', windowsCount).format(
                    windowsCount));
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
        this._iconActor = super._createIcon(size);
        this._iconActor.fallbackIconName = this._iconActor.iconName;
        this._iconActor.fallbackGicon = this._iconActor.gicon;
        this._iconActor.iconName = `view-app-grid-${Main.sessionMode.currentMode}-symbolic`;
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

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(__('Dash to Dock')));

        const item = this._appendMenuItem(_('Settings'));
        item.connect('activate', () =>
            Docking.DockManager.extension.openPreferences());
    }
}




export function itemShowLabel() {
    /* eslint-disable no-invalid-this */


    if (!this._labelText || !this.label.get_stage())
        return;

    this.label.set_text(this._labelText);
    this.label.opacity = 0;
    this.label.show();

    const [stageX, stageY] = this.get_transformed_position();
    const node = this.label.get_theme_node();

    const itemWidth  = this.allocation.x2 - this.allocation.x1;
    const itemHeight = this.allocation.y2 - this.allocation.y1;

    const labelWidth = this.label.get_width();
    const labelHeight = this.label.get_height();

    let x, y, xOffset, yOffset;

    const position = Utils.getPosition();
    const labelOffset = node.get_length('-x-offset');

    switch (position) {
    case St.Side.LEFT:
        yOffset = Math.floor((itemHeight - labelHeight) / 2);
        y = stageY + yOffset;
        xOffset = labelOffset;
        x = stageX + this.get_width() + xOffset;
        break;
    case St.Side.RIGHT:
        yOffset = Math.floor((itemHeight - labelHeight) / 2);
        y = stageY + yOffset;
        xOffset = labelOffset;
        x = Math.round(stageX) - labelWidth - xOffset;
        break;
    case St.Side.TOP:
        y = stageY + labelOffset + itemHeight;
        xOffset = Math.floor((itemWidth - labelWidth) / 2);
        x = stageX + xOffset;
        break;
    case St.Side.BOTTOM:
        yOffset = labelOffset;
        y = stageY - labelHeight - yOffset;
        xOffset = Math.floor((itemWidth - labelWidth) / 2);
        x = stageX + xOffset;
        break;
    }





    const gap = 5;
    const monitor = Main.layoutManager.findMonitorForActor(this);
    if (x - monitor.x < gap)
        x += monitor.x - x + labelOffset;
    else if (x + labelWidth > monitor.x + monitor.width - gap)
        x -= x + labelWidth - (monitor.x + monitor.width) + gap;

    this.label.remove_all_transitions();
    this.label.set_position(x, y);
    this.label.ease({
        opacity: 255,
        duration: DASH_ITEM_LABEL_SHOW_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    /* eslint-enable no-invalid-this */
}
