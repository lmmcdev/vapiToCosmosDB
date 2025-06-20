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

// Retry-safe insert function
async function insertWithRetry(container, item, maxRetries = 5) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await container.items.create(item, { partitionKey: item.id });
    } catch (err) {
      if (err.code === 429) {
        const wait = err.retryAfterInMs || 1000;
        console.warn(`⚠️ Retel retry after ${wait}ms (attempt ${attempts + 1})`);
        await new Promise(res => setTimeout(res, wait));
        attempts++;
      } else {
        throw err;
      }
    }
  }
  throw new Error('❌ Max retries reached for Retel ticket insert');
}

// Batch control
const batchQueue = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL = 5000;
let container = null;

// Init container once
(async () => {
  container = getContainer();
})();

// Periodic batch processor
setInterval(async () => {
  if (!container || batchQueue.length === 0) return;

  const batch = batchQueue.splice(0, BATCH_SIZE);
  const operations = batch.map(doc => ({
    operationType: 'Create',
    resourceBody: doc,
  }));

  try {
    await container.items.bulk(operations);
  } catch (bulkErr) {
    console.warn('⚠️ Bulk insert failed, retrying individually...');
    for (const doc of batch) {
      try {
        await insertWithRetry(container, doc);
      } catch (e) {
        console.error('❌ Failed after retries:', e.message);
      }
    }
  }

  // Send SignalR notifications
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
}, BATCH_INTERVAL);

// Main function
app.http('cosmoInsertRetel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON');
    }

    let data;
    try {
      data = body.call.call_analysis.custom_analysis_data;
    } catch {
      return badRequest('Missing custom_analysis_data');
    }

    const nowMiami = dayjs().tz(MIAMI_TZ);
    const createdAt = nowMiami.utc().toISOString();
    const creation_date = nowMiami.format('MM/DD/YYYY, HH:mm');
    const ticketId = crypto.randomUUID();
    const phone = body.call.from_number;

    const itemToInsert = {
      ...body,
      tickets: ticketId,
      id: ticketId,
      summary: data.summary,
      call_reason: data.call_reason,
      createdAt,
      creation_date,
      patient_name: data.patient_name,
      patient_dob: data.dob,
      caller_name: data.caller_name,
      callback_number: data.alternate_contact_number,
      phone,
      url_audio: body.call?.recording_url,
      caller_id: data.agent_name,
      call_cost: parseFloat((body.call?.call_cost?.combined_cost || 0) / 100).toFixed(4),
      assigned_department: data.assigned_department,
      assigned_role: data.assigned_role,
      caller_type: data.caller_type,
      call_duration: body.call?.call_cost?.total_duration_seconds,
      status: 'New',
      agent_assigned: '',
      tiket_source: 'Phone',
      collaborators: [],
      notes: [
        { datetime: createdAt, event_type: 'system_log', event: 'New ticket created' }
      ],
      timestamp: createdAt
    };

    batchQueue.push(itemToInsert);
    return success('Retel ticket received and queued', { ticketId });
  }
});
