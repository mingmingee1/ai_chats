import '/appearance.mjs?v=3';
import { renderChatText, escapeHtml as esc } from '/rich-text.mjs';
const $ = id => document.getElementById(id);
const messages = new Map();
let snapshot = '', replyTo = null, sending = false, pendingImage = null, timer;
async function api(body, before) {
  const response = await fetch('/api/conversations/developer' + (before ? `?before=${before}` : ''), body === undefined ? { signal: AbortSignal.timeout(10000) } : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if (response.status === 404) throw Error('서버를 다시 실행한 뒤 이 탭을 새로고침해 주세요.');
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '요청을 처리하지 못했어요.');
  return value;
}
function error(text = '') { $('devError').textContent = text; $('devError').hidden = !text; }
function render(state, older = false) {
  for (const m of state.messages) messages.set(m.id, m);
  $('devStatus').textContent = state.online ? '개발자 연결됨' : '개발자 연결 대기 · 요청은 저장돼요';
  $('devStatus').classList.toggle('online', state.online);
  const list = [...messages.values()].sort((a,b) => a.id-b.id), key = JSON.stringify(list);
  if (key === snapshot) return;
  const box=$('devMessages'), top=box.scrollTop, height=box.scrollHeight;
  const bottom=!snapshot || height-top-box.clientHeight<80;
  box.innerHTML = list.map(m => {
    const name=m.from==='dev'?'개발자':m.from==='user'?state.userName:'알림';
    const avatar=m.from==='dev'?'/avatars/dev.svg':m.from==='user'?state.userAvatar:null;
    const attachment=m.attach?.path ? `<img class="dev-attachment" src="/ws/${m.attach.path.split('/').map(encodeURIComponent).join('/')}" alt="첨부 사진">` : '';
    return `<article class="work-message ${m.from==='user'?'user':m.from==='system'?'system':''}">${avatar?`<img src="${esc(avatar)}" alt="">`:''}<div><header><strong>${esc(name)}</strong>${new Date(m.ts).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}${m.from!=='system'?`<button type="button" class="reply-dev" data-reply="${m.id}">답장</button>`:''}</header><div class="message-body">${renderChatText(m.text || '',{copyLabel:'코드 복사'})}${attachment}</div></div></article>`;
  }).join('') || '<p class="work-hint">개발자에게 첫 요청을 남겨 보세요.</p>';
  box.scrollTop = older ? top + box.scrollHeight-height : bottom ? box.scrollHeight : top;
  snapshot=key;
}
async function refresh() {
  try { render(await api()); error(); } catch(e) { error(e.message); }
  finally { clearTimeout(timer); timer=setTimeout(refresh,2000); }
}
$('olderDev').onclick=async()=>{
  $('olderDev').disabled=true;
  try { const state=await api(undefined,Math.min(...messages.keys())); render(state,true); if(!state.messages.length)$('olderDev').hidden=true; }
  catch(e){error(e.message);} finally{$('olderDev').disabled=false;}
};
function clearReply(){replyTo=null;$('devReply').hidden=true;}
$('clearDevReply').onclick=clearReply;
$('devMessages').onclick=async event=>{
  const reply=event.target.closest('[data-reply]');
  if(reply){replyTo=Number(reply.dataset.reply);$('devReply').querySelector('span').textContent=messages.get(replyTo)?.text?.slice(0,100)||'첨부 사진에 답장';$('devReply').hidden=false;$('devInput').focus();}
  const button=event.target.closest('[data-copy-code]');
  if(button){const code=button.closest('.code-block').querySelector('code');try{await navigator.clipboard.writeText(code.textContent);button.textContent='복사됨';}catch{const range=document.createRange();range.selectNodeContents(code);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}}
};
$('devUpload').onchange=async()=>{
  const file=$('devUpload').files[0]; pendingImage=null; $('devFileName').textContent='';
  if(!file)return;
  if(file.size>8*1024*1024){error('사진은 8MB 이하로 선택해 주세요.');$('devUpload').value='';return;}
  $('sendDev').disabled=true;
  try { const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('사진을 읽지 못했어요.'));r.readAsDataURL(file);});pendingImage={name:file.name,data};$('devFileName').textContent=file.name;error();}
  catch(e){error(e.message);} finally{$('sendDev').disabled=false;}
};
$('devComposer').onsubmit=async event=>{
  event.preventDefault();if(sending)return;
  const text=$('devInput').value.trim();if(!text&&!pendingImage)return;
  sending=true;$('sendDev').disabled=true;error();
  try {await api({text,replyTo,image:pendingImage});$('devInput').value='';$('devUpload').value='';$('devFileName').textContent='';pendingImage=null;clearReply();await refresh();}
  catch(e){error(e.message);}finally{sending=false;$('sendDev').disabled=false;}
};
$('devInput').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('devComposer').requestSubmit();}};
refresh();
