const { app } = require('@azure/functions');
const { getPatientsContainer } = require('../shared/cosmoPatientsClient');
const { success, error, badRequest } = require('../shared/responseUtils');

app.http('cosmoGetPatients', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let body;
    try {
      body = await req.json();
    } catch (err) {
      return badRequest('Invalid JSON', err.message);
    }

    const { limit = 10, continuationToken } = body;

    try {
      const container = getPatientsContainer();

      context.log('➡️ Limit:', limit);
      context.log('➡️ ContinuationToken:', continuationToken);

      const feedOptions = { maxItemCount: parseInt(limit, 10) };

      if (continuationToken) {
        feedOptions.continuationToken = continuationToken;
      }

      // Lectura paginada de patients_id
      const iterator = container.items.readAll(feedOptions);
      const { resources, continuationToken: nextToken } = await iterator.fetchNext();

      return success({
        items: resources,
        continuationToken: nextToken || null,
      });

    } catch (err) {
      context.log('❌ Error al consultar pacientes:', err);
      return error('Error al consultar pacientes', err);
    }
  }
});