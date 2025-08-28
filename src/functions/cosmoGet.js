// functions/cosmoGet/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');
// DTO helper tolerante
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const DEPARTMENT = 'Referrals';

const {
  ACCESS_GROUP: GROUP_CUSTOMER_SERVICE,
  SUPERVISORS_GROUP: GROUP_CSERV_SUPERVISORS,
  AGENTS_GROUP: GROUP_CSERV_AGENTS,
} = GROUPS.SWITCHBOARD;

// helpers para calcular rango de día en ISO
const toDayRange = (dateStr) => {
  const base = dateStr ? new Date(dateStr) : new Date(); // usa hoy si no se pasa
  const from = new Date(base);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(base);
  to.setUTCHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
};

app.http('cosmoGet', {
  route: 'cosmoGet',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (req, context) => {
      try {
        const claims = context.user;

        // 1) Email del token
        const email = getEmailFromClaims(claims);
        if (!email) {
          return { status: 401, jsonBody: { error: 'Email not found in token' } };
        }

        // 2) Rol efectivo
        const { role } = getRoleGroups(claims, {
          SUPERVISORS_GROUP: GROUP_CSERV_SUPERVISORS,
          AGENTS_GROUP: GROUP_CSERV_AGENTS,
        });
        if (!role) {
          return { status: 403, jsonBody: { error: 'User has no role group for this module' } };
        }

        const container = getContainer();

        // 3) Manejo de parámetro "date"
        const dateParam = req.query.get('date');
        let dateFilter = '';
        let parameters = [];

        if (dateParam) {
          const { from, to } = toDayRange(dateParam);
          dateFilter = 'AND c.createdAt >= @from AND c.createdAt < @to';
          parameters.push({ name: '@from', value: from });
          parameters.push({ name: '@to', value: to });
        }

        // 4) Query según rol
        let query;
        if (role === 'supervisor') {
          query = `
            SELECT *
            FROM c
            WHERE c.assigned_department = @department
              AND LOWER(c.status) != "done"
              ${dateFilter}
          `;
          parameters.push({ name: '@department', value: DEPARTMENT });
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
          parameters.push({ name: '@department', value: DEPARTMENT });
        }

        // 5) Ejecutar consulta
        const { resources = [] } = await container.items
          .query({ query, parameters })
          .fetchAll();

        // 6) DTO tolerante
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
      groupsAny: [GROUP_CUSTOMER_SERVICE],
    }
  ),
});
