import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

import { screenTimeEngine } from '../../utils/screenTimeEngine.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { bounceButton, bindHoverShrink } from '../../lib/buttonBounce.js';
import { parseCssColor, cssColorToRgba } from '../../utils/ported.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';




let lastSelectedDate = null;



let lastSnapshotDate = null;
let lastSnapshot = null;

export const type = 'screentime';
export const label = 'Screen Time';
export const stylesheet = 'widgets/screentime/stylesheet.css';
export const defaultSize = 'medium';
export const supportedSizes = ['small', 'medium', 'large'];

const BORDER_ALPHA = 0.14;
const REF_WIDTH = 360;
const REF_HEIGHT = 170;


const COMPACT_SQUARE_REF = 156;

const MAIN_PANEL_WIDTH_RATIO = 0.65;
const SIDE_PANEL_LIGHTEN = 0.16;

const Y_AXIS_WIDTH_PX = 35;
const X_AXIS_HEIGHT_PX = 15;
const BAR_WIDTH_PX = 4;
const HOURS_PER_DAY = 24;


const MIN_SCALE_SECONDS = 300;
const HEADER_RESERVED_HEIGHT_PX = 46;
const HEADER_MARGIN_BOTTOM_PX = 12;

const HEADER_FONT_SIZE_PX = 32;
const DATE_LABEL_FONT_SIZE_PX = 14;
const AXIS_LABEL_FONT_SIZE_PX = 10;
const APP_TIME_FONT_SIZE_PX = 16;
const NAV_BUTTON_SIZE_PX = 26;
const NAV_ICON_SIZE_PX = 16;
const APP_ICON_SIZE_PX = 22;
const SECONDARY_TEXT_OPACITY = 0.63;
const DISABLED_CONTROL_OPACITY = Math.round(255 * SECONDARY_TEXT_OPACITY);
const GRID_LINE_ALPHA = 0.3;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


const LEGEND_FONT_SIZE_PX = 11;
const LEGEND_TOP_APPS = 3;
const APP_BAND_FONT_SIZE_PX = 12;
const LARGE_APP_ROWS_MAX = 4;



const BAND_ROW_H_PX = Math.round(APP_BAND_FONT_SIZE_PX * 1.25)
	+ Math.round(APP_BAND_FONT_SIZE_PX * 0.92 * 1.25) + 1;



const APP_PALETTE_DARK = [
	'#99c1f1', '#dc8add', '#8ff0a4', '#f8e45c',
	'#ffbe6f', '#f66151', '#99f1e2', '#cdab8f',
];
const APP_PALETTE_LIGHT = [
	'#1c71d8', '#9141ac', '#26a269', '#e5a50a',
	'#e66100', '#c01c28', '#108a9c', '#865e3c',
];

const OTHER_CATEGORY_DARK = '#9a9996';
const OTHER_CATEGORY_LIGHT = '#5e5c64';

function appPaletteCss(key, isLight) {
	if (key === 'other')
		return isLight ? OTHER_CATEGORY_LIGHT : OTHER_CATEGORY_DARK;
	const palette = isLight ? APP_PALETTE_LIGHT : APP_PALETTE_DARK;
	let sum = 0;
	for (const ch of key)
		sum += ch.codePointAt(0);
	return palette[sum % palette.length];
}


const appChartColors = new Map();
function appChartColor(key, isLight) {
	const cacheKey = (isLight ? 'l:' : 'd:') + key;
	if (appChartColors.size > 256)
		appChartColors.clear();
	if (!appChartColors.has(cacheKey))
		appChartColors.set(cacheKey, parseCssColor(appPaletteCss(key, isLight)));
	return appChartColors.get(cacheKey);
}





const APP_CATEGORY_RULES = [
	['social', ['instantmessaging', 'chat', 'ircclient', 'telephony', 'news', 'contactmanagement']],
	['entertainment', ['game', 'audiovideo', 'music', 'video', 'player', 'audio', 'sports']],
	['development', ['development', 'ide', 'debugger', 'revisioncontrol', 'database', 'building', 'terminalemulator']],
	['creativity', ['graphics', '2dgraphics', '3dgraphics', 'vectorgraphics', 'rastergraphics', 'photography', 'scanning']],
	['work', ['office', 'wordprocessor', 'texttools', 'spreadsheet', 'presentation', 'projectmanagement', 'finance', 'calendar', 'education', 'science']],
	['web', ['network', 'webbrowser', 'filetransfer', 'translation']],
	['utilities', ['utility', 'system', 'settings', 'archiving', 'filetools', 'filemanager', 'core']],
];

const appCategoryCache = new Map();
function resolveAppCategory(appKey) {
	if (appCategoryCache.size > 512)
		appCategoryCache.clear();
	if (!appCategoryCache.has(appKey)) {
		let category = 'other';
		try {
			const info = resolveDesktopAppInfo(appKey);
			const raw = info ? info.get_categories() : null;
			if (raw) {
				const tokens = raw.toLowerCase().split(';').filter(Boolean);
				for (const [bucket, rules] of APP_CATEGORY_RULES) {
					if (rules.some(rule => tokens.includes(rule))) {
						category = bucket;
						break;
					}
				}
			}
		} catch (e) {

		}
		appCategoryCache.set(appKey, category);
	}
	return appCategoryCache.get(appKey);
}


function appCategoryLabel(key) {
	switch (key) {
		case 'social': return _('Social');
		case 'entertainment': return _('Entertainment');
		case 'development': return _('Development');
		case 'creativity': return _('Creativity');
		case 'work': return _('Work');
		case 'web': return _('Web');
		case 'utilities': return _('Utilities');
		default: return _('Other');
	}
}


function buildCategorySummary(apps) {
	const totals = new Map();
	for (const app of apps) {
		const category = resolveAppCategory(app.key);
		totals.set(category, (totals.get(category) || 0) + app.seconds);
	}
	return [...totals.entries()]
		.map(([key, seconds]) => ({ key, seconds }))
		.sort((a, b) => b.seconds - a.seconds);
}

const monthNames = () =>
    [_('Jan'), _('Feb'), _('Mar'), _('Apr'), _('May'), _('Jun'),
     _('Jul'), _('Aug'), _('Sep'), _('Oct'), _('Nov'), _('Dec')];

export function style(theme) {
	return `background-color: ${theme.background}; border: 1px solid ${theme.border}; color: ${theme.text}; border-radius: ${theme.radius ?? 16}px; padding: 0;`;
}

function hexToRgba(hex, alpha) {
	return cssColorToRgba(hex, alpha);
}

function toDateString(dt) {
	return `${dt.get_year()}-${String(dt.get_month()).padStart(2, '0')}-${String(dt.get_day_of_month()).padStart(2, '0')}`;
}

function addDays(dateString, delta) {
	const [y, m, d] = dateString.split('-').map(Number);
	const next = GLib.DateTime.new_local(y, m, d + delta, 12, 0, 0);
	return toDateString(next);
}

function formatShortDate(dateString) {
	const [y, m, d] = dateString.split('-').map(Number);
	return `${d} ${monthNames()[m - 1]}`;
}

function formatCompactDuration(totalSeconds) {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0)
		return _('%sh %sm').format(hours, minutes.toString().padStart(2, '0'));
	return _('%sm').format(minutes);
}

function computeScaleMaxSeconds(hours) {
	let maxSeconds = 0;
	for (const seconds of hours)
		maxSeconds = Math.max(maxSeconds, seconds);
	const base = Math.max(MIN_SCALE_SECONDS, maxSeconds);
	return Math.ceil(base / MIN_SCALE_SECONDS) * MIN_SCALE_SECONDS;
}



function formatAxisDuration(totalSeconds) {
	const hours = Math.floor(totalSeconds / 3600);
	if (hours > 0)
		return _('%sh').format(hours);
	return _('%sm').format(Math.round((totalSeconds % 3600) / 60));
}

function shadePanelColor(cssColor, amount) {
	const { r, g, b } = parseCssColor(cssColor);
	const isDark = (r * 0.299 + g * 0.587 + b * 0.114) < 0.5;
	const mix = (channel) => isDark
		? Math.round(((channel * (1 - amount)) + amount) * 255)
		: Math.round(channel * 255 * (1 - amount));
	return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}




let GioUnix = null;
try {
	GioUnix = (await import('gi://GioUnix')).default;
} catch (e) {
	GioUnix = null;
}
const appInfoCache = new Map();
const APP_INFO_CACHE_MAX = 256;
function resolveDesktopAppInfo(appKey) {


	if (appInfoCache.size >= APP_INFO_CACHE_MAX) {
		appInfoCache.clear();
	}
	if (!appInfoCache.has(appKey)) {
		try {
			const AppInfoClass = GioUnix?.DesktopAppInfo?.new ? GioUnix.DesktopAppInfo : Gio.DesktopAppInfo;
			appInfoCache.set(appKey, AppInfoClass.new(appKey));
		} catch (e) {
			appInfoCache.set(appKey, null);
		}
	}
	return appInfoCache.get(appKey);
}

const SIZE_CONFIGS = {
	small:      { showChart: true,  maxApps: 0 },
	medium:     { showChart: true,  maxApps: 4 },
	large:      { showChart: true,  maxApps: 8 },
};

const DEFAULT_CONFIG = { showChart: false, maxApps: 3 };

export function render({body, createLabel, theme, sizeForWidget, widget, settings}) {
	const size = widget?.size && SIZE_CONFIGS[widget.size] ? widget.size : defaultSize;
	const config = SIZE_CONFIGS[size] ?? DEFAULT_CONFIG;


	const compactSquare = size === 'small';


	const isLarge = size === 'large';


	const [widgetWidth, widgetHeight] = sizeForWidget(widget);

	if (settings?.get_int)
		screenTimeEngine.setRetentionDays(settings.get_int('screentime-retention-days'));
	const textColor = theme?.text ?? '#ffffff';
	const bgColor = theme?.background ?? '#242424';
	const accentHex = theme?.accent ?? '#3584e4';
	const radius = theme?.radius ?? 16;
	const textRgba = (alpha) => cssColorToRgba(textColor, alpha);

	let isLightBg = false;
	try {
		const bgParsed = parseCssColor(bgColor);
		isLightBg = (bgParsed.r * 0.299 + bgParsed.g * 0.587 + bgParsed.b * 0.114) >= 0.5;
	} catch (e) {
		isLightBg = false;
	}

	const state = {
		selectedDate: null,
		snapshot: null,
		geometry: {},
		categorySummary: [],
		engineListener: null,
		releaseEngine: null,
		lastAppListSignature: '',
		lastAppListScale: null,
		lastListHeight: null,



		lastKnownToday: null,
	};


	state.chartCompact = compactSquare;
	body.clip_to_allocation = true;




	let rootAlive = true;


	const splitBox = isLarge ? null : new St.BoxLayout({
		orientation: Clutter.Orientation.HORIZONTAL,
		style_class: 'screentime-widget',
		x_expand: true,
		y_expand: true,
		clip_to_allocation: true,
	});


	const compactBox = compactSquare
		? new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,
			x_expand: true,
			y_expand: true,
			clip_to_allocation: true,
		})
		: null;


	const largeRoot = isLarge
		? new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,
			clip_to_allocation: true,
		})
		: null;
	const root = compactSquare ? compactBox : (isLarge ? largeRoot : splitBox);
	body.add_child(root);






	const isGlass = theme?.isGlass ?? false;
	const leftBg = isGlass ? cssColorToRgba(bgColor, 0.25) : bgColor;
	const sideBase = shadePanelColor(bgColor, SIDE_PANEL_LIGHTEN);




	const sideBg = isGlass ? cssColorToRgba(sideBase, 0.25) : sideBase;



	const leftPanel = !splitBox ? null : new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		y_expand: true,
		clip_to_allocation: true,
		style: `background-color: ${leftBg}; border-radius: ${radius}px 0 0 ${radius}px;`,
	});
	if (splitBox)
		splitBox.add_child(leftPanel);

	const rightPanel = !splitBox ? null : new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		y_expand: true,
		clip_to_allocation: true,
		style: `background-color: ${sideBg}; border-radius: 0 ${radius}px ${radius}px 0;`,
	});
	if (splitBox)
		splitBox.add_child(rightPanel);


	const headerBox = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
	if (compactSquare)
		compactBox.add_child(headerBox);
	else if (isLarge)
		largeRoot.add_child(headerBox);
	else
		leftPanel.add_child(headerBox);

	const totalTimeLabel = new St.Label({
		text: '0m',
		x_expand: true,
		y_align: Clutter.ActorAlign.START,
		style: `color: ${textColor}; font-size: ${HEADER_FONT_SIZE_PX}px; font-weight: 600;`,
	});
	headerBox.add_child(totalTimeLabel);




	const showNavButtons = settings?.get_boolean('screentime-show-nav-buttons') ?? true;
	const controlsColumn = new St.BoxLayout({
		orientation: isLarge ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
		x_align: Clutter.ActorAlign.END,
		y_align: Clutter.ActorAlign.START,
		style: 'spacing: 6px;',
	});

	const dateLabel = new St.Label({
		text: '',
		y_align: Clutter.ActorAlign.CENTER,
		style: `color: ${textColor}; font-size: ${DATE_LABEL_FONT_SIZE_PX}px; `
			+ `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
	});


	if (!compactSquare)
		controlsColumn.add_child(dateLabel);

	const navButtonsRow = new St.BoxLayout({ style: 'spacing: 6px;' });
	controlsColumn.add_child(navButtonsRow);



	navButtonsRow.visible = showNavButtons;
	controlsColumn.visible = showNavButtons || !compactSquare;
	headerBox.add_child(controlsColumn);

	const buildNavButton = (iconName, action) => {
		const button = new St.Button({
			reactive: true,
			can_focus: true,
			style: `width: ${NAV_BUTTON_SIZE_PX}px; height: ${NAV_BUTTON_SIZE_PX}px;`
				+ `border: 1px solid ${textRgba(0.14)}; border-radius: 6px; background-color: transparent;`,
			child: new St.Icon({
				icon_name: iconName,
				icon_size: NAV_ICON_SIZE_PX,
				style: `color: ${textColor}; opacity: ${SECONDARY_TEXT_OPACITY};`,
			}),
		});
		button.connect('button-press-event', (_actor, event) => {
			if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;



			bounceButton(button);
			action();
			return Clutter.EVENT_STOP;
		});
		button.set_pivot_point(0.5, 0.5);
		bindHoverShrink(button);
		navButtonsRow.add_child(button);
		return button;
	};

	const goToPreviousDay = () => {
		state.selectedDate = addDays(state.selectedDate, -1);
		refreshData();
	};
	const goToNextDay = () => {
		if (state.selectedDate === screenTimeEngine.getTodayDate()) return;
		state.selectedDate = addDays(state.selectedDate, 1);
		refreshData();
	};

	const prevButton = buildNavButton('go-previous-symbolic', goToPreviousDay);
	const nextButton = buildNavButton('go-next-symbolic', goToNextDay);
















	const bindDaySwipe = (card, threshold, { animate = true } = {}) => {
		const SWIPE_DURATION = 250;
		let swipeStartX = null;
		let swipeBusy = false;

		card.reactive = true;


		card.connect('button-press-event', (_actor, event) => {
			if (event.get_button() !== 3) return Clutter.EVENT_PROPAGATE;
			swipeStartX = event.get_coords()[0];
			return Clutter.EVENT_PROPAGATE;
		});
		card.connect('button-release-event', (_actor, event) => {
			if (swipeStartX === null) return Clutter.EVENT_PROPAGATE;
			const startX = swipeStartX;
			swipeStartX = null;

			const delta = event.get_coords()[0] - startX;
			if (Math.abs(delta) < threshold) return Clutter.EVENT_PROPAGATE;
			if (swipeBusy) return Clutter.EVENT_STOP;



			const dayDelta = delta < 0 ? 1 : -1;
			if (dayDelta > 0 && state.selectedDate === screenTimeEngine.getTodayDate())
				return Clutter.EVENT_STOP;


			if (!animate) {
				state.selectedDate = addDays(state.selectedDate, dayDelta);
				refreshData();
				return Clutter.EVENT_STOP;
			}

			const pageWidth = Math.max(120, card.get_width() || 180);
			const exitX = delta < 0 ? -pageWidth : pageWidth;
			swipeBusy = true;




			card.ease({
				opacity: 0,
				translation_x: exitX,
				duration: SWIPE_DURATION,
				mode: Clutter.AnimationMode.EASE_IN_QUAD,
				onComplete: () => {
					state.selectedDate = addDays(state.selectedDate, dayDelta);
					refreshData();
					card.translation_x = -exitX;
					card.ease({
						opacity: 255,
						translation_x: 0,
						duration: SWIPE_DURATION,
						mode: Clutter.AnimationMode.EASE_OUT_QUAD,
						onComplete: () => { swipeBusy = false; },
					});
				},
			});
			return Clutter.EVENT_STOP;
		});
	};

	bindDaySwipe(root, 30, { animate: compactSquare });


	let chartWrap = null;
	let chartCanvas = null;
	let yAxisBox = null;
	let xAxisBox = null;
	let yAxisLabels = null;
	if (config.showChart) {


		chartWrap = new St.Widget({ x_expand: true, y_expand: !isLarge });
		if (compactSquare)
			compactBox.add_child(chartWrap);
		else if (isLarge)
			largeRoot.add_child(chartWrap);
		else
			leftPanel.add_child(chartWrap);

		chartCanvas = new St.DrawingArea();
		chartWrap.add_child(chartCanvas);

		const yAxisAlignments = [Clutter.ActorAlign.START, Clutter.ActorAlign.CENTER, Clutter.ActorAlign.END];
		yAxisLabels = ['0', '0', '0'].map((_, index) => new St.Label({
			y_expand: true,
			y_align: yAxisAlignments[index],
			x_align: Clutter.ActorAlign.END,
			style: `color: ${textColor}; font-size: ${AXIS_LABEL_FONT_SIZE_PX}px; `
				+ `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
		}));
		yAxisBox = new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,
			x_align: Clutter.ActorAlign.END,
		});
		yAxisLabels.forEach(label => yAxisBox.add_child(label));
		chartWrap.add_child(yAxisBox);

		const xAxisSpec = compactSquare

			? [['00', Clutter.ActorAlign.START], ['12', Clutter.ActorAlign.CENTER], ['24', Clutter.ActorAlign.END]]
			: (isLarge

				? [['00', Clutter.ActorAlign.START], ['06', Clutter.ActorAlign.CENTER],
					['12', Clutter.ActorAlign.CENTER], ['18', Clutter.ActorAlign.END]]
				: [['00:00', Clutter.ActorAlign.START], ['12:00', Clutter.ActorAlign.CENTER], ['24:00', Clutter.ActorAlign.END]]);
		const xAxisLabels = xAxisSpec.map(([text, xAlign]) => new St.Label({
			text,
			x_expand: true,
			x_align: xAlign,
			style: `color: ${textColor}; font-size: ${AXIS_LABEL_FONT_SIZE_PX}px; `
				+ `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
		}));
		xAxisBox = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
		xAxisLabels.forEach(label => xAxisBox.add_child(label));





		if (compactSquare)
			compactBox.add_child(xAxisBox);
		else
			chartWrap.add_child(xAxisBox);




		const drawDayChart = (area, day) => {
			const ctx = area.get_context();
			const [canvasWidth, canvasHeight] = area.get_surface_size();
			const { r, g, b } = parseCssColor(textColor);
			const s = state.geometry.scale || 1;



			if (!canvasWidth || !canvasHeight) {
				ctx.$dispose();
				return;
			}

			ctx.setOperator(0);
			ctx.paint();
			ctx.setOperator(2);

			ctx.setSourceRGBA(r, g, b, GRID_LINE_ALPHA);
			ctx.setLineWidth(1);
			ctx.setDash([3 * s, 3 * s], 0);

			if (state.chartCompact) {


				for (const yFrac of [0, 0.5, 1]) {
					const y = Math.round(canvasHeight * yFrac) + 0.5;
					ctx.moveTo(0, y);
					ctx.lineTo(canvasWidth, y);
				}
				const x = Math.round(canvasWidth * 0.5) + 0.5;
				ctx.moveTo(x, 0);
				ctx.lineTo(x, canvasHeight);
			} else {
				for (const yFrac of [0, 0.5, 1]) {
					const y = Math.round(canvasHeight * yFrac) + 0.5;
					ctx.moveTo(0, y);
					ctx.lineTo(canvasWidth, y);
				}


				const xStops = state.geometry.largeChart ? [0.25, 0.5, 0.75] : [0, 0.5, 1];
				for (const xFrac of xStops) {
					const x = Math.round(canvasWidth * xFrac) + 0.5;
					ctx.moveTo(x, 0);
					ctx.lineTo(x, canvasHeight);
				}
			}
			ctx.stroke();
			ctx.setDash([], 0);

			const hours = day.hours;
			const scaleMax = day.scaleMax;
			const accent = parseCssColor(accentHex);



			const hourKeys = day.hourKeys;
			const topCategory = day.topKey;



			const barWidth = state.chartCompact
				? Math.max(3, Math.round((canvasWidth / HOURS_PER_DAY) * 0.62))
				: Math.round((state.geometry.largeBarWidth || BAR_WIDTH_PX) * s);
			const barRadius = Math.round(barWidth / 2);

			for (let hour = 0; hour < hours.length; hour++) {
				if (hours[hour] <= 0) continue;
				const barHeight = Math.max(barWidth, (hours[hour] / scaleMax) * canvasHeight);
				const centerX = ((hour + 0.5) / HOURS_PER_DAY) * canvasWidth;
				const x = centerX - (barWidth / 2);
				const y = canvasHeight - barHeight;

				const bucketKey = hourKeys ? hourKeys[hour] : null;
				const bucketCategory = bucketKey ? resolveAppCategory(bucketKey) : null;
				const barColor = (bucketCategory && bucketCategory !== topCategory)
					? appChartColor(bucketCategory, isLightBg) : accent;
				ctx.setSourceRGBA(barColor.r, barColor.g, barColor.b, 1);

				ctx.newSubPath();
				ctx.arc(x + barRadius, y + barRadius, barRadius, Math.PI, 1.5 * Math.PI);
				ctx.arc(x + barWidth - barRadius, y + barRadius, barRadius, 1.5 * Math.PI, 2 * Math.PI);
				ctx.lineTo(x + barWidth, canvasHeight);
				ctx.lineTo(x, canvasHeight);
				ctx.closePath();
				ctx.fill();
			}





			if (hours.every(v => !v || v <= 0)) {
				const text = _('No activity');
				ctx.selectFontFace('Sans', 0, 0);
				const fontSize = Math.max(10, Math.round(12 * s));
				ctx.setFontSize(fontSize);
				const ext = ctx.textExtents(text);
				ctx.setSourceRGBA(r, g, b, 0.35);
				ctx.moveTo(
					Math.max(0, (canvasWidth - ext.width) / 2),
					Math.max(fontSize, (canvasHeight - ext.height) / 2 + fontSize * 0.35),
				);
				ctx.showText(text);
			}
			ctx.$dispose();
		};


		const liveDayView = () => ({
			hours: state.snapshot ? state.snapshot.hours : [],
			scaleMax: computeScaleMaxSeconds(state.snapshot ? state.snapshot.hours : []),
			hourKeys: state.snapshot ? state.snapshot.hourKeys ?? null : null,
			topKey: state.categorySummary && state.categorySummary[0]
				? state.categorySummary[0].key : null,
		});

		chartCanvas.connect('repaint', (area) => {
			drawDayChart(area, liveDayView());
		});
	}


	let legendBox = null;
	let appsBand = null;
	let bandColumns = null;
	let bandGrid = null;
	if (isLarge) {
		legendBox = new St.BoxLayout({
			orientation: Clutter.Orientation.HORIZONTAL,
		});
		largeRoot.add_child(legendBox);






		appsBand = new St.Widget({
			layout_manager: new Clutter.BinLayout(),
			y_expand: true,
			clip_to_allocation: true,
		});
		bandGrid = new St.BoxLayout({
			x_expand: true,


			y_align: Clutter.ActorAlign.CENTER,
		});
		appsBand.add_child(bandGrid);
		bandColumns = [0, 1].map(() => new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,
			x_expand: true,
		}));
		bandColumns.forEach(column => bandGrid.add_child(column));
		largeRoot.add_child(appsBand);
	}


	const appRowsBox = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		style: 'spacing: 14px;',
	});


	if (!compactSquare && !isLarge)
		rightPanel.add_child(appRowsBox);


	state.releaseEngine = screenTimeEngine.acquire();
	state.selectedDate = lastSelectedDate ?? screenTimeEngine.getTodayDate();

	const onEngineTick = () => {
		const today = screenTimeEngine.getTodayDate();



		if (compactSquare && today && state.lastKnownToday
			&& today !== state.lastKnownToday
			&& state.selectedDate === state.lastKnownToday) {
			state.selectedDate = today;
		}
		if (today)
			state.lastKnownToday = today;
		if (state.selectedDate === today)
			refreshData();
	};

	state.engineListener = onEngineTick;
	screenTimeEngine.addListener(onEngineTick);



	const settingsSignals = [];
	if (settings?.connect) {
		settingsSignals.push(settings.connect(
			'changed::screentime-show-nav-buttons',
			() => {
				if (isActorDestroyed(body) || !body.get_parent()) return;
				const show = settings.get_boolean('screentime-show-nav-buttons') ?? true;
				navButtonsRow.visible = show;
				controlsColumn.visible = show || !compactSquare;
			},
		));
	}

	let engineCleaned = false;
	const cleanup = () => {
		if (engineCleaned) return;
		engineCleaned = true;
		if (state.releaseEngine) {
			state.releaseEngine();
			state.releaseEngine = null;
		}
		if (state.engineListener) {
			screenTimeEngine.removeListener(state.engineListener);
			state.engineListener = null;
		}
		settingsSignals.forEach(id => settings.disconnect(id));
		settingsSignals.length = 0;
	};



	root.connect('destroy', cleanup);
	body.connect('destroy', cleanup);

	function refreshData() {
		if (!rootAlive || isActorDestroyed(body) || !body.get_parent()) return;


		lastSelectedDate = state.selectedDate;
		if (state.selectedDate === screenTimeEngine.getTodayDate()) {
			state.snapshot = screenTimeEngine.getTodaySnapshot();
			renderDynamic();
		} else {
			screenTimeEngine.loadDayAsync(state.selectedDate, (snapshot) => {
				if (!body.get_parent() || state.selectedDate !== snapshot.date) return;
				state.snapshot = snapshot;
				renderDynamic();
			});
		}
	}






	function appListSignature(snapshot) {
		return JSON.stringify(snapshot.apps.slice(0, 12).map(app => [app.key, Math.floor(app.seconds / 60)]));
	}

	function renderDynamic() {
		if (!rootAlive) return;
		if (!state.snapshot) return;




		lastSnapshot = state.snapshot;
		lastSnapshotDate = state.snapshot.date ?? lastSnapshotDate;

		totalTimeLabel.text = formatCompactDuration(state.snapshot.totalSeconds);
		state.categorySummary = buildCategorySummary(state.snapshot.apps);

		if (!compactSquare) {
			dateLabel.text = formatShortDate(state.selectedDate);
			const isViewingToday = state.selectedDate === screenTimeEngine.getTodayDate();
			nextButton.set_opacity(isViewingToday ? DISABLED_CONTROL_OPACITY : 255);
		}

		if (config.showChart)
			updateYAxisLabels();

		if (!compactSquare) {
			const signature = appListSignature(state.snapshot);
			const geometryChanged = state.geometry.scale !== state.lastAppListScale
				|| state.geometry.listHeight !== state.lastListHeight;
			if (signature !== state.lastAppListSignature || geometryChanged) {
				state.lastAppListSignature = signature;
				state.lastAppListScale = state.geometry.scale;
				state.lastListHeight = state.geometry.listHeight;
				rebuildAppList();
			}
		}

		if (chartCanvas && state.geometry.plotWidth > 0)
			chartCanvas.queue_repaint();
	}

	function updateYAxisLabels() {
		const scaleMax = computeScaleMaxSeconds(state.snapshot.hours);
		const labels = [
			formatAxisDuration(scaleMax),
			formatAxisDuration(scaleMax / 2),
			'0',
		];
		yAxisLabels.forEach((label, index) => label.set_text(labels[index]));
	}

	function resolveAppName(appKey) {
		try {
			const info = resolveDesktopAppInfo(appKey);
			return info ? (info.get_name() || appKey) : appKey;
		} catch (e) {
			return appKey;
		}
	}



	function buildAppRow(app, px, withName) {


		const row = new St.BoxLayout({
			orientation: Clutter.Orientation.HORIZONTAL,
			x_align: Clutter.ActorAlign.FILL,
			style: 'spacing: 10px;',
		});

		const iconSlot = new St.Widget({
			layout_manager: new Clutter.BinLayout(),
			width: px(APP_ICON_SIZE_PX),
			height: px(APP_ICON_SIZE_PX),
		});
		const appIcon = new St.Icon({
			icon_name: 'application-x-generic',
			icon_size: px(APP_ICON_SIZE_PX),
		});
		const appInfo = resolveDesktopAppInfo(app.key);
		const gicon = appInfo ? appInfo.get_icon() : null;
		if (gicon)
			appIcon.gicon = gicon;
		iconSlot.add_child(appIcon);
		row.add_child(iconSlot);

		if (withName) {



			const textCol = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				x_expand: true,
				y_align: Clutter.ActorAlign.CENTER,
				style: 'spacing: 1px;',
			});

			const nameLabel = new St.Label({
				text: resolveAppName(app.key),
				style: `color: ${textColor}; font-size: ${px(APP_BAND_FONT_SIZE_PX)}px; `
					+ `font-weight: 600; opacity: 0.92;`,
			});
			nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
			textCol.add_child(nameLabel);

			const durationLabel = new St.Label({
				text: formatCompactDuration(app.seconds),
				style: `color: ${textColor}; font-size: ${px(Math.round(APP_BAND_FONT_SIZE_PX * 0.92))}px; `
					+ `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
			});
			textCol.add_child(durationLabel);
			row.add_child(textCol);
		} else {
			const durationLabel = new St.Label({
				text: formatCompactDuration(app.seconds),
				x_expand: true,
				y_align: Clutter.ActorAlign.CENTER,
				style: `color: ${textColor}; font-size: ${px(APP_TIME_FONT_SIZE_PX)}px; `
					+ `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
			});
			durationLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
			row.add_child(durationLabel);
		}

		return row;
	}




	function rebuildLegend() {
		legendBox.destroy_all_children();
		const s = state.geometry.scale || 1;
		const chips = (state.categorySummary || []).slice(0, LEGEND_TOP_APPS);
		if (chips.length === 0) {
			legendBox.add_child(new St.Label({
				text: _('No activity recorded'),
				x_expand: true,
				x_align: Clutter.ActorAlign.START,
				style: `color: ${textColor}; font-size: ${Math.max(1, Math.round(LEGEND_FONT_SIZE_PX * s))}px; `
					+ `font-weight: 700; opacity: ${SECONDARY_TEXT_OPACITY};`,
			}));
			return;
		}
		const chipAligns = [
			Clutter.ActorAlign.START, Clutter.ActorAlign.CENTER, Clutter.ActorAlign.END,
		];
		for (let i = 0; i < chips.length; i++) {


			const chip = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				x_expand: true,
				x_align: chipAligns[i],
				style: 'spacing: 1px;',
			});

			const chipName = new St.Label({
				text: appCategoryLabel(chips[i].key),
				style: `color: ${i === 0 ? accentHex : appPaletteCss(chips[i].key, isLightBg)}; `
					+ `font-size: ${Math.max(1, Math.round(LEGEND_FONT_SIZE_PX * s))}px; font-weight: 700;`,
			});
			chipName.clutter_text.ellipsize = Pango.EllipsizeMode.END;
			chip.add_child(chipName);

			const chipTime = new St.Label({
				text: formatCompactDuration(chips[i].seconds),
				style: `color: ${textColor}; `
					+ `font-size: ${Math.max(1, Math.round(LEGEND_FONT_SIZE_PX * 0.92 * s))}px; font-weight: 600;`,
			});
			chip.add_child(chipTime);

			legendBox.add_child(chip);
		}
	}



	function rebuildAppBand() {
		bandColumns.forEach(column => column.destroy_all_children());
		const s = state.geometry.scale || 1;
		const px = (v) => Math.max(1, Math.round(v * s));
		const rows = state.geometry.bandRows || 1;
		const apps = state.snapshot.apps.slice(0, Math.min(rows * 2, config.maxApps));

		if (apps.length === 0) {
			bandColumns[0].add_child(new St.Label({
				text: _('No activity recorded'),
				style: `color: ${textColor}; font-size: ${px(APP_BAND_FONT_SIZE_PX)}px; `
					+ `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
			}));
			return;
		}

		for (let i = 0; i < apps.length; i++) {
			try {
				const column = bandColumns[i < rows ? 0 : 1];
				column.add_child(buildAppRow(apps[i], px, true));
			} catch (e) {

			}
		}






		const needed = Math.max(1, Math.min(LARGE_APP_ROWS_MAX,
			Math.ceil(Math.min(state.snapshot.apps.length, config.maxApps) / 2)));
		if (rows !== needed) {
			state.geometry.bandRows = needed;


			state.geometry.layoutDirty = true;
			scheduleUpdate();
			return;
		}




		const gap = Math.round(4 * s);
		bandColumns.forEach(column => {
			column.style = `spacing: ${gap}px;`;
		});
	}

	function rebuildAppList() {
		if (isLarge) {
			rebuildLegend();
			rebuildAppBand();
			return;
		}
		appRowsBox.destroy_all_children();







		const s = state.geometry.scale || 1;
		const px = (v) => Math.max(1, Math.round(v * s));
		const rowH = Math.max(px(APP_ICON_SIZE_PX), Math.round(px(APP_TIME_FONT_SIZE_PX) * 1.5));
		const rowSpacing = px(14);
		const measured = rightPanel.get_height();
		const fitted = Math.max(0, (measured > 0 ? measured : state.geometry.listHeight || 0) - px(32) - 2);
		const maxByHeight = fitted > 0
			? Math.max(1, Math.floor((fitted + rowSpacing) / (rowH + rowSpacing)))
			: config.maxApps;
		const apps = state.snapshot.apps.slice(0, Math.min(config.maxApps, maxByHeight));

		if (apps.length === 0) {
			appRowsBox.add_child(new St.Label({
				text: _('No activity recorded'),
				x_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
				style: `color: ${textColor}; font-size: ${APP_TIME_FONT_SIZE_PX}px; `
					+ `font-weight: 600; opacity: ${SECONDARY_TEXT_OPACITY};`,
			}));
			return;
		}

		for (const app of apps) {
			try {


				appRowsBox.add_child(buildAppRow(app, px, false));
			} catch (e) {

			}
		}
	}

	function applyLayout(currentWidth, currentHeight) {


		if (!currentWidth || !currentHeight) return;
		const s = Math.min(
			currentWidth / (compactSquare ? COMPACT_SQUARE_REF : REF_WIDTH),
			currentHeight / (compactSquare ? COMPACT_SQUARE_REF : REF_HEIGHT),
		);
		if (!isFinite(s) || s <= 0) return;
		state.geometry.scale = s;

		if (compactSquare) {

			const padTop = Math.round(12 * s);
			const padSide = Math.round(13 * s);


			const padBottom = Math.round(6 * s);
			compactBox.style = `padding: ${padTop}px ${padSide}px ${padBottom}px ${padSide}px;`;




			const headerReserve = Math.round(30 * s);
			const yWidth = Math.round(30 * s);
			const axisH = Math.round(X_AXIS_HEIGHT_PX * s);
			const plotWidth = Math.max(1, currentWidth - padSide * 2 - yWidth);
			const plotHeight = Math.max(1, currentHeight - padTop - padBottom
				- headerReserve - axisH - Math.round(12 * s));
			Object.assign(state.geometry, { plotWidth, plotHeight });



			const plotOffset = Math.round(12 * s);
			chartCanvas.set_position(0, plotOffset);
			chartCanvas.set_size(plotWidth, plotHeight);
			yAxisBox.set_position(plotWidth, plotOffset);
			yAxisBox.set_size(yWidth, plotHeight);




			xAxisBox.set_size(plotWidth, axisH);
			xAxisBox.x_expand = true;
			xAxisBox.style = `margin: 0 ${Math.round(padSide + yWidth)}px 0 ${Math.round(padSide)}px;`;




			totalTimeLabel.style = `color: ${textColor}; font-size: ${Math.round(21 * s)}px; font-weight: 600;`;

			renderDynamic();
			return;
		}

		if (isLarge) {

			largeRoot.set_size(currentWidth, currentHeight);
			const padSide = Math.round(16 * s);
			const padTop = Math.round(12 * s);
			const yWidth = Math.round(Y_AXIS_WIDTH_PX * s);
			const axisH = Math.round(X_AXIS_HEIGHT_PX * s);


			const headerEstimate = Math.round(38 * s);
			const headerMargin = Math.round(6 * s);
			const legendMargin = Math.round(6 * s);
			const legendH = Math.round(LEGEND_FONT_SIZE_PX * 1.25 * s)
				+ Math.round(LEGEND_FONT_SIZE_PX * 0.92 * 1.25 * s) + Math.round(1 * s);

			headerBox.style = `margin: ${padTop}px ${padSide}px ${headerMargin}px ${padSide}px;`;

			totalTimeLabel.y_align = Clutter.ActorAlign.CENTER;
			totalTimeLabel.style = `color: ${textColor}; font-size: ${Math.round(HEADER_FONT_SIZE_PX * s * 0.9)}px; font-weight: 600;`;
			prevButton.style = `width: ${Math.round(NAV_BUTTON_SIZE_PX * s)}px; height: ${Math.round(NAV_BUTTON_SIZE_PX * s)}px;`
				+ `border: 1px solid ${textRgba(0.14)}; border-radius: ${Math.round(6 * s)}px; background-color: transparent;`;
			nextButton.style = prevButton.style;



			const xAxisZone = Math.round(4 * s) + axisH;
			const bandPadEdge = Math.round(4 * s);
			const bandGap = Math.round(4 * s);




			if (!state.geometry.measuredRowH || state.geometry.measuredRowH.s !== s) {
				try {
					const px0 = (v) => Math.max(1, Math.round(v * s));
					const probe = buildAppRow({ key: '', seconds: 60000 }, px0, true);
					bandColumns[0].add_child(probe);
					const natural = Math.ceil(probe.get_preferred_height(-1)[1]);
					bandColumns[0].remove_child(probe);
					probe.destroy();
					if (natural > 0)
						state.geometry.measuredRowH = {
							h: Math.max(Math.round(APP_ICON_SIZE_PX * s), natural),
							s,
						};
				} catch (e) {

				}
			}
			const cachedRow = state.geometry.measuredRowH;
			const bandRowH = Math.max(
				Math.round(APP_ICON_SIZE_PX * s),
				cachedRow && cachedRow.s === s ? cachedRow.h : Math.round(BAND_ROW_H_PX * s),
			);
			const appsCount = Math.min(state.snapshot?.apps?.length ?? 0, config.maxApps);
			const bandRowsNeeded = Math.max(1, Math.min(LARGE_APP_ROWS_MAX, Math.ceil(appsCount / 2)));
			const bandH = bandRowsNeeded * bandRowH + (bandRowsNeeded - 1) * bandGap
				+ bandPadEdge * 2;
			const freeForChart = currentHeight - padTop - headerEstimate - headerMargin
				- xAxisZone - (legendMargin * 2 + legendH) - bandH;


			const chartZoneH = Math.max(90, freeForChart);
			chartWrap.set_height(chartZoneH + xAxisZone);
			chartWrap.style = `margin: 0 ${padSide}px;`;
			legendBox.style = `margin: ${legendMargin}px ${padSide}px;`;

			const plotWidth = Math.max(1, currentWidth - padSide * 2 - yWidth);
			Object.assign(state.geometry, {
				plotWidth,
				plotHeight: chartZoneH,
				largeChart: true,
				largeBarWidth: Math.min(12, Math.max(5, Math.round(plotWidth / HOURS_PER_DAY * 0.5))),
			});
			chartCanvas.set_position(0, 0);
			chartCanvas.set_size(plotWidth, chartZoneH);
			yAxisBox.set_position(plotWidth, 0);
			yAxisBox.set_size(yWidth, chartZoneH);
			xAxisBox.set_position(0, chartZoneH + Math.round(4 * s));
			xAxisBox.set_size(plotWidth, axisH);

			state.geometry.bandRows = bandRowsNeeded;



			state.geometry.listHeight = bandH;



			appsBand.style = `background-color: ${sideBg}; border-radius: 0 0 ${radius}px ${radius}px;`
				+ `padding: 0 ${padSide}px;`;

			renderDynamic();
			return;
		}

		const totalWidth = currentWidth;
		const mainWidth = Math.round(totalWidth * MAIN_PANEL_WIDTH_RATIO);
		leftPanel.set_width(mainWidth);
		rightPanel.set_width(totalWidth - mainWidth);






		splitBox.set_size(currentWidth, currentHeight);

		const padTop = Math.round(16 * s);
		const padBottom = Math.round(16 * s);
		const padLeft = Math.round(20 * s);
		const padRight = Math.round(12 * s);
		state.geometry.listHeight = Math.max(0, currentHeight - padTop - padBottom);


		leftPanel.style = `background-color: ${leftBg}; border-radius: ${radius}px 0 0 ${radius}px;`
			+ `padding: ${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;`;

		rightPanel.style = `background-color: ${sideBg}; border-radius: 0 ${radius}px ${radius}px 0;`
			+ `padding: ${padTop}px ${padLeft}px;`;

		headerBox.style = `margin-bottom: ${Math.round(12 * s)}px; padding-right: ${Math.round(5 * s)}px;`;
		totalTimeLabel.style = `color: ${textColor}; font-size: ${Math.round(HEADER_FONT_SIZE_PX * s)}px; font-weight: 600;`;

		prevButton.style = `width: ${Math.round(NAV_BUTTON_SIZE_PX * s)}px; height: ${Math.round(NAV_BUTTON_SIZE_PX * s)}px;`
			+ `border: 1px solid ${textRgba(0.14)}; border-radius: ${Math.round(6 * s)}px; background-color: transparent;`;
		nextButton.style = prevButton.style;

		if (config.showChart) {
			const chartWrapWidth = mainWidth - padLeft - padRight;



			const chartWrapHeight = currentHeight - padTop - padBottom
				- Math.round((HEADER_RESERVED_HEIGHT_PX + HEADER_MARGIN_BOTTOM_PX) * s);
			const plotWidth = Math.max(1, chartWrapWidth - Math.round(Y_AXIS_WIDTH_PX * s));
			const plotHeight = Math.max(1, chartWrapHeight - Math.round(X_AXIS_HEIGHT_PX * s));
			Object.assign(state.geometry, { plotWidth, plotHeight });

			chartCanvas.set_position(0, 0);
			chartCanvas.set_size(plotWidth, plotHeight);

			yAxisBox.set_position(plotWidth, 0);
			yAxisBox.set_size(Math.round(Y_AXIS_WIDTH_PX * s), plotHeight);

			xAxisBox.set_position(0, plotHeight + Math.round(4 * s));
			xAxisBox.set_size(plotWidth, Math.round(X_AXIS_HEIGHT_PX * s));
			xAxisBox.style = `margin-bottom: ${Math.round(6 * s)}px;`;
		}

		appRowsBox.style = `spacing: ${Math.round(14 * s)}px;`;

		renderDynamic();
	}









	const CLIP_INSET = (theme.borderWidth ?? 1);
	const actor = body.get_parent();
	const contentWidth = () => Math.max(1, (actor ? actor.width : widgetWidth) - CLIP_INSET * 2);
	const contentHeight = () => Math.max(1, (actor ? actor.height : widgetHeight) - CLIP_INSET * 2);

	applyLayout(contentWidth(), contentHeight());




	let disposed = false;
	let lastWidth = -1;
	let lastHeight = -1;
	let relayouting = false;
	let updateId = 0;
	const update = () => {
		if (disposed || !rootAlive || relayouting) return;



		const layoutDirty = state.geometry.layoutDirty === true;
		const currentWidth = contentWidth();
		const currentHeight = contentHeight();
		if (currentWidth === lastWidth && currentHeight === lastHeight && !layoutDirty) return;
		state.geometry.layoutDirty = false;
		lastWidth = currentWidth;
		lastHeight = currentHeight;
		relayouting = true;
		try {
			applyLayout(currentWidth, currentHeight);
		} finally {
			relayouting = false;
		}
	};





	function scheduleUpdate() {
		if (disposed) return;
		if (updateId) GLib.source_remove(updateId);
		updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
			updateId = 0;
			update();
			return GLib.SOURCE_REMOVE;
		});
	}

	body.connect('notify::width', scheduleUpdate);
	body.connect('notify::height', scheduleUpdate);



	if (actor) {
		actor.connect('notify::width', scheduleUpdate);
		actor.connect('notify::height', scheduleUpdate);
	}
	body.connect('destroy', () => {
		disposed = true;
		if (updateId) {
			GLib.source_remove(updateId);
			updateId = 0;
		};
	});





	root.connect('destroy', () => { rootAlive = false; });
	root.connect('destroy', cleanup);
	GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
		if (!disposed) {
			update();
		}
		return GLib.SOURCE_REMOVE;
	});








	if (lastSnapshot && lastSnapshotDate === state.selectedDate) {
		state.snapshot = lastSnapshot;
		renderDynamic();
	}

	refreshData();
}
