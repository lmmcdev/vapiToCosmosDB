// src/functions/cosmoGetByIds/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest } = require('../shared/responseUtils');
const Joi = require('joi');

// Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const {
  ACCESS_GROUP: GROUP_REFERRALS_ACCESS,
} = GROUPS.REFERRALS;

/** DTO de entrada */
const getByIdsInput = Joi.object({
  ticketIds: Joi.array()
    .items(Joi.string().uuid().required())
    .min(1)
    .required()
    .label('ticketIds'),
  continuationToken: Joi.string().allow('', null).optional(),
  limit: Joi.number().integer().min(1).max(200).default(10),
});

app.http('cosmoGetByIds', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // Body -> validar con DTO
      const raw = await req.json().catch(() => ({}));
      const { value, error: dtoErr } = getByIdsInput.validate(raw, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (dtoErr) {
        const details = dtoErr.details?.map(d => d.message).join('; ') || 'Validation error';
        return badRequest(details);
      }

      // Datos validados
      const { continuationToken = null, limit } = value;
      const ticketIds = [...new Set(value.ticketIds)]; // dedup

      const ticketContainer = getContainer();

      // Construir IN dinámico
      const inClause = ticketIds.map((_, i) => `@id${i}`).join(', ');
      const query = `
        SELECT c.id, c.summary, c.tickets, c.call_reason, c.creation_date, c.patient_name,
               c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
               c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
               c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
               c.tiket_source, c.phone, c.work_time, c.aiClassification, c.createdAt,
               c.patient_id, c.linked_patient_snapshot, c.quality_control
        FROM c
        WHERE c.id IN (${inClause})
      `;

      const parameters = ticketIds.map((id, i) => ({
        name: `@id${i}`,
        value: id,
      }));

      const options = {
        maxItemCount: limit,
        continuationToken,
      };

      const iterator = ticketContainer.items.query({ query, parameters }, options);
      const { resources: items, continuationToken: nextToken } = await iterator.fetchNext();

      return success({
        items,
        continuationToken: nextToken || null,
      });
    } catch (err) {
      context.log('❌ Error al consultar tickets por IDs:', err);
      return badRequest('Error al consultar tickets por IDs', err?.message || err);
    }
  }, {
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  }),
});
