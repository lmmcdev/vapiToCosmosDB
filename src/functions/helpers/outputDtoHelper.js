// shared/dtoHelper.js
const { ticketSchema, mapTicketToDto } = require('../dtos/ticket.dto');

/**
 * Valida un objeto ticket con Joi y devuelve un DTO limpio.
 * - Sólo formatea los campos declarados en el DTO.
 * - Ignora/descarta cualquier otro campo.
 * - Intenta castear tipos (convert: true).
 * - No falla por campos extra en el documento original (se ignoran en el mapping).
 * - Si un campo declarado es inválido (p.ej., notes con objetos mal formados),
 *   Joi puede fallar; para eso pre-sanitizamos (ver mapTicketToDto).
 *
 * @param {object} ticket   El ticket crudo desde BD
 * @param {function} badRequestFn La función para devolver badRequest (no se usa si queremos tolerancia)
 * @param {object} context  context de Azure Function para log
 * @param {object} [options]
 * @param {boolean} [options.strict=false] Si true, lanza BadRequest ante errores de validación
 * @returns {object} El objeto validado y limpio
 */
function validateAndFormatTicket(ticket, badRequestFn, context, options = {}) {
  const { strict = false } = options;

  // 1) Map + sanitize (pick de campos + normalización)
  const dto = mapTicketToDto(ticket);

  // 2) Validación con limpieza
  const { error: validationError, value: validatedDto } = ticketSchema.validate(dto, {
    stripUnknown: true,   // quita cualquier clave no declarada en el schema del DTO
    convert: true,        // castea tipos (string numérica -> number, defaults, etc.)
    abortEarly: false,    // acumula todos los errores
    allowUnknown: false,  // en el DTO no permitimos claves extras (ya las “piqueamos” antes)
  });

  if (validationError) {
    // Log detallado para diagnósticos
    context?.log?.('DTO validation warning:', validationError.details);

    if (strict) {
      // Modo estricto opcional: conserva tu comportamiento anterior
      throw badRequestFn('Validation failed.', validationError.details);
    }

    // Modo tolerante (por defecto): devolvemos lo que sí validó (best-effort)
    // Útil porque estamos formateando una salida, no consumiendo input de usuario.
  }

  return validatedDto;
}

module.exports = { validateAndFormatTicket };
