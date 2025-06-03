const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error, unauthorized } = require('../shared/responseUtils');

app.http('cosmoUpdateTicketDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { ticketId, new_department, agent_email } = await req.json();

    if (!ticketId || !new_department || !agent_email) {
      return badRequest('Missing parameters: ticketId, new_department, or agent_email.');
    }

    try {
      const agentContainer = getAgentContainer();
      const ticketContainer = getContainer();

      // Buscar al agente
      const { resources: agentResult } = await agentContainer.items
        .query({
          query: "SELECT * FROM c WHERE c.agent_email = @agentEmail",
          parameters: [{ name: "@agentEmail", value: agent_email }]
        })
        .fetchAll();

      if (!agentResult.length) {
        return notFound('Agent not found.');
      }

      const agent = agentResult[0];
      if (agent.agent_rol !== 'Supervisor') {
        return unauthorized('Only supervisors can update ticket departments.');
      }

      // Leer el ticket
      const item = ticketContainer.item(ticketId, ticketId);
      const { resource } = await item.read();
      if (!resource) return notFound('Ticket not found.');

      const previousDepartment = resource.assigned_department || 'Unassigned';

      const patchOps = [];

      // Si no existe assigned_department => agregar, si existe => reemplazar
      if (resource.hasOwnProperty('assigned_department')) {
        patchOps.push({ op: 'replace', path: '/assigned_department', value: new_department });
      } else {
        patchOps.push({ op: 'add', path: '/assigned_department', value: new_department });
      }

      patchOps.push({ op: 'replace', path: '/agent_assigned', value: '' });

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          event: `Department changed from "${previousDepartment}" to "${new_department}" by ${agent_email}`
        }
      });

      await item.patch(patchOps);

      return success('Ticket department updated successfully.');
    } catch (err) {
      context.log('❌ Error updating ticket:', err);
      return error('Error updating ticket department.', 500, err.message);
    }
  }
});
