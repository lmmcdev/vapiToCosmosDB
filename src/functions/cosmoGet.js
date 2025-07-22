const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient');
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
      const patientsContainer = getPatientsContainer();

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

      // 🔍 Buscar todos los patient_id distintos
      const patientIds = tickets
        .map(t => t.patient_id)
        .filter(pid => pid && pid.trim() !== "");

      const uniquePatientIds = [...new Set(patientIds)];
      let patientsMap = new Map();

      if (uniquePatientIds.length > 0) {
        const inClause = uniquePatientIds.map((_, idx) => `@p${idx}`).join(',');
        const patientQuery = `SELECT * FROM c WHERE c.id IN (${inClause})`;
        const patientParams = uniquePatientIds.map((id, idx) => ({ name: `@p${idx}`, value: id }));

        const { resources: patientRecords } = await patientsContainer.items
          .query({ query: patientQuery, parameters: patientParams })
          .fetchAll();

        patientsMap = new Map(patientRecords.map(p => [p.id, p]));
      }

      // ✅ Construir lista final
      const enrichedTickets = tickets.map(ticket => {
        let snapshot = {};
        let patient_id = ticket.patient_id || "";

        if (patient_id && ticket.linked_patient_snapshot && Object.keys(ticket.linked_patient_snapshot).length > 0) {
          snapshot = ticket.linked_patient_snapshot;
        } else if (patient_id && patientsMap.has(patient_id)) {
          const p = patientsMap.get(patient_id);
          snapshot = {
            id: p.id,
            Name: p.Name || "",
            DOB: p.DOB || "",
            Address: p.Address || "",
            Location: p.Location || ""
          };
        } else {
          snapshot = {};
          patient_id = "";
        }

        return {
          ...ticket,
          patient_id,
          linked_patient_snapshot: snapshot
        };
      });

      return success(enrichedTickets);
    } catch (err) {
      context.log('❌ Error al consultar tickets:', err);
      return error('Error al consultar tickets', err);
    }
  }
});
