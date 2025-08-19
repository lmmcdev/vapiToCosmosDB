// src/functions/cosmoUpdateWorkTime/index.js (CommonJS)
const fetch = require('node-fetch');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateWorkTimeInput } = require('./dtos/input.schema');

// 🔐 Auth
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');

dayjs.extend(utc);
dayjs.extend(timezone);

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

const lc = (s) => (s || '').toLowerCase();

app.http('cosmoUpdateWorkTime', {
  route: 'cosmoUpdateWorkTime',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      // 0) Actor desde el token (cualquier usuario autenticado)
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 1) Parse + validar body con Joi
      let input;
      try {
        const body = await request.json();
        const { error: validationError, value } =
          updateWorkTimeInput.validate(body, { abortEarly: false });
        if (validationError) {
          const details = validationError.details?.map(d => d.message);
          context.log('Validation failed:', details);
          return badRequest('Invalid input.', details);
        }
        input = value;
      } catch {
        return badRequest('Invalid JSON');
      }

      // NOTA: ignoramos agent_email del body para autorización/logs y usamos actor_email
      const { tickets: ticketId, workTime, currentStatus } = input;

      // 2) Leer ticket
      const item = getContainer().item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return badRequest('Ticket not found.');

      // 3) Autorización por contexto del ticket
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator = Array.isArray(existing.collaborators)
        && existing.collaborators.map(lc).includes(lc(actor_email));

      if (!isAssigned && !isCollaborator) {
        return badRequest(
          `Agent ${actor_email} is not authorized to log work time on this ticket.`
        );
      }

      // 4) Patch: notas + work_time
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email: actor_email,
          event: `${workTime} registered by agent: ${actor_email}`
        }
      });

      const now = dayjs().tz('America/New_York');
      const creation_date = now.format('MM/DD/YYYY, HH:mm');

      const workTimeEntry = {
        ticketId,
        agentEmail: actor_email,   // ← usamos el actor real del token
        workTime,
        currentStatus,
        date: creation_date
      };

      if (!Array.isArray(existing.work_time)) {
        patchOps.push({ op: 'add', path: '/work_time', value: [workTimeEntry] });
      } else {
        patchOps.push({ op: 'add', path: '/work_time/-', value: workTimeEntry });
      }

      // 5) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error registering working time.', 500, e.message);
      }

      // 6) DTO salida
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      // 7) Notificar SignalR (best-effort)
      try {
        if (signalRUrl) {
          await fetch(signalRUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formattedDto)
          });
        }
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }

      // 8) OK
      return success(
        `Working time on the ticket registered: ${workTime}`,
        { agent: actor_email, work_time_entry: workTimeEntry }
      );
    } catch (err) {
      context.log('❌ cosmoUpdateWorkTime error:', err?.message || err);
      return error('Error processing work time', 500, err?.message || 'Unknown error');
    }
  }, {
    // ✅ Solo autenticación (sin grupos). Todos los usuarios logueados pueden acceder.
    scopesAny: ['access_as_user'],
    // groupsAny: []  // omitido → no se exige pertenencia a grupo
  })
});
