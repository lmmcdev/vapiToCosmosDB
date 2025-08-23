// src/functions/cosmoGetQcMetrics.js
const { app } = require('@azure/functions');
const { getQCContainer } = require('../shared/cosmoQCEvaluations');
const { success, error } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');

const GROUP_QUALITY_REVIEWERS = GROUPS?.QUALITY?.QUALITY_GROUP;

const RUBRIC_KEYS = ['compliance', 'accuracy', 'process', 'softSkills', 'documentation'];

const safeNum = (n, def = 0) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
};
const parseDate = (d) => {
  const dt = new Date(d);
  return isNaN(dt) ? null : dt;
};
// Semana simple (1–7 -> W1, 8–14 -> W2, etc.). Si quieres ISO-week, avísame y lo cambiamos.
const weekBucket = (d) => `${d.getUTCFullYear()}-W${Math.ceil(d.getUTCDate() / 7)}`;

// Histograma por defecto (0–5, 6–10, 11–15)
const DEFAULT_BINS = [
  { label: '0–5',   min: 0,  max: 5 },
  { label: '6–10',  min: 6,  max: 10 },
  { label: '11–15', min: 11, max: 15 },
];

app.http('cosmoQcMetrics', {
  route: 'cosmoQcMetrics',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      const container = getQCContainer();

      // ── Query params ──────────────────────────────────────────────────────────
      const url = new URL(req.url);
      const from = url.searchParams.get('from');        // YYYY-MM-DD o ISO
      const to = url.searchParams.get('to');            // YYYY-MM-DD o ISO
      const agent = url.searchParams.get('agent');      // email exacto
      const reviewer = url.searchParams.get('reviewer'); // email exacto

      const fromIso = from ? new Date(from).toISOString() : null;
      const toIso = to ? new Date(to).toISOString() : null;

      // WHERE dinámico
      const parameters = [];
      let query = 'SELECT * FROM c';
      const wheres = [];

      if (fromIso) {
        wheres.push('c.createdAt >= @from');
        parameters.push({ name: '@from', value: fromIso });
      }
      if (toIso) {
        wheres.push('c.createdAt <= @to');
        parameters.push({ name: '@to', value: toIso });
      }
      if (agent) {
        wheres.push('c.agent_email = @agent');
        parameters.push({ name: '@agent', value: agent });
      }
      if (reviewer) {
        wheres.push('c.reviewer_email = @reviewer');
        parameters.push({ name: '@reviewer', value: reviewer });
      }

      if (wheres.length) query += ' WHERE ' + wheres.join(' AND ');

      const { resources } = await container.items
        .query({ query, parameters }, { enableCrossPartition: true })
        .fetchAll();

      if (!resources || resources.length === 0) {
        return success('No evaluations found in range', {
          outcomes: {}, avgScores: [], trend: [], rubricAvg: {},
          histogram: [], failRate: 0, coachingRate: 0,
          topAgents: [], bottomAgents: [], evaluationsPerReviewer: [],
          weakestCriterion: null, total: 0, dropped: 0,
        });
      }

      // ── Sanitizar y filtrar válidos ──────────────────────────────────────────
      const total = resources.length;
      const valid = [];
      let dropped = 0;

      for (const r of resources) {
        const hasSomething =
          typeof r?.createdAt !== 'undefined' ||
          typeof r?.score !== 'undefined' ||
          typeof r?.outcome !== 'undefined';
        if (!hasSomething) { dropped++; continue; }
        valid.push(r);
      }

      if (valid.length === 0) {
        return success('No valid evaluations found in range', {
          outcomes: {}, avgScores: [], trend: [], rubricAvg: {},
          histogram: [], failRate: 0, coachingRate: 0,
          topAgents: [], bottomAgents: [], evaluationsPerReviewer: [],
          weakestCriterion: null, total, dropped,
        });
      }

      // ── 1) Outcomes ──────────────────────────────────────────────────────────
      const outcomes = valid.reduce((acc, r) => {
        const key = r?.outcome ?? 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      // ── 2) Avg score por agente ─────────────────────────────────────────────
      const scoresByAgent = {};
      for (const r of valid) {
        const ag = r?.agent_email ?? 'unknown';
        const sc = safeNum(r?.score, 0);
        if (!scoresByAgent[ag]) scoresByAgent[ag] = { total: 0, count: 0 };
        scoresByAgent[ag].total += sc;
        scoresByAgent[ag].count += 1;
      }
      const avgScores = Object
        .entries(scoresByAgent)
        .map(([ag, { total, count }]) => ({ agent: ag, avgScore: count ? (total / count).toFixed(2) : '0.00', evaluations: count }))
        .sort((a, b) => Number(b.avgScore) - Number(a.avgScore));

      // ── 3) Tendencia semanal (promedio) ─────────────────────────────────────
      const trendMap = {};
      for (const r of valid) {
        const d = parseDate(r?.createdAt);
        if (!d) continue;
        const wk = weekBucket(d);
        const sc = safeNum(r?.score, 0);
        if (!trendMap[wk]) trendMap[wk] = { total: 0, count: 0 };
        trendMap[wk].total += sc;
        trendMap[wk].count += 1;
      }
      const trend = Object.entries(trendMap)
        .map(([week, { total, count }]) => ({ week, avgScore: count ? (total / count).toFixed(2) : '0.00' }))
        .sort((a, b) => a.week.localeCompare(b.week));

      // ── 4) Promedio por rúbrica ────────────────────────────────────────────
      const rubricTotals = RUBRIC_KEYS.reduce((acc, k) => (acc[k] = 0, acc), {});
      let rubricCount = 0;
      for (const r of valid) {
        if (r?.rubric && typeof r.rubric === 'object') {
          rubricCount++;
          for (const k of RUBRIC_KEYS) rubricTotals[k] += safeNum(r.rubric[k], 0);
        }
      }
      const rubricAvg = Object.fromEntries(
        RUBRIC_KEYS.map(k => [k, rubricCount ? (rubricTotals[k] / rubricCount).toFixed(2) : 0])
      );

      // ── 5) Histograma de scores ─────────────────────────────────────────────
      const bins = DEFAULT_BINS.map(b => ({ ...b, count: 0 }));
      for (const r of valid) {
        const sc = safeNum(r?.score, 0);
        const bin = bins.find(b => sc >= b.min && sc <= b.max);
        if (bin) bin.count += 1;
      }
      const histogram = bins.map(b => ({ label: b.label, count: b.count }));

      // ── 6) Tasas (fail y coaching) ──────────────────────────────────────────
      const totalValid = valid.length;
      const failCount = outcomes.failed || 0;
      const coachingCount = outcomes.coaching_required || 0;
      const failRate = totalValid ? Number(((failCount / totalValid) * 100).toFixed(2)) : 0;
      const coachingRate = totalValid ? Number(((coachingCount / totalValid) * 100).toFixed(2)) : 0;

      // ── 7) Top/Bottom agents ───────────────────────────────────────────────
      const topAgents = avgScores.slice(0, 3);
      const bottomAgents = [...avgScores].reverse().slice(0, 3);

      // ── 8) Evaluaciones por revisor ────────────────────────────────────────
      const reviewerCounts = {};
      for (const r of valid) {
        const rev = r?.reviewer_email ?? 'unknown';
        reviewerCounts[rev] = (reviewerCounts[rev] || 0) + 1;
      }
      const evaluationsPerReviewer = Object
        .entries(reviewerCounts)
        .map(([reviewer_email, count]) => ({ reviewer_email, count }))
        .sort((a, b) => b.count - a.count);

      // ── 9) Criterio más débil ──────────────────────────────────────────────
      let weakestCriterion = null;
      if (rubricCount) {
        const pairs = RUBRIC_KEYS.map(k => [k, rubricTotals[k] / rubricCount]);
        pairs.sort((a, b) => a[1] - b[1]); // ascendente
        const [name, value] = pairs[0];
        weakestCriterion = { name, value: Number(value.toFixed(2)) };
      }

      return success('QC metrics computed', {
        outcomes,
        avgScores,
        trend,
        rubricAvg,
        histogram,
        failRate,
        coachingRate,
        topAgents,
        bottomAgents,
        evaluationsPerReviewer,
        weakestCriterion,
        total: totalValid,
        dropped,
      });
    } catch (e) {
      return error('Failed to compute QC metrics', 500, e?.message || 'unknown');
    }
  }, {
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_QUALITY_REVIEWERS],
  }),
});
