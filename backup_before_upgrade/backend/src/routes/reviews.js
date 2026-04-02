'use strict';

const express = require('express');
const { requireAuth, validate } = require('../middleware');
const { siteReviewCreateSchema, siteReviewUpdateSchema } = require('../validators/schemas');
const reviewService = require('../services/reviewService');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(reviewService.getOverview(req.user.id));
});

router.post('/', validate(siteReviewCreateSchema), (req, res, next) => {
  try {
    const review = reviewService.createReview(req.user.id, req.body);
    res.status(201).json({
      message: 'Review created',
      review,
      stats: reviewService.getOverview(req.user.id).stats,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/me', validate(siteReviewUpdateSchema), (req, res, next) => {
  try {
    const review = reviewService.updateOwnReviewMessage(req.user.id, req.body);
    res.json({
      message: 'Review updated',
      review,
      stats: reviewService.getOverview(req.user.id).stats,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
