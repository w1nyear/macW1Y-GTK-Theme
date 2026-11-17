import { Settings } from './settings.js';
import { KEYS, DEPRECATED_KEYS } from './keys.js';

const CURRENT_SETTINGS_VERSION = 2;

export function update_from_old_settings(gsettings) {
    const preferences = new Settings(KEYS, gsettings);
    const deprecated_preferences = new Settings(DEPRECATED_KEYS, gsettings);
    const old_version = preferences.settings.get_int('settings-version');

    if (old_version < CURRENT_SETTINGS_VERSION) {



        if (preferences.HACKS_LEVEL > 1)
            preferences.HACKS_LEVEL = 1;



        preferences.dash_to_dock.BLUR = true;
        preferences.dash_to_dock.STATIC_BLUR = true;
        preferences.dash_to_dock.STYLE_DASH_TO_DOCK = 0;


        ['appfolder', 'panel', 'dash_to_dock', 'applications', 'window_list'].forEach(
            component_name => {
                const deprecated_component = deprecated_preferences[component_name];
                const new_component = preferences[component_name];
                if (!deprecated_component.CUSTOMIZE) {
                    new_component.SIGMA = deprecated_preferences.SIGMA;
                    new_component.BRIGHTNESS = deprecated_preferences.BRIGHTNESS;
                    new_component.CORNER_RADIUS = deprecated_preferences.CORNER_RADIUS;
                }
            });


        deprecated_preferences.reset();
    }

    preferences.settings.set_int('settings-version', CURRENT_SETTINGS_VERSION);
}
