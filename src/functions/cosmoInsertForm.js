const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// Extender dayjs
dayjs.extend(utc);
dayjs.extend(timezone);

app.http('cosmoInsertForm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  extraOutputs: [
    {
      type: 'signalR',
      name: 'signalRMessages',
      hubName: 'ticketsHub',
    },
  ],
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

    // Obtener fecha/hora local de Miami
    const now = dayjs().tz('America/New_York');
    const isoMiami = now.toISOString();
    const creation_date = now.format('MM/DD/YYYY, HH:mm');

    const ticketId = crypto.randomUUID();
    const agent_assigned = '';
    const tiket_source = 'Form';
    const collaborators = [];

    const summary = form.summary;
    const status = form.status?.trim() || 'New';
    const patient_name = form.patient_name;
    const patient_dob = form.patient_dob;
    const phone = form.from_number;
    const caller_id = form.caller_id;
    const call_reason = form.call_reason;
    const agent_note = form.agent_note;
    const assigned_department = form.assigned_department;

    const notes = [
      {
        datetime: isoMiami,
        event_type: 'system_log',
        event: `New ticket created by ${form.agent_email}`,
      },
    ];

    if (agent_note) {
      notes.push({
        datetime: isoMiami,
        event_type: 'user_log',
        event: agent_note,
      });
    }

    const newTicket = {
      tickets: ticketId,
      id: ticketId,
      agent_assigned,
      tiket_source,
      collaborators,
      notes,
      timestamp: isoMiami,
      summary,
      status,
      patient_name,
      patient_dob,
      phone,
      caller_id,
      call_reason,
      assigned_department,
      creation_date,
    };

    try {
      const container = getContainer();
      await container.items.create(newTicket, {
        partitionKey: ticketId,
      });

      // Emitir evento SignalR
      context.extraOutputs.set('signalRMessages', [
        {
          target: 'ticketCreated',
          arguments: [newTicket],
        },
      ]);

      return success('New ticket created successfully', { newTicket }, 201);
    } catch (err) {
      context.log('❌ Error inserting on CosmosDB:', err);
      return error('Error inserting in database', 500, err.message);
    }
  },
});
