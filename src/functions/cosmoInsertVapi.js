const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { getContainer } = require('../shared/cosmoClient');
const { getPhoneRulesContainer } = require('../shared/cosmoPhoneRulesClient');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient'); // 👈 asegúrate de tener este cliente
const { success, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';
const signalRUrl = process.env.SIGNALR_SEND_TO_GROUPS;
// || 'http://localhost:7072/api/signalr/send-group?code=NxMIigLrz02jzHPceCkU5K7slBLxFDPVBwx1dxS0W4gWAzFuf__Y3Q==';

const openaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const openaiApiKey = process.env.AZURE_OPENAI_KEY;
const deployment = "gpt-35-turbo";

const batchQueue = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 5000;

let container = null;
let linkRulesContainer = null;
let patientsContainer = null;

(async () => {
  container = getContainer();
  linkRulesContainer = getPhoneRulesContainer();
  patientsContainer = getPatientsContainer(); // 👈 inicializamos
})();

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
    console.warn('Bulk insert failed. Retrying individually...');
    for (const doc of batch) {
      try {
        await insertWithRetry(container, doc);
      } catch (e) {
        console.error('Failed to insert after retries:', e.message);
      }
    }
  }

  // Notify SignalR
  for (const doc of batch) {
    const assigned_department = doc.assigned_department
    try {
      fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
              hub: 'ticketshubchannels',
              groupName: `department:${assigned_department}`, //same way in frontend
              target: 'ticketCreated',
              payload: doc           
            })
      });
    } catch (e) {
      console.warn('SignalR notify failed:', e.message);
    }
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

    if (!body?.message?.analysis?.structuredData?.summary) {
      return badRequest('Missing summary');
    }

    const summary = body.message.analysis.summary;

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
                content: `Responde SOLO en JSON con priority (low, medium, high), risk (none, legal, disenrollment), y category (transport, appointment, new patient, disenrollment, customer service, new address, hospitalization, others).`
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

    let patient_id = null;
    let linked_patient_snapshot = {};

    if (phone && linkRulesContainer) {
      const query = {
        query: "SELECT * FROM c WHERE c.phone = @phone AND c.link_future = true",
        parameters: [{ name: "@phone", value: phone }]
      };

      const { resources: rules } = await linkRulesContainer.items.query(query).fetchAll();

      if (rules.length > 0) {
        const rule = rules[0];
        patient_id = rule.patient_id;

        // 👇 Obtener snapshot del paciente
        if (patient_id && patientsContainer) {
          try {
            const { resource: patient } = await patientsContainer.item(patient_id, patient_id).read();
            if (patient) {
              linked_patient_snapshot = {
                id: patient.id,
                Name: patient.Name || "",
                DOB: patient.DOB || "",
                Address: patient.Address || "",
                Location: patient.Location || ""
              };
            }
          } catch (e) {
            context.log(`Could not fetch patient: ${e.message}`);
          }
        }
      }
    }

    const itemToInsert = {
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
      patient_id: patient_id,
      linked_patient_snapshot,
      url_audio: body.message.stereoRecordingUrl,
      caller_id: body.message.phoneNumber?.name,
      call_cost: body.message.cost,
      assigned_department: body.message.analysis.structuredData?.vapi_assignment,
      assigned_role: body.message.analysis.structuredData?.assigned_role,
      caller_type: body.message.analysis.structuredData?.llamada,
      call_duration: body.message.durationSeconds,
      status: 'New',
      quality_control: false,
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
    return success('Ticket received and queued for batch insert', { ticketId, aiClassification, patient_id, linked_patient_snapshot });
  }
});
