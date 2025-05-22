const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoUpdatePatientName', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { tickets, agent_email, nuevo_nombreapellido } = await req.json();

    if (!tickets || !agent_email || !nuevo_nombreapellido) {
      return { status: 400, body: 'Faltan parámetros: tickets, agent_email o nuevo_nombreapellido.' };
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      // Leer documento solo para saber el nombre anterior y validar estructura
      const { resource: existing } = await item.read();

      const path = existing?.message?.analysis?.structuredData;
      if (!path) {
        return {
          status: 400,
          body: 'No se encontró la estructura message.analysis.structuredData.'
        };
      }

      const anterior = path.nombreapellido_paciente || 'Desconocido';

      const patchOps = [];

      // Reemplazar campo anidado
      patchOps.push({
        op: 'replace',
        path: '/message/analysis/structuredData/nombreapellido_paciente',
        value: nuevo_nombreapellido
      });

      // Asegurar que notes exista
      if (!Array.isArray(existing.notes)) {
        patchOps.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      // Agregar log de cambio
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Cambio de nombre del paciente de "${anterior}" a "${nuevo_nombreapellido}"`
        }
      });

      await item.patch(patchOps);

      return {
        status: 200,
        body: {
          message: 'Nombre y apellido del paciente actualizado correctamente.',
          nombre_anterior: anterior,
          nombre_nuevo: nuevo_nombreapellido
        }
      };

    } catch (err) {
      context.log('❌ Error al actualizar nombreapellido_paciente (PATCH):', err);
      return {
        status: 500,
        body: 'Error en la actualización: ' + err.message
      };
    }
  }
});

