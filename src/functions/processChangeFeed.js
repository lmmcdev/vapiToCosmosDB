import { app } from '@azure/functions';

app.cosmosDB('processChangeFeed', {
  connection: 'AzureWebJobsCosmosDBConnection', // ← Nombre de la variable de entorno, no la cadena directamente
  databaseName: 'IAData',
  containerName: 'iadata_id',
  leaseContainerName: 'leases',
  createLeaseContainerIfNotExists: true,
  feedPollDelay: 5000,
  handler: async (documents, context) => {
    if (!documents?.length) return;

    context.log(`🔄 Change Feed activado: ${documents.length} documento(s)`);

    const legalDocs = documents.filter(
      (doc) =>
        doc?.aiClassification?.category?.toLowerCase() === 'legal'
    );

    if (legalDocs.length === 0) {
      context.log('✅ Ningún documento con categoría "Legal"');
      return;
    }

    context.log(`🚨 Se detectaron ${legalDocs.length} documento(s) con categoría "Legal"`);

    for (const doc of legalDocs) {
      try {
        const response = await fetch('https://cserviceseventgrid.eastus-1.eventgrid.azure.net/api/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'aeg-sas-key': process.env.EVENTGRID_KEY, // ← Asegúrate de tener esta variable en Azure
          },
          body: JSON.stringify([
            {
              id: doc.id,
              eventType: 'legal.ticket.detected',
              subject: `/tickets/${doc.id}`,
              eventTime: new Date().toISOString(),
              data: doc,
              dataVersion: '1.0',
            },
          ]),
        });

        context.log(`📤 Evento enviado para documento ${doc.id}:`, response.status);
      } catch (err) {
        context.log.error(`❌ Error al enviar evento para ${doc.id}:`, err.message);
      }
    }
  },
});
