const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoUpdateDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { ticketId, newDepartment, agent_email } = await req.json();

    if (!ticketId || !newDepartment || !agent_email) {
      return {
        status: 400,
        body: 'Faltan parámetros requeridos: ticketId, newDepartment o agent_email.'
      };
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return { status: 404, body: 'Ticket no encontrado.' };
      }

      if (existing.department === newDepartment) {
        return { status: 400, body: 'El departamento es igual al actual, no hay cambios para aplicar.' };
      }

      const patchOps = [];

      // Crear notes si no existe
      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      // Actualizar department
      patchOps.push({ op: 'replace', path: '/department', value: newDepartment });

      // Agregar nota system_log
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Cambio de departamento: "${existing.department || 'ninguno'}" → "${newDepartment}"`
        }
      });

      await item.patch(patchOps);

      return {
        status: 200,
        body: { message: 'Departamento actualizado correctamente.', operaciones_aplicadas: patchOps.length }
      };

    } catch (err) {
      context.log('❌ Error al actualizar departamento:', err);
      return {
        status: 500,
        body: 'Error en la actualización: ' + err.message
      };
    }
  }
});
