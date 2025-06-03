const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoUpdatePatientBOD', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, nueva_fechanacimiento;

    try {
      ({ tickets, agent_email, nueva_fechanacimiento } = await req.json());
    } catch (err) {
      return badRequest('JSON inválido');
    }

    if (!tickets || !agent_email || !nueva_fechanacimiento) {
      return badRequest('Your request have missing parameters: tickets, agent_email or nueva_fechanacimiento.');
    }

    const fechaRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
    if (!fechaRegex.test(nueva_fechanacimiento)) {
      return badRequest('Invalid date format, please set your date to MM/DD/YYYY (ex. 06/15/1985).');
    }

    const container = getContainer();

    try {
      const item = container.item(tickets, tickets);
      const { resource: existing } = await item.read();

      const patchOps = [];

      // Añadir o reemplazar /patient_dob
      if (existing.patient_dob === undefined) {
        patchOps.push({
          op: 'add',
          path: '/patient_dob',
          value: nueva_fechanacimiento
        });
      } else {
        patchOps.push({
          op: 'replace',
          path: '/patient_dob',
          value: nueva_fechanacimiento
        });
      }

      // Asegurar que notes existe
      if (!Array.isArray(existing.notes)) {
        patchOps.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Patient DOB changed to "${nueva_fechanacimiento}"`
        }
      });

      await item.patch(patchOps);

      return success('Operation successful.');

    } catch (err) {
      context.log('❌ Error en PATCH parcial:', err);
      return error('Error updating patient dob.', 500, err.message);
    }
  }
});
