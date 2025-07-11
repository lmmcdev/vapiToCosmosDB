const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoGetByIds', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      // Leer arreglo de IDs del cuerpo de la petición
      const body = await req.json();
      const ticketIds = body.ticketIds;

      if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
        return badRequest("Missing or empty 'ticketIds' array in request body.");
      }

      const ticketContainer = getContainer();

      // Construir consulta IN dinámicamente
      const inClause = ticketIds.map((_, i) => `@id${i}`).join(', ');
      const query = `
        SELECT c.id, c.summary, c.call_reason, c.creation_date, c.patient_name,
               c.patient_dob, c.caller_name, c.callback_number, c.caller_id,
               c.call_cost, c.notes, c.collaborators, c.url_audio, c.assigned_department,
               c.assigned_role, c.caller_type, c.call_duration, c.status, c.agent_assigned,
               c.tiket_source, c.phone, c.work_time, c.aiClassification
        FROM c
        WHERE c.id IN (${inClause})
      `;

      // Crear parámetros dinámicos
      const parameters = ticketIds.map((id, i) => ({
        name: `@id${i}`,
        value: id
      }));

      const { resources: tickets } = await ticketContainer.items
        .query({ query, parameters })
        .fetchAll();

      return success(tickets);
    } catch (err) {
      context.log('❌ Error al consultar tickets por IDs:', err);
      return error('Error al consultar tickets por IDs', err);
    }
  }
});