import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPokeClient } from '../src/poke-client.js';

describe('poke-client', () => {
  it('should create a webhook and return config', async () => {
    const mockPoke = {
      createWebhook: async ({ condition, action }) => ({
        triggerId: 'trigger-1',
        webhookUrl: 'https://poke.com/api/v1/inbound/webhook',
        webhookToken: 'token-abc',
      }),
    };
    const client = createPokeClient({ pokeInstance: mockPoke });
    const result = await client.createWebhook({ condition: 'test', action: 'test action' });
    assert.equal(result.webhookUrl, 'https://poke.com/api/v1/inbound/webhook');
    assert.equal(result.webhookToken, 'token-abc');
  });

  it('should send a webhook with data', async () => {
    let sentData;
    const mockPoke = {
      sendWebhook: async (opts) => {
        sentData = opts;
        return { success: true };
      },
    };
    const client = createPokeClient({ pokeInstance: mockPoke });
    await client.sendWebhook({
      webhookUrl: 'https://poke.com/api/v1/inbound/webhook',
      webhookToken: 'token-abc',
      data: { event: 'stream.online', username: 'shroud' },
    });
    assert.equal(sentData.webhookUrl, 'https://poke.com/api/v1/inbound/webhook');
    assert.deepEqual(sentData.data, { event: 'stream.online', username: 'shroud' });
  });

  it('should throw on webhook send failure', async () => {
    const mockPoke = {
      sendWebhook: async () => { throw new Error('Network error'); },
    };
    const client = createPokeClient({ pokeInstance: mockPoke });
    await assert.rejects(
      () => client.sendWebhook({ webhookUrl: 'url', webhookToken: 'tok', data: {} }),
      /Network error/
    );
  });
});
