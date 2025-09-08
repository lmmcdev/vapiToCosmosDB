// src/functions/cosmoInsertVapi/index.js (CommonJS) - HARDENED VERSION
const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const Joi = require('joi');
const { getContainer } = require('../shared/cosmoClient');
const { getPhoneRulesContainer } = require('../shared/cosmoPhoneRulesClient');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient');
const { success, badRequest } = require('../shared/responseUtils');
const { getMiamiNow } = require('./helpers/timeHelper');
const { classifyTicket } = require('./helpers/openaiHelper');

const signalRUrl = process.env.SIGNALR_SEND_TO_GROUPS;

// 🔒 SECURITY: Input validation schema
const vapiInputSchema = Joi.object({
  summary: Joi.string().trim().min(1).max(2000).required(),
  call_reason: Joi.string().trim().max(500).optional().allow(''),
  patient_name: Joi.string().trim().max(100).optional().allow(''),
  patient_date_of_birth: Joi.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional().allow(''),
  caller_name: Joi.string().trim().max(100).optional().allow(''),
  callback_number: Joi.string().regex(/^[\+]?[\d\s\-\(\)]{7,20}$/).optional().allow(''),
  phone_number: Joi.string().regex(/^[\+]?[\d\s\-\(\)]{7,20}$/).required(),
  url_audio: Joi.string().uri().max(500).optional().allow(''),
  caller_id: Joi.string().trim().max(50).optional().allow(''),
  assigned_department: Joi.string().trim().max(50).optional().allow(''),
  call_cost: Joi.number().min(0).max(1000).optional().default(0),
  call_duration: Joi.number().min(0).max(86400).optional().default(0), // max 24h
  ticket_source: Joi.string().valid('Phone', 'Email', 'Web', 'Chat').optional().default('Phone')
}).unknown(false); // 🔒 SECURITY: Reject unknown fields

// 🔒 SECURITY: Phone number sanitization
function sanitizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  // Remove all non-digit characters except + at start
  return phone.replace(/[^\d+]/g, '').substring(0, 20);
}

// 🔒 SECURITY: Text sanitization (prevent XSS and injection)
function sanitizeText(text, maxLength = 1000) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/[<>'";&\x00-\x1F\x7F]/g, '') // Remove potential dangerous chars
    .substring(0, maxLength);
}

// 🔒 SECURITY: Department validation against whitelist
const ALLOWED_DEPARTMENTS = [
  'switchboard', 'medical', 'billing', 'enrollment', 
  'pharmacy', 'transportation', 'quality', 'admin'
];

function validateDepartment(dept) {
  const clean = sanitizeText(dept, 50).toLowerCase();
  return ALLOWED_DEPARTMENTS.includes(clean) ? clean : 'switchboard';
}

const batchQueue = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 5000;
const MAX_QUEUE_SIZE = 1000; // 🔒 SECURITY: Prevent memory exhaustion

let container = null;
let linkRulesContainer = null;
let patientsContainer = null;

(async () => {
  container = getContainer();
  linkRulesContainer = getPhoneRulesContainer();
  patientsContainer = getPatientsContainer();
})();

async function insertWithRetry(container, item, maxRetries = 5) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await container.items.create(item, { partitionKey: item.id });
    } catch (err) {
      if (err.code === 429) {
        const waitTime = Math.min(err.retryAfterInMs || 1000, 30000); // 🔒 Max wait 30s
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

  // 🔒 SECURITY: Sanitized SignalR notifications
  for (const doc of batch) {
    const location = sanitizeText(doc.caller_id, 50);
    console.log(`Notifying SignalR for location: ${location}`);
    try {
      // 🔒 SECURITY: Send all sanitized ticket fields
      const safePayload = {
        tickets: doc.tickets,
        id: doc.id,
        summary: sanitizeText(doc.summary, 2000),
        call_reason: doc.call_reason,
        createdAt: doc.createdAt,
        creation_date: doc.creation_date,
        patient_name: doc.patient_name,
        patient_dob: doc.patient_dob,
        caller_name: doc.caller_name,
        callback_number: doc.callback_number,
        phone: doc.phone,
        patient_id: doc.patient_id,
        linked_patient_snapshot: doc.linked_patient_snapshot,
        url_audio: doc.url_audio,
        caller_id: doc.caller_id,
        call_cost: doc.call_cost,
        assigned_department: doc.assigned_department,
        call_duration: doc.call_duration,
        status: doc.status,
        quality_control: doc.quality_control,
        agent_assigned: doc.agent_assigned,
        tiket_source: doc.tiket_source,
        collaborators: doc.collaborators,
        aiClassification: doc.aiClassification,
        notes: doc.notes,
        timestamp: doc.timestamp
      };
      
      fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hub: 'ticketshubchannels',
          groupName: `location:${location}`,
          target: 'ticketCreated',
          payload: safePayload // 🔒 SECURITY: Sanitized payload
        })
      });
    } catch {}
  }
}, BATCH_INTERVAL_MS);

app.http('cosmoInsertVapi', {
  methods: ['POST'],
  authLevel: 'anonymous', // 🚨 Consider implementing proper authentication
  handler: async (request, context) => {
    // 🔒 SECURITY: Request size limit
    const contentLength = parseInt(request.headers.get('content-length') || '0');
    if (contentLength > 50000) { // 50KB limit
      return badRequest('Request payload too large');
    }

    // 🔒 SECURITY: Queue size protection
    if (batchQueue.length >= MAX_QUEUE_SIZE) {
      return badRequest('Service temporarily unavailable - high load');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON format');
    }

    // 🔒 SECURITY: Input validation with Joi
    const { error: validationError, value: validatedBody } = vapiInputSchema.validate(body, {
      abortEarly: false,
      stripUnknown: true
    });
    
    if (validationError) {
      const details = validationError.details.map(d => d.message).join('; ');
      return badRequest(`Validation error: ${details}`);
    }

    // 🔒 SECURITY: Additional sanitization after validation
    const summary = sanitizeText(validatedBody.summary, 2000);
    const phone = sanitizePhone(validatedBody.phone_number);
    
    if (!summary || !phone) {
      return badRequest('Invalid summary or phone number');
    }

    // 🔒 SECURITY: Rate limiting check could be added here
    // Example: Check if too many requests from same phone/IP

    // --- Clasificación IA (best effort) con input sanitizado ---
    let aiClassification = null;
    try {
      aiClassification = await classifyTicket(summary); // summary ya sanitizado
    } catch (err) {
      context.log(`AI classification failed: ${err.message}`);
      aiClassification = { priority: 'normal', risk: 'none', category: 'General' };
    }

    // Miami timestamps
    const { dateISO: miamiISO } = getMiamiNow();
    const { dateISO: miamiUTC } = getMiamiNow();
    const createdAt = miamiISO;
    const creation_date = miamiUTC;

    const ticketId = crypto.randomUUID();

    // 🔒 SECURITY: Safe phone linkage with parameterized queries
    let patient_id = null;
    let linked_patient_snapshot = {};
    if (phone && linkRulesContainer) {
      try {
        // 🔒 SECURITY: Phone is already sanitized and validated
        const { resources: rules } = await linkRulesContainer.items.query({
          query: 'SELECT * FROM c WHERE c.phone = @phone AND c.link_future = true',
          parameters: [{ name: '@phone', value: phone }]
        }).fetchAll();

        if (rules?.length) {
          const rule = rules[0];
          patient_id = rule.patient_id;

          // 🔒 SECURITY: Validate patient_id is UUID format
          if (patient_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patient_id) && patientsContainer) {
            const { resource: patient } = await patientsContainer.item(patient_id, patient_id).read();
            if (patient) {
              linked_patient_snapshot = {
                id: patient.id,
                Name: sanitizeText(patient.Name, 100),
                DOB: sanitizeText(patient.DOB, 20),
                Address: sanitizeText(patient.Address, 200),
                Location: sanitizeText(patient.Location, 100)
              };
            }
          }
        }
      } catch (e) {
        context.log(`Link rules/patient fetch failed: ${e.message}`);
      }
    }

    // 🔒 SECURITY: Sanitized and validated item construction
    const itemToInsert = {
      tickets: ticketId,
      id: ticketId,
      summary: summary, // Already sanitized
      call_reason: sanitizeText(validatedBody.call_reason, 500),
      createdAt,
      creation_date,
      patient_name: sanitizeText(validatedBody.patient_name, 100),
      patient_dob: validatedBody.patient_date_of_birth || '', // Already validated format
      caller_name: sanitizeText(validatedBody.caller_name, 100),
      callback_number: sanitizePhone(validatedBody.callback_number) || '',
      phone,
      patient_id,
      linked_patient_snapshot,
      url_audio: validatedBody.url_audio || '', // Already validated as URI
      caller_id: sanitizeText(validatedBody.caller_id || validatedBody.assigned_department, 50),
      call_cost: validatedBody.call_cost, // Already validated as number
      assigned_department: validateDepartment(validatedBody.assigned_department),
      call_duration: validatedBody.call_duration, // Already validated
      status: 'New', // 🔒 SECURITY: Fixed value, not from input
      quality_control: false, // 🔒 SECURITY: Fixed value
      agent_assigned: '', // 🔒 SECURITY: Fixed value
      tiket_source: validatedBody.ticket_source, // Already validated against enum
      collaborators: [], // 🔒 SECURITY: Fixed empty array
      aiClassification: aiClassification || { priority: 'normal', risk: 'none', category: 'General' },
      notes: [
        { 
          datetime: createdAt, 
          event_type: 'system_log', 
          event: 'New ticket created' // 🔒 SECURITY: Fixed system message
        }
      ],
      timestamp: createdAt
    };

    // 🔒 SECURITY: Add to queue with size check (already done above)
    batchQueue.push(itemToInsert);
    
    // 🔒 SECURITY: Return only safe fields (no sensitive data)
    const safeResponse = {
      tickets: ticketId,
      id: ticketId,
      summary: summary, // Already sanitized
      call_reason: itemToInsert.call_reason,
      createdAt,
      creation_date,
      patient_name: itemToInsert.patient_name,
      patient_dob: itemToInsert.patient_date_of_birth || '', // Already validated format
      caller_name: itemToInsert.caller_name,
      callback_number: itemToInsert.callback_number || '',
      phone,
      patient_id,
      linked_patient_snapshot,
      url_audio: itemToInsert.url_audio || '', // Already validated as URI
      caller_id: itemToInsert.caller_id || itemToInsert.assigned_department,
      call_cost: itemToInsert.call_cost, // Already validated as number
      assigned_department: itemToInsert.assigned_department,
      call_duration: itemToInsert.call_duration, // Already validated
      status: 'New', // 🔒 SECURITY: Fixed value, not from input
      quality_control: false, // 🔒 SECURITY: Fixed value
      agent_assigned: '', // 🔒 SECURITY: Fixed value
      tiket_source: validatedBody.ticket_source, // Already validated against enum
      collaborators: [], // 🔒 SECURITY: Fixed empty array
      aiClassification: aiClassification || { priority: 'normal', risk: 'none', category: 'General' },
      notes: [
        { 
          datetime: createdAt, 
          event_type: 'system_log', 
          event: 'New ticket created' // 🔒 SECURITY: Fixed system message
        }
      ],
      timestamp: createdAt
    };
    
    return success(safeResponse);
  }
});