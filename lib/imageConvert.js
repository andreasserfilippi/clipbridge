const convertHeic = require('heic-convert');
const sharp = require('sharp');

const HEIC_QUALITY = 0.85;
const JPEG_QUALITY = 85;

// ISO base media file format "brand" identifiers used by HEIC/HEIF. sharp's
// prebuilt binaries can't decode these (HEVC patent licensing), so they're
// routed through heic-convert (pure JS/WASM) instead.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

function isHeic(buffer) {
  if (buffer.length < 12) return false;
  if (buffer.slice(4, 8).toString('ascii') !== 'ftyp') return false;
  return HEIC_BRANDS.has(buffer.slice(8, 12).toString('ascii'));
}

// Normalizes any input image format (HEIC, PNG, WebP, GIF, existing JPEG,
// etc.) to a JPEG buffer, so every stored entry is viewable on any device
// regardless of which client or original format produced it.
async function toJpeg(buffer) {
  if (isHeic(buffer)) {
    return convertHeic({ buffer, format: 'JPEG', quality: HEIC_QUALITY });
  }
  // .rotate() applies EXIF orientation so photos don't end up sideways.
  return sharp(buffer).rotate().jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

module.exports = { toJpeg, isHeic };
