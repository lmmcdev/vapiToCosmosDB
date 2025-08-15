// functions/cosmoGet/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

DEPARTMENT = "Referrals";

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
        const { role, isSupervisor, isAgent } = getRoleGroups(claims, {
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
          console.log("Supervisor query")
          // Supervisor: todos los tickets del departamento (excepto "done")
          query = `
            SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
                   c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
                   c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
                   c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
                   c.tiket_source, c.phone, c.work_time, c.aiClassification, c.createdAt,
                   c.patient_id, c.linked_patient_snapshot, quality_control
            FROM c
            WHERE c.assigned_department = @department
              AND LOWER(c.status) != "done"
          `;
          parameters = [{ name: "@department", value: DEPARTMENT }];
        } else {
          // Agente: su cola + no asignados del departamento (excepto "done")
          query = `
            SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
                   c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
                   c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
                   c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
                   c.tiket_source, c.phone, c.work_time, c.aiClassification, c.createdAt,
                   c.patient_id, c.linked_patient_snapshot, quality_control
            FROM c
            WHERE (
                  c.agent_assigned = @agentEmail
               OR (c.agent_assigned = "" AND c.assigned_department = @department)
                  )
              AND LOWER(c.status) != "done"
          `;
          parameters = [
            { name: "@agentEmail", value: email },
            { name: "@department", value: DEPARTMENT }
          ];
        }

        const { resources } = await container.items
          .query({ query, parameters })
          .fetchAll();

        const final = resources.map(t => ({
          ...t,
          linked_patient_snapshot: t.linked_patient_snapshot || {}
        }));

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
      // No exigimos "rolesAny" aquí; el rol se resuelve DINÁMICAMENTE por grupos en el handler
    }
  )
});
