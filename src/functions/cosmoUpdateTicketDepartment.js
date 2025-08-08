// src/functions/cosmoUpdateTicketDepartment/index.js
const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateTicketDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request
    let ticketId, newDepartment, agent_email;
    try {
      ({ ticketId, newDepartment, agent_email } = await request.json());
    } catch {
      return badRequest('Invalid JSON payload.');
    }
    if (!ticketId || !newDepartment || !agent_email) {
      return badRequest('Missing parameters: ticketId, newDepartment, or agent_email.');
    }

    // 2. Read existing ticket
    const ticketItem = getContainer().item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await ticketItem.read());
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
    if (!agents.length) return badRequest('Agent not found in the system.');
    const agentData    = agents[0];
    const agentRole    = agentData.agent_rol || 'Agent';
    const isAssigned   = existing.agent_assigned === agent_email;
    const isCollaborator = Array.isArray(existing.collaborators) && existing.collaborators.includes(agent_email);
    const isSupervisor = agentRole === 'Supervisor';
    if (!isAssigned && !isCollaborator && !isSupervisor) {
      return badRequest('You do not have permission to update this ticket.');
    }

    // 4. Prevent no-op
    if (existing.assigned_department === newDepartment) {
      return badRequest('The department is already set to the desired value.');
    }

    // 5. Build patch operations
    const patchOps = [];
    if (!Array.isArray(existing.notes)) {
      patchOps.push({ op: 'add', path: '/notes', value: [] });
    }
    patchOps.push({ op: 'replace', path: '/assigned_department', value: newDepartment });
    patchOps.push({ op: 'replace', path: '/agent_assigned', value: '' });
    patchOps.push({ op: 'replace', path: '/collaborators', value: [] });
    patchOps.push({ op: 'replace', path: '/status', value: 'New' });

    const changedBy = isSupervisor
      ? 'Supervisor'
      : isCollaborator
        ? 'Collaborator'
        : 'Assigned Agent';

    patchOps.push({
      op: 'add',
      path: '/notes/-',
      value: {
        datetime: new Date().toISOString(),
        event_type: 'system_log',
        agent_email,
        event: `Department changed from "${existing.assigned_department || 'None'}" to "${newDepartment}" by ${changedBy}.`
      }
    });

    // 6. Apply patch & re-read
    try {
      await ticketItem.patch(patchOps);
      ({ resource: existing } = await ticketItem.read());
    } catch (e) {
      return error('Error updating department.', 500, e.message);
    }

    // 7. Validate & format DTO
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 8. SignalR notification
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedDto)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    // 9. Return response
    return success('Department updated successfully.', formattedDto);
  }
});
