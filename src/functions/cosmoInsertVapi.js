const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';
const signalRUrl = process.env.SIGNALR_BROADCAST_URL;

const openaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const openaiApiKey = process.env.AZURE_OPENAI_KEY;
const deployment = "gpt-35-turbo";

// Batch queue
const batchQueue = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 5000;
let container = null;

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

// Init container once
(async () => {
  container = getContainer();
})();

// Process batch every 5 seconds
setInterval(async () => {
  if (!container || batchQueue.length === 0) return;

  const batch = batchQueue.splice(0, BATCH_SIZE);

  try {
    const operations = batch.map(doc => ({
      operationType: 'Create',
      resourceBody: doc,
    }));

    await container.items.bulk(operations);
  } catch (bulkError) {
    console.warn('⚠️ Bulk insert failed. Retrying individually...');
    for (const doc of batch) {
      try {
        await insertWithRetry(container, doc);
      } catch (e) {
        console.error('❌ Failed to insert after retries:', e.message);
      }
    }
  }

  // Notify SignalR
  for (const doc of batch) {
    try {
      fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    } catch (e) {
      console.warn('⚠️ SignalR failed:', e.message);
    }
  }
}, BATCH_INTERVAL_MS);

// HTTP handler
app.http('cosmoInsertVapi', {
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

    /////////////////////////////////////////////////////////////////////////////
    /// Direct OpenAI Ticket Classification
    /////////////////////////////////////////////////////////////////////////////
    const summary = body.message.analysis.summary;
    //const summary = body.message.transcript;

    let aiClassification = {
      priority: "normal",
      risk: "none",
      category: "General"
    };

    try {
      const classifyRes = await fetch(
        `${openaiEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': openaiApiKey
          },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content: `Responde SOLO en JSON con priority (low = consulta general, normal = importante pero no urgente, high = SOLO emergencias), risk (none, legal, desenrollment), y category (solo se permiten: transport, appointment, new patient, desenrollment, customer service, new address, hospitalization, others).`
              },
              {
                role: "user",
                content: `Resumen: "${summary}"`
              }
            ],
            temperature: 0
          })
        }
      );

      if (classifyRes.ok) {
        const result = await classifyRes.json();
        const raw = result.choices[0].message.content.trim();
        aiClassification = JSON.parse(raw);
      } else {
        const errorText = await classifyRes.text();
        context.log(`OpenAI classify fallback: ${errorText}`);
      }
    } catch (err) {
      context.log(`OpenAI classify error: ${err.message}`);
    }

    /////////////////////////////////////////////////////////////////////////////
    /// Build final ticket
    /////////////////////////////////////////////////////////////////////////////
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
      summary,
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
      aiClassification,
      notes: [
        { datetime: createdAt, event_type: 'system_log', event: 'New ticket created' }
      ],
      timestamp: createdAt
    };

    batchQueue.push(itemToInsert);
    return success('Ticket received and queued for batch insert', { ticketId, aiClassification });
  }
});
