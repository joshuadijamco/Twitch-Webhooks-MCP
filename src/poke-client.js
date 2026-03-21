import { Poke } from 'poke';

export function createPokeClient({ apiKey, pokeInstance } = {}) {
  const poke = pokeInstance || new Poke({ apiKey });

  return {
    async createWebhook({ condition, action }) {
      const result = await poke.createWebhook({ condition, action });
      return {
        triggerId: result.triggerId,
        webhookUrl: result.webhookUrl,
        webhookToken: result.webhookToken,
      };
    },

    async sendWebhook({ webhookUrl, webhookToken, data }) {
      return poke.sendWebhook({ webhookUrl, webhookToken, data });
    },
  };
}
