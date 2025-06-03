const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoUpdatePatientName', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, nuevo_nombreapellido;

    try {
      ({ tickets, agent_email, nuevo_nombreapellido } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!tickets || !agent_email || !nuevo_nombreapellido) {
      return badRequest('Your request have missing parameters: tickets, agent_email or nuevo_nombreapellido');
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: existing } = await item.read();

      const anterior = existing.patient_name || 'Unknown';
      const patchOps = [];

      // Añadir o reemplazar /patient_name
      if (existing.patient_name === undefined) {
        patchOps.push({
          op: 'add',
          path: '/patient_name',
          value: nuevo_nombreapellido
        });
      } else {
        patchOps.push({
          op: 'replace',
          path: '/patient_name',
          value: nuevo_nombreapellido
        });
      }

      // Asegurar que notes existe
      if (!Array.isArray(existing.notes)) {
        patchOps.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Patient name changed from "${anterior}" to "${nuevo_nombreapellido}"`
        }
      });

      await item.patch(patchOps);

      return success('Operation successful.', {
        nombre_anterior: anterior,
        nombre_nuevo: nuevo_nombreapellido
      });

    } catch (err) {
      context.log('❌ Error al actualizar nombreapellido_paciente (PATCH):', err);
      return error('Error.', 500, err.message);
    }
  }
});