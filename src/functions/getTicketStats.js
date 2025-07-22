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

      const date = params.get('date');    // Día exacto (YYYY-MM-DD)
      const month = params.get('month');  // Mes exacto (YYYY-MM)

      let query;
      let queryParams = [];

      if (date) {
        // ✅ Validación estricta
        if (!dayjs(date, 'YYYY-MM-DD', true).isValid()) {
          return badRequest('The date must be in YYYY-MM-DD format.');
        }

        // ✅ Documento diario: id = "YYYY-MM-DD"
        query = `SELECT * FROM c WHERE c.id = @id`;
        queryParams.push({ name: '@id', value: date });
        ctx.log(`Executing daily query for ID: ${date}`);

      } else if (month) {
        // ✅ Validación estricta
        if (!dayjs(month, 'YYYY-MM', true).isValid()) {
          return badRequest('The month must be in YYYY-MM format.');
        }

        // ✅ Documento mensual: id = "month-YYYY-MM" AND scope = "month-to-date"
        const monthKey = `month-${month}`;
        query = `SELECT * FROM c WHERE c.id = @id AND c.scope = "month-to-date"`;
        queryParams.push({ name: '@id', value: monthKey });
        ctx.log(`Executing monthly query for ID: ${monthKey}`);

      } else {
        // ✅ Si no se pasa parámetro, devolvemos la fecha actual por defecto
        const today = dayjs().format('YYYY-MM-DD');
        query = `SELECT * FROM c WHERE c.id = @id`;
        queryParams.push({ name: '@id', value: today });
        ctx.log(`Executing default daily query for ID: ${today}`);
      }

      const { resources } = await container.items
        .query({ query, parameters: queryParams })
        .fetchAll();

      ctx.log(`Query returned ${resources.length} results`);

      if (!resources.length) {
        return success({ message: 'No statistics found for the given date or month.' }, 204);
      }

      return success(resources[0]);

    } catch (err) {
      ctx.log.error('Error fetching stats:', err);
      return error('Failed to fetch stats', err.message);
    }
  }
});
