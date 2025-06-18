const { app } = require('@azure/functions');
const { getProviderContainer } = require('../shared/cosmoProvidersClient');
const { success, error } = require('../shared/responseUtils');

app.http('cosmoGetProviders', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getProviderContainer();

      const continuationToken = req.query.get('continuationToken') || undefined;
      const pageSize = parseInt(req.query.get('pageSize')) || 2;

      const querySpec = {
        query: `
          SELECT *
          FROM c
        `
      };

      // Crear iterador
      const queryIterator = container.items.query(querySpec, { maxItemCount: pageSize });

      // Obtener la página con continuationToken
      const { resources, continuationToken: nextContinuationToken } = await queryIterator.fetchNext();

      return success({
        items: resources,
        continuationToken: nextContinuationToken || null
      });

    } catch (err) {
      context.log('❌ Error al consultar doctores:', err);
      return error('Error al consultar doctores', err);
    }
  }
});
