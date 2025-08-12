// src/functions/processTicketStats/index.js (CommonJS)
const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getStatsContainer } = require('../shared/cosmoStatsClient');

// ⬇️ Importa el DTO (y, si existe, la lista de estados permitidos)
const {
  DailyStatsOutput,
  ALLOWED_STATUSES: DTO_ALLOWED_STATUSES
} = require('./dtos/stats.dto');

// Si el DTO no exporta ALLOWED_STATUSES, usa estos por defecto:
const ALLOWED_STATUSES = DTO_ALLOWED_STATUSES || [
  'New',
  'In Progress',
  'Done',
  'Emergency',
  'Pending',
  'Duplicated',
];

const signalrDailyStats = process.env.SIGNAL_BROADCAST_URL5;

app.timer('processTicketStats', {
  // Cada hora en el minuto 50
  schedule: '0 50 * * * *',
  handler: async (_timer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer = getStatsContainer();

      // 1) Ventana del día (00:00 local)
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const isoToday = start.toISOString();

      // 2) Tickets creados hoy
      const { resources: tickets } = await ticketContainer.items
        .query({
          query: 'SELECT * FROM c WHERE c.createdAt >= @start',
          parameters: [{ name: '@start', value: isoToday }],
        })
        .fetchAll();

      context.log(`Tickets found: ${tickets.length}`);

      // 3) Acumuladores
      let globalTotalTime = 0;
      let resolvedCount = 0;

      const agentStatsMap = {}; // { [agentEmail]: { totalTime, resolved } }
      const hourlyMap = {};     // { [hour]: count }
      const priorityMap = {};   // { [priority]: {count, ticketIds[]} }
      const riskMap = {};       // { [risk]: {count, ticketIds[]} }
      const categoryMap = {};   // { [category]: {count, ticketIds[]} }

      // Inicializa contador por status con 0 para que el DTO valide exacto
      const statusCounts = ALLOWED_STATUSES.reduce((acc, s) => ((acc[s] = 0), acc), {});

      // 4) Procesamiento
      for (const ticket of tickets) {
        // Histograma por hora de creación
        const created = ticket?.createdAt ? new Date(ticket.createdAt) : null;
        if (created && !isNaN(created)) {
          const hour = created.getHours();
          hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
        }

        // Conteo por estado (solo los permitidos)
        const status = ticket?.status;
        if (status && Object.prototype.hasOwnProperty.call(statusCounts, status)) {
          statusCounts[status] += 1;
        }

        // Tiempos de resolución
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
            if (!priorityMap[priority]) priorityMap[priority] = { count: 0, ticketIds: [] };
            priorityMap[priority].count += 1;
            priorityMap[priority].ticketIds.push(ticket.id);
          }
          if (risk) {
            if (!riskMap[risk]) riskMap[risk] = { count: 0, ticketIds: [] };
            riskMap[risk].count += 1;
            riskMap[risk].ticketIds.push(ticket.id);
          }
          if (category) {
            if (!categoryMap[category]) categoryMap[category] = { count: 0, ticketIds: [] };
            categoryMap[category].count += 1;
            categoryMap[category].ticketIds.push(ticket.id);
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

      const dateStr = new Date().toISOString().slice(0, 10);
      const statDoc = {
        id: dateStr,
        date: dateStr,
        agentStats,
        globalStats,
        hourlyBreakdown,
        statusCounts,
        aiClassificationStats,
      };

      // 6) Valida contra el DTO externo (no bloqueante, solo loggea)
      if (DailyStatsOutput) {
        const { error: dtoErr } = DailyStatsOutput.validate(statDoc, { abortEarly: false });
        if (dtoErr) {
          context.log.error('Stats DTO validation failed:', dtoErr.details);
        }
      }

      // 7) Upsert en Cosmos
      await statsContainer.items.upsert(statDoc);
      context.log('Stats upserted to Cosmos successfully');

      // 8) Broadcast por SignalR (best-effort)
      if (signalrDailyStats) {
        try {
          context.log(`Sending SignalR to ${signalrDailyStats}`);
          const resp = await fetch(signalrDailyStats, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(statDoc),
          });
          context.log(`SignalR response: ${resp.status}`);
        } catch (e) {
          context.log(`SignalR failed: ${e.message}`);
        }
      }
    } catch (err) {
      context.log.error('Error processing stats:', err?.message || err);
    }
  },
});
