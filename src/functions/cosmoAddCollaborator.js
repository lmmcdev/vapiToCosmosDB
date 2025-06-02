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

      // Excluir al assigned agent del array final
      const finalCollaborators = incomingClean.filter(e => e !== assignedAgent);

      // Determinar cambios
      const removed = current.filter(e => !finalCollaborators.includes(e));
      const added = finalCollaborators.filter(e => !current.includes(e));

      // Si no hay cambios reales
      if (removed.length === 0 && added.length === 0) {
        return success('No changes to collaborators.');
      }

      // Patch con nueva lista y nota
      await item.patch([
        {
          op: 'replace',
          path: '/collaborators',
          value: finalCollaborators
        },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email: agent_email || 'SYSTEM',
            event: `Updated collaborators. Added: ${added.join(', ') || 'None'}, Removed: ${removed.join(', ') || 'None'}`
          }
        }
      ]);

      return success('Collaborators updated.', { added, removed });
    } catch (err) {
      return error('Failed to update collaborators', 500, err.message);
    }
  }
});
