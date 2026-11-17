









import GLib from 'gi://GLib';
import { getDataDir, isActorDestroyed, loadJsonFromFileAsync, saveJsonToFile, saveJsonToFileSync } from '../utils/ported.js';

export function widgetStatePath(kind, widget) {
	return GLib.build_filenamev([
		getDataDir(kind),
		`${kind}-${widget?.id ?? 'default'}.json`,
	]);
};

export function loadWidgetStateAsync(path, body, onLoaded) {
	loadJsonFromFileAsync(path, (saved) => {

		if (isActorDestroyed(body)) {
			return;
		};
		onLoaded(saved && typeof saved === 'object' ? saved : null);
	});
};

export function saveWidgetState(path, state) {
	saveJsonToFile(path, state);
};



export function saveWidgetStateSync(path, state) {
	saveJsonToFileSync(path, state);
};



export function elapsedSinceWall(wallMs) {
	const now = Date.now();
	if (typeof wallMs !== 'number' || wallMs <= 0 || now <= wallMs) {
		return 0;
	};
	return now - wallMs;
};
