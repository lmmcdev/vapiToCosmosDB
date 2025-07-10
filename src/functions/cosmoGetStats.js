const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

app.http('cosmoGetStats', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getContainer();

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
          WHERE c.createdAt >= @startOfDay AND c.createdAt < @endOfDay
        `,
        parameters: [
          { name: '@startOfDay', value: startOfDayISO },
          { name: '@endOfDay', value: endOfDayISO }
        ]
      };

      const { resources: filteredTickets } = await container.items
        .query(query)
        .fetchAll();

      const stats = {
        total: 0,
        New: 0,
        'In Progress': 0,
        Done: 0,
        Emergency: 0,
        Pending: 0,
        Duplicated: 0,
        //manualCalls: 0,
        //transferred: 0,
      };

      for (const ticket of filteredTickets) {
        stats.total++;

        const status = ticket.status || 'Unknown';
        if (stats[status] !== undefined) {
          stats[status]++;
        }

        if (ticket.tiket_source === 'Form') {
          stats.manualCalls++;
        }

        const currentDept = ticket.assigned_department;
        const dept1 = ticket.call?.call_analysis?.custom_analysis_data?.assigned_department;
        const dept2 = ticket.message?.analysis?.vapi_assignment;
        if ((dept1 && dept1 !== currentDept) || (dept2 && dept2 !== currentDept)) {
          stats.transferred++;
        }
      }

      return success(stats);
    } catch (err) {
      context.log('❌ Error al obtener estadísticas:', err);
      return error('Error al obtener estadísticas', err);
    }
  }
});