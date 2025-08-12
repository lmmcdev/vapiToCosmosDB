// src/functions/processMonthlyTicketStats/index.js (CommonJS)
const fetch = require('node-fetch'); // NEW: usado para SignalR
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getStatsContainer } = require('../shared/cosmoStatsClient');

// (Opcional) si tu DTO mensual está en el mismo archivo que el diario, puedes exportar un validador.
// Aquí solo seguimos el “formato nuevo”: añadimos statusCounts igual que el diario.
const {
  ALLOWED_STATUSES: DTO_ALLOWED_STATUSES,     // si tu dto exporta esta constante
  MonthlyStatsOutput,                          // si tienes un schema para validar (opcional)
} = (() => {
  try { return require('./dtos/stats.dto'); } catch { return {}; }
})();

// NEW: lista de estados a consolidar (como el endpoint diario)
const ALLOWED_STATUSES = DTO_ALLOWED_STATUSES || [
  'New',
  'In Progress',
  'Done',
  'Emergency',
  'Pending',
  'Duplicated',
];

const signalrMonthlyStats = process.env.SIGNAL_BROADCAST_URL_MONTHLY;

// Helpers
function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function endOfMonth(d = new Date())   { return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0); }
function yyyymm(d = new Date())       { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function yyyy_mm_dd(d = new Date())   { return d.toISOString().slice(0, 10); }

// NEW: misma forma de consolidar que en el endpoint diario (incluye statusCounts)
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
    const created = t?.createdAt ? new Date(t.createdAt) : null;
    if (created && !isNaN(created)) {
      const day = yyyy_mm_dd(created);
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }

    // NEW: conteo de estados mensual
    const st = t?.status;
    if (st && Object.prototype.hasOwnProperty.call(statusCounts, st)) {
      statusCounts[st] += 1;
    }

    // tiempos de resolución
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
        if (!priorityMap[priority]) priorityMap[priority] = { count: 0, ticketIds: [] };
        priorityMap[priority].count += 1;
        priorityMap[priority].ticketIds.push(t.id);
      }
      if (risk) {
        if (!riskMap[risk]) riskMap[risk] = { count: 0, ticketIds: [] };
        riskMap[risk].count += 1;
        riskMap[risk].ticketIds.push(t.id);
      }
      if (category) {
        if (!categoryMap[category]) categoryMap[category] = { count: 0, ticketIds: [] };
        categoryMap[category].count += 1;
        categoryMap[category].ticketIds.push(t.id);
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

  const aiClassificationStats = {
    priority: priorityMap,
    risk: riskMap,
    category: categoryMap,
  };

  return { agentStats, dailyBreakdown, globalStats, statusCounts, aiClassificationStats };
}

app.timer('processMonthlyTicketStats', {
  // Todos los días a las 00:10
  schedule: '0 10 0 * * *',
  handler: async (_timer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer  = getStatsContainer();

      const now = new Date();

      // A) MTD (mes en curso): upsert incremental con mismo ID
      {
        const from = startOfMonth(now);
        const { resources: ticketsMTD } = await ticketContainer.items
          .query({
            query: 'SELECT * FROM c WHERE c.createdAt >= @from',
            parameters: [{ name: '@from', value: from.toISOString() }],
          })
          .fetchAll();

        const { agentStats, dailyBreakdown, globalStats, statusCounts, aiClassificationStats } =
          aggregateMonthly(ticketsMTD);

        const idMTD = `month-${yyyymm(now)}`;                // mismo id cada día
        const docMTD = {
          id: idMTD,
          date: yyyy_mm_dd(now),
          scope: 'month-to-date',                            // NEW: marca de alcance
          agentStats,
          globalStats,
          dailyBreakdown,
          statusCounts,                                      // NEW: en formato nuevo
          aiClassificationStats,
        };

        // (Opcional) valida con DTO si lo tienes
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

      // B) Cierre de mes: el primer día del mes a las 00:10 cerramos el mes anterior
      if (now.getDate() === 1) {
        const prevMonthEnd   = startOfMonth(now);           // 00:00 del mes actual
        const prevMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

        const { resources: ticketsPrev } = await ticketContainer.items
          .query({
            query: 'SELECT * FROM c WHERE c.createdAt >= @from AND c.createdAt < @to',
            parameters: [
              { name: '@from', value: prevMonthStart.toISOString() },
              { name: '@to', value: prevMonthEnd.toISOString() },
            ],
          })
          .fetchAll();

        const { agentStats, dailyBreakdown, globalStats, statusCounts, aiClassificationStats } =
          aggregateMonthly(ticketsPrev);

        const idFinal = `month-${yyyymm(prevMonthStart)}-final`; // NEW: doc inmutable de cierre
        const docFinal = {
          id: idFinal,
          date: yyyy_mm_dd(prevMonthEnd),                   // fecha de cierre (inicio del mes actual)
          scope: 'final',
          agentStats,
          globalStats,
          dailyBreakdown,
          statusCounts,                                     // NEW: en formato nuevo
          aiClassificationStats,
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
