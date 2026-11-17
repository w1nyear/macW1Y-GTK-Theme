


export function editorKeyAction(keySymbol, shiftPressed, keys) {
	const k = keys ?? {};
	if (keySymbol === k.enter || keySymbol === k.kpEnter) {
		return shiftPressed ? 'newline' : 'commit';
	}
	if (keySymbol === k.escape) {
		return 'cancel';
	}
	return 'propagate';
}
