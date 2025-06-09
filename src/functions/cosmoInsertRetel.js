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

    const now = dayjs().tz('America/New_York');
    const creation_date = now.format('MM/DD/YYYY, HH:mm');
    const ticketId = crypto.randomUUID();
    const phone = body.call.from_number;
    let agent_assigned = '';

    //campo time para comparar fecha
    const nowEpoch = new Date();
    const startOfDay = new Date(nowEpoch.getFullYear(), nowEpoch.getMonth(), nowEpoch.getDate()); // hoy a las 00:00
    const startOfDayEpoch = Math.floor(startOfDay.getTime() / 1000);



    try {
      const container = getContainer();
      const { resources } = await container.items
        .query({
          query: `
            SELECT TOP 1 c.agent_assigned FROM c 
            WHERE c.phone = @phone 
            AND c.status != "Closed" 
            ORDER BY c._ts DESC
          `,
          parameters: [
            { name: '@phone', value: phone },
            { name: '@startOfDayEpoch', value: startOfDayEpoch } //no corre la fecha, usar en el futuro
          ]
        })
        .fetchAll();

      if (resources.length > 0) agent_assigned = resources[0].agent_assigned || '';

      const itemToInsert = {
        ...body,
        tickets: ticketId,
        id: ticketId,
        summary: data.summary,
        call_reason: data.call_reason,
        creation_date,
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
          { datetime: now.toISOString(), event_type: 'system_log', event: 'New ticket created' }
        ],
        timestamp: now.toISOString()
      };

      await container.items.create(itemToInsert, { partitionKey: ticketId });

      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemToInsert)
      });

      return success('Ticket created', { tickets: ticketId }, 201);
    } catch (err) {
      return error('Insert error', 500, err.message);
    }
  }
});
