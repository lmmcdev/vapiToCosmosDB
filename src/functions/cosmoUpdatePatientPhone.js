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

    // Validar número de teléfono de EE. UU.
    const phoneRegex = /^(\+1\s?)?(\([2-9][0-9]{2}\)|[2-9][0-9]{2})[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/;
    if (!phoneRegex.test(new_phone)) {
      return badRequest('Invalid US phone number format. (e.g., 555-123-4567 or (555) 123-4567)');
    }

    const container = getContainer();

    try {
      const item = container.item(tickets, tickets);

      await item.patch([
        {
          op: 'replace',
          path: '/phone',
          value: new_phone
        },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Patient phone changed to "${new_phone}"`
          }
        }
      ]);

      return success('Phone number updated successfully.');
    } catch (err) {
      context.log('❌ Error updating phone:', err);
      return error('Error updating patient phone.', 500, err.message);
    }
  }
});
