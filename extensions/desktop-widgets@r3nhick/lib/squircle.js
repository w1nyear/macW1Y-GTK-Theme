







function level(x, y, hw, hh, r, n) {
	const qx = Math.abs(x) - hw + r;
	const qy = Math.abs(y) - hh + r;
	if (qx <= 0 && qy <= 0)
		return Math.max(qx, qy) - r;
	const arc = (Math.max(qx, 0) ** n + Math.max(qy, 0) ** n) ** (1 / n);
	return Math.min(Math.max(qx, qy), 0) + arc - r;
}


function rayHit(dx, dy, hw, hh, r, n) {
	let lo = 0;
	let hi = Math.min(
		Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity,
		Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (level(mid * dx, mid * dy, hw, hh, r, n) < 0)
			lo = mid;
		else
			hi = mid;
	}
	return (lo + hi) / 2;
}






export function perimeterTicks(width, height, cornerRadius, roundness, {
	outerInset = 0.05,
	tickLength = 0.026,
	cornerOuterExtension = 0.012,
} = {}) {
	const minSide = Math.min(width, height);
	const cx = width / 2;
	const cy = height / 2;
	const n = Math.max(roundness, 2);

	const radius = Math.min(cornerRadius, cx, cy);

	const outerInsetPx = outerInset * minSide;
	const innerPad = (outerInset + tickLength) * minSide;
	const extensionPx = cornerOuterExtension * minSide;

	const innerHw = Math.max(1, cx - innerPad);
	const innerHh = Math.max(1, cy - innerPad);
	const innerR = Math.min(Math.max(0, radius - innerPad), innerHw, innerHh);

	const ticks = [];
	for (let i = 0; i < 60; i++) {
		const angle = i * 6 * Math.PI / 180;
		const dx = Math.sin(angle);
		const dy = -Math.cos(angle);


		const cornerBlend = 1 - Math.abs(Math.abs(dx) - Math.abs(dy));
		const inset = Math.max(0, outerInsetPx - extensionPx * cornerBlend);
		const outerHw = Math.max(1, cx - inset);
		const outerHh = Math.max(1, cy - inset);
		const outerR = Math.min(Math.max(0, radius - inset), outerHw, outerHh);

		const tOuter = rayHit(dx, dy, outerHw, outerHh, outerR, n);
		const tInner = rayHit(dx, dy, innerHw, innerHh, innerR, n);
		ticks.push({
			dx,
			dy,
			outer: {x: cx + dx * tOuter, y: cy + dy * tOuter},
			inner: {x: cx + dx * tInner, y: cy + dy * tInner},
		});
	}
	return ticks;
}
