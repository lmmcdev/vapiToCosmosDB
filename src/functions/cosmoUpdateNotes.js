// src/functions/cosmoUpdateNotes/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateTicketNotesInput } = require('./dtos/input.schema');

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

app.http('cosmoUpdateNotes', {
  route: 'cosmoUpdateNotes',
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

      // 2) Rol efectivo por grupos (supervisor/agent)
      const { role } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
        AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
      });
      // No exigimos rol específico; lo usamos para permitir a supervisores

      // 3) Validar entrada (DTO)
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

      const ticketId = value.ticketId || value.tickets; // soporta ambos campos
      const notes    = Array.isArray(value.notes) ? value.notes : [];
      const event    = value.event;

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

      // 5) Autorización: asignado, colaborador o supervisor
      const lc = (s) => (s || '').toLowerCase();
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator = Array.isArray(existing.collaborators)
        && existing.collaborators.map(lc).includes(lc(actor_email));
      const isSupervisor = role === 'supervisor';

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to update notes on this ticket.');
      }

      // 6) Construir operaciones PATCH
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      // Añadir notas de usuario (normalizadas)
      if (notes.length > 0) {
        for (const note of notes) {
          const safeNote = {
            ...note,
            datetime: note?.datetime || new Date().toISOString(),
            event_type: note?.event_type || 'user_note',
            agent_email: note?.agent_email || actor_email,
          };
          patchOps.push({ op: 'add', path: '/notes/-', value: safeNote });
        }

        // Log del sistema por lote de notas
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email: actor_email,
            event: `Added ${notes.length} note(s) to the ticket.`,
          },
        });
      }

      // Mensaje de sistema puntual (opcional)
      if (event) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email: actor_email,
            event,
          },
        });
      }

      if (patchOps.length === 0) {
        return badRequest('No valid operations to apply.');
      }

      // 7) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating notes.', 500, e.message);
      }

      // 8) Formatear DTO
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

      // 10) Respuesta final (ticket completo)
      return success('Operation successfull', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdateNotes error:', e);
      return error('Unexpected error updating notes.', 500, e.message);
    }
  }, {
    // 🔐 Auth a nivel de endpoint
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  })
});
