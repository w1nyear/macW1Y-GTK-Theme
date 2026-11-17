






import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';





const CANVAS_BUTTON_KEY = 'DesktopWidgets_CanvasButton_class';

export const CanvasButton = (globalThis[CANVAS_BUTTON_KEY] ??= GObject.registerClass({



  GTypeName: 'DesktopWidgets_CanvasButton',
  Signals: {'clicked': {}},
}, class CanvasButton extends St.DrawingArea {
  _init(paint, {bounce = false} = {}) {
    super._init({reactive: true, track_hover: true});
    this.pressed = false;
    this._bounce = bounce;
    this.set_pivot_point(0.5, 0.5);
    this.connect('repaint', () => {
      const cr = this.get_context();
      paint(cr, this);
      cr.$dispose();
    });
    this.connect('notify::hover', () => this.queue_repaint());
  }

  vfunc_button_press_event(event) {
    if (event.get_button() !== Clutter.BUTTON_PRIMARY)
      return Clutter.EVENT_PROPAGATE;
    this.pressed = true;
    this.queue_repaint();
    return Clutter.EVENT_STOP;
  }

  vfunc_button_release_event(event) {
    if (event.get_button() !== Clutter.BUTTON_PRIMARY || !this.pressed)
      return Clutter.EVENT_PROPAGATE;
    this.pressed = false;
    this.queue_repaint();
    if (this._bounce)
      this._playBounce();
    this.emit('clicked');
    return Clutter.EVENT_STOP;
  }

  vfunc_leave_event(event) {
    if (this.pressed) {
      this.pressed = false;
      this.queue_repaint();
    }
    return super.vfunc_leave_event(event);
  }





  vfunc_get_preferred_width(_forHeight) {
    const w = this.width > 0 ? Math.ceil(this.width) : 27;
    return [w, w];
  }

  vfunc_get_preferred_height(_forWidth) {
    const h = this.height > 0 ? Math.ceil(this.height) : 27;
    return [h, h];
  }

  _playBounce() {
    this.remove_transition('scale-x');
    this.remove_transition('scale-y');
    this.ease({
      scale_x: 0.7,
      scale_y: 0.7,
      duration: 100,
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      onComplete: () => this.ease({
        scale_x: 1,
        scale_y: 1,
        duration: 300,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
      }),
    });
  }
}));
