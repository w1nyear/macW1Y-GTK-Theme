// Spotlight: popup widget and lifecycle orchestration
// SPDX-License-Identifier: GPL-3.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import {PopupBackdrop} from '../components/backdrop.js';
import {PopupPositioner} from '../components/positioner.js';
import {SpotlightGlass} from '../components/glass.js';
import {AppsView} from '../components/appsView.js';
import {OverviewSearchStealer} from '../../overview/searchStealer.js';
import {ThumbnailEnhancer} from '../../overview/thumbnails.js';
import {installCloseDefense, uninstallCloseDefense} from '../behavior/defense.js';
import {applyTheme} from '../behavior/theme.js';
import {scheduleIdle, cancelIdle, trackTextVisibility} from '../behavior/lifecycle.js';
import {connectGlobalSignals, disconnectGlobalSignals} from '../behavior/signals.js';

// Panel geometry: the popup is the main panel plus three detached round
// tool buttons on the right. TOTAL_WIDTH matches the positioner; the root
// spacing (12px gaps) is part of the arithmetic.
const TOTAL_WIDTH = 620;
const TOOL_GAP = 12;
const TOOL_SIZE = 56;
const TOOLS_WIDTH = TOOL_SIZE * 3 + TOOL_GAP * 2;
const PANEL_WIDTH = TOTAL_WIDTH - TOOL_GAP - TOOLS_WIDTH;
// Side padding of the apps grid, mirrors kiwi's CONTENT_PAD.
const CONTENT_SIDE = 22;

export const SpotlightPopup = GObject.registerClass(
class SpotlightPopup extends St.Widget {
    _init(settings) {
        // Horizontal row: the main panel plus a detached tool pill on the
        // right. The 12px gap here must match PANEL_WIDTH below.
        super._init({
            layout_manager: new Clutter.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                spacing: 12,
            }),
            reactive: true,
            can_focus: true,
            visible: false,
        });
        this._settings = settings;
        this._backdrop = null;
        this._positioner = new PopupPositioner(this);
        this._ifaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        this._visible = false;
        this._openIdleId = 0;
        this._closeIdleId = 0;
        this._opening = false;
        this._textChangedEventId = 0;
        // Set when openApps() is requested while the popup is still opening.
        this._pendingApps = false;
        // Set once destroy() has run, so a second disable() is a no-op.
        this._destroyed = false;

        this._content = new St.BoxLayout({
            style_class: 'spotlight-container',
            vertical: true,
            width: TOTAL_WIDTH - TOOL_GAP - TOOLS_WIDTH,
        });
        this.add_child(this._content);
        // Search bar holds only the entry now; the tools live in their own
        // detached pill beside the panel.
        this._bar = new St.BoxLayout({
            style_class: 'spotlight-bar',
            vertical: false,
            x_expand: true,
        });
        // Three detached round tools beside the panel, each pill-tall.
        // No shared container: every button is its own glass circle.
        this._toolButtons = [];
        for (const icon of ['view-app-grid-symbolic', 'folder-symbolic',
            'system-run-symbolic']) {
            const tool = new St.Button({
                style_class: 'spotlight-tool',
                can_focus: false,
                y_align: Clutter.ActorAlign.START,
            });
            tool.add_child(new St.Icon({icon_name: icon}));
            this.add_child(tool);
            this._toolButtons.push(tool);
        }
        this._toolButtons[0].connect('clicked', () => this._toggleApps());
        this._toolButtons[1].connect('clicked', () => this._openFiles());
        this._toolButtons[2].connect('clicked', () => this._openRunDialog());
        this._appsView = new AppsView(
            () => this.close(),
            () => this._hideApps(),
        );
        this._glass = new SpotlightGlass(this, this._content, this._settings);
        this._toolGlasses = this._toolButtons.map(tool =>
            new SpotlightGlass(this, this._content, this._settings, tool));

        this._stealer = new OverviewSearchStealer(this);
        this._thumbnailEnhancer = new ThumbnailEnhancer();
        connectGlobalSignals(this, this._settings, this._ifaceSettings);
    }

    stealOverviewSearch() {
        this._stealer.steal();
        this._thumbnailEnhancer.apply();
    }

    returnOverviewSearch() {
        this._stealer.restore();
        this._thumbnailEnhancer.revert();
    }

    open() {
        if (this._visible || this._opening || this._openIdleId !== 0)
            return;
        if (!this._stealer.entry || !this._stealer.search)
            return;
        // macOS Tahoe mutual exclusion: opening Spotlight closes any other
        // center (Control Center, Notification Center, Clipboard, ...).
        if (typeof globalThis._macCloseAllCenters === 'function') {
            try { globalThis._macCloseAllCenters('spotlight'); } catch (_) {}
        }
        this._opening = true;
        scheduleIdle(this, '_openIdleId', () => this._doOpen());
    }

    // Opens Spotlight straight into the Applications (Launchpad) browse view.
    // Used by the macOS ecosystem entry points that used to open the old
    // fullscreen Launchpad (blur-my-shell, dash-to-dock, gestures, eval-helper).
    openApps() {
        if (this._visible) {
            this._showApps();
            return;
        }
        if (this._opening || this._openIdleId !== 0) {
            this._pendingApps = true;
            return;
        }
        if (!this._stealer.entry || !this._stealer.search)
            return;
        if (typeof globalThis._macCloseAllCenters === 'function') {
            try { globalThis._macCloseAllCenters('apps'); } catch (_) {}
        }
        this._pendingApps = true;
        this._opening = true;
        scheduleIdle(this, '_openIdleId', () => this._doOpen());
    }

    _doOpen() {
        this._opening = false;
        const entry = this._stealer.entry;
        const search = this._stealer.search;

        // Panel width caps at 85% of the monitor, like the positioner.
        // The stolen overview entry requests a huge natural width, so it
        // gets a fixed share of the panel minus the container padding.
        const monitor = this._positioner.getTargetMonitor();
        this._monitor = monitor;
        const panelWidth = Math.max(200,
            Math.min(PANEL_WIDTH, Math.floor(monitor.width * 0.85 - TOOL_GAP - TOOLS_WIDTH)));
        this._content.width = panelWidth;

        if (entry.get_parent())
            entry.get_parent().remove_child(entry);
        entry.visible = true;
        entry.x_expand = true;
        entry.width = Math.max(200, panelWidth - 16);
        this._bar.insert_child_at_index(entry, 0);

        // Bar first, results below. Starts as a collapsed pill.
        if (this._bar.get_parent())
            this._bar.get_parent().remove_child(this._bar);
        this._content.add_child(this._bar);

        if (search.get_parent())
            search.get_parent().remove_child(search);
        this._content.add_child(search);
        this._content.add_style_class_name('spotlight-collapsed');

        // Applications browse view, hidden until the first tool opens it.
        if (this._appsView.get_parent())
            this._appsView.get_parent().remove_child(this._appsView);
        this._content.add_child(this._appsView);
        this._appsView.hide();

        applyTheme(this._content, this._toolButtons, this._settings, this._ifaceSettings);
        // Syncs the glass corner radius and the fallback tinted fill.
        this._glass.refreshCss();

        this._backdrop = new PopupBackdrop(() => this.close(), monitor);
        this._backdrop.show();

        if (this.get_parent())
            Main.layoutManager.removeChrome(this);
        Main.layoutManager.addChrome(this);

        this._positioner.showCentered(() => entry.grab_key_focus());

        // Refractive glass behind the panel (no-op without liquid-glass).
        this._glass.attach();
        this._glass.show();
        for (const g of this._toolGlasses) {
            g.attach();
            g.show();
        }

        search._text.set_text('');
        search.visible = false;

        if (!this._textChangedEventId) {
            this._textChangedEventId = trackTextVisibility(
                search, this._content, hasText => {
                    // Typing always returns to search mode.
                    if (hasText)
                        this._appsView.hide();
                });
        }

        installCloseDefense(this, search, entry);
        this._visible = true;

        // openApps() was requested while we were still opening: reveal the
        // Applications browse view now that the popup is fully on screen.
        if (this._pendingApps) {
            this._pendingApps = false;
            this._showApps();
        }
    }

    // Convenience toggle used by the macOS ecosystem global entry points.
    toggle() {
        if (this._visible || this._opening)
            this.close();
        else
            this.open();
    }

    // Read-only open state for the mutual-exclusion coordinator (kiwi's
    // centerManager checks `_macSpotlightGlobalInstance._isOpen`).
    get _isOpen() {
        return this._visible;
    }

    // Tahoe Applications view behind the first tool button.
    _toggleApps() {
        if (this._appsView.visible)
            this._hideApps();
        else
            this._showApps();
    }

    _showApps() {
        const dark = !this._content.has_style_class_name('theme-light');
        this._setToolsVisible(false);
        this._content.width = TOTAL_WIDTH;
        this._appsView.showView(TOTAL_WIDTH - CONTENT_SIDE * 2, dark);
        this._stealer.search.hide();
        this._content.remove_style_class_name('spotlight-collapsed');
        this._glass.refreshCss();
        this._glass._syncGeometry();
    }

    _hideApps() {
        this._appsView.hideView();
        this._setToolsVisible(true);
        this._content.width = PANEL_WIDTH;
        // Back to the pill when there is no query to show results for.
        if (this._stealer.search._text.get_text().length === 0)
            this._content.add_style_class_name('spotlight-collapsed');
        this._glass.refreshCss();
        this._glass._syncGeometry();
    }

    _setToolsVisible(visible) {
        for (const tool of this._toolButtons) {
            tool.visible = visible;
        }
        for (const g of this._toolGlasses) {
            if (visible)
                g.show();
            else
                g.hide();
        }
    }

    // Folder tool: opens the file manager at home.
    _openFiles() {
        this.close();
        try {
            const app = Shell.AppSystem.get_default()
                .lookup_app('org.gnome.Nautilus.desktop');
            if (app) {
                app.open_new_window(-1);
                return;
            }
        } catch (_) {
            // fall through to the default handler
        }
        try {
            Gio.AppInfo.launch_default_for_uri(
                `file://${GLib.get_home_dir()}`, null);
        } catch (_) {
            // nowhere to open files from
        }
    }

    // Run tool: opens the GNOME run-command dialog, falling back to a
    // terminal when the dialog is unavailable.
    _openRunDialog() {
        this.close();
        try {
            if (typeof Main.openRunDialog === 'function') {
                Main.openRunDialog();
                return;
            }
        } catch (_) {
            // fall through to the terminal fallback
        }
        try {
            const appSys = Shell.AppSystem.get_default();
            const term = appSys.lookup_app('org.gnome.Console.desktop') ??
                appSys.lookup_app('org.gnome.Terminal.desktop');
            term?.open_new_window(-1);
        } catch (_) {
            // nothing to run from
        }
    }

    close() {
        if ((!this._visible && !this._opening) || this._closeIdleId !== 0)
            return;
        cancelIdle(this, '_openIdleId');
        this._opening = false;
        scheduleIdle(this, '_closeIdleId', () => this._doClose());
    }

    _doClose() {
        this._positioner.stop();
        this._glass.hide();
        for (const g of this._toolGlasses) {
            g.hide();
        }
        this._appsView.hideView();
        if (this._backdrop) {
            this._backdrop.destroy();
            this._backdrop = null;
        }

        uninstallCloseDefense(this, this._stealer.search);

        if (this._textChangedEventId) {
            this._stealer.search._text.disconnect(this._textChangedEventId);
            this._textChangedEventId = 0;
        }

        const entry = this._stealer.entry;
        if (entry && entry.get_parent()) {
            entry.visible = false;
            entry.x_expand = false;
            // Restores the natural width so the overview entry is
            // unaffected once returned.
            entry.width = -1;
            entry.get_parent().remove_child(entry);
        }

        const search = this._stealer.search;
        if (search && search.get_parent()) {
            search.hide();
            search.get_parent().remove_child(search);
        }

        this._visible = false;
        this._animateClose(() => {
            if (this.get_parent())
                Main.layoutManager.removeChrome(this);
        });
    }

    _syncClose() {
        cancelIdle(this, '_openIdleId');
        cancelIdle(this, '_closeIdleId');
        this._opening = false;
        if (this._visible)
            this._doClose();
    }

    _animateClose(onComplete) {
        const stSettings = St.Settings.get();
        if (stSettings && !stSettings.enable_animations) {
            this.hide();
            this.opacity = 255;
            this.scale_x = 1.0;
            this.scale_y = 1.0;
            onComplete();
            return;
        }
        // Cancel any in-flight open animation.
        this.remove_transition('opacity');
        this.remove_transition('scale-x');
        this.remove_transition('scale-y');
        this.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.hide();
                // Reset properties so the next open starts from a clean state.
                this.opacity = 255;
                this.scale_x = 1.0;
                this.scale_y = 1.0;
                onComplete();
            },
        });
    }

    destroy() {
        // Idempotent: GNOME Shell may call disable()/destroy() more than once
        // across reloads. Guard so a second pass never touches freed fields.
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._syncClose();
        disconnectGlobalSignals(this);
        try { this._glass?.destroy(); } catch (_) {}
        this._glass = null;
        if (this._toolGlasses) {
            for (const g of this._toolGlasses) {
                try { g.destroy(); } catch (_) {}
            }
        }
        this._toolGlasses = null;
        this._appsView = null;
        this._toolButtons = null;
        this._bar = null;
        this._content = null;
        this._settings = null;
        super.destroy();
    }
});
