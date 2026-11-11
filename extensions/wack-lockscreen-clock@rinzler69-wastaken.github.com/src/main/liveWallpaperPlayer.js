import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Gst from 'gi://Gst';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const LIVE_VIDEO_PATHS = [
    '/usr/share/backgrounds/GoldenGate_Live_loop.mp4',
    '/usr/share/backgrounds/GoldenGate_Live_loop.mov',
    '/usr/share/backgrounds/Golden Gate.mov',
];

const STATIC_FALLBACK_URI = 'file:///usr/share/backgrounds/GoldenGate_Day.jpg';
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const FRAME_INTERVAL_MS = 33; // ~30 fps
const UNLOCK_TRANSITION_MS = 3000; // 3-second crossfade into session

export function resolveLiveVideoPath(settings = null) {
    if (settings) {
        try {
            const customPath = settings.get_string('lockscreen-wallpaper-path') || '';
            const cleanPath = customPath.replace(/^file:\/\//, '');
            if (cleanPath && (cleanPath.endsWith('.mp4') || cleanPath.endsWith('.mov') || cleanPath.endsWith('.mkv') || cleanPath.endsWith('.webm'))) {
                if (GLib.file_test(cleanPath, GLib.FileTest.EXISTS))
                    return cleanPath;
            }
        } catch (_) {}
    }
    for (const p of LIVE_VIDEO_PATHS) {
        if (GLib.file_test(p, GLib.FileTest.EXISTS))
            return p;
    }
    return null;
}

export function isLiveWallpaperConfigured(settings = null) {
    try {
        const videoPath = resolveLiveVideoPath(settings);
        if (!videoPath)
            return false;

        if (settings) {
            try {
                const enabled = settings.get_boolean('lockscreen-wallpaper-enable');
                const path = settings.get_string('lockscreen-wallpaper-path') || '';
                if (enabled && (path.endsWith('.mp4') || path.endsWith('.mov') || path.includes('GoldenGate')))
                    return true;
            } catch (_) {}
        }

        const bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
        const uri = bgSettings.get_string('picture-uri') || '';
        const uriDark = bgSettings.get_string('picture-uri-dark') || '';

        const matches = uri.includes('GoldenGate') || uriDark.includes('GoldenGate') ||
                        uri.includes('Golden%20Gate') || uriDark.includes('Golden%20Gate') ||
                        uri.includes('macw1y') || uri.includes('live-wallpaper') ||
                        uri.includes('Tahoe') || uriDark.includes('Tahoe');

        // If GoldenGate or Tahoe live video is present, enable live wallpaper
        return matches || true;
    } catch (_) {
        return false;
    }
}

export class LiveWallpaperPlayer {
    constructor() {
        this._pipeline = null;
        this._sink = null;
        this._tickId = 0;
        this._busWatchId = 0;
        this._tex = null;
        this._content = null;
        this._rootActor = null;
        this._containers = [];
        this._isStopping = false;
        this._isUnlockedTransition = false;

        this._initGst();
    }

    _initGst() {
        try {
            if (!Gst.is_initialized())
                Gst.init(null);
        } catch (e) {
            console.error(`[LiveWallpaper] Gst init failed: ${e}`);
        }
    }

    _resolveVideoPath(settings = null) {
        return resolveLiveVideoPath(settings);
    }

    start(parentActor, belowSibling = null, settings = null) {
        if (this._rootActor || this._pipeline)
            return;

        const videoPath = this._resolveVideoPath(settings);
        if (!videoPath)
            return;

        try {
            const ctx = Clutter.get_default_backend().get_cogl_context();
            const initBytes = new Uint8Array(VIDEO_WIDTH * VIDEO_HEIGHT * 4);
            this._tex = Cogl.Texture2D.new_from_data(
                ctx,
                VIDEO_WIDTH,
                VIDEO_HEIGHT,
                Cogl.PixelFormat.RGBA_8888,
                VIDEO_WIDTH * 4,
                initBytes
            );
            this._content = Clutter.TextureContent.new_from_texture(this._tex, null);

            this._rootActor = new Clutter.Actor({
                name: 'wack-live-wallpaper-overlay',
                opacity: 255,
                visible: true,
                reactive: false,
            });

            this._containers = [];
            for (const monitor of Main.layoutManager.monitors) {
                const container = new St.Widget({
                    name: 'wack-live-wallpaper-monitor',
                    x: monitor.x,
                    y: monitor.y,
                    width: monitor.width,
                    height: monitor.height,
                    effect: new Shell.BlurEffect({ name: 'blur' }),
                    reactive: false,
                });
                const blur = container.get_effect('blur');
                if (blur)
                    blur.set({ radius: 0, brightness: 1.0 });

                const videoView = new Clutter.Actor({
                    width: monitor.width,
                    height: monitor.height,
                    x_expand: true,
                    y_expand: true,
                    reactive: false,
                    content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
                });
                videoView.set_content(this._content);
                container.add_child(videoView);

                this._rootActor.add_child(container);
                this._containers.push({ container, videoView });
            }

            if (parentActor) {
                parentActor.add_child(this._rootActor);
                if (parentActor._backgroundGroup && parentActor._backgroundGroup.get_parent() === parentActor) {
                    parentActor.set_child_above_sibling(this._rootActor, parentActor._backgroundGroup);
                } else if (parentActor._stack && parentActor._stack.get_parent() === parentActor) {
                    parentActor.set_child_below_sibling(this._rootActor, parentActor._stack);
                } else if (belowSibling && belowSibling.get_parent() === parentActor) {
                    parentActor.set_child_below_sibling(this._rootActor, belowSibling);
                }
            }

            // GStreamer pipeline with sync=true for real-time presentation clock
            const pipelineDesc = `filesrc location="${videoPath}" ! decodebin ! videoconvert ! video/x-raw,format=RGBA,width=${VIDEO_WIDTH},height=${VIDEO_HEIGHT} ! appsink name=sink max-buffers=2 drop=true sync=true`;
            this._pipeline = Gst.parse_launch(pipelineDesc);
            this._sink = this._pipeline.get_by_name('sink');

            this._pipeline.set_state(Gst.State.PLAYING);

            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_INTERVAL_MS, () => {
                this._onFrameTick();
                return GLib.SOURCE_CONTINUE;
            });
            GLib.Source.set_name_by_id(this._tickId, '[WACK] LiveWallpaperPlayer.tick');
        } catch (e) {
            console.error(`[LiveWallpaper] Start failed: ${e}\n${e.stack}`);
            this.stop();
        }
    }

    _onFrameTick() {
        if (!this._pipeline || !this._sink || !this._tex)
            return;

        try {
            // Check for EOS or errors on bus
            const bus = this._pipeline.get_bus();
            if (bus) {
                const msg = bus.pop_filtered(Gst.MessageType.EOS | Gst.MessageType.ERROR);
                if (msg) {
                    if (msg.type === Gst.MessageType.EOS) {
                        // Loop seamlessly back to start
                        this._pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, 0);
                    }
                }
            }

            // Pull latest sample
            let sample = this._sink.emit('try-pull-sample', 0);
            let latest = sample;
            while (sample) {
                sample = this._sink.emit('try-pull-sample', 0);
                if (sample)
                    latest = sample;
            }

            if (latest) {
                const buffer = latest.get_buffer();
                const [success, mapInfo] = buffer.map(Gst.MapFlags.READ);
                if (success) {
                    this._tex.set_data(
                        Cogl.PixelFormat.RGBA_8888,
                        VIDEO_WIDTH * 4,
                        mapInfo.data,
                        0
                    );
                    buffer.unmap(mapInfo);
                }
            }
        } catch (_) {}
    }

    pause() {
        if (this._pipeline && !this._isPaused) {
            this._isPaused = true;
            try { this._pipeline.set_state(Gst.State.PAUSED); } catch (_) {}
        }
    }

    resume() {
        if (this._pipeline && this._isPaused) {
            this._isPaused = false;
            try { this._pipeline.set_state(Gst.State.PLAYING); } catch (_) {}
        }
    }

    setBlur(radius, brightness) {
        for (const item of this._containers) {
            const effect = item.container?.get_effect('blur');
            if (effect)
                effect.set({ radius, brightness });
        }
    }

    unlockTransition(onComplete = null) {
        if (!this._rootActor || this._isUnlockedTransition) {
            if (onComplete) onComplete();
            return;
        }

        this._isUnlockedTransition = true;

        try {
            // Ensure rootActor is attached to the screen above the desktop background
            // so desktop windows, icons and dock appear immediately, while the live wallpaper
            // smoothly fades out over 3000ms revealing the static GoldenGate_Day.jpg
            const bgGroup = Main.layoutManager._backgroundGroup;
            if (bgGroup && this._rootActor.get_parent() !== bgGroup) {
                const curParent = this._rootActor.get_parent();
                if (curParent)
                    curParent.remove_child(this._rootActor);
                bgGroup.add_child(this._rootActor);
            }

            // Remove any prompt blur so the desktop transition is crisp
            this.setBlur(0, 1.0);

            this._rootActor.remove_all_transitions();
            this._rootActor.opacity = 255;
            this._rootActor.visible = true;

            this._rootActor.ease({
                opacity: 0,
                duration: UNLOCK_TRANSITION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this.stop();
                    if (onComplete)
                        onComplete();
                },
            });
        } catch (e) {
            console.error(`[LiveWallpaper] unlockTransition error: ${e}`);
            this.stop();
            if (onComplete)
                onComplete();
        }
    }

    stop() {
        if (this._tickId !== 0) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }

        if (this._pipeline) {
            try {
                this._pipeline.set_state(Gst.State.NULL);
            } catch (_) {}
            this._pipeline = null;
            this._sink = null;
        }

        if (this._rootActor) {
            try {
                this._rootActor.remove_all_transitions();
                this._rootActor.destroy();
            } catch (_) {}
            this._rootActor = null;
        }

        this._containers = [];
        this._tex = null;
        this._content = null;
        this._isUnlockedTransition = false;
    }

    destroy() {
        this.stop();
    }
}
