'use strict';

const express = require('express');
const { requireAuth, validate } = require('../middleware');
const { osintUsernameScanSchema, osintImageScanSchema } = require('../validators/schemas');
const osintService = require('../services/osintService');

const router = express.Router();

function normalizeBase64Image(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  return match ? match[2] : raw;
}

router.get('/status', requireAuth, (req, res) => {
  res.json(osintService.getStatus());
});

router.post('/username', requireAuth, validate(osintUsernameScanSchema), async (req, res) => {
  try {
    const payload = await osintService.scanUsername(req.user.id, req.body.username);
    res.json(payload);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'OSINT username request failed',
      ...(error.raw ? { raw: error.raw } : {}),
    });
  }
});

router.post('/geolocate', requireAuth, validate(osintImageScanSchema), async (req, res) => {
  try {
    const imageBase64 = normalizeBase64Image(req.body.image_base64);

    if (!imageBase64) {
      return res.status(400).json({ error: 'Image manquante' });
    }

    if (imageBase64.length > 7_000_000) {
      return res.status(413).json({ error: 'Image trop volumineuse' });
    }

    const payload = await osintService.geolocateImage(req.user.id, {
      imageBase64,
      mimeType: req.body.mime_type,
    });

    return res.json(payload);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'OSINT geolocation failed',
      ...(error.raw ? { raw: error.raw } : {}),
    });
  }
});

module.exports = router;
