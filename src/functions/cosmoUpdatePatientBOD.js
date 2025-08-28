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
const { getEmailFromClaims } = require('./auth/auth.helper');

const lc = (s) => (s || '').toLowerCase();

app.http('cosmoUpdatePatientBOD', {
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

      // 2) Validar entrada (DTO)
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

      const ticketId = value.tickets;
      const nueva_fechanacimiento = value.nueva_fechanacimiento;

      // 3) Leer ticket
      const item = getContainer().item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // 4) Autorización contextual: asignado o colaborador
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator =
        Array.isArray(existing.collaborators) &&
        existing.collaborators.map(lc).includes(lc(actor_email));

      if (!isAssigned && !isCollaborator) {
        return badRequest('You do not have permission to update the patient DOB.');
      }

      // 5) Construir patchOps
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

      // 6) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error updating patient DOB.', 500, e.message);
      }

      // 7) Formatear salida DTO
      const formattedDto = validateAndFormatTicket(existing, badRequest, context);

      return success('Operation successful', formattedDto);
    } catch (e) {
      context.log('❌ cosmoUpdatePatientBOD error:', e);
      return error('Unexpected error updating patient DOB.', 500, e.message);
    }
  }, {
    scopesAny: ['access_as_user'],
    // ✅ acceso para todos los grupos de todos los módulos
    groupsAny: Object.values(GROUPS).flatMap(mod => Object.values(mod)),
  })
});