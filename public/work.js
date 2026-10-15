import { renderChatText, escapeHtml as esc } from '/rich-text.mjs';
import '/appearance.mjs?v=3';
const $ = (id) => document.getElementById(id);
const names = { user: '나', claude: 'Claude', gpt: 'ChatGPT', muse: 'Muse', gemini: 'Gemini', system: '알림' };
const statusNames = { waiting: '대기', thinking: '생각 중', done: '완료', passed: '추가 의견 없음', error: '응답 실패', idle: '' };
const S = { projects: [], id: null, state: null, selected: new Set(), sending: false, epoch: 0, poll: null, messageKey: '', listKey: '', membersKey: '' };
async function api(route, body) {
  const response = await fetch('/api/work/projects' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 404 && !route) throw Error('서버를 다시 실행한 뒤 이 탭을 새로고침해 주세요.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했어요.');
  return data;
}
function error(message = '') { $('workError').textContent = message; $('workError').hidden = !message; }
function date(ts) { return new Date(ts).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function renderList() {
  const projects = S.projects.filter(p => $('showArchived').checked ? p.archived : !p.archived).sort((a,b) => b.updatedAt - a.updatedAt);
  const html = projects.map(p => `<button type="button" data-project="${esc(p.id)}" class="${p.id === S.id ? 'selected' : ''}" ${p.id === S.id ? 'aria-current="true"' : ''}><span class="project-card-title">${esc(p.name)}</span><span class="project-card-meta">${p.archived ? '삭제됨 · 복구 가능' : p.busy ? '답변 진행 중' : date(p.updatedAt)}</span></button>`).join('') || '<p class="work-hint">프로젝트가 없어요.</p>';
  if (html !== S.listKey) { $('projectList').innerHTML = html; S.listKey = html; }
}
function controls() {
  const st = S.state;
  if (!st) return;
  const blocked = st.busy || st.project.archived || S.sending;
  $('sendWork').disabled = blocked || !S.selected.size;
  $('workInput').disabled = st.project.archived;
  $('workMode').disabled = blocked;
  $('archiveProject').disabled = st.busy || S.sending;
  $('archiveProject').textContent = st.project.archived ? '프로젝트 복구' : '프로젝트 삭제';
  const mode = $('workMode').value;
  $('sendWork').textContent = mode === 'summary' ? '정리 요청' : mode === 'review' ? '검토 요청' : '의견 받기';
  $('modeHint').textContent = mode === 'summary' ? '정리할 멤버 한 명을 선택하세요. 합의·미결정 사항·다음 일을 정리해 맥락으로 남겨요.' : mode === 'review' ? '선택한 멤버가 앞선 의견을 순서대로 읽고 차이와 빈틈을 보완해요.' : '선택한 멤버가 같은 요청을 보고 각자 의견을 내요.';
  $('workStatus').textContent = st.project.archived ? '복구하면 대화를 이어갈 수 있어요.' : S.sending ? '보내는 중…' : st.busy ? st.members.filter(m => ['thinking','waiting'].includes(m.status)).map(m => `${m.name} ${statusNames[m.status]}`).join(' · ') : 'Enter로 전송 · Shift+Enter로 줄바꿈';
  const memberHtml = st.members.map(m => `<label><input type="checkbox" value="${esc(m.id)}" ${S.selected.has(m.id) ? 'checked' : ''} ${!m.available || blocked ? 'disabled' : ''}>${esc(m.name)}${!m.available ? ' (연결 없음)' : ''}</label>`).join('');
  if (memberHtml !== S.membersKey) { $('workMembers').innerHTML = '<legend>참여할 멤버</legend>' + memberHtml; S.membersKey = memberHtml; }
}
function renderMessages(force = false) {
  const messages = S.state?.messages || [];
  const key = JSON.stringify(messages);
  if (!force && key === S.messageKey) return;
  const box = $('workMessages');
  const stick = !S.messageKey || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const top = box.scrollTop;
  box.innerHTML = messages.map(m => `<article class="work-message ${m.from === 'user' ? 'user' : m.from === 'system' ? 'system' : ''}">${['claude','gpt','muse','gemini'].includes(m.from) ? `<img src="/avatars/${m.from}-128.webp" alt="">` : ''}<div><header><strong>${esc(names[m.from] || m.from)}</strong>${date(m.ts)}</header><div class="message-body">${renderChatText(m.text || '', { copyLabel: '코드 복사' })}</div></div></article>`).join('') || '<p class="work-hint">아직 대화가 없어요. 목표를 공유하고 첫 의견을 받아 보세요.</p>';
  box.scrollTop = stick ? box.scrollHeight : top;
  S.messageKey = key;
  if (S.state?.userAvatar) {
    for (const message of box.querySelectorAll('.work-message.user')) {
      const picture = document.createElement('img');
      picture.src = S.state.userAvatar; picture.alt = '';
      picture.onerror = () => picture.remove();
      message.prepend(picture);
    }
  }
}
function renderState(fill = false) {
  const st = S.state;
  if (!st) return;
  $('emptyProject').hidden = true; $('projectView').hidden = false;
  $('projectTitle').textContent = st.project.name;
  if (fill) {
    $('projectName').value = st.project.name; $('projectGoal').value = st.project.goal;
    $('projectDecisions').value = st.project.decisions; $('projectNext').value = st.project.nextSteps;
    $('briefStatus').textContent = ''; $('projectBrief').open = !st.project.goal;
  }
  $('projectContext').textContent = st.summary.text || '정리 단계에서 논의의 흐름을 남길 수 있어요.';
  $('contextDate').textContent = st.summary.updatedAt ? `AI 요약 · ${date(st.summary.updatedAt)} · #${st.summary.through}까지` : '';
  renderMessages(); controls();
}
async function selectProject(id) {
  const epoch = ++S.epoch;
  clearTimeout(S.poll); error();
  try {
    const state = await api(`/${id}/state`);
    if (epoch !== S.epoch) return;
    S.id = id; S.state = state; S.messageKey = ''; S.membersKey = '';
    S.selected = new Set(state.members.filter(m => m.available).map(m => m.id));
    if ($('workMode').value === 'summary') S.selected = new Set([...S.selected].slice(0,1));
    $('workInput').value = '';
    try { localStorage.setItem('workProject', id); } catch {}
    renderState(true); renderList();
  } catch (e) { if (epoch === S.epoch) error(e.message); }
  finally { if (epoch === S.epoch) schedule(); }
}
function schedule() { clearTimeout(S.poll); S.poll = setTimeout(refresh, S.state?.busy ? 1500 : 5000); }
async function refresh() {
  const epoch = S.epoch, id = S.id;
  try {
    const [list, state] = await Promise.all([api(''), id ? api(`/${id}/state`) : null]);
    if (epoch !== S.epoch) return;
    S.projects = list.projects;
    if (state) { S.state = state; renderState(); }
    renderList();
  } catch (e) { if (epoch === S.epoch) error(e.message); }
  finally { if (epoch === S.epoch) schedule(); }
}
function openCreate() { $('createError').textContent = ''; $('createForm').reset(); $('createDialog').showModal(); $('newName').focus(); }
$('createProject').onclick = openCreate; $('createFirst').onclick = openCreate;
$('cancelCreate').onclick = () => $('createDialog').close();
$('createForm').onsubmit = async (event) => {
  event.preventDefault(); $('confirmCreate').disabled = true;
  try {
    const { project } = await api('', { name: $('newName').value, goal: $('newGoal').value });
    S.projects.push(project); $('showArchived').checked = false; $('createDialog').close();
    await selectProject(project.id);
  } catch (e) { $('createError').textContent = e.message; }
  finally { $('confirmCreate').disabled = false; }
};
$('projectList').onclick = (event) => { const button = event.target.closest('[data-project]'); if (button && button.dataset.project !== S.id) selectProject(button.dataset.project); };
$('showArchived').onchange = renderList;
$('briefForm').oninput = () => { $('briefStatus').textContent = '저장하지 않은 변경'; };
$('briefForm').onsubmit = async (event) => {
  event.preventDefault(); const id = S.id; $('saveBrief').disabled = true; error();
  try {
    const { project } = await api(`/${id}`, { name: $('projectName').value, goal: $('projectGoal').value, decisions: $('projectDecisions').value, nextSteps: $('projectNext').value });
    S.projects = S.projects.map(p => p.id === id ? project : p);
    if (S.id === id) { S.state.project = project; renderState(); $('briefStatus').textContent = '저장됨'; }
    renderList();
  } catch(e) { error(e.message); }
  finally { $('saveBrief').disabled = false; }
};
$('archiveProject').onclick = async () => {
  const id = S.id, archived = !S.state.project.archived;
  if (archived && !confirm('프로젝트를 삭제할까요? 대화는 보관되며 나중에 복구할 수 있어요.')) return;
  try { await api(`/${id}`, { archived }); $('showArchived').checked = archived; await refresh(); }
  catch(e) { error(e.message); }
};
$('workMembers').onchange = (event) => {
  if (!event.target.matches('input')) return;
  const id = event.target.value;
  if (event.target.checked) { if ($('workMode').value === 'summary') S.selected.clear(); S.selected.add(id); } else S.selected.delete(id);
  controls();
};
$('workMode').onchange = () => { if ($('workMode').value === 'summary') S.selected = new Set([...S.selected].slice(0,1)); controls(); };
$('workComposer').onsubmit = async (event) => {
  event.preventDefault();
  if (!S.state || S.sending || S.state.busy || S.state.project.archived) return;
  const id = S.id, mode = $('workMode').value;
  const text = $('workInput').value.trim() || (mode === 'summary' ? '지금까지의 논의를 정리하고 결정된 것, 미결정 사항과 다음 할 일을 구분해 줘.' : '');
  if (!text) { $('workInput').focus(); return; }
  S.sending = true; controls(); error();
  try {
    await api(`/${id}/send`, { text, mode, members: [...S.selected] });
    if (S.id === id) { $('workInput').value = ''; S.state.busy = true; await refresh(); }
  } catch(e) { error(e.message); }
  finally { S.sending = false; controls(); }
};
$('workInput').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('workComposer').requestSubmit(); } };
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy-code]'); if (!button) return;
  const code = button.closest('.code-block').querySelector('code');
  try { await navigator.clipboard.writeText(code.textContent); button.textContent = '복사됨'; setTimeout(() => { button.textContent = '코드 복사'; },1500); }
  catch { const range = document.createRange(); range.selectNodeContents(code); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
});
$('katexScript').addEventListener('load', () => renderMessages(true));
try {
  S.projects = (await api('')).projects; renderList();
  let saved; try { saved = localStorage.getItem('workProject'); } catch {}
  const project = S.projects.find(p => p.id === saved && !p.archived) || S.projects.find(p => !p.archived);
  if (project) await selectProject(project.id); else schedule();
} catch(e) { error(e.message); schedule(); }
