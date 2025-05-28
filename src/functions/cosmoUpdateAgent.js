const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils'); // ⚠️ Usa badRequest aquí también

app.http('assignAgent', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, target_agent_email;

    try {
      ({ tickets, agent_email, target_agent_email } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON'); // ✅ Usa badRequest
    }

    if (!tickets || !agent_email || !target_agent_email) {
      return badRequest('Your request must include: tickets, agent_email, and target_agent_email'); // ✅ Usa badRequest correctamente
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: existing } = await item.read();
      if (!existing) {
        return error('Ticket not found.', {}, 404); // ✅ Usa status válido
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

      return success('Operation successful.', {
        assigned_agent: target_agent_email
      });

    } catch (err) {
      context.log('❌ Error in assignAgent (PATCH):', err);
      return error('Error assigning agent.', 500, err.message); // ✅ Status y mensaje correctos
    }
  }
});
