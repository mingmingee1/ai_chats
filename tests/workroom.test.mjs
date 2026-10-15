import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workroom } from '../lib/workroom.mjs';
import { Store } from '../lib/store.mjs';
import { recallMessages, contextText } from '../lib/memory.mjs';
import { parseAction, buildTurn } from '../lib/prompt.mjs';
import { startFixture } from './helpers.mjs';

function setup(t, respond) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workroom-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const adapterFactory = home => ({
    available: () => ({ claude: true, gpt: true, muse: true, gemini: true }),
    maxPromptChars: () => 26000,
    chat: async (id, brief, turn) => {
      calls.push({ id, home, brief, turn });
      if (respond) return respond(id, turn);
      return { ok: true, text: JSON.stringify({ action: 'say', messages: [`${id}-opinion`], context_summary: '사건 → 논의 → 보류 중' }) };
    },
  });
  return { root, calls, room: new Workroom(root, { userName: '방장', maxInFlight: 2 }, { adapterFactory }), adapterFactory };
}
test('project creation, editing, archive and restoration persist without deleting history', async t => {
  const { room, root, adapterFactory } = setup(t);
  const p = room.create({ name: '수업', goal: '겨울 준비' });
  room.send(p.id, { text: '첫 질문', members: ['gpt'] });
  assert.throws(() => room.update(p.id, { archived: true }), /답변이 끝난/);
  assert.throws(() => room.send(p.id, { text: '중복', members: ['gpt'] }), /진행 중/);
  await room.session(p.id).pending;
  room.update(p.id, { name: '겨울 수업', decisions: '3회', nextSteps: '자료 준비', archived: true });
  assert.throws(() => room.send(p.id, { text: '질문', members: ['gpt'] }), /복구/);
  const reloaded = new Workroom(root, {}, { adapterFactory });
  assert.equal(reloaded.state(p.id).messages.length, 2);
  assert.equal(reloaded.get(p.id).decisions, '3회');
  reloaded.update(p.id, { archived: false });
  assert.equal(reloaded.state(p.id).project.archived, false);
  assert.throws(() => room.get('../invalid'), /찾을 수 없어/);
});
test('project prompts and notes never include the social room or another project', async t => {
  const { room, root, calls } = setup(t);
  const social = new Store(root);
  social.addMessage({ from: 'user', text: 'SOCIAL-PRIVATE-SENTINEL' });
  social.writeNote('gpt', 'SOCIAL-NOTE-SENTINEL');
  const a = room.create({ name: 'A' }), b = room.create({ name: 'B' });
  room.session(a.id).store.addMessage({ from: 'user', text: 'PROJECT-A-SENTINEL' });
  room.send(b.id, { text: 'PROJECT-B-QUESTION', members: ['gpt'] });
  await room.session(b.id).pending;
  assert.doesNotMatch(calls[0].turn, /SOCIAL-|PROJECT-A-/);
  assert.match(calls[0].turn, /PROJECT-B-QUESTION/);
  assert.equal(social.messages.length, 1);
  assert.equal(social.readNote('gpt'), 'SOCIAL-NOTE-SENTINEL');
});
test('brainstorm shares a snapshot; review sees prior opinions; summary is retained', async t => {
  const { room, calls } = setup(t);
  const p = room.create({ name: '회의' });
  room.send(p.id, { text: '제안해 줘', members: ['claude','gpt','muse'] });
  await room.session(p.id).pending;
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => !c.turn.includes('-opinion')));
  calls.length = 0;
  room.send(p.id, { text: '검토해 줘', members: ['claude','gpt'], mode: 'review' });
  await room.session(p.id).pending;
  assert.ok(calls[1].turn.split('claude-opinion').length > calls[0].turn.split('claude-opinion').length);
  room.send(p.id, { text: '정리', members: ['muse'], mode: 'summary' });
  await room.session(p.id).pending;
  assert.equal(room.state(p.id).summary.text, '사건 → 논의 → 보류 중');
  assert.throws(() => room.send(p.id, { text: '정리', members: ['muse','gpt'], mode: 'summary' }), /한 명/);
});
test('bounded prompts and failed or pass responses release the busy state', async t => {
  const { room, calls } = setup(t, async id => id === 'gpt' ? { ok: false } : { ok: true, text: '{"action":"pass","messages":["must not post"]}' });
  const p = room.create({ name: 'long', goal: 'G'.repeat(4000) });
  room.update(p.id, { decisions: 'D'.repeat(4000), nextSteps: 'N'.repeat(4000) });
  room.session(p.id).store.writeContext('project', 'C'.repeat(6000), 0);
  room.send(p.id, { text: 'Q'.repeat(20000), members: ['gpt','muse'] });
  await room.session(p.id).pending;
  assert.ok(calls.every(c => c.brief.length + c.turn.length <= 26000));
  assert.equal(room.state(p.id).busy, false);
  assert.equal(room.state(p.id).messages.some(m => m.text === 'must not post'), false);
  assert.equal(room.state(p.id).members.find(m => m.id === 'gpt').status, 'error');
});
test('context persists separately, ignores stale or empty updates, and recalls source conversations', t => {
  const { root } = setup(t), store = new Store(root);
  store.writeNote('gpt', 'original note');
  store.addMessage({ from: 'user', text: '겨울 수업 일정은 토요일에 정하자' });
  store.addMessage({ from: 'gpt', text: '자료를 먼저 확인하고 결정하자' });
  for (let i=0;i<25;i++) store.addMessage({ from: 'user', text: `다른 이야기 ${i}` });
  store.addMessage({ from: 'user', text: '겨울 수업 일정 이어서 얘기하자' });
  store.writeContext('gpt', '수업 일정은 보류 중', 25);
  store.writeContext('gpt', 'stale', 2); store.writeContext('gpt', '', 28);
  const fresh = new Store(root);
  assert.equal(fresh.readContext('gpt').text, '수업 일정은 보류 중');
  assert.equal(fresh.readNote('gpt'), 'original note');
  assert.equal(fresh.messages.length, 28);
  const recent = fresh.recent(5);
  assert.ok(recallMessages(fresh, recent).some(m => m.id === 1));
  assert.match(contextText(fresh, 'gpt', recent), /수업 일정은 보류 중/);
  const turn = buildTurn('gpt', { store: fresh, cfg: { chatOnly: true, historyForPrompt: 5 }, agent: { seen: 0 }, reason: 'urgent' });
  assert.match(turn, /토요일/); assert.match(turn, /누적 대화 맥락/);
  assert.throws(() => store.writeContext('../bad', 'x', 1), /Invalid/);
});
test('JSON extraction preserves code fences inside message text', () => {
  const action = { action: 'say', messages: ['```python\nprint(1)\n```\n$$x^2$$'] };
  assert.deepEqual(parseAction('```json\n' + JSON.stringify(action) + '\n```'), action);
});
test('HTTP workroom routes support CRUD and reject invalid bodies and cross-origin writes', async t => {
  const f = await startFixture(); t.after(f.stop);
  for (const route of ['/work.html','/work.js','/work.css']) assert.equal((await f.request(route)).status, 200);
  assert.equal((await f.request('/api/work/projects')).status, 200);
  const response = await f.request('/api/work/projects', { name: 'HTTP project' });
  assert.equal(response.status, 201);
  const { project } = await response.json();
  assert.equal((await f.request(`/api/work/projects/${project.id}/state`)).status, 200);
  assert.equal((await f.request(`/api/work/projects/${project.id}`, { archived: true })).status, 200);
  assert.equal((await f.request(`/api/work/projects/${project.id}`, { archived: false })).status, 200);
  assert.equal((await f.request(`/api/work/projects/${project.id}/send`)).status, 405);
  assert.equal((await f.request('/api/work/projects', null)).status, 400);
  const cross = await fetch(f.base + '/api/work/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{"name":"blocked"}' });
  assert.equal(cross.status, 403);
});
