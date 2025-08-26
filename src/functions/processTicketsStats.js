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

// Mapa de normalización -> clave canónica
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

// Endpoint HTTP alternativo si lo usas así:
//app.http('processTicketStats', { methods: ['POST'], handler: ... })

//app.http('processTicketStats', {
//  methods: ['GET'],
//  authLevel: 'anonymous',
app.timer('processTicketStats', {
  // Cada hora en el minuto 50
  schedule: '0 50 * * * *',
  handler: async (_timer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer = getStatsContainer();

      // 1) Rango del día en Miami
      const startOfDay = dayjs().tz(MIAMI_TZ).startOf('day').toDate();
      const endOfDay   = dayjs().tz(MIAMI_TZ).endOf('day').toDate();

      // 2) Convertir a ISO (UTC)
      const startIso = startOfDay.toISOString(); // ej: "2025-08-26T04:00:00.000Z"
      const endIso   = endOfDay.toISOString();   // ej: "2025-08-27T03:59:59.999Z"

      // 3) Query con rango
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

      const agentStatsMap = {}; // { [agentEmail]: { totalTime, resolved } }
      const hourlyMap = {};     // { [hour]: count }
      const priorityMap = {};   // { [priority]: {count, ticketIds[]} }
      const riskMap = {};       // { [risk]: {count, ticketIds[]} }
      const categoryMap = {};   // { [category]: {count, ticketIds[]} }

      // Inicializa contador por estado con 0 para que el DTO valide exacto
      const statusCounts = ALLOWED_STATUSES.reduce((acc, s) => ((acc[s] = 0), acc), {});

      // helper normalización
      const normalizeStatus = (s) => {
        if (!s) return null;
        const key = String(s).trim().toLowerCase();
        return STATUS_ALIASES[key] || null;
      };

      // 4) Procesamiento
      for (const ticket of tickets) {
        // Histograma por hora de creación (usa createdAt si existe)
        const created = ticket?.createdAt ? new Date(ticket.createdAt) : null;
        if (created && !isNaN(created)) {
          const hour = created.getHours();
          hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
        }

        // Conteo por estado normalizado
        const normStatus = normalizeStatus(ticket?.status);
        if (normStatus && Object.prototype.hasOwnProperty.call(statusCounts, normStatus)) {
          statusCounts[normStatus] += 1;
        }

        // Tiempos de resolución (si tienes closedAt)
        const closed = ticket?.closedAt ? new Date(ticket.closedAt) : null;
        if (created && closed && !isNaN(closed)) {
          const diffMins = Math.floor((closed - created) / 60000);
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

      // 5) Construye documento final
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

      // Total del día (útil para UI)
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

      // 6) Valida contra el DTO externo (no bloqueante, solo log)
      if (DailyStatsOutput) {
        const { error: dtoErr } = DailyStatsOutput.validate(statDoc, { abortEarly: false });
        if (dtoErr) {
          context.log.error('Stats DTO validation failed:', dtoErr.details);
        }
      }

      // 7) Upsert en Cosmos
      await statsContainer.items.upsert(statDoc);
      context.log('Stats upserted to Cosmos successfully');

      // 8) (Opcional) Broadcast por SignalR
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
              payload: [statDoc], // Azure SignalR espera 'arguments' como array
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
