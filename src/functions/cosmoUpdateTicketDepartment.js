// src/functions/cosmoUpdateTicketDepartment/index.js (CommonJS)
const { app } = require('@azure/functions');
const fetch = require('node-fetch');

const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { updateTicketDepartmentInput } = require('./dtos/input.schema');
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔐 Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// Helper: sacar todos los grupos supervisores de groups.config
const ALL_SUPERVISOR_GROUPS = Object.values(GROUPS)
  .map(mod => mod.SUPERVISORS_GROUP)
  .filter(Boolean);

app.http('cosmoUpdateTicketDepartment', {
  route: 'cosmoUpdateTicketDepartment',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      const { dateISO: miamiUTC } = getMiamiNow();

      // 1) Claims
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Parse body + validar DTO
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON payload.');
      }
      const { error: vErr, value } = updateTicketDepartmentInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input.';
        return badRequest(details);
      }

      const ticketId = value.tickets;
      const newDepartment = value.newDepartment;

      // 3) Leer ticket
      const ticketItem = getContainer().item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await ticketItem.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // 4) Autorización: SOLO supervisores
      // (los grupos ya se validaron en withAuth, pero reforzamos aquí)
      const tokenGroups = Array.isArray(claims?.groups) ? claims.groups : [];
      const isSupervisor = tokenGroups.some(g => ALL_SUPERVISOR_GROUPS.includes(g));

      if (!isSupervisor) {
        return { status: 403, jsonBody: { error: 'Only supervisors can update department.' } };
      }

      // 5) Evitar redundante
      if ((existing.assigned_department || '') === newDepartment) {
        return badRequest('The department is already set to the desired value.');
      }

      // 6) Construir patchOps
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({ op: 'replace', path: '/assigned_department', value: newDepartment });
      patchOps.push({ op: 'replace', path: '/agent_assigned', value: '' });
      patchOps.push({ op: 'replace', path: '/collaborators', value: [] });
      patchOps.push({ op: 'replace', path: '/status', value: 'New' });

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: miamiUTC,
          event_type: 'system_log',
          agent_email: actor_email,
          event: `Department changed from "${existing.assigned_department || 'None'}" to "${newDepartment}" by Supervisor.`,
        },
      });

      // 7) Aplicar cambios y releer
      try {
        await ticketItem.patch(patchOps);
        ({ resource: existing } = await ticketItem.read());
      } catch (e) {
        return error('Error updating department.', 500, e.message);
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
      context.log('❌ cosmoUpdateTicketDepartment error:', e);
      return error('Unexpected error updating department.', 500, e.message);
    }
  }, {
    scopesAny: ['access_as_user'],
    groupsAny: ALL_SUPERVISOR_GROUPS, // 🔐 Solo supervisores
  })
});
