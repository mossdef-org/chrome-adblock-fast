#!/usr/bin/env node
'use strict';

/**
 * Generates the shipped extension icons from the 1024px design masters.
 * Pure Node.js — no external dependencies (uses built-in zlib).
 *
 * Source of truth: design/icons/master-{active,paused,stopped,unknown}.png
 * (1024x1024 RGBA, transparent background).
 *
 * Per-state recolor recipe (active/paused are recolors of their masters so the
 * shield geometry is shared; stopped/unknown pass through unchanged):
 *   active  : master-active (silver+gold) -> GOLD. Two-zone: the neutral silver
 *             shield body is tinted to amber-gold; the already-gold bolt is
 *             brightened so it still pops against the gold shield.
 *   paused  : master-paused (bright orange) -> SOFT desaturated orange
 *             (HSV saturation x0.65, value x0.94).
 *   stopped : master-stopped (red)  -> unchanged.
 *   unknown : master-unknown (grey) -> unchanged.
 *
 * All four are cropped to a shared alpha bounding box and centered on a square
 * canvas with ~7% margin, so the states line up pixel-for-pixel when the
 * service worker swaps icons. Output: 4 states x 4 sizes = 16 PNGs in icons/.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MASTERS_DIR = path.join(__dirname, '..', 'design', 'icons');
const ICONS_DIR = path.join(__dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128];
const MARGIN = 0.07; // breathing room around the shield, fraction of its longest side

// ── PNG decode (8-bit, non-interlaced, color type 2/6) ──────────────

function decodePNG(buf) {
	const sig = [137, 80, 78, 71, 13, 10, 26, 10];
	for (let i = 0; i < 8; i++)
		if (buf[i] !== sig[i]) throw new Error('not a PNG');

	let off = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
	const idat = [];
	while (off < buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString('ascii', off + 4, off + 8);
		const data = buf.subarray(off + 8, off + 8 + len);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === 'IDAT') {
			idat.push(Buffer.from(data));
		} else if (type === 'IEND') {
			break;
		}
		off += 12 + len;
	}
	if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2))
		throw new Error(`unsupported PNG (depth ${bitDepth}, color ${colorType}, interlace ${interlace})`);

	const channels = colorType === 6 ? 4 : 3;
	const stride = width * channels;
	const raw = zlib.inflateSync(Buffer.concat(idat));

	// Reverse the per-scanline filters into a flat channel buffer.
	const cur = Buffer.alloc(stride);
	const prev = Buffer.alloc(stride);
	const out = new Uint8Array(width * height * 4);
	let rp = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[rp++];
		for (let x = 0; x < stride; x++) {
			const v = raw[rp++];
			const a = x >= channels ? cur[x - channels] : 0; // left
			const b = prev[x];                               // up
			const c = x >= channels ? prev[x - channels] : 0; // upper-left
			let recon;
			switch (filter) {
			case 0: recon = v; break;
			case 1: recon = v + a; break;
			case 2: recon = v + b; break;
			case 3: recon = v + ((a + b) >> 1); break;
			case 4: {
				const p = a + b - c;
				const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				recon = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
				break;
			}
			default: throw new Error('bad filter ' + filter);
			}
			cur[x] = recon & 0xff;
		}
		// expand row to RGBA
		for (let x = 0; x < width; x++) {
			const si = x * channels, di = (y * width + x) * 4;
			out[di] = cur[si];
			out[di + 1] = cur[si + 1];
			out[di + 2] = cur[si + 2];
			out[di + 3] = channels === 4 ? cur[si + 3] : 255;
		}
		cur.copy(prev);
	}
	return { width, height, data: out };
}

// ── PNG encode (RGBA, none filter) ──────────────────────────────────

function crc32(buf) {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(payload));
	return Buffer.concat([len, payload, crc]);
}

function encodePNG(width, height, rgba) {
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; ihdr[9] = 6; // RGBA
	const rows = [];
	for (let y = 0; y < height; y++) {
		rows.push(Buffer.from([0]));
		const row = Buffer.alloc(width * 4);
		for (let x = 0; x < width * 4; x++) row[x] = rgba[y * width * 4 + x];
		rows.push(row);
	}
	const idat = makeChunk('IDAT', zlib.deflateSync(Buffer.concat(rows)));
	return Buffer.concat([signature, makeChunk('IHDR', ihdr), idat, makeChunk('IEND', Buffer.alloc(0))]);
}

// ── Color transforms ────────────────────────────────────────────────

function rgbToHsv(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
	let h = 0;
	if (d) {
		if (mx === r) h = ((g - b) / d) % 6;
		else if (mx === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h /= 6;
		if (h < 0) h += 1;
	}
	return [h, mx === 0 ? 0 : d / mx, mx];
}

function hsvToRgb(h, s, v) {
	const i = Math.floor(h * 6), f = h * 6 - i;
	const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
	let r, g, b;
	switch (i % 6) {
	case 0: r = v; g = t; b = p; break;
	case 1: r = q; g = v; b = p; break;
	case 2: r = p; g = v; b = t; break;
	case 3: r = p; g = q; b = v; break;
	case 4: r = t; g = p; b = v; break;
	default: r = v; g = p; b = q; break;
	}
	return [r * 255, g * 255, b * 255];
}

const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v;

// active: tint neutral silver shield -> amber-gold; brighten the gold bolt.
function recolorActive(d) {
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i], g = d[i + 1], b = d[i + 2];
		const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
		const sat = mx > 0 ? (mx - mn) / mx : 0;
		if (sat < 0.22) {
			const L = (r + g + b) / 3;
			d[i] = clamp(L * 0.95); d[i + 1] = clamp(L * 0.70); d[i + 2] = clamp(L * 0.26);
		} else {
			d[i] = clamp(r * 1.12 + 18); d[i + 1] = clamp(g * 1.10 + 16); d[i + 2] = clamp(b * 0.85 + 6);
		}
	}
}

// paused: soft / desaturated orange.
function recolorPaused(d) {
	for (let i = 0; i < d.length; i += 4) {
		const [h, s, v] = rgbToHsv(d[i], d[i + 1], d[i + 2]);
		const [r, g, b] = hsvToRgb(h, Math.min(1, s * 0.65), Math.min(1, v * 0.94));
		d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
	}
}

const RECOLOR = { active: recolorActive, paused: recolorPaused, stopped: null, unknown: null };

// ── Geometry: crop to alpha bbox, center on square canvas ───────────

function alphaBBox(img) {
	const { width: w, height: h, data: d } = img;
	let x0 = w, y0 = h, x1 = -1, y1 = -1;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			if (d[(y * w + x) * 4 + 3] > 0) {
				if (x < x0) x0 = x; if (x > x1) x1 = x;
				if (y < y0) y0 = y; if (y > y1) y1 = y;
			}
	return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function cropToCanvas(img, bb, canvas) {
	const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
	const ox = Math.floor((canvas - w) / 2), oy = Math.floor((canvas - h) / 2);
	const out = new Uint8Array(canvas * canvas * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const si = ((bb.y0 + y) * img.width + (bb.x0 + x)) * 4;
			const di = ((oy + y) * canvas + (ox + x)) * 4;
			out[di] = img.data[si]; out[di + 1] = img.data[si + 1];
			out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
		}
	return { width: canvas, height: canvas, data: out };
}

// ── High-quality downscale: separable area filter, premultiplied alpha ──

// One separable pass over `axis` ('x' or 'y'), operating on a premultiplied
// Float64 buffer [pr, pg, pb, a]. Area sampling = exact for downscaling.
function resampleAxis(src, w, h, dw, dh, axis) {
	const out = new Float64Array(dw * dh * 4);
	if (axis === 'x') {
		const scale = w / dw;
		for (let y = 0; y < h; y++)
			for (let ox = 0; ox < dw; ox++) {
				const s = ox * scale, e = s + scale;
				let pr = 0, pg = 0, pb = 0, pa = 0;
				for (let xi = Math.floor(s); xi < Math.ceil(e); xi++) {
					const wgt = Math.min(e, xi + 1) - Math.max(s, xi);
					const si = (y * w + xi) * 4;
					pr += src[si] * wgt; pg += src[si + 1] * wgt;
					pb += src[si + 2] * wgt; pa += src[si + 3] * wgt;
				}
				const di = (y * dw + ox) * 4;
				out[di] = pr / scale; out[di + 1] = pg / scale;
				out[di + 2] = pb / scale; out[di + 3] = pa / scale;
			}
	} else {
		const scale = h / dh;
		for (let oy = 0; oy < dh; oy++) {
			const s = oy * scale, e = s + scale;
			for (let x = 0; x < w; x++) {
				let pr = 0, pg = 0, pb = 0, pa = 0;
				for (let yi = Math.floor(s); yi < Math.ceil(e); yi++) {
					const wgt = Math.min(e, yi + 1) - Math.max(s, yi);
					const si = (yi * w + x) * 4;
					pr += src[si] * wgt; pg += src[si + 1] * wgt;
					pb += src[si + 2] * wgt; pa += src[si + 3] * wgt;
				}
				const di = (oy * w + x) * 4;
				out[di] = pr / scale; out[di + 1] = pg / scale;
				out[di + 2] = pb / scale; out[di + 3] = pa / scale;
			}
		}
	}
	return out;
}

function resize(img, size) {
	const { width: w, height: h, data: d } = img;
	// premultiply
	const pm = new Float64Array(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		const a = d[i * 4 + 3], f = a / 255;
		pm[i * 4] = d[i * 4] * f; pm[i * 4 + 1] = d[i * 4 + 1] * f;
		pm[i * 4 + 2] = d[i * 4 + 2] * f; pm[i * 4 + 3] = a;
	}
	const hPass = resampleAxis(pm, w, h, size, h, 'x');
	const vPass = resampleAxis(hPass, size, h, size, size, 'y');
	// unpremultiply + round
	const out = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const a = vPass[i * 4 + 3];
		if (a > 0) {
			const f = 255 / a;
			out[i * 4] = clamp(Math.round(vPass[i * 4] * f));
			out[i * 4 + 1] = clamp(Math.round(vPass[i * 4 + 1] * f));
			out[i * 4 + 2] = clamp(Math.round(vPass[i * 4 + 2] * f));
		}
		out[i * 4 + 3] = clamp(Math.round(a));
	}
	return { width: size, height: size, data: out };
}

// ── Main ────────────────────────────────────────────────────────────

const STATES = Object.keys(RECOLOR);
const masters = {};
for (const st of STATES)
	masters[st] = decodePNG(fs.readFileSync(path.join(MASTERS_DIR, `master-${st}.png`)));

// Recolor in place.
for (const st of STATES)
	if (RECOLOR[st]) RECOLOR[st](masters[st].data);

// Shared bbox (union across states) -> identical alignment.
let bb = null;
for (const st of STATES) {
	const b = alphaBBox(masters[st]);
	bb = bb ? { x0: Math.min(bb.x0, b.x0), y0: Math.min(bb.y0, b.y0),
		x1: Math.max(bb.x1, b.x1), y1: Math.max(bb.y1, b.y1) } : b;
}
const sw = bb.x1 - bb.x0, sh = bb.y1 - bb.y0;
const canvas = Math.max(sw, sh) + 2 * Math.floor(Math.max(sw, sh) * MARGIN);

if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

let count = 0;
for (const st of STATES) {
	const squared = cropToCanvas(masters[st], bb, canvas);
	for (const size of SIZES) {
		const png = encodePNG(size, size, resize(squared, size).data);
		const filename = `icon-${st}-${size}.png`;
		fs.writeFileSync(path.join(ICONS_DIR, filename), png);
		count++;
		console.log(`  ${filename} (${png.length} bytes)`);
	}
}
console.log(`\nGenerated ${count} icons in ${ICONS_DIR} from ${MASTERS_DIR}`);
