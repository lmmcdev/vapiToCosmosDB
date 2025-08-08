// src/functions/cosmoUpdatePatientName/index.js
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updatePatientNameInput } = require('./dtos/input.schema');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientName', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse and validate input
    let input;
    try {
      const body = await request.json();
      const { error: validationError, value } = updatePatientNameInput.validate(body, { abortEarly: false });
      if (validationError) {
        context.log('Validation failed:', validationError.details);
        return badRequest('Invalid input.', validationError.details);
      }
      input = value;
    } catch {
      return badRequest('Invalid JSON');
    }

    const { tickets: ticketId, agent_email, nuevo_nombreapellido } = input;
    console.log(ticketId)
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
      return badRequest('You do not have permission to update the patient name.');
    }

    // 4. Prepare patch operations
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

    // 5. Apply patch
    try {
      await item.patch(patchOps);
    } catch (e) {
      return error('Failed to update ticket.', 500, e.message);
    }

    // 6. Read updated ticket
    let updated;
    try {
      ({ resource: updated } = await item.read());
    } catch (e) {
      return error('Error reading updated ticket.', 500, e.message);
    }

    // 7. Format output
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(updated, badRequest, context);
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

    // 9. Return response
    return success('Patient name updated successfully.', formattedDto);
  }
});
