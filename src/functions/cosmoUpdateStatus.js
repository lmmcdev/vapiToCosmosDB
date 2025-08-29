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
const { getEmailFromClaims } = require('./auth/auth.helper');

// 🔹 Todos los ACCESS_GROUPs (multi-depto)
const ALL_ACCESS_GROUPS = Object.values(GROUPS)
  .map((dept) => dept.ACCESS_GROUP)
  .filter(Boolean);

const lc = (s) => (s || '').toLowerCase();

app.http('cosmoUpdateStatus', {
  route: 'cosmoUpdateStatus',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      const { dateISO: miamiUTC } = getMiamiNow();

      // 1) Usuario logueado
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Parse + valida body
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON.');
      }

      const { error: vErr, value } = updateTicketStatusInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input';
        return badRequest(details);
      }

      const { ticketId, newStatus } = value;

      // 3) Leer ticket
      const item = getContainer().item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // 4) Autorización contextual
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator =
        Array.isArray(existing.collaborators) &&
        existing.collaborators.map(lc).includes(lc(actor_email));

      if (!isAssigned && !isCollaborator) {
        return badRequest(`You do not have permission to change this ticket's status.`);
      }

      // 5) Evitar duplicados
      if ((existing.status || '') === newStatus) {
        return badRequest('New status is the same as current.');
      }

      // 6) PatchOps
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({ op: 'replace', path: '/status', value: newStatus });

      // cierre/reapertura
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

      // 7) Guardar cambios
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating status.', 500, e.message);
      }

      // 8) DTO salida
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
    groupsAny: ALL_ACCESS_GROUPS,
  })
});
