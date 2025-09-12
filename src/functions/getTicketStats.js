// src/functions/cosmoGetStoredStats/index.js
const { app } = require('@azure/functions');
const { getStatsContainer } = require('../shared/cosmoStatsClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

// Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');

// DTOs adaptados
const { DailyStatsOutput, MonthlyStatsOutput } = require('./dtos/stats.dto');

const DATE_RX  = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RX = /^\d{4}-\d{2}$/;

// 🔑 Lista de grupos de supervisores
const SUPERVISOR_GROUPS = Object.values(GROUPS)
  .map(mod => mod.SUPERVISORS_GROUP)
  .filter(Boolean);

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
  const { error: dtoErr, value } = schema.validate(doc);
  if (dtoErr) {
    context.log(`❌ ${label} DTO validation failed:`, dtoErr.details);
    const details = dtoErr.details?.map(d => d.message) || dtoErr.message || 'Schema validation error';
    const msg = Array.isArray(details) ? details.join('; ') : details;
    const err = new Error(`${label} schema validation error: ${msg}`);
    err.code = 'DTO_VALIDATION';
    throw err;
  }
  return value;
}

app.http('getTicketStats', {
  route: 'getTicketStats',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      const statsContainer = getStatsContainer();

      // Params
      const date     = (req.query.get('date')  || '').toString();
      const month    = (req.query.get('month') || '').toString();
      const scope    = (req.query.get('scope') || '').toString().toLowerCase(); 
      const location = (req.query.get('location') || '').toString().toUpperCase();

      context.log(`➡️ params: date="${date}" month="${month}" scope="${scope}" location="${location}"`);

      // ---- Diario ----
      if (date) {
        if (!DATE_RX.test(date)) {
          return badRequest('Invalid "date" format. Expected YYYY-MM-DD.');
        }

        const doc = await getByIdViaQuery(statsContainer, date, context);
        if (!doc) return notFound(`No daily stats found for ${date}.`);

        const clean = validateOrThrowClean(doc, DailyStatsOutput, 'Daily', context);

        if (location) {
          if (!clean.locations || !clean.locations[location]) {
            return notFound(`No stats found for location "${location}" on ${date}.`);
          }
          return success(`Daily stats retrieved for ${location}`, {
            id: clean.id,
            date: clean.date,
            location,
            stats: clean.locations[location],
          });
        }

        return success('Daily stats retrieved', clean);
      }

      // ---- Mensual ----
      if (month) {
        if (!MONTH_RX.test(month)) {
          return badRequest('Invalid "month" format. Expected YYYY-MM.');
        }

        const idFinal = `month-${month}-final`;
        const idMTD   = `month-${month}`;

        if (scope === 'final' || scope === 'mtd') {
          const id  = scope === 'final' ? idFinal : idMTD;
          const doc = await getByIdViaQuery(statsContainer, id, context);
          if (!doc) return notFound(`No monthly (${scope}) stats found for ${month}.`);

          const clean = validateOrThrowClean(doc, MonthlyStatsOutput, `Monthly(${scope})`, context);

          if (location) {
            if (!clean.locations || !clean.locations[location]) {
              return notFound(`No stats found for location "${location}" in ${month} (${scope}).`);
            }
            return success(`Monthly (${scope}) stats retrieved for ${location}`, {
              id: clean.id,
              date: clean.date,
              month,
              scope,
              location,
              stats: clean.locations[location],
            });
          }

          return success(`Monthly (${scope}) stats retrieved`, clean);
        }

        const [docFinal, docMTD] = await Promise.all([
          getByIdViaQuery(statsContainer, idFinal, context),
          getByIdViaQuery(statsContainer, idMTD, context),
        ]);

        if (!docFinal && !docMTD) {
          return notFound(`No monthly stats found for ${month}.`);
        }

        const results = [];
        if (docFinal) {
          const clean = validateOrThrowClean(docFinal, MonthlyStatsOutput, 'Monthly(final)', context);
          results.push({ scope: 'final', doc: clean });
        }
        if (docMTD) {
          const clean = validateOrThrowClean(docMTD, MonthlyStatsOutput, 'Monthly(mtd)', context);
          results.push({ scope: 'mtd', doc: clean });
        }

        if (location) {
          const filtered = results
            .map(r => {
              if (!r.doc.locations || !r.doc.locations[location]) return null;
              return {
                scope: r.scope,
                id: r.doc.id,
                date: r.doc.date,
                month,
                location,
                stats: r.doc.locations[location],
              };
            })
            .filter(Boolean);

          if (!filtered.length) {
            return notFound(`No stats found for location "${location}" in ${month}.`);
          }

          return success(`Monthly stats retrieved for ${location}`, { month, results: filtered });
        }

        return success('Monthly stats retrieved', { month, results });
      }

      return badRequest('Provide either "date=YYYY-MM-DD" or "month=YYYY-MM"[&scope=final|mtd][&location=NAME].');
    } catch (err) {
      context.log('❌ cosmoGetStoredStats error:', err);
      const details = typeof err?.message === 'string' ? err.message : JSON.stringify(err);
      return error('Failed to retrieve stored stats', 500, details);
    }
  }, {
    // 🔐 Supervisores únicamente
    scopesAny: ['access_as_user'],
    groupsAny: SUPERVISOR_GROUPS,
  })
});
