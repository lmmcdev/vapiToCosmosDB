// src/functions/searchProviders/index.js (CommonJS)
const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');

// 🔒 Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');

// === Grupos permitidos: SOLO Supervisores (Switchboard) y Quality ===
const GROUP_SUPERVISORS = GROUPS?.SWITCHBOARD?.SUPERVISORS_GROUP;
const GROUP_QUALITY               = GROUPS?.QUALITY?.QUALITY_GROUP;
const GROUP_AGENTS      = GROUPS?.SWITCHBOARD?.AGENTS_GROUP;
//const GROUP_REFERRALS_AGENTS      = GROUPS?.REFERRALS.AGENTS_GROUP;
//const GROUP_REFERRALS_REMOTEAGENTS= GROUPS?.REFERRALS.REMOTEAGENTS_GROUP;      

// Falla ruidosamente si falta algún ID de grupo
/*if (!GROUP_REFERRALS_SUPERVISORS || !GROUP_QUALITY || GROUP_REFERRALS_AGENTS || GROUP_REFERRALS_REMOTEAGENTS) {
  throw new Error(
    `[searchProviders] Missing group IDs. Check groups.config:
     REFERRALS.SUPERVISORS_GROUP=${GROUP_REFERRALS_SUPERVISORS}
     QUALITY.QUALITY_GROUP=${GROUP_QUALITY}`

  );
}*/

// Cognitive Search
const cognitiveURL = process.env.COGNITIVE_AI_URL || 'https://cognitivesearchcservices.search.windows.net';
const cognitiveKEY = process.env.COGNITIVE_AI_API_KEY || '20KhVAS6J30pV0LaVwNBvW4MeIBGMeMtYlphWhQcBHAzSeAWFY6q';
const indexName = 'cservicesproviders-index';

// DTOs
const {
  ProviderSearchInput,
  ProviderSearchOutput,
  mapProvidersResponseToDto,
} = require('./dtos/providerSearch.dto');

app.http('searchProviders', {
  route: 'searchProviders',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      // (Defensa extra) revalida grupos dentro del handler por si alguien
      // despliega con withAuth mal configurado.
      const claims = context.user || {};
      const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
      const allowed = tokenGroups.includes(GROUP_SUPERVISORS) || tokenGroups.includes(GROUP_QUALITY) || tokenGroups.includes(GROUP_AGENTS);
      if (!allowed) {
        return { status: 403, jsonBody: { error: 'Insufficient group membership' } };
      }

      // 1) Parse + valida entrada
      let raw;
      try {
        raw = await request.json();
      } catch {
        return badRequest('Invalid JSON payload.');
      }

      const { value: input, error: dtoErr } = ProviderSearchInput.validate(raw, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (dtoErr) {
        const details = dtoErr.details?.map(d => d.message).join('; ') || 'Validation error';
        return badRequest(details);
      }

      const { query, filter = '', page, size } = input;
      if (query === '*') return badRequest('Avoid using wildcard (*) as a full query.');

      // 2) Payload de búsqueda
      const skip = (page - 1) * size;
      const payload = { search: query, top: size, skip, count: true };
      if (filter && typeof filter === 'string' && filter.trim()) {
        payload.filter = filter.trim();
      }

      // 3) Llamada a Cognitive Search
      const url = `${cognitiveURL}/indexes/${indexName}/docs/search?api-version=2025-05-01-Preview`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': cognitiveKEY },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Search failed: ${res.status} ${res.statusText} - ${txt}`);
      }

      const rawData = await res.json();

      // 4) Normaliza y valida salida
      const dto = mapProvidersResponseToDto(rawData, page, size);
      const { error: outErr } = ProviderSearchOutput.validate(dto, { abortEarly: false });
      if (outErr) {
        const details = outErr.details?.map(d => d.message).join('; ') || 'Output validation error';
        context.log('❌ ProviderSearchOutput validation failed:', details);
        return error('Search output failed validation', 500, details);
      }

      return success('Search completed', dto, 200);
    } catch (err) {
      context.log('❌ searchProviders error:', err?.message || err);
      return error('Search error', 500, err?.message || 'Unknown error');
    }
  }, {
    // 🔐 Bloqueo principal en withAuth
    // 👉 NO pongas ACCESS_GROUP aquí: solo Supervisores y Quality
    groupsAny: [GROUP_SUPERVISORS, GROUP_QUALITY, GROUP_AGENTS],
    //groupsAny: [ACCESS_GROUP, GROUP_QUALITY],
    // (Opcional) Scopes si los usas; si tu withAuth admite scopesAny, puedes añadirlo.
    //scopesAny: ['access_as_user'],
  })
});