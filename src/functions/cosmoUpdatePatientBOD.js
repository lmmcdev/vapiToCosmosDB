const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientBOD', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request
    let ticketId, agent_email, nueva_fechanacimiento;
    try {
      ({ tickets: ticketId, agent_email, nueva_fechanacimiento } = await request.json());
    } catch {
      return badRequest('Invalid JSON');
    }
    if (!ticketId || !agent_email || !nueva_fechanacimiento) {
      return badRequest('Missing parameters: tickets, agent_email or nueva_fechanacimiento.');
    }

    // 2. Validate date format MM/DD/YYYY
    const fechaRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
    if (!fechaRegex.test(nueva_fechanacimiento)) {
      return badRequest('Invalid date format. Use MM/DD/YYYY (e.g., 06/15/1985).');
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
      return badRequest('You do not have permission to update the patient DOB.');
    }

    // 5. Build patchOps
    const patchOps = [];
    patchOps.push({
      op: existing.patient_dob === undefined ? 'add' : 'replace',
      path: '/patient_dob',
      value: nueva_fechanacimiento
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
        event: `Patient DOB changed to "${nueva_fechanacimiento}"`
      }
    });

    // 6. Apply patch and re-read
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error updating patient DOB.', 500, e.message);
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
    return success('Patient DOB updated successfully.', formattedDto);
  }
});