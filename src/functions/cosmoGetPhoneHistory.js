const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');

app.http('cosmoGetPhoneHistory', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (req, context) => {
    try {
        //`/api/cosmoGetPhoneHistory?phone=${encodeURIComponent(phone)}` desde el cliente
        const phone = req.query.get('phone');

        if (!phone) {
            return badRequest('Missing required query parameter: phone');
        }

        const container = getContainer();

        const { resources: items } = await container.items
            .query({
                query: "SELECT c.call_reason, c.caller_id, c.summary, c.creation_date, c.status FROM c WHERE c.phone = @phone",
                parameters: [{ name: "@phone", value: phone }]
            })
            .fetchAll();

        return success('Records retrieved successfully', { items });

    } catch (err) {
      context.log('Error al consultar historial por teléfono:', err);
      return error('Error al consultar historial por teléfono', 500, err.message);
    }
  }
});
