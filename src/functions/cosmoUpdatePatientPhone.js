// src/functions/cosmoUpdatePatientPhone/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updatePatientPhoneInput } = require('./dtos/input.schema');

const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

const DEPARTMENT = 'Referrals';

const {
  ACCESS_GROUP: GROUP_REFERRALS_ACCESS,
  SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
  AGENTS_GROUP: GROUP_REFERRALS_AGENTS, // por si lo necesitas luego
} = GROUPS.REFERRALS;

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdatePatientPhone', {
  route: 'cosmoUpdatePatientPhone',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      // 1) Actor desde el token
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Rol efectivo por grupos
      const { role } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
        AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
      });
      if (!role) {
        return { status: 403, jsonBody: { error: 'User has no role group for this module' } };
      }

      // 3) Validar entrada (DTO)
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON body.');
      }

      const { error: vErr, value } = updatePatientPhoneInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input.';
        return badRequest(details);
      }

      const ticketId = value.tickets;      // tu DTO define 'tickets'
      const new_phone = value.new_phone;   // del DTO

      // 4) Leer ticket
      const container = getContainer();
      const item = container.item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // (Opcional) 5) Verificar departamento
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
        return badRequest("You do not have permission to update this ticket's callback number.");
      }

      // 7) Construir patchOps
      const patchOps = [{
        op: existing.callback_number === undefined ? 'add' : 'replace',
        path: '/callback_number',
        value: new_phone,
      }];

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
          event: `Callback number changed to "${new_phone}"`,
        },
      });

      // 8) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating callback number.', 500, e.message);
      }

      // 9) Validar & formatear salida
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      // 10) Notificar SignalR (best-effort)
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

      // 11) Responder con ticket completo
      return success('Operation successfull', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdatePatientPhone error:', e);
      return error('Unexpected error updating callback number.', 500, e.message);
    }
  }, {
    // Auth: scope + grupo de acceso del módulo
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  })
});
