import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { bounceButton, bindHoverShrink } from '../../lib/buttonBounce.js';
import { parseCssColor } from '../../utils/ported.js';
import {
	elapsedSinceWall,
	loadWidgetStateAsync,
	saveWidgetState,
	saveWidgetStateSync,
	widgetStatePath,
} from '../../lib/widgetState.js';

export const type = 'stopwatch';
export const label = 'Stopwatch';
export const defaultSize = 'medium';
export const supportedSizes = ['small', 'medium'];



log('[desktop-widgets] stopwatch widget module imported (colon-symmetry build)');

const TICK_INTERVAL_MS = 10;

function formatTime(totalCentiseconds) {
	const totalSeconds = Math.floor(totalCentiseconds / 100);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	const centiseconds = totalCentiseconds % 100;

	return {
		minutes: minutes.toString().padStart(2, '0'),
		seconds: seconds.toString().padStart(2, '0'),
		centiseconds: centiseconds.toString().padStart(2, '0'),
	};
}







function openStopwatchState({body, widget, isRunning, getCentiseconds, onRestore}) {
	const statePath = widgetStatePath('stopwatch', widget);

	const snapshot = () => ({
		centiseconds: getCentiseconds(),
		running: isRunning(),
		wall: Date.now(),
	});

	loadWidgetStateAsync(statePath, body, onRestore);

	return {


		persist: () => saveWidgetState(statePath, snapshot()),

		flush: () => saveWidgetStateSync(statePath, snapshot()),
	};
}

function accentColor(theme) {
	const accent = String(theme?.accent ?? '').trim();
	return accent || '#3584e4';
}

function textOnAccentColor(accent, theme) {
	const { r, g, b } = parseCssColor(accent);
	const lum = 0.299 * r + 0.587 * g + 0.114 * b;


	const threshold = theme?.dark ? 0.6 : 0.45;
	return lum > threshold ? '#000000' : '#ffffff';
}





function measureText(text, fontPx, weight) {
	const fallback = {
		logicalH: Math.ceil(fontPx * 1.25),
		inkCenterY: Math.round(fontPx * 0.62),
	};
	try {
		const context = PangoCairo.FontMap.get_default().create_context();
		const layout = Pango.Layout.new(context);
		layout.set_markup(
			`<span font_family="Ubuntu" weight="${weight}" pixelsize="${Math.round(fontPx * 1024)}">${text}</span>`,
			-1);
		const [ink, logical] = layout.get_pixel_extents();
		if (logical && logical.height > 0) {
			return {
				logicalH: logical.height,
				inkCenterY: ink.y + ink.height / 2,
			};
		}
	} catch (e) {}
	return fallback;
}



function ghostBorderColor(theme) {
	return theme?.dark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.18)';
}

function renderSmallTimer({body, theme, sizeForWidget, widget}) {
	const textColor = theme.text;
	const mutedColor = theme.muted;
	const accentHex = accentColor(theme);
	const accentTextColor = textOnAccentColor(accentHex, theme);
	const [totalWidth, totalHeight] = sizeForWidget(widget);
	const width = totalWidth - 34;
	const height = totalHeight - 34;
	const scale = Math.min(width / 180, height / 180);
	const px = (v) => Math.max(1, Math.round(v * scale));

	let centiseconds = 0;
	let isRunning = false;
	let timerId = null;
	let tickCount = 0;



	let runBaseCs = 0;
	let runAnchorMono = 0;

	const state = openStopwatchState({body, widget,
		isRunning: () => isRunning,
		getCentiseconds: () => centiseconds,
		onRestore: (saved) => {
			if (typeof saved?.centiseconds === 'number' && saved.centiseconds > 0) {
				centiseconds = saved.centiseconds;
			}
			if (saved?.running) {


				centiseconds += Math.round(elapsedSinceWall(saved.wall) / 10);
				updateDisplay();
				if (!isRunning) {
					startTimer();
				}
			} else {
				updateDisplay();
			}
		},
	});

	const mainBox = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		style: `spacing: ${px(12)}px;`,
	});

	body.add_child(mainBox);


	const timeBox = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		x_align: Clutter.ActorAlign.CENTER,
		style: `spacing: ${px(4)}px;`,
	});


	const timeLabel = new St.Label({
		text: '00:00',
		x_align: Clutter.ActorAlign.CENTER,
		style: `color: ${textColor}; font-size: ${px(42)}px; font-weight: 700;`,
	});

	const timeCaption = new St.Label({
		text: _('Min : Sec'),
		x_align: Clutter.ActorAlign.CENTER,
		style: `color: ${mutedColor}; font-size: ${px(20)}px; font-weight: 600;`,
	});

	timeBox.add_child(timeLabel);
	timeBox.add_child(timeCaption);
	mainBox.add_child(timeBox);


	const buttonsBox = new St.BoxLayout({
		x_align: Clutter.ActorAlign.CENTER,
		style: `spacing: ${px(6)}px;`,
	});

	const pauseBtn = new St.Button({
		reactive: true,
		can_focus: true,
		child: new St.Icon({
			icon_name: 'media-playback-start-symbolic',
			icon_size: px(20),
			style: `color: ${accentTextColor};`,
		}),
		style: `padding: ${px(8)}px ${px(16)}px; border-radius: ${px(8)}px; background-color: ${accentHex};`,
	});

	const resetBtn = new St.Button({
		reactive: true,
		can_focus: true,
		child: new St.Icon({
			icon_name: 'view-refresh-symbolic',
			icon_size: px(20),
			style: `color: ${textColor};`,
		}),
		style: `padding: ${px(8)}px ${px(16)}px; border-radius: ${px(8)}px; background-color: transparent; border: 1px solid ${ghostBorderColor(theme)};`,
	});

	bindHoverShrink(pauseBtn);
	bindHoverShrink(resetBtn);

	buttonsBox.add_child(pauseBtn);
	buttonsBox.add_child(resetBtn);
	mainBox.add_child(buttonsBox);

	const updateDisplay = () => {
		const time = formatTime(centiseconds);
		timeLabel.set_text(`${time.minutes}:${time.seconds}`);
	};

	const startTimer = () => {
		if (isRunning) return;
		isRunning = true;
		runBaseCs = centiseconds;
		runAnchorMono = GLib.get_monotonic_time();
		timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => {
			centiseconds = Math.floor(runBaseCs + (GLib.get_monotonic_time() - runAnchorMono) / 10000);
			updateDisplay();

			if (++tickCount % 100 === 0) {
				state.persist();
			}
			return GLib.SOURCE_CONTINUE;
		});
		state.persist();
		pauseBtn.child.icon_name = 'media-playback-pause-symbolic';
	};

	const stopTimer = () => {
		if (!isRunning) return;
		isRunning = false;
		if (timerId) {
			GLib.Source.remove(timerId);
			timerId = null;
		}
		state.persist();
		pauseBtn.child.icon_name = 'media-playback-start-symbolic';
	};

	const resetTimer = () => {
		stopTimer();
		centiseconds = 0;
		updateDisplay();
		state.persist();
	};

	pauseBtn.connect('button-press-event', (_actor, event) => {
		if (event.get_button() !== 1) {
			return Clutter.EVENT_PROPAGATE;
		}
		bounceButton(pauseBtn);
		if (isRunning) {
			stopTimer();
		} else {
			startTimer();
		}
		return Clutter.EVENT_STOP;
	});

	resetBtn.connect('button-press-event', (_actor, event) => {
		if (event.get_button() !== 1) {
			return Clutter.EVENT_PROPAGATE;
		}
		bounceButton(resetBtn);
		resetTimer();
		return Clutter.EVENT_STOP;
	});

	body.connect('destroy', () => {
		if (timerId) {
			GLib.Source.remove(timerId);
			timerId = null;
		}

		state.flush();
	});

	updateDisplay();
}

function renderMediumTimer({body, theme, sizeForWidget, widget}) {
	const textColor = theme.text;
	const mutedColor = theme.muted;
	const accentHex = accentColor(theme);
	const accentTextColor = textOnAccentColor(accentHex, theme);
	const [width, height] = sizeForWidget(widget);
	const contentW = width - 34;
	const contentH = height - 34;
	const scale = Math.min(contentW / 540, contentH / 200);
	const px = (v) => Math.max(1, Math.round(v * scale));

	let centiseconds = 0;
	let isRunning = false;
	let timerId = null;
	let tickCount = 0;


	let runBaseCs = 0;
	let runAnchorMono = 0;

	const state = openStopwatchState({body, widget,
		isRunning: () => isRunning,
		getCentiseconds: () => centiseconds,
		onRestore: (saved) => {
			if (typeof saved?.centiseconds === 'number' && saved.centiseconds > 0) {
				centiseconds = saved.centiseconds;
			}
			if (saved?.running) {


				centiseconds += Math.round(elapsedSinceWall(saved.wall) / 10);
				updateDisplay();
				if (!isRunning) {
					startTimer();
				}
			} else {
				updateDisplay();
			}
		},
	});

	const mainBox = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.CENTER,



		y_align: Clutter.ActorAlign.CENTER,


		style: `spacing: ${px(6)}px;`,
	});

	body.add_child(mainBox);




	const digitFontPx = px(64);
	const captionFontPx = px(19);
	const digitLine = measureText('00', digitFontPx, '700');
	const captionLine = measureText(_('Minutes'), captionFontPx, '700');




	const digitSlot = px(133);
	const colonSlot = px(16);



	const colonGap = px(10);




	const digitZone = Math.max(px(80), Math.ceil(digitLine.logicalH * 1.08));
	const captionZone = Math.max(px(26), captionLine.logicalH);










	const digitLabel = (text) => new St.Label({
		text,
		style: `color: ${textColor}; font-family: Ubuntu; font-size: ${digitFontPx}px; font-weight: 700; font-variant-numeric: tabular-nums; font-feature-settings: "tnum";`,
	});

	const minutesLabel = digitLabel('00');
	const secondsLabel = digitLabel('00');
	const centisecondsLabel = digitLabel('00');



	const digitBin = (label) => new St.Bin({
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		child: label,
	});

	const minutesBin = digitBin(minutesLabel);
	const secondsBin = digitBin(secondsLabel);
	const centisecondsBin = digitBin(centisecondsLabel);
	for (const bin of [minutesBin, secondsBin, centisecondsBin]) {
		bin.set_size(digitSlot, digitZone);
	};





	const buildColon = () => {
		const area = new St.DrawingArea();
		area.connect('repaint', (canvas) => {
			const ctx = canvas.get_context();
			const rgb = parseCssColor(textColor) ?? {r: 1, g: 1, b: 1, a: 1};
			ctx.setSourceRGBA(rgb.r, rgb.g, rgb.b, 1);
			const cx = Math.round(colonSlot / 2);


			const cy = Math.round((digitZone - digitLine.logicalH) / 2 + digitLine.inkCenterY);
			const r = Math.max(1, Math.round(digitFontPx * 6 / 64));
			const dy = Math.max(2, Math.round(digitFontPx * 9 / 64));
			for (const offset of [-dy, dy]) {
				ctx.arc(cx, cy + offset, r, 0, 2 * Math.PI);
				ctx.fill();
			};
			ctx.$dispose();
		});
		area.set_size(colonSlot, digitZone);
		area.style = `margin-left: ${colonGap}px; margin-right: ${colonGap}px;`;
		return area;
	};







	const captionCell = (text) => {
		const label = new St.Label({
			text,
			style: `color: ${mutedColor}; font-family: Ubuntu; font-size: ${captionFontPx}px; font-weight: 700;`,
		});
		const cell = new St.Bin({
			x_align: Clutter.ActorAlign.CENTER,
			y_align: Clutter.ActorAlign.CENTER,
			child: label,
		});
		cell.set_size(digitSlot, captionZone);
		return cell;
	};

	const buildColumn = (digitBin_, captionText_) => {
		const column = new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,


			style: `spacing: ${px(10)}px;`,
		});
		column.add_child(digitBin_);
		column.add_child(captionCell(captionText_));
		return column;
	};

	const minutesColumn = buildColumn(minutesBin, _('Minutes'));
	const secondsColumn = buildColumn(secondsBin, _('Seconds'));
	const centisecondsColumn = buildColumn(centisecondsBin, _('Centiseconds'));

	const digitRow = new St.BoxLayout({
		x_align: Clutter.ActorAlign.CENTER,
		x_expand: true,
	});
	digitRow.add_child(minutesColumn);
	digitRow.add_child(buildColon());
	digitRow.add_child(secondsColumn);
	digitRow.add_child(buildColon());
	digitRow.add_child(centisecondsColumn);



	mainBox.add_child(new St.Widget({y_expand: true}));
	mainBox.add_child(digitRow);





	const buttonsBox = new St.BoxLayout({
		x_align: Clutter.ActorAlign.CENTER,
		style: `spacing: ${px(12)}px; margin-top: ${px(9)}px;`,
	});

	const pauseBtn = new St.Button({
		reactive: true,
		can_focus: true,
		x_expand: false,
		child: new St.Label({
			text: _('Start'),
			x_align: Clutter.ActorAlign.CENTER,
			y_align: Clutter.ActorAlign.CENTER,
		}),
		style: `font-size: ${px(19)}px; padding: ${px(12)}px ${px(32)}px; border-radius: ${px(12)}px; background-color: ${accentHex}; color: ${accentTextColor}; font-weight: 600;`,
	});

	const resetBtn = new St.Button({
		reactive: true,
		can_focus: true,
		x_expand: false,
		child: new St.Label({
			text: _('Reset'),
			x_align: Clutter.ActorAlign.CENTER,
			y_align: Clutter.ActorAlign.CENTER,
		}),
		style: `font-size: ${px(19)}px; padding: ${px(12)}px ${px(32)}px; border-radius: ${px(12)}px; background-color: transparent; border: 1px solid ${ghostBorderColor(theme)}; color: ${textColor}; font-weight: 600;`,
	});

	bindHoverShrink(pauseBtn);
	bindHoverShrink(resetBtn);


	buttonsBox.add_child(pauseBtn);
	buttonsBox.add_child(resetBtn);
	mainBox.add_child(buttonsBox);
	mainBox.add_child(new St.Widget({y_expand: true}));

	const updateDisplay = () => {
		const time = formatTime(centiseconds);
		minutesLabel.set_text(time.minutes);
		secondsLabel.set_text(time.seconds);
		centisecondsLabel.set_text(time.centiseconds);
	};

	const startTimer = () => {
		if (isRunning) return;
		isRunning = true;
		runBaseCs = centiseconds;
		runAnchorMono = GLib.get_monotonic_time();
		timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => {
			centiseconds = Math.floor(runBaseCs + (GLib.get_monotonic_time() - runAnchorMono) / 10000);
			updateDisplay();

			if (++tickCount % 100 === 0) {
				state.persist();
			}
			return GLib.SOURCE_CONTINUE;
		});
		state.persist();
		pauseBtn.child.text = _('Pause');
		pauseBtn.style = `font-size: ${px(19)}px; padding: ${px(12)}px ${px(32)}px; border-radius: ${px(12)}px; background-color: ${accentHex}; color: ${accentTextColor}; font-weight: 600;`;
	};

	const stopTimer = () => {
		if (!isRunning) return;
		isRunning = false;
		if (timerId) {
			GLib.Source.remove(timerId);
			timerId = null;
		}
		state.persist();
		pauseBtn.child.text = _('Start');
		pauseBtn.style = `font-size: ${px(19)}px; padding: ${px(12)}px ${px(32)}px; border-radius: ${px(12)}px; background-color: ${accentHex}; color: ${accentTextColor}; font-weight: 600;`;
	};

	const resetTimer = () => {
		stopTimer();
		centiseconds = 0;
		updateDisplay();
		state.persist();
	};

	pauseBtn.connect('button-press-event', (_actor, event) => {
		if (event.get_button() !== 1) {
			return Clutter.EVENT_PROPAGATE;
		}
		bounceButton(pauseBtn);
		if (isRunning) {
			stopTimer();
		} else {
			startTimer();
		}
		return Clutter.EVENT_STOP;
	});

	resetBtn.connect('button-press-event', (_actor, event) => {
		if (event.get_button() !== 1) {
			return Clutter.EVENT_PROPAGATE;
		}
		bounceButton(resetBtn);
		resetTimer();
		return Clutter.EVENT_STOP;
	});

	body.connect('destroy', () => {
		if (timerId) {
			GLib.Source.remove(timerId);
			timerId = null;
		}

		state.flush();
	});

	updateDisplay();
}

export function style(theme) {
	return `background-color: ${theme.background}; border-color: ${theme.border};`;
}

export function render({body, theme, sizeForWidget, widget}) {
	const sizeKey = widget?.size ?? 'medium';

	if (sizeKey === 'small') {
		renderSmallTimer({body, theme, sizeForWidget, widget});
	} else {
		renderMediumTimer({body, theme, sizeForWidget, widget});
	}
}
