import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TahoeWidgetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(
            'org.gnome.shell.extensions.tahoe-widgets');

        const page = new Adw.PreferencesPage({
            title: 'Widgets',
            icon_name: 'view-grid-symbolic',
        });
        window.add(page);

        const showGroup = new Adw.PreferencesGroup({title: 'Widgets'});
        page.add(showGroup);
        for (const [key, title, subtitle] of [
            ['worldclock-visible', 'World Clock', 'Cupertino, Tokyo, Sydney, Paris'],
            ['date-visible', 'Date', 'Weekday and day number'],
            ['calendar-visible', 'Calendar', 'Month grid, today circled'],
            ['reminders-visible', 'Reminders', 'Local checklist'],
            ['weather-visible', 'Weather', 'Current conditions from Open-Meteo'],
            ['stocks-visible', 'Stocks', 'Index quotes from Stooq'],
            ['news-visible', 'News', 'Top story from RSS'],
            ['clock-visible', 'Clock', 'Analog clock'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle, active: settings.get_boolean(key)});
            showGroup.add(row);
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        }

        const sizeGroup = new Adw.PreferencesGroup({title: 'Sizes'});
        page.add(sizeGroup);

        const textRow = new Adw.SpinRow({
            title: 'Text Size',
            subtitle: 'Default for all widgets in pixels (0 = automatic)',
            digits: 0,
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 32, step_increment: 1, page_increment: 2,
                value: settings.get_int('text-size'),
            }),
        });
        sizeGroup.add(textRow);
        settings.bind('text-size', textRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        for (const [key, title] of [
            ['worldclock-text-size', 'World Clock Text'],
            ['date-text-size', 'Date Text'],
            ['calendar-text-size', 'Calendar Text'],
            ['reminders-text-size', 'Reminders Text'],
            ['weather-text-size', 'Weather Text'],
            ['stocks-text-size', 'Stocks Text'],
            ['news-text-size', 'News Text'],
            ['clock-text-size', 'Clock Text'],
        ]) {
            const row = new Adw.SpinRow({
                title,
                subtitle: '0 follows the default above',
                digits: 0,
                adjustment: new Gtk.Adjustment({
                    lower: 0, upper: 32, step_increment: 1, page_increment: 2,
                    value: settings.get_int(key),
                }),
            });
            sizeGroup.add(row);
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        }

        const shapeGroup = new Adw.PreferencesGroup({
            title: 'Shapes',
            description: 'Rectangle 460×230 or square 230×230 template for every widget (content keeps its aspect and fits inside)',
        });
        page.add(shapeGroup);
        for (const [key, title, subtitle] of [
            ['worldclock-variant', 'World Clock', 'Wide row of dials or square 2×2 grid'],
            ['weather-variant', 'Weather', 'Wide with hourly strip or square now-cast'],
            ['news-variant', 'News', 'Wide with thumbnail or square text'],
            ['calendar-variant', 'Calendar', 'Rectangle or square template'],
            ['date-variant', 'Date', 'Rectangle or square template'],
            ['clock-variant', 'Clock', 'Rectangle or square template'],
            ['reminders-variant', 'Reminders', 'Rectangle or square template'],
            ['stocks-variant', 'Stocks', 'Rectangle or square template'],
        ]) {
            const model = new Gtk.StringList();
            model.append('Rectangle 460×230');
            model.append('Square 230×230');
            const cur = settings.get_string(key);
            const row = new Adw.ComboRow({
                title,
                subtitle,
                model,
                selected: cur === 'square' ? 1 : 0,
            });
            shapeGroup.add(row);
            row.connect('notify::selected', () => {
                settings.set_string(key, row.selected === 1 ? 'square' : 'wide');
            });
        }
        for (const [key, title, subtitle, upper] of [
            ['square-size', 'Square Side', 'Side of the square template in pixels', 600],
            ['rect-width', 'Rectangle Width', 'Width of the rectangle template in pixels', 800],
            ['rect-height', 'Rectangle Height', 'Height of the rectangle template in pixels', 600],
        ]) {
            const row = new Adw.SpinRow({
                title,
                subtitle,
                digits: 0,
                adjustment: new Gtk.Adjustment({
                    lower: key === 'square-size' ? 100 : key === 'rect-width' ? 200 : 100,
                    upper, step_increment: 5, page_increment: 50,
                    value: settings.get_int(key),
                }),
            });
            shapeGroup.add(row);
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        }
        for (const [key, title, lower, upper] of [
            ['calendar-cell-w', 'Calendar Cell Width', 16, 64],
            ['calendar-cell-h', 'Calendar Cell Height', 16, 48],
        ]) {
            const row = new Adw.SpinRow({
                title,
                subtitle: 'Day cell size in pixels (24 follows the shape style)',
                digits: 0,
                adjustment: new Gtk.Adjustment({
                    lower, upper, step_increment: 1, page_increment: 4,
                    value: settings.get_int(key),
                }),
            });
            shapeGroup.add(row);
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        }

        const presetRow = new Adw.ActionRow({
            title: 'Preset Size',
            subtitle: 'Apply one size to all widgets at once (S compact, M normal, L large)',
        });
        const presetKeys = ['worldclock-scale', 'date-scale', 'calendar-scale',
            'reminders-scale', 'weather-scale', 'stocks-scale', 'news-scale', 'clock-scale'];
        for (const [label, value] of [['S', 0.75], ['M', 1.0], ['L', 1.35]]) {
            const btn = new Gtk.Button({label, valign: Gtk.Align.CENTER});
            btn.connect('clicked', () => {
                try {
                    for (const key of presetKeys)
                        settings.set_double(key, value);
                } catch (_) {
                    // read-only settings
                }
            });
            presetRow.add_suffix(btn);
        }
        sizeGroup.add(presetRow);
        for (const [key, title] of [
            ['worldclock-scale', 'World Clock'],
            ['date-scale', 'Date'],
            ['calendar-scale', 'Calendar'],
            ['reminders-scale', 'Reminders'],
            ['weather-scale', 'Weather'],
            ['stocks-scale', 'Stocks'],
            ['news-scale', 'News'],
            ['clock-scale', 'Clock'],
        ]) {
            const row = new Adw.SpinRow({
                title,
                subtitle: 'Widget size, 0.5 smallest to 2.0 largest (1 = normal)',
                digits: 2,
                adjustment: new Gtk.Adjustment({
                    lower: 0.5, upper: 2.0, step_increment: 0.05, page_increment: 0.25,
                    value: settings.get_double(key),
                }),
            });
            sizeGroup.add(row);
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        }

        const posGroup = new Adw.PreferencesGroup({
            title: 'Positions',
            description: 'Exact widget position in pixels (-1 = automatic layout)',
        });
        page.add(posGroup);
        for (const [key, title] of [
            ['worldclock', 'World Clock'],
            ['date', 'Date'],
            ['calendar', 'Calendar'],
            ['reminders', 'Reminders'],
            ['weather', 'Weather'],
            ['stocks', 'Stocks'],
            ['news', 'News'],
            ['clock', 'Clock'],
        ]) {
            for (const [axis, axisKey] of [['X', `${key}-x`], ['Y', `${key}-y`]]) {
                const row = new Adw.SpinRow({
                    title: `${title} ${axis}`,
                    subtitle: '-1 puts the widget back to automatic layout',
                    digits: 0,
                    adjustment: new Gtk.Adjustment({
                        lower: -1, upper: 4000, step_increment: 1, page_increment: 50,
                        value: settings.get_int(axisKey),
                    }),
                });
                posGroup.add(row);
                settings.bind(axisKey, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            }
        }
        for (const [key, title] of [
            ['date-title-x', 'Date weekday X'],
            ['date-title-y', 'Date weekday Y'],
            ['date-num-x', 'Date number X'],
            ['date-num-y', 'Date number Y'],
        ]) {
            const row = new Adw.SpinRow({
                title,
                subtitle: 'Nudge the date text in pixels (0 = designed place)',
                digits: 0,
                adjustment: new Gtk.Adjustment({
                    lower: -200, upper: 200, step_increment: 1, page_increment: 10,
                    value: settings.get_int(key),
                }),
            });
            posGroup.add(row);
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        }

        const textGroup = new Adw.PreferencesGroup({
            title: 'Text Offsets',
            description: 'Nudge texts inside widgets in pixels (0 = designed place)',
        });
        page.add(textGroup);
        for (const [key, title] of [
            ['worldclock-cell0-x', 'World Clock Cupertino X'],
            ['worldclock-cell0-y', 'World Clock Cupertino Y'],
            ['worldclock-cell1-x', 'World Clock Tokyo X'],
            ['worldclock-cell1-y', 'World Clock Tokyo Y'],
            ['worldclock-cell2-x', 'World Clock Sydney X'],
            ['worldclock-cell2-y', 'World Clock Sydney Y'],
            ['worldclock-cell3-x', 'World Clock Paris X'],
            ['worldclock-cell3-y', 'World Clock Paris Y'],
            ['clock-face-x', 'Clock dial X'],
            ['clock-face-y', 'Clock dial Y'],
            ['calendar-title-x', 'Calendar month X'],
            ['calendar-title-y', 'Calendar month Y'],
            ['calendar-grid-x', 'Calendar grid X'],
            ['calendar-grid-y', 'Calendar grid Y'],
            ['reminders-head-x', 'Reminders header X'],
            ['reminders-head-y', 'Reminders header Y'],
            ['reminders-list-x', 'Reminders list X'],
            ['reminders-list-y', 'Reminders list Y'],
            ['weather-city-x', 'Weather city X'],
            ['weather-city-y', 'Weather city Y'],
            ['weather-temp-x', 'Weather temperature X'],
            ['weather-temp-y', 'Weather temperature Y'],
            ['weather-cond-x', 'Weather condition X'],
            ['weather-cond-y', 'Weather condition Y'],
            ['weather-hilow-x', 'Weather high-low X'],
            ['weather-hilow-y', 'Weather high-low Y'],
            ['weather-strip-x', 'Weather strip X'],
            ['weather-strip-y', 'Weather strip Y'],
            ['stocks-row0-x', 'Stocks row 1 X'],
            ['stocks-row0-y', 'Stocks row 1 Y'],
            ['stocks-row1-x', 'Stocks row 2 X'],
            ['stocks-row1-y', 'Stocks row 2 Y'],
            ['stocks-row2-x', 'Stocks row 3 X'],
            ['stocks-row2-y', 'Stocks row 3 Y'],
            ['news-head-x', 'News headline X'],
            ['news-head-y', 'News headline Y'],
            ['news-text-x', 'News text X'],
            ['news-text-y', 'News text Y'],
            ['news-thumb-x', 'News thumbnail X'],
            ['news-thumb-y', 'News thumbnail Y'],
        ]) {
            const row = new Adw.SpinRow({
                title,
                subtitle: '0 = designed place',
                digits: 0,
                adjustment: new Gtk.Adjustment({
                    lower: -200, upper: 200, step_increment: 1, page_increment: 10,
                    value: settings.get_int(key),
                }),
            });
            textGroup.add(row);
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        }

        const glassGroup = new Adw.PreferencesGroup({title: 'Liquid Glass'});
        page.add(glassGroup);

        const blurRow = new Adw.SpinRow({
            title: 'Blur Strength',
            subtitle: 'Refraction blur of the glass (0-100)',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 100, step_increment: 1, page_increment: 5,
                value: settings.get_int('glass-blur'),
            }),
        });
        glassGroup.add(blurRow);
        settings.bind('glass-blur', blurRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const radiusRow = new Adw.SpinRow({
            title: 'Corner Radius',
            subtitle: 'Rounding of the glass sheet (px)',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 60, step_increment: 1, page_increment: 5,
                value: settings.get_int('glass-radius'),
            }),
        });
        glassGroup.add(radiusRow);
        settings.bind('glass-radius', radiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const themeModel = new Gtk.StringList();
        const themes = [['glass', 'Liquid Glass'], ['dark', 'Dark'], ['light', 'Light']];
        let selected = 0;
        themes.forEach(([id], i) => {
            themeModel.append(id === 'glass' ? 'Liquid Glass' : id[0].toUpperCase() + id.slice(1));
            if (id === settings.get_string('theme'))
                selected = i;
        });
        const themeRow = new Adw.ComboRow({
            title: 'Theme',
            subtitle: 'Transparent glass, dark or light tint',
            model: themeModel,
            selected,
        });
        glassGroup.add(themeRow);
        themeRow.connect('notify::selected', () => {
            settings.set_string('theme', themes[themeRow.selected][0]);
        });

        const satRow = new Adw.SpinRow({
            title: 'Saturation',
            subtitle: 'Color saturation of the liquid glass, percent',
            digits: 0,
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 200, step_increment: 1, page_increment: 10,
                value: settings.get_int('glass-saturation'),
            }),
        });
        glassGroup.add(satRow);
        settings.bind('glass-saturation', satRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const tintRow = new Adw.EntryRow({
            title: 'Tint Color',
            text: settings.get_string('glass-tint'),
        });
        glassGroup.add(tintRow);
        settings.bind('glass-tint', tintRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const tintStrengthRow = new Adw.SpinRow({
            title: 'Tint Strength',
            subtitle: 'How strongly the tint colors the glass, percent',
            digits: 0,
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 100, step_increment: 1, page_increment: 10,
                value: settings.get_int('glass-tint-strength'),
            }),
        });
        glassGroup.add(tintStrengthRow);
        settings.bind('glass-tint-strength', tintStrengthRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const resetRow = new Adw.ActionRow({
            title: 'Reset Positions',
            subtitle: 'Back to the stacked layout on the right',
        });
        const resetBtn = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        resetBtn.connect('clicked', () => {
            for (const key of ['clock', 'calendar', 'weather', 'worldclock',
                'date', 'reminders', 'stocks', 'news']) {
                settings.set_int(`${key}-x`, -1);
                settings.set_int(`${key}-y`, -1);
            }
        });
        resetRow.add_suffix(resetBtn);
        resetRow.activatable_widget = resetBtn;
        glassGroup.add(resetRow);

        const weatherGroup = new Adw.PreferencesGroup({title: 'Weather'});
        page.add(weatherGroup);
        const cityRow = new Adw.EntryRow({
            title: 'City Label',
            text: settings.get_string('city'),
        });
        weatherGroup.add(cityRow);
        settings.bind('city', cityRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const latRow = new Adw.SpinRow({
            title: 'Latitude',
            digits: 2,
            adjustment: new Gtk.Adjustment({
                lower: -90, upper: 90, step_increment: 0.01, page_increment: 1,
                value: settings.get_double('latitude'),
            }),
        });
        weatherGroup.add(latRow);
        settings.bind('latitude', latRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const lonRow = new Adw.SpinRow({
            title: 'Longitude',
            digits: 2,
            adjustment: new Gtk.Adjustment({
                lower: -180, upper: 180, step_increment: 0.01, page_increment: 1,
                value: settings.get_double('longitude'),
            }),
        });
        weatherGroup.add(lonRow);
        settings.bind('longitude', lonRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const remGroup = new Adw.PreferencesGroup({title: 'Reminders'});
        page.add(remGroup);

        const addRow = new Adw.EntryRow({title: 'New reminder'});
        remGroup.add(addRow);
        const addBtnRow = new Adw.ActionRow({title: 'Add the reminder above'});
        const addBtn = new Gtk.Button({label: 'Add', valign: Gtk.Align.CENTER});
        addBtn.connect('clicked', () => {
            const text = addRow.text.trim();
            if (!text)
                return;
            try {
                const cur = settings.get_strv('reminders');
                cur.push(`${text}|0`);
                settings.set_strv('reminders', cur);
            } catch (_) {
                // read-only settings
            }
            addRow.text = '';
        });
        addBtnRow.add_suffix(addBtn);
        addBtnRow.activatable_widget = addBtn;
        remGroup.add(addBtnRow);

        const clearRow = new Adw.ActionRow({title: 'Clear completed'});
        const clearBtn = new Gtk.Button({label: 'Clear', valign: Gtk.Align.CENTER});
        clearBtn.connect('clicked', () => {
            try {
                const cur = settings.get_strv('reminders');
                settings.set_strv('reminders',
                    cur.filter(s => !s.endsWith('|1')));
            } catch (_) {
                // read-only settings
            }
        });
        clearRow.add_suffix(clearBtn);
        clearRow.activatable_widget = clearBtn;
        remGroup.add(clearRow);

        const newsGroup = new Adw.PreferencesGroup({title: 'News'});
        page.add(newsGroup);

        const feedRow = new Adw.EntryRow({
            title: 'RSS Feed',
            text: settings.get_string('news-feed'),
        });
        newsGroup.add(feedRow);
        settings.bind('news-feed', feedRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    }
}
