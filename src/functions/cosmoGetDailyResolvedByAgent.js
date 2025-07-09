const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

app.http('cosmoGetDailyResolvedByAgent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getContainer();

      const dateParam = req.query.get('date'); // formato: YYYY-MM-DD
      const isValidDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);

      const baseDate = isValidDate
        ? dayjs.utc(dateParam).startOf('day')
        : dayjs.utc().startOf('day');

      const startOfDayISO = baseDate.toISOString();
      const endOfDayISO = baseDate.add(1, 'day').toISOString();

      const query = {
        query: `
          SELECT TOP 20 c.agent_assigned, COUNT(1) AS resolvedCount
          FROM c
          WHERE c.closedAt != null AND c.closedAt >= @start AND c.closedAt < @end AND c.status = 'Done'
          GROUP BY c.agent_assigned
        `,
        parameters: [
          { name: '@start', value: startOfDayISO },
          { name: '@end', value: endOfDayISO },
        ],
      };

      const { resources: results } = await container.items.query(query).fetchAll();

      // results será un array de objetos como: { agent_assigned: 'john@example.com', resolvedCount: 5 }
      return success(results);
    } catch (err) {
      context.log('❌ Error al obtener tickets resueltos por agente:', err);
      return error('Error al obtener tickets resueltos por agente', err);
    }
  },
});

/*SELECT TOP 20 
  c.agent_assigned, 
  COUNT(1) AS resolvedCount
FROM c
WHERE 
  IS_DEFINED(c.closedAt) 
  AND c.closedAt != null 
  AND c.closedAt >= @start 
  AND c.closedAt < @end 
  AND c.status = 'Done'
GROUP BY c.agent_assigned
ORDER BY resolvedCount DESC*/