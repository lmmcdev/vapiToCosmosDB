// src/functions/cosmoGetQuality/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getQAContainer } = require('../shared/cosmoQAClient');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

// Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// ✅ DTO helper tolerante (stripUnknown, convert, best-effort)
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// Grupo QUALITY
const { QUALITY: { QUALITY_GROUP } } = GROUPS;

// helper por si algún string viene vacío/undefined
const lc = (s) => (s || '').toLowerCase();

app.http('cosmoGetQuality', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Claims
      const claims = context.user || {};

      // 2) Email
      const email = getEmailFromClaims(claims);
      if (!email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 3) Grupo QUALITY
      const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
      if (!tokenGroups.includes(QUALITY_GROUP)) {
        return { status: 403, jsonBody: { error: 'Insufficient group membership (Quality only)' } };
      }

      context.log(`QA list requested by ${email}. Groups: ${tokenGroups.join(', ')}`);

      // 4) Consulta a contenedor de QA (quality_control_tickets)
      const qaContainer = getQAContainer();
      const { resources: tickets = [] } = await qaContainer.items
        .query({ query: 'SELECT * FROM c' })
        .fetchAll();

      // 5) Enriquecer con el documento principal + DTO
      const mainContainer = getContainer();
      const enriched = [];

      for (const t of tickets) {
        const id = t?.id || t?.ticketId || t?.tickets; // soporta variantes de snapshot
        if (!id) {
          // Sin id no podemos leer el principal; devolvemos snapshot con shape mínimo
          // (no rompe, pero no tendrá DTO completo)
          enriched.push({
            // snapshot QA tal cual
            ...t,
            // shape compatible con el front
            qc: null,
            linked_patient_snapshot: t.linked_patient_snapshot || {},
            // meta de lista
            qc_list: {
              startDate: t.startDate || null,
              qc_status: t.qc_status || 'in_review',
              agent_email: t.agent_email || null,
            },
          });
          continue;
        }

        try {
          const { resource: mainDoc } = await mainContainer.item(id, id).read();

          // Base para DTO: si existe mainDoc, usamos ese; si no, el snapshot QA
          const base = mainDoc || t;

          // 🧼 Formateo DTO tolerante (ignora extras, castea)
          const dto = validateAndFormatTicket(base, badRequest, context, { strict: false });

          // Fallback de snapshot enlazado:
          // - preferimos el snapshot del QA (más fresco para la grilla)
          // - si no, el del documento principal
          // - si nada, {}
          const linkedSnap =
            t.linked_patient_snapshot ||
            dto.linked_patient_snapshot ||
            {};

          // Adjuntamos campos auxiliares que no están en el DTO:
          const final = {
            ...dto,
            qc: mainDoc?.qc ?? null, // qc del ticket principal (puede ser null)
            linked_patient_snapshot: linkedSnap,
            qc_list: {
              startDate: t.startDate || null,
              qc_status: t.qc_status || 'in_review',
              agent_email: t.agent_email || null,
            },
          };

          enriched.push(final);
        } catch (e) {
          context.log(`⚠️ Failed to enrich QC for ticket ${id}: ${e.message}`);

          // Si falla la lectura del principal, devolvemos algo razonable con snapshot QA
          const minimal = validateAndFormatTicket(t || { id }, badRequest, context, { strict: false });
          enriched.push({
            ...minimal,
            qc: null,
            linked_patient_snapshot: t?.linked_patient_snapshot || {},
            qc_list: {
              startDate: t?.startDate || null,
              qc_status: t?.qc_status || 'in_review',
              agent_email: t?.agent_email || null,
            },
          });
        }
      }

      // 6) Respuesta
      return success(enriched);
    } catch (err) {
      context.log('❌ Error al consultar Quality tickets:', err);
      return error('Error al consultar tickets', err);
    }
  }, {
    // Requiere token válido y pertenecer al grupo de Quality
    scopesAny: ['access_as_user'],
    groupsAny: [QUALITY_GROUP],
  })
});
