// ./dtos/stats.dto.js
const Joi = require('joi');

const ALLOWED_STATUSES = ['New', 'In Progress', 'Done', 'Emergency', 'Pending', 'Duplicated'];

const CommonStatsBase = {
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

  statusCounts: Joi.object(
    Object.fromEntries(ALLOWED_STATUSES.map(s => [s, Joi.number().integer().min(0).required()]))
  ).optional(),

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
};

// ===== Daily: hourlyBreakdown =====
const DailyStatsOutput = Joi.object({
  id: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),

  hourlyBreakdown: Joi.array().items(
    Joi.object({
      hour: Joi.number().integer().min(0).max(23).required(),
      count: Joi.number().integer().min(0).required(),
    })
  ).required(),

  ...CommonStatsBase,
})
  .unknown(true)
  .prefs({ allowUnknown: true, stripUnknown: true });

// ===== Monthly: dailyBreakdown =====
const MonthlyStatsOutput = Joi.object({
  // IDs típicos: "month-YYYY-MM" o "month-YYYY-MM-final"
  id: Joi.string().pattern(/^month-\d{4}-\d{2}(-final)?$/).required(),
  // fecha de generación (YYYY-MM-DD)
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),

  dailyBreakdown: Joi.array().items(
    Joi.object({
      date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      count: Joi.number().integer().min(0).required(),
    })
  ).required(),

  ...CommonStatsBase,
})
  .unknown(true)
  .prefs({ allowUnknown: true, stripUnknown: true });

module.exports = { DailyStatsOutput, MonthlyStatsOutput };
