const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');

const congnitiveURL = process.env.COGNITIVE_AI_URL;
const cognitiveKEY = process.env.COGNITIVE_AI_API_KEY;

app.http('searchTickets', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return badRequest('Invalid JSON', err.message);
    }

    const { query, page = 1, size = 50, location } = body;
    if (!query) return badRequest(`Missing required field: query`);
    if (query === '*') return badRequest(`Avoid using wildcard search (*)`);

    // Sanitizar número si tiene formato como "C: xxx", "H: xxx", etc
    const cleanedQuery = query.replace(/^[CH]:\s*/i, '').replace(/[^\dA-Za-z\s@.-]/g, '');

    const indexName = 'index-tickets';
    const skip = (page - 1) * size;

    // Filtro si hay location
    let filter = null;
    if (location) {
      const safeLocation = location.replace(/'/g, "''");
      filter = `caller_id eq '${safeLocation}'`;
    }

    const searchPayload = {
      search: cleanedQuery,
      top: size,
      skip: skip,
      count: true,
      searchFields: 'caller_id,phone,patient_name'
    };

    if (filter) {
      searchPayload.filter = filter;
    }

    try {
      const response = await fetch(
        `${congnitiveURL}/indexes/${indexName}/docs/search?api-version=2025-05-01-Preview`,
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
