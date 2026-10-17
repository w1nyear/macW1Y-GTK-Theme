import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {buildPreferences} from './preferences/pages.js';

export default class LiquidGlassPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    buildPreferences(window, this.getSettings());
  }
}
