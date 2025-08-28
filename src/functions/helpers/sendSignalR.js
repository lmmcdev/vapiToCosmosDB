//make 
async function sendSignalREvent(signalRUrl, groupName, target, payload = []) {
  return fetch(signalRUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hub: 'ticketshubchannels',
      groupName: `department:${groupName}`,
      target,
      payload
    }),
  });
}

module.exports = sendSignalREvent;
