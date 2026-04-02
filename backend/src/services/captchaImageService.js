'use strict';

const zlib = require('zlib');
const { AttachmentBuilder } = require('discord.js');

const WIDTH = 720;
const HEIGHT = 260;
const DIGIT_SPACING = 24;
const DIGIT_WIDTH = 74;
const DIGIT_HEIGHT = 132;
const DIGIT_THICKNESS = 14;
const DIGIT_SEGMENT_MAP = {
  0: ['a', 'b', 'c', 'd', 'e', 'f'],
  1: ['b', 'c'],
  2: ['a', 'b', 'g', 'e', 'd'],
  3: ['a', 'b', 'g', 'c', 'd'],
  4: ['f', 'g', 'b', 'c'],
  5: ['a', 'f', 'g', 'c', 'd'],
  6: ['a', 'f', 'g', 'e', 'c', 'd'],
  7: ['a', 'b', 'c'],
  8: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  9: ['a', 'b', 'c', 'd', 'f', 'g'],
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function hexToRgb(hex) {
  const value = String(hex || '#06b6d4').trim().replace('#', '');
  const normalized = value.length === 6 ? value : '06b6d4';
  return {
    r: clampChannel(Number.parseInt(normalized.slice(0, 2), 16)),
    g: clampChannel(Number.parseInt(normalized.slice(2, 4), 16)),
    b: clampChannel(Number.parseInt(normalized.slice(4, 6), 16)),
  };
}

function mixColor(from, to, ratio) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  return {
    r: clampChannel(from.r + ((to.r - from.r) * safeRatio)),
    g: clampChannel(from.g + ((to.g - from.g) * safeRatio)),
    b: clampChannel(from.b + ((to.b - from.b) * safeRatio)),
  };
}

function setPixel(buffer, width, height, x, y, color, alpha = 1) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;

  const index = ((py * width) + px) * 4;
  const sourceAlpha = Math.max(0, Math.min(1, alpha));
  const inverse = 1 - sourceAlpha;

  buffer[index] = clampChannel((buffer[index] * inverse) + (color.r * sourceAlpha));
  buffer[index + 1] = clampChannel((buffer[index + 1] * inverse) + (color.g * sourceAlpha));
  buffer[index + 2] = clampChannel((buffer[index + 2] * inverse) + (color.b * sourceAlpha));
  buffer[index + 3] = 255;
}

function fillRect(buffer, width, height, x, y, rectWidth, rectHeight, color, alpha = 1) {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      setPixel(buffer, width, height, px, py, color, alpha);
    }
  }
}

function fillCircle(buffer, width, height, centerX, centerY, radius, color, alpha = 1) {
  const safeRadius = Math.max(1, Number(radius) || 1);
  const radiusSquared = safeRadius * safeRadius;
  const startX = Math.max(0, Math.floor(centerX - safeRadius));
  const startY = Math.max(0, Math.floor(centerY - safeRadius));
  const endX = Math.min(width, Math.ceil(centerX + safeRadius));
  const endY = Math.min(height, Math.ceil(centerY + safeRadius));

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const dx = px - centerX;
      const dy = py - centerY;
      if ((dx * dx) + (dy * dy) <= radiusSquared) {
        setPixel(buffer, width, height, px, py, color, alpha);
      }
    }
  }
}

function drawLine(buffer, width, height, x1, y1, x2, y2, color, thickness = 2, alpha = 1) {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY), 1);
  for (let step = 0; step <= steps; step += 1) {
    const x = x1 + ((deltaX * step) / steps);
    const y = y1 + ((deltaY * step) / steps);
    fillCircle(buffer, width, height, x, y, thickness / 2, color, alpha);
  }
}

function drawRoundedFrame(buffer, width, height, color) {
  fillRect(buffer, width, height, 28, 26, width - 56, 4, color, 0.32);
  fillRect(buffer, width, height, 28, height - 30, width - 56, 4, color, 0.18);
  fillRect(buffer, width, height, 26, 28, 4, height - 56, color, 0.22);
  fillRect(buffer, width, height, width - 30, 28, 4, height - 56, color, 0.14);
  fillCircle(buffer, width, height, 34, 34, 12, color, 0.22);
  fillCircle(buffer, width, height, width - 34, 34, 12, color, 0.18);
  fillCircle(buffer, width, height, 34, height - 34, 12, color, 0.16);
  fillCircle(buffer, width, height, width - 34, height - 34, 12, color, 0.12);
}

function drawSegment(buffer, width, height, x, y, segment, color, thickness, digitWidth, digitHeight) {
  const inset = thickness * 0.75;
  const segmentWidth = digitWidth - (thickness * 1.5);
  const verticalHeight = (digitHeight / 2) - (thickness * 1.5);

  switch (segment) {
    case 'a':
      fillRect(buffer, width, height, x + inset, y, segmentWidth, thickness, color, 0.96);
      break;
    case 'b':
      fillRect(buffer, width, height, x + digitWidth - thickness, y + inset, thickness, verticalHeight, color, 0.96);
      break;
    case 'c':
      fillRect(buffer, width, height, x + digitWidth - thickness, y + (digitHeight / 2) + (thickness / 2), thickness, verticalHeight, color, 0.96);
      break;
    case 'd':
      fillRect(buffer, width, height, x + inset, y + digitHeight - thickness, segmentWidth, thickness, color, 0.96);
      break;
    case 'e':
      fillRect(buffer, width, height, x, y + (digitHeight / 2) + (thickness / 2), thickness, verticalHeight, color, 0.96);
      break;
    case 'f':
      fillRect(buffer, width, height, x, y + inset, thickness, verticalHeight, color, 0.96);
      break;
    case 'g':
      fillRect(buffer, width, height, x + inset, y + (digitHeight / 2) - (thickness / 2), segmentWidth, thickness, color, 0.96);
      break;
    default:
      break;
  }
}

function drawDigit(buffer, width, height, x, y, digit, color) {
  const activeSegments = DIGIT_SEGMENT_MAP[String(digit)] || DIGIT_SEGMENT_MAP[8];
  const glow = mixColor(color, { r: 255, g: 255, b: 255 }, 0.35);

  for (const segment of activeSegments) {
    drawSegment(buffer, width, height, x - 2, y - 2, segment, glow, DIGIT_THICKNESS + 4, DIGIT_WIDTH + 4, DIGIT_HEIGHT + 4);
    drawSegment(buffer, width, height, x, y, segment, color, DIGIT_THICKNESS, DIGIT_WIDTH, DIGIT_HEIGHT);
  }
}

function buildImageBuffer(code, hexColor) {
  const width = WIDTH;
  const height = HEIGHT;
  const pixels = Buffer.alloc(width * height * 4);

  const accent = hexToRgb(hexColor);
  const top = mixColor({ r: 7, g: 16, b: 29 }, accent, 0.16);
  const bottom = mixColor({ r: 24, g: 10, b: 44 }, accent, 0.1);
  const panel = mixColor(accent, { r: 255, g: 255, b: 255 }, 0.62);
  const secondary = { r: 168, g: 85, b: 247 };

  for (let y = 0; y < height; y += 1) {
    const ratio = y / Math.max(1, height - 1);
    const row = mixColor(top, bottom, ratio);
    for (let x = 0; x < width; x += 1) {
      const sparkle = ((Math.sin((x / 34) + (y / 53)) + 1) * 0.5) * 16;
      const index = ((y * width) + x) * 4;
      pixels[index] = clampChannel(row.r + sparkle);
      pixels[index + 1] = clampChannel(row.g + (sparkle * 0.8));
      pixels[index + 2] = clampChannel(row.b + (sparkle * 1.2));
      pixels[index + 3] = 255;
    }
  }

  drawRoundedFrame(pixels, width, height, panel);

  drawLine(pixels, width, height, 46, 70, 228, 130, accent, 7, 0.18);
  drawLine(pixels, width, height, 124, 198, 332, 92, secondary, 6, 0.16);
  drawLine(pixels, width, height, 420, 46, 646, 168, accent, 8, 0.14);
  drawLine(pixels, width, height, 376, 196, 656, 104, secondary, 6, 0.12);

  for (let index = 0; index < 22; index += 1) {
    const radius = 3 + ((index * 7) % 10);
    fillCircle(
      pixels,
      width,
      height,
      44 + ((index * 29) % (width - 88)),
      34 + ((index * 47) % (height - 68)),
      radius,
      index % 2 === 0 ? accent : secondary,
      0.08 + ((index % 5) * 0.016)
    );
  }

  const chars = String(code || '').split('');
  const totalWidth = (chars.length * DIGIT_WIDTH) + ((Math.max(chars.length - 1, 0)) * DIGIT_SPACING);
  const startX = Math.round((width - totalWidth) / 2);
  const startY = 62;

  chars.forEach((digit, index) => {
    const digitColor = index % 2 === 0
      ? mixColor(accent, { r: 255, g: 255, b: 255 }, 0.28)
      : mixColor(secondary, { r: 255, g: 255, b: 255 }, 0.14);
    const yOffset = index % 2 === 0 ? 0 : 6;
    drawDigit(
      pixels,
      width,
      height,
      startX + (index * (DIGIT_WIDTH + DIGIT_SPACING)),
      startY + yOffset,
      digit,
      digitColor
    );
  });

  return { width, height, pixels };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const sizeBuffer = Buffer.alloc(4);
  sizeBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([sizeBuffer, typeBuffer, data, crcBuffer]);
}

function toPngBuffer({ width, height, pixels }) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (stride + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, row * stride, (row + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    buildChunk('IHDR', header),
    buildChunk('IDAT', compressed),
    buildChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildCaptchaPngAttachment(code, challengeId, color = '#06b6d4') {
  const fileName = `captcha-${challengeId}.png`;
  const image = buildImageBuffer(code, color);
  const buffer = toPngBuffer(image);
  return new AttachmentBuilder(buffer, { name: fileName });
}

module.exports = {
  buildCaptchaPngAttachment,
};
