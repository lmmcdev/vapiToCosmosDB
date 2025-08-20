// dtos/ticket.dto.js
const Joi = require('joi');

const noteSchema = Joi.object({
  datetime: Joi.string().isoDate().required(),
  event_type: Joi.string().required(),
  agent_email: Joi.string().email().optional().allow('', null),
  event: Joi.string().optional().allow('', null),
});

const ticketSchema = Joi.object({
  id: Joi.string().required(),

  summary: Joi.string().optional().allow('', null),
  call_reason: Joi.string().optional().allow('', null),
  creation_date: Joi.string().optional().allow('', null),

  patient_name: Joi.string().optional().allow('', null),
  patient_dob: Joi.string().optional().allow('', null),
  // caller_name: Joi.string().optional().allow('', null),

  callback_number: Joi.string().optional().allow('', null),
  caller_id: Joi.string().optional().allow('', null),

  // Permite numérico o string numérico (Joi convertirá si convert:true)
  call_cost: Joi.number().optional().allow(null),
  call_duration: Joi.number().optional().allow(null),

  notes: Joi.array().items(noteSchema).required().default([]),

  collaborators: Joi.array().items(Joi.string().email()).required().default([]),

  url_audio: Joi.string().uri().optional().allow('', null),

  assigned_department: Joi.string().optional().allow('', null),
  assigned_role: Joi.string().optional().allow('', null),
  caller_type: Joi.string().optional().allow('', null),

  status: Joi.string().optional().allow('', null),
  agent_assigned: Joi.string().email().optional().allow('', null),

  tiket_source: Joi.string().optional().allow('', null),
  phone: Joi.string().optional().allow('', null),

  work_time: Joi.array().optional(),

  // Acepta objeto cualquiera o null
  linked_patient_snapshot: Joi.alternatives().try(
    Joi.object().unknown(true),
    Joi.valid(null)
  ).optional(),

  quality_control: Joi.any().optional().allow('', null),

  // si tu Cosmos guarda otros formatos, puedes relajar esto:
  patient_id: Joi.string().uuid().optional().allow(null, ''),

  aiClassification: Joi.alternatives().try(
    Joi.object().unknown(true),
    Joi.valid(null)
  ).optional(),
})
  // Acepta claves extra (por si aún no las limpiaste: _rid, _etag, _ts…)
  .unknown(true);
  
function mapTicketToDto(ticket) {
  return {
    id: ticket.id,
    summary: ticket.summary,
    call_reason: ticket.call_reason,
    creation_date: ticket.creation_date,
    patient_name: ticket.patient_name,
    patient_dob: ticket.patient_dob,
    // caller_name: ticket.caller_name,
    callback_number: ticket.callback_number,
    caller_id: ticket.caller_id,
    call_cost: ticket.call_cost,
    notes: ticket.notes,
    collaborators: ticket.collaborators,
    url_audio: ticket.url_audio,
    assigned_department: ticket.assigned_department,
    assigned_role: ticket.assigned_role,
    caller_type: ticket.caller_type,
    call_duration: ticket.call_duration,
    status: ticket.status,
    agent_assigned: ticket.agent_assigned,
    tiket_source: ticket.tiket_source,
    phone: ticket.phone,
    work_time: ticket.work_time,
    linked_patient_snapshot: ticket.linked_patient_snapshot,
    quality_control: ticket.quality_control,
    patient_id: ticket.patient_id,
    aiClassification: ticket.aiClassification
  };
}

module.exports = { ticketSchema, mapTicketToDto };
