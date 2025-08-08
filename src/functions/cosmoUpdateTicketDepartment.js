const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateTicketDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, newDepartment, agent_email;

    try {
      ({ ticketId, newDepartment, agent_email } = await req.json());
    } catch {
      return badRequest('Invalid JSON payload.');
    }

    if (!ticketId || !newDepartment || !agent_email) {
      return badRequest('Missing parameters: ticketId, newDepartment, or agent_email.');
    }

    const ticketContainer = getContainer();
    const agentContainer = getAgentContainer();
    const ticketItem = ticketContainer.item(ticketId, ticketId);

    try {
      const { resource: ticket } = await ticketItem.read();
      if (!ticket) return notFound('Ticket not found.');

      // Fetch agent role from database
      const query = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };

      const { resources: agents } = await agentContainer.items.query(query).fetchAll();
      if (!agents.length) return badRequest('Agent not found in the system.');

      const agentData = agents[0];
      const agentRole = agentData.agent_rol || 'Agent';

      // Validate permissions
      const isAssignedAgent = ticket.agent_assigned === agent_email;
      const isCollaborator = Array.isArray(ticket.collaborators) && ticket.collaborators.includes(agent_email);
      const isSupervisor = agentRole === 'Supervisor';

      if (!isAssignedAgent && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to update this ticket.');
      }

      if (ticket.assigned_department === newDepartment) {
        return badRequest('The department is already set to the desired value.');
      }

      // Build patch operations
      const patchOps = [];

      if (!Array.isArray(ticket.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({ op: 'replace', path: '/assigned_department', value: newDepartment });
      patchOps.push({ op: 'replace', path: '/agent_assigned', value: '' });
      patchOps.push({ op: 'replace', path: '/collaborators', value: [] });
      patchOps.push({ op: 'replace', path: '/status', value: "New" });

      

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
          event: `Department changed from "${ticket.assigned_department || 'None'}" to "${newDepartment}" by ${changedBy}.`
        }
      });

      await ticketItem.patch(patchOps);

      const { resource: updated } = await ticketItem.read();

      const responseData = {
        id: updated.id,
        summary: updated.summary,
        call_reason: updated.call_reason,
        creation_date: updated.creation_date,
        patient_name: updated.patient_name,
        patient_dob: updated.patient_dob,
        caller_name: updated.caller_name,
        callback_number: updated.callback_number,
        caller_id: updated.caller_id,
        call_cost: updated.call_cost,
        notes: updated.notes,
        collaborators: updated.collaborators,
        url_audio: updated.url_audio,
        assigned_department: updated.assigned_department,
        assigned_role: updated.assigned_role,
        caller_type: updated.caller_type,
        call_duration: updated.call_duration,
        status: updated.status,
        agent_assigned: updated.agent_assigned,
        tiket_source: updated.tiket_source,
        phone: updated.phone,
        quality_control: updated.quality_control,
        work_time: updated.work_time
      };

      try {
        await fetch(signalRUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(responseData)
        });
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }

      return success('Department updated successfully.', responseData);

    } catch (err) {
      context.log('❌ Error updating department:', err);
      return error('Unexpected error while updating the department.', 500, err.message);
    }
  }
});
