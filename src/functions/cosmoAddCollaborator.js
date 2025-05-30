const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

//update whole array
app.http('cosmoUpdateCollaborators', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { ticketId, collaborators } = await req.json();

    if (!ticketId || !Array.isArray(collaborators)) {
      return badRequest('Missing ticketId or collaborators array.');
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource } = await item.read();

      if (!resource) return notFound('Ticket not found.');

      await item.patch([
        {
          op: 'replace',
          path: '/collaborators',
          value: collaborators
        },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email: 'SYSTEM',
            event: `Collaborators updated to: ${collaborators.join(', ')}`
          }
        }
      ]);

      return success('Collaborators updated.');
    } catch (err) {
      return error('Failed to update collaborators', 500, err.message);
    }
  }
});
