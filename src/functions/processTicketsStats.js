const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getStatsContainer } = require('../shared/cosmoStatsClient');
const { success, error } = require('../shared/responseUtils');

const signalrDailyStats = process.env.SIGNAL_BROADCAST_URL5;

app.timer('processTicketStats', {
  schedule: '0 50 * * * *', // Cada hora en el minuto 50
  handler: async (myTimer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer = getStatsContainer();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isoToday = today.toISOString();

      const query = `SELECT * FROM c WHERE c.createdAt >= '${isoToday}'`;
      const { resources: tickets } = await ticketContainer.items.query(query).fetchAll();

      context.log(`Tickets found: ${tickets.length}`);

      let globalTotalTime = 0;
      let resolvedCount = 0;
      const agentStatsMap = {};
      const hourlyMap = {};
      const priorityMap = {};
      const riskMap = {};
      const categoryMap = {};

      if (tickets.length > 0) {
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

          if (ticket.aiClassification) {
            const { priority, risk, category } = ticket.aiClassification;

            if (priority) {
              if (!priorityMap[priority]) priorityMap[priority] = { count: 0, ticketIds: [] };
              priorityMap[priority].count++;
              priorityMap[priority].ticketIds.push(ticket.id);
            }

            if (risk) {
              if (!riskMap[risk]) riskMap[risk] = { count: 0, ticketIds: [] };
              riskMap[risk].count++;
              riskMap[risk].ticketIds.push(ticket.id);
            }

            if (category) {
              if (!categoryMap[category]) categoryMap[category] = { count: 0, ticketIds: [] };
              categoryMap[category].count++;
              categoryMap[category].ticketIds.push(ticket.id);
            }
          }
        }
      } else {
        context.log('No tickets to process today');
      }

      const agentStats = Object.entries(agentStatsMap).map(([agentEmail, stats]) => ({
        agentEmail,
        avgResolutionTimeMins: Math.round(stats.totalTime / stats.resolved),
        resolvedCount: stats.resolved,
      }));

      const hourlyBreakdown = Object.entries(hourlyMap).map(([hour, count]) => ({
        hour: parseInt(hour),
        count,
      })).sort((a, b) => a.hour - b.hour);

      const globalStats = {
        avgResolutionTimeMins: resolvedCount ? Math.round(globalTotalTime / resolvedCount) : 0,
        resolvedCount,
      };

      const aiClassificationStats = {
        priority: priorityMap,
        risk: riskMap,
        category: categoryMap,
      };

      const statDoc = {
        id: new Date().toISOString().split('T')[0],
        date: new Date().toISOString().split('T')[0],
        agentStats,
        globalStats,
        hourlyBreakdown,
        aiClassificationStats,
      };

      await statsContainer.items.upsert(statDoc);
      context.log('Stats upserted to Cosmos successfully');

      // 👉 Notifica siempre, aunque no haya tickets
      try {
        context.log(`Sending SignalR to ${signalrDailyStats}`);
        const result = await fetch(signalrDailyStats, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(statDoc),
        });
        context.log(`SignalR notify OK: ${result.status}`);
      } catch (e) {
        context.log(`⚠️ SignalR failed: ${e.message}`);
      }

    } catch (err) {
      context.log.error('❌ Error processing stats:', err.message);
    }
  }
});
