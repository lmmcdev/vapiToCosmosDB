const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';
const signalRUrl = process.env.SIGNALR_BROADCAST_URL;

app.http('cosmoInsertVapi', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    try {
      body = await request.json();
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!body?.message?.analysis?.summary) {
      return badRequest('Missing summary');
    }

    const rawCreatedAt = body.message.call?.createdAt;

    // Validar formato de fecha entrante, o usar fecha actual si falta o es inválida
    let createdAt;
    try {
      createdAt = rawCreatedAt && dayjs(rawCreatedAt).isValid()
        ? dayjs(rawCreatedAt).utc().toISOString()
        : dayjs().tz(MIAMI_TZ).utc().toISOString();
    } catch {
      createdAt = dayjs().tz(MIAMI_TZ).utc().toISOString();
    }

    const creation_date = dayjs(createdAt).tz(MIAMI_TZ).format('MM/DD/YYYY, HH:mm');
    const ticketId = crypto.randomUUID();
    const phone = body.message.call?.customer?.number;
    let agent_assigned = '';

    try {
      const container = getContainer();

      const itemToInsert = {
        ...body,
        tickets: ticketId,
        id: ticketId,
        summary: body.message.analysis.summary,
        call_reason: body.message.analysis.structuredData?.razon_llamada,
        createdAt, // estándar para filtros
        creation_date, // amigable para UI
        patient_name: body.message.analysis.structuredData?.nombreapellido_paciente,
        patient_dob: body.message.analysis.structuredData?.fechanacimiento_paciente,
        caller_name: body.message.analysis.structuredData?.nombreapellidos_familiar,
        callback_number: body.message.analysis.structuredData?.numero_alternativo,
        phone,
        url_audio: body.message.stereoRecordingUrl,
        caller_id: body.message.phoneNumber?.name,
        call_cost: body.message.cost,
        assigned_department: body.message.analysis.structuredData?.vapi_assignment,
        assigned_role: body.message.analysis.structuredData?.assigned_role,
        caller_type: body.message.analysis.structuredData?.llamada,
        call_duration: body.message.durationSeconds,
        status: 'New',
        agent_assigned,
        tiket_source: 'Phone',
        collaborators: [],
        notes: [
          { datetime: createdAt, event_type: 'system_log', event: 'New ticket created' }
        ],
        timestamp: createdAt // coherente con el resto
      };

      await container.items.create(itemToInsert, { partitionKey: ticketId });

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
