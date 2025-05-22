const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('assignAgent', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { tickets, agent_email, target_agent_email } = await req.json();

    if (!tickets || !agent_email || !target_agent_email) {
      return {
        status: 400,
        body: 'Faltan parámetros: tickets, agent_email o target_agent_email.'
      };
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      // Leer el documento para validar existencia y verificar si notes existe
      const { resource: existing } = await item.read();
      if (!existing) {
        return { status: 404, body: 'Ticket no encontrado.' };
      }

      const patchOperations = [];

      // Reemplazar el agente asignado
      patchOperations.push({
        op: 'replace',
        path: '/agent_assigned',
        value: target_agent_email
      });

      // Si notes no existe, inicializarlo
      if (!Array.isArray(existing.notes)) {
        patchOperations.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      // Agregar nota al historial
      patchOperations.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Agente asignado: ${target_agent_email}`
        }
      });

      await item.patch(patchOperations);

      return {
        status: 200,
        body: {
          message: 'Agente asignado correctamente.',
          agente_asignado: target_agent_email
        }
      };

    } catch (err) {
      context.log('❌ Error al asignar agente (PATCH):', err);
      return {
        status: 500,
        body: 'Error en la asignación: ' + err.message
      };
    }
  }
});
