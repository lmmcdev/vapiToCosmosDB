const Joi = require('joi');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Done', 'Emergency', 'Pending', 'Duplicated'];

// ===== DTO de salida (embebido) =====
const DailyStatsOutput = Joi.object({
  id: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),

  agentStats: Joi.array().items(
    Joi.object({
      agentEmail: Joi.alternatives().try(
        Joi.string().email(),
        Joi.string().valid('unassigned')
      ).required(),
      avgResolutionTimeMins: Joi.number().integer().min(0).required(),
      resolvedCount: Joi.number().integer().min(0).required(),
    })
  ).required(),

  globalStats: Joi.object({
    avgResolutionTimeMins: Joi.number().integer().min(0).required(),
    resolvedCount: Joi.number().integer().min(0).required(),
  }).required(),

  hourlyBreakdown: Joi.array().items(
    Joi.object({
      hour: Joi.number().integer().min(0).max(23).required(),
      count: Joi.number().integer().min(0).required(),
    })
  ).required(),

  // Conteo por estado del ticket
  statusCounts: Joi.object(
    Object.fromEntries(ALLOWED_STATUSES.map(s => [s, Joi.number().integer().min(0).required()]))
  ).required(),

  aiClassificationStats: Joi.object({
    priority: Joi.object().pattern(
      Joi.string(),
      Joi.object({
        count: Joi.number().integer().min(0).required(),
        ticketIds: Joi.array().items(Joi.string()).required(),
      })
    ).required(),
    risk: Joi.object().pattern(
      Joi.string(),
      Joi.object({
        count: Joi.number().integer().min(0).required(),
        ticketIds: Joi.array().items(Joi.string()).required(),
      })
    ).required(),
    category: Joi.object().pattern(
      Joi.string(),
      Joi.object({
        count: Joi.number().integer().min(0).required(),
        ticketIds: Joi.array().items(Joi.string()).required(),
      })
    ).required(),
  }).required(),
});