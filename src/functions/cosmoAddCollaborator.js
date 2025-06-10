const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;


app.http('cosmoUpdateCollaborators', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { ticketId, collaborators = [], agent_email } = await req.json();

    if (!ticketId || !Array.isArray(collaborators)) {
      return badRequest('Missing ticketId or collaborators array.');
    }

    const incomingClean = [...new Set(
      collaborators.map(e => e.trim().toLowerCase())
    )];

    const invalid = incomingClean.filter(email => !isValidEmail(email));
    if (invalid.length > 0) {
      return badRequest(`Invalid email(s): ${invalid.join(', ')}`);
    }

    const container = getContainer();
    const item = container.item(ticketId, ticketId);

    try {
      const { resource } = await item.read();
      if (!resource) return notFound('Ticket not found.');

      const current = Array.isArray(resource.collaborators)
        ? resource.collaborators.map(e => e.trim().toLowerCase())
        : [];

      const assignedAgent = resource.assigned_agent?.trim().toLowerCase();

      // ❌ Validación explícita: el assigned agent no puede estar en los colaboradores
      if (assignedAgent && incomingClean.includes(assignedAgent)) {
        return badRequest(`Assigned agent (${assignedAgent}) cannot be a collaborator.`);
      }

      const finalCollaborators = incomingClean;

      // Determinar cambios
      const removed = current.filter(e => !finalCollaborators.includes(e));
      const added = finalCollaborators.filter(e => !current.includes(e));

      if (removed.length === 0 && added.length === 0) {
        return badRequest('No changes to collaborators.');
      }

      await item.patch([
        {
          op: 'replace',
          path: '/collaborators',
          value: finalCollaborators
        },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email: agent_email || 'SYSTEM',
            event: `Updated collaborators. Added: ${added.join(', ') || 'None'}, Removed: ${removed.join(', ') || 'None'}`
          }
        }
      ]);

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

      try {
        await fetch(signalRUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(responseData)
        });
        console.log('sending signalr')
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }

      return success('Collaborators updated.', { added, removed });
    } catch (err) {
      return error('Failed to update collaborators', 500, err.message);
    }
  }
});