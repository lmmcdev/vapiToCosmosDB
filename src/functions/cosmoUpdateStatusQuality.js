const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { getQAContainer } = require('../shared/cosmoQAClient'); // contenedor QC
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;
const signalRUrlStats = process.env.SIGNAL_BROADCAST_URL3;

app.http('cosmoUpdateStatusQuality', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, newStatus, agent_email;

    try {
      ({ ticketId, newStatus, agent_email } = await req.json());
    } catch {
      return badRequest('Invalid JSON.');
    }
    if (!ticketId || !newStatus || !agent_email) {
      return badRequest('Missing parameters: ticketId, status or agent_email.');
    }

    const container = getContainer();
    const agentContainer = getAgentContainer();
    const qcContainer = getQAContainer();

    const item = container.item(ticketId, ticketId);
    try {
      const { resource: ticket } = await item.read();
      if (!ticket) return notFound('Ticket not found.');

      // Validar rol del agente
      const querySpec = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };
      const { resources: agents } = await agentContainer.items.query(querySpec).fetchAll();
      if (!agents.length) return badRequest('Agent not found.');
      const agent = agents[0];
      if (agent.agent_rol !== 'Quality') {
        return badRequest("You do not have permission to change this ticket's status.");
      }

      if (ticket.status === newStatus) {
        return badRequest('New status is the same as the current one. No changes applied.');
      }

      const quality_control = newStatus === 'QARevisionStart';
      const patchOps = [];

      if (!Array.isArray(ticket.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }
      patchOps.push({
        op: typeof ticket.quality_control === 'undefined' ? 'add' : 'replace',
        path: '/quality_control',
        value: quality_control
      });
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Quality Control changed status: "${ticket.status || 'Unknown'}" → "${newStatus}"`
        }
      });

      await item.patch(patchOps);
      const { resource: updated } = await item.read();

      // Registrar o eliminar en quality_control_tickets según status
      if (quality_control) {
        await qcContainer.items.create({
          id: ticketId,
          ticketId,
          agent_email,
          status,
          linked_patient_snapshot,
          patient_id,
          aiClassification,
          patient_name,
          patient_dob,
          phone,
          agent_assigned,
          startDate: new Date().toISOString()
        });
      } else {
        await qcContainer.item(ticketId, ticketId).delete().catch(e => {
          context.log('⚠️ Failed to delete QC entry:', e.message);
        });
      }

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
        work_time: updated.work_time,
        aiClassification: updated.aiClassification,
        quality_control: updated.quality_control,
        linked_patient_snapshot: updated.linked_patient_snapshot
      };

      // Notificaciones via SignalR
      const sendSignal = async (url) => {
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData)
          });
        } catch (e) {
          context.log(`⚠️ SignalR failed (${url}):`, e.message);
        }
      };
      await sendSignal(signalRUrl);
      await sendSignal(signalRUrlStats);

      return success('Status updated successfully.', { responseData });

    } catch (err) {
      context.log('❌ Error updating status:', err);
      return error('Internal Server Error', 500, err.message);
    }
  }
});