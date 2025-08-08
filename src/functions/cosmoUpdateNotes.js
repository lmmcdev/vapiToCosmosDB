const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateTicketNotesInput } = require('./dtos/input.schema');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateNotes', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Validar entrada
    let input;
    try {
      const body = await request.json();
      const { error: validationError, value } = updateTicketNotesInput.validate(body, { abortEarly: false });
      if (validationError) {
        context.log('Validation failed:', validationError.details);
        return badRequest('Invalid input.', validationError.details);
      }
      input = value;
    } catch {
      return badRequest('Invalid JSON.');
    }

    const { ticketId, notes, agent_email, event } = input;

    // 2. Leer ticket
    const container = getContainer();
    const item = container.item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return notFound('Ticket not found.');

    // 3. Verificar autorización
    const agentQuery = {
      query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
      parameters: [{ name: '@agent_email', value: agent_email }]
    };

    let agentData;
    try {
      const { resources } = await getAgentContainer().items.query(agentQuery).fetchAll();
      if (!resources.length) return badRequest('Agent not found.');
      agentData = resources[0];
    } catch (e) {
      return error('Error querying agent information.', 500, e.message);
    }

    const isAssigned = existing.agent_assigned === agent_email;
    const isCollaborator = Array.isArray(existing.collaborators) && existing.collaborators.includes(agent_email);
    const isSupervisor = agentData.agent_rol === 'Supervisor';

    if (!isAssigned && !isCollaborator && !isSupervisor) {
      return badRequest('You do not have permission to update notes on this ticket.');
    }

    // 4. Construir operaciones PATCH
    const patchOps = [];

    if (!Array.isArray(existing.notes)) {
      patchOps.push({ op: 'add', path: '/notes', value: [] });
    }

    if (Array.isArray(notes) && notes.length > 0) {
      for (const note of notes) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            ...note,
            datetime: note.datetime || new Date().toISOString(),
            event_type: note.event_type || 'user_note'
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
      return badRequest('No valid operations to apply.');
    }

    // 5. Aplicar patch y releer
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error updating notes.', 500, e.message);
    }

    // 6. Formatear DTO
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 7. Notificar via SignalR
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedDto)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    // 8. Respuesta final
    return success('Notes updated successfully.', {
      applied_operations: patchOps.length,
      ticket: formattedDto
    });
  }
});
