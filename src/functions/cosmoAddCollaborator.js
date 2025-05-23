const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

app.http('addCollaborator', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, new_collaborators;

    try {
      ({ tickets, agent_email, new_collaborators } = await req.json());
    } catch {
      return badRequest('Invalid JSON.');
    }

    if (!tickets || !agent_email || !Array.isArray(new_collaborators)) {
      return badRequest('Your request have missing parameters or new_collaborators is not an array.');
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return notFound('Ticket not found.');
      }

      const existingCollaborators = Array.isArray(existing.collaborators) ? existing.collaborators : [];
      const collaboratorsToAdd = new_collaborators.filter(c => !existingCollaborators.includes(c));

      if (collaboratorsToAdd.length === 0) {
        return success('Some collaborator are already working in this ticket.');
      }

      const patchOperations = [];

      // Agregar colaboradores
      for (const collaborator of collaboratorsToAdd) {
        patchOperations.push({
          op: 'add',
          path: '/collaborators/-',
          value: collaborator
        });
      }

      // Asegurar existencia de notes
      if (!Array.isArray(existing.notes)) {
        patchOperations.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      // Log en notes
      patchOperations.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `New collaborators added: ${collaboratorsToAdd.join(', ')}`
        }
      });

      await item.patch(patchOperations);

      return success('Operation successfull.', {
        colaboradores_agregados: collaboratorsToAdd
      });

    } catch (err) {
      context.log('❌ Error en PATCH parcial (addCollaborator):', err);
      return error('Errors adding collaborators.', 500, err.message);
    }
  }
});
