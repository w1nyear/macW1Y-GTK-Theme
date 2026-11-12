import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PROMPT_BLUR_RADIUS, PROMPT_BLUR_BRIGHTNESS } from './constants.js';
import { LiveWallpaperPlayer, isLiveWallpaperConfigured } from './liveWallpaperPlayer.js';

let _LiveWallpaperPlayerClass = LiveWallpaperPlayer;
let _isLiveWallpaperConfiguredFn = isLiveWallpaperConfigured;

export class WallpaperManager {
    constructor(extension) {
        this._extension = extension;
        this.customWallpaperOverlay = null;
        this._livePlayer = null;
    }

    updateCustomWallpaperOverlay() {
        const dialog = this._extension._dialog;
        if (!dialog)
            return;

        const isConfigured = (_isLiveWallpaperConfiguredFn || isLiveWallpaperConfigured)(this._extension._settings);
        if (isConfigured) {
            if (this.customWallpaperOverlay) {
                this.customWallpaperOverlay.destroy();
                this.customWallpaperOverlay = null;
            }

            if (!this._livePlayer) {
                const PlayerClass = this._livePlayerClassOverride ||
                                    this._extension?._LiveWallpaperPlayerClass ||
                                    _LiveWallpaperPlayerClass ||
                                    LiveWallpaperPlayer;
                this._livePlayer = new PlayerClass();
                this._livePlayer.start(dialog, dialog._backgroundGroup, this._extension._settings);

                if (this._livePlayer._rootActor && dialog._backgroundGroup && dialog._backgroundGroup.get_parent() === dialog) {
                    dialog.set_child_above_sibling(this._livePlayer._rootActor, dialog._backgroundGroup);
                }

                if (dialog._backgroundGroup)
                    dialog._backgroundGroup.opacity = 0;

                const progress = dialog._adjustment?.value ?? 0;
                const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                const isCupertino = this._extension._lockscreenMode === 'cupertino';
                this.setCustomWallpaperBlur(
                    isCupertino ? 0 : PROMPT_BLUR_RADIUS * scaleFactor * progress,
                    isCupertino ? 1.0 : 1.0 - (1.0 - PROMPT_BLUR_BRIGHTNESS) * progress
                );
            }
            return;
        }

        if (this._livePlayer) {
            this._livePlayer.stop();
            this._livePlayer = null;
        }

        const settings = this._extension._settings;
        const enabled = settings?.get_boolean('lockscreen-wallpaper-enable') ?? false;
        const path = settings?.get_string('lockscreen-wallpaper-path') ?? '';
        const fileExists = path !== '' && Gio.File.new_for_path(path).query_exists(null);

        if (enabled && fileExists) {
            const uri = path.startsWith('file://') ? path : `file://${path}`;
            const styleStr = `background-image: url("${uri}"); background-size: cover; background-position: center; background-repeat: no-repeat;`;

            if (!this.customWallpaperOverlay) {
                this.customWallpaperOverlay = new Clutter.Actor({ opacity: 255 });

                for (const monitor of Main.layoutManager.monitors) {
                    const widget = new St.Widget({
                        style_class: 'screen-shield-background',
                        x: monitor.x,
                        y: monitor.y,
                        width: monitor.width,
                        height: monitor.height,
                        effect: new Shell.BlurEffect({ name: 'blur' }),
                    });
                    const effect = widget.get_effect('blur');
                    if (effect)
                        effect.set({ brightness: 1.0, radius: 0 });
                    widget.set_style(styleStr);
                    this.customWallpaperOverlay.add_child(widget);
                }

                dialog.add_child(this.customWallpaperOverlay);
                if (dialog._backgroundGroup && dialog._backgroundGroup.get_parent() === dialog)
                    dialog.set_child_above_sibling(this.customWallpaperOverlay, dialog._backgroundGroup);

                const progress = dialog._adjustment?.value ?? 0;
                const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                const isCupertino = this._extension._lockscreenMode === 'cupertino';
                this.setCustomWallpaperBlur(
                    isCupertino ? 0 : PROMPT_BLUR_RADIUS * scaleFactor * progress,
                    isCupertino ? 1.0 : 1.0 - (1.0 - PROMPT_BLUR_BRIGHTNESS) * progress
                );
            } else {
                for (const child of this.customWallpaperOverlay.get_children())
                    child.set_style(styleStr);
                this.customWallpaperOverlay.opacity = 255;
                this.customWallpaperOverlay.visible = true;
            }
        } else {
            if (this.customWallpaperOverlay) {
                this.customWallpaperOverlay.destroy();
                this.customWallpaperOverlay = null;
            }
        }
    }

    setCustomWallpaperBlur(radius, brightness) {
        if (this._livePlayer) {
            this._livePlayer.setBlur(radius, brightness);
            return;
        }

        for (const widget of this.customWallpaperOverlay?.get_children() ?? []) {
            const effect = widget.get_effect('blur');
            if (effect)
                effect.set({ radius, brightness });
        }
    }

    startUnlockTransition(onComplete = null) {
        if (this._livePlayer) {
            this._livePlayer.unlockTransition(onComplete);
            this._livePlayer = null;
        } else if (onComplete) {
            onComplete();
        }
    }

    teardown() {
        if (this._extension?._dialog?._backgroundGroup) {
            try { this._extension._dialog._backgroundGroup.opacity = 255; } catch (_) {}
        }

        if (this._livePlayer) {
            if (!this._livePlayer._isUnlockedTransition) {
                this._livePlayer.stop();
                this._livePlayer = null;
            }
        }

        if (this.customWallpaperOverlay) {
            this.customWallpaperOverlay.destroy();
            this.customWallpaperOverlay = null;
        }
    }
}
