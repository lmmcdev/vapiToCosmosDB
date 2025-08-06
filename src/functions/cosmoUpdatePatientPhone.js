const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, error, notFound } = require('../shared/responseUtils');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientPhone', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, new_phone;

    try {
      ({ tickets, agent_email, new_phone } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON body.');
    }

    if (!tickets || !agent_email || !new_phone) {
      return badRequest('Missing parameters: tickets, agent_email or new_phone.');
    }

    const phoneRegex = /^(\+1\s?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/;
    if (!phoneRegex.test(new_phone)) {
      return badRequest('Invalid US phone number format. (e.g., 555-123-4567 or (555) 123-4567)');
    }

    const container = getContainer();
    const agentContainer = getAgentContainer();
    const itemRef = container.item(tickets, tickets);

    try {
      const { resource: doc } = await itemRef.read();
      if (!doc) return notFound('Ticket not found.');

      // Obtener rol del agente
      const query = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };
      const { resources: agents } = await agentContainer.items.query(query).fetchAll();

      if (!agents.length) return badRequest('Agent not found.');
      const agent = agents[0];
      const role = agent.agent_rol || 'Agent';

      const isAssigned = doc.agent_assigned === agent_email;
      const isCollaborator = Array.isArray(doc.collaborators) && doc.collaborators.includes(agent_email);
      const isSupervisor = role === 'Supervisor';

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to update this ticket\'s callback number.');
      }

      const patchOps = [];

      if (doc.callback_number === undefined) {
        patchOps.push({
          op: 'add',
          path: '/callback_number',
          value: new_phone
        });
      } else {
        patchOps.push({
          op: 'replace',
          path: '/callback_number',
          value: new_phone
        });
      }

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

      await itemRef.patch(patchOps);

      const { resource: updated } = await itemRef.read();

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

      return success('Callback number updated successfully.');
    } catch (err) {
      context.log('❌ Error updating callback number:', err);
      return error('Error updating callback number.', 500, err.message);
    }
  }
});
