// src/functions/cosmoUpdatePatientName/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updatePatientNameInput } = require('./dtos/input.schema');
const { getMiamiNow } = require('./helpers/timeHelper');


const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

const DEPARTMENT = 'Referrals';

const {
  ACCESS_GROUP: GROUP_REFERRALS_ACCESS,
  SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
  AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
} = GROUPS.REFERRALS;

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientName', {
  route: 'cosmoUpdatePatientName',
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
        AGENTS_GROUP: GROUP_REFERRALS_AGENTS
      });
      if (!role) {
        return { status: 403, jsonBody: { error: 'User has no role group for this module' } };
      }

      // 3) Parse + valida input (DTO)
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON');
      }

      const { error: vErr, value } = updatePatientNameInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Validation error';
        return badRequest(details);
      }

      const ticketId = value.tickets; // tu DTO define 'tickets'
      const nuevo_nombreapellido = value.nuevo_nombreapellido;

      // 4) Leer ticket
      const item = getContainer().item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // (Opcional) 5) Verifica departamento del ticket
      if (existing.assigned_department && existing.assigned_department !== DEPARTMENT) {
        return badRequest(
          `Ticket department (${existing.assigned_department}) does not match endpoint department (${DEPARTMENT}).`
        );
      }

      // 6) Autorización: asignado, colaborador o supervisor
      const lc = (s) => (s || '').toLowerCase();
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator = Array.isArray(existing.collaborators)
        && existing.collaborators.map(lc).includes(lc(actor_email));
      const isSupervisor = role === 'supervisor';

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to update the patient name.');
      }

      // 7) Patch
      const prevName = existing.patient_name ?? 'Unknown';
      const patchOps = [];

      patchOps.push({
        op: existing.patient_name === undefined ? 'add' : 'replace',
        path: '/patient_name',
        value: nuevo_nombreapellido,
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
          event: `Patient name changed from "${prevName}" to "${nuevo_nombreapellido}"`,
        },
      });

      try {
        await item.patch(patchOps);
      } catch (e) {
        return error('Failed to update ticket.', 500, e.message);
      }

      // 8) Releer actualizado
      let updated;
      try {
        ({ resource: updated } = await item.read());
      } catch (e) {
        return error('Error reading updated ticket.', 500, e.message);
      }

      // 9) DTO salida
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(updated, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      // 10) SignalR (best-effort)
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

      // 11) Respuesta final (ticket completo)
      return success('Operation successfull', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdatePatientName error:', e);
      return error('Unexpected error updating patient name.', 500, e.message);
    }
  }, {
    // Auth: scope + grupo de acceso del módulo
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  })
});
