// src/functions/searchPatients/index.js (CommonJS)
const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');

// Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');

// Grupos permitidos: Supervisores (Switchboard) y Quality
const { SUPERVISORS_GROUP: GROUP_SUPERVISORS, AGENTS_GROUP: GROUP_AGENTS } = GROUPS.SWITCHBOARD || {};
const { QUALITY_GROUP: GROUP_QUALITY } = (GROUPS.QUALITY || {});

// Cognitive Search (no dejes defaults con secretos en código)
const cognitiveURL = process.env.COGNITIVE_AI_URL;
const cognitiveKEY = process.env.COGNITIVE_AI_API_KEY;
const indexName = 'cservicespatients-index';

// DTOs
const {
  PatientSearchInput,
  PatientSearchOutput,
  mapSearchResponseToDto,
} = require('./dtos/patientSearch.dto');

app.http('searchPatients', {
  route: 'searchPatients',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      // 🔐 Re-chequeo defensivo dentro del handler
      const claims = context.user || {};
      const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
      const allowedGroups = [GROUP_SUPERVISORS, GROUP_QUALITY, GROUP_AGENTS].filter(Boolean);
      const inAllowedGroup = allowedGroups.some(g => tokenGroups.includes(g));
      if (!inAllowedGroup) {
        context.log('🚫 Group check (handler) failed. groups:', tokenGroups);
        return { status: 403, jsonBody: { error: 'Insufficient group membership' } };
      }

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
  }, {
    // Middleware: sólo si pertenece a Supervisores o Quality
    scopes: ['access_as_user'],
    // (si tu withAuth soporta groupsAny, esto ya corta antes)
    groupsAny: [GROUP_SUPERVISORS, GROUP_QUALITY, GROUP_AGENTS],
    // Si tu withAuth usa "scopes" y NO "scopesAny", pon:
    
    // (o agrega soporte de scopesAny en withAuth)
  })
});