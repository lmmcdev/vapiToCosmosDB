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

const signalRUrl = process.env.SIGNALR_BROADCAST_URL || 'https://signalrcservices.azurewebsites.net/api/sendTicketMessage';

app.http('cosmoInsertForm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    try {
      body = await request.json();
    } catch (err) {
      context.log('❌ Error parsing JSON:', err);
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

    const newTicket = {
      tickets: ticketId,
      id: ticketId,
      agent_assigned: '',
      tiket_source: 'Form',
      collaborators: [],
      timestamp: isoMiami,
      creation_date,
      summary: form.summary,
      status: form.status?.trim() || 'New',
      patient_name: form.patient_name,
      patient_dob: form.patient_dob,
      phone: form.from_number,
      caller_id: form.caller_id,
      call_reason: form.call_reason,
      assigned_department: form.assigned_department,
      notes: [
        {
          datetime: isoMiami,
          event_type: 'system_log',
          event: `New ticket created by ${form.agent_email}`,
        },
        ...(form.agent_note
          ? [{
              datetime: isoMiami,
              event_type: 'user_log',
              event: form.agent_note,
            }]
          : []),
      ],
    };

    try {
      const container = getContainer();
      await container.items.create(newTicket, {
        partitionKey: ticketId,
      });

      try {
        const res = await fetch(signalRUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newTicket),
        });

        if (!res.ok) {
          const errText = await res.text();
          context.log(`⚠️ SignalR response not OK: ${res.status} - ${errText}`);
        } else {
          context.log('✅ SignalR notification sent.');
        }
      } catch (signalErr) {
        context.log('❌ Error sending SignalR message:', signalErr.message);
      }

      return success('New ticket created successfully', { ticketId }, 201);
    } catch (err) {
      context.log('❌ Error inserting on CosmosDB:', err);
      return error('Error inserting in database', 500, err.message);
    }
  }
});
