// src/functions/searchPatients.js
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

    const requiredFields = ['query'];
    const missingFields = requiredFields.filter(field => !body?.[field]);

    if (missingFields.length > 0) {
      return badRequest(`Missing required fields: ${missingFields.join(', ')}`);
    }

    const { query, page = 1, size = 50, location } = body;
    if (query === '*') return badRequest(`Avoid using wildcard search (*)`);

    const indexName = 'index-tickets';
    const skip = (page - 1) * size;

    // Construir el filtro si hay location
    let filter = null;
    if (location) {
      // Escapar comillas simples para evitar errores
      const safeLocation = location.replace(/'/g, "''");
      filter = `caller_id eq '${safeLocation}'`;
    }

    const searchPayload = {
      search: query,
      top: size,
      skip: skip,
      count: true // Para devolver el total
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
