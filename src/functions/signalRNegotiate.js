const { app } = require('@azure/functions');
const { AzureFunction, app: funcApp } = require('@azure/functions');
const { SignalRConnectionInfoInput } = require('@azure/functions');

app.http('negotiate', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const connectionInfo = await context.bindings.signalRConnectionInfo;
    return {
      body: connectionInfo,
    };
  },
  extraInputs: [
    {
      type: 'signalRConnectionInfo',
      name: 'signalRConnectionInfo',
      hubName: 'ticketsHub',
    },
  ],
});