// functions/cosmoGet/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');
// ✅ nuevo helper tolerante (stripUnknown, convert, best-effort)
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const DEPARTMENT = 'Referrals';

const {
  ACCESS_GROUP: GROUP_CUSTOMER_SERVICE,
  SUPERVISORS_GROUP: GROUP_CSERV_SUPERVISORS,
  AGENTS_GROUP: GROUP_CSERV_AGENTS,
} = GROUPS.REFERRALS;

app.http('cosmoGet', {
  route: 'cosmoGet',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (req, context) => {
      try {
        const claims = context.user;

        // 1) Email del token (para filtro en cola de agente)
        const email = getEmailFromClaims(claims);
        if (!email) {
          return { status: 401, jsonBody: { error: 'Email not found in token' } };
        }

        // 2) Rol efectivo a partir de grupos
        const { role } = getRoleGroups(claims, {
          SUPERVISORS_GROUP: GROUP_CSERV_SUPERVISORS,
          AGENTS_GROUP: GROUP_CSERV_AGENTS,
        });
        if (!role) {
          return { status: 403, jsonBody: { error: 'User has no role group for this module' } };
        }

        const container = getContainer();

        // 3) Query según rol
        let query, parameters;

        if (role === 'supervisor') {
          // Supervisor: todos los tickets del departamento (excepto "done")
          query = `
            SELECT *
            FROM c
            WHERE c.assigned_department = @department
              AND LOWER(c.status) != "done"
          `;
          parameters = [{ name: '@department', value: DEPARTMENT }];
        } else {
          // Agente: su cola + no asignados del departamento (excepto "done")
          query = `
            SELECT *
            FROM c
            WHERE (
                  c.agent_assigned = @agentEmail
               OR (c.agent_assigned = "" AND c.assigned_department = @department)
                  )
              AND LOWER(c.status) != "done"
          `;
          parameters = [
            { name: '@agentEmail', value: email },
            { name: '@department', value: DEPARTMENT },
          ];
        }

        const { resources = [] } = await container.items
          .query({ query, parameters })
          .fetchAll();

        // 4) Formatear cada ticket con DTO tolerante (ignora campos extra)
        const final = [];
        for (const t of resources) {
          try {
            const dto = validateAndFormatTicket(t, badRequest, context, { strict: false });
            final.push(dto);
          } catch (e) {
            // Con strict:false no debería lanzar; si lanza, no rompemos todo el batch
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
      // Reforzamos que el token tenga el scope correcto
      scopesAny: ['access_as_user'],
      // Puerta de entrada al módulo: debe pertenecer al grupo del módulo
      groupsAny: [GROUP_CUSTOMER_SERVICE],
      // El rol se resuelve dinámicamente en el handler
    }
  ),
});
