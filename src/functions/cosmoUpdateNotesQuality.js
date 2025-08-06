const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateNotesQuality', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, notes, agent_email, event;

    try {
      ({ ticketId, notes, agent_email, event } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON.');
    }

    if (!ticketId || !agent_email) {
      return badRequest('Missing parameters: ticketId or agent_email.');
    }

    if (!Array.isArray(notes) && !event) {
      return badRequest('Missing notes array or event.');
    }

    if (Array.isArray(notes)) {
      for (const [i, note] of notes.entries()) {
        if (
          typeof note !== 'object' ||
          !note.agent_email ||
          typeof note.agent_email !== 'string'
        ) {
          return badRequest(`Note at index ${i} is missing a valid 'agent_email'.`);
        }
      }
    }

    const ticketContainer = getContainer();
    const agentContainer = getAgentContainer();
    const ticketItem = ticketContainer.item(ticketId, ticketId);

    try {
      const { resource: ticket } = await ticketItem.read();
      if (!ticket) return notFound('Ticket not found.');

      // Fetch agent info
      const query = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };
      const { resources: agents } = await agentContainer.items.query(query).fetchAll();
      if (!agents.length) return badRequest('Agent not found.');

      const agent = agents[0];
      const role = agent.agent_rol || 'Agent';

      const isQuality = role === 'Quality';

      if (!isQuality) {
        return badRequest('You do not have permission to update notes on this ticket.');
      }

      const patchOps = [];

      if (!Array.isArray(ticket.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      if (Array.isArray(notes) && notes.length > 0) {
        for (const note of notes) {
          patchOps.push({
            op: 'add',
            path: '/notes/-',
            value: {
              ...note,
              datetime: note.datetime || new Date().toISOString(),
              event_type: note.event_type || 'quality_note'
            }
          });
        }

        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Added ${notes.length} note(s) to the ticket.`
          }
        });
      }

      if (event) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event
          }
        });
      }

      if (patchOps.length === 0) {
        return badRequest('No valid operations to apply.');
      }

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
        quality_control: updated.quality_control,
        phone: updated.phone,
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


      return success('Notes updated successfully.', {responseData});

    } catch (err) {
      context.log('❌ Error updating notes:', err);
      return error('Internal Server Error', 500, err.message);
    }
  }
});
