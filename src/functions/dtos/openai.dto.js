const Joi = require('joi');

/**
 * DTO de entrada para consultas a OpenAI
 */
const openaiQueryInput = Joi.object({
  systemPrompt: Joi.string()
    .min(10)
    .max(2000)
    .required()
    .label('systemPrompt')
    .messages({
      'string.min': 'System prompt debe tener al menos 10 caracteres',
      'string.max': 'System prompt no puede exceder 2000 caracteres',
      'any.required': 'System prompt es requerido'
    }),
  
  userContent: Joi.string()
    .min(1)
    .max(5000)
    .required()
    .label('userContent')
    .messages({
      'string.min': 'User content no puede estar vacío',
      'string.max': 'User content no puede exceder 5000 caracteres',
      'any.required': 'User content es requerido'
    }),
  
  options: Joi.object({
    temperature: Joi.number()
      .min(0)
      .max(2)
      .default(0)
      .label('options.temperature'),
    
    maxTokens: Joi.number()
      .integer()
      .min(1)
      .max(4000)
      .optional()
      .label('options.maxTokens'),
    
    deploymentName: Joi.string()
      .valid('gpt-35-turbo', 'gpt-4', 'gpt-4-32k')
      .default('gpt-35-turbo')
      .label('options.deploymentName')
  }).default({}).optional()
});

/**
 * DTO de salida para respuestas exitosas de OpenAI
 */
const openaiSuccessOutput = Joi.object({
  success: Joi.boolean().valid(true).required(),
  data: Joi.any().required().label('data'),
  rawResponse: Joi.object({
    usage: Joi.object({
      prompt_tokens: Joi.number().optional(),
      completion_tokens: Joi.number().optional(),
      total_tokens: Joi.number().optional()
    }).optional(),
    model: Joi.string().optional(),
    created: Joi.number().optional()
  }).optional()
});

/**
 * DTO de salida para respuestas de error de OpenAI
 */
const openaiErrorOutput = Joi.object({
  success: Joi.boolean().valid(false).required(),
  error: Joi.string().required().label('error')
});

/**
 * DTO combinado para cualquier respuesta de OpenAI
 */
const openaiOutput = Joi.alternatives().try(
  openaiSuccessOutput,
  openaiErrorOutput
);

/**
 * DTO específico para clasificación de tickets (entrada)
 */
const ticketClassificationInput = Joi.object({
  summary: Joi.string()
    .min(5)
    .max(2000)
    .required()
    .label('summary')
    .messages({
      'string.min': 'Summary debe tener al menos 5 caracteres',
      'string.max': 'Summary no puede exceder 2000 caracteres',
      'any.required': 'Summary es requerido'
    })
});

/**
 * DTO específico para clasificación de tickets (salida)
 */
const ticketClassificationOutput = Joi.object({
  priority: Joi.string()
    .valid('low', 'medium', 'high', 'normal')
    .required(),
  risk: Joi.string()
    .valid('none', 'legal', 'disenrollment')
    .required(),
  category: Joi.string()
    .valid('transport', 'appointment', 'new patient', 'disenrollment', 'customer service', 'new address', 'hospitalization', 'others', 'General')
    .required()
});

/**
 * Función para validar entrada de OpenAI
 */
function validateOpenAIInput(data) {
  return openaiQueryInput.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
}

/**
 * Función para validar salida de OpenAI
 */
function validateOpenAIOutput(data) {
  return openaiOutput.validate(data, {
    abortEarly: false,
    stripUnknown: false,
    convert: true
  });
}

/**
 * Función para validar entrada de clasificación de tickets
 */
function validateTicketClassificationInput(data) {
  return ticketClassificationInput.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
}

/**
 * Función para validar salida de clasificación de tickets
 */
function validateTicketClassificationOutput(data) {
  return ticketClassificationOutput.validate(data, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });
}

module.exports = {
  // Schemas
  openaiQueryInput,
  openaiSuccessOutput,
  openaiErrorOutput,
  openaiOutput,
  ticketClassificationInput,
  ticketClassificationOutput,
  
  // Validation functions
  validateOpenAIInput,
  validateOpenAIOutput,
  validateTicketClassificationInput,
  validateTicketClassificationOutput
};