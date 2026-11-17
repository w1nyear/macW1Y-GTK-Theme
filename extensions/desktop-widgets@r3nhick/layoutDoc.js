



const LAYOUT_KEY = 'layout-json';
const LAYOUT_VERSION = 3;



function layoutJson(widgets) {
  return JSON.stringify({version: LAYOUT_VERSION, widgets});
};



function clearLayout(settings) {
  settings.set_string(LAYOUT_KEY, '');
};

function writeLayout(settings, widgets) {
  settings.set_string(LAYOUT_KEY, layoutJson(widgets));
};

export { LAYOUT_KEY, LAYOUT_VERSION, clearLayout, layoutJson, writeLayout };
