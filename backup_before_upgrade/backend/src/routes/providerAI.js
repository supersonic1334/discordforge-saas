'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, requireApiProvider, validate } = require('../middleware');
const { providerAiKeySchema, providerAiModelSchema } = require('../validators/schemas');
const aiProviderKeyService = require('../services/aiProviderKeyService');
const { getAICatalog } = require('../config/aiCatalog');
const db = require('../database');
const authService = require('../services/authService');

router.use(requireAuth, requireApiProvider);

router.get('/ai', (req, res) => {
  const keys = aiProviderKeyService.listProviderKeys({ userId: req.user.id });
  res.json({
    keys,
    catalog: getAICatalog(),
    user: {
      id: req.user.id,
      username: req.user.username,
      email: authService.maskEmail(req.user.email),
      role: req.user.role,
    },
  });
});

router.put('/ai', validate(providerAiKeySchema), async (req, res, next) => {
  try {
    const key = await aiProviderKeyService.saveProviderKey(req.user.id, {
      provider: req.body.provider,
      apiKey: req.body.api_key,
      selectedModel: req.body.model,
    });

    res.json({
      message: 'Provider API key saved',
      key,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/ai/:keyId/model', validate(providerAiModelSchema), async (req, res, next) => {
  try {
    const row = db.findOne('ai_provider_keys', { id: req.params.keyId });
    if (!row || row.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Provider key not found' });
    }

    const key = await aiProviderKeyService.updateProviderKeyModel(req.params.keyId, req.body.model);
    res.json({ key, message: 'Provider model updated' });
  } catch (err) {
    next(err);
  }
});

router.post('/ai/:keyId/refresh', async (req, res, next) => {
  try {
    const row = db.findOne('ai_provider_keys', { id: req.params.keyId });
    if (!row || row.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Provider key not found' });
    }

    const key = await aiProviderKeyService.refreshProviderKeyStatus(req.params.keyId);
    res.json({ key });
  } catch (err) {
    next(err);
  }
});

router.delete('/ai/:keyId', async (req, res, next) => {
  try {
    const row = db.findOne('ai_provider_keys', { id: req.params.keyId });
    if (!row || row.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Provider key not found' });
    }

    aiProviderKeyService.deleteProviderKey(req.params.keyId);
    res.json({ message: 'Provider key deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
