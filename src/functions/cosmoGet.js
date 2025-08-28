const { resolveUserDepartment } = require('./auth/resolveUserDepartment');
const { success, error, badRequest } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { getContainer } = require('../shared/cosmoClient');

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
        const { department, role } = resolveUserDepartment(claims);
        if (!department || !role) {
          return { status: 403, jsonBody: { error: 'User has no role group for any department' } };
        }

        context.log(`✅ User resolved to department=${department}, role=${role}`);

        const container = getContainer();

        // Manejo de parámetro "date"
        const dateParam = req.query.get('date');
        let dateFilter = '';
        let parameters = [];

        if (dateParam) {
          const { from, to } = toDayRange(dateParam);
          dateFilter = 'AND c.createdAt >= @from AND c.createdAt < @to';
          parameters.push({ name: '@from', value: from });
          parameters.push({ name: '@to', value: to });
        }

        // Query según rol dinámico
        let query;
        if (role === 'SUPERVISORS') {
          query = `
            SELECT * FROM c
            WHERE c.assigned_department = @department
              AND LOWER(c.status) != "done"
              ${dateFilter}
          `;
          parameters.push({ name: '@department', value: department });
        } else {
          query = `
            SELECT *
            FROM c
            WHERE (
                  c.agent_assigned = @agentEmail
               OR (c.agent_assigned = "" AND c.assigned_department = @department)
               OR (IS_ARRAY(c.collaborators) AND ARRAY_CONTAINS(c.collaborators, @agentEmail))
                  )
              AND LOWER(c.status) != "done"
              ${dateFilter}
          `;
          parameters.push({ name: '@agentEmail', value: email });
          parameters.push({ name: '@department', value: department });
        }

        const { resources = [] } = await container.items.query({ query, parameters }).fetchAll();

        // DTO tolerante
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
      // 👇 Solo checkea que el user esté en *algún* grupo válido
      groupsAny: Object.values(GROUPS.SWITCHBOARD), 
    }
  ),
});
