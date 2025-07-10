const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getStatsContainer } = require('../shared/cosmoStatsClient');
const { success, error } = require('../shared/responseUtils');

const signalrDailyStats = process.env.SIGNAL_BROADCAST_URL5

app.timer('processTicketStats', {
  schedule: '0 50 * * * *', // Cada hora en el minuto 0
  handler: async (myTimer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer = getStatsContainer();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isoToday = today.toISOString();

      const query = `SELECT * FROM c WHERE c.createdAt >= '${isoToday}'`;
      const { resources: tickets } = await ticketContainer.items.query(query).fetchAll();

      if (tickets.length === 0) {
        context.log('No tickets to process today');
        return;
      }

      let globalTotalTime = 0;
      let resolvedCount = 0;
      const agentStatsMap = {};
      const hourlyMap = {};

      // Nuevos contadores para AI Classification
      const priorityMap = {};
      const riskMap = {};
      const categoryMap = {};

      for (const ticket of tickets) {
        const created = new Date(ticket.createdAt);
        const closed = ticket.closedAt ? new Date(ticket.closedAt) : null;

        const hour = created.getHours();
        hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;

        if (closed) {
          const diffMins = Math.floor((closed - created) / 60000);
          globalTotalTime += diffMins;
          resolvedCount++;

          const agent = ticket.agent_assigned || 'unassigned';
          if (!agentStatsMap[agent]) agentStatsMap[agent] = { totalTime: 0, resolved: 0 };

          agentStatsMap[agent].totalTime += diffMins;
          agentStatsMap[agent].resolved++;
        }

        // Analiza clasificación AI si existe
        if (ticket.aiClassification) {
          const { priority, risk, category } = ticket.aiClassification;

          if (priority) priorityMap[priority] = (priorityMap[priority] || 0) + 1;
          if (risk) riskMap[risk] = (riskMap[risk] || 0) + 1;
          if (category) categoryMap[category] = (categoryMap[category] || 0) + 1;
        }
      }

      const agentStats = Object.entries(agentStatsMap).map(([agentEmail, stats]) => ({
        agentEmail,
        avgResolutionTimeMins: Math.round(stats.totalTime / stats.resolved),
        resolvedCount: stats.resolved
      }));

      const hourlyBreakdown = Object.entries(hourlyMap).map(([hour, count]) => ({
        hour: parseInt(hour),
        count
      })).sort((a, b) => a.hour - b.hour);

      const globalStats = {
        avgResolutionTimeMins: resolvedCount ? Math.round(globalTotalTime / resolvedCount) : 0,
        resolvedCount
      };

      const aiClassificationStats = {
        priority: priorityMap,
        risk: riskMap,
        category: categoryMap
      };

      const statDoc = {
        id: new Date().toISOString().split('T')[0],
        date: new Date().toISOString().split('T')[0],
        agentStats,
        globalStats,
        hourlyBreakdown,
        aiClassificationStats // 🔥 Nuevo bloque agregado
      };

      await statsContainer.items.upsert(statDoc);
      context.log('✅ Stats processed successfully with AI Classification');

      // SignalR notificaciones
      try {
        context.log(`Transmiting signalr to ${signalrDailyStats}`)
        const result = await fetch(signalrDailyStats, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(statDoc)
        });
        context.log('Data daily stats transmited to signalR', JSON.stringify(result))
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }


    } catch (err) {
      context.log.error('❌ Error processing stats:', err.message);
    }
  }
});
