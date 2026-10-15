import { DEV } from './members.mjs';

export function tagsDeveloper(text) {
  const lower = String(text || '').toLowerCase();
  return DEV.aliases.some(alias => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('@\\s*' + escaped + (/^[a-z ]+$/.test(alias) ? '(?![a-z0-9_])' : ''), 'i').test(lower);
  });
}
const cache = new WeakMap();
const views = new WeakSet();
// Read-only projection: the owner/dev retain the complete original conversation.
export function memberStore(store) {
  if (views.has(store)) return store;
  const all = store.messages || [];
  const stamp = all.at(-1)?.id || 0;
  const cached = cache.get(store);
  if (cached?.stamp === stamp && cached.count === all.length) return cached.view;
  const source = new Map(all.map(m => [m.id, m]));
  const hidden = new Map();
  function excluded(m, visiting = new Set()) {
    if (!m) return false;
    if (hidden.has(m.id)) return hidden.get(m.id);
    if (visiting.has(m.id)) return true;
    visiting.add(m.id);
    const value = m.channel === 'developer' || m.from === 'dev' || m.by === 'dev' || m.kind === 'dev' || tagsDeveloper(m.text) || excluded(source.get(m.replyTo), visiting);
    hidden.set(m.id, value);
    return value;
  }
  const messages = all.filter(m => !excluded(m));
  const view = Object.create(store);
  Object.defineProperties(view, {
    messages: { value: messages },
    byId: { value: new Map(messages.map(m => [m.id, m])) },
    lastId: { get: () => messages.at(-1)?.id || 0 },
  });
  view.recent = n => messages.slice(-n);
  view.after = id => messages.filter(m => m.id > id);
  view.lastMessage = () => messages.at(-1);
  view.readContext = id => {
    const saved = store.readContext?.(id);
    return saved?.visibility === 'members' ? saved : { text: '', through: 0 };
  };
  views.add(view); cache.set(store, { stamp, count: all.length, view });
  return view;
}

export function memberAction(action, store) {
  if (!action) return action;
  const visible = memberStore(store).byId;
  if (action.reply_to && !visible.has(Number(action.reply_to))) return { action: 'pass', messages: [] };
  const result = { ...action };
  const messages = Array.isArray(action.messages) ? action.messages : typeof action.messages === 'string' ? [action.messages] : [];
  result.messages = messages.filter(text => !tagsDeveloper(text));
  if (action.react && !visible.has(Number(action.react.id))) delete result.react;
  return result;
}

export function developerMessages(store) {
  const visible = memberStore(store).byId;
  return store.messages.filter(m => !visible.has(m.id) && ['user', 'dev', 'system'].includes(m.from));
}
