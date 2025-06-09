const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const signalRUrl = process.env.SIGNALR_BROADCAST_URL;

app.http('cosmoInsertForm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return badRequest('Invalid JSON', err.message);
    }

    const form = body.form;
    const requiredFields = ['summary', 'patient_name', 'patient_dob', 'caller_id', 'agent_email'];
    const missingFields = requiredFields.filter(field => !form?.[field]);

    if (missingFields.length > 0) {
      return badRequest(`Missing required fields: ${missingFields.join(', ')}`);
    }

    const now = dayjs().tz('America/New_York');
    const isoMiami = now.toISOString();
    const creation_date = now.format('MM/DD/YYYY, HH:mm');
    const ticketId = crypto.randomUUID();

    const phone = form.phone;
    let agent_assigned = '';

    //campo time para comparar fecha
    const nowEpoch = new Date();
    const startOfDay = new Date(nowEpoch.getFullYear(), nowEpoch.getMonth(), nowEpoch.getDate()); // hoy a las 00:00
    const startOfDayEpoch = Math.floor(startOfDay.getTime() / 1000);

    try {
      const container = getContainer();
      /*const { resources: existingTickets } = await container.items
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

      if (existingTickets.length > 0) {
        agent_assigned = existingTickets[0].agent_assigned || '';
      }*/

      const newTicket = {
        tickets: ticketId,
        id: ticketId,
        agent_assigned,
        tiket_source: 'Form',
        collaborators: [],
        timestamp: isoMiami,
        creation_date,
        summary: form.summary,
        status: form.status?.trim() || 'New',
        patient_name: form.patient_name,
        patient_dob: form.patient_dob,
        phone,
        caller_id: form.caller_id,
        call_reason: form.call_reason,
        assigned_department: form.assigned_department,
        notes: [
          { datetime: isoMiami, event_type: 'system_log', event: `New ticket created by ${form.agent_email}` },
          ...(form.agent_note ? [{ datetime: isoMiami, event_type: 'user_log', event: form.agent_note }] : [])
        ]
      };

      await container.items.create(newTicket, { partitionKey: ticketId });

      // SignalR
      try {
        await fetch(signalRUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newTicket)
        });
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }

      return success('Ticket created', { ticketId }, 201);
    } catch (err) {
      return error('DB Insert error', 500, err.message);
    }
  }
});