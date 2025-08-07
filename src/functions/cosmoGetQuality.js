const { app } = require('@azure/functions');
const { getQAContainer } = require('../shared/cosmoQAClient'); // contenedor QC
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoGetQuality', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const agentEmail = req.query.get('agent_assigned');
      if (!agentEmail) return badRequest("Missing 'agent_assigned' in query.");

      const agentContainer = getAgentContainer();
      const ticketContainer = getQAContainer();

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

      if (agent_rol !== "Quality") return

     
        query = `
          SELECT *
          FROM c
        `;
      

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
