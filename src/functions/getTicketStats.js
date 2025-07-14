const { app } = require('@azure/functions');
const { getStatsContainer } = require('../shared/cosmoStatsClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs');

app.http('getTicketStats', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, ctx) => {
    try {
      const container = getStatsContainer();
      const params = req.query;

      const date = params.get('date');    // Día exacto
      const month = params.get('month');  // Mes exacto

      let query;

      if (date) {
        if (!dayjs(date, 'YYYY-MM-DD', true).isValid()) {
          return badRequest('The date must be in YYYY-MM-DD format.');
        }

        query = `SELECT * FROM c WHERE c.date = "${date}"`;
        ctx.log(`Executing daily query: ${query}`);

      } else if (month) {
        if (!dayjs(month, 'YYYY-MM', true).isValid()) {
          return badRequest('The month must be in YYYY-MM format.');
        }

        const monthKey = `month-${month}`;
        query = `SELECT * FROM c WHERE c.id = "${monthKey}"`;
        ctx.log(`Executing monthly query: ${query}`);

      } else {
        const today = dayjs().format('YYYY-MM-DD');
        query = `SELECT * FROM c WHERE c.date = "${today}"`;
        ctx.log(`Executing default query: ${query}`);
      }

      const { resources } = await container.items.query(query).fetchAll();

      ctx.log(`Query returned ${resources.length} results`);

      if (!resources.length) {
        return success({ message: 'No statistics found for the given date or month.' }, 204);
      }

      return success(resources[0]);

    } catch (err) {
      ctx.log.error('Error fetching stats:', err);
      return error('Failed to fetch stats', err);
    }
  }
});
