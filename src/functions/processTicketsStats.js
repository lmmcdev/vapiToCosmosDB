// src/functions/processTicketStats/index.js (CommonJS)
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
  DailyStatsOutput,
  ALLOWED_STATUSES: DTO_ALLOWED_STATUSES
} = require('./dtos/stats.dto');

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

app.timer('processTicketStats', {
  // Cada hora en el minuto 50
  schedule: '0 50 * * * *',
  handler: async (_timer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer = getStatsContainer();

      // 👇 Día objetivo (etiqueta) en Miami
      const todayYmdMiami = dayjs().tz(MIAMI_TZ).format('YYYY-MM-DD');

      // 👇 IMPORTANTE:
      // En vez de comparar rangos ISO (que se rompen con offsets),
      // traemos los documentos cuyo string empieza por "YYYY-MM-DD"
      // tanto en creation_date como en createdAt.
      const { resources: tickets } = await ticketContainer.items
        .query({
          query: `
            SELECT * FROM c
            WHERE
              (
                IS_STRING(c.creation_date) AND STARTSWITH(c.creation_date, @ymd)
              )
              OR
              (
                IS_STRING(c.createdAt) AND STARTSWITH(c.createdAt, @ymd)
              )
          `,
          parameters: [
            { name: '@ymd', value: todayYmdMiami },
          ],
        })
        .fetchAll();

      context.log(`Tickets (string-day=${todayYmdMiami}) encontrados: ${tickets.length}`);

      // Acumuladores
      let globalTotalTime = 0;
      let resolvedCount = 0;

      const agentStatsMap = {}; // { [agentEmail]: { totalTime, resolved } }
      const hourlyMap = {};     // { [hour]: count }
      const priorityMap = {};   // { [priority]: {count, ticketIds[]} }
      const riskMap = {};       // { [risk]: {count, ticketIds[]} }
      const categoryMap = {};   // { [category]: {count, ticketIds[]} }

      const statusCounts = ALLOWED_STATUSES.reduce((acc, s) => ((acc[s] = 0), acc), {});

      const normalizeStatus = (s) => {
        if (!s) return null;
        const key = String(s).trim().toLowerCase();
        return STATUS_ALIASES[key] || null;
      };

      for (const t of tickets) {
        // ⚠️ "Wall clock" en Miami (NO mover el reloj, sólo re-anclar):
        // tz(_, MIAMI_TZ, true) mantiene la hora del string tal cual.
        const src = t?.createdAt || t?.creation_date;
        const createdMiamiWall = src ? dayjs(src).tz(MIAMI_TZ, true) : null;

        if (createdMiamiWall?.isValid()) {
          // Hora local “visible” (7am queda 7)
          const hour = createdMiamiWall.hour();
          hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
        }

        // Estado
        const normStatus = normalizeStatus(t?.status);
        if (normStatus && Object.prototype.hasOwnProperty.call(statusCounts, normStatus)) {
          statusCounts[normStatus] += 1;
        }

        // Tiempos de resolución (si tienes closedAt)
        const closedSrc = t?.closedAt || null;
        const closedMiamiWall = closedSrc ? dayjs(closedSrc).tz(MIAMI_TZ, true) : null;
        if (createdMiamiWall?.isValid() && closedMiamiWall?.isValid()) {
          const diffMins = closedMiamiWall.diff(createdMiamiWall, 'minute');
          if (diffMins >= 0) {
            globalTotalTime += diffMins;
            resolvedCount += 1;

            const agent = (t.agent_assigned || 'unassigned').toLowerCase();
            if (!agentStatsMap[agent]) agentStatsMap[agent] = { totalTime: 0, resolved: 0 };
            agentStatsMap[agent].totalTime += diffMins;
            agentStatsMap[agent].resolved += 1;
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

      const hourlyBreakdown = Object.entries(hourlyMap)
        .map(([hour, count]) => ({ hour: parseInt(hour, 10), count }))
        .sort((a, b) => a.hour - b.hour);

      const globalStats = {
        avgResolutionTimeMins: resolvedCount ? Math.round(globalTotalTime / resolvedCount) : 0,
        resolvedCount,
      };

      const aiClassificationStats = {
        priority: priorityMap,
        risk: riskMap,
        category: categoryMap,
      };

      const totalForDay = Object.values(statusCounts).reduce((sum, n) => sum + (n || 0), 0);
      const statusCountsWithTotal = { ...statusCounts, Total: totalForDay };

      const dateStr = todayYmdMiami; // etiqueta del doc
      const statDoc = {
        id: dateStr,
        date: dateStr,
        agentStats,
        globalStats,
        hourlyBreakdown,
        statusCounts: statusCountsWithTotal,
        aiClassificationStats,
      };

      if (DailyStatsOutput) {
        const { error: dtoErr } = DailyStatsOutput.validate(statDoc, { abortEarly: false });
        if (dtoErr) {
          context.log.error('Stats DTO validation failed:', dtoErr.details);
        }
      }

      await statsContainer.items.upsert(statDoc);
      context.log('Stats upserted to Cosmos successfully');

      const signalrDailyStats = process.env.SIGNALR_SEND_TO_GROUPS;
      if (signalrDailyStats) {
        try {
          const resp = await fetch(signalrDailyStats, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hub: 'ticketshubchannels',
              groupName: 'department:Referrals',
              target: 'dailyStats',
              payload: [statDoc],
            })
          });
          const text = await resp.text();
          context.log(`SignalR status=${resp.status} body=${text}`);
        } catch (e) {
          context.log(`SignalR failed: ${e.message}`);
        }
      }
    } catch (err) {
      context.log.error('Error processing stats:', err?.message || err);
    }
  },
});
