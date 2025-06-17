const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

app.http('cosmoGetTicketsByStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getContainer();

      const statusParam = req.query.get('status') || 'In Progress';
      const dateParam = req.query.get('date'); // formato esperado: YYYY-MM-DD

      const isValidDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);

      const baseDate = isValidDate
        ? dayjs.utc(dateParam).startOf('day')
        : dayjs.utc().startOf('day');

      const startOfDayISO = baseDate.toISOString();
      const endOfDayISO = baseDate.add(1, 'day').toISOString();

      const query = {
        query: `
          SELECT * FROM c
          WHERE c.createdAt >= @startOfDay AND c.createdAt < @endOfDay AND c.status = @status
        `,
        parameters: [
          { name: '@startOfDay', value: startOfDayISO },
          { name: '@endOfDay', value: endOfDayISO },
          { name: '@status', value: statusParam }
        ]
      };

      const { resources: filteredTickets } = await container.items.query(query).fetchAll();

      return success(filteredTickets);
    } catch (err) {
      context.log('❌ Error al obtener tickets filtrados:', err);
      return error('Error al obtener tickets filtrados', err);
    }
  }
});
