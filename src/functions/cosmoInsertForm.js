// src/functions/cosmoInsertForm/index.js (CommonJS)
const { app } = require('@azure/functions');
const crypto = require('crypto');
const fetch = require('node-fetch');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');

// 🔐 Auth
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';
const signalRUrl = process.env.SIGNALR_BROADCAST_URL;

app.http('cosmoInsertForm', {
  route: 'cosmoInsertForm',
  methods: ['POST'],
  authLevel: 'anonymous', // se valida con withAuth + access_as_user
  handler: withAuth(async (request, context) => {
    try {
      // 1) Usuario desde el token
      const claims = context.user;
      const actorEmail = getEmailFromClaims(claims);
      if (!actorEmail) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Parse body
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return badRequest('Invalid JSON', err.message);
      }
      const form = body?.form || {};

      // 3) Validación mínima (el agent_email ya NO es requerido porque va del token)
      const requiredFields = ['summary', 'patient_name', 'patient_dob', 'caller_id'];
      const missingFields = requiredFields.filter((f) => !form?.[f]);
      if (missingFields.length > 0) {
        return badRequest(`Missing required fields: ${missingFields.join(', ')}`);
      }

      // 4) Datos de auditoría/fechas
      const nowMiami = dayjs().tz(MIAMI_TZ);
      const createdAt = nowMiami.utc().toISOString(); // ISO para filtros/queries
      const creation_date = nowMiami.format('MM/DD/YYYY, HH:mm'); // amigable UI
      const ticketId = crypto.randomUUID();

      // 5) Documento a insertar (agent_assigned del token)
      const newTicket = {
        tickets: ticketId,
        id: ticketId,
        agent_assigned: actorEmail,
        tiket_source: 'Form',
        collaborators: [],
        createdAt,         // para filtros
        creation_date,     // para UI
        summary: form.summary,
        status: (form.status || 'New').trim(),
        patient_name: form.patient_name,
        patient_dob: form.patient_dob,
        phone: form.phone,
        caller_id: form.caller_id,
        call_reason: form.call_reason,
        assigned_department: form.assigned_department,
        timestamp: createdAt,
        notes: [
          {
            datetime: createdAt,
            event_type: 'system_log',
            event: `New ticket created by ${actorEmail}`,
          },
          ...(form.agent_note
            ? [{ datetime: createdAt, event_type: 'user_note', event: form.agent_note }]
            : []),
        ],
      };

      // 6) Insertar en Cosmos
      try {
        const container = getContainer();
        await container.items.create(newTicket, { partitionKey: ticketId });
      } catch (e) {
        return error('DB Insert error', 500, e.message);
      }

      // 7) Notificar (best-effort)
      /*if (signalRUrl) {
        try {
          await fetch(signalRUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newTicket),
          });
        } catch (e) {
          context.log('⚠️ SignalR failed:', e.message);
        }
      }*/

      // 8) Respuesta
      return success('Ticket created', { ticketId }, 201);
    } catch (e) {
      context.log('❌ cosmoInsertForm error:', e?.message || e);
      return error('Internal error', 500, e?.message || 'Unknown error');
    }
  }, {
    // ✅ Cualquier usuario autenticado (sin restricción por grupos)
    scopesAny: ['access_as_user'],
    // No pasamos groupsAny para no restringir por grupos
  }),
});
