const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient');
const { success, badRequest, error } = require('../shared/responseUtils');

const patientsContainer = getPatientsContainer();

app.http('updateTicketsByPhone', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const {
        action = 'relatePast',
        ticket_id,
        phone,
        patient_id,
        agent_email = 'system@update'
      } = await request.json();

      const container = getContainer();

      if (!['relateCurrent', 'relatePast', 'relateFuture', 'unlink'].includes(action)) {
        return badRequest('Invalid Action.');
      }

      if (!patient_id && action !== 'unlink') {
        return badRequest('Missing required field: patient_id');
      }

      if (['relateCurrent', 'unlink'].includes(action) && !ticket_id) {
        return badRequest('Missing required field: ticket_id');
      }

      let linked_patient_snapshot = {};

      // 👇 Mismo snapshot que `cosmoInsertVapi`
      if (patient_id && patientsContainer) {
        try {
          const { resource: patient } = await patientsContainer.item(patient_id, patient_id).read();
          if (patient) {
            linked_patient_snapshot = {
              id: patient.id,
              Name: patient.Name || "",
              DOB: patient.DOB || "",
              Address: patient.Address || "",
              Location: patient.Location || ""
            };
          }
        } catch (err) {
          context.log(`Could not build snapshot: ${err.message}`);
        }
      }

      let updatedCount = 0;
      let updatedIds = [];

      // 👉 RELATE CURRENT TICKET
      if (action === 'relateCurrent') {
        const item = container.item(ticket_id, ticket_id);
        const { resource: ticket } = await item.read();

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
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Linked this ticket to patient_id: ${patient_id}`
          }
        });

        if (patchOps.length > 0) {
          await item.patch(patchOps);
          updatedCount = 1;
          updatedIds.push(ticket_id);
        }

        return success(`Linked ticket ${ticket_id} to patient_id ${patient_id}`, { updatedIds }, 201);
      }

      // 👉 RELATE ALL PAST TICKETS BY PHONE
      if (action === 'relatePast') {
        if (!phone) {
          return badRequest('Missing required field: phone');
        }

        let continuationToken = null;

        const query = {
          query: 'SELECT * FROM c WHERE c.phone = @phone',
          parameters: [{ name: '@phone', value: phone }]
        };

        do {
          const { resources, continuationToken: token } = await container.items
            .query(query, { continuationToken, maxItemCount: 100 })
            .fetchNext();

          for (const ticket of resources) {
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
                datetime: new Date().toISOString(),
                event_type: 'system_log',
                agent_email,
                event: `Linked ticket to patient_id: ${patient_id}`
              }
            });

            if (patchOps.length > 0) {
              await container.item(ticket.id, ticket.id).patch(patchOps);
              updatedCount++;
              updatedIds.push(ticket.id);
            }
          }

          continuationToken = token;
        } while (continuationToken);

        return success(`Updated ${updatedCount} ticket(s) with phone ${phone}`, { updatedCount }, 201);
      }

      // 👉 RELATE FUTURE (RULE)
      if (action === 'relateFuture') {
        const ruleContainer = container.database.container('phone_link_rules');

        const ruleId = `rule_${phone}`;
        await ruleContainer.items.upsert({
          id: ruleId,
          phone,
          patient_id,
          linked_patient_snapshot,
          created_at: new Date().toISOString(),
          created_by: agent_email
        });

        return success('Future link rule saved', { phone, patient_id }, 201);
      }

      // 👉 UNLINK
      if (action === 'unlink') {
        const item = container.item(ticket_id, ticket_id);
        const { resource: ticket } = await item.read();

        const patchOps = [];

        if (ticket.patient_id) {
          patchOps.push({ op: 'remove', path: '/patient_id' });
        }

        if (ticket.linked_patient_snapshot) {
          patchOps.push({ op: 'remove', path: '/linked_patient_snapshot' });
        }

        if (!Array.isArray(ticket.notes)) {
          patchOps.push({ op: 'add', path: '/notes', value: [] });
        }

        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Unlinked ticket from patient_id`
          }
        });

        if (patchOps.length > 0) {
          await item.patch(patchOps);
          updatedCount = 1;
          updatedIds.push(ticket_id);
        }

        return success(`Unlinked ticket ${ticket_id}`, { ticket_id }, 201);
      }

    } catch (err) {
      return error('Error', 500, err.message);
    }
  }
});
