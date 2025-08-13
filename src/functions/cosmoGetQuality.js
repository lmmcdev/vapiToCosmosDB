// src/functions/cosmoGetQuality/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getQAContainer } = require('../shared/cosmoQAClient');
const { success, badRequest, error } = require('../shared/responseUtils');

// Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// ⚙️ Grupo permitido (Quality)
const { QUALITY: { QUALITY_GROUP } } = GROUPS;

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

      // Defensa en profundidad: verificar membresía Quality
      if (!tokenGroups.includes(QUALITY_GROUP)) {
        return { status: 403, jsonBody: { error: 'Insufficient group membership (Quality only)' } };
      }

      // (Opcional) Log de auditoría
      context.log(`QA list requested by ${email}. Groups: ${tokenGroups.join(', ')}`);

      // 4) Consulta a Cosmos (QA)
      const ticketContainer = getQAContainer();

      const { resources: tickets } = await ticketContainer.items
        .query({ query: 'SELECT * FROM c' })
        .fetchAll();

      // 5) Normalizar linked_patient_snapshot
      const finalTickets = tickets.map(t => ({
        ...t,
        linked_patient_snapshot: t.linked_patient_snapshot || {}
      }));

      // 6) Respuesta
      return success(finalTickets);
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
