const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoUpdateNotes', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { ticketId, notes, agent_email, event } = await req.json();

    if (!ticketId || !agent_email) {
      return {
        status: 400,
        body: 'Faltan parámetros requeridos: ticketId o agent_email.'
      };
    }

    if (!Array.isArray(notes) && !event) {
      return {
        status: 400,
        body: 'Se requiere al menos un array de notas o un evento para agregar.'
      };
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return { status: 404, body: 'Ticket no encontrado.' };
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

      // Agregar notas nuevas si hay
      if (Array.isArray(notes) && notes.length > 0) {
        for (const note of notes) {
          patchOps.push({
            op: 'add',
            path: '/notes/-',
            value: note
          });
        }
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

      // Agregar nota syslog de evento adicional si existe
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
        return { status: 400, body: 'No hay notas o eventos para agregar.' };
      }

      await item.patch(patchOps);

      return {
        status: 200,
        body: {
          message: 'Notas actualizadas correctamente.',
          operaciones_aplicadas: patchOps.length
        }
      };

    } catch (err) {
      context.log('❌ Error al actualizar notas:', err);
      return {
        status: 500,
        body: 'Error en la actualización: ' + err.message
      };
    }
  }
});


/***ejemplo de json valido ****/
/*
{
  "tickets": "7bc5d900-723f-4ada-9155-cda7ecf572be",
  "updates": {
    "status": "In Progress",
    "notes": [
      {
        "datetime": "2025-05-22T14:00:00Z",
        "event_type": "agent_note",
        "agent_email": "agente1@empresa.com",
        "event": "Llamé al paciente para coordinar la consulta, queda pendiente confirmar horario."
      }
    ]
  },
  "event": "El agente comenzó a trabajar el caso",
  "agent_email": "agente1@empresa.com"
}
*/