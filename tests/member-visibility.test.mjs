import test from 'node:test';
import assert from 'node:assert/strict';
import { memberStore, memberAction, tagsDeveloper } from '../lib/member-visibility.mjs';
import { buildTurn, buildBrief } from '../lib/prompt.mjs';
import { recallMessages } from '../lib/memory.mjs';
import { DevBridge } from '../lib/dev.mjs';
import { setLang } from '../lib/i18n.mjs';

function fixture() {
  const messages = [
    {id:1,from:'user',text:'일반 수업 이야기',ts:1},
    {id:2,from:'dev',text:'DEV-SECRET 수업 설정',ts:2},
    {id:3,from:'user',text:'@개발자 OWNER-SECRET 수업 설정',ts:3},
    {id:4,from:'user',text:'REPLY-SECRET',replyTo:2,ts:4},
    {id:5,from:'gpt',text:'INDIRECT-SECRET',replyTo:4,ts:5},
    {id:6,from:'system',kind:'dev',text:'PRESENCE-SECRET',ts:6},
    {id:7,from:'user',text:'일반 수업 이야기 이어가자',ts:7},
  ];
  return { messages, byId:new Map(messages.map(m=>[m.id,m])), lastId:7,
    readNote:()=>'', readContext:()=>({text:'OLD-SUMMARY-SECRET',through:7}),
    recent:n=>messages.slice(-n), after:id=>messages.filter(m=>m.id>id), lastMessage:()=>messages.at(-1) };
}
test('developer messages, owner tags, presence and reply chains stay outside AI history and recall', () => {
  const store = fixture(), view = memberStore(store);
  assert.deepEqual(view.messages.map(m=>m.id),[1,7]);
  assert.equal(store.messages.length,7);
  assert.equal(view.byId.has(2),false);
  assert.equal(view.readContext('gpt').text,'');
  assert.ok(recallMessages(store,[store.messages.at(-1)]).every(m=>!m.text.includes('SECRET')));
  const turn = buildTurn('gpt',{store,cfg:{chatOnly:true,historyForPrompt:40},agent:{seen:0},reason:'new'});
  assert.doesNotMatch(turn,/SECRET/);
  assert.match(turn,/일반 수업 이야기/);
  store.messages.push({id:8,from:'user',text:'@dev new hidden',ts:8});
  assert.deepEqual(memberStore(store).after(7),[]);
});
test('AI cannot post a developer call, reply to hidden messages or react to them', () => {
  const store=fixture();
  const filtered=memberAction({action:'say',messages:['일반 답변','@개발자 봐줘','@Developer please'],react:{id:2,emoji:'👍'}},store);
  assert.deepEqual(filtered.messages,['일반 답변']);
  assert.equal(filtered.react,undefined);
  assert.equal(memberAction({action:'say',messages:['leak'],reply_to:4},store).action,'pass');
  assert.equal(tagsDeveloper('device developer 직업 이야기'),false);
  for(const value of ['@개발자야','@DEV','@developer','@開発者']) assert.equal(tagsDeveloper(value),true);
  assert.equal(tagsDeveloper('@device'),false);
});
test('AI messages cannot wake mention-only developer waiters', () => {
  const bridge={ctx:{store:fixture()}};
  const wakes=(m)=>DevBridge.prototype.wakes.call(bridge,{since:0,mentionOnly:true},m);
  assert.equal(wakes({id:8,from:'gpt',text:'@개발자',replyTo:2}),false);
  assert.equal(wakes({id:9,from:'user',text:'@개발자'}),true);
  assert.equal(wakes({id:10,from:'user',text:'답장',replyTo:2}),true);
});
test('all language briefs omit the developer roster and invocation instructions',()=>{
  for(const language of ['ko','en','ja']) {
    setLang(language);
    const brief=buildBrief('gpt',{agents:{},chatOnly:true,userName:'Owner',roomName:'Chat'});
    assert.doesNotMatch(brief,/@(?:개발자|Dev|開発者)/);
    assert.doesNotMatch(brief,/the development session|개발 세션|開発セッション/);
  }
});
