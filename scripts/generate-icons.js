#!/usr/bin/env node
'use strict';

/**
 * Generates shield-shaped PNG icons for the Chrome extension.
 * Pure Node.js — no external dependencies (uses built-in zlib).
 *
 * 4 states x 4 sizes = 16 PNGs:
 *   icon-{active,stopped,paused,unknown}-{16,32,48,128}.png
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.join(__dirname, '..', 'icons');

const STATES = {
	active:  { fill: [67, 160, 71],  outline: [46, 125, 50]  },  // green
	stopped: { fill: [229, 57, 53],  outline: [198, 40, 40]  },  // red
	paused:  { fill: [239, 108, 0],  outline: [230, 81, 0]   },  // orange/amber
	unknown: { fill: [158, 158, 158], outline: [117, 117, 117] }, // gray
};

const SIZES = [16, 32, 48, 128];

// --- Minimal PNG encoder ---

function crc32(buf) {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
	const typeBytes = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const payload = Buffer.concat([typeBytes, data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(payload));
	return Buffer.concat([length, payload, crc]);
}

function encodePNG(width, height, rgba) {
	// PNG signature
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

	// IHDR
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 6;  // color type: RGBA
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace
	const ihdrChunk = makeChunk('IHDR', ihdr);

	// IDAT — raw pixel data with filter byte per row
	const rawRows = [];
	for (let y = 0; y < height; y++) {
		const filterByte = Buffer.from([0]); // none filter
		const row = Buffer.alloc(width * 4);
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;
			row[x * 4]     = rgba[idx];
			row[x * 4 + 1] = rgba[idx + 1];
			row[x * 4 + 2] = rgba[idx + 2];
			row[x * 4 + 3] = rgba[idx + 3];
		}
		rawRows.push(filterByte, row);
	}
	const raw = Buffer.concat(rawRows);
	const compressed = zlib.deflateSync(raw);
	const idatChunk = makeChunk('IDAT', compressed);

	// IEND
	const iendChunk = makeChunk('IEND', Buffer.alloc(0));

	return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// --- Shield shape drawing ---

function drawShield(size, fillColor, outlineColor) {
	const rgba = new Uint8Array(size * size * 4);

	// Shield shape defined as a path at normalized coordinates (0-1).
	// Shield: rounded top, pointed bottom.
	// We use a simple distance-based approach.
	const cx = size / 2;
	const cy = size / 2;

	// Shield boundaries
	const pad = Math.max(1, Math.floor(size * 0.06));
	const left = pad;
	const right = size - pad;
	const top = pad;
	const shieldWidth = right - left;
	const shieldHeight = size - 2 * pad;

	// Top section height (rounded rectangle portion): ~60% of shield
	const topHeight = shieldHeight * 0.55;
	// Bottom point
	const bottomY = top + shieldHeight;
	// Corner radius for top
	const cornerRadius = Math.max(1, Math.floor(shieldWidth * 0.18));

	const outlineWidth = Math.max(1, Math.ceil(size / 16));

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const idx = (y * size + x) * 4;
			let inside = false;

			// Normalized position within shield bounds
			const nx = x;
			const ny = y;

			if (ny >= top && ny <= top + topHeight && nx >= left && nx <= right) {
				// Top rectangular portion with rounded top corners
				inside = true;

				// Check rounded corners
				if (ny < top + cornerRadius) {
					if (nx < left + cornerRadius) {
						// Top-left corner
						const dx = nx - (left + cornerRadius);
						const dy = ny - (top + cornerRadius);
						if (dx * dx + dy * dy > cornerRadius * cornerRadius) inside = false;
					} else if (nx > right - cornerRadius) {
						// Top-right corner
						const dx = nx - (right - cornerRadius);
						const dy = ny - (top + cornerRadius);
						if (dx * dx + dy * dy > cornerRadius * cornerRadius) inside = false;
					}
				}
			} else if (ny > top + topHeight && ny <= bottomY) {
				// Bottom tapered section — narrows to a point
				const progress = (ny - (top + topHeight)) / (bottomY - (top + topHeight));
				const halfWidth = (shieldWidth / 2) * (1 - progress);
				if (nx >= cx - halfWidth && nx <= cx + halfWidth) {
					inside = true;
				}
			}

			if (inside) {
				// Determine if outline or fill
				let isOutline = false;

				// Simple outline: check if near the edge of the shape
				if (inside) {
					for (let dy = -outlineWidth; dy <= outlineWidth && !isOutline; dy++) {
						for (let dx = -outlineWidth; dx <= outlineWidth && !isOutline; dx++) {
							if (dx === 0 && dy === 0) continue;
							const tx = x + dx;
							const ty = y + dy;
							if (tx < 0 || tx >= size || ty < 0 || ty >= size) {
								isOutline = true;
								break;
							}
							// Quick boundary check for the neighbor
							let neighborInside = false;
							if (ty >= top && ty <= top + topHeight && tx >= left && tx <= right) {
								neighborInside = true;
								if (ty < top + cornerRadius) {
									if (tx < left + cornerRadius) {
										const ddx = tx - (left + cornerRadius);
										const ddy = ty - (top + cornerRadius);
										if (ddx * ddx + ddy * ddy > cornerRadius * cornerRadius) neighborInside = false;
									} else if (tx > right - cornerRadius) {
										const ddx = tx - (right - cornerRadius);
										const ddy = ty - (top + cornerRadius);
										if (ddx * ddx + ddy * ddy > cornerRadius * cornerRadius) neighborInside = false;
									}
								}
							} else if (ty > top + topHeight && ty <= bottomY) {
								const progress = (ty - (top + topHeight)) / (bottomY - (top + topHeight));
								const halfWidth = (shieldWidth / 2) * (1 - progress);
								if (tx >= cx - halfWidth && tx <= cx + halfWidth) {
									neighborInside = true;
								}
							}
							if (!neighborInside) {
								isOutline = true;
							}
						}
					}
				}

				const color = isOutline ? outlineColor : fillColor;
				rgba[idx]     = color[0];
				rgba[idx + 1] = color[1];
				rgba[idx + 2] = color[2];
				rgba[idx + 3] = 255;
			} else {
				// Transparent
				rgba[idx]     = 0;
				rgba[idx + 1] = 0;
				rgba[idx + 2] = 0;
				rgba[idx + 3] = 0;
			}
		}
	}

	return rgba;
}

// --- Main ---

if (!fs.existsSync(ICONS_DIR)) {
	fs.mkdirSync(ICONS_DIR, { recursive: true });
}

let count = 0;
for (const [stateName, colors] of Object.entries(STATES)) {
	for (const size of SIZES) {
		const pixels = drawShield(size, colors.fill, colors.outline);
		const png = encodePNG(size, size, pixels);
		const filename = `icon-${stateName}-${size}.png`;
		const filepath = path.join(ICONS_DIR, filename);
		fs.writeFileSync(filepath, png);
		count++;
		console.log(`  ${filename} (${png.length} bytes)`);
	}
}

console.log(`\nGenerated ${count} icons in ${ICONS_DIR}`);
