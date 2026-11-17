import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Logger from '../logger.js';

const HOME = GLib.get_home_dir();
const specialDir = (d) => GLib.get_user_special_dir(d) || `${HOME}/${d === GLib.UserDirectory.DIRECTORY_DOCUMENTS ? 'Documents' : d === GLib.UserDirectory.DIRECTORY_DESKTOP ? 'Desktop' : 'Downloads'}`;

function launch(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        Logger.error(`Failed to launch ${argv[0]}: ${e}`);
    }
}

function openPath(path) {
    launch(['xdg-open', path]);
}





function createNewFolder() {
    const timestamp = Date.now();
    try {
        const desktop = specialDir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        const folder = Gio.File.new_for_path(GLib.build_filenamev([desktop, `Untitled Folder ${timestamp}`]));
        folder.make_directory_with_parents(null);
    } catch (e) {
        Logger.error(`Failed to create folder: ${e}`);
    }
}





async function getRemovableDrives() {
    return new Promise((resolve) => {
        try {
            const subprocess = Gio.Subprocess.new(
                ['udisksctl', 'dump', '--object-info'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            let stdout = '';
            subprocess.get_stdout_pipe().read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, (source, result) => {
                try {
                    const bytes = source.read_bytes_finish(result);
                    stdout = new TextDecoder().decode(bytes.get_data());
                } catch (e) {

                }

                subprocess.wait_check_async(null, (source, result) => {
                    const drives = [];
                    try {
                        source.finish(result);

                        const lines = stdout.split('\n');
                        let currentDrive = null;

                        for (const line of lines) {
                            if (line.startsWith('/org/freedesktop/UDisks2/Block_devices/')) {
                                if (currentDrive && currentDrive.isRemovable) {
                                    drives.push(currentDrive);
                                }
                                currentDrive = {
                                    device: line.trim().split('/').pop(),
                                    name: '',
                                    size: 0,
                                    isRemovable: false,
                                    mountPoints: []
                                };
                            } else if (currentDrive) {
                                if (line.includes('IdUsage=') && line.includes('filesystem')) {
                                    currentDrive.name = currentDrive.device;
                                }
                                if (/\b(Removable|MediaRemovable)=true\b/i.test(line)
                                    || /\bHintSystem=false\b/i.test(line)) {
                                    currentDrive.isRemovable = true;
                                }
                                if (line.includes('Size=') && !line.includes('PartitionSize')) {
                                    const match = line.match(/Size=(\d+)/);
                                    if (match) currentDrive.size = parseInt(match[1], 10);
                                }
                                if (line.includes('MountPoints=[') && line.includes('/')) {
                                    const mountMatch = line.match(/MountPoints=\[(.*?)\]/);
                                    if (mountMatch) {
                                        currentDrive.mountPoints = mountMatch[1]
                                            .split(',')
                                            .map(s => s.trim().replace(/'/g, ''))
                                            .filter(s => s.length > 0);
                                    }
                                }
                            }
                        }

                        if (currentDrive && currentDrive.isRemovable) {
                            drives.push(currentDrive);
                        }
                    } catch (e) {
                        Logger.error(`Failed to parse udisksctl output: ${e}`);
                    }
                    resolve(drives);
                });
            });
        } catch (e) {
            Logger.error(`Failed to run udisksctl: ${e}`);
            resolve([]);
        }
    });
}




async function ejectDevice(device) {
    return new Promise((resolve) => {
        try {

            const subprocess = Gio.Subprocess.new(
                ['udisksctl', 'unmount', '-b', `/dev/${device}`],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            subprocess.wait_check_async(null, (source, result) => {
                try {
                    source.finish(result);

                    const powerOff = Gio.Subprocess.new(
                        ['udisksctl', 'power-off', '-b', `/dev/${device}`],
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                    );
                    powerOff.wait_check_async(null, (source, result) => {
                        try {
                            source.finish(result);
                            resolve(true);
                        } catch (e) {
                            Logger.error(`Failed to power off device: ${e}`);
                            resolve(false);
                        }
                    });
                } catch (e) {
                    Logger.error(`Failed to unmount device: ${e}`);
                    resolve(false);
                }
            });
        } catch (e) {
            Logger.error(`Failed to eject device: ${e}`);
            resolve(false);
        }
    });
}

export const fileActions = {

    'about-this-system': () => launch(['gnome-control-center', 'about']),
    'system-settings': () => launch(['gnome-control-center']),
    'app-store': () => launch(['gnome-software']),
    'recent-items': () => openPath('recent:///'),
    'force-quit': () => launch(['gnome-system-monitor']),
    'sleep': () => launch(['systemctl', 'suspend']),
    'restart': () => launch(['gnome-session-quit', '--reboot']),
    'shut-down': () => launch(['gnome-session-quit', '--power-off']),
    'lock-screen': () => launch(['loginctl', 'lock-session']),
    'log-out': () => launch(['gnome-session-quit']),


    'open-settings-ext': () => launch(['gnome-extensions', 'prefs', 'appmenu@ChathurangaBW.github.io']),



    'open-finder': () => openPath(HOME),
    'new-finder-win': () => openPath(HOME),
    'new-folder': () => createNewFolder(),

    'open-settings': () => launch(['gnome-control-center']),
    'empty-bin': () => launch(['gio', 'trash', '--empty']),

    'eject': async () => {

        const drives = await getRemovableDrives();
        if (drives.length === 0) {
            Logger.debug('No removable drives found');
            return;
        }


        for (const drive of drives) {
            if (drive.mountPoints.length > 0 || drive.size > 0) {
                await ejectDevice(drive.device);
            }
        }
    },


    'go-home': () => openPath(HOME),
    'go-recents': () => openPath('recent:///'),
    'go-documents': () => openPath(specialDir(GLib.UserDirectory.DIRECTORY_DOCUMENTS)),
    'go-desktop': () => openPath(specialDir(GLib.UserDirectory.DIRECTORY_DESKTOP)),
    'go-downloads': () => openPath(specialDir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)),
    'go-computer': () => openPath('computer:///'),
    'go-network': () => openPath('network:///'),
    'go-applications': () => openPath('/usr/share/applications'),
    'go-utilities': () => openPath('/usr/bin'),


    'open-system-help': () => launch(['yelp']),




    'send-feedback': () => {
        Gio.AppInfo.launch_default_for_uri(
            'https://github.com/ChathurangaBW/AppMenu',
            global.create_app_launch_context(0, -1)
        );
    },

    'app-details': (ctx, appId) => {
        if (appId) launch(['gnome-software', `--details=${appId}`]);
    },

    'open-app-preferences': (ctx) => {
        const appInfo = ctx?.app?.get_app_info?.();
        const launchContext = global.create_app_launch_context(0, -1);
        if (!appInfo) {
            launch(['gnome-control-center']);
            return;
        }

        const actions = appInfo.list_actions?.() ?? [];
        const preferredAction = actions.find(action => ['preferences', 'settings', 'configure', 'options'].includes(action));
        if (preferredAction) {
            appInfo.launch_action(preferredAction, launchContext);
            return;
        }

        const appId = ctx?.app?.get_id?.() ?? null;
        if (appId) {
            launch(['gnome-software', `--details=${appId}`]);
            return;
        }

        launch(['gnome-control-center']);
    },

    'about-appmenu': () => {
        Gio.AppInfo.launch_default_for_uri(
            'https://github.com/ChathurangaBW/AppMenu',
            global.create_app_launch_context(0, -1)
        );
    },
};
