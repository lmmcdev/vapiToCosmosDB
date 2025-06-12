const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error } = require('../shared/responseUtils');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const MIAMI_TZ = 'America/New_York';

app.http('cosmoGetStats', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getContainer();

      // Obtener fecha base en zona horaria de Miami
      const dateParam = req.query.get('date'); // formato esperado: YYYY-MM-DD
      const baseDate = dateParam
        ? dayjs.tz(dateParam, MIAMI_TZ)
        : dayjs().tz(MIAMI_TZ).startOf('day');

      const startOfDay = baseDate.startOf('day');
      const endOfDay = baseDate.add(1, 'day').startOf('day');

      // Obtener todos los tickets
      //??????????????
      const { resources: allTickets } = await container.items
        .query('SELECT * FROM c')
        .fetchAll();

      // Filtrar tickets cuya fecha en formato "MM/DD/YYYY, HH:mm" esté dentro del rango
      const filteredTickets = allTickets.filter(ticket => {
        if (!ticket.creation_date) return false;

        const ticketDate = dayjs.tz(ticket.creation_date, 'MM/DD/YYYY, HH:mm', MIAMI_TZ);
        return ticketDate.isValid() && ticketDate.isAfter(startOfDay) && ticketDate.isBefore(endOfDay);
      });

      const stats = {
        total: 0,
        New: 0,
        'In Progress': 0,
        Done: 0,
        Emergency: 0,
        Pending: 0,
        Duplicated: 0,
        manualCalls: 0,
        transferred: 0,
      };

      for (const ticket of filteredTickets) {
        stats.total++;

        const status = ticket.status || 'Unknown';
        if (stats[status] !== undefined) {
          stats[status]++;
        }

        if (ticket.tiket_source === 'Form') {
          stats.manualCalls++;
        }

        const currentDept = ticket.assigned_department;
        const dept1 = ticket.call?.call_analysis?.custom_analysis_data?.assigned_department;
        const dept2 = ticket.message?.analysis?.vapi_assignment;
        if ((dept1 && dept1 !== currentDept) || (dept2 && dept2 !== currentDept)) {
          stats.transferred++;
        }
      }

      return success(stats);
    } catch (err) {
      context.log('❌ Error al obtener estadísticas:', err);
      return error('Error al obtener estadísticas', err);
    }
  }
});
