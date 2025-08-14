const { app } = require('@azure/functions');
const { getProviderContainer } = require('../shared/cosmoProvidersClient');
const { success, error, badRequest } = require('../shared/responseUtils');

app.http('cosmoGetProviders', {
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
      const container = getProviderContainer();

      context.log('limit:', limit);
      context.log('continuationToken:', continuationToken);

      const feedOptions = { maxItemCount: parseInt(limit, 10) };

      if (continuationToken) {
        feedOptions.continuationToken = continuationToken;
      }

      // Usamos readAll para paginar, pasando las opciones con continuationToken y maxItemCount
      const iterator = container.items.readAll(feedOptions);
      const { resources, continuationToken: nextToken } = await iterator.fetchNext();

      return success({
        items: resources,
        continuationToken: nextToken || null,
      });
    } catch (err) {
      context.log('❌ Error al consultar doctores:', err);
      return error('Error al consultar doctores', err);
    }
  }
});
