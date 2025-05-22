const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('addCollaborator', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { tickets, agent_email, new_collaborators } = await req.json();

    if (!tickets || !agent_email || !Array.isArray(new_collaborators)) {
      return { status: 400, body: 'Faltan parámetros requeridos o formato inválido.' };
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      // Leer colaboradores actuales
      const { resource: existing } = await item.read();
      if (!existing) {
        return { status: 404, body: 'Ticket no encontrado.' };
      }

      const existingCollaborators = Array.isArray(existing.collaborators) ? existing.collaborators : [];
      const collaboratorsToAdd = new_collaborators.filter(c => !existingCollaborators.includes(c));

      if (collaboratorsToAdd.length === 0) {
        return { status: 200, body: { message: 'No se agregaron colaboradores nuevos (ya existen).' } };
      }

      const patchOperations = [];

      // Agregar cada colaborador con operación add
      for (const collaborator of collaboratorsToAdd) {
        patchOperations.push({
          op: 'add',
          path: '/collaborators/-',
          value: collaborator
        });
      }

      // Asegurarse que 'notes' exista (si no existe, se puede agregar primero)
      if (!Array.isArray(existing.notes)) {
        patchOperations.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      // Agregar log en notes
      patchOperations.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Colaboradores agregados: ${collaboratorsToAdd.join(', ')}`
        }
      });

      // Ejecutar el patch parcial
      await item.patch(patchOperations);

      return {
        status: 200,
        body: {
          message: 'Colaboradores agregados correctamente.',
          colaboradores_agregados: collaboratorsToAdd
        }
      };

    } catch (err) {
      context.log('❌ Error en PATCH parcial (addCollaborator):', err);
      return { status: 500, body: 'Error al actualizar: ' + err.message };
    }
  }
});
