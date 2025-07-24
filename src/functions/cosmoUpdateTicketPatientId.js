const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient');
const { success, badRequest, error } = require('../shared/responseUtils');

const patientsContainer = getPatientsContainer();
const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

async function notifySignalR(ticket, context) {
  context.log('🔔 Notifying SignalR:', ticket);
  try {
    await fetch(signalRUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ticket)
    });
  } catch (e) {
    context.log('⚠️ SignalR failed:', e.message);
  }
}

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

      // ✅ Obtener snapshot paciente
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

      // 👉 RELATE CURRENT
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
        }

        // ✅ Leer ticket actualizado y enviar a SignalR
        const { resource: updatedTicket } = await item.read();
        await notifySignalR(updatedTicket, context);

        updatedCount = 1;

        return success(`Linked ticket ${ticket_id} to patient_id ${patient_id}`, { updatedTicket }, 201);
      }

      // 👉 RELATE PAST
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
                datetime: new Date().toISOString(),
                event_type: 'system_log',
                agent_email,
                event: `Linked ticket to patient_id: ${patient_id}`
              }
            });

            if (patchOps.length > 0) {
              await item.patch(patchOps);
              const { resource: updatedTicket } = await item.read();
              await notifySignalR(updatedTicket, context);
              updatedCount++;
            }
          }

          continuationToken = token;
        } while (continuationToken);

        return success(`Updated ${updatedCount} ticket(s) with phone ${phone}`, { updatedCount }, 201);
      }

      // 👉 RELATE FUTURE
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

        // ✅ Enviar una notificación mínima a SignalR (regla)
        await notifySignalR({ type: 'future_rule', phone, patient_id }, context);

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
        }

        // ✅ Forzar lectura fresca desde Cosmos (sin usar el item en caché)
        const { resource: updatedTicket } = await container
          .item(ticket_id, ticket_id)
          .read({ consistencyLevel: "Strong" });

        delete updatedTicket.patient_id;
        delete updatedTicket.linked_patient_snapshot;
        console.log(updatedTicket)
        await notifySignalR(updatedTicket, context);

        return success(`Unlinked ticket ${updatedTicket}`, { updatedTicket }, 201);
      }


    } catch (err) {
      return error('Error', 500, err.message);
    }
  }
});
