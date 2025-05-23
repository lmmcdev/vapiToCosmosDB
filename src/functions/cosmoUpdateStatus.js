const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateStatus', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, newStatus, agent_email;

    try {
      ({ ticketId, newStatus, agent_email } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!ticketId || !newStatus || !agent_email) {
      return badRequest('Your request have missing parameters: ticketId, newStatus or agent_email.');
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return notFound('Ticket no encontrado.');
      }

      if (existing.status === newStatus) {
        return badRequest('New and previous status are the same, no changes to apply.');
      }

      const patchOps = [];

      // Crear notes si no existe
      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      // Actualizar status
      patchOps.push({ op: 'replace', path: '/status', value: newStatus });

      // Agregar nota de system_log
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Status changed: "${existing.status || 'In Progress'}" → "${newStatus}"`
        }
      });

      await item.patch(patchOps);

      return success('Operation successfull.', {
        operaciones_aplicadas: patchOps.length
      });

    } catch (err) {
      context.log('❌ Error al actualizar status:', err);
      return error('Error changing status.', 500, err.message);
    }
  }
});
