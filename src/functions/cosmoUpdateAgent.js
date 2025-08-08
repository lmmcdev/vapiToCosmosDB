// src/functions/assignAgent/index.js
const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('assignAgent', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request
    let ticketId, agent_email;
    try {
      ({ tickets: ticketId, agent_email } = await request.json());
    } catch {
      return badRequest('Invalid JSON');
    }
    if (!ticketId || !agent_email) {
      return badRequest('Your request must include: tickets, agent_email');
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
    if (!existing) return badRequest('Ticket not found.');

    // 3. Fetch target agent and validate department
    const agentQ = {
      query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
      parameters: [{ name: '@agent_email', value: agent_email }]
    };
    const { resources: agents } = await getAgentContainer().items.query(agentQ).fetchAll();
    if (!agents.length) return badRequest(`Target agent not found (${agent_email})`);
    const targetAgent = agents[0];
    if (existing.assigned_department && targetAgent.agent_department !== existing.assigned_department) {
      return badRequest(
        `Agent's department (${targetAgent.agent_department}) does not match ticket's assigned department (${existing.assigned_department}).`
      );
    }

    // 4. Build patch operations
    const patchOps = [
      { op: 'replace', path: '/agent_assigned', value: agent_email }
    ];
    if (!Array.isArray(existing.notes)) {
      patchOps.push({ op: 'add', path: '/notes', value: [] });
    }
    patchOps.push({
      op: 'add',
      path: '/notes/-',
      value: {
        datetime: new Date().toISOString(),
        event_type: 'system_log',
        agent_email,
        event: `Assigned agent to the ticket: ${agent_email}`
      }
    });

    // 5. Apply patch and read updated
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error assigning agent.', 500, e.message);
    }

    // 6. Validate & format via DTO helper
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
    return success('Agent assigned successfully.', { assigned_agent: agent_email });
  }
});
