// src/functions/updateTicketsByPhone/index.js (CommonJS)
const { app } = require('@azure/functions');
const fetch = require('node-fetch');

const { getContainer } = require('../shared/cosmoClient');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { getMiamiNow } = require('./helpers/timeHelper');

const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');
const { canModifyTicket } = require('./helpers/canModifyTicketHelper');

// 📌 Todos los grupos
const ALL_GROUPS = Object.values(GROUPS)
  .flatMap(mod => Object.values(mod))
  .filter(Boolean);

const patientsContainer = getPatientsContainer();

app.http('updateTicketsByPhone', {
  route: 'updateTicketsByPhone',
  methods: ['POST'],
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

      const { role } = resolveUserDepartment(claims) || {};
      const isSupervisor = role === 'SUPERVISORS_GROUP';

      // 2) Parse entrada
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON payload.');
      }

      const { action = 'relatePast', ticket_id, phone, patient_id } = body;
      const container = getContainer();

      // 3) Validaciones de negocio
      const allowed = ['relateCurrent', 'relatePast', 'relateFuture', 'unlink'];
      if (!allowed.includes(action)) return badRequest('Invalid Action.');
      if (!patient_id && action !== 'unlink') return badRequest('Missing patient_id');
      if (['relateCurrent', 'unlink'].includes(action) && !ticket_id) return badRequest('Missing ticket_id');
      if (action === 'relatePast' && !phone) return badRequest('Missing phone');

      // 4) Snapshot paciente
      let linked_patient_snapshot = {};
      if (patient_id && patientsContainer) {
        try {
          const { resource: patient } = await patientsContainer.item(patient_id, patient_id).read();
          if (patient) {
            linked_patient_snapshot = {
              id: patient.id,
              Name: patient.Name || '',
              DOB: patient.DOB || '',
              Address: patient.Address || '',
              Location: patient.Location_Name || '',
              Attending_Physician: patient.Attending_Physician || '',
            };
          }
        } catch (err) {
          context.log(`Could not build snapshot: ${err.message}`);
        }
      }

      // ====== ACTION: relateCurrent ======
      if (action === 'relateCurrent') {
        const item = container.item(ticket_id, ticket_id);
        const { resource: ticket } = await item.read().catch((e) => {
          throw { _msg: 'Error reading ticket.', err: e };
        });
        if (!ticket) return badRequest('Ticket not found.');

        if (!canModifyTicket(ticket, actor_email, isSupervisor)) {
          return { status: 403, jsonBody: { error: 'Insufficient permission for relateCurrent.' } };
        }

        const patchOps = [];
        if (!ticket.patient_id) {
          patchOps.push({ op: 'add', path: '/patient_id', value: patient_id });
        } else if (ticket.patient_id !== patient_id) {
          patchOps.push({ op: 'replace', path: '/patient_id', value: patient_id });
        }

        if (!ticket.linked_patient_snapshot) {
          patchOps.push({ op: 'add', path: '/linked_patient_snapshot', value: linked_patient_snapshot });
        } else {
          patchOps.push({ op: 'replace', path: '/linked_patient_snapshot', value: linked_patient_snapshot });
        }

        if (!Array.isArray(ticket.notes)) {
          patchOps.push({ op: 'add', path: '/notes', value: [] });
        }

        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: miamiUTC,
            event_type: 'system_log',
            agent_email: actor_email,
            event: `Linked this ticket to patient_id: ${patient_id}`,
          },
        });

        if (patchOps.length > 0) {
          await item.patch(patchOps).catch((e) => {
            throw { _msg: 'Error patching ticket.', err: e };
          });
        }

        const { resource: updatedTicket } = await item.read();
        const dto = validateAndFormatTicket(updatedTicket, badRequest, context);

        return success('Operation successfull', dto, 201);
      }

      // ====== ACTION: relatePast ======
      if (action === 'relatePast') {
        let updatedCount = 0;
        let continuationToken = null;

        const query = {
          query: 'SELECT * FROM c WHERE c.phone = @phone',
          parameters: [{ name: '@phone', value: phone }],
        };

        do {
          const { resources, continuationToken: token } = await container.items
            .query(query, { continuationToken, maxItemCount: 100 })
            .fetchNext();

          for (const ticket of resources) {
            if (!canModifyTicket(ticket, actor_email, isSupervisor)) {
              context.log(`🚫 Skipping ticket ${ticket.id}, user not authorized`);
              continue;
            }

            const item = container.item(ticket.id, ticket.id);
            const patchOps = [];

            if (!ticket.patient_id) {
              patchOps.push({ op: 'add', path: '/patient_id', value: patient_id });
            } else if (ticket.patient_id !== patient_id) {
              patchOps.push({ op: 'replace', path: '/patient_id', value: patient_id });
            }

            if (!ticket.linked_patient_snapshot) {
              patchOps.push({ op: 'add', path: '/linked_patient_snapshot', value: linked_patient_snapshot });
            } else {
              patchOps.push({ op: 'replace', path: '/linked_patient_snapshot', value: linked_patient_snapshot });
            }

            if (!Array.isArray(ticket.notes)) {
              patchOps.push({ op: 'add', path: '/notes', value: [] });
            }

            patchOps.push({
              op: 'add',
              path: '/notes/-',
              value: {
                datetime: miamiUTC,
                event_type: 'system_log',
                agent_email: actor_email,
                event: `Linked ticket to patient_id: ${patient_id}`,
              },
            });

            if (patchOps.length > 0) {
              await item.patch(patchOps);
              updatedCount++;
            }
          }

          continuationToken = token;
        } while (continuationToken);

        return success(`Operation successfull`, { updatedCount }, 201);
      }

      // ====== ACTION: relateFuture ======
      if (action === 'relateFuture') {
        if (!isSupervisor) {
          return { status: 403, jsonBody: { error: 'Only supervisors can create future link rules.' } };
        }

        const ruleContainer = container.database.container('phone_link_rules');
        const ruleId = `rule_${phone}`;
        await ruleContainer.items.upsert({
          id: ruleId,
          phone,
          patient_id,
          link_future: true,
          linked_patient_snapshot,
          created_at: miamiUTC,
          created_by: actor_email,
        });

        return success('Operation successfull', { phone, patient_id, ruleId }, 201);
      }

      // ====== ACTION: unlink ======
      if (action === 'unlink') {
        const item = container.item(ticket_id, ticket_id);
        const { resource: ticket } = await item.read().catch((e) => {
          throw { _msg: 'Error reading ticket.', err: e };
        });
        if (!ticket) return badRequest('Ticket not found.');

        if (!canModifyTicket(ticket, actor_email, isSupervisor)) {
          return { status: 403, jsonBody: { error: 'Insufficient permission for unlink.' } };
        }

        const patchOps = [];

        const setNull = (prop) => {
          if (Object.prototype.hasOwnProperty.call(ticket, prop)) {
            patchOps.push({ op: 'replace', path: `/${prop}`, value: null });
          } else {
            patchOps.push({ op: 'add', path: `/${prop}`, value: null });
          }
        };

        setNull('patient_id');
        setNull('linked_patient_snapshot');

        if (!Array.isArray(ticket.notes)) {
          patchOps.push({ op: 'add', path: '/notes', value: [] });
        }
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: miamiUTC,
            event_type: 'system_log',
            agent_email: actor_email,
            event: 'Unlinked ticket from patient_id',
          },
        });

        if (patchOps.length > 0) {
          await item.patch(patchOps).catch((e) => {
            throw { _msg: 'Error patching ticket.', err: e };
          });
        }

        const { resource: updatedTicket } = await container
          .item(ticket_id, ticket_id)
          .read({ consistencyLevel: 'Strong' });

        const dto = validateAndFormatTicket(updatedTicket, badRequest, context);
        return success('Operation successfull', dto, 201);
      }

      return badRequest('Unsupported action.');
    } catch (e) {
      if (e && e._msg) {
        return error(e._msg, 500, e.err?.message || e.err || 'Unknown');
      }
      return error('Error', 500, e?.message || 'Unknown');
    }
  }, {
    scopesAny: ['access_as_user'],
    groupsAny: ALL_GROUPS,
  })
});
