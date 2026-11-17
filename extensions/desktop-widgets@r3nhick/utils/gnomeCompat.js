








import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';





function getGnomeVersion() {
	const version = Config.PACKAGE_VERSION;
	return parseInt(version.split('.')[0], 10);
}

const GNOME_VERSION = getGnomeVersion();
















export function boxLayoutProps(props) {
	const result = {...props};

	if (GNOME_VERSION >= 51) {

		if ('vertical' in props) {
			delete result.vertical;
			result.orientation = props.vertical
				? Clutter.Orientation.VERTICAL
				: Clutter.Orientation.HORIZONTAL;
		}
	} else {

		if ('orientation' in props) {
			delete result.orientation;
			result.vertical = props.orientation === Clutter.Orientation.VERTICAL;
		}
	}

	return result;
}





export function isGnome51Plus() {
	return GNOME_VERSION >= 51;
}





export function isGnome50() {
	return GNOME_VERSION === 50;
}





export function getVersion() {
	return GNOME_VERSION;
}
