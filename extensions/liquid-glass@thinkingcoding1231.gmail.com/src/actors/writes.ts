// Clutter's transform setters queue a redraw even when the value is
// unchanged, and the per-frame syncs run in before-update, so every redundant
// write would ask for another frame. These helpers write only on change. The
// last written values are kept on the JS side, which is much cheaper than
// reading the GObject properties back.
// global._lgGlass.diffWrites(false) restores unconditional writes.
let _diffWritesEnabled = true;

export function setDiffWritesEnabled(enabled: boolean): void {
  _diffWritesEnabled = !!enabled;
}

export function isDiffWritesEnabled(): boolean {
  return _diffWritesEnabled;
}

// What each actor was last given, per setter.
const _lastWritten: WeakMap<object, Map<string, number[]>> = new WeakMap();

// Runs `write` unless `values` equal what the same setter last wrote to the
// actor.
function writeIfChanged(actor: object, setter: string, values: number[], write: () => void): boolean {
  let written = _lastWritten.get(actor);
  if (!written) {
    written = new Map();
    _lastWritten.set(actor, written);
  }
  const previous = written.get(setter);
  if (_diffWritesEnabled && previous && values.every((value, index) => value === previous[index]))
    return false;
  written.set(setter, values);
  write();
  return true;
}

export function setTranslationIfChanged(actor: any, x: number, y: number): boolean {
  return writeIfChanged(actor, 'translation', [x, y], () => {
    actor.translation_x = x;
    actor.translation_y = y;
  });
}

export function setSizeIfChanged(actor: any, width: number, height: number): boolean {
  return writeIfChanged(actor, 'size', [width, height], () => actor.set_size(width, height));
}

export function setScaleIfChanged(actor: any, scaleX: number, scaleY: number): boolean {
  return writeIfChanged(actor, 'scale', [scaleX, scaleY], () => actor.set_scale(scaleX, scaleY));
}

export function setClipIfChanged(actor: any, x: number, y: number, width: number, height: number): boolean {
  return writeIfChanged(actor, 'clip', [x, y, width, height], () => actor.set_clip(x, y, width, height));
}

export function setPositionIfChanged(actor: any, x: number, y: number): boolean {
  return writeIfChanged(actor, 'position', [x, y], () => actor.set_position(x, y));
}
