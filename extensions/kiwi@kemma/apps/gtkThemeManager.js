// SPDX-License-Identifier: GPL-3.0-or-later







import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

const MARKER_BEGIN = '/* Kiwi Component Suite - managed imports: begin */';
const MARKER_END = '/* Kiwi Component Suite - managed imports: end */';


const MANAGED_BLOCK_REGEX = /\/\* Kiwi \(is not macW1Y\) - managed imports: begin \*\/[\s\S]*?\/\* Kiwi \(is not macW1Y\) - managed imports: end \*\/\n?/g;



const LEGACY_IMPORT_REGEX = /^[^\n]*@import[^\n]*kiwi@kemma[^\n]*\n?/gm;

let gtkThemeManager = null;

class GtkThemeManager {
    constructor(ext) {
        this._extension = ext;
        this._settings = null;
        this._settingsChangedId = null;
    }


    _cssUri(name) {
        const path = GLib.build_filenamev([this._extension.path, 'css', name]);
        return Gio.File.new_for_path(path).get_uri();
    }


    _stylesheetsFor(version) {
        const enableAppButtons = this._settings.get_boolean('enable-app-window-buttons');
        const showControlsOnPanel = this._settings.get_boolean('show-window-controls');
        const fullscreenOnly = this._settings.get_boolean('show-window-controls-fullscreen-only');
        const buttonType = this._settings.get_string('button-type');
        const buttonSize = this._settings.get_string('button-size');
        const appFixes = this._settings.get_boolean('popup-menu-styling');

        const sheets = [];


        if (enableAppButtons) {
            if (buttonType === 'titlebuttons-alt')
                sheets.push(`titlebuttons-alt${version}.css`);
            else
                sheets.push(`titlebuttons${version}.css`);

            if (buttonSize === 'small')
                sheets.push(`titlebuttons-size-small${version}.css`);
        }


        if (showControlsOnPanel) {
            if (fullscreenOnly)
                sheets.push(`hide-titlebar-fullscreen${version}.css`);
            else
                sheets.push(`hide-titlebar${version}.css`);
        }


        if (appFixes)
            sheets.push(`fixes${version}.css`);

        return sheets;
    }

    _buildManagedBlock(version) {
        const sheets = this._stylesheetsFor(version);
        if (!sheets.length)
            return '';

        const imports = sheets.map(name => `@import url("${this._cssUri(name)}");`);
        return `${MARKER_BEGIN}\n${imports.join('\n')}\n${MARKER_END}\n`;
    }

    async updateGtkCss() {
        try {
            const configDir = GLib.get_user_config_dir();

            for (const version of ['3', '4']) {
                const gtkConfigDir = GLib.build_filenamev([configDir, `gtk-${version}.0`]);
                GLib.mkdir_with_parents(gtkConfigDir, 0o755);

                const userPath = GLib.build_filenamev([gtkConfigDir, 'gtk.css']);
                await this.processUserGtkFile(userPath, this._buildManagedBlock(version));
            }
        } catch (error) {
            console.error(`[Kiwi] Error updating GTK CSS files: ${error}`);
        }
    }



    async processUserGtkFile(filePath, managedBlock) {
        try {
            const file = Gio.File.new_for_path(filePath);
            const exists = file.query_exists(null);

            if (!exists && !managedBlock)
                return;

            let existingContent = '';
            if (exists) {
                const [contents] = await file.load_contents_async(null);
                existingContent = new TextDecoder().decode(contents);
            }


            existingContent = existingContent
                .replace(MANAGED_BLOCK_REGEX, '')
                .replace(LEGACY_IMPORT_REGEX, '');


            const newContent = managedBlock + existingContent;

            if (!newContent.trim()) {

                if (exists)
                    file.delete(null);
                return;
            }

            file.replace_contents(newContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (error) {
            console.error(`[Kiwi] Error processing GTK file ${filePath}: ${error}`);
        }
    }

    async removeUserGtkConfig() {
        try {
            const configDir = GLib.get_user_config_dir();

            for (const version of ['3', '4']) {
                const userPath = GLib.build_filenamev([configDir, `gtk-${version}.0`, 'gtk.css']);
                await this.processUserGtkFile(userPath, '');
            }
        } catch (error) {
            console.error(`[Kiwi] Error removing user GTK config: ${error}`);
        }
    }

    enable() {
        if (!this._settings) {
            this._settings = this._extension.getSettings();
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'enable-app-window-buttons' || key === 'button-type' || key === 'button-size' || key === 'show-window-controls' || key === 'show-window-controls-fullscreen-only' || key === 'popup-menu-styling') {
                    this.updateGtkCss().catch(error => {
                        console.error(`[Kiwi] Error in settings changed handler: ${error}`);
                    });
                }
            });


            this.updateGtkCss().catch(error => {
                console.error(`[Kiwi] Error in initial update: ${error}`);
            });
        }
    }

    disable() {
        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
            this._settings = null;
        }


        this.removeUserGtkConfig().catch(error => {
            console.error(`[Kiwi] Error in disable cleanup: ${error}`);
        });

        this._extension = null;
    }
}

export function enable(ext) {
    if (!gtkThemeManager) {
        gtkThemeManager = new GtkThemeManager(ext);
        gtkThemeManager.enable();
    }
}

export function disable() {
    if (gtkThemeManager) {
        gtkThemeManager.disable();
        gtkThemeManager = null;
    }
}
