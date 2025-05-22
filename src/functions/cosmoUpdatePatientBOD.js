const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoUpdatePatientBOD', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { tickets, agent_email, nueva_fechanacimiento } = await req.json();

    if (!tickets || !agent_email || !nueva_fechanacimiento) {
      return { status: 400, body: 'Faltan parámetros: tickets, agent_email o nueva_fechanacimiento.' };
    }

    // Validar formato MM/DD/YYYY
    const fechaRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
    if (!fechaRegex.test(nueva_fechanacimiento)) {
      return {
        status: 400,
        body: 'Formato de fecha inválido. Usa MM/DD/YYYY (por ejemplo, 06/15/1985).'
      };
    }

    const container = getContainer();

    try {
      const item = container.item(tickets, tickets);

      // Realizar PATCH parcial
      await item.patch([
        {
          op: 'replace',
          path: '/message/analysis/structuredData/fechanacimiento_paciente',
          value: nueva_fechanacimiento
        },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Cambio de fecha de nacimiento del paciente a "${nueva_fechanacimiento}"`
          }
        }
      ]);

      return {
        status: 200,
        body: { message: 'Fecha de nacimiento actualizada correctamente.' }
      };

    } catch (err) {
      context.log('❌ Error en PATCH parcial:', err);
      return { status: 500, body: 'Error en la actualización parcial: ' + err.message };
    }
  }
});
