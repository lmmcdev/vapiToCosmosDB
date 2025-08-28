// src/functions/assignAgent/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { getMiamiNow } = require('./helpers/timeHelper');


const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

// DTO de entrada
const { assignAgentInput } = require('./dtos/input.schema');

const DEPARTMENT = 'Referrals';

const {
  ACCESS_GROUP: GROUP_ACCESS,
  SUPERVISORS_GROUP: GROUP_SUPERVISORS
  //AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
} = GROUPS.SWITCHBOARD;


app.http('assignAgent', {
  route: 'assignAgent',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      const { dateISO: miamiUTC } = getMiamiNow();

      const claims = context.user;

      // 1) Email del token (agente que hace la asignación)
      const agent_email = getEmailFromClaims(claims);
      if (!agent_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Rol efectivo según grupos (agent o supervisor)
      const { role } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: GROUP_SUPERVISORS,
        //AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
      });
      if (!role) {
        return error('User has no role group for this module', 403, 'Error');
        //return { status: 403, jsonBody: { error: 'User has no role group for this module' } };
      }

      // 3) Parse + valida body con DTO (ticketId requerido)
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON');
      }

      const { error: dtoErr, value } = assignAgentInput.validate(body, { abortEarly: false });
      if (dtoErr) {
        const details = dtoErr.details?.map(d => d.message).join('; ') || 'Validation error';
        return badRequest(details);
      }
      const { tickets: ticketId, target_agent_email } = value;

      // 4) Lee el ticket
      const container = getContainer();
      const item = container.item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error reading ticket.', 500, e.message);
      }
      if (!existing) return badRequest('Ticket not found.');

      // (Opcional) 5) Garantiza que el ticket pertenece al módulo/dep
      if (existing.assigned_department && existing.assigned_department !== DEPARTMENT) {
        return badRequest(
          `Ticket department (${existing.assigned_department}) does not match endpoint department (${DEPARTMENT}).`
        );
      }

      // 6) Build patch: asigna el agente del json y agrega nota
      const patchOps = [
        { op: 'replace', path: '/agent_assigned', value: target_agent_email },
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
          agent_email,
          event: `Assigned agent to the ticket: ${target_agent_email}`,
        },
      });

      // 7) Aplica patch y relee
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Error assigning agent.', 500, e.message);
      }

      // 8) Formatea salida con tu helper DTO
      let formattedDto;
      try {
        formattedDto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      // 10) Respuesta OK
      return success('Status updated successfully.', formattedDto);
      
    } catch (e) {
      context.log('❌ assignAgent error:', e);
      return error('Unexpected error assigning agent.', 500, e.message);
    }
  }, {
    // Reforzamos que el token tenga el scope correcto
    scopesAny: ['access_as_user'],
    // Puerta de entrada al módulo: debe pertenecer al grupo de acceso del módulo
    groupsAny: [GROUP_ACCESS],
    // No exigimos roles aquí; los resolvemos dinámicamente arriba
  })
});