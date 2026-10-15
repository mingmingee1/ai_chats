export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plain(text, mentionHit) {
  return text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, index) => {
    if (index % 2) {
      const url = part.replace(/[.,!?;)\]]+$/, '');
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(part.slice(url.length))}`;
    }
    let html = escapeHtml(part).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    if (mentionHit) html = html.replace(/@([\p{L}\p{N}_]+)/gu, (match, word) => {
      const hit = mentionHit(word);
      return hit ? `<span class="mention" style="--c:${escapeHtml(hit.color)}">@${word.slice(0, hit.len)}</span>${word.slice(hit.len)}` : match;
    });
    return html.replace(/\n/g, '<br>');
  }).join('');
}

// Tokenize code before math: backslashes, dollars, HTML and mentions in code are
// always literal. A missing renderer or invalid formula leaves readable source.
export function renderChatText(value, { mentionHit, katex = globalThis.katex, copyLabel = 'Copy code' } = {}) {
  const text = String(value).replace(/\r\n/g, '\n');
  const token = /^```([\w+#.\-]*)[ \t]*\n([\s\S]*?)(?:^```[ \t]*(?=\n|$)|$)|`([^`\n]+)`|(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|(?<![\\$])\$(?![\s$])([^\n$]+?)(?<![\\\s])\$(?!\d)/gm;
  let html = '', at = 0;
  for (const match of text.matchAll(token)) {
    html += plain(text.slice(at, match.index), mentionHit);
    if (match[2] !== undefined) {
      const code = match[2].replace(/\n$/, '');
      html += `<div class="code-block"><div class="code-head"><span>${escapeHtml(match[1] || 'code')}</span><button type="button" data-copy-code>${escapeHtml(copyLabel)}</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`;
    } else if (match[3] !== undefined) {
      html += `<code>${escapeHtml(match[3])}</code>`;
    } else {
      const tex = match[4] ?? match[5] ?? match[6] ?? match[7];
      const displayMode = match[4] !== undefined || match[5] !== undefined;
      // Avoid turning ordinary prices such as "$10 and $20" into a formula.
      if (match[7] && (/^\d[\d,.]*(?:\s|$)/.test(tex))) {
        html += plain(match[0], mentionHit);
      } else {
        let rendered = escapeHtml(match[0]);
        try {
          if (katex) rendered = katex.renderToString(tex, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 20, output: 'htmlAndMathml' });
        } catch { /* Keep the source visible; one bad formula must not break chat. */ }
        html += `<${displayMode ? 'div' : 'span'} class="chat-math${displayMode ? ' display-math' : ''}">${rendered}</${displayMode ? 'div' : 'span'}>`;
      }
    }
    at = match.index + match[0].length;
  }
  return html + plain(text.slice(at), mentionHit);
}
