// SPDX-License-Identifier: GPL-3.0-or-later
// ЛЕГАСІ-ШИМ (v4). Реальний Центр повідомлень живе в tahoeNotifications.js
// (?v=<унікальний> інстанс). Через кешування ES-модулів цей файл у живій
// сесії може бути СТАРОЮ інстанцією (1349 рядків дубльованого коду), тому
// всі функції делегуємо через globalThis.__tahoeNC, який kiwi enable()
// постійно оновлює до поточного живого інстансу.
//
// Споживачі: topbarBlur.js (getNCPanelBox/getNCOverlay),
// tahoeOSD.js (isNCOpen), tahoeControlCenter.js (closeNC).

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

// centerManager / extension.js / tahoeControlCenter читають цей глобал:
globalThis._tahoeNotificationCenterClose = (immediate = false) => {
    try {
        globalThis.__tahoeNC?.closeNC?.(immediate);
    } catch (_) {}
};
