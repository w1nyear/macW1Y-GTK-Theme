// SPDX-License-Identifier: GPL-3.0-or-later
// tahoeGameMode.js — Game Focus Optimization для macW1Y v0.4
//
// 1. Відстежує фокус ігор (CS2, Steam, Wine, etc.) без блокування D-Bus
// 2. У фокусі гри:
//    - globalThis._tahoeGameMode = true, _tahoeBlurEnabled = false
//    - Liquid Glass і Blur перестають рендеритись (0% GPU від системи)
//    - Прив'язка CS2 до P-ядер (0-7) для максимального FPS
// 3. Поза фокусом:
//    - Прив'язка CS2 до E-ядер (8-11) для економії GPU/CPU
//    - Плавне відновлення системних ефектів без фризу

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const GAME_WM_CLASSES = new Set([
    'cs2', 'counter-strike 2', 'steam_app_730',
    'csgo', 'dota2', 'steam_app_570',
    'tf2', 'steam_app_440',
    'gamescope',
    'wine', 'wine64',
    'heroic',
    'lutris',
]);

const RESTORE_DELAY_MS = 120;
const GAMEMODE_POLL_INTERVAL = 3;

let _focusWinId = 0;
let _gamemodeActive = false;
let _gameWindowFocused = false;
let _restoreTimer = 0;
let _pollTimer = 0;
let _effectsDisabled = false;
let _lastGamePid = 0;

function _setGameAffinity(focused, pid) {
    if (!pid || pid <= 0) return;
    try {
        // P-cores (0-7) for maximum gaming FPS, E-cores (8-11) when out of focus
        const cores = focused ? '0-7' : '8-11';
        const proc = Gio.Subprocess.new(
            ['taskset', '-pc', cores, String(pid)],
            Gio.SubprocessFlags.NONE
        );
        proc.wait_async(null, null);
    } catch (_) {}
}

function _disableSystemEffects(pid) {
    if (_effectsDisabled) return;
    _effectsDisabled = true;

    try {
        globalThis._tahoeBlurEnabled = false;
        globalThis._tahoeGameMode = true;

        if (pid) {
            _lastGamePid = pid;
            _setGameAffinity(true, pid);
        }

        // Prewarm stage
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            try { global.stage.queue_redraw(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });

        console.log('[tahoeGameMode] 🎮 Game FOCUSED — system GPU rendering paused, P-cores active');
    } catch (e) {
        console.warn(`[tahoeGameMode] _disableSystemEffects error: ${e}`);
    }
}

function _restoreSystemEffects() {
    if (!_effectsDisabled) return;
    _effectsDisabled = false;

    try {
        globalThis._tahoeBlurEnabled = true;
        globalThis._tahoeGameMode = false;

        // Throttle game in background to E-cores to drop its GPU/CPU usage
        if (_lastGamePid) {
            _setGameAffinity(false, _lastGamePid);
        }

        // Refresh stage
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try { global.stage.queue_redraw(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });

        console.log('[tahoeGameMode] ✅ Game UNFOCUSED — system GPU effects resumed, game throttled');
    } catch (e) {
        console.warn(`[tahoeGameMode] _restoreSystemEffects error: ${e}`);
    }
}

function _isGameWindow(win) {
    if (!win) return false;
    try {
        const wmClass = win.get_wm_class()?.toLowerCase() ?? '';
        const title = win.get_title()?.toLowerCase() ?? '';
        const pid = win.get_pid?.() ?? 0;

        for (const cls of GAME_WM_CLASSES) {
            if (wmClass.includes(cls.toLowerCase())) return true;
        }
        if (title.includes('counter-strike') || title.includes('cs2')) return true;
        if (pid > 0 && _gamemodeActive) return true;

        return false;
    } catch (_) {
        return false;
    }
}

function _onFocusChanged() {
    try {
        const focusWin = global.display.get_focus_window();
        const isGame = _isGameWindow(focusWin);
        const pid = focusWin ? (focusWin.get_pid?.() ?? 0) : 0;

        if (isGame && !_gameWindowFocused) {
            _gameWindowFocused = true;

            if (_restoreTimer) {
                GLib.source_remove(_restoreTimer);
                _restoreTimer = 0;
            }

            _disableSystemEffects(pid);

        } else if (!isGame && _gameWindowFocused) {
            _gameWindowFocused = false;

            if (_restoreTimer) {
                GLib.source_remove(_restoreTimer);
            }

            _restoreTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTORE_DELAY_MS, () => {
                _restoreTimer = 0;
                _restoreSystemEffects();
                return GLib.SOURCE_REMOVE;
            });
        }
    } catch (e) {
        console.warn(`[tahoeGameMode] _onFocusChanged: ${e}`);
    }
}

function _checkGamemodeStatus() {
    try {
        const proc = Gio.Subprocess.new(
            ['gamemoded', '-s'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
        );
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                const wasActive = _gamemodeActive;
                _gamemodeActive = stdout?.includes('is active') ?? false;

                if (_gamemodeActive !== wasActive) {
                    if (_gamemodeActive) {
                        _disableSystemEffects(_lastGamePid);
                    } else if (!_gameWindowFocused) {
                        _restoreSystemEffects();
                    }
                }
            } catch (_) {}
        });
    } catch (_) {}
}

export function onGameStart() {
    _disableSystemEffects(_lastGamePid);
}

export function onGameEnd() {
    _gameWindowFocused = false;
    _gamemodeActive = false;
    _restoreSystemEffects();
}

export function enable() {
    globalThis._tahoeGameModeModule = { onGameStart, onGameEnd };

    _focusWinId = global.display.connect('notify::focus-window', _onFocusChanged);
    _onFocusChanged();

    _pollTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, GAMEMODE_POLL_INTERVAL, () => {
        _checkGamemodeStatus();
        return GLib.SOURCE_CONTINUE;
    });

    console.log('[tahoeGameMode] ✅ initialized successfully');
}

export function disable() {
    globalThis._tahoeGameModeModule = null;
    globalThis._tahoeGameMode = false;
    globalThis._tahoeBlurEnabled = true;

    if (_focusWinId) {
        global.display.disconnect(_focusWinId);
        _focusWinId = 0;
    }

    if (_restoreTimer) {
        GLib.source_remove(_restoreTimer);
        _restoreTimer = 0;
    }

    if (_pollTimer) {
        GLib.source_remove(_pollTimer);
        _pollTimer = 0;
    }

    _restoreSystemEffects();
    console.log('[tahoeGameMode] disabled');
}
