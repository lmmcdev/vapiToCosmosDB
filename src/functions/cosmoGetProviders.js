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

      const querySpec = {
        query: `
          SELECT *
          FROM c
        `
      };

      const queryIterator = container.items.query(querySpec, { maxItemCount: pageSize });

      // 👉 La clave: fetchNext acepta options para pasar el continuationToken
      const { resources, continuationToken: nextContinuationToken } = await queryIterator.fetchNext({
        continuationToken: continuationToken
      });

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
