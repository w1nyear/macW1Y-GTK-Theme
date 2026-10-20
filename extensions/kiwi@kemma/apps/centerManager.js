// SPDX-License-Identifier: GPL-3.0-or-later
// centerManager.js — macOS Tahoe Mutual Exclusion Coordinator
// Guarantees that only ONE center (Control Center, Notification Center,
// Spotlight, Clipboard, or Panel Menu) is open at any given moment.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function closeAllCenters(except = null) {
    if (except !== 'qs') {
        try {
            if (typeof globalThis._tahoeQSClose === 'function') {
                globalThis._tahoeQSClose();
            }
        } catch (_) {}
    }
    if (except !== 'nc') {
        try {
            if (typeof globalThis._tahoeNCClose === 'function') {
                globalThis._tahoeNCClose(true);
            }
        } catch (_) {}
        try {
            if (typeof globalThis._tahoeNotificationCenterClose === 'function') {
                globalThis._tahoeNotificationCenterClose();
            }
        } catch (_) {}
    }
    if (except !== 'spotlight') {
        try {
            if (globalThis._macSpotlightGlobalInstance?._isOpen) {
                globalThis._macSpotlightGlobalInstance.close(true);
            } else if (typeof globalThis._macSpotlightClose === 'function') {
                globalThis._macSpotlightClose(true);
            }
        } catch (_) {}
    }
    if (except !== 'clipboard') {
        try {
            if (globalThis._macClipboardGlobalInstance?._isOpen) {
                globalThis._macClipboardGlobalInstance.close(true);
            } else if (typeof globalThis._macClipboardClose === 'function') {
                globalThis._macClipboardClose(true);
            }
        } catch (_) {}
    }
    if (except !== 'apps') {
        try {
            if (globalThis._macApplicationsGlobalInstance?._isOpen) {
                globalThis._macApplicationsGlobalInstance.close(true);
            } else if (typeof globalThis._macApplicationsClose === 'function') {
                globalThis._macApplicationsClose(true);
            }
        } catch (_) {}
    }
    if (except !== 'panelMenu') {
        try {
            if (Main.panel?.menuManager?.activeMenu) {
                Main.panel.menuManager.activeMenu.close(1);
            }
        } catch (_) {}
    }
}

globalThis._macCloseAllCenters = closeAllCenters;

// Hook Main.panel.menuManager so opening any menu closes other centers
try {
    const mm = Main.panel?.menuManager;
    if (mm && !mm._macMutualExclusionInstalled) {
        mm._macMutualExclusionInstalled = true;
        const origChange = mm._changeMenu || mm._onMenuOpenState;
        if (mm._onMenuOpenState) {
            const origOpen = mm._onMenuOpenState;
            mm._onMenuOpenState = function(menu, open) {
                if (open) {
                    let except = 'panelMenu';
                    if (menu === Main.panel.statusArea?.quickSettings?.menu) {
                        except = 'qs';
                    } else if (menu === Main.panel.statusArea?.dateMenu?.menu) {
                        except = 'nc';
                    }
                    closeAllCenters(except);
                }
                return origOpen.call(this, menu, open);
            };
        }
    }
} catch (_) {}

// Automatically close all centers when a system modal (e.g. Screenshot UI, lock screen, auth dialog) opens
try {
    if (!globalThis._macSystemModalHooked) {
        globalThis._macSystemModalHooked = true;
        Main.layoutManager?.connect('system-modal-opened', () => {
            closeAllCenters();
        });
        if (Main.screenshotUI) {
            Main.screenshotUI.connect('open-state-changed', (_ui, open) => {
                if (open) closeAllCenters();
            });
        }
        if (Main.overview) {
            Main.overview.connect('showing', () => {
                closeAllCenters();
            });
        }
    }
} catch (_) {}
