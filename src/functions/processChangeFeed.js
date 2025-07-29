import { app } from '@azure/functions';

const EVENT_GRID_TOPIC_ENDPOINT = process.env.EVENT_GRID_TOPIC_ENDPOINT;
const EVENT_GRID_KEY = process.env.EVENT_GRID_KEY;

const COSMOS_DB_CONNECTION_STRING = process.env.COSMOS_CONN_STRING;

app.cosmosDB('processChangeFeed', {
  connection: COSMOS_DB_CONNECTION_STRING,
  databaseName: 'IAData',
  containerName: 'iadata_id',
  leaseContainerName: 'leases',
  createLeaseContainerIfNotExists: true,
  handler: async (documents, context) => {
    if (!documents || documents.length === 0) {
      context.log('No documents to process.');
      return;
    }

    context.log(`Processing ${documents.length} change(s).`);

    for (const doc of documents) {
      const risk = doc?.aiClassification?.risk;

      if (risk !== 'legal') {
        context.log(`Document ${doc.id} skipped (risk: ${risk})`);
        continue;
      }

      const event = {
        id: `ticket-legal-${doc.id}`,
        eventType: 'ticket.created',
        subject: `tickets/${doc.id}`,
        eventTime: new Date().toISOString(),
        dataVersion: '1.0',
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
      };

      try {
        const response = await fetch(EVENT_GRID_TOPIC_ENDPOINT, {
          method: 'POST',
          headers: {
            'aeg-sas-key': EVENT_GRID_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([event]),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        context.log(`✅ EventGrid: Evento enviado para ticket LEGAL ${doc.id}`);
      } catch (error) {
        context.log.error(`❌ Error al enviar evento para ${doc.id}: ${error.message}`);
      }
    }
  },
});
