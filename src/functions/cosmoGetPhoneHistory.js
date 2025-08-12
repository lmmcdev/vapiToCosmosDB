// src/functions/cosmoGetPhoneHistory/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

const {
  ACCESS_GROUP: GROUP_REFERRALS_ACCESS,
  SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
  AGENTS_GROUP: GROUP_REFERRALS_AGENTS, // por si luego necesitas distinguir
} = GROUPS.REFERRALS;

const lc = (s) => (s || '').toLowerCase();

app.http('cosmoGetPhoneHistory', {
  route: 'cosmoGetPhoneHistory',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Actor desde el token
      const claims = context.user;
      const actorEmail = getEmailFromClaims(claims);
      if (!actorEmail) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Rol por grupos (supervisor/agent)
      const { isSupervisor } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
        AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
      });

      // 3) Validar query param
      const phone = req.query.get('phone');
      if (!phone) {
        return badRequest('Missing required query parameter: phone');
      }

      // 4) Consultar por teléfono
      const container = getContainer();
      const { resources: allByPhone } = await container.items
        .query({
          query: `
            SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
                   c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
                   c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
                   c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
                   c.tiket_source, c.phone, c.work_time
            FROM c
            WHERE c.phone = @phone
          `,
          parameters: [{ name: '@phone', value: phone }],
        })
        .fetchAll();

      // 5) Filtro de autorización por ítem (si NO es supervisor)
      let items;
      if (isSupervisor) {
        items = allByPhone;
      } else {
        const me = lc(actorEmail);
        items = allByPhone.filter((t) => {
          const assigned = lc(t.agent_assigned) === me;
          const collaborator =
            Array.isArray(t.collaborators) &&
            t.collaborators.map(lc).includes(me);
          return assigned || collaborator;
        });
      }

      return success('Records retrieved successfully', { items });
    } catch (err) {
      context.log('❌ Error fetching phone history:', err);
      return error('Error fetching phone history', 500, err?.message || 'Unknown');
    }
  }, {
    // 🔐 Protecciones a nivel de endpoint
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  })
});
