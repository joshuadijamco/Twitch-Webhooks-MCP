export function createTwitchAuth({ clientId, clientSecret, fetchFn = fetch }) {
  let cachedToken = null;

  async function fetchToken() {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetchFn('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: params,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to fetch Twitch token: ${res.status} ${body}`);
    }
    const data = await res.json();
    cachedToken = data.access_token;
    return cachedToken;
  }

  return {
    get clientId() { return clientId; },

    async getToken() {
      if (cachedToken) return cachedToken;
      return fetchToken();
    },

    invalidate() {
      cachedToken = null;
    },
  };
}
