// src/functions/cosmoUpdateStatus/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateTicketStatusInput } = require('./dtos/input.schema');
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔐 Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

app.http('cosmoUpdateStatus', {
  route: 'cosmoUpdateStatus',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      const { dateISO: miamiUTC } = getMiamiNow();

      // 1) Actor
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Rol efectivo (supervisor/agent)
      // Nota: aquí seguimos resolviendo roles con cualquier grupo supervisor/agent
      const { role } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: Object.values(GROUPS.SWITCHBOARD || {})?.[1], // si tienes helpers mejores, úsalos
        AGENTS_GROUP: Object.values(GROUPS.SWITCHBOARD || {})?.[2],
      });
      if (!role) {
        return { status: 403, jsonBody: { error: 'User has no role group' } };
      }

      // 3) Body + DTO
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON.');
      }

      const { error: vErr, value } = updateTicketStatusInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
        context: { role },
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input';
        return badRequest(details);
      }

      const { ticketId, newStatus } = value;

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
      const isCollaborator =
        Array.isArray(existing.collaborators) &&
        existing.collaborators.map(lc).includes(lc(actor_email));
      const isSupervisor = role === 'supervisor';

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest(`You do not have permission to change this ticket's status.`);
      }

      // 6) Evitar estado duplicado
      if ((existing.status || '') === newStatus) {
        return badRequest('New status is the same as current.');
      }

      // 7) PatchOps
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({ op: 'replace', path: '/status', value: newStatus });

      // Manejo de cierre / reapertura
      if (newStatus === 'Done') {
        patchOps.push({
          op: existing.closedAt ? 'replace' : 'add',
          path: '/closedAt',
          value: miamiUTC,
        });
      } else if (existing.status === 'Done' && existing.closedAt) {
        patchOps.push({ op: 'replace', path: '/closedAt', value: null });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: miamiUTC,
          event_type: 'system_log',
          agent_email: actor_email,
          event: `Status changed: "${existing.status}" → "${newStatus}"`,
        },
      });

      // 8) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating status.', 500, e.message);
      }

      // 9) Formatear DTO
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      return success('Operation successful', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdateStatus error:', e);
      return error('Unexpected error updating status.', 500, e.message);
    }
  }, {
    // 🔐 Todos los usuarios de todos los grupos
    scopesAny: ['access_as_user'],
    groupsAny: Object.values(GROUPS).flatMap(Object.values),
  })
});
