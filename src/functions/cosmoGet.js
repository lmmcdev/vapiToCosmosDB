// src/functions/cosmoGet/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');
const { GROUPS } = require('./auth/groups.config');

// helpers para calcular rango de día en ISO
function toDayRange(dateStr) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const from = new Date(base);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(base);
  to.setUTCHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

// 🔹 Extraer todos los ACCESS_GROUPs de los departamentos (multi-depto)
const ALL_ACCESS_GROUPS = Object.values(GROUPS)
  .map((dept) => dept.ACCESS_GROUP)
  .filter(Boolean);

app.http('cosmoGet', {
  route: 'cosmoGet',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (req, context) => {
      try {
        const claims = context.user;
        const email = getEmailFromClaims(claims);
        if (!email) {
          return { status: 401, jsonBody: { error: 'Email not found in token' } };
        }

        // 🔹 Resolver dinámicamente
        const { location, role } = resolveUserDepartment(claims);
        if (!location || !role) {
          console.log(location, role)
          return { status: 403, jsonBody: { error: 'User has no valid location/role' } };
        }

        context.log(`✅ User resolved to location=${location}, role=${role}`);

        //normalize location to lowercase
        const normalizedLocation = location.toLowerCase();
        context.log(`normalized location ${normalizedLocation}`);

        const container = getContainer();

        // 🔹 Param "date"
        const dateParam = req.query.get('date');
        let dateFilter = '';
        let parameters = [];

        if (dateParam) {
          const { from, to } = toDayRange(dateParam);
          dateFilter = 'AND c.createdAt >= @from AND c.createdAt < @to';
          parameters.push({ name: '@from', value: from });
          parameters.push({ name: '@to', value: to });
        }

        // 🔹 Query según rol
        let query;
        if (role === 'SUPERVISORS_GROUP') {
          console.log(`Executing query as supervisor for location: ${location}`);
          query = `
            SELECT *
            FROM c
            WHERE c.caller_id = @location
              AND LOWER(c.status) != "done"
              ${dateFilter}
          `;
          parameters.push({ name: '@location', value: normalizedLocation });
        } else {
          console.log(`Executing query as agent/collaborator for location: ${location}`);
          query = `
            SELECT *
            FROM c
            WHERE (
                  c.agent_assigned = @agentEmail
               OR (c.agent_assigned = "" AND c.caller_id = @location)
               OR (IS_ARRAY(c.collaborators) AND ARRAY_CONTAINS(c.collaborators, @agentEmail))
                  )
              AND LOWER(c.status) != "done"
              ${dateFilter}
          `;
          parameters.push({ name: '@agentEmail', value: email });
          parameters.push({ name: '@location', value: normalizedLocation });
        }

        const { resources = [] } = await container.items.query({ query, parameters }).fetchAll();

        // 🔹 DTO tolerante
        const final = [];
        for (const t of resources) {
          try {
            const dto = validateAndFormatTicket(t, badRequest, context, { strict: false });
            final.push(dto);
          } catch (e) {
            context.log('⚠️ Ticket skipped by DTO validation:', t?.id, e?.message);
          }
        }

        return success(final);
      } catch (err) {
        context.log('❌ Error en cosmoGet:', err);
        return error('Error al consultar tickets', err);
      }
    },
    {
      scopesAny: ['access_as_user'],
      // 👇 acceso permitido a todos los departamentos que tengan ACCESS_GROUP
      groupsAny: ALL_ACCESS_GROUPS,
    }
  ),
});
