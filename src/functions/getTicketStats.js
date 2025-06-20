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

      const dateFrom = params.get('date_from');
      const dateTo = params.get('date_to');

      let query;

      if (dateFrom || dateTo) {
        // Validar formato de fechas
        if (!dayjs(dateFrom, 'YYYY-MM-DD', true).isValid() || !dayjs(dateTo, 'YYYY-MM-DD', true).isValid()) {
          return badRequest('date_from and date_to must be in YYYY-MM-DD format');
        }

        // Consulta con rango
        query = `
          SELECT * FROM c
          WHERE c.date >= "${dateFrom}" AND c.date <= "${dateTo}"
          ORDER BY c.date ASC
        `;
      } else {
        // Sin rango: usar el día actual
        const today = dayjs().format('YYYY-MM-DD');
        query = `SELECT * FROM c WHERE c.date = "${today}"`;
      }

      const { resources } = await container.items.query(query).fetchAll();

      if (!resources.length) {
        return success({ message: 'No statistics found for the given range' }, 204);
      }

      const result = (dateFrom && dateTo) ? resources : resources[0];
      return success(result);

    } catch (err) {
      ctx.log.error('Error fetching stats:', err);
      return error('Failed to fetch stats', err);
    }
  }
});
