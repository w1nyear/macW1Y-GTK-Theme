import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import { warn } from '../../logger.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { boxLayoutProps } from '../../utils/gnomeCompat.js';
import { createPageIndicator, indicatorBandHeight } from '../../lib/pageIndicator.js';

const EXTENSION_PATH = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(import.meta.url.replace('file://', ''))));

export const type = 'weather';
export const label = 'Weather';
export const stylesheet = 'widgets/weather/stylesheet.css';
export const appIds = ['org.gnome.Weather.desktop'];
export const settingsSchema = 'org.gnome.Weather';
export const cacheTtlMs = 10 * 60 * 1000;
export const defaultSize = 'medium';
export const supportedSizes = ['small', 'medium', 'large', 'wide'];



log('[desktop-widgets] weather widget module imported (page-dots build)');

const HOUR_MS = 3600 * 1000;
const HOURS_AHEAD = 24;

const WEATHER_SWIPE_THRESHOLD = 30;
const WEATHER_FLIP_DURATION = 250;


let weatherCompactPage = 0;

export function style(theme) {



	return `background-color: ${theme.background}; border-color: ${theme.border}; color: ${theme.text}; border-radius: 16px; padding: 18px 18px 4px 18px;`;
};

export function locationNameFromSettings(settings) {
	const strings = locationStringsFromSettings(settings);

	return strings[0] || null;
};

function locationStringsFromSettings(settings) {
	if (!settings) {
		return [];
	};

	const locations = settings.get_value('locations');

	if (locations.n_children() === 0) {
		return [];
	};

	const serialized = locations.get_child_value(0).print(true);

	return [...serialized.matchAll(/'([^']*)'/g)].map(match => match[1]);
};

export function locationFromSettings(settings) {
	if (!settings) {
		return null;
	};

	try {
		const locations = settings.get_value('locations');

		return locations.n_children() > 0
			? GWeather.Location.get_world()?.deserialize(locations.get_child_value(0).deep_unpack()) ?? null
			: null;
	} catch (error) {
		warn('weather-location-deserialize', `Could not deserialize Weather app location: ${error.message}`);
		return null;
	};
};

export function infoForLocation(location) {
	const info = GWeather.Info.new(location);

	info.set_application_id('org.gnome.shell.extensions.desktop-widgets-r3nhick');
	info.set_contact_info('https://github.com/r3nhick/desktop-widgets');
	info.set_enabled_providers(
		GWeather.Provider.METAR |
		GWeather.Provider.MET_NO |
		GWeather.Provider.OWM);
	return info;
};

export function weatherFromInfo(info, location, displayName = null) {
	const currentInfo = currentConditionsInfo(info);
	const locationName = currentInfo.get_location_name();
	const apparent = formatTemperature(currentInfo.get_apparent());
	const {hourly, daily} = forecastSeries(info, Date.now());

	return {
		temp: formatTemperature(currentInfo.get_temp()),
		summary: cleanSummary(currentInfo.get_weather_summary(), locationName),
		location: location.get_city_name() || displayName || locationName,
		icon: currentInfo.get_icon_name() || 'weather-clear',
		feelsLike: apparent && apparent !== '--' ? `${_('It feels like')} ${apparent}` : null,
		hourly,
		daily,
	};
};

function currentConditionsInfo(info) {
	return formatTemperature(info.get_temp()) !== '--' ? info : currentForecastInfo(info);
};

function forecastUpdateTime(info) {
	const [ok, updateTime] = info.get_value_update();

	return ok ? updateTime : null;
};

function currentForecastInfo(info) {
	const forecasts = info.get_forecast_list() ?? [];
	const now = Math.floor(Date.now() / 1000);
	let bestPast = null;
	let bestFuture = null;

	for (const forecast of forecasts) {
		const updateTime = forecastUpdateTime(forecast);
		const temp = formatTemperature(forecast.get_temp());

		if (updateTime === null || temp === '--') {
			continue;
		};

		if (updateTime <= now && (!bestPast || updateTime > bestPast.updateTime)) {
			bestPast = {forecast, updateTime};
		} else if (updateTime > now && (!bestFuture || updateTime < bestFuture.updateTime)) {
			bestFuture = {forecast, updateTime};
		};
	};

	return bestPast?.forecast ?? bestFuture?.forecast ?? info;
};

function forecastSeries(info, nowMs) {
	const list = info.get_forecast_list() ?? [];
	const hourly = [];
	const dayMap = new Map();
	const todayStart = todayStartMs(nowMs);
	const horizon = nowMs + HOURS_AHEAD * HOUR_MS;

	for (const forecast of list) {
		const updateTime = forecastUpdateTime(forecast);

		if (updateTime === null) {
			continue;
		};

		const timeMs = updateTime * 1000;
		const date = new Date(timeMs);
		const hour = date.getHours();
		const minute = date.getMinutes();
		const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		const maxN = tempNumber(formatTemperature(forecast.get_temp_max?.()));
		const minN = tempNumber(formatTemperature(forecast.get_temp_min?.()));
		const tempN = tempNumber(formatTemperature(forecast.get_temp?.()));
		const dayKey = dayStart;

		if (!dayMap.has(dayKey)) {
			const isToday = dayStart === todayStart;

			dayMap.set(dayKey, {
				time: dayStart,
				day: isToday ? _('Today') : date.toLocaleDateString(undefined, {weekday: 'short'}),
				icon: forecastSymbolicIcon(forecast),
				maxN: null,
				minN: null,
			});
		};

		const entry = dayMap.get(dayKey);
		const dayHigh = maxN !== null ? maxN : tempN;
		const dayLow = minN !== null ? minN : tempN;

		if (dayHigh !== null && (entry.maxN === null || dayHigh > entry.maxN)) {
			entry.maxN = dayHigh;
		};

		if (dayLow !== null && (entry.minN === null || dayLow < entry.minN)) {
			entry.minN = dayLow;
		};

		if (hour === 0 && minute === 0) {
			entry.icon = forecastSymbolicIcon(forecast);
		};

		if (timeMs >= nowMs && timeMs <= horizon && tempN !== null) {
			hourly.push({
				time: timeMs,
				label: date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'}),
				icon: forecastSymbolicIcon(forecast),
				temp: formatTemperature(tempN),
			});
		};
	};

	const daily = [...dayMap.values()]
		.filter(day => day.time >= todayStart && day.maxN !== null)
		.sort((a, b) => a.time - b.time)
		.map(day => ({
			time: day.time,
			day: day.day,
			icon: day.icon,
			high: formatTemperature(day.maxN),
			low: formatTemperature(day.minN),
		}));

	hourly.sort((a, b) => a.time - b.time);

	return {
		hourly: sampleHourly(hourly),
		daily,
	};
};

function todayStartMs(nowMs) {
	const start = new Date(nowMs);

	start.setHours(0, 0, 0, 0);
	return start.getTime();
};

function forecastSymbolicIcon(forecast) {
	return String(forecast.get_symbolic_icon_name?.() ?? forecast.get_icon_name?.() ?? 'weather-clear');
};

function sampleHourly(hourly) {
	const sampled = [];
	let lastTime = -Infinity;

	for (const item of hourly) {
		if (item.temp === '--') {
			continue;
		};

		if (item.time - lastTime < 3 * HOUR_MS) {
			continue;
		};

		sampled.push(item);
		lastTime = item.time;

		if (sampled.length >= 6) {
			break;
		};
	};

	return sampled;
};

function formatTemperature(temperature) {
	const text = String(temperature ?? '--').trim();
	const match = text.match(/-?\d+(?:[.,]\d+)?/);

	if (!match) {
		return '--';
	};

	const value = Number(match[0].replace(',', '.'));

	return Number.isFinite(value) ? `${Math.round(value)}°` : '--';
};



function measureLabelWidth(text, fontPx, weight) {
	const label = new St.Label({
		text: String(text ?? ''),
		style: `font-size: ${fontPx}px; font-weight: ${weight};`,
	});
	const [, natural] = label.get_preferred_width(-1);
	label.destroy();
	return natural;
};

function cleanSummary(summary, locationName) {
	if (!summary) {
		return _('Weather unavailable');
	};

	if (locationName && summary.startsWith(`${locationName}: `)) {
		return summary.slice(locationName.length + 2);
	};

	const separator = summary.indexOf(': ');

	return separator >= 0 ? summary.slice(separator + 2) : summary;
};

function fallbackIcon(text) {
	const lower = String(text || '').toLowerCase();

	if (lower.includes('thunder') || lower.includes('storm')) {
		return 'weather-storm';
	};
	if (lower.includes('snow') || lower.includes('ice')) {
		return 'weather-snow';
	};
	if (lower.includes('rain') || lower.includes('shower') || lower.includes('drizzle')) {
		return 'weather-showers';
	};
	if (lower.includes('fog') || lower.includes('mist') || lower.includes('haze')) {
		return 'weather-fog';
	};
	if (lower.includes('cloud') || lower.includes('overcast')) {
		return 'weather-few-clouds';
	};

	return 'weather-clear';
};

function fullColorWeatherIcon(iconName) {
	const baseName = String(iconName || 'weather-clear')
		.replace(/-symbolic$/, '')
		.replace(/-(small|large)$/, '');
	const candidates = [
		`${baseName}-large.svg`,
		`${baseName}-small.svg`,
		`${baseName}.svg`,
	];

	for (const candidate of candidates) {
		const path = GLib.build_filenamev(['/usr/share/icons/hicolor/scalable/status', candidate]);
		const file = Gio.File.new_for_path(path);

		if (file.query_exists(null)) {
			return Gio.FileIcon.new(file);
		};
	};

	return null;
};

function symbolicIconName(iconName) {
	const base = String(iconName || 'weather-clear').replace(/-symbolic$/, '');

	return `${base}-symbolic`;
};

function scaledFont(base, scale) {
	return Math.max(1, Math.round(base * scale));
};

function smallWeatherIcon(iconName, styleClass, theme, sizePx) {
	return new St.Icon({
		style_class: styleClass,
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		icon_name: symbolicIconName(iconName),
		style: `icon-size: ${sizePx}px; color: ${theme.text};`,
	});
};

function buildHourlyStrip(hours, theme, createLabel, stripScale, cellCount, opts = {}) {
	const timeFontBase = opts.timeFont ?? 11;
	const timeWeight = opts.timeWeight ?? 600;
	const iconSizeBase = opts.iconSize ?? 15;
	const tempFontBase = opts.tempFont ?? 13;
	const tempWeight = opts.tempWeight ?? 700;
	const timeColor = opts.timeColor ?? theme.muted;
	const spacing = opts.spacing ?? 6;
	const strip = new St.BoxLayout(boxLayoutProps({
		style_class: 'widget-weather-hourly',
		x_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		style: `spacing: ${Math.round(spacing * stripScale)}px;`,
	}));

	for (let index = 0; index < cellCount; index++) {
		const hour = hours[index];
		const cell = new St.BoxLayout(boxLayoutProps({
			vertical: true,
			style_class: 'widget-weather-hour',
			x_expand: true,
			y_align: Clutter.ActorAlign.CENTER,
		}));

		const timeLabel = createLabel(
			hour ? hour.label : '',
			'widget-weather-hour-time',
			`color: ${timeColor}; font-size: ${scaledFont(timeFontBase, stripScale)}px; font-weight: ${timeWeight}; text-align: center;`);

		timeLabel.x_align = Clutter.ActorAlign.CENTER;
		cell.add_child(timeLabel);
		cell.add_child(smallWeatherIcon(hour ? hour.icon : null, 'widget-weather-hour-icon', theme, scaledFont(iconSizeBase, stripScale)));

		const tempLabel = createLabel(
			hour ? hour.temp : '',
			'widget-weather-hour-temp',
			`color: ${theme.text}; font-size: ${scaledFont(tempFontBase, stripScale)}px; font-weight: ${tempWeight}; text-align: center;`);

		tempLabel.x_align = Clutter.ActorAlign.CENTER;
		cell.add_child(tempLabel);

		strip.add_child(cell);
	};

	return strip;
};

function tempNumber(value) {
	const match = String(value ?? '').match(/-?\d+(?:[.,]\d+)?/);

	return match ? Number(match[0].replace(',', '.')) : null;
};

function temperatureRange(daily, theme, createLabel, scale, size = 11, weight = 400, color) {
	const today = daily[0];

	if (!today) {
		return null;
	};

	const high = tempNumber(today.high);
	const low = tempNumber(today.low);

	if (high === null || low === null) {
		return null;
	};

	return createLabel(
		_('H:%s L:%s').format(today.high, today.low),
		'widget-weather-range',
		`color: ${color ?? theme.muted}; font-size: ${scaledFont(size, scale)}px; font-weight: ${weight};`);
};

function buildHeader(rendered, theme, createLabel, scale, opts = {}) {

	const tempColor = opts.tempColor ?? theme.text;
	const cityFont = opts.cityFont ?? 17;
	const cityWeight = opts.cityWeight ?? 800;
	const tempFont = opts.tempFont ?? 38;
	const tempWeight = opts.tempWeight ?? 400;
	const condFont = opts.condFont ?? 13;
	const condWeight = opts.condWeight ?? 700;
	const condIcon = opts.condIcon ?? false;
	const condIconSize = opts.condIconSize ?? 16;
	const left = new St.BoxLayout(boxLayoutProps({
		vertical: true,
		x_align: Clutter.ActorAlign.START,
		style: 'spacing: 0px;',
	}));


	const cityRow = new St.BoxLayout(boxLayoutProps({
		vertical: false,
		x_align: Clutter.ActorAlign.START,
		style: 'spacing: 6px;',
	}));

	cityRow.add_child(createLabel(
		rendered.location,
		'widget-weather-city',
		`color: ${theme.text}; font-size: ${scaledFont(cityFont, scale)}px; font-weight: ${cityWeight};`));


	const iconName = theme.dark ? 'navigation-white' : 'navigation-black';
	const iconPath = `${EXTENSION_PATH}/icons/widgets_settings/weather/${iconName}.svg`;
	const iconFile = Gio.File.new_for_path(iconPath);

	if (iconFile.query_exists(null)) {
		const navIcon = new St.Icon({
			gicon: Gio.icon_new_for_string(iconPath),
			icon_size: scaledFont(14, scale),
			y_align: Clutter.ActorAlign.START,
			style: `margin-top: ${scaledFont(1, scale)}px;`,
		});
		cityRow.add_child(navIcon);
	}

	left.add_child(cityRow);

	left.add_child(createLabel(
		rendered.temp,
		'widget-weather-temp-main',
		`color: ${tempColor}; font-size: ${scaledFont(tempFont, scale)}px; font-weight: ${tempWeight};`));

	const right = new St.BoxLayout(boxLayoutProps({
		vertical: true,
		x_align: Clutter.ActorAlign.END,
		y_align: Clutter.ActorAlign.START,
		style: 'spacing: 0px;',
	}));

	if (condIcon) {
		const iconParams = {
			style_class: 'widget-weather-condition-icon',
			style: `icon-size: ${scaledFont(condIconSize, scale)}px; icon-shadow: 0 2px 4px rgba(0, 0, 0, 0.42);`,
			x_align: Clutter.ActorAlign.END,
			y_align: Clutter.ActorAlign.CENTER,
		};
		const gicon = fullColorWeatherIcon(rendered.icon);

		if (gicon) {
			iconParams.gicon = gicon;
		} else {
			iconParams.icon_name = rendered.icon;
		};

		right.add_child(new St.Icon(iconParams));
	};

	const condRow = new St.BoxLayout(boxLayoutProps({
		x_align: Clutter.ActorAlign.END,
		y_align: Clutter.ActorAlign.CENTER,
		style: 'spacing: 4px;',
	}));

	condRow.add_child(createLabel(
		rendered.summary,
		'widget-weather-condition',
		`color: ${theme.text}; font-size: ${scaledFont(condFont, scale)}px; font-weight: ${condWeight};`));


	const range = temperatureRange(rendered.daily, theme, createLabel, scale, condFont - 1, 600);

	right.add_child(condRow);
	if (range) {
		range.x_align = Clutter.ActorAlign.END;
		right.add_child(range);
	};






	const header = new St.BoxLayout(boxLayoutProps({
		style_class: 'widget-weather-header',
		x_expand: true,
		y_align: Clutter.ActorAlign.START,
		style: 'spacing: 8px;',
	}));

	if (opts.equalColumnWidth) {
		left.set_width(opts.equalColumnWidth);
		right.set_width(opts.equalColumnWidth);
	};

	header.add_child(left);
	if (!opts.equalColumnWidth) {
		header.add_child(new St.Widget({x_expand: true}));
	};
	header.add_child(right);
	return header;
};

function buildTempBar(day, allDays, trackWidth = 110) {
	const trackHeight = 3;
	const lows = allDays.map(d => tempNumber(d.low));
	const highs = allDays.map(d => tempNumber(d.high));
	const min = Math.min(...lows.filter(n => n !== null));
	const max = Math.max(...highs.filter(n => n !== null));
	const low = tempNumber(day.low);
	const high = tempNumber(day.high);
	const span = max - min;

	let start = 0.15;
	let width = 0.55;

	if (Number.isFinite(span) && span > 0 && low !== null && high !== null) {
		start = (low - min) / span;
		width = (high - low) / span;
	};

	start = Math.max(0, Math.min(0.92, start));
	width = Math.max(0.08, Math.min(1 - start, width));

	const track = new St.BoxLayout(boxLayoutProps({
		style: `width: ${trackWidth}px; height: ${trackHeight}px; background-color: rgba(255, 255, 255, 0.12); border-radius: 2px;`,
		x_align: Clutter.ActorAlign.START,
		x_expand: false,
	}));

	track.set_size(trackWidth, trackHeight);

	const offset = Math.round(trackWidth * start);
	const fillWidth = Math.max(3, Math.round(trackWidth * width));

	if (offset > 0) {
		const spacer = new St.Widget({x_expand: false});
		spacer.set_size(offset, trackHeight);
		track.add_child(spacer);
	};

	const fill = new St.Widget({
		style: `width: ${fillWidth}px; height: ${trackHeight}px; background-gradient-direction: horizontal; background-gradient-start: #30b0c7; background-gradient-end: #ffd60a; border-radius: 2px;`,
		x_expand: false,
	});

	fill.set_size(fillWidth, trackHeight);
	track.add_child(fill);
	return track;
};

function buildWeekList(days, theme, createLabel, scale, barWidth = 110, fill = false) {
	const list = new St.BoxLayout(boxLayoutProps({
		vertical: true,
		style_class: 'widget-weather-week',
		style: `spacing: ${Math.round(4 * scale)}px;`,
		clip_to_allocation: true,
	}));




	if (fill) {
		list.y_expand = true;
	};

	for (const day of days) {
		const row = new St.BoxLayout(boxLayoutProps({
			style_class: 'widget-weather-day-row',
			x_expand: true,
			x_align: Clutter.ActorAlign.FILL,
			y_align: Clutter.ActorAlign.CENTER,
			style: `spacing: ${Math.round(4 * scale)}px;`,
		}));



		if (fill) {
			row.y_expand = true;
		};
		const name = createLabel(
			day.day,
			'widget-weather-day-name',
			`color: ${theme.text}; font-size: ${scaledFont(14, scale)}px; font-weight: 500; width: ${Math.round(56 * scale)}px;`);

		name.x_expand = false;
		name.clutter_text.set_line_wrap(false);
		name.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
		row.add_child(name);
		row.add_child(smallWeatherIcon(day.icon, 'widget-weather-day-icon', theme, scaledFont(20, scale)));

		const low = createLabel(
			day.low,
			'widget-weather-day-temps widget-weather-day-low',
			`color: ${theme.muted}; font-size: ${scaledFont(16, scale)}px; font-weight: 400; text-align: right; width: ${Math.round(30 * scale)}px;`);

		low.x_expand = false;
		row.add_child(low);
		row.add_child(buildTempBar(day, days, barWidth));

		const high = createLabel(
			day.high,
			'widget-weather-day-temps widget-weather-day-high',
			`color: ${theme.text}; font-size: ${scaledFont(16, scale)}px; font-weight: 600; text-align: right; width: ${Math.round(30 * scale)}px;`);

		high.x_expand = false;
		row.add_child(high);
		list.add_child(row);
	};

	return list;
};

function stripDivider() {
	return new St.Widget({
		x_expand: true,
		style: 'height: 1px; min-height: 1px; background-color: rgba(255, 255, 255, 0.12); margin-top: 4px; margin-bottom: 2px;',
	});
};




function buildCompactRegime(body, rendered, theme, createLabel, scale, tempColor, settings) {




	const cityRow = new St.BoxLayout(boxLayoutProps({
		vertical: false,
		x_align: Clutter.ActorAlign.START,
		style: 'spacing: 5px;',
	}));

	cityRow.add_child(createLabel(
		rendered.location,
		'widget-weather-city',
		`color: ${theme.text}; font-size: ${scaledFont(16, scale)}px; font-weight: 800;`));


	const iconName = theme.dark ? 'navigation-white' : 'navigation-black';
	const iconPath = `${EXTENSION_PATH}/icons/widgets_settings/weather/${iconName}.svg`;
	const iconFile = Gio.File.new_for_path(iconPath);

	if (iconFile.query_exists(null)) {
		const navIcon = new St.Icon({
			gicon: Gio.icon_new_for_string(iconPath),
			icon_size: scaledFont(12, scale),


			y_align: Clutter.ActorAlign.CENTER,
		});
		cityRow.add_child(navIcon);
	}

	body.add_child(cityRow);








	const tempFont = Math.min(scaledFont(48, scale), 56);
	const tint = tempColor ?? theme.accent;

	const tempRow = new St.BoxLayout(boxLayoutProps({
		vertical: false,
		x_align: Clutter.ActorAlign.START,
		style: 'spacing: 1px;',
	}));

	const digitsLabel = createLabel(
		String(rendered.temp ?? '--').replace('°', ''),
		'widget-weather-temp-main',
		`color: ${tint}; font-size: ${tempFont}px; font-weight: 600;`);
	const degFont = Math.max(11, Math.min(Math.round(tempFont * 0.5), 30));
	const degLabel = createLabel(
		'°',
		'widget-weather-temp-degree',
		`color: ${tint}; font-size: ${degFont}px; font-weight: 600;`);



	digitsLabel.x_expand = false;
	degLabel.x_expand = false;


	degLabel.y_align = Clutter.ActorAlign.START;

	tempRow.add_child(digitsLabel);
	tempRow.add_child(degLabel);
	body.add_child(tempRow);







	body.add_child(new St.Widget({y_expand: true}));

	const bottom = new St.BoxLayout(boxLayoutProps({
		vertical: true,
		x_align: Clutter.ActorAlign.START,


		style: `spacing: 2px;`,
	}));
	const iconParams = {
		style_class: 'widget-weather-icon',
		style: `icon-size: ${scaledFont(24, scale)}px; icon-shadow: 0 2px 4px rgba(0, 0, 0, 0.42);`,
		x_align: Clutter.ActorAlign.START,
		y_align: Clutter.ActorAlign.CENTER,
	};
	const gicon = fullColorWeatherIcon(rendered.icon);

	if (gicon) {
		iconParams.gicon = gicon;
	} else {
		iconParams.icon_name = rendered.icon;
	};

	bottom.add_child(new St.Icon(iconParams));
	bottom.add_child(createLabel(
		rendered.summary,
		'widget-weather-summary',
		`color: ${theme.text}; font-size: ${scaledFont(13, scale)}px; font-weight: 600;`));




	const range = temperatureRange(rendered.daily, theme, createLabel, scale, 13, 600, theme.text);

	if (range) {
		bottom.add_child(range);
	};








	body.add_child(bottom);
	body.add_child(new St.Widget({y_expand: true}));
	body.add_child(new St.Widget({
		width: 1,
		height: indicatorBandHeight(settings),
	}));
};

export function render({body, widget, createLabel, theme, weather, weatherLocation, sizeForWidget, settings}) {


	const useAccentColor = settings?.get_boolean('weather-use-accent-color') ?? true;
	const tempColor = useAccentColor ? theme.accent : theme.text;
	const detail = widget.data.detail || _('Weather unavailable');
	const renderedWeather = weather ?? {
		temp: formatTemperature(String(detail).split(/\s+/)[0] || '--'),
		summary: String(detail).replace(/^\S+\s*/, '') || _('Open Weather to set a location'),
		location: weatherLocation || widget.data.location || _('GNOME Weather'),
		icon: fallbackIcon(detail),
		feelsLike: null,
		hourly: [],
		daily: [],
	};
	const [widgetWidth, widgetHeight] = sizeForWidget(widget);





	const large = widgetWidth >= 340 && widgetHeight >= 340;
	const wide = widgetWidth >= 340 && !large;



	const equalColumnWidth = Math.floor((widgetWidth - 38 - 8) / 2);



	const scale = Math.max(1, Math.min(1.6, widgetWidth / 360));
	const compactScale = large || wide ? 1 : Math.max(0.9, Math.min(1.6, Math.min(widgetWidth, widgetHeight) / 170));

	if (!wide && !large) {









		// follows the global page-indicator-style, the color is the accent


		const pages = [];

		const conditionsPage = new St.BoxLayout(boxLayoutProps({
			vertical: true,
			x_expand: true,
			y_expand: true,
		}));
		buildCompactRegime(conditionsPage, renderedWeather, theme, createLabel, compactScale, tempColor, settings);
		pages.push(conditionsPage);

		const hoursPage = new St.BoxLayout(boxLayoutProps({
			vertical: true,
			x_expand: true,
			y_expand: true,
		}));
		const hourly = renderedWeather.hourly ?? [];
		if (hourly.length > 0) {



			const rowIndexes = [0, 2];
			const hoursGrid = new St.BoxLayout(boxLayoutProps({
				vertical: true,
				x_expand: true,
				x_align: Clutter.ActorAlign.FILL,
				style: `spacing: ${Math.round(8 * compactScale)}px;`,
			}));

			rowIndexes.forEach(rowIndex => {
				const rowHours = hourly.slice(rowIndex, rowIndex + 2);

				if (rowHours.length === 0) {
					return;
				};

				hoursGrid.add_child(buildHourlyStrip(rowHours, theme, createLabel, compactScale, 2, {
					timeFont: 10,
					timeWeight: 700,
					iconSize: 26,
					tempFont: 15,
					tempWeight: 700,
					timeColor: theme.muted,
				}));
			});










			hoursPage.add_child(new St.Widget({y_expand: true}));
			hoursPage.add_child(hoursGrid);
			hoursPage.add_child(new St.Widget({y_expand: true}));
			hoursPage.add_child(new St.Widget({
				width: 1,
				height: indicatorBandHeight(settings),
			}));
		} else {

			const emptyLabel = createLabel(
				_('No forecast'),
				'widget-weather-hours-empty',
				`color: ${theme.muted}; font-size: 12px; font-weight: 600;`);
			emptyLabel.x_align = Clutter.ActorAlign.CENTER;

			hoursPage.add_child(new St.Widget({y_expand: true}));
			hoursPage.add_child(emptyLabel);
			hoursPage.add_child(new St.Widget({y_expand: true}));
		}
		pages.push(hoursPage);
		pages.forEach(page => {
			page.x_align = Clutter.ActorAlign.FILL;
			page.y_align = Clutter.ActorAlign.FILL;
		});

		// dash/dot follows the global page-indicator-style,




		const indicatorColor = settings?.get_boolean('weather-page-indicator-accent') ?? true
			? (theme?.accent ?? theme.text)
			: theme.text;
		const indicator = createPageIndicator({settings, count: pages.length, color: indicatorColor});

		const pageStack = new St.Widget({
			layout_manager: new Clutter.BinLayout(),
			x_expand: true,
			y_expand: true,
			clip_to_allocation: true,
		});
		pageStack.add_child(pages[weatherCompactPage]);











		pageStack.add_child(indicator.wrap);

		body.add_child(pageStack);



		const refreshDots = () => indicator.refresh(weatherCompactPage);
		refreshDots();



		const stackLifetime = {alive: true};
		const pageLifetimes = pages.map(page => {
			const lifetime = {alive: true};
			page.connect('destroy', () => { lifetime.alive = false; });
			return lifetime;
		});
		pageStack.connect('destroy', () => { stackLifetime.alive = false; });


		let swipeStartX = null;
		let swipeBusy = false;
		pageStack.reactive = true;
		pageStack.connect('button-press-event', (actor, event) => {
			if (event.get_button() !== 3) return Clutter.EVENT_PROPAGATE;
			swipeStartX = event.get_coords()[0];
			return Clutter.EVENT_PROPAGATE;
		});
		pageStack.connect('button-release-event', (actor, event) => {
			if (swipeStartX === null) return Clutter.EVENT_PROPAGATE;
			const startX = swipeStartX;
			swipeStartX = null;
			const delta = event.get_coords()[0] - startX;

			if (Math.abs(delta) < WEATHER_SWIPE_THRESHOLD || swipeBusy)
				return Clutter.EVENT_STOP;

			swipeBusy = true;
			const leavingPage = weatherCompactPage;
			const leaving = pages[leavingPage];
			const exitX = delta < 0 ? -widgetWidth : widgetWidth;


			leaving.ease({
				opacity: 0,
				translation_x: exitX,
				duration: WEATHER_FLIP_DURATION,
				mode: Clutter.AnimationMode.EASE_IN_QUAD,
				onComplete: () => {
					if (pageLifetimes[leavingPage].alive && leaving.get_parent()) {
						leaving.get_parent().remove_child(leaving);
					};
				},
			});


			weatherCompactPage = 1 - weatherCompactPage;
			refreshDots();



			GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(WEATHER_FLIP_DURATION / 2), () => {
				swipeBusy = false;
				if (!stackLifetime.alive || !pageLifetimes[weatherCompactPage].alive)
					return GLib.SOURCE_REMOVE;

				const entering = pages[weatherCompactPage];
				entering.translation_x = -exitX;
				entering.opacity = 0;
				pageStack.add_child(entering);
				entering.ease({
					opacity: 255,
					translation_x: 0,
					duration: WEATHER_FLIP_DURATION,
					mode: Clutter.AnimationMode.EASE_OUT_QUAD,
				});
				return GLib.SOURCE_REMOVE;
			});
			return Clutter.EVENT_STOP;
		});
		return;
	};

	const hourly = renderedWeather.hourly;


	const stripTimeFont = large ? 12 : 10;
	const stripTimeWeight = large ? 700 : 800;
	const widestHourTime = hourly.slice(0, 6).reduce(
		(maxW, item) => Math.max(maxW, item ? measureLabelWidth(item.label, scaledFont(stripTimeFont, scale), stripTimeWeight) : 0),
		0);
	const hourCellWidth = Math.max(Math.round(52 * scale), widestHourTime + Math.round(8 * scale));
	const hourCount = Math.min(6, Math.max(4, Math.floor((widgetWidth - Math.round(40 * scale)) / hourCellWidth)), hourly.length || 0);

	if (large) {
		body.add_child(buildHeader(renderedWeather, theme, createLabel, scale, {
			cityFont: 17,
			cityWeight: 800,
			tempFont: 38,
			tempWeight: 600,
			tempColor,
			condFont: 13,
			condWeight: 800,
			condIcon: true,
			condIconSize: 16,
		}));

		if (hourly.length > 0 && hourCount >= 4) {
			body.add_child(stripDivider());
			body.add_child(buildHourlyStrip(hourly, theme, createLabel, scale, hourCount, {
				timeFont: 12,
				timeWeight: 700,
				iconSize: 24,
				tempFont: 14,
				tempWeight: 700,
				timeColor: theme.muted,
			}));
		};

		if (renderedWeather.daily.length > 0) {
			const stripContentH = Math.round((12 + 24 + 14 + 16) * scale);
			const headerH = Math.round((17 + 2 + 38) * scale);
			const availableH = Math.max(1, widgetHeight - Math.round(20 * scale) - headerH - stripContentH - (hourCount >= 4 ? Math.round(12 * scale) : 0) - Math.round(4 * scale));




			const wideLayout = widgetWidth >= widgetHeight * 1.6;
			let targetDays = Math.min(5, renderedWeather.daily.length);
			if (!wideLayout) {
				const maxDays = Math.min(8, renderedWeather.daily.length);
				for (let n = targetDays + 1; n <= maxDays; n++) {
					if (availableH / (n * 20 + (n - 1) * 4) >= 0.6)
						targetDays = n;
					else
						break;
				};
			};
			const days = renderedWeather.daily.slice(0, targetDays);
			const weeklyScale = Math.max(0.6, Math.min(scale, availableH / (targetDays * 20 + (targetDays - 1) * 4)));
			const rowSpacing = Math.round(6 * weeklyScale);
			const rowWidths = Math.round(56 * weeklyScale) + Math.round(20 * weeklyScale) + Math.round(30 * weeklyScale) + Math.round(30 * weeklyScale) + rowSpacing * 4;
			const barWidth = Math.max(60, widgetWidth - Math.round(36 * weeklyScale) - rowWidths);

			if (days.length > 0) {
				body.add_child(stripDivider());
				body.add_child(buildWeekList(days, theme, createLabel, weeklyScale, barWidth, true));
			};
		} else {


			body.add_child(new St.Widget({y_expand: true}));
		};
		return;
	};



	body.add_child(buildHeader(renderedWeather, theme, createLabel, scale, {
		cityFont: 17,
		cityWeight: 800,
		tempFont: 34,
		tempWeight: 600,
		tempColor,
		condFont: 14,
		condWeight: 700,
		condIcon: true,
		condIconSize: 16,
		equalColumnWidth,
	}));

	if (!(hourly.length > 0 && hourCount >= 4)) {
		body.add_child(new St.Widget({y_expand: true}));
		return;
	};

	body.add_child(new St.Widget({y_expand: true}));
	body.add_child(buildHourlyStrip(hourly, theme, createLabel, scale, hourCount, {
		timeFont: 12,
		timeWeight: 800,
		iconSize: 26,
		tempFont: 18,
		tempWeight: 700,
		timeColor: theme.muted,
	}));
};
