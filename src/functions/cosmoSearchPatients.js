const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');

const cognitiveURL = process.env.COGNITIVE_AI_URL;
const cognitiveKEY = process.env.COGNITIVE_AI_API_KEY;

app.http('searchPatients', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return badRequest('Invalid JSON', err.message);
    }

    const requiredFields = ['query'];
    const missingFields = requiredFields.filter(field => !body?.[field]);

    if (missingFields.length > 0) {
      return badRequest(`Missing required fields: ${missingFields.join(', ')}`);
    }

    const { query, filter = '', page = 1, size = 50 } = body;

    if (query === '*') {
      return badRequest('Avoid using wildcard search (*)');
    }

    const indexName = 'cservicespatients-index';
    const skip = (page - 1) * size;

    const searchPayload = {
      search: query,
      top: size,
      skip: skip,
      count: true
    };

    if (filter && typeof filter === 'string' && filter.trim().length > 0) {
      searchPayload.filter = filter;
    }

    try {
      const response = await fetch(
        `${cognitiveURL}/indexes/${indexName}/docs/search?api-version=2025-05-01-Preview`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': cognitiveKEY
          },
          body: JSON.stringify(searchPayload)
        }
      );

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return success('Search completed', data, 200);
    } catch (err) {
      context.log(err.message);
      return error('Search error', 500, err.message);
    }
  }
});
