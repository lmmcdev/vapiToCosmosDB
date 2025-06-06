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
                query: `SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name, 
                c.patient_dob, c.caller_name, c.callback_number, c.caller_id,c.call_cost, c.notes, 
                c.collaborators, c.url_audio, c.assigned_department,
                 c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
                 c.tiket_source, c.phone, c.work_time FROM c WHERE c.phone = @phone`,
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
