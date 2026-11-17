import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';




export function bounceButton(button) {
	button.set_pivot_point(0.5, 0.5);
	button.remove_transition('scale-x');
	button.remove_transition('scale-y');
	button.ease({
		scale_x: 0.8,
		scale_y: 0.8,
		duration: 90,
		mode: Clutter.AnimationMode.EASE_IN_QUAD,
		onComplete: () => button.ease({
			scale_x: 1,
			scale_y: 1,
			duration: 260,
			mode: Clutter.AnimationMode.EASE_OUT_BACK,
		}),
	});
};



















const HOVER_SCALE = 0.85;
export function bindHoverShrink(button) {
	button.set_pivot_point(0.5, 0.5);
	let hovering = false;
	let leaveIdleId = null;

	const cancelLeave = () => {
		if (leaveIdleId !== null) {
			GLib.source_remove(leaveIdleId);
			leaveIdleId = null;
		}
	};

	button.connect('destroy', () => cancelLeave());

	button.connect('enter-event', (_, event) => {

		const related = event.get_related();
		if (related && button.contains(related)) return Clutter.EVENT_PROPAGATE;



		cancelLeave();

		if (hovering) return Clutter.EVENT_PROPAGATE;
		hovering = true;
		button.remove_transition('scale-x');
		button.remove_transition('scale-y');
		button.ease({
			scale_x: HOVER_SCALE,
			scale_y: HOVER_SCALE,
			duration: 120,
			mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
		});
		return Clutter.EVENT_PROPAGATE;
	});

	button.connect('leave-event', (_, event) => {

		const related = event.get_related();
		if (related && button.contains(related)) return Clutter.EVENT_PROPAGATE;
		if (!hovering) return Clutter.EVENT_PROPAGATE;


		hovering = false;
		cancelLeave();
		leaveIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
			leaveIdleId = null;
			button.remove_transition('scale-x');
			button.remove_transition('scale-y');
			button.ease({
				scale_x: 1,
				scale_y: 1,
				duration: 150,
				mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
			});
			return GLib.SOURCE_REMOVE;
		});
		return Clutter.EVENT_PROPAGATE;
	});
};




export function attachBounce(button) {
	button.set_pivot_point(0.5, 0.5);
	bindHoverShrink(button);
	return button.connect('clicked', () => bounceButton(button));
};
