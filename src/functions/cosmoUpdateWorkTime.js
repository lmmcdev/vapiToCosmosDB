// src/functions/cosmoUpdateWorkTime/index.js
const fetch = require('node-fetch');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

dayjs.extend(utc);
dayjs.extend(timezone);

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateWorkTime', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // 1. Parse request
    let ticketId, agent_email, workTime, currentStatus;
    try {
      ({ tickets: ticketId, agent_email, workTime, currentStatus } = await request.json());
    } catch {
      return badRequest('Invalid JSON');
    }
    if (!ticketId || !agent_email || workTime == null || !currentStatus) {
      return badRequest('Your request must include: tickets, agent_email, workTime, currentStatus');
    }

    // 2. Read existing ticket
    const item = getContainer().item(ticketId, ticketId);
    let existing;
    try {
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error reading ticket.', 500, e.message);
    }
    if (!existing) return badRequest('Ticket not found.');

    // 3. Authorization
    const assigned     = existing.agent_assigned?.toLowerCase();
    const collaborators = (existing.collaborators || []).map(c => c.toLowerCase());
    const requester    = agent_email.toLowerCase();
    if (requester !== assigned && !collaborators.includes(requester)) {
      return badRequest(`Agent ${agent_email} is not authorized to log work time on this ticket.`);
    }

    // 4. Build patch operations
    const patchOps = [];
    if (!Array.isArray(existing.notes)) {
      patchOps.push({ op: 'add', path: '/notes', value: [] });
    }
    patchOps.push({
      op: 'add',
      path: '/notes/-',
      value: {
        datetime: new Date().toISOString(),
        event_type: 'system_log',
        agent_email,
        event: `${workTime} registered by agent: ${agent_email}`
      }
    });

    const now = dayjs().tz('America/New_York');
    const creation_date = now.format('MM/DD/YYYY, HH:mm');
    const workTimeEntry = {
      ticketId,
      agentEmail: agent_email,
      workTime,
      currentStatus,
      date: creation_date
    };

    if (!Array.isArray(existing.work_time)) {
      patchOps.push({ op: 'add', path: '/work_time', value: [workTimeEntry] });
    } else {
      patchOps.push({ op: 'add', path: '/work_time/-', value: workTimeEntry });
    }

    // 5. Apply patch & re-read
    try {
      await item.patch(patchOps);
      ({ resource: existing } = await item.read());
    } catch (e) {
      return error('Error registering working time.', 500, e.message);
    }

    // 6. Validate & format via DTO helper
    let formattedDto;
    try {
      formattedDto = validateAndFormatTicket(existing, badRequest, context);
    } catch (badReq) {
      return badReq;
    }

    // 7. SignalR notification
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedDto)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    // 8. Return response
    return success(
      `Working time on the ticket registered: ${workTime}`,
      { agent: agent_email, work_time_entry: workTimeEntry }
    );
  }
});
