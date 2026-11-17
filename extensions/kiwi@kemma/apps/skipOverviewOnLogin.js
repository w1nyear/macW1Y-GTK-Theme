// SPDX-License-Identifier: GPL-3.0-or-later


import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let startupId = 0;
let originalShow = null;
let firstLogin = true;

export function enable() {

    if (firstLogin && !originalShow) {
        originalShow = Main.overview.show;
        Main.overview.show = function(...args) {
            if (firstLogin && Main.layoutManager?._startingUp) {

                return;
            }

            return originalShow.apply(this, args);
        };
    }


    if (Main.layoutManager?._startingUp) {
        if (startupId)
            return;

        startupId = Main.layoutManager.connect('startup-complete', () => {
            try {

                if (originalShow) {
                    Main.overview.show = originalShow;
                    originalShow = null;
                }
                firstLogin = false;


                if (Main.overview.visible)
                    Main.overview.hide();
            } finally {
                if (startupId) {
                    Main.layoutManager.disconnect(startupId);
                    startupId = 0;
                }
            }
        });
        return;
    }


    if (Main.overview.visible) {
        Main.overview.hide();
        firstLogin = false;
    }
}

export function disable() {
    if (startupId) {
        Main.layoutManager.disconnect(startupId);
        startupId = 0;
    }


    if (originalShow) {
        Main.overview.show = originalShow;
        originalShow = null;
    }

    firstLogin = true;
}
