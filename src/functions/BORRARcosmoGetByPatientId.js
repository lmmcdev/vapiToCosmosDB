const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoGetByPatientId', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const body = await req.json();
      const patientId = body.patientId;
      const continuationToken = body.continuationToken || null;
      const limit = parseInt(body.limit) || 10;

      if (!patientId) {
        return badRequest("Missing or empty 'patientId' in request body.");
      }

      const ticketContainer = getContainer();

      // ✅ Query para traer todos los tickets de un paciente específico
      const query = `
        SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
               c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
               c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
               c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
               c.tiket_source, c.phone, c.work_time, c.aiClassification, c.createdAt
        FROM c
        WHERE c.patient_id = @patientId
      `;

      const parameters = [
        { name: '@patientId', value: patientId }
      ];

      const options = {
        maxItemCount: limit,
        continuationToken
      };

      const iterator = ticketContainer.items.query({ query, parameters }, options);
      const { resources: items, continuationToken: nextToken } = await iterator.fetchNext();

      return success({
        items,
        continuationToken: nextToken || null
      });

    } catch (err) {
      context.log('❌ Error al consultar tickets por patient_id:', err);
      return error('Error al consultar tickets por patient_id', err);
    }
  }
});
