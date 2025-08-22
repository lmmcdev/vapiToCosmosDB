// src/functions/cosmoGetQcMetrics.js
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getQCContainer } = require('../shared/cosmoQCEvaluations')
const { success, error } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');

const GROUP_QUALITY_REVIEWERS = GROUPS?.QUALITY?.QUALITY_GROUP;

app.http('cosmoGetQcMetrics', {
  route: 'cosmoQcMetrics',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      const container = getQCContainer();

      // 🔎 Query params para filtro de fechas
      const url = new URL(req.url);
      const from = url.searchParams.get('from'); // ej: 2025-08-01
      const to   = url.searchParams.get('to');   // ej: 2025-08-31

      let query = `SELECT * FROM c`;
      let params = [];

      if (from || to) {
        query += ` WHERE 1=1`;
        if (from) {
          query += ` AND c.createdAt >= @from`;
          params.push({ name: '@from', value: new Date(from).toISOString() });
        }
        if (to) {
          query += ` AND c.createdAt <= @to`;
          params.push({ name: '@to', value: new Date(to).toISOString() });
        }
      }

      const { resources } = await container.items.query({ query, parameters: params }).fetchAll();

      if (!resources || resources.length === 0) {
        return success('No evaluations found in range', { outcomes: {}, avgScores: [], trend: [], rubricAvg: {} });
      }

      // 1. Distribución outcomes
      const outcomes = resources.reduce((acc, r) => {
        const key = r?.outcome ?? 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      // 2. Score promedio por agente
      const scoresByAgent = {};
      resources.forEach(r => {
        const agent = r?.agent_email ?? 'unknown';
        const score = Number(r?.score) || 0;
        if (!scoresByAgent[agent]) scoresByAgent[agent] = { total: 0, count: 0 };
        scoresByAgent[agent].total += score;
        scoresByAgent[agent].count += 1;
      });
      const avgScores = Object.entries(scoresByAgent).map(([agent, { total, count }]) => ({
        agent,
        avgScore: count ? (total / count).toFixed(2) : 0,
        evaluations: count,
      }));

      // 3. Tendencia semanal
      const trendMap = {};
      resources.forEach(r => {
        const d = new Date(r?.createdAt);
        if (isNaN(d)) return;
        const week = `${d.getUTCFullYear()}-W${Math.ceil(d.getUTCDate() / 7)}`;
        const score = Number(r?.score) || 0;
        if (!trendMap[week]) trendMap[week] = { total: 0, count: 0 };
        trendMap[week].total += score;
        trendMap[week].count += 1;
      });
      const trend = Object.entries(trendMap).map(([week, { total, count }]) => ({
        week,
        avgScore: count ? (total / count).toFixed(2) : 0,
      }));

      // 4. Promedio por rúbrica
      const rubricTotals = { compliance: 0, accuracy: 0, process: 0, softSkills: 0, documentation: 0 };
      let rubricCount = 0;
      resources.forEach(r => {
        if (r?.rubric) {
          rubricCount++;
          Object.keys(rubricTotals).forEach(k => {
            rubricTotals[k] += Number(r.rubric[k] || 0);
          });
        }
      });
      const rubricAvg = Object.fromEntries(
        Object.entries(rubricTotals).map(([k, v]) => [k, rubricCount ? (v / rubricCount).toFixed(2) : 0])
      );

      return success('QC metrics computed', { outcomes, avgScores, trend, rubricAvg });
    } catch (e) {
      context.log('⚠️ cosmoGetQcMetrics error', e);
      return error('Failed to compute QC metrics', 500, e.message);
    }
  }, {
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_QUALITY_REVIEWERS],
  }),
});
