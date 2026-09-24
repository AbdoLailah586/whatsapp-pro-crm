const test = require('node:test');
const assert = require('node:assert/strict');

test('a 58-target campaign finishes after four target failures', async () => {
  const db = {
    progress: [], logs: [],
    async createCampaign() { return 'camp_test'; },
    async updateCampaignProgress(id, sent, failed, status) { this.progress.push({ sent, failed, status }); },
    async logCampaignItem(id, target, status, error) { this.logs.push({ target, status, error }); },
  };
  const dbPath = require.resolve('../src/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  const AutomationTools = require('../src/automationTools');
  const events = [];
  const sent = [];
  const whatsapp = {
    socket: {},
    isConnected() { return true; },
    async simulateHumanTyping(jid) {
      if (jid === 'first@g.us') throw new Error('presence unavailable');
    },
    async sendMessage(jid) {
      if (jid === 'first@g.us' || jid === 'group2@g.us' || jid === 'group3@g.us') throw new Error('only admins can post');
      sent.push(jid);
    },
    async isOnWhatsApp() { return { exists: false }; },
  };
  await AutomationTools.runCampaign(whatsapp, {
    title: 'test', template: 'hello',
    contacts: ['first@g.us'].concat(Array.from({ length: 56 }, (_, i) => `group${i + 2}@g.us`), ['201000000000']),
    minDelay: 0.001, maxDelay: 0.001, batchSize: 0,
    ioEmitter(event, payload) { events.push(payload); },
  });
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const poll = () => {
      if (db.progress.at(-1)?.status === 'completed') resolve();
      else if (Date.now() > deadline) reject(new Error('campaign did not finish'));
      else setTimeout(poll, 10);
    };
    poll();
  });
  assert.equal(sent.length, 54);
  assert.equal(db.logs[0].status, 'failed');
  assert.equal(db.logs[1].status, 'failed');
  assert.equal(db.logs[2].status, 'failed');
  assert.equal(db.logs.at(-1).status, 'failed');
  assert.deepEqual(db.progress.at(-1), { sent: 54, failed: 4, status: 'completed' });
  assert.ok(events.some((event) => event.phase === 'waiting' && event.nextSendAt > Date.now() - 5000));
  assert.ok(events.some((event) => event.phase === 'waiting' && event.targetName === 'group2@g.us'));

  db.progress = [];
  db.logs = [];
  let laterTargetSent = false;
  await AutomationTools.runCampaign({
    socket: {}, isConnected() { return true; },
    async sendMessage(jid) {
      if (jid === 'hung@g.us') return new Promise(() => {});
      laterTargetSent = true;
    },
  }, {
    title: 'hung send', template: 'hello', contacts: ['hung@g.us', 'later@g.us'],
    enableTyping: false, verifyWhatsApp: false, batchSize: 0, sendTimeoutMs: 30,
  });
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const poll = () => {
      if (db.progress.at(-1)?.status === 'needs_review') resolve();
      else if (Date.now() > deadline) reject(new Error('hung send was not reported'));
      else setTimeout(poll, 10);
    };
    poll();
  });
  assert.equal(laterTargetSent, false);
  assert.equal(db.logs[0].status, 'uncertain');
  assert.deepEqual(db.progress.at(-1), { sent: 0, failed: 0, status: 'needs_review' });
});
