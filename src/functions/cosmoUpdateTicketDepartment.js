const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateTicketDepartmentInput } = require('./dtos/input.schema');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateTicketDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Validar entrada
    let input;
    try {
      const body = await request.json();
      const { error: validationError, value } = updateTicketDepartmentInput.validate(body, { abortEarly: false });
      if (validationError) {
        context.log('Validation failed:', validationError.details);
        return badRequest('Invalid input.', validationError.details);
      }
      input = value;
    } catch {
      return badRequest('Invalid JSON payload.');
    }

    const { tickets: ticketId, newDepartment, agent_email } = input;

    // 2. Leer ticket
    const ticketItem = getContainer().item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await ticketItem.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return notFound('Ticket not found.');

    // 3. Verificar autorización
    let agentData;
    try {
      const { resources } = await getAgentContainer().items.query({
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      }).fetchAll();
      if (!resources.length) return badRequest('Agent not found in the system.');
      agentData = resources[0];
    } catch (e) {
      return error('Error fetching agent info.', 500, e.message);
    }

    const role = agentData.agent_rol || 'Agent';
    const isAssigned = existing.agent_assigned === agent_email;
    const isCollaborator = Array.isArray(existing.collaborators) && existing.collaborators.includes(agent_email);
    const isSupervisor = role === 'Supervisor';

    if (!isAssigned && !isCollaborator && !isSupervisor) {
      return badRequest('You do not have permission to update this ticket.');
    }

    // 4. Evitar cambio redundante
    if (existing.assigned_department === newDepartment) {
      return badRequest('The department is already set to the desired value.');
    }

    // 5. Construir operaciones PATCH
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

    // 6. Aplicar cambios
    try {
      await ticketItem.patch(patchOps);
      ({ resource: existing } = await ticketItem.read());
    } catch (e) {
      return error('Error updating department.', 500, e.message);
    }

    // 7. Validar & formatear salida
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 8. Notificar SignalR
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedDto)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    // 9. Retornar respuesta
    return success('Department updated successfully.', formattedDto);
  }
});
