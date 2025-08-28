// src/functions/searchPatients/index.js (CommonJS)
const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');

// Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');

// Cognitive Search
const cognitiveURL = process.env.COGNITIVE_AI_URL;
const cognitiveKEY = process.env.COGNITIVE_AI_API_KEY;
const indexName = 'cservicespatients-index';

// DTOs
const {
  PatientSearchInput,
  PatientSearchOutput,
  mapSearchResponseToDto,
} = require('./dtos/patientSearch.dto');

// 🔹 Extraer dinámicamente todos los ACCESS_GROUP
const ALL_ACCESS_GROUPS = Object.values(GROUPS)
  .map((dept) => dept.ACCESS_GROUP)
  .filter(Boolean);

app.http('searchPatients', {
  route: 'searchPatients',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (request, context) => {
      try {
        // 1) Body + validación de entrada
        let raw;
        try {
          raw = await request.json();
        } catch {
          return badRequest('Invalid JSON payload.');
        }

        const { value: input, error: dtoErr } = PatientSearchInput.validate(raw, {
          abortEarly: false,
          stripUnknown: true,
        });
        if (dtoErr) {
          const details = dtoErr.details?.map(d => d.message).join('; ') || 'Validation error';
          return badRequest(details);
        }

        const { query, filter = '', page, size } = input;

        if (query === '*') {
          return badRequest('Avoid using wildcard (*) as a full query.');
        }

        // 2) Payload de búsqueda
        const skip = (page - 1) * size;
        const payload = {
          search: query,
          top: size,
          skip,
          count: true,
        };
        if (filter && typeof filter === 'string' && filter.trim()) {
          payload.filter = filter.trim();
        }

        // 3) Llamada a Cognitive Search
        if (!cognitiveURL || !cognitiveKEY) {
          return error('Search error', 500, 'Cognitive Search env vars not configured');
        }

        const url = `${cognitiveURL}/indexes/${indexName}/docs/search?api-version=2025-05-01-Preview`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': cognitiveKEY,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`Search failed: ${res.status} ${res.statusText} - ${txt}`);
        }

        const rawData = await res.json();

        // 4) Normalizar al DTO de salida
        const dto = mapSearchResponseToDto(rawData, page, size);

        // 5) Validar salida
        const { error: outErr } = PatientSearchOutput.validate(dto, { abortEarly: false });
        if (outErr) {
          const details = outErr.details?.map(d => d.message).join('; ') || 'Output validation error';
          context.log('❌ PatientSearchOutput validation failed:', details);
          return error('Search output failed validation', 500, details);
        }

        // 6) OK
        return success('Search completed', dto, 200);
      } catch (err) {
        context.log('❌ searchPatients error:', err?.message || err);
        return error('Search error', 500, err?.message || 'Unknown error');
      }
    },
    {
      // 🔐 Middleware: cualquier departamento con ACCESS_GROUP
      scopesAny: ['access_as_user'],
      groupsAny: ALL_ACCESS_GROUPS,
    }
  )
});
