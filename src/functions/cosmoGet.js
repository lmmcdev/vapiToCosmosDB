const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getContainer();

      // Obtener parámetro de la query string
      const agent_assigned = req.query.get('agent_assigned') || "";

      // Construir query dinámicamente
      const querySpec = {
        query: `
          SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
                 c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
                 c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
                 c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
                 c.tiket_source
          FROM c
          WHERE c.agent_assigned = @agent OR c.agent_assigned = ""
        `,
        parameters: [
          { name: "@agent", value: agent_assigned }
        ]
      };

      const { resources: items } = await container.items.query(querySpec).fetchAll();

      return {
        status: 200,
        body: JSON.stringify(items)
      };
    } catch (error) {
      context.log('❌ Error al consultar tickets:', error);
      return {
        status: 500,
        body: `Error: ${error.message}`
      };
    }
  }
});

/*
const agentEmail = "esteban@example.com";
const response = await fetch(`https://<tu-funcion>.azurewebsites.net/api/cosmoGet?agent_assigned=${encodeURIComponent(agentEmail)}`);
const data = await response.json();
*/