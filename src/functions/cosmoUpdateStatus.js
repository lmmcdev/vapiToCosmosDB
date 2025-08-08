// src/functions/cosmoUpdateStatus/index.js
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateTicketStatusInput } = require('./dtos/input.schema');

const signalRUrl      = process.env.SIGNAL_BROADCAST_URL2;
const signalRUrlStats = process.env.SIGNAL_BROADCAST_URL3;
const signalRClosed   = process.env.SIGNAL_BROADCAST_URL4;

app.http('cosmoUpdateStatus', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse and validate input
    let input;
    try {
      const body = await request.json();
      const { error: validationError, value } = updateTicketStatusInput.validate(body, { abortEarly: false });
      if (validationError) {
        context.log('Validation failed:', validationError.details);
        return badRequest('Invalid input.', validationError.details);
      }
      input = value;
    } catch {
      return badRequest('Invalid JSON.');
    }

    const { ticketId, newStatus, agent_email } = input;

    // 2. Read ticket
    const item = getContainer().item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return notFound('Ticket not found.');

    // 3. Authorization check
    let agentInfo;
    try {
      const { resources } = await getAgentContainer().items
        .query({
          query: 'SELECT * FROM c WHERE c.agent_email=@agent_email',
          parameters: [{ name: '@agent_email', value: agent_email }]
        })
        .fetchAll();
      if (!resources.length) return badRequest('Agent not found.');
      agentInfo = resources[0];
    } catch (e) {
      return error('Error querying agent information.', 500, e.message);
    }

    const isAllowed =
      existing.agent_assigned === agent_email ||
      (Array.isArray(existing.collaborators) && existing.collaborators.includes(agent_email)) ||
      agentInfo.agent_rol === 'Supervisor';

    if (!isAllowed) {
      return badRequest(`You do not have permission to change this ticket's status.`);
    }

    // 4. Prevent duplicate status
    if (existing.status === newStatus) {
      return badRequest('New status is the same as current.');
    }

    // 5. Prepare patch operations
    const patchOps = [];

    if (!Array.isArray(existing.notes)) {
      patchOps.push({ op: 'add', path: '/notes', value: [] });
    }

    patchOps.push({ op: 'replace', path: '/status', value: newStatus });

    // Handle closing and reopening
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

    // 6. Apply patch and re-read
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error updating status.', 500, e.message);
    }

    // 7. Format response DTO
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 8. Notify via SignalR
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
