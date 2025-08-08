// src/functions/cosmoUpdateStatus/index.js
const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const signalRUrl       = process.env.SIGNAL_BROADCAST_URL2;
const signalRUrlStats  = process.env.SIGNAL_BROADCAST_URL3;
const signalRClosed    = process.env.SIGNAL_BROADCAST_URL4;

app.http('cosmoUpdateStatus', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request
    let ticketId, newStatus, agent_email;
    try {
      ({ ticketId, newStatus, agent_email } = await request.json());
    } catch {
      return badRequest('Invalid JSON.');
    }
    if (!ticketId || !newStatus || !agent_email) {
      return badRequest('Missing parameters: ticketId, newStatus or agent_email.');
    }

    // 2. Read ticket
    const item = getContainer().item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return notFound('Ticket not found.');

    // 3. Authorization
    const { resources: agents } = await getAgentContainer().items
      .query({ query: 'SELECT * FROM c WHERE c.agent_email=@agent_email', parameters:[{name:'@agent_email',value:agent_email}] })
      .fetchAll();
    if (!agents.length) return badRequest('Agent not found.');
    const role = agents[0].agent_rol || 'Agent';
    const isAllowed =
      existing.agent_assigned === agent_email ||
      (Array.isArray(existing.collaborators) && existing.collaborators.includes(agent_email)) ||
      role === 'Supervisor';
    if (!isAllowed) {
      return badRequest(`You do not have permission to change this ticket's status.`);
    }

    // 4. If no change
    if (existing.status === newStatus) {
      return badRequest('New status is the same as current.');
    }

    // 5. Build patchOps
    const patchOps = [];
    if (!Array.isArray(existing.notes)) {
      patchOps.push({ op: 'add', path: '/notes', value: [] });
    }
    patchOps.push({ op: 'replace', path: '/status', value: newStatus });

    if (newStatus === 'Done') {
      patchOps.push({
        op: existing.closedAt ? 'replace' : 'add',
        path: '/closedAt',
        value: new Date().toISOString()
      });
    } else if (existing.status === 'Done' && existing.closedAt) {
      patchOps.push({ op: 'replace', path: '/closedAt', value: null });
    }

    patchOps.push({
      op: 'add',
      path: '/notes/-',
      value: {
        datetime: new Date().toISOString(),
        event_type: 'system_log',
        agent_email,
        event: `Status changed: "${existing.status}" → "${newStatus}"`
      }
    });

    // 6. Apply patch & re-read
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error updating status.', 500, e.message);
    }

    // 7. Validate & format DTO
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 8. SignalR notifications
    for (const url of [signalRUrl, signalRUrlStats]) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formattedDto)
        });
      } catch (e) {
        context.log(`⚠️ SignalR failed for ${url}:`, e.message);
      }
    }
    if (newStatus === 'Done' || existing.status === 'Done') {
      try {
        await fetch(signalRClosed, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formattedDto)
        });
      } catch (e) {
        context.log('⚠️ SignalR closedTickets failed:', e.message);
      }
    }

    // 9. Return response
    return success('Status updated successfully.', formattedDto);
  }
});
