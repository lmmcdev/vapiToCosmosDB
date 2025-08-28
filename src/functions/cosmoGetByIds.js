// src/functions/cosmoGetByIds/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest } = require('../shared/responseUtils');
const { getByIdsInput } = require('./dtos/input.schema');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');

// 🔑 Construir lista de TODOS los ACCESS_GROUP de cada módulo
const ALL_ACCESS_GROUPS = Object.values(GROUPS)
  .map(mod => mod.ACCESS_GROUP)
  .filter(Boolean);

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

      // 4) Resuelve el departamento del usuario (para logging/auditoría)
      const claims = context.user;
      const { department, role } = resolveUserDepartment(claims) || { department: 'Unknown', role: 'Unknown' };
      context.log(`📌 User department resolved: ${department}`);

      // 5) Formatear cada ticket con el DTO (tolerante)
      const formatted = [];
      for (const t of items) {
        try {
          const dto = validateAndFormatTicket(t, badRequest, context, { strict: false });
          formatted.push(dto);
        } catch (e) {
          context.log('⚠️ Ticket skipped by DTO validation:', t?.id, e?.message);
        }
      }

      // 6) Respuesta
      return success('Tickets fetched', {
        department,
        items: formatted,
        continuationToken: nextToken || null,
      }, 200);

    } catch (err) {
      context.log('❌ Error al consultar tickets por IDs:', err);
      return badRequest('Error al consultar tickets por IDs', err?.message || err);
    }
  }, {
    // 🔐 Acceso a todos los grupos ACCESS definidos en groups.config
    scopesAny: ['access_as_user'],
    groupsAny: ALL_ACCESS_GROUPS,
  }),
});
