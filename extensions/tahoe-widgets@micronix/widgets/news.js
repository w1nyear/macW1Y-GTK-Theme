// News widget (macOS Tahoe Top Stories): first RSS item with a picture.
// Generic RSS parsing (title + enclosure/media:content/img), thumbnail
// cached to disk like the QS album art.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';

const OFFSET_KEYS = [
    'news-head-x', 'news-head-y',
    'news-text-x', 'news-text-y',
    'news-thumb-x', 'news-thumb-y',
];

function firstItem(xml) {
    const m = xml.match(/<item[\s>][\s\S]*?<\/item>/i);
    return m ? m[0] : null;
}

function tagText(item, ...tags) {
    for (const t of tags) {
        const m = item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'));
        if (m) {
            let s = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
            s = s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
            if (s)
                return s;
        }
    }
    return '';
}

function tagAttr(item, tag, attr) {
    const m = item.match(new RegExp(`<${tag}[^>]*${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return m ? m[1] : '';
}

function itemImage(item) {
    return tagAttr(item, 'enclosure', 'url')
        || tagAttr(item, 'media:content', 'url')
        || tagAttr(item, 'media:thumbnail', 'url')
        || (() => {
            const m = item.match(/<img[^>]*src\s*=\s*["']([^"']+)["']/i);
            return m ? m[1] : '';
        })();
}

export const NewsWidget = GObject.registerClass({GTypeName: 'Tahoe_NewsWidget_' + Math.floor(Math.random() * 10000000)},
class NewsWidget extends St.Widget {
    _init({settings = null, darkText = false, variant = 'wide', ...rest} = {}) {
        super._init({
            style_class: 'tahoe-widget tahoe-widget-news',
            reactive: true,
            layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL}),
            ...rest,
        });
        this._settings = settings;
        this._head = new St.Label({style_class: 'tw-news-head', text: 'Top Stories'});
        this._body = new St.BoxLayout({style_class: 'tw-news-body', y_expand: true});
        this._textcol = new St.BoxLayout({style_class: 'tw-news-textcol', vertical: true, x_expand: true});
        this._src = new St.Label({style_class: 'tw-news-src', text: ''});
        this._title = new St.Label({style_class: 'tw-news-title', text: '…'});
        try {
            this._title.clutter_text.line_wrap = true;
            this._title.clutter_text.ellipsize = 3;
        } catch (_) {
            // no clutter text
        }
        this._textcol.add_child(this._src);
        this._textcol.add_child(this._title);
        this._thumbBin = new St.Bin({style_class: 'tw-news-thumb'});
        this._body.add_child(this._textcol);
        this._body.add_child(this._thumbBin);
        this.add_child(this._head);
        this.add_child(this._body);
        this.setDarkText(darkText);
        this._session = new Soup.Session({timeout: 25});
        this._timerId = 0;
        this._variant = null;
        this.setVariant(variant);
        this._offsetId = 0;
        if (settings) {
            try {
                this._applyTextOffsets();
                this._offsetId = settings.connect('changed', (_s, key) => {
                    if (OFFSET_KEYS.includes(key))
                        this._applyTextOffsets();
                });
            } catch (_) {
                // static settings
            }
        }
        this.connect('destroy', () => this.destroy());
        this.refresh();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1800, () => {
            try {
                if (!this.get_stage()) {
                    this._timerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            } catch (_) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }
        });
    }

    // Wide: text plus thumbnail. Square: compact text-only card.
    setVariant(v) {
        if (v !== 'wide' && v !== 'square')
            v = 'wide';
        if (this._variant === v)
            return;
        this._variant = v;
        try {
            this._thumbBin.visible = v !== 'square';
        } catch (_) {
            // gone
        }
    }

    getVariantSize() {
        return this._variant === 'square' ? [210, 210] : [NEWS_W, NEWS_H];
    }

    // Crisp resize hook: thumbnail box + image take real pixels.
    setContentScale(s) {
        if (!Number.isFinite(s) || s <= 0)
            return;
        s = Math.max(0.5, Math.min(2.0, s));
        if (this._cscale === s)
            return;
        this._cscale = s;
        try {
            const px = Math.round(96 * s);
            this._thumbBin.set_style(`width: ${px}px; height: ${px}px;`);
            const kid = this._thumbBin.get_child?.();
            if (kid)
                kid.icon_size = px;
        } catch (_) {
            // CSS size stays
        }
    }

    _applyTextOffsets() {
        if (!this._settings)
            return;
        try {
            const get = k => {
                try {
                    return this._settings.get_int(k) || 0;
                } catch (_) {
                    return 0;
                }
            };
            this._head.translation_x = get('news-head-x');
            this._head.translation_y = get('news-head-y');
            this._textcol.translation_x = get('news-text-x');
            this._textcol.translation_y = get('news-text-y');
            this._thumbBin.translation_x = get('news-thumb-x');
            this._thumbBin.translation_y = get('news-thumb-y');
        } catch (_) {
            // gone
        }
    }

    setDarkText(dark) {
        // Headline stays macOS red; source + title need dark ink
        // on a light card.
        for (const child of [this._src, this._title]) {
            child.remove_style_class_name('tw-dark');
            if (dark)
                child.add_style_class_name('tw-dark');
        }
    }

    refresh() {
        try {
            const feed = this._settings?.get_string('news-feed')
                || 'https://feeds.nbcnews.com/nbcnews/public/news';
            this._lastFeed = feed;
            try {
                const host = Gio.File.new_for_uri(feed).get_basename() || feed;
                this._src.text = host.replace(/^www\./, '').split('/')[0].toUpperCase();
            } catch (_) {
                this._src.text = 'NEWS';
            }
            const msg = Soup.Message.new('GET', feed);
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null,
                (session, res) => {
                    try {
                        if (this._lastFeed !== (this._settings?.get_string('news-feed') || feed))
                            return;
                        const bytes = session.send_and_read_finish(res);
                        const xml = new TextDecoder().decode(bytes.get_data());
                        const item = firstItem(xml);
                        if (!item) {
                            this._title.text = 'Feed offline';
                            return;
                        }
                        const title = tagText(item, 'title');
                        this._title.text = title || 'Top story';
                        const img = itemImage(item);
                        if (img)
                            this._loadThumb(img);
                    } catch (e) {
                        this._title.text = 'Feed offline';
                    }
                });
        } catch (e) {
            this._title.text = 'Feed offline';
        }
    }

    _loadThumb(url) {
        try {
            Gio.File.new_for_uri(url).read_bytes_async(2 * 1024 * 1024,
                GLib.PRIORITY_LOW, null, (src, res) => {
                    try {
                        const bytes = src.read_bytes_finish(res);
                        const dir = GLib.build_filenamev(
                            [GLib.get_user_cache_dir(), 'tahoe-widgets']);
                        GLib.mkdir_with_parents(dir, 0o755);
                        const dst = GLib.build_filenamev([dir, 'news.jpg']);
                        const out = Gio.File.new_for_path(dst).replace(
                            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                        out.write_bytes(bytes, null);
                        out.close(null);
                        this._thumbBin.set_child(new St.Icon({
                            gicon: new Gio.FileIcon({file: Gio.File.new_for_path(dst)}),
                            icon_size: 96,
                        }));
                    } catch (_) {
                        // broken image
                    }
                });
        } catch (_) {
            // bad url
        }
    }

    destroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
        if (this._offsetId && this._settings) {
            try {
                this._settings.disconnect(this._offsetId);
            } catch (e) {
                // gone
            }
            this._offsetId = 0;
        }
        try {
            this._session?.abort();
        } catch (e) {
            // ignore
        }
        this._session = null;
        super.destroy();
    }
});

export const NEWS_W = 320;
export const NEWS_H = 180;
