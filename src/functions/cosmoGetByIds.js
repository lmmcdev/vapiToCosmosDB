// src/functions/cosmoGetByIds/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest } = require('../shared/responseUtils');
const { getByIdsInput } = require('./dtos/input.schema');
// ⬇️ usa el helper nuevo y tolerante
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { ACCESS_GROUP: GROUP_REFERRALS_ACCESS } = GROUPS.REFERRALS;

app.http('cosmoGetByIds', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Body -> validar con DTO
      const raw = await req.json().catch(() => ({}));
      const { value, error: dtoErr } = getByIdsInput.validate(raw, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (dtoErr) {
        const details = dtoErr.details?.map(d => d.message).join('; ') || 'Validation error';
        return badRequest(details);
      }

      const { continuationToken = null, limit } = value;
      const ticketIds = [...new Set(Array.isArray(value.ticketIds) ? value.ticketIds : [])].filter(Boolean);

      if (ticketIds.length === 0) {
        return success('No IDs provided', { items: [], continuationToken: null }, 200);
      }

      const ticketContainer = getContainer();

      // 2) Construir IN dinámico y parámetros
      const inClause = ticketIds.map((_, i) => `@id${i}`).join(', ');
      const query = `
        SELECT *
        FROM c
        WHERE c.id IN (${inClause})
      `;
      const parameters = ticketIds.map((id, i) => ({ name: `@id${i}`, value: id }));

      const options = {
        maxItemCount: limit,
        continuationToken,
      };

      // 3) Ejecutar consulta
      const iterator = ticketContainer.items.query({ query, parameters }, options);
      const { resources: items = [], continuationToken: nextToken } = await iterator.fetchNext();

      // 4) Formatear cada ticket con el DTO (tolerante)
      const formatted = [];
      for (const t of items) {
        try {
          const dto = validateAndFormatTicket(t, badRequest, context, { strict: false });
          formatted.push(dto);
        } catch (e) {
          // Con strict:false no debería lanzar, pero si lo hiciera, no rompemos el lote
          context.log('⚠️ Ticket skipped by DTO validation:', t?.id, e?.message);
        }
      }

      // 5) Respuesta
      return success('Tickets fetched', {
        items: formatted,
        continuationToken: nextToken || null,
      }, 200);

    } catch (err) {
      context.log('❌ Error al consultar tickets por IDs:', err);
      return badRequest('Error al consultar tickets por IDs', err?.message || err);
    }
  }, {
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  }),
});
