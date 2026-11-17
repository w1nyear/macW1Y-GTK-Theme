// SPDX-License-Identifier: GPL-3.0-or-later



import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PANEL_CLASS = 'kiwi-panel-styled';
const POPUP_CLASS = 'kiwi-popup-styled';

export function enable() {
    Main.panel.add_style_class_name(PANEL_CLASS);
}

export function disable() {
    Main.panel.remove_style_class_name(PANEL_CLASS);
}


export function enableMenus() {
    Main.uiGroup.add_style_class_name(POPUP_CLASS);
}

export function disableMenus() {
    Main.uiGroup.remove_style_class_name(POPUP_CLASS);
}
