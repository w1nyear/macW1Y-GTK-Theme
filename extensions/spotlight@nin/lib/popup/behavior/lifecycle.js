// Spotlight: popup open/close scheduling helpers
// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';

// Schedules an idle callback. Stores the source ID on the popup under the
// given property name so it can be cancelled later.
export function scheduleIdle(popup, idProperty, callback) {
    if (popup[idProperty] !== 0)
        return false;
    popup[idProperty] = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        popup[idProperty] = 0;
        callback();
        return GLib.SOURCE_REMOVE;
    });
    return true;
}

// Cancels a pending idle callback by source ID property.
export function cancelIdle(popup, idProperty) {
    if (popup[idProperty] !== 0) {
        GLib.source_remove(popup[idProperty]);
        popup[idProperty] = 0;
    }
}

// Connects a text-changed handler that toggles search visibility based on
// whether the entry has text. Also flips the panel between the collapsed
// Tahoe pill (empty) and the expanded results panel. onText, when given,
// observes the state change (the popup uses it to leave the Applications
// view). Returns the handler ID.
export function trackTextVisibility(search, content, onText) {
    return search._text.connect('text-changed', () => {
        const hasText = search._text.get_text().length > 0;
        search.visible = hasText;
        if (hasText)
            content.remove_style_class_name('spotlight-collapsed');
        else
            content.add_style_class_name('spotlight-collapsed');
        if (onText) {
            try {
                onText(hasText);
            } catch (_) {
                // observer gone
            }
        }
    });
}
