const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

app.http('cosmoUpdateDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, newDepartment, agent_email;

    try {
      ({ ticketId, newDepartment, agent_email } = await req.json());
    } catch {
      return badRequest('Invalid JSON');
    }

    if (!ticketId || !newDepartment || !agent_email) {
      return badRequest('Your request have missing parameters: ticketId, newDepartment or agent_email.');
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return notFound('Ticket no encontrado.');
      }

      if (existing.assigned_department === newDepartment) {
        return badRequest('Same dapartments, no changes to apply');
      }

      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({ op: 'replace', path: '/assigned_department', value: newDepartment });

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Transfering ticket to department: "${existing.department || 'None'}" → "${newDepartment}"`
        }
      });

      await item.patch(patchOps);

      return success('Operation successfull.', {
        operaciones_aplicadas: patchOps.length,
        nuevo_departamento: newDepartment
      });

    } catch (err) {
      context.log('❌ Error al actualizar departamento:', err);
      return error('Errors changing department.', 500, err.message);
    }
  }
});