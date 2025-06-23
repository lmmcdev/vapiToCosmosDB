const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { QueueClient } = require('@azure/storage-queue');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';
const connectionString = process.env.AzureWebJobsStorage;
const queueName = process.env.QUEUE_SIGNALR_NAME || 'ticketcreation';

// Queue fallback function
async function enqueueSignalRMessage(payload, context) {
  try {
    const queueClient = new QueueClient(connectionString, queueName);
    await queueClient.createIfNotExists();
    const message = Buffer.from(JSON.stringify(payload)).toString('base64');
    await queueClient.sendMessage(message);
  } catch (err) {
    context.log('❌ Failed to enqueue SignalR event:', err.message);
  }
}

// Retry-safe insert
async function insertWithRetry(container, item, maxRetries = 5) {
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      return await container.items.create(item, { partitionKey: item.id });
    } catch (err) {
      if (err.code === 429) {
        const waitTime = err.retryAfterInMs || 1000;
        console.warn(`⏳ Throttled, retrying in ${waitTime} ms... (attempt ${attempts + 1})`);
        await new Promise(res => setTimeout(res, waitTime));
        attempts++;
      } else {
        throw err;
      }
    }
  }

  throw new Error('Max retries reached for insertion.');
}

app.http('cosmoInsertVapiv2', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON');
    }

    if (!body?.message?.analysis?.summary) {
      return badRequest('Missing summary');
    }

    const rawCreatedAt = body.message.call?.createdAt;
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

    const itemToInsert = {
      ...body,
      tickets: ticketId,
      id: ticketId,
      summary: body.message.analysis.summary,
      call_reason: body.message.analysis.structuredData?.razon_llamada,
      createdAt,
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
      agent_assigned: '',
      tiket_source: 'Phone',
      collaborators: [],
      notes: [
        { datetime: createdAt, event_type: 'system_log', event: 'New ticket created' }
      ],
      timestamp: createdAt
    };

    try {
      const container = getContainer();
      await insertWithRetry(container, itemToInsert);
      await enqueueSignalRMessage(itemToInsert, context);

      return success('Ticket created and enqueued for SignalR', { ticketId }, 201);
    } catch (err) {
      return error('Insert or queue error', 500, err.message);
    }
  }
});
