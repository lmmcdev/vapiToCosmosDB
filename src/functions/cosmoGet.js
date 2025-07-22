const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const agentEmail = req.query.get('agent_assigned');
      if (!agentEmail) return badRequest("Missing 'agent_assigned' in query.");

      const agentContainer = getAgentContainer();
      const ticketContainer = getContainer();

      // ✅ Buscar agente
      const { resources: agentResult } = await agentContainer.items
        .query({
          query: "SELECT * FROM c WHERE c.agent_email = @agentEmail",
          parameters: [{ name: "@agentEmail", value: agentEmail }]
        })
        .fetchAll();

      if (!agentResult.length) return badRequest("Agent not found.");

      const { agent_department, agent_rol, agent_extension } = agentResult[0];

      let query, parameters;

      if (agent_rol === "Supervisor") {
        query = `
          SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
                 c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
                 c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
                 c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
                 c.tiket_source, c.phone, c.work_time, c.aiClassification, c.createdAt,
                 c.patient_id, c.linked_patient_snapshot
          FROM c
          WHERE c.assigned_department = @department
            AND LOWER(c.status) != "done"
        `;
        parameters = [
          { name: "@department", value: agent_department }
        ];
      } else {
        query = `
          SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
                 c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
                 c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
                 c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
                 c.tiket_source, c.phone, c.work_time, c.aiClassification, c.createdAt,
                 c.patient_id, c.linked_patient_snapshot
          FROM c
          WHERE (
                  (c.agent_assigned = @agentEmail OR c.agent_extension = @agent_extension)
                  OR (c.agent_assigned = "" AND c.assigned_department = @department)
                )
            AND LOWER(c.status) != "done"
        `;
        parameters = [
          { name: "@agentEmail", value: agentEmail },
          { name: "@department", value: agent_department },
          { name: "@agent_extension", value: agent_extension }
        ];
      }

      const { resources: tickets } = await ticketContainer.items
        .query({ query, parameters })
        .fetchAll();

      // ✅ Devolver linked_patient_snapshot siempre presente
      const finalTickets = tickets.map(ticket => ({
        ...ticket,
        linked_patient_snapshot: ticket.linked_patient_snapshot || {}
      }));

      return success(finalTickets);
    } catch (err) {
      context.log('❌ Error al consultar tickets:', err);
      return error('Error al consultar tickets', err);
    }
  }
});
