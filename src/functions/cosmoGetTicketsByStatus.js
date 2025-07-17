const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

app.http('cosmoGetTicketsByStatus', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let body;
    try {
      body = await req.json();
    } catch (err) {
      return badRequest('Invalid JSON body', err.message);
    }

    try {
      const container = getContainer();

      // Obtener parámetros del body
      const statusParam = body.status || 'In Progress';
      const dateParam = body.date; // formato esperado: YYYY-MM-DD
      const continuationToken = body.continuationToken || null;
      const limit = parseInt(body.limit) || 5;

      // Validar fecha
      const isValidDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
      const baseDate = isValidDate
        ? dayjs.utc(dateParam).startOf('day')
        : dayjs.utc().startOf('day');

      const startOfDayISO = baseDate.toISOString();
      const endOfDayISO = baseDate.add(1, 'day').toISOString();

      context.log('📌 status:', statusParam);
      context.log('📌 date:', dateParam);
      context.log('📌 startOfDayISO:', startOfDayISO);
      context.log('📌 endOfDayISO:', endOfDayISO);
      context.log('📌 continuationToken:', continuationToken);
      context.log('📌 limit:', limit);

      // Query SQL
      const query = {
        query: `
          SELECT c.status, c.tickets, c.tiket_source, c.summary, c.call_reason, c.createdAt, c.creation_date, 
                 c.patient_name, c.patient_dob, c.callback_number, c.phone, c.url_audio, c.caller_id, 
                 c.call_cost, c.assigned_department, c.assigned_role, c.caller_type, c.call_duration, 
                 c.agent_assigned, c.collaborators, c.aiClassification, c.notes, c.work_time
          FROM c
          WHERE c.createdAt >= @startOfDay AND c.createdAt < @endOfDay AND c.status = @status
        `,
        parameters: [
          { name: '@startOfDay', value: startOfDayISO },
          { name: '@endOfDay', value: endOfDayISO },
          { name: '@status', value: statusParam }
        ]
      };

      // Opciones de paginación
      const options = {
        maxItemCount: limit,
        continuationToken
      };

      const iterator = container.items.query(query, options);
      const { resources: items, continuationToken: nextToken } = await iterator.fetchNext();

      return success({
        items,
        continuationToken: nextToken || null,
      });
    } catch (err) {
      context.log('❌ Error al obtener tickets filtrados:', err);
      return badRequest('Error al obtener tickets filtrados', err);
    }
  }
});
