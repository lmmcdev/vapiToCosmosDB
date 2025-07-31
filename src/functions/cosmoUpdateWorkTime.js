const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateWorkTime', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, workTime, currentStatus;

    try {
      ({ tickets, agent_email, workTime, currentStatus } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!tickets || !agent_email || !workTime || !currentStatus) {
      return badRequest('Your request must include: tickets, agent_email, workTime, currentStatus');
    }

    const container = getContainer();
    const item = container.item(tickets, tickets);

    try {
      const { resource: existing } = await item.read();
      if (!existing) {
        return badRequest('Ticket not found.');
      }

      // 🔒 Validar si el agente tiene permiso para registrar tiempo
      const assigned = existing.agent_assigned?.toLowerCase();
      const collaborators = (existing.collaborators || []).map(c => c.toLowerCase());
      const requester = agent_email.toLowerCase();

      const isAuthorized = requester === assigned || collaborators.includes(requester);
      if (!isAuthorized) {
        return badRequest(`Agent ${agent_email} is not authorized to log work time on this ticket.`);
      }

      const patchOperations = [];

      // 🔄 Reemplazar agente asignado
      /*patchOperations.push({
        op: 'replace',
        path: '/agent_assigned',
        value: target_agent_email
      });*/

      // 📓 Añadir nota de sistema si no hay /notes
      if (!Array.isArray(existing.notes)) {
        patchOperations.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      patchOperations.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `${workTime} registered by agent: ${agent_email}`
        }
      });

      // 📅 Obtener fecha y hora de Miami
      const now = dayjs().tz('America/New_York');
      const creation_date = now.format('MM/DD/YYYY, HH:mm');

      // ⏱️ Añadir registro de tiempo de trabajo
      const workTimeEntry = {
        ticketId: tickets,
        agentEmail: agent_email,
        workTime,
        currentStatus,
        date: creation_date
      };

      if (!Array.isArray(existing.work_time)) {
        patchOperations.push({
          op: 'add',
          path: '/work_time',
          value: [workTimeEntry]
        });
      } else {
        patchOperations.push({
          op: 'add',
          path: '/work_time/-',
          value: workTimeEntry
        });
      }

      await item.patch(patchOperations);

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
        work_time: updated.work_time,
        linked_patient_snapshot: updated.linked_patient_snapshot,
        aiClassification: updated.aiClassification
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

      return success(`Working time on the ticket registered: ${workTime}`, {
        agent: agent_email,
        work_time_entry: workTimeEntry
      });

    } catch (err) {
      context.log('Error registering working time (PATCH):', err);
      return error('Error registering working time.', 500, err.message);
    }
  }
});