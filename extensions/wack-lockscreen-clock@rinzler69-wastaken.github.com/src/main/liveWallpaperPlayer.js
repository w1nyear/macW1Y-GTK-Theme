/**
 * Stub implementation for liveWallpaperPlayer.
 * GStreamer video playback has been disabled for stability and performance.
 * The lock screen and GDM greeter now exclusively use high-resolution static photo wallpapers.
 */

export class LiveWallpaperPlayer {
    constructor() {
        this._rootActor = null;
        this._pipeline = null;
        this._isStopping = false;
        this._isUnlockedTransition = false;
    }

    start() {}
    stop() {}
    destroy() {}
    setBlur() {}
    unlockTransition(onComplete = null) {
        if (onComplete)
            onComplete();
    }
}

export function resolveLiveVideoPath() {
    return null;
}

export function isLiveWallpaperConfigured() {
    return false;
}
