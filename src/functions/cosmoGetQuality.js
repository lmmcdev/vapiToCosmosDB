// src/functions/cosmoGetQuality/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getQAContainer } = require('../shared/cosmoQAClient');
const { getContainer } = require('../shared/cosmoClient');           // ⬅️ ADD
const { success, badRequest, error } = require('../shared/responseUtils');

// Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// ⚙️ Grupo permitido (Quality)
const { QUALITY: { QUALITY_GROUP } } = GROUPS;

// helper por si algún string viene vacío/undefined
const lc = (s) => (s || '').toLowerCase();

app.http('cosmoGetQuality', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Extraer claims del token
      const claims = context.user || {};

      // 2) Email desde el token (preferred_username / upn / email)
      const email = getEmailFromClaims(claims);
      if (!email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 3) Grupos del token
      const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
      if (!tokenGroups.includes(QUALITY_GROUP)) {
        return { status: 403, jsonBody: { error: 'Insufficient group membership (Quality only)' } };
      }

      context.log(`QA list requested by ${email}. Groups: ${tokenGroups.join(', ')}`);

      // 4) Consulta a Cosmos (QA)
      const qaContainer = getQAContainer();
      const { resources: tickets } = await qaContainer.items
        .query({ query: 'SELECT * FROM c' })
        .fetchAll();

      // 5) Enriquecer con qc (desde el contenedor principal de tickets)
      const mainContainer = getContainer();

      const enriched = await Promise.all(
        (tickets || []).map(async (t) => {
          const id = t?.id || t?.tickets;  // por si en QA guardaste "tickets" como id lógico
          if (!id) {
            return {
              ...t,
              qc: null,
              linked_patient_snapshot: t.linked_patient_snapshot || {}
            };
          }

          try {
            const { resource: mainDoc } = await mainContainer.item(id, id).read();
            const qcNode = mainDoc?.qc ?? null;

            // Usa el snapshot que venga del QA; si no existe, intenta el del doc principal; si no, {}
            const linkedSnap =
              t.linked_patient_snapshot ||
              mainDoc?.linked_patient_snapshot ||
              {};

            return {
              ...t,
              qc: qcNode,
              linked_patient_snapshot: linkedSnap
            };
          } catch (e) {
            context.log(`⚠️ Failed to enrich QC for ticket ${id}: ${e.message}`);
            return {
              ...t,
              qc: null,
              linked_patient_snapshot: t.linked_patient_snapshot || {}
            };
          }
        })
      );

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
