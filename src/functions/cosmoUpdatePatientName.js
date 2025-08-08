const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientName', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request JSON
    let ticketId, agent_email, nuevo_nombreapellido;
    try {
      ({ tickets: ticketId, agent_email, nuevo_nombreapellido } = await request.json());
    } catch {
      return badRequest('Invalid JSON');
    }
    if (!ticketId || !agent_email || !nuevo_nombreapellido) {
      return badRequest('Missing parameters: tickets, agent_email or nuevo_nombreapellido.');
    }

    // 2. Read existing ticket
    const container = getContainer();
    const item = container.item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return notFound('Ticket not found.');

    // 3. Authorization: only assigned, collaborator or supervisor
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
      return badRequest('You do not have permission to update the patient name.');
    }

    // 4. Build patch operations
    const prevName = existing.patient_name ?? 'Unknown';
    const patchOps = [];
    patchOps.push({
      op: existing.patient_name === undefined ? 'add' : 'replace',
      path: '/patient_name',
      value: nuevo_nombreapellido
    });
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
        event: `Patient name changed from "${prevName}" to "${nuevo_nombreapellido}"`
      }
    });

    try {
      await item.patch(patchOps);
    } catch (e) {
      return error('Failed to update ticket.', 500, e.message);
    }

    // 5. Read updated ticket
    let updated;
    try {
      ({ resource: updated } = await item.read());
    } catch (e) {
      return error('Error reading updated ticket.', 500, e.message);
    }

    // 6. Map to DTO and validate via helper
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(updated, badRequest, context);
    } catch (badReqResponse) {
      return badReqResponse;
    }

    // 7. Send SignalR notification
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedDto)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    // 8. Return response
    return success('Patient name updated successfully.', formattedDto);
  }
});
