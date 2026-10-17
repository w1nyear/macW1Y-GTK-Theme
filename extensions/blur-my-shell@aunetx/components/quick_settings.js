import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const QuickSettingsBlur = class QuickSettingsBlur {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.effects_manager = effects_manager;
        this.enabled = false;
        this._waiting_startup = false;
        this._origSetDimmed = null;
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

        // 1. Remove all old blur effects from Quick Settings items
        this.clean_all_blur(menu);

        // 2. Ensure BoxPointer maintains native ALWAYS offscreen redirect so Liquid Glass shader renders
        this.ensure_boxpointer_redirect(menu);

        // 3. Remove dimming effect when submenus open
        this.remove_dim_effect(menu);

        // 4. Hook menu open-state-changed to maintain these guarantees
        this.connections.connect(menu, 'open-state-changed', (_, open) => {
            if (open) {
                this.clean_all_blur(menu);
                this.ensure_boxpointer_redirect(menu);
                this.remove_dim_effect(menu);
            }
        });
    }

    clean_all_blur(menu) {
        if (!menu) return;
        const cleanActor = (actor) => {
            if (!actor) return;
            try {
                actor.remove_effect_by_name('bms-qs-item-blur');
                actor.remove_effect_by_name('bms-popup-blur');
            } catch (_) {}
            if (actor.get_children) {
                for (const child of actor.get_children()) {
                    cleanActor(child);
                }
            }
        };

        if (menu.box) cleanActor(menu.box);
        if (menu._grid) cleanActor(menu._grid);
        if (menu._overlay) cleanActor(menu._overlay);
        if (menu._boxPointer) cleanActor(menu._boxPointer);
    }

    ensure_boxpointer_redirect(menu) {
        if (!menu?._boxPointer) return;
        try {
            menu._boxPointer.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
            if (!this._origSetOffscreenRedirect) {
                this._origSetOffscreenRedirect = menu._boxPointer.set_offscreen_redirect.bind(menu._boxPointer);
                const self = this;
                menu._boxPointer.set_offscreen_redirect = function(mode) {
                    if (menu.isOpen) {
                        return self._origSetOffscreenRedirect(Clutter.OffscreenRedirect.ALWAYS);
                    }
                    return self._origSetOffscreenRedirect(mode);
                };
            }
        } catch (_) {}
    }

    remove_dim_effect(menu) {
        if (!menu) return;
        try {
            if (menu._dimEffect) {
                menu._dimEffect.enabled = false;
            }
            if (!this._origSetDimmed && typeof menu._setDimmed === 'function') {
                this._origSetDimmed = menu._setDimmed;
            }
            menu._setDimmed = function(dim) {
                if (this._dimEffect) {
                    this._dimEffect.enabled = false;
                }
            };
        } catch (_) {}
    }

    disable() {
        this.enabled = false;
        const quickSettings = Main.panel?.statusArea?.quickSettings;
        const menu = quickSettings?.menu;
        if (menu) {
            this.clean_all_blur(menu);
            if (this._origSetDimmed) {
                menu._setDimmed = this._origSetDimmed;
                this._origSetDimmed = null;
            }
        }
        this._waiting_startup = false;
    }
};
