import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as utils from '../conveniences/utils.js';

const BlurModule = await utils.import_in_shell_only('gi://Blur');
const Shell = await utils.import_in_shell_only('gi://Shell');
const BlurOrShell = utils.is_usable_blur_module(BlurModule) ? BlurModule : Shell;

export const QuickSettingsBlur = class QuickSettingsBlur {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.enabled = false;
        this.blurred_actors = new Set();
        this.sigma = 10; // Blur at 10% as requested by user
        this._waiting_startup = false;
        this._grid_connected = false;
    }

    enable() {
        if (this.enabled)
            return;

        const quickSettings = Main.panel?.statusArea?.quickSettings;
        if (!quickSettings?.menu) {
            if (!this._waiting_startup) {
                this._waiting_startup = true;
                this.connections.connect(Main.layoutManager, 'startup-complete', () => {
                    this._waiting_startup = false;
                    this.enable();
                });
            }
            return;
        }

        this.enabled = true;
        const menu = quickSettings.menu;

        // Disable offscreen redirect on parent containers so BACKGROUND blur can capture wallpaper
        this.disable_offscreen_redirect(menu);

        // Clean any blur from submenus (e.g. Wi-Fi/Bluetooth dropdowns in overlay)
        this.clean_overlay(menu);

        // Blur existing elements
        this.blur_all(menu);

        // When menu is opened or open state changes, re-apply
        this.connections.connect(menu, 'open-state-changed', (_, open) => {
            if (open) {
                this.disable_offscreen_redirect(menu);
                this.clean_overlay(menu);
                this.blur_all(menu);
            }
        });

        // Real-time sigma change listener
        if (this.settings?.quick_settings?.settings) {
            this.connections.connect(
                this.settings.quick_settings.settings,
                'changed::sigma',
                () => {
                    const s = this.settings.quick_settings.SIGMA ?? 30;
                    this.set_sigma(s);
                }
            );
        }
    }

    disable_offscreen_redirect(menu) {
        if (!menu)
            return;

        try {
            if (menu.actor)
                menu.actor.set_offscreen_redirect(0);
            if (menu.box)
                menu.box.set_offscreen_redirect(0);
            if (menu._grid)
                menu._grid.set_offscreen_redirect(0);
            if (menu._boxPointer) {
                menu._boxPointer.set_offscreen_redirect(0);
                if (menu._boxPointer.bin)
                    menu._boxPointer.bin.set_offscreen_redirect(0);
            }
        } catch (e) {
            console.error(`[BlurMyShell] QuickSettingsBlur: error disabling offscreen redirect: ${e}`);
        }
    }

    clean_overlay(menu) {
        if (!menu?._overlay)
            return;

        try {
            menu._overlay.get_children().forEach(child => {
                try {
                    child.remove_effect_by_name('bms-qs-item-blur');
                } catch (e) {}
            });
        } catch (e) {}
    }

    set_sigma(sigma) {
        this.sigma = sigma;
        const theme_context = St.ThemeContext.get_for_stage(global.stage);
        const scale = theme_context ? theme_context.scale_factor : 1;
        const radius = Math.max(1, sigma * scale);

        this.blurred_actors.forEach(actor => {
            try {
                const effect = actor.get_effect('bms-qs-item-blur');
                if (effect)
                    effect.radius = radius;
            } catch (e) {}
        });
    }

    blur_all(menu) {
        if (!menu)
            return;

        // 1. Grid items (all toggles, sliders, and system items)
        if (menu._grid) {
            menu._grid.get_children().forEach(child => this.blur_grid_item(child));

            if (!this._grid_connected) {
                this._grid_connected = true;
                this.connections.connect(menu._grid, 'child-added', (_, child) => {
                    this.blur_grid_item(child);
                });
            }
        }

        // Submenus in overlay: do NOT blur (user requested removing blur under expanded lists)
        this.clean_overlay(menu);
    }

    blur_grid_item(item) {
        if (!item || typeof item.has_style_class_name !== 'function')
            return;

        // Check if item is the top system buttons container
        if (item.has_style_class_name('quick-settings-system-item')) {
            // Blur each individual button inside the system item box
            let box = item.child || (item.get_first_child ? item.get_first_child() : null) || (item.get_child_at_index ? item.get_child_at_index(0) : null);
            if (box?.get_children) {
                box.get_children().forEach(btn => this.blur_system_button(btn));
                if (!box._bms_qs_connected) {
                    box._bms_qs_connected = true;
                    this.connections.connect(box, 'child-added', (_, btn) => this.blur_system_button(btn));
                }
            } else {
                this.blur_actor(item);
            }
            return;
        }

        // Regular quick toggle or slider pill
        this.blur_actor(item);
    }

    blur_system_button(btn) {
        if (!btn || typeof btn.has_style_class_name !== 'function')
            return;

        // Only blur actual buttons, skip spacers
        if (btn.has_style_class_name('icon-button') ||
            btn.has_style_class_name('quick-toggle') ||
            btn.has_style_class_name('power-item') ||
            btn.has_style_class_name('button')) {
            this.blur_actor(btn);
        }
    }

    blur_actor(actor) {
        if (!actor || this.blurred_actors.has(actor) || !BlurOrShell?.BlurEffect)
            return;

        // Skip non-widgets
        if (typeof actor.has_style_class_name !== 'function')
            return;

        // EXCLUDE submenus and general containers from blur
        if (actor.has_style_class_name('quick-toggle-menu') ||
            actor.has_style_class_name('quick-toggle-menu-container') ||
            actor.has_style_class_name('popup-menu-content') ||
            actor.has_style_class_name('quick-settings')) {
            return;
        }

        this.blurred_actors.add(actor);

        const theme_context = St.ThemeContext.get_for_stage(global.stage);
        const scale = theme_context ? theme_context.scale_factor : 1;
        const radius = Math.max(1, this.sigma * scale);

        let blur_effect = actor.get_effect('bms-qs-item-blur');
        if (!blur_effect) {
            const has_corner_radius = Boolean(
                BlurOrShell?.BlurEffect?.list_properties()
                    .some(property => property.name === 'corner-radius')
            );

            const params = {
                name: 'bms-qs-item-blur',
                radius: radius,
                mode: BlurOrShell.BlurMode.BACKGROUND,
            };
            if (has_corner_radius) {
                params.corner_radius = 9999 * scale;
            }

            try {
                blur_effect = new BlurOrShell.BlurEffect(params);
                actor.add_effect(blur_effect);
            } catch (err) {
                console.error(`[BlurMyShell] QuickSettingsBlur error adding blur to actor: ${err}`);
            }
        } else {
            blur_effect.radius = radius;
            if ('corner_radius' in blur_effect)
                blur_effect.corner_radius = 9999 * scale;
        }

        this.connections.connect(actor, 'destroy', () => {
            this.blurred_actors.delete(actor);
        });
    }

    disable() {
        this.enabled = false;
        this.blurred_actors.forEach(actor => {
            try {
                actor.remove_effect_by_name('bms-qs-item-blur');
            } catch (e) {}
        });
        this.blurred_actors.clear();
        this._grid_connected = false;
        this._waiting_startup = false;
    }
};
