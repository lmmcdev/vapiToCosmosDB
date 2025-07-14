const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getStatsContainer } = require('../shared/cosmoStatsClient');
const { success, error } = require('../shared/responseUtils');

const signalrMonthlyStats = process.env.SIGNAL_BROADCAST_URL_MONTHLY;

app.timer('processMonthlyTicketStats', {
  schedule: '0 10 0 * * *', // Todos los días a las 12:10 AM
  handler: async (myTimer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer = getStatsContainer();

      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const isoMonthStart = firstOfMonth.toISOString();

      const query = `SELECT * FROM c WHERE c.createdAt >= '${isoMonthStart}'`;
      const { resources: tickets } = await ticketContainer.items.query(query).fetchAll();

      if (tickets.length === 0) {
        context.log('No tickets to process this month yet');
        return;
      }

      let globalTotalTime = 0;
      let resolvedCount = 0;
      const agentStatsMap = {};
      const dailyMap = {}; // Mapa por día del mes

      const priorityMap = {};
      const riskMap = {};
      const categoryMap = {};

      for (const ticket of tickets) {
        const created = new Date(ticket.createdAt);
        const closed = ticket.closedAt ? new Date(ticket.closedAt) : null;

        const day = created.toISOString().split('T')[0];
        dailyMap[day] = (dailyMap[day] || 0) + 1;

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

      const agentStats = Object.entries(agentStatsMap).map(([agentEmail, stats]) => ({
        agentEmail,
        avgResolutionTimeMins: Math.round(stats.totalTime / stats.resolved),
        resolvedCount: stats.resolved
      }));

      const dailyBreakdown = Object.entries(dailyMap).map(([date, count]) => ({
        date,
        count
      })).sort((a, b) => a.date.localeCompare(b.date));

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
        id: `month-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        date: now.toISOString().split('T')[0],
        scope: 'month-to-date',
        agentStats,
        globalStats,
        dailyBreakdown,
        aiClassificationStats
      };

      await statsContainer.items.upsert(statDoc);
      context.log('✅ Monthly stats processed successfully.');

      try {
        context.log(`📡 Sending to SignalR: ${signalrMonthlyStats}`);
        const result = await fetch(signalrMonthlyStats, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(statDoc)
        });
        context.log('📨 Monthly stats sent to SignalR', JSON.stringify(result));
      } catch (e) {
        context.log('⚠️ SignalR send failed:', e.message);
      }

    } catch (err) {
      context.log.error('❌ Error processing monthly stats:', err.message);
    }
  }
});