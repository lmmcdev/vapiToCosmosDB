const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

app.http('assignAgent', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, target_agent_email;

    try {
      ({ tickets, agent_email, target_agent_email } = await req.json());
    } catch {
      return badRequest('Invalid JSON.');
    }

    if (!tickets || !agent_email || !target_agent_email) {
      return badRequest('Your request have missing parameters: tickets, agent_email or target_agent_email.');
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return notFound('Ticket not found.');
      }

      const patchOperations = [
        {
          op: 'replace',
          path: '/agent_assigned',
          value: target_agent_email
        }
      ];

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
          event: `Assigned agent: ${target_agent_email}`
        }
      });

      await item.patch(patchOperations);

      return success('Operation successfull', {
        agente_asignado: target_agent_email
      });

    } catch (err) {
      context.log('❌ Error al asignar agente (PATCH):', err);
      return error('Errors assigning agent.', 500, err.message);
    }
  }
});
