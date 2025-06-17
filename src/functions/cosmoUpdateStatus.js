const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;
const signalRUrlStats = process.env.SIGNAL_BROADCAST_URL3;
const signalrClosedTicket = process.env.SIGNAL_BROADCAST_URL4;

app.http('cosmoUpdateStatus', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, newStatus, agent_email;

    try {
      ({ ticketId, newStatus, agent_email } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON.');
    }

    if (!ticketId || !newStatus || !agent_email) {
      return badRequest('Missing parameters: ticketId, newStatus or agent_email.');
    }

    const container = getContainer();
    const agentContainer = getAgentContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource: ticket } = await item.read();
      if (!ticket) return notFound('Ticket not found.');

      // Buscar agente
      const query = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };

      const { resources: agents } = await agentContainer.items.query(query).fetchAll();
      if (!agents.length) return badRequest('Agent not found.');

      const agent = agents[0];
      const role = agent.agent_rol || 'Agent';

      const isAssigned = ticket.agent_assigned === agent_email;
      const isCollaborator = Array.isArray(ticket.collaborators) && ticket.collaborators.includes(agent_email);
      const isSupervisor = role === 'Supervisor';

      // Reglas de acceso generales
      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to change this ticket\'s status.');
      }

      // Reglas específicas para "Done"
      if (newStatus === 'Done' && !isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('Only assigned agent, a collaborator, or a supervisor can mark the ticket as Done.');
      }

      if (ticket.status === newStatus) {
        return badRequest('New status is the same as the current one. No changes applied.');
      }

      const patchOps = [];

      // Asegurar array de notas
      if (!Array.isArray(ticket.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      // Reemplazar status
      patchOps.push({ op: 'replace', path: '/status', value: newStatus });

      // Manejo del campo closedAt
      if (newStatus === 'Done') {
        patchOps.push({
          op: ticket.closedAt ? 'replace' : 'add',
          path: '/closedAt',
          value: new Date().toISOString()
        });
      } else if (ticket.status === 'Done' && ticket.closedAt) {
        patchOps.push({
          op: 'replace',
          path: '/closedAt',
          value: null
        });
      }

      // Agregar nota de sistema
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Status changed: "${ticket.status || 'Unknown'}" → "${newStatus}"`
        }
      });

      await item.patch(patchOps);
      const { resource: updated } = await item.read();

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
        work_time: updated.work_time
      };

      // SignalR notificaciones
      try {
        await fetch(signalRUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(responseData)
        });
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }

      try {
        await fetch(signalRUrlStats, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(responseData)
        });
      } catch (e) {
        context.log('⚠️ SignalR failed stats:', e.message);
      }

      if(newStatus==='Done') {
        try {
          await fetch(signalrClosedTicket, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData)
          });
        } catch (e) {
          context.log('⚠️ SignalR failed stats:', e.message);
        }
      }

      return success('Status updated successfully.', {
        applied_operations: patchOps.length
      });

    } catch (err) {
      context.log('❌ Error updating status:', err);
      return error('Internal Server Error', 500, err.message);
    }
  }
});
