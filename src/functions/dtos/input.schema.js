const Joi = require('joi');

// 🟢 Lista de estados válidos para el ticket
const BASE_STATUSES = ['In Progress', 'Pending', 'Emergency'];
const SUPERVISOR_STATUSES = [...BASE_STATUSES, 'Done'];


// 🟩 Esquema: Asignación de agente
const assignAgentInput = Joi.object({
  tickets: Joi.string().uuid().required().label('ticketId'),
  //agent_email: Joi.string().email().required().label('agent_email'),
  target_agent_email: Joi.string().email().required().label('target_agent_email')
});

// 🟨 Esquema: Registro de tiempo de trabajo
const updateWorkTimeInput = Joi.object({
  tickets: Joi.string().uuid().required().label('ticketId'),
  workTime: Joi.number().min(0).required().label('workTime'),
  currentStatus: Joi.string().min(2).max(100).required().label('currentStatus')
});

// 🟦 Esquema: Actualización de nombre del paciente
const updatePatientNameInput = Joi.object({
  tickets: Joi.string().uuid().required().label('ticketId'),
  nuevo_nombreapellido: Joi.string().min(3).max(100).required().label('nuevo_nombreapellido')
});

// 🟥 Esquema: Cambio de estado del ticket
const updateTicketStatusInput = Joi.object({
  ticketId: Joi.string().uuid().required().label('ticketId'),
  newStatus: Joi.alternatives().conditional('$role', {
    is: 'supervisor',
    then: Joi.string().valid(...SUPERVISOR_STATUSES).required(),
    otherwise: Joi.string().valid(...BASE_STATUSES).required(),
  }).label('newStatus'),
});

//update ticket notes
const updateTicketNotesInput = Joi.object({
  ticketId: Joi.string().uuid().required().label('ticketId'),

  notes: Joi.array()
    .items(
      Joi.object({
        //agent_email: Joi.string().email().required().label('note.agent_email'),
        event_type: Joi.string().valid('user_note', 'system_log').required().label('note.event_type'),
        event: Joi.string().min(1).max(1000).required().label('note.content'),
        datetime: Joi.string().isoDate().optional().label('note.datetime')
      })
    )
    .optional()
    .label('notes'),

  event: Joi.string().optional().label('event')
})
  .custom((value, helpers) => {
    if (!value.notes && !value.event) {
      return helpers.error('any.custom', {
        message: 'At least one of "notes" or "event" must be provided.'
      });
    }
    return value;
  })
  .label('updateTicketNotesInput');



// 🟨 Esquema: Actualización de fecha de nacimiento del paciente
const updatePatientDOBInput = Joi.object({
  tickets: Joi.string().uuid().required().label('tickets'),
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
});

//Esquema: Actualizacion de colaboradores del ticket
const updateTicketCollaboratorsInput = Joi.object({
  ticketId: Joi.string().uuid().required().label('ticketId'),
  // Permite vaciar colaboradores pasando [] (para limpiar la lista)
  collaborators: Joi.array()
    .items(Joi.string().email().label('collaborator.email'))
    .required()
    .label('collaborators'),
});


// ---------- dto para busqueda de tickets ----------
const createdAtRange = Joi.object({
  from: Joi.string().isoDate().optional(),
  to:   Joi.string().isoDate().optional(),
}).optional();

const searchBodySchema = Joi.object({
  query:  Joi.string().allow('', null),
  page:   Joi.number().integer().min(1).default(1),
  size:   Joi.number().integer().min(1).max(200).default(50),
  filters: Joi.object({
    status: Joi.string().optional(),
    assigned_department: Joi.string().optional(),
    createdAt: createdAtRange
  }).default({}),
  filter: Joi.string().optional()
});

const getByIdsInput = Joi.object({
  ticketIds: Joi.array()
    .items(Joi.string().uuid().required())
    .min(1)
    .required()
    .label('ticketIds'),
  continuationToken: Joi.string().allow('', null).optional(),
  limit: Joi.number().integer().min(1).max(200).default(10),
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
  BASE_STATUSES, SUPERVISOR_STATUSES,
  updateTicketCollaboratorsInput,
  searchBodySchema,
  getByIdsInput
};
