


















import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { boxLayoutProps } from '../utils/gnomeCompat.js';
import { MAX_STACK_PAGES } from '../lib/widgetTypes.js';
import { LiquidGlass } from '../lib/glass_v4.js?v=fix5';


const SWIPE_THRESHOLD = 12;
const ANIMATION_DURATION = 250;
const CROSS_DURATION = Math.round(ANIMATION_DURATION * 2);

const RAIL_HEIGHT = 48;

function newPageKey() {
	return Math.random().toString(36).slice(2, 9);
};




export function makeStackEntry(type, size = null) {
	return {type, key: newPageKey(), data: {}, size: size ?? null};
};

export function attachWidgetStack({
	paneRoot,
	baseActor,
	widget,
	theme,
	styleForEntry = null,
	wantsGlassEntry = null,
	glassParams = null,
	startPage = 0,
	renderPage,
	pageSizeFor = null,
	isEditMode = () => false,
	onStateSaved = () => {},
	onPageChange = () => {},
}) {
	console.log(`[ATTACH-STACK] Called for widget=${widget.type} id=${widget.id} hasStack=${!!widget.stack} stackLength=${widget.stack?.length ?? 0}`);
	const entries = Array.isArray(widget.stack)
		? widget.stack.filter(entry => entry && entry.type).slice(0, MAX_STACK_PAGES)
		: [];
	console.log(`[ATTACH-STACK] Filtered entries: ${entries.length}`);






	entries.sort((a, b) => {
		const aSide = a.side === 'above' ? 0 : 1;
		const bSide = b.side === 'above' ? 0 : 1;
		return aSide - bSide;
	});


	if (entries.length === 0) {
		console.log(`[ATTACH-STACK] No entries, returning empty prism`);
		return {dispose() {}, refresh() {}, restyle() {}, updateGlassGeometry() {}};
	};
	console.log(`[ATTACH-STACK] Building pages for ${entries.length} entries...`);

	const pageW = Math.max(1, Math.floor(baseActor.get_width()) || 200);
	const pageH = Math.max(1, Math.floor(baseActor.get_height()) || 200);
	const baseDistance = () => pageH + Math.round(pageH / 16);

	let disposed = false;
	let crossBusy = false;



	let active = Math.max(0, startPage);






	paneRoot.clip_to_allocation = true;
	paneRoot.set_clip(0, 0, pageW, pageH);

	const pages = [{actor: baseActor, entry: null}];









	const updatePageGlassGeometry = (page) => {
		const glass = page.glass;

		if (!glass || glass.is_finalized?.()) {
			return;
		};

		const card = page.cardActor;

		if (!card || card.is_finalized?.()) {
			return;
		};

		const [x, y] = card.get_transformed_position();
		const [w, h] = card.get_size();

		if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) {
			return;
		};

		glass.setGeometry(x, y, w, h);
	};

	const attachPageGlass = (page) => {


		const want = wantsGlassEntry ? wantsGlassEntry(page.entry) : false;

		if (want && !page.glass) {
			const glass = new LiquidGlass();
			const card = page.cardActor;
			const [w, h] = card.get_size();

			glass.set_size(w, h);
			page.actor.insert_child_at_index(glass, 0);
			page.glass = glass;

			if (glassParams) {
				glass.setParams(glassParams());
			};

			updatePageGlassGeometry(page);
		} else if (!want && page.glass) {
			const glass = page.glass;

			page.glass = null;

			if (!glass.is_finalized?.()) {
				glass.destroy();
			};
		};


		if (page.glass) {
			updatePageGlassGeometry(page);
		};
	};

	const updateGlassGeometry = () => {
		for (let i = 1; i < pages.length; i += 1) {
			updatePageGlassGeometry(pages[i]);
		};
	};




	const restyle = () => {
		for (let i = 1; i < pages.length; i += 1) {
			const page = pages[i];

			if (page.actor.is_finalized?.()) {
				continue;
			};

			if (styleForEntry) {
				const style = styleForEntry(page.entry);

				if (style) {
					page.cardActor.set_style(style);
				};
			};

			attachPageGlass(page);

			if (page.glass && glassParams) {
				page.glass.setParams(glassParams());
			};
		};

		updateGlassGeometry();
	};

	const buildPage = (entry) => {


		const [cardW, cardH] = (pageSizeFor?.(entry.size || widget.size))
			?? [pageW, pageH];

		const pageActor = new St.Widget({
			layout_manager: new Clutter.FixedLayout(),
			reactive: true,
			width: pageW,
			height: pageH,
			style: `border-radius: ${theme?.radius ?? 16}px; overflow: hidden;`,
		});






		const cardSize = entry.size || widget.size || 'default';
		const cardActor = new St.BoxLayout(boxLayoutProps({
			vertical: true,
			style_class: `widget widget-${entry.type} widget-${entry.type}-${cardSize}`,
			style: styleForEntry
				? (styleForEntry(entry) ?? '')
				: `background-color: ${theme.background};`
					+ ` border-style: solid;`
					+ ` border-width: ${theme.borderWidth}px;`
					+ ` border-color: ${theme.border};`
					+ ` border-radius: ${theme.radius}px;`,
			reactive: true,
			can_focus: true,
			track_hover: true,
		}));
		cardActor.set_size(cardW, cardH);
		cardActor.set_position(Math.round((pageW - cardW) / 2), Math.round((pageH - cardH) / 2));
		pageActor.add_child(cardActor);




		const record = {
			id: `${widget.id}-s-${entry.key}`,
			type: entry.type,


			size: entry.size || widget.size,
			data: entry.data && typeof entry.data === 'object' ? entry.data : (entry.data = {}),
			pinned: true,
		};




		const page = {actor: pageActor, cardActor, record, entry, glass: null};
		attachPageGlass(page);



		pageActor.connectObject('notify::allocation', () => updatePageGlassGeometry(page), pageActor);

		const body = new St.BoxLayout(boxLayoutProps({
			vertical: true,
			style_class: 'widget-body',
			x_expand: true,
			y_expand: true,
			clip_to_allocation: true,
		}));
		cardActor.add_child(body);

		console.log(`[STACK-RENDER] Rendering page: type=${entry.type} recordId=${record.id} body=${!!body} cardActor=${!!cardActor}`);
		try {
			renderPage(record, body, cardActor);
			console.log(`[STACK-RENDER] Success: type=${entry.type} bodyChildren=${body.get_n_children()}`);
		} catch (error) {
			console.error('[STACK-RENDER] Failed:', error);
		};

		paneRoot.add_child(pageActor);
		pageActor.set_position(0, 0);
		return page;
	};

	for (const entry of entries) {
		console.log(`[ATTACH-STACK] Building page for entry type=${entry.type} side=${entry.side}`);
		pages.push(buildPage(entry));
	};
	console.log(`[ATTACH-STACK] Total pages built: ${pages.length} (including primary)`);

	const placeIdle = () => {


		active = Math.min(active, pages.length - 1);

		for (let i = 1; i < pages.length; i += 1) {
			const {actor} = pages[i];


			actor.translation_y = (i - active) * baseDistance();
			actor.visible = i === active;
		};


		updateGlassGeometry();
	};
	placeIdle();




	const crossTo = (target) => {
		if (disposed || crossBusy || target === active
			|| target < 0 || target >= pages.length) {
			return;
		};

		const leaving = pages[active];
		const entering = pages[target];
		const oldActive = active;
		active = target;







		const entryDir = target > oldActive ? 1 : -1;



		entering.actor.translation_y = entryDir * baseDistance();
		entering.actor.visible = true;
		leaving.actor.translation_y = 0;

		crossBusy = true;




		updatePageGlassGeometry(entering);
		updatePageGlassGeometry(leaving);

		leaving.actor.ease({
			translation_y: -entryDir * baseDistance(),
			duration: CROSS_DURATION,
			mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
			onComplete: () => {
				if (disposed || leaving.actor.is_finalized?.()) {
					return;
				};





				const index = pages.indexOf(leaving);


				if (index === 0) {
					leaving.actor.translation_y = 0;
					leaving.actor.visible = false;
					updatePageGlassGeometry(leaving);
					return;
				};
				const leavingSide = leaving.entry?.side ?? 'below';



				const idleDir = leavingSide === 'above' ? -1 : 1;
				leaving.actor.translation_y = idleDir * Math.abs(index - active) * baseDistance();
				leaving.actor.visible = false;
				updatePageGlassGeometry(leaving);
			},
		});
		entering.actor.ease({
			translation_y: 0,
			duration: CROSS_DURATION,
			mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
			onComplete: () => {
				crossBusy = false;
				updatePageGlassGeometry(entering);
				onPageChange();
			},
		});
	};











	const railReactive = !isEditMode();

	const makeRail = (edge) => {
		const rail = new St.Widget({
			reactive: railReactive,
			x: 0,
			y: edge === 'bottom' ? Math.max(0, pageH - RAIL_HEIGHT) : 0,
			width: pageW,
			height: RAIL_HEIGHT,
			opacity: 0,
		});

		let dragStartY = null;

		rail.connect('button-press-event', (_actor, event) => {
			if (crossBusy) {
				return Clutter.EVENT_PROPAGATE;
			};
			const [stageX, stageY] = event.get_coords();
			if (!Number.isFinite(stageY)) {
				return Clutter.EVENT_PROPAGATE;
			};
			dragStartY = stageY;
			return Clutter.EVENT_STOP;
		});

		rail.connect('button-release-event', (_actor, event) => {
			if (dragStartY === null) {
				return Clutter.EVENT_PROPAGATE;
			};
			const startY = dragStartY;
			dragStartY = null;

			const [stageX, stageY] = event.get_coords();
			if (!Number.isFinite(stageY)) {
				return Clutter.EVENT_STOP;
			};

			const delta = stageY - startY;

			if (Math.abs(delta) <= SWIPE_THRESHOLD) {
				return Clutter.EVENT_STOP;
			};



			let target = -1;

			if (edge === 'bottom') {

				if (delta < 0) {

					if (active === 0) {

						const firstBelow = pages.findIndex((p, i) => i > 0 && p.entry?.side !== 'above');
						target = firstBelow !== -1 ? firstBelow : -1;
					} else {
						const currentSide = pages[active]?.entry?.side ?? 'below';
						if (currentSide === 'below') {

							const nextBelow = pages.findIndex((p, i) => i > active && p.entry?.side !== 'above');
							target = nextBelow !== -1 ? nextBelow : -1;
						} else {

							target = 0;
						}
					}
				} else {

					if (active > 0 && pages[active]?.entry?.side !== 'above') {

						for (let i = active - 1; i >= 0; i--) {
							if (i === 0 || pages[i]?.entry?.side !== 'above') {
								target = i;
								break;
							}
						}
					}
				}
			} else {

				if (delta > 0) {

					if (active === 0) {

						const firstAbove = pages.findIndex((p, i) => i > 0 && p.entry?.side === 'above');
						target = firstAbove !== -1 ? firstAbove : -1;
					} else {
						const currentSide = pages[active]?.entry?.side ?? 'below';
						if (currentSide === 'above') {

							const nextAbove = pages.findIndex((p, i) => i > active && p.entry?.side === 'above');
							target = nextAbove !== -1 ? nextAbove : -1;
						}
					}
				} else {

					if (active > 0 && pages[active]?.entry?.side === 'above') {

						for (let i = active - 1; i >= 0; i--) {
							if (i === 0 || pages[i]?.entry?.side === 'above') {
								target = i;
								break;
							}
						}
					}
				}
			}

			if (target >= 0 && target < pages.length) {
				crossTo(target);
			};
			return Clutter.EVENT_STOP;
		});

		paneRoot.add_child(rail);
		return rail;
	};

	const bottomRail = makeRail('bottom');
	const topRail = makeRail('top');
	const rails = [bottomRail, topRail];






	let swipeStartY = null;
	paneRoot.connect('button-press-event', (_actor, event) => {
		if (isEditMode() || crossBusy) {
			return Clutter.EVENT_PROPAGATE;
		};
		if (event.get_button() !== 3) {
			return Clutter.EVENT_PROPAGATE;
		};
		const coords = event.get_coords();
		if (!Number.isFinite(coords?.[1])) {
			return Clutter.EVENT_PROPAGATE;
		};
		swipeStartY = coords[1];
		return Clutter.EVENT_PROPAGATE;
	});

	paneRoot.connect('button-release-event', (_actor, event) => {
		if (swipeStartY === null) {
			return Clutter.EVENT_PROPAGATE;
		};
		const startY = swipeStartY;
		swipeStartY = null;
		if (isEditMode() || crossBusy) {
			return Clutter.EVENT_PROPAGATE;
		};
		if (event.get_button() !== 3) {
			return Clutter.EVENT_PROPAGATE;
		};
		const coords = event.get_coords();
		if (!Number.isFinite(coords?.[1])) {
			return Clutter.EVENT_STOP;
		};
		const delta = coords[1] - startY;
		if (Math.abs(delta) < SWIPE_THRESHOLD) {
			return Clutter.EVENT_STOP;
		};
		if (crossBusy) {
			return Clutter.EVENT_STOP;
		};

		const curSide = active === 0 ? null : (pages[active]?.entry?.side ?? 'below');
		let target = -1;
		if (delta < 0) {

			if (active === 0) {
				target = pages.findIndex((p, i) => i > 0 && p.entry?.side === 'above');
			} else if (curSide === 'above') {
				for (let i = active - 1; i >= 0; i--) {
					if (i === 0 || pages[i]?.entry?.side === 'above') {
						target = i;
						break;
					}
				}
			} else {
				target = 0;
			}
		} else {

			if (active === 0) {
				target = pages.findIndex((p, i) => i > 0 && p.entry?.side !== 'above');
			} else if (curSide === 'below') {
				target = pages.findIndex((p, i) => i > active && p.entry?.side !== 'above');
			} else {
				target = 0;
			}
		}

		if (target >= 0 && target < pages.length && target !== active) {
			crossTo(target);
		};
		return Clutter.EVENT_STOP;
	});



	const updateRailReactive = () => {
		if (rails.some(rail => rail.is_finalized?.())) {
			return;
		};
		const reactive = !isEditMode();
		for (const rail of rails) {
			rail.reactive = reactive;


			rail.visible = reactive;
		};
	};

	return {



		dispose() {
			disposed = true;
			for (const rail of rails) {
				rail.remove_all_transitions();
				rail.destroy();
			};
			for (let i = 1; i < pages.length; i += 1) {
				const {actor} = pages[i];
				if (!actor.is_finalized?.()) {
					actor.remove_all_transitions();
					actor.destroy();
				};
			};
			pages.length = 1;
		},





		refresh() {
			updateRailReactive();
		},




		restyle,



		getActivePage() {
			return active;
		},


		updateGlassGeometry,
	};
};
