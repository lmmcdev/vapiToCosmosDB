// src/functions/cosmoUpdatePatientPhone/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updatePatientPhoneInput } = require('./dtos/input.schema');
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

app.http('cosmoUpdatePatientPhone', {
  route: 'cosmoUpdatePatientPhone',
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

      // 2) Parse + valida entrada (DTO)
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

      const ticketId = value.tickets;
      const new_phone = value.new_phone;

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

      // 4) Autorización: asignado, colaborador o supervisor
      const lc = (s) => (s || '').toLowerCase();
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator =
        Array.isArray(existing.collaborators) &&
        existing.collaborators.map(lc).includes(lc(actor_email));
      const isSupervisor =
        Array.isArray(claims.groups) &&
        claims.groups.some(g =>
          g.toLowerCase().includes('supervisor') // simplificación
        );

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest("You do not have permission to update this ticket's callback number.");
      }

      // 5) Construir patchOps
      const patchOps = [
        {
          op: existing.callback_number === undefined ? 'add' : 'replace',
          path: '/callback_number',
          value: new_phone,
        },
      ];

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
          event: `Callback number changed to "${new_phone}"`,
        },
      });

      // 6) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating callback number.', 500, e.message);
      }

      // 7) DTO salida
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      return success('Operation successful', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdatePatientPhone error:', e);
      return error('Unexpected error updating callback number.', 500, e.message);
    }
  }, {
    // 🔐 Cualquier usuario logueado de cualquier grupo
    scopesAny: ['access_as_user'],
    groupsAny: Object.values(GROUPS).flatMap(Object.values),
  })
});
