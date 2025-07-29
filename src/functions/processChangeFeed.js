import { app } from '@azure/functions';

const EVENT_GRID_URL = 'https://<NOMBRE_DEL_ENDPOINT_EVENTGRID>'; // Reemplaza esto
const MAX_RETRIES = 3;

async function sendWithRetry(events, context) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(EVENT_GRID_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'aeg-sas-key': process.env.EVENTGRID_KEY,
        },
        body: JSON.stringify(events),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Status: ${res.status}, Body: ${text}`);
      }

      context.log(`✅ Eventos enviados con éxito (intento ${attempt})`);
      return;
    } catch (err) {
      context.log.error(`❌ Intento ${attempt} fallido: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // espera 2s, 4s, 8s...
        context.log(`🔁 Reintentando en ${delay / 1000}s...`);
        await new Promise((res) => setTimeout(res, delay));
      } else {
        context.log.error('⛔ No se pudo enviar a Event Grid después de varios intentos.');
      }
    }
  }
}

app.cosmosDB('processChangeFeed', {
  connection: 'AzureWebJobsCosmosDBConnection',
  databaseName: 'IAData',
  containerName: 'iadata_id',
  leaseContainerName: 'leases',
  createLeaseContainerIfNotExists: true,
  feedPollDelay: 5000,
  handler: async (documents, context) => {
    if (!documents?.length) return;

    context.log(`📥 Se recibieron ${documents.length} cambio(s) del Change Feed`);

    // Filtrar por risk === "legal"
    const legalDocs = documents.filter(
      (doc) => doc?.aiClassification?.risk?.toLowerCase() === 'legal'
    );

    if (legalDocs.length === 0) {
      context.log('📭 Ningún documento con risk "legal" encontrado');
      return;
    }

    const events = legalDocs.map((doc) => ({
      id: doc.id || crypto.randomUUID(),
      subject: `/tickets/${doc.id}`,
      eventType: 'legal.ticket.detected',
      eventTime: new Date().toISOString(),
      data: {
        ticketId: doc.id,
        title: doc.call_reason || 'No motive provided',
        body: doc.description || 'No description provided',
        department: doc.assigned_department || 'unknown',
        role: 'supervisor',
        priority: doc.aiClassification?.priority || 'normal',
        agent_assigned: doc.agent_assigned || 'unassigned',
        status: doc.status || 'open',
        phone: doc.phone || '',
      },
      dataVersion: '1.0',
    }));

    await sendWithRetry(events, context);
  },
});
