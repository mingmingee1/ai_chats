import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBrief, buildTurn, modelLabel } from '../lib/prompt.mjs';
import { setLang } from '../lib/i18n.mjs';
import { AI_IDS } from '../lib/members.mjs';
import { UsageMonitor } from '../lib/usage.mjs';

const base = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));
const prohibited = /작업공간|건축 월드|스티커|workspace|sticker|build world|ワークスペース|スタンプ|建築ワールド|"(?:files|show|image|build|block_define|move|world_look|world_shot)"/i;
for (const lang of ['ko', 'en', 'ja']) {
  for (const chatOnly of [true, false]) {
    test(`brief and turn: ${lang}, chatOnly=${chatOnly}`, () => {
      setLang(lang);
      const cfg = { ...base, chatOnly, imageGen: true, historyForPrompt: 40 };
      for (const id of AI_IDS) {
        const brief = buildBrief(id, cfg, { canSee: true });
        if (chatOnly) assert.doesNotMatch(brief, prohibited);
        else { assert.match(brief, /"build"/); assert.match(brief, /"files"/); assert.match(brief, /"sticker"/); }
        for (const field of ['open', 'note_add', 'note_replace', 'boost']) assert.ok(brief.includes(`"${field}"`));
      }
      const store = {
        readNote: () => '', listFiles: () => { if (chatOnly) throw Error('workspace must not be read'); return []; },
        recent: () => [], after: () => [], lastMessage: () => null, messages: [], byId: new Map(),
      };
      for (const reason of ['spark', 'idle']) {
        const turn = buildTurn('muse', { store, cfg, agent: { seen: 0 }, reason, world: 'WORLD-SENTINEL' });
        if (chatOnly) { assert.doesNotMatch(turn, prohibited); assert.ok(!turn.includes('WORLD-SENTINEL')); }
        else assert.ok(turn.includes('WORLD-SENTINEL'));
      }
    });
  }
  test(`Muse unsupported usage message: ${lang}`, async () => {
    setLang(lang);
    await assert.rejects(UsageMonitor.prototype.muse(), /Muse Code.*dev\.meta\.ai/);
  });
}
test('default model label and disabled image-generation fields', () => {
  assert.equal(modelLabel({ model: '', effort: 'low' }), 'default (effort low)');
  assert.equal(modelLabel({}), '');
  setLang('ko');
  const brief = buildBrief('gpt', { ...base, chatOnly: false, imageGen: false });
  assert.doesNotMatch(brief, /\n  "image":/);
});
