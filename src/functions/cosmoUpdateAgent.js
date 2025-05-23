const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error } = require('../shared/responseUtils');

app.http('assignAgent', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { tickets, agent_email, target_agent_email } = await req.json();

    if (!tickets || !agent_email || !target_agent_email) {
      return error('Your request have missing parameters: tickets, agent_email or target_agent_email.', {}, 400);
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: existing } = await item.read();
      if (!existing) {
        return error('Ticket not found.', {}, 404);
      }

      const patchOperations = [];

      patchOperations.push({
        op: 'replace',
        path: '/agent_assigned',
        value: target_agent_email
      });

      if (!Array.isArray(existing.notes)) {
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
          event: `Assigned agent to the ticket: ${target_agent_email}`
        }
      });

      await item.patch(patchOperations);

      return success({
        message: 'Operation successfull.',
        agente_asignado: target_agent_email
      });

    } catch (err) {
      context.log('❌ Error al asignar agente (PATCH):', err);
      return error('Error assigning agent', err);
    }
  }
});

