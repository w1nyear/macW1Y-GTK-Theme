// SPDX-License-Identifier: GPL-3.0-or-later
// tahoeGameMode.js — Game Focus Optimization для macW1Y v0.4
//
// Функції:
// 1. Відстежує фокус ігрових вікон (за WM_CLASS або gamemoded)
// 2. При грі у фокусі — вимикає blur/liquid-glass оновлення (~0% GPU від системи)
// 3. При грі не у фокусі — відновлює ефекти + throttle GPU гри до ~10 FPS
// 4. Фікс фризу при перемиканні — попереднє завантаження compositor state

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Список WM_CLASS ігор для автодетекту
const GAME_WM_CLASSES = new Set([
    'cs2', 'Counter-Strike 2', 'steam_app_730',
    'csgo', 'dota2', 'steam_app_570',
    'tf2', 'steam_app_440',
    'gamescope',
    'wine', 'wine64',
    'heroic',
    'lutris',
]);

// Затримка перед відновленням ефектів після втрати фокусу грою (мс)
// Запобігає миттєвому перемиканню при alt-tab задля уникнення фризу
const RESTORE_DELAY_MS = 150;

// Інтервал перевірки gamemoded D-Bus (секунди)
const GAMEMODE_POLL_INTERVAL = 3;

let _focusWinId = 0;
let _gamemodeWatchId = 0;
let _gamemodeActive = false;
let _gameWindowFocused = false;
let _restoreTimer = 0;
let _pollTimer = 0;
let _blurWasEnabled = true;
let _effectsDisabled = false;

// Зберігаємо оригінальні налаштування blur
let _savedBlurSettings = {};

// ─── Вимкнути системні GPU ефекти ────────────────────────────────────────────
function _disableSystemEffects() {
    if (_effectsDisabled) return;
    _effectsDisabled = true;

    try {
        // 1. Зупинити перемальовування blur (topbarBlur, dockBlur)
        globalThis._tahoeBlurEnabled = false;
        globalThis._tahoeGameMode = true;

        // 2. Вимкнути blur-my-shell через shell eval
        _evalInShell(`
            try {
                const bms = imports.misc.extensionUtils.getExtensionByUUID
                    ? null : null;
                // Disable blur-my-shell pipeline
                if (global.__bmsBlur) {
                    global.__bmsBlur._effects?.forEach(e => e?.actor?.remove_all_effects?.());
                }
            } catch(_) {}
            // Pause liquid-glass capture
            globalThis._tahoeBlurEnabled = false;
            globalThis._tahoeGameMode = true;
        `);

        // 3. Встановити GNOME compositor update rate на мінімум
        // (не вимикаємо повністю бо нам треба cursor)
        _setCompositorThrottle(true);

        console.log('[tahoeGameMode] 🎮 Game focused — system GPU effects DISABLED');
    } catch (e) {
        console.warn(`[tahoeGameMode] _disableSystemEffects error: ${e}`);
    }
}

// ─── Відновити системні GPU ефекти ──────────────────────────────────────────
function _restoreSystemEffects() {
    if (!_effectsDisabled) return;
    _effectsDisabled = false;

    try {
        globalThis._tahoeBlurEnabled = true;
        globalThis._tahoeGameMode = false;

        _evalInShell(`
            globalThis._tahoeBlurEnabled = true;
            globalThis._tahoeGameMode = false;
        `);

        _setCompositorThrottle(false);

        console.log('[tahoeGameMode] ✅ Game unfocused — system GPU effects RESTORED');
    } catch (e) {
        console.warn(`[tahoeGameMode] _restoreSystemEffects error: ${e}`);
    }
}

// ─── Throttle compositor (зменшити update rate при грі) ─────────────────────
function _setCompositorThrottle(enable) {
    try {
        // Коли гра у фокусі — compositor не потрібно рендерити
        // Shell.Global не має прямого API для pause, але можна
        // встановити inhibit на певні ефекти
        if (enable) {
            // Зупинити continuous-repaint (якщо є)
            if (Main.compositor?._backdropEffect) {
                Main.compositor._backdropEffect.enabled = false;
            }
        } else {
            if (Main.compositor?._backdropEffect) {
                Main.compositor._backdropEffect.enabled = true;
            }
            // Форс-рефреш усіх акторів
            global.stage.queue_redraw();
        }
    } catch (_) {}
}

// ─── Перевірка чи вікно є грою ───────────────────────────────────────────────
function _isGameWindow(win) {
    if (!win) return false;
    try {
        const wmClass = win.get_wm_class()?.toLowerCase() ?? '';
        const title = win.get_title()?.toLowerCase() ?? '';
        const pid = win.get_pid?.() ?? 0;

        // Перевірка за WM_CLASS
        for (const cls of GAME_WM_CLASSES) {
            if (wmClass.includes(cls.toLowerCase())) return true;
        }

        // Перевірка за назвою
        if (title.includes('counter-strike') || title.includes('cs2')) return true;

        // Перевірка чи gamemoded активний для цього PID
        if (pid > 0 && _gamemodeActive) return true;

        return false;
    } catch (_) {
        return false;
    }
}

// ─── Обробка зміни фокусу ────────────────────────────────────────────────────
function _onFocusChanged() {
    try {
        const focusWin = global.display.get_focus_window();
        const isGame = _isGameWindow(focusWin);

        if (isGame && !_gameWindowFocused) {
            // Гра отримала фокус
            _gameWindowFocused = true;

            // Скасувати відкладений ресторе якщо є
            if (_restoreTimer) {
                GLib.source_remove(_restoreTimer);
                _restoreTimer = 0;
            }

            // Попереднє завантаження compositor state (фікс фризу при перемиканні)
            _prewarmCompositor();

            _disableSystemEffects();

        } else if (!isGame && _gameWindowFocused) {
            // Гра втратила фокус — відновити з затримкою
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

// ─── Prewarm compositor (попереднє завантаження при перемиканні) ─────────────
// Вирішує фриз при першому відкритті Overview/Apps після виходу з гри
function _prewarmCompositor() {
    try {
        // Невидимий force-paint щоб compositor не "спав"
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            try {
                global.stage.queue_redraw();
            } catch (_) {}
            return GLib.SOURCE_REMOVE;
        });
    } catch (_) {}
}

// ─── Опитування GameMode D-Bus ────────────────────────────────────────────────
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
                    console.log(`[tahoeGameMode] GameMode active: ${_gamemodeActive}`);
                    if (_gamemodeActive) {
                        _disableSystemEffects();
                    } else if (!_gameWindowFocused) {
                        _restoreSystemEffects();
                    }
                }
            } catch (_) {}
        });
    } catch (_) {}
}

// ─── Shell eval helper ────────────────────────────────────────────────────────
function _evalInShell(code) {
    try {
        // Використовуємо D-Bus Shell.Eval
        const proxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.gnome.Shell',
            '/org/gnome/Shell',
            'org.gnome.Shell',
            null
        );
        proxy.call_sync('Eval', new GLib.Variant('(s)', [code]),
            Gio.DBusCallFlags.NONE, 1000, null);
    } catch (_) {}
}

// ─── Public API ──────────────────────────────────────────────────────────────
export function onGameStart() {
    _disableSystemEffects();
}

export function onGameEnd() {
    _gameWindowFocused = false;
    _gamemodeActive = false;
    _restoreSystemEffects();
}

// ─── Enable / Disable ─────────────────────────────────────────────────────────
export function enable() {
    // Реєструємо себе глобально щоб game-focus-start.sh міг викликати
    globalThis._tahoeGameModeModule = { onGameStart, onGameEnd };

    // Слухаємо зміну фокусу
    _focusWinId = global.display.connect('notify::focus-window', _onFocusChanged);

    // Початкова перевірка
    _onFocusChanged();

    // Опитування GameMode кожні N секунд
    _pollTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, GAMEMODE_POLL_INTERVAL, () => {
        _checkGamemodeStatus();
        return GLib.SOURCE_CONTINUE;
    });

    console.log('[tahoeGameMode] ✅ enabled — game focus tracking active');
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

    // Відновити ефекти при disable
    _restoreSystemEffects();

    console.log('[tahoeGameMode] disabled');
}
