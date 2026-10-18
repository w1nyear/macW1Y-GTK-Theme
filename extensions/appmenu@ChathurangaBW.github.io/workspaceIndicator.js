import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const INDICATOR_NAME = 'appmenu@ChathurangaBW.github.io-workspace-indicator';
const PANEL_NORMAL_HEIGHT = 34;
const PANEL_EXPANDED_HEIGHT = 114;
const DEFAULT_THUMB_WIDTH = 128;
const DEFAULT_THUMB_HEIGHT = 72;

const ACCENT_COLOR_MAP = {
    'blue':   '#007aff',
    'teal':   '#30b0c7',
    'green':  '#34c759',
    'yellow': '#ffcc00',
    'orange': '#ff9500',
    'red':    '#ff3b30',
    'pink':   '#ff2d55',
    'purple': '#af52de',
    'slate':  '#8e8e93',
    'brown':  '#a27447',
};

function getSystemAccentColor() {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const name = settings.get_string('accent-color');
        return ACCENT_COLOR_MAP[name] || '#007aff';
    } catch (_) {
        return '#007aff';
    }
}

function getWorkspaceNames() {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
        const names = settings.get_strv('workspace-names');
        return Array.isArray(names) ? names : [];
    } catch (_) {
        return [];
    }
}

function getWorkspaceName(index) {
    const names = getWorkspaceNames();
    if (names[index] && names[index].trim()) {
        return names[index].trim();
    }
    return `Робочий стіл ${index + 1}`;
}

function setWorkspaceName(index, name) {
    try {
        const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
        const names = settings.get_strv('workspace-names') || [];
        while (names.length <= index) {
            names.push(`Робочий стіл ${names.length + 1}`);
        }
        names[index] = name.trim() || `Робочий стіл ${index + 1}`;
        settings.set_strv('workspace-names', names);
    } catch (e) {
        console.error(`[SpacesBar] Failed to save workspace name: ${e}`);
    }
}

function registerGClass(baseName, classDef) {
    let name = baseName;
    if (GObject.type_from_name(name)) {
        name = `${baseName}_${GLib.random_int()}`;
    }
    return GObject.registerClass({ GTypeName: name }, classDef);
}

export const MacMissionControlSpacesBar = registerGClass(
    'MacMissionControlSpacesBar',
class MacMissionControlSpacesBar extends St.BoxLayout {
    _init() {
        super._init({
            name: 'mac-spaces-bar',
            vertical: true,
            reactive: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        this._isExpanded = false;
        this._isRenaming = false;
        this._activeRenameFinish = null;
        this._collapseTimeoutId = 0;

        // 1. Compact Labels Box (height 34px)
        this._labelsBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'height: 34px;',
            reactive: true,
            track_hover: true,
        });
        this.add_child(this._labelsBox);

        // 2. Expanded Thumbnails Box (anchored 10px below top of panel)
        this._thumbnailsBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.START,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-top: 10px; margin-bottom: 6px;',
            visible: false,
            reactive: true,
            track_hover: true,
        });
        this.add_child(this._thumbnailsBox);

        this.connect('notify::hover', () => {
            if (this.hover) {
                if (this._collapseTimeoutId) {
                    GLib.source_remove(this._collapseTimeoutId);
                    this._collapseTimeoutId = 0;
                }
                this._expand();
            } else {
                if (this._isRenaming) return;
                if (this._collapseTimeoutId) {
                    GLib.source_remove(this._collapseTimeoutId);
                }
                this._collapseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._collapseTimeoutId = 0;
                    if (!this.hover && !this._isRenaming) {
                        this._collapse();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    _isDescendant(actor, ancestor) {
        let cur = actor;
        while (cur) {
            if (cur === ancestor) return true;
            cur = cur.get_parent ? cur.get_parent() : null;
        }
        return false;
    }

    update() {
        this._buildLabels();
        if (this._isExpanded) {
            this._buildThumbnails();
        }
    }

    _buildLabels() {
        this._labelsBox.destroy_all_children();

        const wsManager = global.workspace_manager;
        const count = wsManager.get_n_workspaces();
        const activeIdx = wsManager.get_active_workspace_index();

        for (let i = 0; i < count; i++) {
            const ws = wsManager.get_workspace_by_index(i);
            const name = getWorkspaceName(i);
            const isActive = (i === activeIdx);

            const btn = new St.Button({
                style: isActive
                    ? 'background-color: rgba(255, 255, 255, 0.22); border-radius: 6px; padding: 2px 12px; margin: 0 4px;'
                    : 'background-color: transparent; border-radius: 6px; padding: 2px 10px; margin: 0 4px;',
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const lbl = new St.Label({
                text: name,
                style: isActive
                    ? 'font-size: 13px; font-weight: 600; color: #ffffff;'
                    : 'font-size: 13px; font-weight: 400; color: rgba(255, 255, 255, 0.75);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(lbl);

            btn.connect('notify::hover', () => {
                if (btn.hover) {
                    this._expand();
                    if (!isActive) {
                        btn.set_style('background-color: rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 2px 10px; margin: 0 4px;');
                        lbl.set_style('font-size: 13px; font-weight: 500; color: #ffffff;');
                    }
                } else if (!btn.hover && !isActive) {
                    btn.set_style('background-color: transparent; border-radius: 6px; padding: 2px 10px; margin: 0 4px;');
                    lbl.set_style('font-size: 13px; font-weight: 400; color: rgba(255, 255, 255, 0.75);');
                }
            });

            btn.connect('clicked', () => {
                ws.activate(global.get_current_time());
                Main.overview.hide();
            });

            this._labelsBox.add_child(btn);
        }

        // Plus button at right end of labels
        const plusBtn = this._createPlusButton(false);
        this._labelsBox.add_child(plusBtn);
    }

    _buildThumbnails(editingIdx = -1, animateIdx = -1) {
        if (this._activeRenameFinish && editingIdx === -1) {
            this._activeRenameFinish(true);
        }

        this._thumbnailsBox.destroy_all_children();

        const wsManager = global.workspace_manager;
        const actualCount = wsManager.get_n_workspaces();
        const count = Math.max(actualCount, editingIdx >= 0 ? editingIdx + 1 : 0);
        const activeIdx = wsManager.get_active_workspace_index();
        const mon = Main.layoutManager.primaryMonitor;

        let thumbWidth = DEFAULT_THUMB_WIDTH;
        let thumbHeight = DEFAULT_THUMB_HEIGHT;
        const maxAvailableWidth = (mon ? mon.width : 1920) - 240;
        if (count * (thumbWidth + 14) + 70 > maxAvailableWidth) {
            thumbWidth = Math.max(68, Math.floor((maxAvailableWidth - 70) / count) - 14);
            thumbHeight = Math.round(thumbWidth * 9 / 16);
        }

        const monW = mon ? mon.width : 1920;
        const monH = mon ? mon.height : 1080;
        const monX = mon ? mon.x : 0;
        const monY = mon ? mon.y : 0;
        const scaleX = thumbWidth / monW;
        const scaleY = thumbHeight / monH;

        for (let i = 0; i < count; i++) {
            const ws = wsManager.get_workspace_by_index(Math.min(i, actualCount - 1));
            const name = getWorkspaceName(i);
            const isActive = (i === activeIdx);

            const itemCol = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.START,
                style: `margin: 0 6px; width: ${thumbWidth + 10}px;`,
                reactive: true,
                track_hover: true,
            });

            // Card container
            const accent = getSystemAccentColor();
            const cardBtn = new St.Button({
                style: isActive
                    ? `width: ${thumbWidth}px; height: ${thumbHeight}px; border: 2px solid ${accent}; border-radius: 6px; box-shadow: 0 0 10px ${accent}a6; background-color: rgba(22, 38, 62, 0.88); padding: 0;`
                    : `width: ${thumbWidth}px; height: ${thumbHeight}px; border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 6px; background-color: rgba(30, 30, 35, 0.60); padding: 0;`,
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            cardBtn.set_pivot_point(0.5, 0.5);

            // Mini desktop preview canvas
            const desktopCanvas = new Clutter.Actor({
                width: thumbWidth,
                height: thumbHeight,
                clip_to_allocation: true,
            });
            cardBtn.set_child(desktopCanvas);

            // Populate mini window representation safely
            if (ws) {
                try {
                    const windows = ws.list_windows().filter(w => !w.is_skip_taskbar() && !w.minimized);
                    for (const win of windows) {
                        const rect = win.get_frame_rect();
                        const wx = Math.max(2, Math.min(thumbWidth - 10, Math.round((rect.x - monX) * scaleX)));
                        const wy = Math.max(2, Math.min(thumbHeight - 8, Math.round((rect.y - monY) * scaleY)));
                        const ww = Math.max(10, Math.min(thumbWidth - wx - 2, Math.round(rect.width * scaleX)));
                        const wh = Math.max(8, Math.min(thumbHeight - wy - 2, Math.round(rect.height * scaleY)));

                        const miniWin = new St.Widget({
                            style: isActive
                                ? 'background-color: rgba(255, 255, 255, 0.32); border: 1px solid rgba(255, 255, 255, 0.55); border-radius: 2px;'
                                : 'background-color: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.30); border-radius: 2px;',
                            x: wx,
                            y: wy,
                            width: ww,
                            height: wh,
                        });
                        desktopCanvas.add_child(miniWin);
                    }
                } catch (_) {}
            }

            itemCol.add_child(cardBtn);

            // Name Container underneath the card
            const nameContainer = new St.Bin({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `width: ${thumbWidth + 10}px; margin-top: 5px; min-height: 20px;`,
            });
            itemCol.add_child(nameContainer);

            const nameBtn = new St.Button({
                style: 'background-color: transparent; border: none; padding: 2px 6px; border-radius: 4px;',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            const nameLbl = new St.Label({
                text: name,
                style: 'font-size: 11px; font-weight: 500; color: #ffffff; text-align: center;',
            });
            if (nameLbl.clutter_text) {
                nameLbl.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            }
            nameBtn.set_child(nameLbl);
            nameContainer.set_child(nameBtn);

            // Visible on hover or when editing
            nameContainer.opacity = (i === editingIdx) ? 255 : 0;

            const onHoverChange = (isHover) => {
                if (this._isRenaming && nameContainer.get_child() instanceof St.Entry) {
                    return;
                }
                if (isHover) {
                    cardBtn.ease({
                        scale_x: 1.08,
                        scale_y: 1.08,
                        duration: 160,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                    nameContainer.ease({
                        opacity: 255,
                        duration: 160,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                } else {
                    cardBtn.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: 160,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                    if (i !== editingIdx) {
                        nameContainer.ease({
                            opacity: 0,
                            duration: 140,
                            mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        });
                    }
                }
            };

            cardBtn.connect('notify::hover', () => onHoverChange(cardBtn.hover || itemCol.hover || nameBtn.hover));
            itemCol.connect('notify::hover', () => onHoverChange(cardBtn.hover || itemCol.hover || nameBtn.hover));
            nameBtn.connect('notify::hover', () => onHoverChange(cardBtn.hover || itemCol.hover || nameBtn.hover));

            // Clicking card activates workspace
            cardBtn.connect('clicked', () => {
                if (ws) {
                    ws.activate(global.get_current_time());
                }
                Main.overview.hide();
            });

            // Clicking name button starts inline rename!
            nameBtn.connect('clicked', () => {
                this._startInlineRename(i, nameContainer, name, thumbWidth);
            });

            // Check if this item is entering with animation
            if (i === animateIdx) {
                itemCol.set_pivot_point(0.5, 0.5);
                itemCol.scale_x = 0.3;
                itemCol.scale_y = 0.3;
                itemCol.opacity = 0;
                itemCol.ease({
                    scale_x: 1.0,
                    scale_y: 1.0,
                    opacity: 255,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_BACK,
                });
            }

            // If this item was requested to start in editing mode (e.g. from + click)
            if (i === editingIdx) {
                this._startInlineRename(i, nameContainer, name, thumbWidth);
            }

            this._thumbnailsBox.add_child(itemCol);
        }

        // Plus button column at the right end of thumbnails
        const plusCol = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.START,
            x_align: Clutter.ActorAlign.CENTER,
            style: `margin-left: 8px; margin-top: ${Math.round((thumbHeight - 32) / 2)}px; height: 32px;`,
        });
        const plusBtn = this._createPlusButton(true);
        plusCol.add_child(plusBtn);
        this._thumbnailsBox.add_child(plusCol);
    }

    _createPlusButton(isThumbMode) {
        const btn = new St.Button({
            style: isThumbMode
                ? 'padding: 4px 10px; background-color: transparent;'
                : 'padding: 2px 8px; margin-left: 6px; background-color: transparent;',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const fontSize = isThumbMode ? '22px' : '18px';
        const lbl = new St.Label({
            text: '+',
            style: `font-size: ${fontSize}; font-weight: 300; color: rgba(255, 255, 255, 0.85);`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        btn.set_child(lbl);

        btn.connect('notify::hover', () => {
            if (btn.hover) {
                lbl.set_style(`font-size: ${fontSize}; font-weight: 300; color: #ffffff;`);
            } else {
                lbl.set_style(`font-size: ${fontSize}; font-weight: 300; color: rgba(255, 255, 255, 0.85);`);
            }
        });

        btn.connect('clicked', () => {
            this._onPlusClicked();
        });

        return btn;
    }

    _onPlusClicked() {
        const wsManager = global.workspace_manager;
        const currentCount = wsManager.get_n_workspaces();
        const newCount = currentCount + 1;

        try {
            const mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
            if (mutterSettings.get_boolean('dynamic-workspaces')) {
                mutterSettings.set_boolean('dynamic-workspaces', false);
            }
        } catch (_) {}

        try {
            const wmSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
            wmSettings.set_int('num-workspaces', newCount);
        } catch (_) {}

        wsManager.append_new_workspace(false, global.get_current_time());

        const newIdx = newCount - 1;
        const defaultName = `Робочий стіл ${newCount}`;
        setWorkspaceName(newIdx, defaultName);

        this._expand();
        this._buildThumbnails(newIdx, newIdx);
    }

    _startInlineRename(idx, nameContainer, currentName, thumbWidth) {
        if (this._activeRenameFinish) {
            this._activeRenameFinish(true);
        }

        this._isRenaming = true;
        nameContainer.opacity = 255;

        const accent = getSystemAccentColor();
        const entry = new St.Entry({
            text: currentName,
            can_focus: true,
            style: `font-size: 11px; font-weight: 500; color: #ffffff; background-color: rgba(20, 20, 25, 0.90); border: 1.5px solid ${accent}; border-radius: 4px; padding: 2px 4px; text-align: center; width: ${thumbWidth}px;`,
        });

        nameContainer.set_child(entry);

        let committed = false;
        let stageClickId = 0;

        const finish = (save) => {
            if (committed) return;
            committed = true;
            this._activeRenameFinish = null;
            if (stageClickId) {
                global.stage.disconnect(stageClickId);
                stageClickId = 0;
            }
            this._isRenaming = false;

            if (save) {
                const newName = entry.get_text()?.trim() || currentName;
                setWorkspaceName(idx, newName);
            }
            this.update();
        };

        this._activeRenameFinish = finish;

        entry.clutter_text.connect('key-press-event', (_actor, event) => {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
                finish(true);
                return Clutter.EVENT_STOP;
            }
            if (sym === Clutter.KEY_Escape) {
                finish(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Stage click listener: click anywhere outside commits rename!
        stageClickId = global.stage.connect('button-press-event', (_stage, event) => {
            const actor = event.get_source ? event.get_source() : null;
            if (actor !== entry && !this._isDescendant(actor, entry)) {
                finish(true);
            }
            return Clutter.EVENT_PROPAGATE;
        });

        entry.clutter_text.connect('notify::has-focus', () => {
            if (!entry.clutter_text.has_focus) {
                finish(true);
            }
        });

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!committed && entry.clutter_text) {
                global.stage.set_key_focus(entry.clutter_text);
                entry.clutter_text.set_selection(0, -1);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _expand() {
        if (this._isExpanded) return;
        this._isExpanded = true;

        this._buildThumbnails();
        this._labelsBox.visible = false;
        this._thumbnailsBox.visible = true;

        Main.layoutManager.panelBox.remove_all_transitions();
        Main.panel.remove_all_transitions();

        Main.layoutManager.panelBox.ease({
            height: PANEL_EXPANDED_HEIGHT,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        Main.panel.ease({
            height: PANEL_EXPANDED_HEIGHT,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _collapse(instant = false) {
        if (this._isRenaming) return;
        if (!this._isExpanded && !instant) return;
        this._isExpanded = false;

        if (this._activeRenameFinish) {
            this._activeRenameFinish(true);
        }

        this._thumbnailsBox.visible = false;
        this._labelsBox.visible = true;

        Main.layoutManager.panelBox.remove_all_transitions();
        Main.panel.remove_all_transitions();

        if (instant) {
            Main.layoutManager.panelBox.height = PANEL_NORMAL_HEIGHT;
            Main.panel.height = PANEL_NORMAL_HEIGHT;
        } else {
            Main.layoutManager.panelBox.ease({
                height: PANEL_NORMAL_HEIGHT,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
            Main.panel.ease({
                height: PANEL_NORMAL_HEIGHT,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }
    }

    onOverviewHiding() {
        if (this._collapseTimeoutId) {
            GLib.source_remove(this._collapseTimeoutId);
            this._collapseTimeoutId = 0;
        }
        if (this._activeRenameFinish) {
            this._activeRenameFinish(true);
        }
        this._isRenaming = false;
        this._collapse(true);
    }

    destroy() {
        if (this._collapseTimeoutId) {
            GLib.source_remove(this._collapseTimeoutId);
            this._collapseTimeoutId = 0;
        }
        if (this._activeRenameFinish) {
            this._activeRenameFinish(true);
        }
        this._collapse(true);
        super.destroy();
    }
});

const WorkspaceIndicatorButton = registerGClass(
    'WorkspaceIndicatorButton',
class WorkspaceIndicatorButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'AppMenu Workspace Indicator');
        this.add_style_class_name('appmenu-workspace-indicator-button');
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'appmenu-workspace-indicator-label',
        });
        this.add_child(this._label);
    }

    update(activeIndex, count) {
        const safeCount = Math.max(1, count);
        const dots = [];
        for (let i = 0; i < safeCount; i++)
            dots.push(i === activeIndex ? '●' : '○');
        this._label.set_text(dots.join(' '));
    }
});

export class WorkspaceIndicatorController {
    constructor(settings) {
        this._settings = settings;
        this._indicator = null;
        this._workspaceManager = global.workspace_manager;
        this._signals = [];
        this._settingsSignals = [];
        this._overviewSignals = [];
        this._hiddenCenterChildren = [];
        this._hiddenLeftChildren = [];
        this._hiddenRightChildren = [];
        this._prevCenterBoxYAlign = undefined;
        this._spacesBar = new MacMissionControlSpacesBar();

        this._connect();
        this._syncVisibility();
        this._connectOverview();
    }

    destroy() {
        this._disconnectOverview();
        this._disconnect();
        this._destroyIndicator();
        if (this._spacesBar) {
            this._spacesBar.destroy();
            this._spacesBar = null;
        }
        this._settings = null;
        this._workspaceManager = null;
    }

    _connectOverview() {
        if (Main.overview) {
            this._setupHideGnomeWorkspaceThumbnails();
            this._overviewSignals = [
                Main.overview.connect('showing', () => this._onOverviewShowing()),
                Main.overview.connect('hiding', () => this._onOverviewHiding()),
            ];
            if (Main.overview.visible) {
                this._onOverviewShowing();
            }
        }
    }

    _setupHideGnomeWorkspaceThumbnails() {
        try {
            const controls = Main.overview?._overview?.controls;
            const tb = controls?._thumbnailsBox;
            if (!tb) return;

            if (!tb._origUpdateShouldShow) {
                tb._origUpdateShouldShow = tb._updateShouldShow;
                tb._updateShouldShow = function() {
                    this._shouldShow = false;
                    this.notify('should-show');
                };
            }

            if (!tb._macShouldShowPropertyOverridden) {
                tb._macShouldShowPropertyOverridden = true;
                Object.defineProperty(tb, 'shouldShow', {
                    get: () => false,
                    configurable: true,
                });
            }

            this._hideGnomeThumbnails();
        } catch (e) {
            console.error(`[WorkspaceIndicator] Error hiding GNOME thumbnails: ${e}`);
        }
    }

    _hideGnomeThumbnails() {
        try {
            const controls = Main.overview?._overview?.controls;
            const tb = controls?._thumbnailsBox;
            if (tb) {
                tb._shouldShow = false;
                tb.visible = false;
                tb.opacity = 0;
                tb.expandFraction = 0.0;
                controls._updateThumbnailsBox?.(false);
            }
        } catch (_) {}
    }

    _restoreGnomeWorkspaceThumbnails() {
        try {
            const controls = Main.overview?._overview?.controls;
            const tb = controls?._thumbnailsBox;
            if (!tb) return;

            if (tb._origUpdateShouldShow) {
                tb._updateShouldShow = tb._origUpdateShouldShow;
                delete tb._origUpdateShouldShow;
            }
            if (tb._macShouldShowPropertyOverridden) {
                delete tb.shouldShow;
                delete tb._macShouldShowPropertyOverridden;
            }
            tb._updateShouldShow?.();
            controls._updateThumbnailsBox?.(false);
        } catch (_) {}
    }

    _disconnectOverview() {
        this._restoreGnomeWorkspaceThumbnails();
        if (Main.overview) {
            for (const id of this._overviewSignals) {
                Main.overview.disconnect(id);
            }
        }
        this._overviewSignals = [];
        this._onOverviewHiding();
    }

    _onOverviewShowing() {
        this._hideGnomeThumbnails();
        this._hiddenCenterChildren = [];
        this._hiddenLeftChildren = [];
        this._hiddenRightChildren = [];

        // 1. Hide app menus on left box during overview (keep Apple logo at index 0)
        if (Main.panel && Main.panel._leftBox) {
            const leftChildren = Main.panel._leftBox.get_children();
            for (let i = 1; i < leftChildren.length; i++) {
                const child = leftChildren[i];
                if (child.visible) {
                    this._hiddenLeftChildren.push(child);
                    child.visible = false;
                }
            }
        }

        // 2. Hide all items on right box during overview (Clock, Quick Settings, Tray, etc.)
        if (Main.panel && Main.panel._rightBox) {
            const rightChildren = Main.panel._rightBox.get_children();
            for (const child of rightChildren) {
                if (child.visible) {
                    this._hiddenRightChildren.push(child);
                    child.visible = false;
                }
            }
        }

        // 3. Middle / center box: anchor to top so it does not drop down vertically!
        if (Main.panel && Main.panel._centerBox) {
            this._prevCenterBoxYAlign = Main.panel._centerBox.y_align;
            Main.panel._centerBox.y_align = Clutter.ActorAlign.START;

            for (const child of Main.panel._centerBox.get_children()) {
                if (child === this._spacesBar) continue;
                if (child.visible) {
                    this._hiddenCenterChildren.push(child);
                    child.visible = false;
                }
            }
            if (!this._spacesBar.get_parent()) {
                Main.panel._centerBox.add_child(this._spacesBar);
            }
        }

        this._spacesBar.visible = true;
        this._spacesBar.update();
    }

    _onOverviewHiding() {
        if (this._spacesBar) {
            this._spacesBar.onOverviewHiding();
            this._spacesBar.visible = false;
        }

        // Restore center box alignment
        if (Main.panel && Main.panel._centerBox && this._prevCenterBoxYAlign !== undefined) {
            Main.panel._centerBox.y_align = this._prevCenterBoxYAlign;
        }

        // Restore right box children
        for (const child of this._hiddenRightChildren) {
            try {
                child.visible = true;
            } catch (_) {}
        }
        this._hiddenRightChildren = [];

        // Restore left box children
        for (const child of this._hiddenLeftChildren) {
            try {
                child.visible = true;
            } catch (_) {}
        }
        this._hiddenLeftChildren = [];

        // Restore center box children
        for (const child of this._hiddenCenterChildren) {
            try {
                child.visible = true;
            } catch (_) {}
        }
        this._hiddenCenterChildren = [];
    }

    _connect() {
        if (this._workspaceManager) {
            this._signals = [
                this._workspaceManager.connect('active-workspace-changed', () => this._update()),
                this._workspaceManager.connect('notify::n-workspaces', () => this._update()),
                this._workspaceManager.connect('workspace-added', () => this._update()),
                this._workspaceManager.connect('workspace-removed', () => this._update()),
            ];
        }

        if (this._settings) {
            this._settingsSignals = [
                this._settings.connect('changed::show-workspace-indicator', () => this._syncVisibility()),
                this._settings.connect('changed::workspace-indicator-position', () => this._recreateIndicator()),
            ];
        }
    }

    _disconnect() {
        if (this._workspaceManager) {
            for (const id of this._signals)
                this._workspaceManager.disconnect(id);
        }
        this._signals = [];

        if (this._settings) {
            for (const id of this._settingsSignals)
                this._settings.disconnect(id);
        }
        this._settingsSignals = [];
    }

    _enabled() {
        try {
            return this._settings?.get_boolean('show-workspace-indicator') ?? false;
        } catch (_e) {
            return false;
        }
    }

    _position() {
        try {
            return this._settings?.get_string('workspace-indicator-position') || 'right';
        } catch (_e) {
            return 'right';
        }
    }

    _syncVisibility() {
        if (this._enabled())
            this._ensureIndicator();
        else
            this._destroyIndicator();
    }

    _recreateIndicator() {
        const wasEnabled = this._indicator !== null;
        this._destroyIndicator();
        if (wasEnabled && this._enabled())
            this._ensureIndicator();
    }

    _ensureIndicator() {
        if (this._indicator)
            return;

        this._indicator = new WorkspaceIndicatorButton();
        const position = this._position() === 'left' ? 'left' : 'right';
        Main.panel.addToStatusArea(INDICATOR_NAME, this._indicator, 2, position);
        this._update();
    }

    _destroyIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _update() {
        if (this._spacesBar && this._spacesBar.visible) {
            this._spacesBar.update();
        }

        if (!this._indicator || !this._workspaceManager)
            return;

        const active = this._workspaceManager.get_active_workspace_index();
        const count = this._workspaceManager.get_n_workspaces();
        this._indicator.update(active, count);
    }
}
