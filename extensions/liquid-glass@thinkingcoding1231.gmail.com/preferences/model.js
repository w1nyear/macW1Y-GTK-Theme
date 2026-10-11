export const SURFACES = ['dock', 'menu', 'panel-menu', 'notification', 'quick-settings', 'osd', 'application', 'desktop-menu'];

export const sharedKeys = suffix => SURFACES.map(surface => `${surface}-${suffix}`);

export const TEXT_KEYS = ['menu', 'panel-menu', 'notification', 'quick-settings', 'osd']
  .map(surface => `${surface}-enable-adaptive-text-color`);
export const MENU_KEYS = ['enable-menu-glass', 'enable-quick-settings-glass', 'enable-extra-menu-glass', 'enable-desktop-menu-glass'];
export const POPUP_KEYS = ['enable-notification-glass', 'enable-osd-glass'];
export const MOTION_KEYS = ['menu', 'panel-menu', 'quick-settings'].map(surface => `enable-${surface}-animation`);

export function uniformPatch(keys, value) {
  return Object.fromEntries(keys.map(key => [key, value]));
}

export function commonValue(settings, keys) {
  const values = keys.map(key => settings.get_value(key).deep_unpack());
  return {value: values[0], mixed: values.some(value => value !== values[0])};
}

export function matches(settings, patch) {
  return Object.entries(patch).every(([key, value]) => settings.get_value(key).deep_unpack() === value);
}

const smoothMotion = Object.fromEntries(['menu', 'panel-menu', 'quick-settings'].flatMap(surface => [
  [`enable-${surface}-animation`, true],
  [`${surface}-spring-stiffness`, 120],
  [`${surface}-spring-damping`, 22],
  [`${surface}-spring-mass`, 1],
  [`${surface}-animation-interval-ms`, 16],
]));

export const MOTION = [
  {title: 'Off', patch: uniformPatch(MOTION_KEYS, false)},
  {title: 'Smooth', patch: smoothMotion},
];

export const QUALITY = [
  {title: 'Sharp', patch: {'blur-method': 0, 'glass-blur-downscale': 2}},
  {title: 'Balanced', patch: {'blur-method': 1, 'glass-blur-downscale': 2}},
  {title: 'Fast', patch: {'blur-method': 1, 'glass-blur-downscale': 4}},
];

export const booleanChoices = keys => [
  {title: 'Off', patch: uniformPatch(keys, false)},
  {title: 'On', patch: uniformPatch(keys, true)},
];
