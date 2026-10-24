// SPDX-License-Identifier: GPL-3.0-or-later
// tahoeGameMode.js — Game Focus Optimization для macW1Y v0.4
//
// 1. Безпечне відстеження фокусу ігор (CS2, Steam, Wine, etc.)
// 2. У фокусі гри:
//    - globalThis._tahoeGameMode = true, _tahoeBlurEnabled = false
//    - Liquid Glass і Blur зупиняють рендеринг (0% GPU від системи)
// 3. Поза фокусом:
//    - Відновлення системних ефектів
// 4. Жодних синхронних блокувань D-Bus та без втручання в запуск гри!

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

const RESTORE_DELAY_MS = 150;

let _focusWinId = 0;
let _gameWindowFocused = false;
let _restoreTimer = 0;
let _effectsDisabled = false;

function _disableSystemEffects() {
    if (_effectsDisabled) return;
    _effectsDisabled = true;

    try {
        globalThis._tahoeBlurEnabled = false;
        globalThis._tahoeGameMode = true;

        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            try { global.stage.queue_redraw(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });

        console.log('[tahoeGameMode] 🎮 Game FOCUSED — system GPU rendering paused');
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

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try { global.stage.queue_redraw(); } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });

        console.log('[tahoeGameMode] ✅ Game UNFOCUSED — system GPU effects resumed');
    } catch (e) {
        console.warn(`[tahoeGameMode] _restoreSystemEffects error: ${e}`);
    }
}

function _isGameWindow(win) {
    if (!win) return false;
    try {
        const wmClass = win.get_wm_class()?.toLowerCase() ?? '';
        const title = win.get_title()?.toLowerCase() ?? '';

        for (const cls of GAME_WM_CLASSES) {
            if (wmClass.includes(cls)) return true;
        }
        if (title.includes('counter-strike') || title.includes('cs2')) return true;

        return false;
    } catch (_) {
        return false;
    }
}

function _onFocusChanged() {
    try {
        const focusWin = global.display.get_focus_window();
        const isGame = _isGameWindow(focusWin);

        if (isGame && !_gameWindowFocused) {
            _gameWindowFocused = true;

            if (_restoreTimer) {
                GLib.source_remove(_restoreTimer);
                _restoreTimer = 0;
            }

            _disableSystemEffects();

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

export function onGameStart() {
    _disableSystemEffects();
}

export function onGameEnd() {
    _gameWindowFocused = false;
    _restoreSystemEffects();
}

export function enable() {
    globalThis._tahoeGameModeModule = { onGameStart, onGameEnd };

    _focusWinId = global.display.connect('notify::focus-window', _onFocusChanged);
    _onFocusChanged();

    console.log('[tahoeGameMode] ✅ initialized safely');
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

    _restoreSystemEffects();
    console.log('[tahoeGameMode] disabled');
}
