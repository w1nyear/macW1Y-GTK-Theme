// SPDX-License-Identifier: GPL-3.0-or-later









export function isNCOpen() {
    try {
        return !!globalThis.__tahoeNC?.isNCOpen();
    } catch (_) {
        return false;
    }
}

export function getNCPanelBox() {
    try {
        return globalThis.__tahoeNC?.getNCPanelBox?.() ?? null;
    } catch (_) {
        return null;
    }
}

export function getNCOverlay() {
    try {
        return globalThis.__tahoeNC?.getNCOverlay?.() ?? null;
    } catch (_) {
        return null;
    }
}

export function openNC() {
    try {
        return globalThis.__tahoeNC?.openNC?.();
    } catch (_) {}
}

export function closeNC(immediate = false) {
    try {
        return globalThis.__tahoeNC?.closeNC?.(immediate);
    } catch (_) {}
}

export function toggleNC() {
    try {
        return globalThis.__tahoeNC?.toggleNC?.();
    } catch (_) {}
}


globalThis._tahoeNotificationCenterClose = (immediate = false) => {
    try {
        globalThis.__tahoeNC?.closeNC?.(immediate);
    } catch (_) {}
};
