const Joi = require('joi');

// 🟢 Lista de estados válidos para el ticket
const ALLOWED_STATUSES = ['New', 'In Progress', 'Pending', 'Done', 'Blocked'];

// 🟩 Esquema: Asignación de agente
const assignAgentInput = Joi.object({
  ticketId: Joi.string().uuid().required().label('ticketId'),
  agent_email: Joi.string().email().required().label('agent_email'),
  target_agent_email: Joi.string().email().required().label('target_agent_email')
});

// 🟨 Esquema: Registro de tiempo de trabajo
const updateWorkTimeInput = Joi.object({
  tickets: Joi.string().uuid().required().label('ticketId'),
  agent_email: Joi.string().email().required().label('agent_email'),
  workTime: Joi.number().min(0).required().label('workTime'),
  currentStatus: Joi.string().min(2).max(100).required().label('currentStatus')
});

// 🟦 Esquema: Actualización de nombre del paciente
const updatePatientNameInput = Joi.object({
  tickets: Joi.string().uuid().required().label('ticketId'),
  agent_email: Joi.string().email().required().label('agent_email'),
  nuevo_nombreapellido: Joi.string().min(3).max(100).required().label('nuevo_nombreapellido')
});

// 🟥 Esquema: Cambio de estado del ticket
const updateTicketStatusInput = Joi.object({
  ticketId: Joi.string().uuid().required().label('ticketId'),
  newStatus: Joi.string()
    .valid(...ALLOWED_STATUSES)
    .required()
    .label('newStatus'),
  agent_email: Joi.string().email().required().label('agent_email')
});

//update ticket notes
const updateTicketNotesInput = Joi.object({
  ticketId: Joi.string().uuid().required().label('ticketId'),
  agent_email: Joi.string().email().required().label('agent_email'),
  notes: Joi.array()
    .items(
      Joi.object({
        agent_email: Joi.string().email().required().label('agent_email'),
        event: Joi.string().optional().label('event'),
        datetime: Joi.string().isoDate().optional().label('datetime'),
        event_type: Joi.string().valid('user_note', 'system_log').optional().label('event_type')
      })
    )
    .optional()
    .label('notes'),
  event: Joi.string().optional().label('event')
}).custom((value, helpers) => {
  if (!value.notes && !value.event) {
    return helpers.error('any.custom', {
      message: 'At least one of "notes" or "event" must be provided.'
    });
  }
  return value;
}).label('updateTicketNotesInput');


// 🟨 Esquema: Actualización de fecha de nacimiento del paciente
const updatePatientDOBInput = Joi.object({
  tickets: Joi.string().uuid().required().label('tickets'),
  agent_email: Joi.string().email().required().label('agent_email'),
  nueva_fechanacimiento: Joi.string()
    .pattern(/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/)
    .required()
    .label('nueva_fechanacimiento')
    .messages({
      'string.pattern.base': 'Invalid date format. Use MM/DD/YYYY (e.g., 06/15/1985).'
    })
});


// 🟪 Esquema: Actualización del teléfono del paciente
const updatePatientPhoneInput = Joi.object({
  tickets: Joi.string().uuid().required().label('tickets'),
  agent_email: Joi.string().email().required().label('agent_email'),
  new_phone: Joi.string()
    .pattern(/^(\+1\s?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/)
    .required()
    .label('new_phone')
    .messages({
      'string.pattern.base':
        'Invalid US phone number format. Use formats like 555-123-4567 or (555) 123-4567.'
    })
});

// 🟩 Esquema: Actualización del departamento asignado al ticket
const updateTicketDepartmentInput = Joi.object({
  tickets: Joi.string().uuid().required().label('tickets'),
  newDepartment: Joi.string().min(2).max(100).required().label('newDepartment'),
  agent_email: Joi.string().email().required().label('agent_email')
});




module.exports = {
  assignAgentInput,
  updateWorkTimeInput,
  updatePatientNameInput,
  updateTicketStatusInput,
  updateTicketNotesInput,
  updatePatientDOBInput,
  updatePatientPhoneInput,
  updateTicketDepartmentInput,
  ALLOWED_STATUSES
};
