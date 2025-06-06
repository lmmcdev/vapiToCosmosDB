const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoUpdatePatientName', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, nuevo_nombreapellido;

    try {
      ({ tickets, agent_email, nuevo_nombreapellido } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!tickets || !agent_email || !nuevo_nombreapellido) {
      return badRequest('Your request have missing parameters: tickets, agent_email or nuevo_nombreapellido');
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: existing } = await item.read();

      const anterior = existing.patient_name || 'Unknown';
      const patchOps = [];

      if (existing.patient_name === undefined) {
        patchOps.push({
          op: 'add',
          path: '/patient_name',
          value: nuevo_nombreapellido
        });
      } else {
        patchOps.push({
          op: 'replace',
          path: '/patient_name',
          value: nuevo_nombreapellido
        });
      }

      if (!Array.isArray(existing.notes)) {
        patchOps.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Patient name changed from "${anterior}" to "${nuevo_nombreapellido}"`
        }
      });

      await item.patch(patchOps);

      // Releer el documento actualizado
      const { resource: updated } = await item.read();

      // Solo devolver los campos necesarios
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

      return success('Ticket updated successfully.', responseData);

    } catch (err) {
      context.log('❌ Error al actualizar nombreapellido_paciente (PATCH):', err);
      return error('Error.', 500, err.message);
    }
  }
});
