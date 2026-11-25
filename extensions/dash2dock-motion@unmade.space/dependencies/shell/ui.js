export * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
export * as AppMenu from 'resource:///org/gnome/shell/ui/appMenu.js';
export * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
export * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
export * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
export * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
export * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
export * as Main from 'resource:///org/gnome/shell/ui/main.js';
export * as Overview from 'resource:///org/gnome/shell/ui/overview.js';
export * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
let _pointerWatcherMod = null;
try {
    _pointerWatcherMod = await import('resource:///org/gnome/shell/ui/pointerWatcher.js');
} catch (_) {
    const GLib = (await import('gi://GLib')).default;
    _pointerWatcherMod = {
        getPointerWatcher: () => ({
            addWatch(interval, cb) {
                let [lx, ly] = global.get_pointer();
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                    try {
                        const [x, y] = global.get_pointer();
                        if (x !== lx || y !== ly) {
                            lx = x;
                            ly = y;
                            cb(x, y);
                        }
                    } catch (_) {}
                    return GLib.SOURCE_CONTINUE;
                });
                return {
                    remove: () => {
                        try { GLib.source_remove(id); } catch (_) {}
                    }
                };
            }
        })
    };
}
export const PointerWatcher = _pointerWatcherMod;
export * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
export * as SearchController from 'resource:///org/gnome/shell/ui/searchController.js';
export * as ShellMountOperation from 'resource:///org/gnome/shell/ui/shellMountOperation.js';
export * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
export * as WorkspaceSwitcherPopup from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';
export * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
export * as WorkspacesView from 'resource:///org/gnome/shell/ui/workspacesView.js';
