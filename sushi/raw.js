/* SPDX-License-Identifier: GPL-2.0-or-later WITH GStreamer-exception-2008
 * SPDX-FileCopyrightText: 2011 Red Hat, Inc. (original src/viewers/image.js)
 * SPDX-FileCopyrightText: 2026 Erick Salamanca (RAW adaptation)
 *
 * RAW image preview for GNOME Sushi, using the embedded JPEG preview
 * extracted by exiv2 (see ../exiv2-thumbnailer.sh, also used
 * by the Nautilus grid-thumbnailer).
 *
 * Called with no size argument -> full-resolution preview (unlike the
 * grid thumbnailer, which passes a size to downscale).
 *
 * Based on GNOME Sushi's built-in src/viewers/image.js (tested against
 * gnome-sushi 50.0 - the legacy GTK3/GJS-`imports` plugin API, loaded from
 * ~/.local/share/sushi/viewers/*.js). See README for compatibility notes
 * on newer Sushi versions (>=51, GTK4/Adwaita/Glycin rewrite, different
 * plugin API in ~/.local/share/sushi/plugins-1/).
 */

const {Gdk, GdkPixbuf, Gio, GLib, GObject, Gtk} = imports.gi;

const Renderer = imports.ui.renderer;

const EXTRACT_SCRIPT = '/usr/local/bin/exiv2-thumbnailer.sh';

var Klass = GObject.registerClass({
    Implements: [Renderer.Renderer],
    Properties: {
        fullscreen: GObject.ParamSpec.boolean('fullscreen', '', '',
                                              GObject.ParamFlags.READABLE,
                                              false),
        ready: GObject.ParamSpec.boolean('ready', '', '',
                                         GObject.ParamFlags.READABLE,
                                         false)
    },
}, class RawImageRenderer extends Gtk.DrawingArea {
    get ready() {
        return !!this._ready;
    }

    get fullscreen() {
        return !!this._fullscreen;
    }

    _init(file) {
        super._init();

        this._cancellable = new Gio.Cancellable();

        this._pix = null;
        this._scaledSurface = null;
        this._timeoutId = 0;
        this._tmpDir = null;

        this._extractPreview(file);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    vfunc_get_preferred_width() {
        return [1, this._pix ? this._pix.get_width() : 1];
    }

    vfunc_get_preferred_height() {
        return [1, this._pix ? this._pix.get_height() : 1];
    }

    vfunc_size_allocate(allocation) {
        super.vfunc_size_allocate(allocation);
        this._ensureScaledPix();
    }

    vfunc_draw(context) {
        if (!this._scaledSurface)
            return false;

        let width = this.get_allocated_width();
        let height = this.get_allocated_height();

        let scaleFactor = this.get_scale_factor();
        let offsetX = (width - this._scaledSurface.getWidth() / scaleFactor) / 2;
        let offsetY = (height - this._scaledSurface.getHeight() / scaleFactor) / 2;

        context.setSourceSurface(this._scaledSurface, offsetX, offsetY);
        context.paint();
        return false;
    }

    _extractPreview(file) {
        let inPath = file.get_path();
        if (!inPath) {
            this.emit('error', new GLib.Error(
                Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED,
                'RAW preview requires a local file'));
            return;
        }

        try {
            this._tmpDir = GLib.dir_make_tmp('sushi-raw-XXXXXX');
        } catch (e) {
            this.emit('error', e);
            return;
        }
        let outPath = GLib.build_filenamev([this._tmpDir, 'preview.png']);

        let proc;
        try {
            proc = Gio.Subprocess.new(
                [EXTRACT_SCRIPT, inPath, outPath],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this.emit('error', e);
            return;
        }

        proc.wait_check_async(this._cancellable, (proc_, res) => {
            let ok = false;
            try {
                ok = proc_.wait_check_finish(res);
            } catch (e) {
                ok = false;
            }

            if (!ok) {
                this.emit('error', new GLib.Error(
                    Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED,
                    'No embedded preview found in RAW file'));
                return;
            }

            this._createImageTexture(Gio.File.new_for_path(outPath));
        });
    }

    _createImageTexture(file) {
        file.read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (obj, res) => {
            try {
                let stream = obj.read_finish(res);
                this._textureFromStream(stream);
            } catch (e) {
                this.emit('error', e);
            }
        });
    }

    _ensureScaledPix() {
        if (!this._pix)
            return;

        let scaleFactor = this.get_scale_factor();
        let width = this.get_allocated_width() * scaleFactor;
        let height = this.get_allocated_height() * scaleFactor;

        let origWidth = this._pix.get_width();
        let origHeight = this._pix.get_height();

        let scaleX = width / origWidth;
        let scaleY = height / origHeight;
        let scale = Math.min(scaleX, scaleY);

        if (!this.fullscreen)
            scale = Math.min(scale, 1.0 * scaleFactor);

        let newWidth = Math.floor(origWidth * scale);
        let newHeight = Math.floor(origHeight * scale);

        let scaledWidth = this._scaledSurface ? this._scaledSurface.getWidth() : 0;
        let scaledHeight = this._scaledSurface ? this._scaledSurface.getHeight() : 0;

        if (newWidth == scaledWidth && newHeight == scaledHeight)
            return;

        let interpType = GdkPixbuf.InterpType.BILINEAR;
        if (scale >= 3.0 * scaleFactor)
            interpType = GdkPixbuf.InterpType.NEAREST;

        let scaledPixbuf = this._pix.scale_simple(newWidth, newHeight, interpType);
        this._scaledSurface = Gdk.cairo_surface_create_from_pixbuf(scaledPixbuf,
                                                                   scaleFactor,
                                                                   this.get_window());
    }

    _setPix(pix) {
        this._pix = pix;
        this._scaledSurface = null;

        this.queue_resize();
        this.isReady();
    }

    _textureFromStream(stream) {
        GdkPixbuf.PixbufAnimation.new_from_stream_async(stream, this._cancellable, (obj, res) => {
            let anim;
            try {
                anim = GdkPixbuf.PixbufAnimation.new_from_stream_finish(res);
            } catch (e) {
                this.emit('error', e);
                return;
            }

            this._iter = anim.get_iter(null);
            this._update();

            stream.close_async(GLib.PRIORITY_DEFAULT, this._cancellable, (obj_, res_) => {
                try {
                    obj_.close_finish(res_);
                } catch (e) {
                    logError(e, 'Unable to close the stream');
                }
                this._cleanupTmpDir();
            });
         });
    }

    _update() {
        this._setPix(this._iter.get_pixbuf().apply_embedded_orientation());

        let delay = this._iter.get_delay_time();
        if (delay == -1)
            return;

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeoutId = 0;
            if (this._iter.advance(null))
                this._update();
            return false;
        });
    }

    get resizePolicy() {
        return Renderer.ResizePolicy.SCALED;
    }

    _cleanupTmpDir() {
        if (!this._tmpDir)
            return;
        try {
            let dir = Gio.File.new_for_path(this._tmpDir);
            let child = dir.get_child('preview.png');
            child.delete(null);
            dir.delete(null);
        } catch (e) {
            // best-effort cleanup, ignore failures
        }
        this._tmpDir = null;
    }

    _onDestroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._cancellable.cancel();
        this._cleanupTmpDir();
    }
});

var mimeTypes = [
    'image/x-3fr', 'image/x-adobe-dng', 'image/x-arw', 'image/x-bay',
    'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-canon-crw',
    'image/x-cap', 'image/x-cr2', 'image/x-crw', 'image/x-dcr',
    'image/x-dcraw', 'image/x-dcs', 'image/x-dng', 'image/x-drf',
    'image/x-eip', 'image/x-erf', 'image/x-fff', 'image/x-fuji-raf',
    'image/x-iiq', 'image/x-k25', 'image/x-kdc', 'image/x-mef',
    'image/x-minolta-mrw', 'image/x-mos', 'image/x-mrw', 'image/x-nef',
    'image/x-nikon-nef', 'image/x-nrw', 'image/x-olympus-orf',
    'image/x-orf', 'image/x-panasonic-raw', 'image/x-panasonic-rw2',
    'image/x-pef', 'image/x-pentax-pef', 'image/x-ptx', 'image/x-pxn',
    'image/x-r3d', 'image/x-raf', 'image/x-raw', 'image/x-rw2',
    'image/x-rwl', 'image/x-rwz', 'image/x-sigma-x3f', 'image/x-sony-arw',
    'image/x-sony-sr2', 'image/x-sony-srf', 'image/x-sr2', 'image/x-srf',
    'image/x-x3f',
];
