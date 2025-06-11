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

    if (!body?.message?.analysis?.summary || !body?.message?.call?.createdAt) {
      return badRequest('Missing summary or createdAt');
    }

    const now = dayjs().tz('America/New_York');
    const creation_date = body.message.call.createdAt;
    const ticketId = crypto.randomUUID();
    const phone = body.message.call?.customer?.number;
    let agent_assigned = '';

    //campo time para comparar fecha
    const nowEpoch = new Date();
    const startOfDay = new Date(nowEpoch.getFullYear(), nowEpoch.getMonth(), nowEpoch.getDate()); // hoy a las 00:00
    const startOfDayEpoch = Math.floor(startOfDay.getTime() / 1000);


    try {
      const container = getContainer();
      /*const { resources } = await container.items
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

      if (resources.length > 0) agent_assigned = resources[0].agent_assigned || '';*/

      const itemToInsert = {
        ...body,
        tickets: ticketId,
        id: ticketId,
        summary: body.message.analysis.summary,
        call_reason: body.message.analysis.structuredData?.razon_llamada,
        creation_date,
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
          { datetime: now.toISOString(), event_type: 'system_log', event: 'New ticket created' }
        ],
        timestamp: now.toISOString()
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
