// /src/functions/cosmoGetStoredStats/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getStatsContainer } = require('../shared/cosmoStatsClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

// Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const {
  SUPERVISORS_GROUP: GROUP_SUPERVISORS, // <- SOLO supervisores
} = GROUPS.SWITCHBOARD;

// DTOs
const { DailyStatsOutput, MonthlyStatsOutput } = require('./dtos/stats.dto');

// ------- Helpers -------
const DATE_RX  = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const MONTH_RX = /^\d{4}-\d{2}$/;       // YYYY-MM

async function getByIdViaQuery(container, id, context) {
  const { resources } = await container.items
    .query({
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: id }],
    })
    .fetchAll();
  context.log(`🔎 stats query id=${id} -> ${resources?.length || 0} doc(s)`);
  return resources?.[0] || null;
}

function validateOrThrowClean(doc, schema, label, context) {
  const { error: dtoErr, value } = schema.validate(doc); // prefs ya están en el schema
  if (dtoErr) {
    context.log(`❌ ${label} DTO validation failed:`, dtoErr.details);
    const details = dtoErr.details?.map(d => d.message) || dtoErr.message || 'Schema validation error';
    const msg = Array.isArray(details) ? details.join('; ') : details;
    const err = new Error(`${label} schema validation error: ${msg}`);
    err.code = 'DTO_VALIDATION';
    throw err;
  }
  return value; // limpio (sin _rid/_etag/_ts, etc.)
}

app.http('getTicketStats', {
  route: 'getTicketStats',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // Defensa extra: cortar si el token no trae el grupo de supervisores
      const tokenGroups = Array.isArray(context.user?.groups) ? context.user.groups : [];
      if (!tokenGroups.includes(GROUP_SUPERVISORS)) {
        return { status: 403, jsonBody: { error: 'Insufficient group membership (supervisors only).' } };
      }

      const statsContainer = getStatsContainer();

      // Params
      const date  = (req.query.get('date')  || '').toString();
      const month = (req.query.get('month') || '').toString();
      const scope = (req.query.get('scope') || '').toString().toLowerCase(); // 'final' | 'mtd' | ''

      context.log(`➡️ params: date="${date}" month="${month}" scope="${scope}"`);

      // ---- Diario ----
      if (date) {
        if (!DATE_RX.test(date)) {
          return badRequest('Invalid "date" format. Expected YYYY-MM-DD.');
        }

        const doc = await getByIdViaQuery(statsContainer, date, context);
        if (!doc) return notFound(`No daily stats found for ${date}.`);

        const clean = validateOrThrowClean(doc, DailyStatsOutput, 'Daily', context);
        return success('Daily stats retrieved', clean);
      }

      // ---- Mensual ----
      if (month) {
        if (!MONTH_RX.test(month)) {
          return badRequest('Invalid "month" format. Expected YYYY-MM.');
        }

        // IDs mensuales:
        //   - "month-YYYY-MM"       (month-to-date)
        //   - "month-YYYY-MM-final" (cierre)
        const idFinal = `month-${month}-final`;
        const idMTD   = `month-${month}`;

        if (scope === 'final' || scope === 'mtd') {
          const id  = scope === 'final' ? idFinal : idMTD;
          const doc = await getByIdViaQuery(statsContainer, id, context);
          if (!doc) return notFound(`No monthly (${scope}) stats found for ${month}.`);

          const clean = validateOrThrowClean(doc, MonthlyStatsOutput, `Monthly(${scope})`, context);
          return success(`Monthly (${scope}) stats retrieved`, clean);
        }

        // sin scope -> intenta ambos
        const [docFinal, docMTD] = await Promise.all([
          getByIdViaQuery(statsContainer, idFinal, context),
          getByIdViaQuery(statsContainer, idMTD, context),
        ]);

        if (!docFinal && !docMTD) {
          return notFound(`No monthly stats found for ${month}.`);
        }

        const results = [];
        if (docFinal) {
          results.push({ scope: 'final', doc: validateOrThrowClean(docFinal, MonthlyStatsOutput, 'Monthly(final)', context) });
        }
        if (docMTD) {
          results.push({ scope: 'mtd', doc: validateOrThrowClean(docMTD, MonthlyStatsOutput, 'Monthly(mtd)', context) });
        }

        return success('Monthly stats retrieved', { month, results });
      }

      return badRequest('Provide either "date=YYYY-MM-DD" or "month=YYYY-MM"[&scope=final|mtd].');
    } catch (err) {
      context.log('❌ cosmoGetStoredStats error:', err);
      const status = err?.code === 'DTO_VALIDATION' ? 500 : 500;
      const details = typeof err?.message === 'string' ? err.message : JSON.stringify(err);
      return error('Failed to retrieve stored stats', status, details);
    }
  }, {
    // Solo SUPERVISORES
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_SUPERVISORS],
  })
});
