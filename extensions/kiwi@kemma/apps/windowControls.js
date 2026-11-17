// SPDX-License-Identifier: GPL-3.0-or-later




import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

let controlsIndicator = null;
let _extension = null;


const SYMBOLIC_ICONS = {
    close: 'window-close-symbolic',
    minimize: 'window-minimize-symbolic',
    maximize: 'window-maximize-symbolic',
    restore: 'window-restore-symbolic',
};

const WindowControlsIndicator = GObject.registerClass(
class WindowControlsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window-controls', true);

        this._settings = _extension.getSettings();
        this._useCustomIcons = this._settings.get_boolean('enable-app-window-buttons');
        this._settingsChangedId = this._settings.connect('changed', (_, key) => {
            if (key === 'button-type') this._updateAllIcons();
            else if (key === 'button-size') this._updateButtonSizeClass();
            else if (key === 'show-window-controls') this._updateVisibility();
            else if (key === 'show-window-controls-fullscreen-only') this._updateVisibility();
        });


        this._wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
        const parsed = this._parseButtonLayout(this._wmSettings.get_string('button-layout'));
        this._buttonLayout = parsed.buttons;
        this._buttonSide = parsed.side;
        this._wmLayoutChangedId = this._wmSettings.connect('changed::button-layout', () => {
            const newParsed = this._parseButtonLayout(this._wmSettings.get_string('button-layout'));
            const sideChanged = this._buttonSide !== newParsed.side;
            this._buttonLayout = newParsed.buttons;
            this._buttonSide = newParsed.side;
            if (sideChanged)
                _replaceIndicatorOnPanel();
            else
                this._rebuildButtons();
        });

    this._iconPath = _extension.path;
    this._iconsRootPath = `${this._iconPath}/icons`;
        this._box = new St.BoxLayout({ style_class: 'window-controls-box' });
        this.add_child(this._box);


        this._isContainerHovered = false;

        this._closeButton = new St.Button({ style_class: 'window-control-button close', track_hover: true });
        this._minimizeButton = new St.Button({ style_class: 'window-control-button minimize', track_hover: true });
        this._maximizeButton = new St.Button({ style_class: 'window-control-button maximize', track_hover: true });


        this._suppressHoverUntilPointerMove = false;
        this._closeButtonDelayActive = false;
        this._closeDelayTimeoutId = null;
        this._lastIsFullscreen = false;
        this._lastIsMaximized = false;
        this._fullscreenWindowSerial = 0;
        this._clutterSignalIds = [];
        this._clutterSignalIds.push([this._box, this._box.connect('motion-event', () => {
            if (this._suppressHoverUntilPointerMove) {
                this._suppressHoverUntilPointerMove = false;
                this._updateAllIcons();
            }
            return Clutter.EVENT_PROPAGATE;
        })]);


        this._clutterSignalIds.push([this._box, this._box.connect('enter-event', () => {
            if (this._suppressHoverUntilPointerMove) {
                this._suppressHoverUntilPointerMove = false;
            }
            if (this._useCustomIcons) {
                this._isContainerHovered = true;
                this._updateAllIcons();
            }
            return Clutter.EVENT_PROPAGATE;
        })]);


        this._clutterSignalIds.push([this._box, this._box.connect('leave-event', () => {
            if (this._useCustomIcons) {
                this._isContainerHovered = false;
                this._updateAllIcons();
            }
            return Clutter.EVENT_PROPAGATE;
        })]);


        const installJellyPhysics = (button, buttonType) => {
            let isPressed = false;
            let isHolding = false;
            let holdTimeoutId = 0;
            let pressX = 0, pressY = 0;
            let springSourceId = 0;
            let currentScaleX = 1.0, currentScaleY = 1.0;
            let currentTransX = 0.0, currentTransY = 0.0;
            let velScaleX = 0.0, velScaleY = 0.0;
            let velTransX = 0.0, velTransY = 0.0;

            const stopSpring = () => {
                if (springSourceId) {
                    GLib.Source.remove(springSourceId);
                    springSourceId = 0;
                }
            };

            const runSpringBack = () => {
                stopSpring();
                let lastTime = GLib.get_monotonic_time();

                const stiffness = 280.0;
                const damping = 16.0;

                springSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                    const now = GLib.get_monotonic_time();
                    let dt = (now - lastTime) / 1000000.0;
                    lastTime = now;
                    if (dt > 0.05) dt = 0.05;
                    if (dt <= 0) return GLib.SOURCE_CONTINUE;


                    const fSx = -stiffness * (currentScaleX - 1.0) - damping * velScaleX;
                    velScaleX += fSx * dt;
                    currentScaleX += velScaleX * dt;


                    const fSy = -stiffness * (currentScaleY - 1.0) - damping * velScaleY;
                    velScaleY += fSy * dt;
                    currentScaleY += velScaleY * dt;


                    const fTx = -stiffness * currentTransX - damping * velTransX;
                    velTransX += fTx * dt;
                    currentTransX += velTransX * dt;


                    const fTy = -stiffness * currentTransY - damping * velTransY;
                    velTransY += fTy * dt;
                    currentTransY += velTransY * dt;

                    button.set_scale(currentScaleX, currentScaleY);
                    button.set_translation(currentTransX, currentTransY, 0);

                    const settled = Math.abs(currentScaleX - 1.0) < 0.005 &&
                                    Math.abs(currentScaleY - 1.0) < 0.005 &&
                                    Math.abs(currentTransX) < 0.1 &&
                                    Math.abs(currentTransY) < 0.1 &&
                                    Math.abs(velScaleX) < 0.01 &&
                                    Math.abs(velScaleY) < 0.01;

                    if (settled) {
                        currentScaleX = 1.0;
                        currentScaleY = 1.0;
                        currentTransX = 0.0;
                        currentTransY = 0.0;
                        velScaleX = 0; velScaleY = 0;
                        velTransX = 0; velTransY = 0;
                        button.set_scale(1.0, 1.0);
                        button.set_translation(0, 0, 0);
                        springSourceId = 0;
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            };

            button.set_pivot_point(0.5, 0.5);

            this._clutterSignalIds.push([button, button.connect('notify::hover', () => this._updateButtonIcon(buttonType))]);

            this._clutterSignalIds.push([button, button.connect('button-press-event', (actor, event) => {
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                stopSpring();
                if (holdTimeoutId) {
                    GLib.Source.remove(holdTimeoutId);
                    holdTimeoutId = 0;
                }
                isPressed = true;
                isHolding = false;
                const [x, y] = event.get_coords();
                pressX = x;
                pressY = y;
                currentScaleX = 1.0;
                currentScaleY = 1.0;
                currentTransX = 0;
                currentTransY = 0;
                button.add_style_pseudo_class('active');
                this._updateButtonIcon(buttonType);


                holdTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 280, () => {
                    holdTimeoutId = 0;
                    if (isPressed) {
                        isHolding = true;

                        button.ease({
                            scale_x: 1.18,
                            scale_y: 1.18,
                            duration: 120,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                        currentScaleX = 1.18;
                        currentScaleY = 1.18;
                    }
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_PROPAGATE;
            })]);

            this._clutterSignalIds.push([button, button.connect('motion-event', (actor, event) => {
                if (!isPressed) return Clutter.EVENT_PROPAGATE;
                const [curX, curY] = event.get_coords();
                const dx = curX - pressX;
                const dy = curY - pressY;
                const dist = Math.hypot(dx, dy);

                if (!isHolding && dist > 6.0) {
                    if (holdTimeoutId) {
                        GLib.Source.remove(holdTimeoutId);
                        holdTimeoutId = 0;
                    }
                    isHolding = true;
                }

                if (!isHolding) return Clutter.EVENT_PROPAGATE;


                const [bx, by] = button.get_transformed_position();
                const [bw, bh] = button.get_transformed_size();
                const pad = 6.0;
                if (curX < bx - pad || curX > bx + bw + pad || curY < by - pad || curY > by + bh + pad) {
                    isPressed = false;
                    isHolding = false;
                    if (holdTimeoutId) {
                        GLib.Source.remove(holdTimeoutId);
                        holdTimeoutId = 0;
                    }
                    button.remove_style_pseudo_class('active');
                    this._updateButtonIcon(buttonType);
                    runSpringBack();
                    return Clutter.EVENT_STOP;
                }



                if (dist > 1.0) {
                    const stretch = 1.18 + Math.min(dist * 0.035, 1.25);
                    const compress = Math.max(0.65, 1.18 / Math.sqrt(stretch / 1.18));

                    if (Math.abs(dx) >= Math.abs(dy)) {
                        currentScaleX = stretch;
                        currentScaleY = compress;
                    } else {
                        currentScaleX = compress;
                        currentScaleY = stretch;
                    }
                    currentTransX = dx * 0.38;
                    currentTransY = dy * 0.38;

                    button.set_scale(currentScaleX, currentScaleY);
                    button.set_translation(currentTransX, currentTransY, 0);
                }
                return Clutter.EVENT_STOP;
            })]);

            this._clutterSignalIds.push([button, button.connect('button-release-event', () => {
                if (!isPressed) return Clutter.EVENT_PROPAGATE;
                isPressed = false;
                if (holdTimeoutId) {
                    GLib.Source.remove(holdTimeoutId);
                    holdTimeoutId = 0;
                }
                button.remove_style_pseudo_class('active');
                this._updateButtonIcon(buttonType);

                if (!isHolding) {

                    button.set_scale(1.0, 1.0);
                    button.set_translation(0, 0, 0);
                    currentScaleX = 1.0;
                    currentScaleY = 1.0;
                    currentTransX = 0;
                    currentTransY = 0;
                    return Clutter.EVENT_PROPAGATE;
                }

                isHolding = false;
                runSpringBack();
                return Clutter.EVENT_PROPAGATE;
            })]);

            this._clutterSignalIds.push([button, button.connect('leave-event', () => {
                if (holdTimeoutId) {
                    GLib.Source.remove(holdTimeoutId);
                    holdTimeoutId = 0;
                }
                if (isPressed) {
                    isPressed = false;
                    button.remove_style_pseudo_class('active');
                    this._updateButtonIcon(buttonType);
                    if (isHolding) {
                        isHolding = false;
                        runSpringBack();
                    } else {
                        button.set_scale(1.0, 1.0);
                        button.set_translation(0, 0, 0);
                        currentScaleX = 1.0;
                        currentScaleY = 1.0;
                        currentTransX = 0;
                        currentTransY = 0;
                    }
                }
            })]);


            this._clutterSignalIds.push([button, button.connect('enter-event', () => {
                if (this._suppressHoverUntilPointerMove) {
                    this._suppressHoverUntilPointerMove = false;
                }
                if (this._useCustomIcons) {
                    this._isContainerHovered = true;
                    this._updateAllIcons();
                }
            })]);
        };

        ['minimize', 'maximize', 'close'].forEach(buttonType => {
            const button = this[`_${buttonType}Button`];
            installJellyPhysics(button, buttonType);
        });

        this._clutterSignalIds.push([this._minimizeButton, this._minimizeButton.connect('clicked', () => {
            const window = global.display.focus_window;
            if (window) window.minimize();
        })]);

        this._clutterSignalIds.push([this._maximizeButton, this._maximizeButton.connect('clicked', () => {
            const window = global.display.focus_window;
            if (window) {
                if (window.is_fullscreen()) {
                    try {
                        if (globalThis._macWindowManagement?.animateExitFullscreen) {
                            globalThis._macWindowManagement.animateExitFullscreen(window);
                        } else {
                            window.unmake_fullscreen();
                            window.unmaximize();
                        }
                    } catch (_) {}
                } else if (window.maximized_horizontally && window.maximized_vertically) {
                    try { window.unmaximize(); } catch (_) {}
                } else {
                    try { window.maximize(); } catch (_) {}
                }
            }
        })]);

        this._clutterSignalIds.push([this._closeButton, this._closeButton.connect('clicked', () => {
            const window = global.display.focus_window;
            if (window) window.delete(global.get_current_time());
        })]);

        this._buildButtonLayout();

        this._updateAllIcons();

        this._focusWindowSignal = global.display.connect('notify::focus-window', this._onFocusWindowChanged.bind(this));
        this._overviewShowingId = Main.overview.connect('showing', () => this._updateVisibility());
        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            this._onFocusWindowChanged();
            this._updateVisibility();
        });


        this._screenShield = Main.screenShield;
        if (this._screenShield) {
            this._screenShieldActiveId = this._screenShield.connect('active-changed', () => {

                if (!this._screenShield.active) {
                    if (this._screenShieldTimeoutId) {
                    GLib.Source.remove(this._screenShieldTimeoutId);
                    this._screenShieldTimeoutId = null;
                }
                    this._screenShieldTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._screenShieldTimeoutId = null;
                        this._onFocusWindowChanged();
                        this._updateVisibility();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        }

        this._updateVisibility();
        this._updateButtonSizeClass();
    }

    _parseButtonLayout(layoutStr) {

        const validButtons = ['close', 'minimize', 'maximize'];
        const parts = (layoutStr || '').split(':');
        const leftPart = parts[0] || '';
        const rightPart = parts[1] || '';

        const leftButtons = leftPart.split(',').map(b => b.trim()).filter(b => validButtons.includes(b));
        const rightButtons = rightPart.split(',').map(b => b.trim()).filter(b => validButtons.includes(b));



        let side, ordered;
        if (leftButtons.length >= rightButtons.length && leftButtons.length > 0) {
            side = 'left';
            ordered = leftButtons;
        } else if (rightButtons.length > 0) {
            side = 'right';
            ordered = rightButtons;
        } else {
            side = 'right';
            ordered = ['minimize', 'maximize', 'close'];
        }


        const seen = new Set();
        const result = [];
        for (const b of ordered) {
            if (!seen.has(b)) { seen.add(b); result.push(b); }
        }
        return { buttons: result, side };
    }

    _buildButtonLayout() {

        [this._closeButton, this._minimizeButton, this._maximizeButton].forEach(btn => {
            if (btn.get_parent() === this._box)
                this._box.remove_child(btn);
        });

        const buttonMap = {
            close: this._closeButton,
            minimize: this._minimizeButton,
            maximize: this._maximizeButton,
        };

        if (this._useCustomIcons) {

            for (const name of this._buttonLayout)
                this._box.add_child(buttonMap[name]);
            this._box.remove_style_class_name('system-mode');
        } else {

            for (const name of this._buttonLayout)
                this._box.add_child(buttonMap[name]);
            this._box.add_style_class_name('system-mode');
        }
    }

    _rebuildButtons() {
        this._buildButtonLayout();
        this._updateAllIcons();
    }

    _updateButtonSizeClass() {
        const buttonSize = this._settings.get_string('button-size');
        if (buttonSize === 'small') {
            this._box.add_style_class_name('small-size');
        } else {
            this._box.remove_style_class_name('small-size');
        }
    }

    _onFocusWindowChanged() {
        if (this._focusWindow) {
            if (this._focusWindowMaximizeHorizSignal) {
                this._focusWindow.disconnect(this._focusWindowMaximizeHorizSignal);
                this._focusWindowMaximizeHorizSignal = null;
            }
            if (this._focusWindowMaximizeVertSignal) {
                this._focusWindow.disconnect(this._focusWindowMaximizeVertSignal);
                this._focusWindowMaximizeVertSignal = null;
            }
            if (this._focusWindowFullscreenSignal) {
                this._focusWindow.disconnect(this._focusWindowFullscreenSignal);
                this._focusWindowFullscreenSignal = null;
            }
        }

        this._focusWindow = global.display.focus_window;

        if (this._focusWindow) {
            this._focusWindowMaximizeHorizSignal = this._focusWindow.connect('notify::maximized-horizontally', this._updateVisibility.bind(this));
            this._focusWindowMaximizeVertSignal = this._focusWindow.connect('notify::maximized-vertically', this._updateVisibility.bind(this));
            this._focusWindowFullscreenSignal = this._focusWindow.connect('notify::fullscreen', this._updateVisibility.bind(this));
        }

        this._updateVisibility();
    }

    _updateButtonIcon(buttonType) {
    const button = this[`_${buttonType}Button`];
    const win = global.display.focus_window;


    let isMaximized = false;
    if (buttonType === 'maximize' && win) {

        if (win.maximized_horizontally && win.maximized_vertically) {
            isMaximized = true;
        } else if (typeof win.get_maximized === 'function') {

            try {
                const flags = win.get_maximized();
                if ((flags & Meta.MaximizeFlags.HORIZONTAL) && (flags & Meta.MaximizeFlags.VERTICAL))
                    isMaximized = true;
            } catch (_) {}
        } else if (typeof win.is_maximized === 'function') {

            try { isMaximized = !!win.is_maximized(); } catch (_) {}
        }
    }
    const isFullscreen = !!win && typeof win.is_fullscreen === 'function' && win.is_fullscreen();

        if (buttonType === 'minimize' && isFullscreen && this._settings.get_boolean('show-window-controls')) {

            button.reactive = false;
            button.remove_style_pseudo_class('active');
            if (this._useCustomIcons) {
                const iconName = 'button-minimize-backdrop.png';
                this._setButtonIcon(button, iconName);
            } else {
                this._setSystemIcon(button, 'minimize');
                button.opacity = 100;
            }
            return;
        } else if (buttonType === 'minimize') {

            button.reactive = true;
            button.opacity = 255;
        }


        const buttonName = (buttonType === 'maximize' && (isMaximized || isFullscreen)) ? 'restore' : buttonType;

        if (this._useCustomIcons) {

            let isHovered = button.hover || this._isContainerHovered;
            if (this._suppressHoverUntilPointerMove)
                isHovered = false;
            const state = button.has_style_pseudo_class('active') ? '-active' : isHovered ? '-hover' : '';
            const iconName = `button-${buttonName}${state}.png`;
            this._setButtonIcon(button, iconName);
        } else {

            this._setSystemIcon(button, buttonName);
        }
    }

    _updateAllIcons() {
        ['minimize', 'maximize', 'close'].forEach(buttonType => this._updateButtonIcon(buttonType));
    }



    _updateVisibility() {
        const focusWindow = this._focusWindow;

        let isMaximized = false;
        if (focusWindow) {
            if (focusWindow.maximized_horizontally && focusWindow.maximized_vertically) {
                isMaximized = true;
            } else if (typeof focusWindow.get_maximized === 'function') {
                try {
                    const flags = focusWindow.get_maximized();
                    if ((flags & Meta.MaximizeFlags.HORIZONTAL) && (flags & Meta.MaximizeFlags.VERTICAL))
                        isMaximized = true;
                } catch (_) {}
            } else if (typeof focusWindow.is_maximized === 'function') {
                try { isMaximized = !!focusWindow.is_maximized(); } catch (_) {}
            }
        }
        const isFullscreen = !!focusWindow && typeof focusWindow.is_fullscreen === 'function' && focusWindow.is_fullscreen();


        const wasVisible = this.visible;
        const wasMaximized = this._lastIsMaximized || false;


        if (focusWindow) {
            const windowTitle = focusWindow.get_title();
            if (windowTitle) {
                const normalizedTitle = windowTitle.trim().toLowerCase();
                if (normalizedTitle.startsWith('com.') || normalizedTitle.startsWith('gjs') || normalizedTitle.includes('@!0,0')) {
                    this.hide();
                    return;
                }
            }
            if (windowTitle && !windowTitle.trim()) {
                this.hide();
                return;
            }

            const tracker = Shell.WindowTracker.get_default();
            const app = tracker ? tracker.get_window_app(focusWindow) : null;
            const appName = app ? app.get_name() : null;
            const normalizedAppName = appName ? appName.trim().toLowerCase() : '';
            if (normalizedAppName.startsWith('com.') || normalizedAppName.startsWith('gjs')) {
                this.hide();
                return;
            }
        }

        const fullscreenOnly = this._settings.get_boolean('show-window-controls-fullscreen-only');
        this.visible = !Main.overview.visible && focusWindow &&
            this._settings.get_boolean('show-window-controls') &&
            (fullscreenOnly ? isFullscreen : (isMaximized || isFullscreen));


        if (this.visible !== wasVisible || isMaximized !== wasMaximized) {
            this._isContainerHovered = false;

            ['minimize', 'maximize', 'close'].forEach(buttonType => {
                const button = this[`_${buttonType}Button`];
                if (button) {
                    button.hover = false;
                }
            });
        }


        if (this._minimizeButton) {
            if (this.visible && isFullscreen) {
                this._minimizeButton.reactive = false;
            } else {
                this._minimizeButton.reactive = true;
            }
        }


        if (this.visible && isFullscreen) {
            if (!this._lastIsFullscreen) {

                this._applyCloseButtonDelay();
            } else if (this._closeButtonDelayActive) {

                this._closeButton.reactive = false;
            }
        } else {

            this._clearCloseButtonDelay();
            this._closeButton.reactive = true;
        }

        this._lastIsFullscreen = isFullscreen;
        this._lastIsMaximized = isMaximized;


        if (this.visible && isFullscreen) {
            if (!this._suppressHoverUntilPointerMove) {
                this._suppressHoverUntilPointerMove = true;
                this._updateAllIcons();
            }
        } else if (!isFullscreen && this._suppressHoverUntilPointerMove) {
            this._suppressHoverUntilPointerMove = false;
            this._updateAllIcons();
        }


        this._updateAllIcons();
    }

    _applyCloseButtonDelay() {

        this._clearCloseButtonDelay();

        this._closeButtonDelayActive = true;
        this._closeButton.reactive = false;
        const serial = ++this._fullscreenWindowSerial;

        this._closeDelayTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {

            if (this._closeDelayTimeoutId) {
                this._closeDelayTimeoutId = null;
            }
            if (this._closeButtonDelayActive && this._lastIsFullscreen && serial === this._fullscreenWindowSerial) {
                this._closeButtonDelayActive = false;
                this._closeButton.reactive = true;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearCloseButtonDelay() {
        if (this._closeDelayTimeoutId) {
            GLib.Source.remove(this._closeDelayTimeoutId);
            this._closeDelayTimeoutId = null;
        }
        if (this._closeButtonDelayActive) {
            this._closeButtonDelayActive = false;
            if (this._closeButton)
                this._closeButton.reactive = true;
        }
    }

    _setButtonIcon(button, iconName) {
        const monitor = Main.layoutManager.primaryMonitor;
        const scaleFactor = monitor ? monitor.geometry_scale : 1;
        const file = this._getIconFile(iconName, scaleFactor);

        button.child = new St.Icon({
            gicon: new Gio.FileIcon({ file }),
            style_class: 'window-control-icon',
        });
    }

    _setSystemIcon(button, buttonName) {
        const iconName = SYMBOLIC_ICONS[buttonName] || SYMBOLIC_ICONS.close;

        if (button._currentSystemIcon === iconName)
            return;
        button._currentSystemIcon = iconName;
        button.child = new St.Icon({
            icon_name: iconName,
            style_class: 'window-control-icon',
        });
    }

    _getIconFile(iconName, scaleFactor = 1) {
        const buttonType = this._settings.get_string('button-type');
        const isAltTheme = buttonType === 'titlebuttons-alt';
        const baseFolder = isAltTheme ? 'titlebuttons' : buttonType;
        const basePath = `${this._iconsRootPath}/${baseFolder}`;

        const getScaledName = (name) => {
            if (scaleFactor >= 1.5 && name.endsWith('.png')) {
                return `${name.slice(0, -4)}@2.png`;
            }
            return name;
        };

        if (isAltTheme) {
            const altName = this._getAltVariant(iconName);
            if (altName) {
                const scaledAltName = getScaledName(altName);
                const scaledAltFile = Gio.File.new_for_path(`${basePath}/${scaledAltName}`);
                if (scaledAltFile.query_exists(null))
                    return scaledAltFile;

                const altFile = Gio.File.new_for_path(`${basePath}/${altName}`);
                if (altFile.query_exists(null))
                    return altFile;
            }
        }

        const scaledName = getScaledName(iconName);
        const scaledFile = Gio.File.new_for_path(`${basePath}/${scaledName}`);
        if (scaledFile.query_exists(null))
            return scaledFile;

        const fallbackFile = Gio.File.new_for_path(`${basePath}/${iconName}`);
        if (fallbackFile.query_exists(null))
            return fallbackFile;

        const defaultScaledFile = Gio.File.new_for_path(`${this._iconsRootPath}/titlebuttons/${scaledName}`);
        if (defaultScaledFile.query_exists(null))
            return defaultScaledFile;

        return Gio.File.new_for_path(`${this._iconsRootPath}/titlebuttons/${iconName}`);
    }

    _getAltVariant(iconName) {
        if (!/-hover|-active/.test(iconName))
            return null;
        if (!iconName.endsWith('.png'))
            return null;
        return `${iconName.slice(0, -4)}-alt.png`;
    }

    destroy() {
        if (this._focusWindowSignal) global.display.disconnect(this._focusWindowSignal);
        if (this._settingsChangedId) this._settings.disconnect(this._settingsChangedId);
        if (this._wmLayoutChangedId) this._wmSettings.disconnect(this._wmLayoutChangedId);
        this._wmSettings = null;
        if (this._overviewShowingId) Main.overview.disconnect(this._overviewShowingId);
        if (this._overviewHiddenId) Main.overview.disconnect(this._overviewHiddenId);
        if (this._screenShieldActiveId && this._screenShield) this._screenShield.disconnect(this._screenShieldActiveId);
    if (this._screenShieldTimeoutId) { GLib.Source.remove(this._screenShieldTimeoutId); this._screenShieldTimeoutId = null; }

        if (this._focusWindow) {
            if (this._focusWindowMaximizeHorizSignal) this._focusWindow.disconnect(this._focusWindowMaximizeHorizSignal);
            if (this._focusWindowMaximizeVertSignal) this._focusWindow.disconnect(this._focusWindowMaximizeVertSignal);
            if (this._focusWindowFullscreenSignal) this._focusWindow.disconnect(this._focusWindowFullscreenSignal);
        }

        this._clutterSignalIds.forEach(([obj, id]) => obj.disconnect(id));
        this._clutterSignalIds = [];

        this._clutterSignalIds.forEach(([obj, id]) => obj.disconnect(id));
        this._clutterSignalIds = [];

    this._clearCloseButtonDelay();

        super.destroy();
    }
});

function _getPlacementSide() {
    if (!controlsIndicator)
        return 'left';
    return controlsIndicator._buttonSide || 'left';
}

function _replaceIndicatorOnPanel() {
    if (!controlsIndicator || !_extension)
        return;

    const container = controlsIndicator.container;
    const parent = container.get_parent();
    if (parent)
        parent.remove_child(container);

    controlsIndicator._rebuildButtons();
    const side = _getPlacementSide();
    if (side === 'right') {
        const rightBoxChildren = Main.panel._rightBox.get_children();
        Main.panel._rightBox.insert_child_at_index(container, rightBoxChildren.length);
    } else {
        Main.panel._leftBox.insert_child_at_index(container, 0);
    }
}

export function enable(ext) {
    if (ext) _extension = ext;
    if (!controlsIndicator) {
        controlsIndicator = new WindowControlsIndicator();

        const side = _getPlacementSide();
        if (side === 'right') {

            const rightBoxChildren = Main.panel._rightBox.get_children();
            Main.panel.addToStatusArea('window-controls', controlsIndicator, rightBoxChildren.length, 'right');
        } else {

            Main.panel.addToStatusArea('window-controls', controlsIndicator, 0, 'left');
        }
    }
}

export function disable() {
    if (controlsIndicator) {
        controlsIndicator.destroy();
        controlsIndicator = null;
    }
    _extension = null;
}
