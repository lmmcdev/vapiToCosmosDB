// src/functions/cosmoUpdateNotes/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateTicketNotesInput } = require('./dtos/input.schema');
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { canModifyTicket } = require('./helpers/canModifyTicketHelper');  // 👈 nuevo helper
const { resolveUserDepartment } = require('./helpers/resolveDepartment');


const lc = (s) => (s || '').toLowerCase();

app.http('cosmoUpdateNotes', {
  route: 'cosmoUpdateNotes',
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

      // 2) Validar entrada con DTO
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON.');
      }

      const { error: vErr, value } = updateTicketNotesInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input.';
        return badRequest(details);
      }

      const ticketId = value.ticketId || value.tickets;
      const notes    = Array.isArray(value.notes) ? value.notes : [];
      const event    = value.event;

      // 3) Leer ticket
      const container = getContainer();
      const item = container.item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      //3.1 can modify?
      const { role } = resolveUserDepartment(claims) || {};
      const isSupervisor = role === 'SUPERVISORS_GROUP';
      if (!canModifyTicket(existing, actor_email, isSupervisor)) {
        return { status: 403, jsonBody: { error: 'Insufficient permissions to update this ticket' } };
      }

      // 4) Autorización contextual: asignado, colaborador o supervisor
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator =
        Array.isArray(existing.collaborators) &&
        existing.collaborators.map(lc).includes(lc(actor_email));

      // 👇 Dado que todos los grupos tienen acceso, basta con ser assigned/collaborator.
      if (!isAssigned && !isCollaborator) {
        return badRequest('You do not have permission to update notes on this ticket.');
      }

      // 5) Construir operaciones PATCH
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      if (notes.length > 0) {
        for (const note of notes) {
          const safeNote = {
            ...note,
            datetime: miamiUTC,
            event_type: note?.event_type || 'user_note',
            agent_email: note?.agent_email || actor_email,
          };
          patchOps.push({ op: 'add', path: '/notes/-', value: safeNote });
        }
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: miamiUTC,
            event_type: 'system_log',
            agent_email: actor_email,
            event: `Added ${notes.length} note(s) to the ticket.`,
          },
        });
      }

      if (event) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: miamiUTC,
            event_type: 'system_log',
            agent_email: actor_email,
            event,
          },
        });
      }

      if (patchOps.length === 0) {
        return badRequest('No valid operations to apply.');
      }

      // 6) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating notes.', 500, e.message);
      }

      // 7) Formatear DTO
      const formattedDto = validateAndFormatTicket(existing, badRequest, context);

      return success('Operation successful', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdateNotes error:', e);
      return error('Unexpected error updating notes.', 500, e.message);
    }
  }, {
    scopesAny: ['access_as_user'],
    // ✅ todos los grupos de todos los módulos
    groupsAny: Object.values(GROUPS).flatMap(mod => Object.values(mod)),
  })
});
