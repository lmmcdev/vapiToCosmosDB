// src/functions/cosmoUpdateNotes/index.js
const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateNotes', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request
    let ticketId, notes, agent_email, event;
    try {
      ({ ticketId, notes, agent_email, event } = await request.json());
    } catch {
      return badRequest('Invalid JSON.');
    }
    if (!ticketId || !agent_email) {
      return badRequest('Missing parameters: ticketId or agent_email.');
    }
    if (!Array.isArray(notes) && !event) {
      return badRequest('Missing notes array or event.');
    }
    if (Array.isArray(notes)) {
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (typeof note !== 'object' || !note.agent_email || typeof note.agent_email !== 'string') {
          return badRequest(`Note at index ${i} is missing a valid 'agent_email'.`);
        }
      }
    }

    // 2. Read ticket
    const container = getContainer();
    const item = container.item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return notFound('Ticket not found.');

    // 3. Authorization
    const agentQ = {
      query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
      parameters: [{ name: '@agent_email', value: agent_email }]
    };
    const { resources: agents } = await getAgentContainer().items.query(agentQ).fetchAll();
    if (!agents.length) return badRequest('Agent not found.');
    const role = agents[0].agent_rol || 'Agent';
    const isAssigned     = existing.agent_assigned === agent_email;
    const isCollaborator = Array.isArray(existing.collaborators) && existing.collaborators.includes(agent_email);
    const isSupervisor   = role === 'Supervisor';
    if (!isAssigned && !isCollaborator && !isSupervisor) {
      return badRequest('You do not have permission to update notes on this ticket.');
    }

    // 4. Build patch operations
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

    // 5. Apply patch and read updated
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error updating notes.', 500, e.message);
    }

    // 6. Validate & format via helper
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 7. SignalR notification
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedDto)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    // 8. Return success
    return success('Notes updated successfully.', { applied_operations: patchOps.length, ticket: formattedDto });
  }
});
