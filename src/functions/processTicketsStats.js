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

// Normalización de estados
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

      // 1) Rango del día en Miami
      const startOfDay = dayjs().tz(MIAMI_TZ).startOf('day');
      const endOfDay   = dayjs().tz(MIAMI_TZ).endOf('day');

      const startIso = startOfDay.toISOString();
      const endIso   = endOfDay.toISOString();

      // 2) Query por rango en creation_date (ISO con offset)
      const { resources: tickets } = await ticketContainer.items
        .query({
          query: `
            SELECT * FROM c
            WHERE c.creation_date >= @start
              AND c.creation_date <= @end
          `,
          parameters: [
            { name: '@start', value: startIso },
            { name: '@end', value: endIso },
          ],
        })
        .fetchAll();

      context.log(`Tickets found for ${dayjs().tz(MIAMI_TZ).format('YYYY-MM-DD')}: ${tickets.length}`);

      // 3) Acumuladores
      let globalTotalTime = 0;
      let resolvedCount = 0;

      const agentStatsMap = {};
      const hourlyMap = {};
      const priorityMap = {};
      const riskMap = {};
      const categoryMap = {};

      const statusCounts = ALLOWED_STATUSES.reduce((acc, s) => ((acc[s] = 0), acc), {});

      const normalizeStatus = (s) => {
        if (!s) return null;
        const key = String(s).trim().toLowerCase();
        return STATUS_ALIASES[key] || null;
      };

      // 4) Procesamiento ticket por ticket
      for (const ticket of tickets) {
        // 🔹 Parse creation_date/createdAt en TZ Miami
        const created = ticket?.createdAt
          ? dayjs(ticket.createdAt).tz(MIAMI_TZ)
          : (ticket?.creation_date ? dayjs(ticket.creation_date).tz(MIAMI_TZ) : null);

        if (created && created.isValid()) {
          const hour = created.hour();
          hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
        }

        // Estado normalizado
        const normStatus = normalizeStatus(ticket?.status);
        if (normStatus && Object.prototype.hasOwnProperty.call(statusCounts, normStatus)) {
          statusCounts[normStatus] += 1;
        }

        // 🔹 Parse closedAt en TZ Miami
        const closed = ticket?.closedAt ? dayjs(ticket.closedAt).tz(MIAMI_TZ) : null;
        if (created && closed && closed.isValid()) {
          const diffMins = closed.diff(created, 'minute');
          if (diffMins >= 0) {
            globalTotalTime += diffMins;
            resolvedCount += 1;

            const agent = (ticket.agent_assigned || 'unassigned').toLowerCase();
            if (!agentStatsMap[agent]) agentStatsMap[agent] = { totalTime: 0, resolved: 0 };
            agentStatsMap[agent].totalTime += diffMins;
            agentStatsMap[agent].resolved += 1;
          }
        }

        // IA: prioridad / riesgo / categoría
        if (ticket?.aiClassification) {
          const { priority, risk, category } = ticket.aiClassification;

          if (priority) {
            const p = String(priority);
            if (!priorityMap[p]) priorityMap[p] = { count: 0, ticketIds: [] };
            priorityMap[p].count += 1;
            if (ticket.id) priorityMap[p].ticketIds.push(ticket.id);
          }
          if (risk) {
            const r = String(risk);
            if (!riskMap[r]) riskMap[r] = { count: 0, ticketIds: [] };
            riskMap[r].count += 1;
            if (ticket.id) riskMap[r].ticketIds.push(ticket.id);
          }
          if (category) {
            const c = String(category);
            if (!categoryMap[c]) categoryMap[c] = { count: 0, ticketIds: [] };
            categoryMap[c].count += 1;
            if (ticket.id) categoryMap[c].ticketIds.push(ticket.id);
          }
        }
      }

      // 5) DTO Final
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

      const dateStr = dayjs().tz(MIAMI_TZ).format('YYYY-MM-DD');
      const statDoc = {
        id: dateStr,
        date: dateStr,
        agentStats,
        globalStats,
        hourlyBreakdown,
        statusCounts: statusCountsWithTotal,
        aiClassificationStats,
      };

      // 6) Validación DTO
      if (DailyStatsOutput) {
        const { error: dtoErr } = DailyStatsOutput.validate(statDoc, { abortEarly: false });
        if (dtoErr) {
          context.log.error('Stats DTO validation failed:', dtoErr.details);
        }
      }

      // 7) Upsert Cosmos
      await statsContainer.items.upsert(statDoc);
      context.log('Stats upserted to Cosmos successfully');

      // 8) Opcional: Broadcast por SignalR
      const signalrDailyStats = process.env.SIGNALR_SEND_GROUPS;
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
