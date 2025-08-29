// src/functions/cosmoUpdatePatientName/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updatePatientNameInput } = require('./dtos/input.schema');
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { canModifyTicket } = require('./helpers/canModifyTicketHelper');  // 👈 nuevo helper
const { resolveUserDepartment } = require('./helpers/resolveDepartment');



const lc = (s) => (s || '').toLowerCase();

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

      // 2) Parse + valida input (DTO)
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

      const ticketId = value.tickets;
      const nuevo_nombreapellido = value.nuevo_nombreapellido;

      // 3) Leer ticket
      const item = getContainer().item(ticketId, ticketId);
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


      // 4) Autorización contextual: asignado o colaborador
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator =
        Array.isArray(existing.collaborators) &&
        existing.collaborators.map(lc).includes(lc(actor_email));

      if (!isAssigned && !isCollaborator) {
        return badRequest('You do not have permission to update the patient name.');
      }

      // 5) Patch
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

      // 6) Releer actualizado
      let updated;
      try {
        ({ resource: updated } = await item.read());
      } catch (e) {
        return error('Error reading updated ticket.', 500, e.message);
      }

      // 7) DTO salida
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(updated, badRequest, context);
      } catch (badReq) {
        return badReq;
      }


      return success('Operation successful', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdatePatientName error:', e);
      return error('Unexpected error updating patient name.', 500, e.message);
    }
  }, {
    scopesAny: ['access_as_user'],
    // ✅ acceso a todos los grupos definidos en groups.config
    groupsAny: Object.values(GROUPS).flatMap(mod => Object.values(mod)),
  })
});
