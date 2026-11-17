



import Cogl from 'gi://Cogl';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import { hexToColorArray, startSyncLoop, stopStageLoop } from '../animation.js';
import { accentColors, watchAccentColor, coglContext, safeRegisterClass } from '../shellVersion.js';
import { iconStyleColors, iconStyleUniforms } from './styleColors.js';
import { LENS_SIZE, MAP_SIZE } from './styleMap.js';
import { WorkerProcess } from '../workers/workerProcess.js';
import { rectInOffscreen, configureSamplerLayer, splitShader } from '../rendering/pipelines.js';
import { GlassRenderer } from '../rendering/glassRenderer.js';
import { RelaySet, SAMPLE_MARGIN, relayHolder, StageCopier } from '../rendering/backdropGlass.js';

export const SHOW_APPS_ID = 'show-apps';

const LOOKUP_SIZE = 128;
const STYLE_EFFECT_NAME = 'liquid-glass-icon-style';


const PREPARE_DELAY_S = 5;
const FALLBACK_ICON = 'application-x-executable';


const HOST_KEEP_MS = 1000;




function backdropHost(holder) {
    let host = holder, cached = false;
    for (let actor = holder; actor; actor = actor.get_parent()) {
        const parent = actor.get_parent();
        if (parent && actor.offscreen_redirect & Clutter.OffscreenRedirect.ALWAYS) {
            host = parent;
            cached = true;
        }
    }
    return { host, cached };
}


const KEYS = ['icon-style-dock', 'icon-style-launcher', 'icon-style-app-grid', 'icon-style-all-apps', 'icon-style-whitelist', 'icon-style-blacklist'];
const COLOR_KEYS = ['icon-style-use-accent', 'icon-style-color', 'icon-style-tint-variant',
    'icon-style-tint-strength', 'icon-style-symbol-opacity', 'icon-style-tuning'];

function appIdOf(icon) {

    if (icon.has_style_class_name('show-apps-icon'))
        return SHOW_APPS_ID;
    for (let actor = icon.get_parent(); actor; actor = actor.get_parent()) {

        const app = actor.app ?? actor._delegate?.app;
        if (app instanceof Shell.App)
            return app.get_id();
    }
    return folderAppIdOf(icon);
}


function folderAppIdOf(icon) {
    const bin = icon.get_parent();
    const grid = bin?.get_parent();
    if (!bin || !grid)
        return null;
    for (let actor = grid.get_parent(); actor; actor = actor.get_parent()) {
        const items = actor.view?._orderedItems;
        if (!Array.isArray(items))
            continue;
        const app = items[grid.get_children().indexOf(bin)]?.app;
        return app instanceof Shell.App ? app.get_id() : null;
    }
    return null;
}

export class IconStyler {
    _extensionPath;
    _settings;
    _logger;
    _maps;
    _shader;
    _shaderSource = null;
    _pipeline = null;
    _glassPipeline = null;
    _hosts = new Map();

    _folderViews = new WeakSet();
    _theme = new St.IconTheme();
    _styled = new Map();

    _roots = new Map();
    _scanId = 0;
    _prepareId = 0;
    _installedId = 0;
    _notification = null;
    _settingsIds = [];
    _themeId = 0;
    _unwatchAccent = () => { };
    _cancellable = new Gio.Cancellable();

    constructor(_extensionPath, _settings, _logger) {
        this._extensionPath = _extensionPath;
        this._settings = _settings;
        this._logger = _logger;
        this._maps = new IconMaps(_extensionPath, _logger, busy => this._notify(busy));
        const file = Gio.File.new_for_path(`${_extensionPath}/shaders/icon-style.frag`);
        this._shader = new Promise((resolve, reject) => {
            file.load_contents_async(this._cancellable, (_f, res) => {
                try {
                    resolve(new TextDecoder().decode(file.load_contents_finish(res)[1]));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        this._shader.then(source => { this._shaderSource = source; }, () => { });
        this._shader.catch(e => {
            if (!(e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)))
                this._logger.error(`[Liquid Glass] Could not read the icon shader: ${e}`);
        });
    }

    setup() {
        this._settingsIds = [
            ...KEYS.map(key => this._settings.connect(`changed::${key}`, () => {
                this._restyleAll();
                this._prepareSoon();
            })),
            ...COLOR_KEYS.map(key => this._settings.connect(`changed::${key}`, () => this._recolorAll())),
            this._settings.connect('changed::icon-style-size', () => this._resizeAll()),
            this._settings.connect('changed::icon-style-mode', () => this._restyleAll()),
        ];
        this._themeId = St.TextureCache.get_default().connect('icon-theme-changed', () => {
            this._theme = new St.IconTheme();
            this._restyleAll();
            this._prepareSoon();
        });
        this._installedId = Shell.AppSystem.get_default().connect('installed-changed', () => this._prepareSoon());
        this._unwatchAccent = watchAccentColor(() => this._recolorAll());
        this._watch(Main.overview._overview.controls._appDisplay, 'app-grid');
        this._prepareSoon();
    }

    cleanup() {
        this._cancellable.cancel();
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        if (this._themeId)
            St.TextureCache.get_default().disconnect(this._themeId);
        this._themeId = 0;
        if (this._installedId)
            Shell.AppSystem.get_default().disconnect(this._installedId);
        this._installedId = 0;
        if (this._prepareId)
            GLib.Source.remove(this._prepareId);
        this._prepareId = 0;
        this._notification?.destroy();
        this._notification = null;
        this._unwatchAccent();
        if (this._scanId)
            global.compositor.get_laters().remove(this._scanId);
        this._scanId = 0;
        for (const root of [...this._roots.keys()])
            this.unwatchDock(root);
        for (const icon of [...this._styled.keys()])
            this._forget(icon);
        for (const host of [...this._hosts.keys()])
            this._dropHost(host);
        this._maps.destroy();
        this._pipeline = null;
        this._glassPipeline = null;
    }


    watchDock(dock) {
        this._watch(dock, 'dock');
    }

    unwatchDock(root) {
        const entry = this._roots.get(root);
        if (!entry)
            return;
        this._roots.delete(root);
        for (const [actor, ids] of entry.watched)
            ids.forEach(id => actor.disconnect(id));
        for (const [icon, styled] of [...this._styled]) {
            if (styled.root === root)
                this._forget(icon);
        }
    }

    _watch(root, surface) {
        if (this._roots.has(root))
            return;
        this._roots.set(root, { surface, watched: new Map() });
        this._scanSoon();
    }





    styleLauncherIcon(icon, appId, host) {
        this._style(icon, appId, 'launcher', null, host);
    }


    _scanSoon() {
        if (this._scanId)
            return;
        this._scanId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._scanId = 0;
            for (const [root, { surface, watched }] of this._roots)
                this._scan(root, root, surface, watched);
            return GLib.SOURCE_REMOVE;
        });
    }

    _scan(actor, root, surface, watched) {
        if (actor instanceof St.Icon) {
            const appId = appIdOf(actor);
            if (appId && !this._styled.has(actor))
                this._style(actor, appId, surface, root);
            return;
        }
        if (!watched.has(actor)) {
            watched.set(actor, [
                actor.connect('child-added', () => this._scanSoon()),
                actor.connect('destroy', () => watched.delete(actor)),
            ]);
        }
        for (const child of actor.get_children())
            this._scan(child, root, surface, watched);

        const folder = actor.view;
        if (surface === 'app-grid' && folder instanceof Clutter.Actor) {
            this._folderViews.add(folder);
            this._scan(folder, root, surface, watched);
        }
    }

    _style(icon, appId, surface, root = null, host = root) {
        if (!this._styled.has(icon)) {
            const restyle = () => this._apply(icon);

            for (let actor = icon.get_parent(); actor && actor !== root; actor = actor.get_parent()) {
                if (this._folderViews.has(actor)) {
                    host = actor;
                    break;
                }
            }
            this._styled.set(icon, {
                appId, surface, root, host, backdropHost: null, effect: null, serial: 0,
                ids: [icon.connect('destroy', () => this._dropIcon(icon)), icon.connect('notify::gicon', restyle),
                    icon.connect('notify::fallback-gicon', restyle)],
            });
        }
        this._apply(icon);
    }

    _forget(icon) {
        const styled = this._styled.get(icon);
        if (!styled)
            return;
        this._styled.delete(icon);
        styled.ids.forEach(id => icon.disconnect(id));
        this._unstyle(icon, styled);
    }

    _dropIcon(icon) {
        const styled = this._styled.get(icon);
        if (!styled)
            return;
        this._styled.delete(icon);
        this._leaveHost(icon, styled);
    }





    prepareLauncherHost(host) {
        if (this._settings.get_boolean('icon-style-launcher') && this._settings.get_string('icon-style-mode') === 'clear')
            this._hostFor(host, 'launcher');
    }


    _backdropFor(icon, styled) {
        if (!styled.host)
            return null;
        const { host, entry } = this._hostFor(styled.host, styled.surface);
        styled.backdropHost = host;
        entry.icons.add(icon);
        return entry.backdrop;
    }

    _hostFor(holder, surface) {
        const { host, cached } = backdropHost(holder);
        let entry = this._hosts.get(host);
        if (!entry) {
            const icons = new Set();
            const backdrop = new IconBackdrop({
                extensionPath: this._extensionPath, settings: this._settings, logger: this._logger,
                prefix: surface === 'launcher' ? 'launcher' : 'dock', rect: () => this._extentsOf(icons),
                copied: () => {
                    if (cached)
                        for (const icon of icons)
                            icon.queue_redraw();
                },
            });
            backdrop.attach(host);
            entry = { backdrop, icons, destroyId: host.connect('destroy', () => this._dropHost(host)), dropId: 0 };
            this._hosts.set(host, entry);
        }
        return { host, entry };
    }

    _leaveHost(icon, styled) {
        const host = styled.backdropHost;
        styled.backdropHost = null;
        const entry = host ? this._hosts.get(host) : null;
        if (!entry)
            return;
        entry.icons.delete(icon);
        if (entry.icons.size)
            return;
        if (entry.dropId)
            GLib.Source.remove(entry.dropId);
        entry.dropId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOST_KEEP_MS, () => {
            entry.dropId = 0;
            if (!entry.icons.size)
                this._dropHost(host);
            return GLib.SOURCE_REMOVE;
        });
    }

    _dropHost(host) {
        const entry = this._hosts.get(host);
        if (!entry)
            return;
        this._hosts.delete(host);
        if (entry.dropId)
            GLib.Source.remove(entry.dropId);
        host.disconnect(entry.destroyId);
        entry.backdrop.cleanup();
    }


    _extentsOf(icons) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const icon of icons) {
            if (!icon.mapped)
                continue;
            const r = icon.get_transformed_extents();
            x0 = Math.min(x0, r.get_x());
            y0 = Math.min(y0, r.get_y());
            x1 = Math.max(x1, r.get_x() + r.get_width());
            y1 = Math.max(y1, r.get_y() + r.get_height());
        }
        return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
    }

    _wanted(styled) {
        return this._settings.get_boolean(`icon-style-${styled.surface}`) && this._wantedApp(styled.appId);
    }

    _wantedApp(appId) {
        const s = this._settings;
        return s.get_boolean('icon-style-all-apps') ? !s.get_strv('icon-style-blacklist').includes(appId)
            : s.get_strv('icon-style-whitelist').includes(appId);
    }

    _file(icon) {
        const named = (name) => (name ? new Gio.ThemedIcon({ name }) : null);
        return this._fileOf([icon.gicon ?? named(icon.icon_name), icon.fallback_gicon ?? named(icon.fallback_icon_name)]);
    }


    _fileOf(gicons) {
        for (const gicon of gicons) {
            if (gicon instanceof Gio.FileIcon)
                return gicon.get_file().get_path();
            const file = gicon ? this._theme.lookup_by_gicon(gicon, LOOKUP_SIZE, 0)?.get_filename() : null;
            if (file)
                return file;
        }
        return null;
    }

    _prepareSoon() {
        if (this._prepareId)
            GLib.Source.remove(this._prepareId);
        this._prepareId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, PREPARE_DELAY_S, () => {
            this._prepareId = 0;
            this._prepare();
            return GLib.SOURCE_REMOVE;
        });
    }


    _prepare() {
        const s = this._settings;
        if (!['dock', 'launcher', 'app-grid'].some(surface => s.get_boolean(`icon-style-${surface}`))) {
            this._maps.prepare([]);
            return;
        }
        const fallback = new Gio.ThemedIcon({ name: FALLBACK_ICON });
        const files = Shell.AppSystem.get_default().get_installed()
            .filter(info => info.should_show() && this._wantedApp(info.get_id() ?? ''))
            .map(info => this._fileOf([info.get_icon(), fallback]))
            .filter((file) => !!file);
        this._maps.prepare(files);
    }

    _notify(busy) {
        this._notification?.destroy();
        this._notification = null;
        const notification = new MessageTray.Notification({
            source: MessageTray.getSystemSource(),
            title: busy ? 'Making glass icons' : 'Glass icons are ready',
            body: busy ? 'Liquid Glass is making glass versions of your application icons. They are kept in a cache, so you will not have to wait for them next time.'
                : null,
            isTransient: true,
        });
        if (busy) {
            this._notification = notification;
            notification.connect('destroy', () => {
                if (this._notification === notification)
                    this._notification = null;
            });
        }
        notification.source.addNotification(notification);
    }

    _colors() {
        const s = this._settings;
        const accent = s.get_boolean('icon-style-use-accent') ? accentColors() : null;
        const tint = accent ? [accent[0].red / 255, accent[0].green / 255, accent[0].blue / 255]
            : hexToColorArray(s.get_string('icon-style-color'));
        const mode = s.get_string('icon-style-mode');
        const variant = s.get_string('icon-style-tint-variant') === 'light' ? 'light' : 'dark';
        const tuning = s.get_value('icon-style-tuning').deep_unpack();
        return iconStyleColors((['mono', 'clear'].includes(mode) ? mode : 'tinted'), tint, s.get_double('icon-style-tint-strength'), s.get_double('icon-style-symbol-opacity'), variant, tuning);
    }

    _apply(icon) {
        const styled = this._styled.get(icon);
        if (!styled)
            return;
        const serial = ++styled.serial;
        const file = this._wanted(styled) ? this._file(icon) : null;
        if (!file) {
            this._unstyle(icon, styled);
            return;
        }


        const textures = this._maps.loaded(file);
        if (textures && this._shaderSource) {
            this._applyMaps(icon, styled, textures, this._shaderSource);
            return;
        }
        Promise.all([this._maps.get(file), this._shader]).then(([maps, shader]) => {
            if (this._styled.get(icon) !== styled || styled.serial !== serial)
                return;
            this._applyMaps(icon, styled, maps, shader);
        }).catch(e => {
            if (!(e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)))
                this._logger.log(`[Liquid Glass] Could not style the icon of ${styled.appId}: ${e}`);
        });
    }

    _applyMaps(icon, styled, textures, shader) {
        const clear = this._settings.get_string('icon-style-mode') === 'clear';
        let pipeline;
        if (clear)
            pipeline = this._glassPipeline ??= iconStylePipeline(shader, true);
        else
            pipeline = this._pipeline ??= iconStylePipeline(shader);
        const backdrop = clear ? this._backdropFor(icon, styled) : null;
        if (!clear)
            this._leaveHost(icon, styled);
        const effect = styled.effect ?? new IconStyleEffect();
        effect.prepare(pipeline.copy(), textures, this._colors(), backdrop);
        if (!styled.effect) {
            styled.effect = effect;
            icon.add_effect_with_name(STYLE_EFFECT_NAME, effect);
        }
        this._resize(icon);
    }


    _resize(icon) {
        const size = this._settings.get_double('icon-style-size');
        icon.set_pivot_point(0.5, 0.5);
        icon.set_scale(size, size);
    }

    _resizeAll() {
        for (const [icon, styled] of this._styled) {
            if (styled.effect)
                this._resize(icon);
        }
    }

    _unstyle(icon, styled) {
        this._leaveHost(icon, styled);
        if (!styled.effect)
            return;
        icon.remove_effect(styled.effect);
        icon.set_scale(1, 1);
        styled.effect = null;
    }

    _restyleAll() {
        for (const icon of [...this._styled.keys()])
            this._apply(icon);
    }

    _recolorAll() {
        const colors = this._colors();
        for (const styled of this._styled.values())
            styled.effect?.setColors(colors);
    }
}




const MAP_VERSION = 10;

const MAX_WORKERS = 4;

const IDLE_DELAY_MS = 1500;

function loadFile(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (_f, res) => {
            try {
                resolve(file.load_contents_finish(res)[1]);
            }
            catch (e) {
                reject(e);
            }
        });
    });
}

function modified(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.query_info_async('time::modified', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_f, res) => {
            try {
                resolve(file.query_info_finish(res).get_attribute_uint64('time::modified'));
            }
            catch (e) {
                reject(e);
            }
        });
    });
}

function exists(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (_f, res) => {
            try {
                file.query_info_finish(res);
                resolve(true);
            }
            catch (e) {
                if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    resolve(false);
                else
                    reject(e);
            }
        });
    });
}

function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export class IconMaps {
    _logger;
    _onBusy;
    _workers;

    _maps = new Map();

    _loaded = new Map();

    _making = new Map();
    _jobs = 0;
    _busy = false;
    _idleId = 0;
    _prepareSerial = 0;
    _cancellable = new Gio.Cancellable();
    _dir = `${GLib.get_user_cache_dir()}/liquid-glass/icon-maps`;


    constructor(extensionPath, _logger, _onBusy) {
        this._logger = _logger;
        this._onBusy = _onBusy;
        const count = Math.max(1, Math.min(MAX_WORKERS, GLib.get_num_processors() - 1));
        this._workers = Array.from({ length: count }, () => new WorkerProcess(`${extensionPath}/dist/workers/iconWorker.js`, 'icon worker', _logger));
    }


    get(path) {
        let map = this._maps.get(path);
        if (!map) {
            map = this._load(path);
            map.then(textures => this._loaded.set(path, textures),

            () => this._maps.delete(path));
            this._maps.set(path, map);
        }
        return map;
    }


    loaded(path) {
        return this._loaded.get(path) ?? null;
    }





    prepare(paths) {
        const serial = ++this._prepareSerial;
        const queue = [...new Set(paths)];
        const next = async () => {
            while (serial === this._prepareSerial && queue.length) {
                const path = queue.shift();
                try {
                    await this._cached(path);
                }
                catch (e) {
                    if (isCancelled(e))
                        return;
                    this._logger.log(`[Liquid Glass] Could not make the glass icon of ${path}: ${e}`);
                }
            }
        };
        this._workers.forEach(() => next());
    }


    async _cached(path) {
        const time = await modified(Gio.File.new_for_path(path), this._cancellable);
        const key = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, `${MAP_VERSION}|${MAP_SIZE}|${path}|${time}`, -1);
        const cache = Gio.File.new_for_path(`${this._dir}/${key}`);
        if (await exists(cache, this._cancellable))
            return cache;
        let making = this._making.get(key);
        if (!making) {
            making = this._make(path, cache).finally(() => this._making.delete(key));
            this._making.set(key, making);
        }
        await making;
        return cache;
    }

    async _make(path, cache) {
        if (this._idleId)
            GLib.Source.remove(this._idleId);
        this._idleId = 0;
        this._jobs++;
        if (!this._busy) {
            this._busy = true;
            this._onBusy(true);
        }

        const usable = this._workers.filter(worker => worker.available);
        const worker = (usable.length ? usable : this._workers).reduce((a, b) => (b.pending < a.pending ? b : a));
        try {
            await worker.request({ file: path, cache: cache.get_path() });
        }
        finally {
            if (--this._jobs === 0) {
                if (this._idleId)
                    GLib.Source.remove(this._idleId);
                this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IDLE_DELAY_MS, () => {
                    this._idleId = 0;
                    this._busy = false;
                    this._onBusy(false);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    async _load(path) {
        const cache = await this._cached(path);
        const bytes = await loadFile(cache, this._cancellable);
        const length = MAP_SIZE * MAP_SIZE * 4;
        if (bytes.length !== length * 2 + LENS_SIZE * LENS_SIZE * 2 * 4)
            throw new Error(`${cache.get_path()} is not a style map`);
        return { map: iconStyleTexture(bytes.subarray(0, length)), tone: iconStyleTexture(bytes.subarray(length, length * 2)),
            lens: iconStyleTexture(bytes.subarray(length * 2), LENS_SIZE, LENS_SIZE * 2) };
    }

    destroy() {
        this._cancellable.cancel();
        if (this._idleId)
            GLib.Source.remove(this._idleId);
        this._idleId = 0;
        for (const worker of this._workers)
            worker.destroy();
        this._maps.clear();
        this._loaded.clear();
        this._making.clear();
    }
}







const MATERIAL = ['max_z', 'displacement_scale', 'edge_smoothing', 'profile_shape_n', 'ior', 'chroma_strength',
    'specular_intensity', 'shininess', 'rim_width', 'rim_intensity', 'rim_directional_power', 'rim_power',
    'rim_light_color_intensity', 'sheen_intensity', 'light_angle_deg', 'ao_intensity', 'ao_radius',
    'highlight_backdrop_color', 'surface_light_enabled', 'brightness', 'contrast', 'saturation'];





export function iconStylePipeline(source, glass = false) {
    const pipeline = Cogl.Pipeline.new(coglContext());
    configureSamplerLayer(pipeline, 0);
    pipeline.set_layer_wrap_mode(1, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);

    pipeline.set_layer_filters(1, Cogl.PipelineFilter.LINEAR_MIPMAP_LINEAR, Cogl.PipelineFilter.LINEAR);
    const layers = glass ? [2, 3, 4] : [2];
    for (const layer of layers) {
        pipeline.set_layer_wrap_mode(layer, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
        pipeline.set_layer_filters(layer, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
    }
    const split = splitShader(source);
    const decl = glass ? `#define LG_ICON_GLASS 1\n${split.decl}` : split.decl;
    const body = split.body;
    const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, decl.replace(/uniform\s+sampler2D\s+cogl_sampler\d\s*;[^\n]*/g, ''), null);
    snippet.set_replace(body);
    pipeline.add_snippet(snippet);
    return pipeline;
}


export function iconStyleTexture(data, width = MAP_SIZE, height = MAP_SIZE) {

    return Cogl.Texture2D.new_from_data(coglContext(), width, height, Cogl.PixelFormat.RGBA_8888_PRE, width * 4, data);
}



function imageRect(actor) {
    const image = actor.get_first_child()?.get_allocation_box();
    if (image && image.get_width() >= 1 && image.get_height() >= 1)
        return [image.x1, image.y1, image.get_width(), image.get_height()];
    const box = actor instanceof St.Widget ? actor.get_theme_node().get_content_box(actor.get_allocation_box())
        : new Clutter.ActorBox({ x1: 0, y1: 0, x2: actor.width, y2: actor.height });
    const side = Math.min(box.get_width(), box.get_height());
    return [box.x1 + (box.get_width() - side) / 2, box.y1 + (box.get_height() - side) / 2, side, side];
}

export const IconStyleEffect = safeRegisterClass({ GTypeName: 'WackGlass_IconStyleEffect' }, class IconStyleEffect extends Clutter.OffscreenEffect {
    _init() {
        super._init();
        this._pipeline = null;
        this._locations = new Map();
        this._values = new Map();
        this._behind = null;
        this._map = null;
        this._backdrop = null;
        this._materialSerial = -1;
    }





    prepare(pipeline, textures, colors, backdrop = null) {
        this._pipeline = pipeline;
        this._locations.clear();
        this._values.clear();
        this._behind = null;
        this._map = textures.map;
        this._backdrop = backdrop;
        this._materialSerial = -1;
        pipeline.set_layer_texture(1, textures.map);
        pipeline.set_layer_texture(2, textures.tone);
        if (backdrop) {
            pipeline.set_layer_texture(3, textures.lens);
            this._setBehind(textures.map);
        }
        this.setColors(colors);
    }

    setColors(colors) {
        for (const [name, value] of iconStyleUniforms(colors))
            this._set(name, value);
        this.queue_repaint();
    }

    _set(name, value) {
        const pipeline = this._pipeline;
        if (!pipeline || this._values.get(name) === value)
            return;
        this._values.set(name, value);
        let location = this._locations.get(name);
        if (location === undefined) {
            location = pipeline.get_uniform_location(name);
            this._locations.set(name, location);
        }
        pipeline.set_uniform_1f(location, value);
    }

    _setBehind(texture) {
        if (texture === this._behind)
            return;
        this._behind = texture;
        this._pipeline.set_layer_texture(4, texture);
    }

    vfunc_paint_target(node, _paintContext) {
        const texture = this.get_texture();
        const pipeline = this._pipeline;
        if (!texture || !pipeline)
            return;
        const actor = this.get_actor();
        const image = imageRect(actor);
        const at = rectInOffscreen(actor, image);
        if (!at)
            return;
        const [x0, y0, x1, y1] = at.box;
        this._set('box_x0', x0);
        this._set('box_y0', y0);
        this._set('box_x1', x1);
        this._set('box_y1', y1);

        this._set('map_px', MAP_SIZE / Math.max((x1 - x0) * texture.get_width() * actor.scale_x, 1));
        this._set('clone', actor.is_in_clone_paint() ? 1 : 0);
        this._set('opacity', actor.get_paint_opacity() / 255);
        if (this._backdrop)
            this._bindBackdrop(this._backdrop, actor, image);
        pipeline.set_layer_texture(0, texture);
        const drawNode = Clutter.PipelineNode.new(pipeline);
        node.add_child(drawNode);
        drawNode.add_rectangle(new Clutter.ActorBox({ x1: 0, y1: 0, x2: texture.get_width(), y2: texture.get_height() }));
    }




    _bindBackdrop(backdrop, actor, [x, y, w, h]) {
        const current = backdrop.current();

        const ext = actor.get_transformed_extents();
        const kx = ext.get_width() / Math.max(actor.get_width(), 1), ky = ext.get_height() / Math.max(actor.get_height(), 1);
        const sx0 = ext.get_x() + x * kx, sy0 = ext.get_y() + y * ky, sx1 = sx0 + w * kx, sy1 = sy0 + h * ky;
        const r = current?.rect;
        const ready = !!r && sx0 < r[2] && sy0 < r[3] && sx1 > r[0] && sy1 > r[1] && sx1 - sx0 >= 1;
        this._set('glass_ready', ready ? 1 : 0);
        if (!ready) {
            this._setBehind(this._map);
            return;
        }
        const [rx0, ry0, rx1, ry1] = r;
        this._set('bd_x0', (sx0 - rx0) / (rx1 - rx0));
        this._set('bd_y0', (sy0 - ry0) / (ry1 - ry0));
        this._set('bd_x1', (sx1 - rx0) / (rx1 - rx0));
        this._set('bd_y1', (sy1 - ry0) / (ry1 - ry0));
        this._set('box_w_px', sx1 - sx0);
        this._set('box_h_px', sy1 - sy0);
        this._set('bd_w_px', rx1 - rx0);
        this._set('bd_h_px', ry1 - ry0);
        this._set('bd_tex_w', current.texture.get_width());
        this._set('bd_tex_h', current.texture.get_height());
        this._setBehind(current.texture);
        if (backdrop.materialSerial === this._materialSerial)
            return;
        this._materialSerial = backdrop.materialSerial;
        const material = backdrop.material();
        for (const name of MATERIAL)
            this._set(`glass_${name}`, material.get(name) ?? 0);
    }
});







const BACKDROP_EFFECT_NAME = 'liquid-glass-icon-backdrop';

const MARGIN = 8;

const QUANTUM = 32;

export const IconBackdrop = safeRegisterClass({ GTypeName: 'WackGlass_IconBackdrop' }, class IconBackdrop extends Clutter.Effect {
    _init(params) {
        super._init();
        this._params = params;
        this._host = null;
        this._relays = null;
        this._loaded = false;
        this._shaderLoad = new Gio.Cancellable();
        this._mapId = 0;
        this._signalId = 0;
        this._firstId = 0;
        this._signalSlot = { get: () => this._signalId, set: id => { this._signalId = id; } };
        this._firstSlot = { get: () => this._firstId, set: id => { this._firstId = id; } };
        this._area = null;
        this._paintedRect = null;
        this._serialAtMap = 0;
        this.materialSerial = 0;
        this._copier = new StageCopier(params.logger);
        this._renderer = new GlassRenderer({
            settings: params.settings, logger: params.logger, repaint: () => this._materialChanged(), setDiagnostics: () => { },
        });
        this._holder = relayHolder();
        this._holder.hide();
        Main.layoutManager.uiGroup.add_child(this._holder);
        const prefix = params.prefix;
        const s = params.settings;
        const apply = () => {
            this._renderer.setBlurRadius(s.get_int(`${prefix}-blur-radius`));
            this._renderer.setBrightness(s.get_double(`${prefix}-brightness`));
            this._renderer.setContrast(s.get_double(`${prefix}-contrast`));
            this._renderer.setSaturation(s.get_double(`${prefix}-saturation`));
        };
        this._settingsIds = ['blur-radius', 'brightness', 'contrast', 'saturation']
            .map(key => s.connect(`changed::${prefix}-${key}`, apply));
        apply();
        this._loadShaders();
    }

    async _loadShaders() {
        try {
            await this._renderer.pipelines.load(this._params.extensionPath, this._shaderLoad);
        }
        catch (e) {
            if (!(e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)))
                this._params.logger.error(`[Liquid Glass] Failed to load the icon glass's shaders: ${e}`);
            return;
        }
        this._loaded = true;

        this._host?.queue_redraw();
    }


    attach(host) {
        this._host = host;
        host.add_effect_with_name(BACKDROP_EFFECT_NAME, this);
        this._relays = new RelaySet(host, () => false, this._holder);
        this._mapId = host.connect('notify::mapped', () => this._syncMapped());
        this._syncMapped();
    }

    _syncMapped() {
        if (!this._host?.mapped) {
            stopStageLoop(this._signalSlot, this._firstSlot);
            this._holder.hide();
            this._area = null;
            this._paintedRect = null;
            return;
        }
        this._serialAtMap = this._copier.lastCopy?.serial ?? 0;
        startSyncLoop(this._signalSlot, this._firstSlot, {
            alive: () => !!this._host?.mapped,
            honourFreeze: true,
            errorTag: 'IconBackdrop',
            step: () => this._sync(),
        });
    }



    _rect() {
        const r = this._params.rect();
        const box = this._host?.get_transformed_extents();
        if (!r || !box)
            return null;
        const [bx0, by0] = [Math.floor(box.get_x()), Math.floor(box.get_y())];
        const [bx1, by1] = [Math.ceil(box.get_x() + box.get_width()), Math.ceil(box.get_y() + box.get_height())];
        const x0 = Math.max(Math.floor(r[0] - MARGIN), bx0), y0 = Math.max(Math.floor(r[1] - MARGIN), by0);
        const x1 = Math.min(x0 + Math.ceil((r[2] + MARGIN - x0) / QUANTUM) * QUANTUM, bx1);
        const y1 = Math.min(y0 + Math.ceil((r[3] + MARGIN - y0) / QUANTUM) * QUANTUM, by1);
        return x1 - x0 >= 1 && y1 - y0 >= 1 ? [x0, y0, x1, y1] : null;
    }



    _sync() {
        const rect = this._loaded ? this._paintedRect ?? this._rect() : null;
        const relays = this._relays;
        if (!rect || !relays) {
            if (this._holder.visible)
                this._holder.hide();
            this._area = null;
            return;
        }
        if (!this._holder.visible)
            this._holder.show();
        const m = SAMPLE_MARGIN;
        const area = [rect[0] - m, rect[1] - m, rect[2] - rect[0] + 2 * m, rect[3] - rect[1] + 2 * m];
        const moved = !this._area || area.some((v, i) => v !== this._area[i]);
        this._area = area;
        if (relays.sync(area) || moved)
            relays.redrawArea();
        this._copier.prune(this._host.peek_stage_views());
    }

    vfunc_pre_paint(node, paintContext) {
        const host = this._host;
        const rect = host && this._loaded ? this._rect() : null;
        this._paintedRect = rect;
        if (!host || !rect)
            return true;
        const ctx = coglContext();
        this._renderer.prepare(ctx);
        const serial = this._copier.lastCopy?.serial;
        const { copy, missed } = this._copier.take(host, node, paintContext, rect);

        if (missed)
            host.queue_redraw();
        if (copy && copy.serial !== serial)
            this._params.copied();
        const blur = this._renderer.blur;
        if (!copy?.rect || blur.passCount <= 0)
            return true;
        const w = Math.max(1, Math.round(copy.rect[2] - copy.rect[0]));
        const h = Math.max(1, Math.round(copy.rect[3] - copy.rect[1]));
        const key = [copy.texture, copy.serial];
        if (blur.width === w && blur.height === h && blur.canReuse(key))
            return true;
        if (blur.width !== w || blur.height !== h)
            blur.resize(ctx, w, h);
        if (blur.ready)
            blur.render(node, copy.texture, [0, 0, 1, 1], key);
        return true;
    }


    current() {
        const copy = this._copier.lastCopy;
        if (!copy?.rect || copy.serial <= this._serialAtMap)
            return null;
        const blur = this._renderer.blur;
        return { texture: blur.passCount > 0 && blur.result ? blur.result : copy.texture, rect: copy.rect };
    }


    material() {
        return this._renderer.uniforms.values;
    }

    _materialChanged() {
        this.materialSerial++;
        this._host?.queue_redraw();
    }

    cleanup() {
        stopStageLoop(this._signalSlot, this._firstSlot);
        this._shaderLoad.cancel();
        for (const id of this._settingsIds)
            this._params.settings.disconnect(id);
        this._settingsIds = [];
        if (this._host && this._mapId)
            this._host.disconnect(this._mapId);
        this._mapId = 0;
        this.get_actor()?.remove_effect(this);
        this._host = null;
        this._relays?.clear();
        this._relays = null;
        this._holder.destroy();
        this._copier.clear();
        this._renderer.cleanup();
    }
});
