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

// ⚠️ Relación de clínicas
const defaultLocationOptions = [
  'BIRD ROAD','EAST HIALEAH','HOLLYWOOD','HOMESTEAD',
  'MIAMI 27TH AVE','PEMBROKE PINES','PLANTATION','TAMARAC',
  'WEST HIALEAH','HIALEAH CENTER','WEST KENDALL','CUTLER RIDGE',
  'HIALEAH','HIATUS','MARLINS PARK','MIAMI GARDENS',
  'NORTH MIAMI BEACH','WEST PALM BEACH','WESTCHESTER',
  'REFERRALS','OTC','PHARMACY','SWITCHBOARD'
];

const MIAMI_TZ = 'America/New_York';

function extractClockHour(isoLike) {
  if (!isoLike || typeof isoLike !== 'string') return null;
  const m = isoLike.match(/T(\d{2}):\d{2}/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  return (h >= 0 && h <= 23) ? h : null;
}

// Inicializar statusCounts con conteo + IDs
function initStatusCounts() {
  const base = {};
  for (const s of ALLOWED_STATUSES) {
    base[s] = { count: 0, ticketIds: [] };
  }
  base.Total = { count: 0, ticketIds: [] };
  return base;
}

app.timer('processTicketStats', {
  schedule: '0 50 * * * *',
  handler: async (_timer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer = getStatsContainer();

      const todayYmdMiami = dayjs().tz(MIAMI_TZ).format('YYYY-MM-DD');

      // Traer tickets del día
      const { resources: tickets } = await ticketContainer.items
        .query({
          query: `
            SELECT * FROM c
            WHERE
              (IS_STRING(c.creation_date) AND STARTSWITH(c.creation_date, @ymd))
              OR
              (IS_STRING(c.createdAt) AND STARTSWITH(c.createdAt, @ymd))
          `,
          parameters: [{ name: '@ymd', value: todayYmdMiami }],
        })
        .fetchAll();

      context.log(`Tickets encontrados: ${tickets.length}`);

      // 🔹 Agrupador por clínica
      const statsByLocation = {};

      // Inicializar estructuras por clínica
      for (const loc of defaultLocationOptions) {
        statsByLocation[loc] = {
          agentStatsMap: {},
          hourlyMap: {},
          priorityMap: {},
          riskMap: {},
          categoryMap: {},
          globalTotalTime: 0,
          resolvedCount: 0,
          statusCounts: initStatusCounts()
        };
      }

      const normalizeStatus = (s) => {
        if (!s) return null;
        const key = String(s).trim().toLowerCase();
        return STATUS_ALIASES[key] || null;
      };

      // Procesar tickets
      for (const t of tickets) {
        const loc = t?.location || 'UNKNOWN';
        if (!statsByLocation[loc]) {
          statsByLocation[loc] = {
            agentStatsMap: {},
            hourlyMap: {},
            priorityMap: {},
            riskMap: {},
            categoryMap: {},
            globalTotalTime: 0,
            resolvedCount: 0,
            statusCounts: initStatusCounts()
          };
        }

        const current = statsByLocation[loc];

        // Hora
        const src = t?.createdAt || t?.creation_date;
        const hour = extractClockHour(src);
        if (hour !== null) {
          current.hourlyMap[hour] = (current.hourlyMap[hour] || 0) + 1;
        }

        // Status
        const normStatus = normalizeStatus(t?.status);
        if (normStatus && current.statusCounts[normStatus]) {
          current.statusCounts[normStatus].count += 1;
          if (t.id) current.statusCounts[normStatus].ticketIds.push(t.id);

          // También en Total
          current.statusCounts.Total.count += 1;
          if (t.id) current.statusCounts.Total.ticketIds.push(t.id);
        }

        // Tiempos de resolución
        const openStr = t?.createdAt || t?.creation_date;
        const closedStr = t?.closedAt || null;
        if (openStr && closedStr) {
          const opened = new Date(openStr);
          const closed = new Date(closedStr);
          if (!isNaN(opened) && !isNaN(closed)) {
            const diffMins = Math.floor((closed - opened) / 60000);
            if (diffMins >= 0) {
              current.globalTotalTime += diffMins;
              current.resolvedCount += 1;

              const agent = (t.agent_assigned || 'unassigned').toLowerCase();
              if (!current.agentStatsMap[agent]) {
                current.agentStatsMap[agent] = { totalTime: 0, resolved: 0 };
              }
              current.agentStatsMap[agent].totalTime += diffMins;
              current.agentStatsMap[agent].resolved += 1;
            }
          }
        }

        // AI Classification
        if (t?.aiClassification) {
          const { priority, risk, category } = t.aiClassification;
          if (priority) {
            const p = String(priority);
            (current.priorityMap[p] ||= { count: 0, ticketIds: [] }).count++;
            if (t.id) current.priorityMap[p].ticketIds.push(t.id);
          }
          if (risk) {
            const r = String(risk);
            (current.riskMap[r] ||= { count: 0, ticketIds: [] }).count++;
            if (t.id) current.riskMap[r].ticketIds.push(t.id);
          }
          if (category) {
            const c = String(category);
            (current.categoryMap[c] ||= { count: 0, ticketIds: [] }).count++;
            if (t.id) current.categoryMap[c].ticketIds.push(t.id);
          }
        }
      }

      // 🔹 Transformar a salida final
      const locationsOutput = {};
      for (const [loc, data] of Object.entries(statsByLocation)) {
        const agentStats = Object.entries(data.agentStatsMap).map(([agentEmail, stats]) => ({
          agentEmail,
          avgResolutionTimeMins: stats.resolved ? Math.round(stats.totalTime / stats.resolved) : 0,
          resolvedCount: stats.resolved,
        }));

        const hourlyBreakdown = Object.entries(data.hourlyMap)
          .map(([h, count]) => ({ hour: parseInt(h, 10), count }))
          .sort((a, b) => a.hour - b.hour);

        const globalStats = {
          avgResolutionTimeMins: data.resolvedCount ? Math.round(data.globalTotalTime / data.resolvedCount) : 0,
          resolvedCount: data.resolvedCount,
        };

        locationsOutput[loc] = {
          agentStats,
          globalStats,
          hourlyBreakdown,
          statusCounts: data.statusCounts,
          aiClassificationStats: {
            priority: data.priorityMap,
            risk: data.riskMap,
            category: data.categoryMap
          }
        };
      }

      const dateStr = todayYmdMiami;
      const statDoc = {
        id: dateStr,
        date: dateStr,
        locations: locationsOutput
      };

      if (DailyStatsOutput) {
        const { error: dtoErr } = DailyStatsOutput.validate(statDoc, { abortEarly: false });
        if (dtoErr) context.log.error('Stats DTO validation failed:', dtoErr.details);
      }

      await statsContainer.items.upsert(statDoc);
      context.log('📊 Stats multi-clínica upserted to Cosmos exitosamente');

    } catch (err) {
      context.log.error('Error processing stats:', err?.message || err);
    }
  },
});
