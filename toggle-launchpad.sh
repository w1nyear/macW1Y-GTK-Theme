#!/usr/bin/env bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/EvalHelper --method org.gnome.Shell.Extensions.EvalHelper.Eval "(async () => {
    const now = Date.now();
    if (globalThis._lastLaunchpadToggle && (now - globalThis._lastLaunchpadToggle < 300)) {
        return;
    }
    globalThis._lastLaunchpadToggle = now;
    if (typeof globalThis.toggleMacApplications === 'function') {
        globalThis.toggleMacApplications();
    } else {
        try {
            const mod = await import('file://' + GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/appmenu@ChathurangaBW.github.io/applications_menu.js');
            mod.toggleApplicationsDialog();
        } catch (_) {
            if (Main.overview.visible) Main.overview.hide();
            else Main.overview.showApps();
        }
    }
})()" >/dev/null 2>&1
