// src/functions/ticketCreatedNotification.js
import { app } from '@azure/functions';

export async function ticketCreatedNotification(context, req) {
  const ticket = req.body;

  context.log('Sending SignalR notification for new ticket:', ticket);

  context.bindings.signalRMessages = [{
    target: 'newTicket',
    arguments: [ticket],
  }];

  return {
    status: 200,
    body: { message: 'Notification sent' },
  };
}

app.http('ticketCreatedNotification', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'notify/ticketCreated',
  handler: ticketCreatedNotification,
  extraOutputs: [
    {
      name: 'signalRMessages',
      type: 'signalR',
      direction: 'out',
      hubName: 'ticketsHub', // Este nombre debe coincidir con tu cliente
    },
  ],
});
