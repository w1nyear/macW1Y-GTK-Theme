// Spotlight: appearance preferences page
// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

// Theme options. Default follows the system style, dark and light force a specific appearance.
const THEMES = [
    { value: 'default', label: 'Default', subtitle: 'Follow GNOME system style' },
    { value: 'dark', label: 'Dark', subtitle: 'Always use dark appearance' },
    { value: 'light', label: 'Light', subtitle: 'Always use light appearance' },
];

// Glass engine options. Wallpaper mirrors only the wallpaper (the proven
// tahoe-widgets recipe); full scene also refracts windows behind the panel.
const ENGINES = [
    { value: 'wallpaper', label: 'Wallpaper', subtitle: 'Refracts the wallpaper, most compatible' },
    { value: 'full', label: 'Full scene', subtitle: 'Also refracts windows behind the panel' },
];

// Liquid Glass numeric controls: key, title, subtitle, min, max.
const GLASS_SPINS = [
    ['glass-blur', 'Blur', 'Refraction blur of the glass', 0, 100],
    ['glass-radius', 'Corner Radius', 'Rounding of the glass panel, px', 0, 60],
    ['glass-saturation', 'Saturation', 'Color saturation of the glass, percent', 0, 200],
    ['glass-refraction', 'Refraction', 'Edge distortion strength of the glass', 0, 200],
    ['glass-tint-strength', 'Tint Strength', 'How strongly the tint colors the glass, percent', 0, 100],
];

const GLASS_DEFAULTS = ['glass-tint', 'glass-tint-strength', 'glass-blur',
    'glass-radius', 'glass-saturation', 'glass-refraction', 'glass-engine'];

// Returns [appearanceGroup, glassGroup] so prefs.js can add both.
export function buildAppearancePage(settings) {
    const group = new Adw.PreferencesGroup({
        title: 'Appearance',
        description: 'Choose the visual style',
    });

    const themeRow = new Adw.ComboRow({
        title: 'Theme',
        subtitle: 'Dark, light, or follow system',
    });

    const list = new Gtk.StringList();
    for (const t of THEMES)
        list.append(t.label);
    themeRow.set_model(list);

    const current = settings.get_string('theme-preference');
    themeRow.set_selected(themeValueToIndex(current));

    themeRow.connect('notify::selected', () => {
        settings.set_string(
            'theme-preference',
            themeIndexToValue(themeRow.get_selected()),
        );
    });

    group.add(themeRow);

    const glass = new Adw.PreferencesGroup({
        title: 'Liquid Glass',
        description: 'Tint, blur and refraction of the Spotlight panel',
    });

    const tintRow = new Adw.EntryRow({
        title: 'Tint Color',
        text: settings.get_string('glass-tint'),
    });
    glass.add(tintRow);
    settings.bind('glass-tint', tintRow, 'text', Gio.SettingsBindFlags.DEFAULT);

    for (const [key, title, subtitle, lower, upper] of GLASS_SPINS) {
        const row = new Adw.SpinRow({
            title,
            subtitle: `${subtitle} (${lower}-${upper})`,
            adjustment: new Gtk.Adjustment({
                lower, upper, step_increment: 1, page_increment: 5,
                value: settings.get_int(key),
            }),
        });
        glass.add(row);
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    }

    const engineRow = new Adw.ComboRow({
        title: 'Glass Engine',
        subtitle: 'What the glass refracts',
    });
    const engineList = new Gtk.StringList();
    for (const e of ENGINES)
        engineList.append(e.label);
    engineRow.set_model(engineList);
    engineRow.set_selected(engineValueToIndex(settings.get_string('glass-engine')));
    engineRow.connect('notify::selected', () => {
        settings.set_string('glass-engine',
            engineIndexToValue(engineRow.get_selected()));
    });
    glass.add(engineRow);

    const resetRow = new Adw.ActionRow({
        title: 'Reset Liquid Glass',
        subtitle: 'Back to the default Tahoe look',
    });
    const resetBtn = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
    resetBtn.connect('clicked', () => {
        for (const key of GLASS_DEFAULTS)
            settings.reset(key);
    });
    resetRow.add_suffix(resetBtn);
    resetRow.activatable_widget = resetBtn;
    glass.add(resetRow);

    return [group, glass];
}

function themeValueToIndex(value) {
    for (let i = 0; i < THEMES.length; i++) {
        if (THEMES[i].value === value)
            return i;
    }
    return 0;
}

function themeIndexToValue(idx) {
    if (idx >= 0 && idx < THEMES.length)
        return THEMES[idx].value;
    return 'default';
}

function engineValueToIndex(value) {
    for (let i = 0; i < ENGINES.length; i++) {
        if (ENGINES[i].value === value)
            return i;
    }
    return 0;
}

function engineIndexToValue(idx) {
    if (idx >= 0 && idx < ENGINES.length)
        return ENGINES[idx].value;
    return 'wallpaper';
}
