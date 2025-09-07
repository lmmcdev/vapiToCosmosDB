// dtos/ticket.dto.js
const Joi = require('joi');

// ——— Schemas ———
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

  callback_number: Joi.string().optional().allow('', null),
  caller_id: Joi.string().optional().allow('', null),

  // Permite numérico; convert:true castea desde string numérica
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

  linked_patient_snapshot: Joi.alternatives().try(
    Joi.object().unknown(true), // ✅ permite campos extra adentro
    Joi.valid(null)
  ).optional(),

  quality_control: Joi.any().optional().allow('', null),

  patient_id: Joi.string().uuid().optional().allow(null, ''),

  aiClassification: Joi.alternatives().try(
    Joi.object().unknown(true),
    Joi.valid(null)
  ).optional(),

  transcript: Joi.string().optional().allow('', null),
})
// ✅ aceptamos claves extra en el ticket original, pero recuerda que validamos el DTO mapeado
.unknown(true);

// ——— Sanitizadores básicos ———
const toNumberOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ensureArray = (v) => Array.isArray(v) ? v : [];
const ensureNotesArray = (v) => {
  if (!Array.isArray(v)) return [];
  // Filtra entradas obviamente inválidas para no reventar el validador
  return v.filter(n => n && typeof n === 'object');
};

// ——— Map explícito (pick de campos del DTO) + normalización ———
function mapTicketToDto(ticket = {}) {
  return {
    id: ticket.id,

    summary: ticket.summary ?? null,
    call_reason: ticket.call_reason ?? null,
    creation_date: ticket.creation_date ?? null,

    patient_name: ticket.patient_name ?? null,
    patient_dob: ticket.patient_dob ?? null,

    callback_number: ticket.callback_number ?? null,
    caller_id: ticket.caller_id ?? null,

    call_cost: toNumberOrNull(ticket.call_cost),
    call_duration: toNumberOrNull(ticket.call_duration),

    notes: ensureNotesArray(ticket.notes),
    collaborators: ensureArray(ticket.collaborators),

    url_audio: ticket.url_audio ?? null,

    assigned_department: ticket.assigned_department ?? null,
    assigned_role: ticket.assigned_role ?? null,
    caller_type: ticket.caller_type ?? null,

    status: ticket.status ?? null,
    agent_assigned: ticket.agent_assigned ?? null,

    tiket_source: ticket.tiket_source ?? null,
    phone: ticket.phone ?? null,

    work_time: Array.isArray(ticket.work_time) ? ticket.work_time : [],

    linked_patient_snapshot: (
      ticket.linked_patient_snapshot && typeof ticket.linked_patient_snapshot === 'object'
        ? ticket.linked_patient_snapshot
        : null
    ),

    quality_control: ticket.quality_control ?? null,

    patient_id: ticket.patient_id ?? null,

    aiClassification: (
      ticket.aiClassification && typeof ticket.aiClassification === 'object'
        ? ticket.aiClassification
        : null
    ),

    qc: (ticket.qc && typeof ticket.qc === 'object'
      ? ticket.qc
      : null),

    transcript: ticket.transcript ?? null
  };
}

module.exports = { ticketSchema, mapTicketToDto };