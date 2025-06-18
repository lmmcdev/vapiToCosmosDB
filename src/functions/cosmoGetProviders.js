const { app } = require('@azure/functions');
const { getProviderContainer } = require('../shared/cosmoProvidersClient');
const { success, error } = require('../shared/responseUtils');

app.http('cosmoGetProviders', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getProviderContainer();

      const continuationToken = req.query.continuationToken || undefined;
      const pageSize = parseInt(req.query.limit) || 10;

      const feedOptions = { maxItemCount: pageSize };
      if (continuationToken) feedOptions.continuationToken = continuationToken;

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
