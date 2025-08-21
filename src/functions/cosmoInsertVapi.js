// src/functions/cosmoInsertVapi/index.js (CommonJS)
const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { getContainer } = require('../shared/cosmoClient');
const { getPhoneRulesContainer } = require('../shared/cosmoPhoneRulesClient');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient');
const { success, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';
const signalRUrl = process.env.SIGNALR_SEND_TO_GROUPS;

const openaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const openaiApiKey = process.env.AZURE_OPENAI_KEY;
const deployment = 'gpt-35-turbo';

const batchQueue = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 5000;

let container = null;
let linkRulesContainer = null;
let patientsContainer = null;

(async () => {
  container = getContainer();
  linkRulesContainer = getPhoneRulesContainer();
  patientsContainer = getPatientsContainer();
})();

// --- Util: interpretar fecha como MIAMI ---
function parseAsMiami(raw) {
  try {
    if (raw == null) return dayjs().tz(MIAMI_TZ);

    // epoch numérico
    if (typeof raw === 'number' || /^\d+$/.test(String(raw))) {
      return dayjs(Number(raw)).tz(MIAMI_TZ);
    }

    const s = String(raw);

    // si ya trae zona (Z o ±HH:mm), respétala y conviértela a Miami
    if (/[zZ]$|[+\-]\d{2}:\d{2}$/.test(s)) {
      return dayjs(s).tz(MIAMI_TZ);
    }

    // si NO trae zona, interprétala como hora de Miami
    return dayjs.tz(s, MIAMI_TZ);
  } catch {
    return dayjs().tz(MIAMI_TZ);
  }
}

async function insertWithRetry(container, item, maxRetries = 5) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await container.items.create(item, { partitionKey: item.id });
    } catch (err) {
      if (err.code === 429) {
        const waitTime = err.retryAfterInMs || 1000;
        await new Promise(res => setTimeout(res, waitTime));
        attempts++;
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries reached for insertion.');
}

setInterval(async () => {
  if (!container || batchQueue.length === 0) return;

  const batch = batchQueue.splice(0, BATCH_SIZE);

  try {
    const operations = batch.map(doc => ({
      operationType: 'Create',
      resourceBody: doc,
    }));
    await container.items.bulk(operations);
  } catch {
    for (const doc of batch) {
      try { await insertWithRetry(container, doc); } catch {}
    }
  }

  // Notificar SignalR (best effort)
  for (const doc of batch) {
    const assigned_department = doc.assigned_department;
    try {
      fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hub: 'ticketshubchannels',
          groupName: `department:${assigned_department}`,
          target: 'ticketCreated',
          payload: doc
        })
      });
    } catch {}
  }
}, BATCH_INTERVAL_MS);

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

    if (!body?.summary) {
      return badRequest('Missing summary');
    }

    const summary = body.summary;

    // --- Clasificación IA (best effort) ---
    let aiClassification = { priority: 'normal', risk: 'none', category: 'General' };
    try {
      const classifyRes = await fetch(
        `${openaiEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': openaiApiKey },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content:
                  'Responde SOLO en JSON con priority (low, medium, high), risk (none, legal, disenrollment), y category (transport, appointment, new patient, disenrollment, customer service, new address, hospitalization, others).'
              },
              { role: 'user', content: `Resumen: "${summary}"` }
            ],
            temperature: 0
          })
        }
      );

      if (classifyRes.ok) {
        const result = await classifyRes.json();
        const raw = result.choices?.[0]?.message?.content?.trim();
        if (raw) aiClassification = JSON.parse(raw);
      }
    } catch (err) {
      context.log(`OpenAI classify error: ${err.message}`);
    }

    // --- FECHAS: ambas en hora de MIAMI ---
    const miami = parseAsMiami(body.createdAt); // si no viene, ahora en Miami
    const createdAt = miami.format('YYYY-MM-DDTHH:mm:ssZ');   // ISO con offset de Miami
    const creation_date = miami.format('MM/DD/YYYY, HH:mm');  // UI

    const ticketId = crypto.randomUUID();
    const phone = body.phone_number;

    // Opcional: aplicar reglas de linkage por teléfono
    let patient_id = null;
    let linked_patient_snapshot = {};
    if (phone && linkRulesContainer) {
      try {
        const { resources: rules } = await linkRulesContainer.items.query({
          query: 'SELECT * FROM c WHERE c.phone = @phone AND c.link_future = true',
          parameters: [{ name: '@phone', value: phone }]
        }).fetchAll();

        if (rules?.length) {
          const rule = rules[0];
          patient_id = rule.patient_id;

          if (patient_id && patientsContainer) {
            const { resource: patient } = await patientsContainer.item(patient_id, patient_id).read();
            if (patient) {
              linked_patient_snapshot = {
                id: patient.id,
                Name: patient.Name || '',
                DOB: patient.DOB || '',
                Address: patient.Address || '',
                Location: patient.Location || ''
              };
            }
          }
        }
      } catch (e) {
        context.log(`Link rules/patient fetch failed: ${e.message}`);
      }
    }

    const cost = body.call_cost || 0;
    const call_duration = body.call_duration || 0;

    const itemToInsert = {
      tickets: ticketId,
      id: ticketId,
      summary,
      call_reason: body.call_reason,

      // ⬇️ SOLO hora de Miami
      createdAt,         // ISO con offset -04:00 / -05:00
      creation_date,     // "MM/DD/YYYY, HH:mm"

      patient_name: body.patient_name,
      patient_dob: body.patient_date_of_birth,
      caller_name: body.caller_name,
      callback_number: body.callback_number,
      phone,
      patient_id,
      linked_patient_snapshot,
      url_audio: body.url_audio,
      caller_id: null,
      call_cost: cost,
      assigned_department: 'Referrals',
      call_duration,
      status: 'New',
      quality_control: false,
      agent_assigned: '',
      tiket_source: 'Phone',
      collaborators: [],
      aiClassification,
      notes: [
        { datetime: createdAt, event_type: 'system_log', event: 'New ticket created' }
      ],
      timestamp: createdAt // si otros endpoints lo usan, mantenlo igual (Miami ISO)
    };

    batchQueue.push(itemToInsert);
    return success(itemToInsert);
  }
});
