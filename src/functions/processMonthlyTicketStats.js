// src/functions/processMonthlyTicketStats/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(tz);

const { getContainer } = require('../shared/cosmoClient');
const { getStatsContainer } = require('../shared/cosmoStatsClient');

const {
  ALLOWED_STATUSES: DTO_ALLOWED_STATUSES,
  MonthlyStatsOutput,
} = (() => {
  try { return require('./dtos/stats.dto'); } catch { return {}; }
})();

const ALLOWED_STATUSES = DTO_ALLOWED_STATUSES || [
  'New',
  'In Progress',
  'Done',
  'Emergency',
  'Pending',
  'Duplicated',
];

const STATUS_ALIASES = {
  'new': 'New',
  'in progress': 'In Progress',
  'in_progress': 'In Progress',
  'in-progress': 'In Progress',
  'pending': 'Pending',
  'done': 'Done',
  'emergency': 'Emergency',
  'duplicated': 'Duplicated',
};

const MIAMI_TZ = 'America/New_York';
const signalrMonthlyStats = process.env.SIGNAL_BROADCAST_URL_MONTHLY;

// Helpers
function yyyymm(d) { return `${d.year()}-${String(d.month() + 1).padStart(2, '0')}`; }
function yyyy_mm_dd(d) { return d.format('YYYY-MM-DD'); }
function prevMonthStartEndMiami(nowMiami) {
  const startPrev = nowMiami.subtract(1, 'month').startOf('month');
  const endPrev   = nowMiami.startOf('month'); // inicio del mes actual
  return { startPrev, endPrev };
}

function normalizeStatus(s) {
  if (!s) return null;
  const key = String(s).trim().toLowerCase();
  return STATUS_ALIASES[key] || null;
}

// Extrae fecha "de pared" YYYY-MM-DD desde un ISO con offset, sin convertir TZ
function extractClockDate(isoLike) {
  if (!isoLike || typeof isoLike !== 'string') return null;
  const m = isoLike.match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : null;
}

function aggregateMonthly(tickets) {
  let globalTotalTime = 0;
  let resolvedCount = 0;

  const agentStatsMap = {};
  const dailyMap = {};
  const priorityMap = {};
  const riskMap = {};
  const categoryMap = {};
  const statusCounts = ALLOWED_STATUSES.reduce((acc, s) => ((acc[s] = 0), acc), {});

  for (const t of tickets) {
    // Histograma diario (usar fecha del string sin convertir TZ)
    const openStr = (typeof t?.createdAt === 'string' && t.createdAt) ||
                    (typeof t?.creation_date === 'string' && t.creation_date) ||
                    null;
    const day = openStr ? extractClockDate(openStr) : null;
    if (day) {
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }

    // Estados
    const st = normalizeStatus(t?.status);
    if (st && Object.prototype.hasOwnProperty.call(statusCounts, st)) {
      statusCounts[st] += 1;
    }

    // Resolución (diferencia real con Date en UTC)
    const closedStr = (typeof t?.closedAt === 'string' && t.closedAt) || null;
    if (openStr && closedStr) {
      const opened = new Date(openStr);
      const closed = new Date(closedStr);
      if (!isNaN(opened) && !isNaN(closed)) {
        const diffMins = Math.floor((closed - opened) / 60000);
        if (diffMins >= 0) {
          globalTotalTime += diffMins;
          resolvedCount += 1;

          const agent = (t.agent_assigned || 'unassigned').toLowerCase();
          if (!agentStatsMap[agent]) agentStatsMap[agent] = { totalTime: 0, resolved: 0 };
          agentStatsMap[agent].totalTime += diffMins;
          agentStatsMap[agent].resolved  += 1;
        }
      }
    }

    // IA
    if (t?.aiClassification) {
      const { priority, risk, category } = t.aiClassification;

      if (priority) {
        const p = String(priority);
        (priorityMap[p] ||= { count: 0, ticketIds: [] }).count++;
        if (t.id) priorityMap[p].ticketIds.push(t.id);
      }
      if (risk) {
        const r = String(risk);
        (riskMap[r] ||= { count: 0, ticketIds: [] }).count++;
        if (t.id) riskMap[r].ticketIds.push(t.id);
      }
      if (category) {
        const c = String(category);
        (categoryMap[c] ||= { count: 0, ticketIds: [] }).count++;
        if (t.id) categoryMap[c].ticketIds.push(t.id);
      }
    }
  }

  const agentStats = Object.entries(agentStatsMap).map(([agentEmail, stats]) => ({
    agentEmail,
    avgResolutionTimeMins: stats.resolved ? Math.round(stats.totalTime / stats.resolved) : 0,
    resolvedCount: stats.resolved,
  }));

  const dailyBreakdown = Object.entries(dailyMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const globalStats = {
    avgResolutionTimeMins: resolvedCount ? Math.round(globalTotalTime / resolvedCount) : 0,
    resolvedCount,
  };

  const total = Object.values(statusCounts).reduce((s, n) => s + (n || 0), 0);
  const statusCountsWithTotal = { ...statusCounts, Total: total };

  const aiClassificationStats = {
    priority: priorityMap,
    risk: riskMap,
    category: categoryMap,
  };

  return { agentStats, dailyBreakdown, globalStats, statusCounts: statusCountsWithTotal, aiClassificationStats };
}

app.timer('processMonthlyTicketStats', {
  // Todos los días a las 00:10 Miami
  schedule: '0 10 0 * * *',
  handler: async (_timer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer  = getStatsContainer();

      const nowMiami = dayjs().tz(MIAMI_TZ);

      // ---------- A) MTD (prefijo 'YYYY-MM' en strings) ----------
      {
        const ymPrefix = nowMiami.format('YYYY-MM'); // ej. "2025-08"
        const { resources: ticketsMTD } = await ticketContainer.items
          .query({
            query: `
              SELECT * FROM c
              WHERE
                (IS_STRING(c.creation_date) AND STARTSWITH(c.creation_date, @ym))
                OR
                (IS_STRING(c.createdAt) AND STARTSWITH(c.createdAt, @ym))
            `,
            parameters: [{ name: '@ym', value: ymPrefix }],
          })
          .fetchAll();

        const agg = aggregateMonthly(ticketsMTD);

        const idMTD = `month-${yyyymm(nowMiami)}`; // p.ej. "month-2025-08"
        const docMTD = {
          id: idMTD,
          date: yyyy_mm_dd(nowMiami),
          scope: 'month-to-date',
          ...agg,
        };

        if (MonthlyStatsOutput) {
          const { error: dtoErr } = MonthlyStatsOutput.validate(docMTD, { abortEarly: false });
          if (dtoErr) context.log.error('MTD DTO validation:', dtoErr.details);
        }

        await statsContainer.items.upsert(docMTD);
        context.log(`Monthly MTD upserted: ${idMTD}`);

        if (signalrMonthlyStats) {
          try {
            const r = await fetch(signalrMonthlyStats, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(docMTD),
            });
            context.log(`SignalR MTD -> ${r.status}`);
          } catch (e) {
            context.log(`SignalR MTD failed: ${e.message}`);
          }
        }
      }

      // ---------- B) Mes anterior (día 1) ----------
      if (nowMiami.date() === 1) {
        const { startPrev } = prevMonthStartEndMiami(nowMiami);
        const ymPrev = startPrev.format('YYYY-MM');

        const { resources: ticketsPrev } = await ticketContainer.items
          .query({
            query: `
              SELECT * FROM c
              WHERE
                (IS_STRING(c.creation_date) AND STARTSWITH(c.creation_date, @ym))
                OR
                (IS_STRING(c.createdAt) AND STARTSWITH(c.createdAt, @ym))
            `,
            parameters: [{ name: '@ym', value: ymPrev }],
          })
          .fetchAll();

        const aggFinal = aggregateMonthly(ticketsPrev);

        const idFinal = `month-${yyyymm(startPrev)}-final`; // "month-2025-07-final"
        const docFinal = {
          id: idFinal,
          date: yyyy_mm_dd(nowMiami), // fecha de cierre
          scope: 'final',
          ...aggFinal,
        };

        if (MonthlyStatsOutput) {
          const { error: dtoErr } = MonthlyStatsOutput.validate(docFinal, { abortEarly: false });
          if (dtoErr) context.log.error('FINAL DTO validation:', dtoErr.details);
        }

        await statsContainer.items.upsert(docFinal);
        context.log(`Monthly FINAL upserted: ${idFinal}`);

        if (signalrMonthlyStats) {
          try {
            const r = await fetch(signalrMonthlyStats, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(docFinal),
            });
            context.log(`SignalR FINAL -> ${r.status}`);
          } catch (e) {
            context.log(`SignalR FINAL failed: ${e.message}`);
          }
        }
      }
    } catch (err) {
      context.log.error('Error processing monthly stats:', err?.message || err);
    }
  },
});
