const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateNotes', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, notes, agent_email, event;

    try {
      ({ ticketId, notes, agent_email, event } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!ticketId || !agent_email) {
      return badRequest('Your request have missing parameters: ticketId or agent_email.');
    }

    if (!Array.isArray(notes) && !event) {
      return badRequest('Missing notes or array malformed.');
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return notFound('Ticket no encontrado.');
      }

      const patchOps = [];

      // Asegurar que notes exista
      if (!Array.isArray(existing.notes)) {
        patchOps.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      // Agregar notas nuevas
      if (Array.isArray(notes) && notes.length > 0) {
        for (const note of notes) {
          patchOps.push({
            op: 'add',
            path: '/notes/-',
            value: note
          });
        }

        // Log de agregado de notas
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Se agregaron ${notes.length} nota(s) al ticket.`
          }
        });
      }

      // Agregar log por evento personalizado
      if (event) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event
          }
        });
      }

      if (patchOps.length === 0) {
        return badRequest('No hay notas o eventos para agregar.');
      }

      await item.patch(patchOps);

      return success('Notas actualizadas correctamente.', {
        operaciones_aplicadas: patchOps.length
      });

    } catch (err) {
      context.log('❌ Error al actualizar notas:', err);
      return error('Error en la actualización de notas.', 500, err.message);
    }
  }
});