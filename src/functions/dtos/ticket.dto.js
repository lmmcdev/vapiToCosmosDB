// dtos/ticket.dto.js
const Joi = require('joi');

const noteSchema = Joi.object({
  datetime: Joi.string().isoDate().required(),
  event_type: Joi.string().required(),
  agent_email: Joi.string().optional(),
  event: Joi.string().optional(),
});

const ticketSchema = Joi.object({
  id: Joi.string().required(),
  summary: Joi.string().optional().allow(''),
  call_reason: Joi.string().optional().allow(''),
  creation_date: Joi.string().optional().allow(''),
  patient_name: Joi.string().optional().allow(''),
  patient_dob: Joi.string().optional().allow(''),
  //caller_name: Joi.string().optional(),
  callback_number: Joi.string().optional().allow(''),
  caller_id: Joi.string().optional().allow(''),
  call_cost: Joi.number().optional(),
  notes: Joi.array().items(noteSchema).required(),
  collaborators: Joi.array().items(Joi.string().email()).required(),
  url_audio: Joi.string().uri().optional().allow(''),
  assigned_department: Joi.string().optional().allow(''),
  assigned_role: Joi.string().optional().allow(''),
  caller_type: Joi.string().optional().allow(''),
  call_duration: Joi.number().optional(),
  status: Joi.string().optional().allow(''),
  agent_assigned: Joi.string().email().optional().allow(''),
  tiket_source: Joi.string().optional().allow(''),
  phone: Joi.string().optional().allow(''),
  work_time: Joi.array().optional(),
  linked_patient_snapshot: Joi.any().optional().allow(null),
  quality_control: Joi.any().optional().allow(''),
  patient_id: Joi.string().uuid().optional().allow(null),
  aiClassification: Joi.any().optional().allow(null)
});

function mapTicketToDto(ticket) {
  return {
    id: ticket.id,
    summary: ticket.summary,
    call_reason: ticket.call_reason,
    creation_date: ticket.creation_date,
    patient_name: ticket.patient_name,
    patient_dob: ticket.patient_dob,
    //caller_name: ticket.caller_name,
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