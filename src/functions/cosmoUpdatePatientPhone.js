const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientPhone', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request
    let ticketId, agent_email, new_phone;
    try {
      ({ tickets: ticketId, agent_email, new_phone } = await request.json());
    } catch {
      return badRequest('Invalid JSON body.');
    }
    if (!ticketId || !agent_email || !new_phone) {
      return badRequest('Missing parameters: tickets, agent_email or new_phone.');
    }

    // 2. Validate US phone format
    const phoneRegex = /^(\+1\s?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/;
    if (!phoneRegex.test(new_phone)) {
      return badRequest('Invalid US phone number format. (e.g., 555-123-4567 or (555) 123-4567)');
    }

    // 3. Read ticket
    const container = getContainer();
    const item = container.item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return notFound('Ticket not found.');

    // 4. Authorization
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
      return badRequest('You do not have permission to update this ticket\'s callback number.');
    }

    // 5. Build patchOps
    const patchOps = [];
    patchOps.push({
      op: existing.callback_number === undefined ? 'add' : 'replace',
      path: '/callback_number',
      value: new_phone
    });
    patchOps.push({
      op: 'add',
      path: '/notes/-',
      value: {
        datetime: new Date().toISOString(),
        event_type: 'system_log',
        agent_email,
        event: `Callback number changed to "${new_phone}"`
      }
    });

    // 6. Apply patch and re-read
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error updating callback number.', 500, e.message);
    }

    // 7. Validate & format DTO
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 8. Notify via SignalR
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedDto)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    // 9. Return success
    return success('Callback number updated successfully.', formattedDto);
  }
});