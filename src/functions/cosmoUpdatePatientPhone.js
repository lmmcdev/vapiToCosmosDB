const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoUpdatePatientPhone', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, new_phone;

    try {
      ({ tickets, agent_email, new_phone } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON body.');
    }

    if (!tickets || !agent_email || !new_phone) {
      return badRequest('Missing parameters: tickets, agent_email or new_phone.');
    }

    const phoneRegex = /^(\+1\s?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/;
    if (!phoneRegex.test(new_phone)) {
      return badRequest('Invalid US phone number format. (e.g., 555-123-4567 or (555) 123-4567)');
    }

    const container = getContainer();

    try {
      const itemRef = container.item(tickets, tickets);
      const { resource: doc } = await itemRef.read();

      const patchOps = [];

      // Determinar si usar 'add' o 'replace' en /phone
      if (doc.phone === undefined) {
        patchOps.push({
          op: 'add',
          path: '/phone',
          value: new_phone
        });
      } else {
        patchOps.push({
          op: 'replace',
          path: '/phone',
          value: new_phone
        });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Patient phone changed to "${new_phone}"`
        }
      });

      await itemRef.patch(patchOps);

      return success('Phone number updated successfully.');
    } catch (err) {
      context.log('❌ Error updating phone:', err);
      return error('Error updating patient phone.', 500, err.message);
    }
  }
});
