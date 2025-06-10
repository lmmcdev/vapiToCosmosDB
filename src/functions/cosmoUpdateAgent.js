const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('assignAgent', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, target_agent_email;

    try {
      ({ tickets, agent_email } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!tickets || !agent_email) {
      return badRequest('Your request must include: tickets, agent_email');
    }

    const container = getContainer();
    const agentContainer = getAgentContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: ticket } = await item.read();
      if (!ticket) {
        return badRequest('Ticket not found.');
      }

      // Obtener datos del agente
      const query = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };
      const { resources: agent } = await agentContainer.items.query(query).fetchAll();
      //const agentItem = agentContainer.item(agent_email, agent_email);
      //const { resource: agent } = await agentItem.read();
      if (!agent) {
        return badRequest(`Target agent not found (${agent_email})`);
      }
      console.log(agent[0].agent_department)
      // Validar coincidencia de departamentos
      if (ticket.assigned_department && agent[0].agent_department !== ticket.assigned_department) {
        return badRequest(
          `Agent's department (${agent[0].agent_department}) does not match ticket's assigned department (${ticket.assigned_department}).`);
      }

      const patchOperations = [];

      patchOperations.push({
        op: 'replace',
        path: '/agent_assigned',
        value: agent_email
      });

      if (!Array.isArray(ticket.notes)) {
        patchOperations.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      patchOperations.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Assigned agent to the ticket: ${agent_email}`
        }
      });

      await item.patch(patchOperations);

      return success('Operation successful.', {
        assigned_agent: agent_email
      });

    } catch (err) {
      context.log('❌ Error in assignAgent (PATCH):', err);
      return error('Error assigning agent.', 500, err.message);
    }
  }
});
