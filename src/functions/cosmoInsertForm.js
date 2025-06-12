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

const MIAMI_TZ = 'America/New_York';
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

    const nowMiami = dayjs().tz(MIAMI_TZ);
    const createdAt = nowMiami.utc().toISOString(); // Fecha en UTC para queries y filtros
    const creation_date = nowMiami.format('MM/DD/YYYY, HH:mm'); // Fecha amigable para UI
    const ticketId = crypto.randomUUID();

    try {
      const container = getContainer();

      const newTicket = {
        tickets: ticketId,
        id: ticketId,
        agent_assigned: form.agent_email,
        tiket_source: 'Form',
        collaborators: [],
        createdAt, // usado para filtros
        creation_date, // usado para UI
        summary: form.summary,
        status: form.status?.trim() || 'New',
        patient_name: form.patient_name,
        patient_dob: form.patient_dob,
        phone: form.phone,
        caller_id: form.caller_id,
        call_reason: form.call_reason,
        assigned_department: form.assigned_department,
        timestamp: createdAt, // coherente con createdAt
        notes: [
          { datetime: createdAt, event_type: 'system_log', event: `New ticket created by ${form.agent_email}` },
          ...(form.agent_note ? [{ datetime: createdAt, event_type: 'user_log', event: form.agent_note }] : [])
        ]
      };

      await container.items.create(newTicket, { partitionKey: ticketId });

      // SignalR broadcast
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
