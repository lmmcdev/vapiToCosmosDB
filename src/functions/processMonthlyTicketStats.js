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

// Helpers de fechas
function yyyymm(d) { return `${d.year()}-${String(d.month() + 1).padStart(2, '0')}`; }
function yyyy_mm_dd(d) { return d.format('YYYY-MM-DD'); }
function startOfMonthMiami(d) { return d.startOf('month'); }
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

function aggregateMonthly(tickets) {
  let globalTotalTime = 0;
  let resolvedCount = 0;

  const agentStatsMap = {};       // { [agentEmail]: { totalTime, resolved } }
  const dailyMap = {};            // { [YYYY-MM-DD]: count }
  const priorityMap = {};         // { [priority]: { count, ticketIds[] } }
  const riskMap = {};             // { [risk]: { count, ticketIds[] } }
  const categoryMap = {};         // { [category]: { count, ticketIds[] } }
  const statusCounts = ALLOWED_STATUSES.reduce((acc, s) => ((acc[s] = 0), acc), {});

  for (const t of tickets) {
    // conteo por día (si tienes createdAt en ISO Miami/UTC da igual para el histograma simple)
    const created = t?.createdAt ? new Date(t.createdAt) : null;
    if (created && !isNaN(created)) {
      const day = created.toISOString().slice(0, 10); // YYYY-MM-DD (vale para histograma)
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }

    // estados normalizados
    const st = normalizeStatus(t?.status);
    if (st && Object.prototype.hasOwnProperty.call(statusCounts, st)) {
      statusCounts[st] += 1;
    }

    // tiempos de resolución (si existe closedAt)
    const closed = t?.closedAt ? new Date(t.closedAt) : null;
    if (created && closed && !isNaN(closed)) {
      const diffMins = Math.floor((closed - created) / 60000);
      if (diffMins >= 0) {
        globalTotalTime += diffMins;
        resolvedCount += 1;

        const agent = (t.agent_assigned || 'unassigned').toLowerCase();
        if (!agentStatsMap[agent]) agentStatsMap[agent] = { totalTime: 0, resolved: 0 };
        agentStatsMap[agent].totalTime += diffMins;
        agentStatsMap[agent].resolved  += 1;
      }
    }

    // IA
    if (t?.aiClassification) {
      const { priority, risk, category } = t.aiClassification;

      if (priority) {
        const p = String(priority);
        if (!priorityMap[p]) priorityMap[p] = { count: 0, ticketIds: [] };
        priorityMap[p].count += 1;
        if (t.id) priorityMap[p].ticketIds.push(t.id);
      }
      if (risk) {
        const r = String(risk);
        if (!riskMap[r]) riskMap[r] = { count: 0, ticketIds: [] };
        riskMap[r].count += 1;
        if (t.id) riskMap[r].ticketIds.push(t.id);
      }
      if (category) {
        const c = String(category);
        if (!categoryMap[c]) categoryMap[c] = { count: 0, ticketIds: [] };
        categoryMap[c].count += 1;
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

      // ---------- A) MTD (mes en curso): upsert incremental con mismo ID ----------
      {
        const mm = nowMiami.format('MM');      // "08"
        const yyyy = nowMiami.format('YYYY');  // "2025"

        // Filtra por mes y año en creation_date (seguro para TZ/DST):
        // STARTSWITH -> "MM/", CONTAINS -> "/YYYY"
        const { resources: ticketsMTD } = await ticketContainer.items
          .query({
            query: `
              SELECT * FROM c
              WHERE STARTSWITH(c.creation_date, @mmSlash)
                AND CONTAINS(c.creation_date, @slashYYYY)
            `,
            parameters: [
              { name: '@mmSlash', value: `${mm}/` },
              { name: '@slashYYYY', value: `/${yyyy}` },
            ],
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

      // ---------- B) Cierre de mes: el 1º del mes a las 00:10, cerramos el mes anterior ----------
      if (nowMiami.date() === 1) {
        const { startPrev } = prevMonthStartEndMiami(nowMiami); // inicio del mes anterior en Miami

        const mmPrev = startPrev.format('MM');
        const yyyyPrev = startPrev.format('YYYY');

        const { resources: ticketsPrev } = await ticketContainer.items
          .query({
            query: `
              SELECT * FROM c
              WHERE STARTSWITH(c.creation_date, @mmSlash)
                AND CONTAINS(c.creation_date, @slashYYYY)
            `,
            parameters: [
              { name: '@mmSlash', value: `${mmPrev}/` },
              { name: '@slashYYYY', value: `/${yyyyPrev}` },
            ],
          })
          .fetchAll();

        const aggFinal = aggregateMonthly(ticketsPrev);

        const idFinal = `month-${yyyymm(startPrev)}-final`; // "month-2025-07-final"
        const docFinal = {
          id: idFinal,
          date: yyyy_mm_dd(nowMiami), // fecha de cierre (inicio mes actual en Miami)
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
