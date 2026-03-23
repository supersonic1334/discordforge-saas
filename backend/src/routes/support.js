'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, validate, validateQuery } = require('../middleware');
const {
  supportTicketListSchema,
  supportTicketCreateSchema,
  supportTicketMessageSchema,
  supportTicketStatusSchema,
  supportTicketUpdateSchema,
} = require('../validators/schemas');
const supportService = require('../services/supportService');

router.use(requireAuth);

router.get('/tickets', validateQuery(supportTicketListSchema), (req, res, next) => {
  try {
    res.json(supportService.listTickets(req.user, req.query));
  } catch (error) {
    next(error);
  }
});

router.post('/tickets', validate(supportTicketCreateSchema), (req, res, next) => {
  try {
    const detail = supportService.createTicket(req.user, req.body);
    res.status(201).json({
      message: 'Ticket cree',
      ...detail,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/tickets/:ticketId', (req, res, next) => {
  try {
    res.json(supportService.getTicketDetail(req.user, req.params.ticketId));
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/:ticketId/messages', validate(supportTicketMessageSchema), (req, res, next) => {
  try {
    res.json({
      message: 'Reponse envoyee',
      ...supportService.addTicketMessage(req.user, req.params.ticketId, req.body.message),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tickets/:ticketId/claim', (req, res, next) => {
  try {
    res.json({
      message: 'Ticket reclame',
      ...supportService.claimTicket(req.user, req.params.ticketId),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/tickets/:ticketId/claim', (req, res, next) => {
  try {
    res.json({
      message: 'Ticket libere',
      ...supportService.unclaimTicket(req.user, req.params.ticketId),
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/tickets/:ticketId/status', validate(supportTicketStatusSchema), (req, res, next) => {
  try {
    res.json({
      message: 'Statut mis a jour',
      ...supportService.setTicketStatus(req.user, req.params.ticketId, req.body.status),
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/tickets/:ticketId', validate(supportTicketUpdateSchema), (req, res, next) => {
  try {
    res.json({
      message: 'Ticket mis a jour',
      ...supportService.updateTicket(req.user, req.params.ticketId, req.body),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/tickets/:ticketId', (req, res, next) => {
  try {
    res.json({
      message: 'Ticket supprime',
      ...supportService.deleteTicket(req.user, req.params.ticketId),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/messages/:messageId', (req, res, next) => {
  try {
    res.json({
      message: 'Message supprime',
      ...supportService.deleteTicketMessage(req.user, req.params.messageId),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
