import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

test('QR Code Engine — RFC-compliant matrix generation and decoding', async (t) => {
  await t.test('generates valid vector SVG with correct xml and svg tags', async () => {
    const targetUrl = 'https://operza.io/vip-consult';
    const svg = await QRCode.toString(targetUrl, {
      type: 'svg',
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    assert.ok(svg.includes('<svg'), 'SVG output must include <svg root element');
    assert.ok(svg.includes('viewBox="0 0'), 'SVG output must include viewBox');
    assert.ok(svg.includes('path'), 'SVG output must include QR matrix path coordinates');
  });

  await t.test('generates scannable raster QR code decodable by jsQR (Task 0.9 DoD)', async () => {
    const targetUrl = 'https://operza.io/campaign/promo-2026?source=qr-poster';
    const pngBuffer = await QRCode.toBuffer(targetUrl, {
      type: 'png',
      width: 300,
      margin: 4,
      errorCorrectionLevel: 'M'
    });

    assert.ok(Buffer.isBuffer(pngBuffer), 'Output must be a binary buffer');
    assert.ok(pngBuffer.length > 100, 'PNG buffer must have non-trivial size');

    // Decode PNG buffer using pngjs
    const png = PNG.sync.read(pngBuffer);
    assert.ok(png.width > 0 && png.height > 0, 'Decoded PNG must have valid dimensions');

    // Decode QR matrix using jsQR
    const clampedArray = new Uint8ClampedArray(png.data);
    const decoded = jsQR(clampedArray, png.width, png.height);

    assert.ok(decoded, 'jsQR must successfully decode the generated QR matrix');
    assert.equal(decoded.data, targetUrl, 'Decoded payload must exactly match the original target URL');
  });

  await t.test('handles alphanumeric, UTF-8, and deep-link payload targets', async () => {
    const payloads = [
      'TEL:+18005550199',
      'SMSTO:+18005550199:Hello Operza',
      'https://operza.io/book/discovery-strategy#step=2&utm=verified'
    ];

    for (const payload of payloads) {
      const pngBuffer = await QRCode.toBuffer(payload, {
        type: 'png',
        width: 250,
        margin: 2,
        errorCorrectionLevel: 'M'
      });
      const png = PNG.sync.read(pngBuffer);
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      assert.ok(decoded, `jsQR must decode payload: ${payload}`);
      assert.equal(decoded.data, payload);
    }
  });
});
