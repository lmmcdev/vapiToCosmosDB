// src/functions/cosmoUpdatePatientBOD/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updatePatientDOBInput } = require('./dtos/input.schema');
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

// Ajusta al módulo que corresponda
const {
  ACCESS_GROUP: GROUP_REFERRALS_ACCESS,
  SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
  AGENTS_GROUP: GROUP_REFERRALS_AGENTS, // por si lo usas luego
} = GROUPS.REFERRALS;

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientBOD', { // 👈 conservamos el nombre del endpoint tal como lo tienes
  route: 'cosmoUpdatePatientBOD',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      const { dateISO: miamiUTC } = getMiamiNow();

      // 1) Actor desde el token
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Rol efectivo por grupos (supervisor/agent)
      const { role } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
        AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
      });
      if (!role) {
        return { status: 403, jsonBody: { error: 'User has no role group for this module' } };
      }

      // 3) Parse + valida entrada (DTO)
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON');
      }

      const { error: vErr, value } = updatePatientDOBInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input.';
        return badRequest(details);
      }

      const ticketId = value.tickets;                   // uuid del ticket
      const nueva_fechanacimiento = value.nueva_fechanacimiento; // ISO date (según tu DTO)

      // 4) Leer ticket
      const item = getContainer().item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // 5) Autorización: asignado, colaborador o supervisor
      const lc = (s) => (s || '').toLowerCase();
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator = Array.isArray(existing.collaborators)
        && existing.collaborators.map(lc).includes(lc(actor_email));
      const isSupervisor = role === 'supervisor';

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to update the patient DOB.');
      }

      // 6) Construir patchOps
      const patchOps = [];

      patchOps.push({
        op: existing.patient_dob === undefined ? 'add' : 'replace',
        path: '/patient_dob',
        value: nueva_fechanacimiento,
      });

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: miamiUTC,
          event_type: 'system_log',
          agent_email: actor_email,
          event: `Patient DOB changed to "${nueva_fechanacimiento}"`,
        },
      });

      // 7) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating patient DOB.', 500, e.message);
      }

      // 8) Validar & formatear salida
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      // 9) Notificar via SignalR (best-effort)
      if (signalRUrl) {
        try {
          await fetch(signalRUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formattedDto),
          });
        } catch (e) {
          context.log('⚠️ SignalR failed:', e.message);
        }
      }

      // 10) Responder ticket completo
      return success('Operation successfull', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdatePatientBOD error:', e);
      return error('Unexpected error updating patient DOB.', 500, e.message);
    }
  }, {
    // 🔐 Auth a nivel de endpoint
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  })
});