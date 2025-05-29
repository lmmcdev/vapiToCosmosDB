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
      return badRequest('Your request has missing parameters: ticketId or agent_email.');
    }

    if (!Array.isArray(notes) && !event) {
      return badRequest('Missing notes or malformed array.');
    }

    // Validar que todas las notas tengan agent_email
    if (Array.isArray(notes)) {
      for (const [i, note] of notes.entries()) {
        if (
          typeof note !== 'object' ||
          !note.agent_email ||
          typeof note.agent_email !== 'string'
        ) {
          return badRequest(`Note at index ${i} is missing a valid 'agent_email'.`);
        }
      }
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource: existing } = await item.read();

      if (!existing) {
        return notFound('Ticket not found.');
      }

      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      // Agregar notas válidas
      if (Array.isArray(notes) && notes.length > 0) {
        for (const note of notes) {
          patchOps.push({
            op: 'add',
            path: '/notes/-',
            value: {
              ...note,
              datetime: note.datetime || new Date().toISOString(),
              event_type: note.event_type || 'user_log'
            }
          });
        }

        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Added ${notes.length} note(s) to the ticket.`
          }
        });
      }

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
        return badRequest('No notes or event to add.');
      }

      await item.patch(patchOps);

      return success('Operation successful.', {
        applied_operations: patchOps.length
      });

    } catch (err) {
      context.log('❌ Error updating notes:', err);
      return error('Internal Server Error', 500, err.message);
    }
  }
});
