const storageKey = 'chatroom-appearance';
const defaults = { font: 'system', size: 15 };
const sizes = [8, 10, 12, 13, 14, 15, 16, 18, 20];
// On Android, the browser's generic family can honor the user's chosen face;
// system-ui may resolve to the platform's fixed UI face instead.
const systemFont = /Android/i.test(navigator.userAgent)
  ? 'sans-serif'
  : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
function normalize(value) {
  return { font: value?.font === 'pretendard' ? 'pretendard' : 'system', size: sizes.includes(Number(value?.size)) ? Number(value.size) : 15 };
}
function read() {
  try { return normalize(JSON.parse(localStorage.getItem(storageKey))); } catch { return { ...defaults }; }
}
let prefs = read();
const sizeControl = document.getElementById('displaySize');
if (sizeControl) for (const size of [10, 8]) {
  if (![...sizeControl.options].some(option => option.value === String(size))) sizeControl.prepend(new Option(`${size}px`, String(size)));
}
function apply() {
  const style = document.documentElement.style;
  if (prefs.font === 'system') style.setProperty('--font', systemFont);
  else style.removeProperty('--font');
  style.setProperty('--chat-font-size', `${prefs.size}px`);
  const font = document.getElementById('displayFont'), size = document.getElementById('displaySize');
  if (font) font.value = prefs.font;
  if (size) size.value = String(prefs.size);
}
for (const id of ['displayFont', 'displaySize']) {
  document.getElementById(id)?.addEventListener('change', () => {
    prefs = normalize({ font: document.getElementById('displayFont')?.value, size: document.getElementById('displaySize')?.value });
    apply();
    try { localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch { /* Still works for this page when storage is disabled. */ }
  });
}
window.addEventListener('storage', event => { if (event.key === storageKey) { prefs = read(); apply(); } });
apply();
