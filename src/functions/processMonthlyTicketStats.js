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

// ⚠️ Relación de clínicas
const defaultLocationOptions = [
  'BIRD ROAD','EAST HIALEAH','HOLLYWOOD','HOMESTEAD',
  'MIAMI 27TH AVE','PEMBROKE PINES','PLANTATION','TAMARAC',
  'WEST HIALEAH','HIALEAH CENTER','WEST KENDALL','CUTLER RIDGE',
  'HIALEAH','HIATUS','MARLINS PARK','MIAMI GARDENS',
  'NORTH MIAMI BEACH','WEST PALM BEACH','WESTCHESTER',
  'REFERRALS','OTC','PHARMACY','SWITCHBOARD'
];

// Helpers
function yyyymm(d) { return `${d.year()}-${String(d.month() + 1).padStart(2, '0')}`; }
function yyyy_mm_dd(d) { return d.format('YYYY-MM-DD'); }
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
// YYYY-MM-DD desde ISO
function extractClockDate(isoLike) {
  if (!isoLike || typeof isoLike !== 'string') return null;
  const m = isoLike.match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : null;
}
// HH desde ISO
function extractClockHour(isoLike) {
  if (!isoLike || typeof isoLike !== 'string') return null;
  const m = isoLike.match(/T(\d{2}):/);
  return m ? Number(m[1]) : null;
}

// Inicializa statusCounts por clínica
function initStatusCounts() {
  const base = {};
  for (const s of ALLOWED_STATUSES) {
    base[s] = { count: 0, ticketIds: [] };
  }
  base.Total = { count: 0, ticketIds: [] };
  return base;
}

function aggregateMonthly(tickets) {
  const statsByLocation = {};

  // Precrear estructuras
  for (const loc of defaultLocationOptions) {
    statsByLocation[loc] = {
      agentStatsMap: {},
      dailyMap: {},
      hourlyMap: {},
      priorityMap: {},
      riskMap: {},
      categoryMap: {},
      globalTotalTime: 0,
      resolvedCount: 0,
      statusCounts: initStatusCounts()
    };
  }

  for (const t of tickets) {
    const loc = t?.location || 'UNKNOWN';
    if (!statsByLocation[loc]) {
      statsByLocation[loc] = {
        agentStatsMap: {},
        dailyMap: {},
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
    const openStr = t?.createdAt || t?.creation_date || null;

    // Daily
    const day = openStr ? extractClockDate(openStr) : null;
    if (day) current.dailyMap[day] = (current.dailyMap[day] || 0) + 1;

    // Hourly
    const hour = openStr ? extractClockHour(openStr) : null;
    if (hour !== null && hour >= 0 && hour <= 23) {
      current.hourlyMap[hour] = (current.hourlyMap[hour] || 0) + 1;
    }

    // Status
    const st = normalizeStatus(t?.status);
    if (st && current.statusCounts[st]) {
      current.statusCounts[st].count++;
      if (t.id) current.statusCounts[st].ticketIds.push(t.id);

      current.statusCounts.Total.count++;
      if (t.id) current.statusCounts.Total.ticketIds.push(t.id);
    }

    // Resolution
    const closedStr = t?.closedAt || null;
    if (openStr && closedStr) {
      const opened = new Date(openStr);
      const closed = new Date(closedStr);
      if (!isNaN(opened) && !isNaN(closed)) {
        const diffMins = Math.floor((closed - opened) / 60000);
        if (diffMins >= 0) {
          current.globalTotalTime += diffMins;
          current.resolvedCount++;

          const agent = (t.agent_assigned || 'unassigned').toLowerCase();
          if (!current.agentStatsMap[agent]) {
            current.agentStatsMap[agent] = { totalTime: 0, resolved: 0 };
          }
          current.agentStatsMap[agent].totalTime += diffMins;
          current.agentStatsMap[agent].resolved++;
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

  // Transformar a salida
  const locationsOutput = {};
  for (const [loc, data] of Object.entries(statsByLocation)) {
    const agentStats = Object.entries(data.agentStatsMap).map(([agentEmail, stats]) => ({
      agentEmail,
      avgResolutionTimeMins: stats.resolved ? Math.round(stats.totalTime / stats.resolved) : 0,
      resolvedCount: stats.resolved,
    }));

    const dailyBreakdown = Object.entries(data.dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const hourlyBreakdown = Object.entries(data.hourlyMap)
      .map(([h, count]) => ({ hour: Number(h), count }))
      .sort((a, b) => a.hour - b.hour);

    const globalStats = {
      avgResolutionTimeMins: data.resolvedCount ? Math.round(data.globalTotalTime / data.resolvedCount) : 0,
      resolvedCount: data.resolvedCount,
    };

    locationsOutput[loc] = {
      agentStats,
      dailyBreakdown,
      hourlyBreakdown,
      globalStats,
      statusCounts: data.statusCounts,
      aiClassificationStats: {
        priority: data.priorityMap,
        risk: data.riskMap,
        category: data.categoryMap,
      }
    };
  }

  return { locations: locationsOutput };
}

app.timer('processMonthlyTicketStats', {
  // Todos los días a las 00:10 Miami
  schedule: '0 10 0 * * *',
  handler: async (_timer, context) => {
    try {
      const ticketContainer = getContainer();
      const statsContainer  = getStatsContainer();

      const nowMiami = dayjs().tz(MIAMI_TZ);

      // ---------- A) MTD ----------
      {
        const ymPrefix = nowMiami.format('YYYY-MM');
        const { resources: ticketsMTD } = await ticketContainer.items
          .query({
            query: `
              SELECT * FROM c
              WHERE
                (IS_STRING(c.creation_date) AND STARTSWITH(c.creation_date, @ym))
                OR
                (IS_STRING(c.createdAt) AND STARTSWITH(c.createdAt, @ym))
            `,
            parameters: [{ name: '@ym', value: ymPrefix }],
          })
          .fetchAll();

        const agg = aggregateMonthly(ticketsMTD);

        const idMTD = `month-${yyyymm(nowMiami)}`;
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
      }

      // ---------- B) Mes anterior ----------
      if (nowMiami.date() === 1) {
        const { startPrev } = prevMonthStartEndMiami(nowMiami);
        const ymPrev = startPrev.format('YYYY-MM');

        const { resources: ticketsPrev } = await ticketContainer.items
          .query({
            query: `
              SELECT * FROM c
              WHERE
                (IS_STRING(c.creation_date) AND STARTSWITH(c.creation_date, @ym))
                OR
                (IS_STRING(c.createdAt) AND STARTSWITH(c.createdAt, @ym))
            `,
            parameters: [{ name: '@ym', value: ymPrev }],
          })
          .fetchAll();

        const aggFinal = aggregateMonthly(ticketsPrev);

        const idFinal = `month-${yyyymm(startPrev)}-final`;
        const docFinal = {
          id: idFinal,
          date: yyyy_mm_dd(nowMiami),
          scope: 'final',
          ...aggFinal,
        };

        if (MonthlyStatsOutput) {
          const { error: dtoErr } = MonthlyStatsOutput.validate(docFinal, { abortEarly: false });
          if (dtoErr) context.log.error('FINAL DTO validation:', dtoErr.details);
        }

        await statsContainer.items.upsert(docFinal);
        context.log(`Monthly FINAL upserted: ${idFinal}`);
      }
    } catch (err) {
      console.log(err);
    }
  },
});
