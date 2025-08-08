// shared/dtoHelper.js
const { ticketSchema, mapTicketToDto } = require('../dtos/ticket.dto');

/**
 * Valida un objeto ticket con Joi y devuelve el DTO limpio o lanza BadRequest.
 * @param {object} ticket El ticket crudo desde BD
 * @param {function} badRequestFn La función para devolver badRequest
 * @param {object} context El context de Azure Function para hacer log
 * @returns {object} El objeto validado y limpio
 */
function validateAndFormatTicket(ticket, badRequestFn, context) {
  const dto = mapTicketToDto(ticket);
  const { error: validationError, value: validatedDto } = ticketSchema.validate(dto, {
    stripUnknown: true
  });
  if (validationError) {
    context.log('DTO validation error:', validationError.details);
    throw badRequestFn('Validation failed.', validationError.details);
  }
  return validatedDto;
}

module.exports = { validateAndFormatTicket };
