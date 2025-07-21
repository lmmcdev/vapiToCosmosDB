// api/updateTicketsByPhone/index.js
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('updateTicketsByPhone', {
  methods: ['POST'],
  authLevel: 'function',
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
        return { status: 400, body: `Invalid action: ${action}` };
      }

      if (!patient_id && action !== 'unlink') {
        return { status: 400, body: 'Missing required field: patient_id' };
      }

      if (['relateCurrent', 'unlink'].includes(action) && !ticket_id) {
        return { status: 400, body: 'Missing required field: ticket_id' };
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

        return {
          status: 200,
          jsonBody: {
            message: `Linked ticket ${ticket_id} to patient_id ${patient_id}`,
            updated_ticket_ids: updatedIds
          }
        };
      }

      // 👉 RELATE ALL PAST TICKETS BY PHONE
      if (action === 'relatePast') {
        if (!phone) {
          return { status: 400, body: 'Missing required field: phone' };
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

        return {
          status: 200,
          jsonBody: {
            message: `Updated ${updatedCount} ticket(s) with phone ${phone}`,
            updated_ticket_ids: updatedIds
          }
        };
      }

      // 👉 RELATE FUTURE TICKETS: GUARDAR UNA "RULE"
      if (action === 'relateFuture') {
        // 👉 Aquí decides cómo guardar la regla:
        // Puedes guardar una collection `phone_link_rules` en el mismo Cosmos DB:
        const ruleContainer = container.database.container('phone_link_rules');

        const ruleId = `rule_${phone}`;
        await ruleContainer.items.upsert({
          id: ruleId,
          phone,
          patient_id,
          created_at: new Date().toISOString(),
          created_by: agent_email
        });

        return {
          status: 200,
          jsonBody: {
            message: `Future tickets with phone ${phone} will be auto-linked to patient_id ${patient_id}`
          }
        };
      }

      // 👉 UNLINK TICKET
      if (action === 'unlink') {
        const item = container.item(ticket_id, ticket_id);
        const { resource: ticket } = await item.read();

        const patchOps = [];

        if (ticket.patient_id) {
          patchOps.push({ op: 'remove', path: '/patient_id' });
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

        return {
          status: 200,
          jsonBody: {
            message: `Unlinked ticket ${ticket_id}`,
            updated_ticket_ids: updatedIds
          }
        };
      }

    } catch (error) {
      context.log.error('Error:', error);
      return { status: 500, body: `Error: ${error.message}` };
    }
  }
});
