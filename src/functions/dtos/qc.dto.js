// CommonJS
const Joi = require('joi');

const rubricSchema = Joi.object({
  compliance:    Joi.number().integer().min(0).max(3).required(),
  accuracy:      Joi.number().integer().min(0).max(3).required(),
  process:       Joi.number().integer().min(0).max(3).required(),
  softSkills:    Joi.number().integer().min(0).max(3).required(),
  documentation: Joi.number().integer().min(0).max(3).required(),
  comments:      Joi.string().trim().allow('', null),
});

const upsertQcInput = Joi.object({
  // Si tus IDs no son UUID, cambia a: Joi.string().min(1)
  ticketId: Joi.string().guid({ version: ['uuidv4', 'uuidv5'] })
    .required()
    .messages({ 'string.guid': 'ticketId must be a UUID' }),

  rubric:  rubricSchema.optional(),
  // Resultado final de la revisión
  outcome: Joi.string().valid('passed', 'failed', 'coaching_required').optional(),
  // Estado operativo del panel QC
  status:  Joi.string().valid('pending', 'in_review', 'passed', 'failed', 'coaching_required').optional(),
})
  // Al menos uno: rubric / outcome / status
  .or('rubric', 'outcome', 'status');

module.exports = { upsertQcInput };
