const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

app.http('cosmoUpdateCollaborators', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { ticketId, collaborators = [], agent_email } = await req.json();

    if (!ticketId || !Array.isArray(collaborators)) {
      return badRequest('Missing ticketId or collaborators array.');
    }

    const incomingClean = [...new Set(
      collaborators.map(e => e.trim().toLowerCase())
    )];

    const invalid = incomingClean.filter(email => !isValidEmail(email));
    if (invalid.length > 0) {
      return badRequest(`Invalid email(s): ${invalid.join(', ')}`);
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource } = await item.read();
      if (!resource) return notFound('Ticket not found.');

      const current = Array.isArray(resource.collaborators)
        ? resource.collaborators.map(e => e.trim().toLowerCase())
        : [];

      const assignedAgent = resource.assigned_agent?.trim().toLowerCase();

      // Filtrar los que ya existen y excluir al agente asignado
      const newCollaborators = incomingClean.filter(email =>
        !current.includes(email) && email !== assignedAgent
      );

      if (newCollaborators.length === 0) {
        return success('No new collaborators to add.');
      }

      const updated = [...current, ...newCollaborators];

      await item.patch([
        {
          op: 'replace',
          path: '/collaborators',
          value: updated
        },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email: agent_email || 'SYSTEM',
            event: `Added new collaborators: ${newCollaborators.join(', ')}`
          }
        }
      ]);

      return success('Collaborators updated.', { newCollaborators });
    } catch (err) {
      return error('Failed to update collaborators', 500, err.message);
    }
  }
});
