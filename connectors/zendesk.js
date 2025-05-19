export async function createZendeskTicket(auth, ticket) {
  const { subdomain, email, apiToken } = auth;
  if (!subdomain || !email || !apiToken) {
    throw new Error('Missing Zendesk credentials');
  }

  const credentials = Buffer.from(`${email}/token:${apiToken}`).toString('base64');

  const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`
    },
    body: JSON.stringify({ ticket })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zendesk API error: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.json();
}
