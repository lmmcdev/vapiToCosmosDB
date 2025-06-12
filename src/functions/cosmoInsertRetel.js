const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';
const signalRUrl = process.env.SIGNALR_BROADCAST_URL;

app.http('cosmoInsertRetel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    try {
      body = await request.json();
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    let data;
    try {
      data = body.call.call_analysis.custom_analysis_data;
    } catch (err) {
      return badRequest('Missing custom_analysis_data');
    }

    // Fecha actual en zona horaria de Miami
    const nowMiami = dayjs().tz(MIAMI_TZ);
    const createdAt = nowMiami.utc().toISOString(); // UTC ISO para filtros y ordenamiento
    const creation_date = nowMiami.format('MM/DD/YYYY, HH:mm'); // Amigable para UI

    const ticketId = crypto.randomUUID();
    const phone = body.call.from_number;
    let agent_assigned = '';

    try {
      const container = getContainer();

      const itemToInsert = {
        ...body,
        tickets: ticketId,
        id: ticketId,
        summary: data.summary,
        call_reason: data.call_reason,
        createdAt, // para filtros
        creation_date, // para UI
        patient_name: data.patient_name,
        patient_dob: data.dob,
        caller_name: data.caller_name,
        callback_number: data.alternate_contact_number,
        phone,
        url_audio: data.recording_url,
        caller_id: data.agent_name,
        call_cost: parseFloat((body.call?.call_cost?.combined_cost || 0) / 100).toFixed(4),
        assigned_department: data.assigned_department,
        assigned_role: data.assigned_role,
        caller_type: data.caller_type,
        call_duration: body.call?.call_cost?.total_duration_seconds,
        status: 'New',
        agent_assigned,
        tiket_source: 'Phone',
        collaborators: [],
        notes: [
          { datetime: createdAt, event_type: 'system_log', event: 'New ticket created' }
        ],
        timestamp: createdAt // mantener coherencia
      };

      await container.items.create(itemToInsert, { partitionKey: ticketId });

      // SignalR broadcast
      try {
        await fetch(signalRUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemToInsert)
        });
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }

      return success('Ticket created', { tickets: ticketId }, 201);
    } catch (err) {
      return error('Insert error', 500, err.message);
    }
  }
});
