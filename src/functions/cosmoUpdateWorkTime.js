const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

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
