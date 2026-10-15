import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChatText } from '../public/rich-text.mjs';

test('code preserves HTML, math and mentions literally and keeps its language', () => {
  const html = renderChatText('```html\n<div>$x$ @Muse</div>\n```', {
    katex: { renderToString() { throw Error('Code must not render math'); } },
  });
  assert.match(html, /<span>html<\/span>/);
  assert.match(html, /<code>&lt;div&gt;\$x\$ @Muse&lt;\/div&gt;<\/code>/);
  assert.match(html, /data-copy-code/);
  assert.doesNotMatch(html, /<div>\$x\$/);
});

test('math delimiters work across lines and inline code stays literal', () => {
  const calls = [];
  const katex = { renderToString(tex, options) { calls.push({ tex, options }); return '<span class="katex">math</span>'; } };
  const html = renderChatText('`$code$` $x^2$ $$\\frac{a}{b}\n+ c$$ \\(y\\) \\[z\\]', { katex });
  assert.match(html, /<code>\$code\$<\/code>/);
  assert.deepEqual(calls.map((c) => [c.tex, c.options.displayMode]), [['x^2', false], ['\\frac{a}{b}\n+ c', true], ['y', false], ['z', true]]);
  assert.ok(calls.every((c) => c.options.trust === false && c.options.maxExpand <= 1000));
});

test('invalid or unavailable math keeps safe source and ordinary prices remain text', () => {
  const katex = { renderToString() { throw Error('Invalid expression'); } };
  assert.match(renderChatText('$<script>$', { katex }), /&lt;script&gt;/);
  assert.match(renderChatText('$$x^2$$', { katex: null }), /\$\$x\^2\$\$/);
  assert.equal(renderChatText('It costs $10 and $20.', { katex }), 'It costs $10 and $20.');
  assert.doesNotMatch(renderChatText('<img src=x onerror=alert(1)>'), /<img/);
});

test('links and mentions do not corrupt code or escaped HTML', () => {
  const mentionHit = () => ({ len: 4, color: '#123456' });
  const html = renderChatText('@Muse `@Muse https://example.com` https://example.com?q=a&b=c', { mentionHit });
  assert.equal((html.match(/class="mention"/g) || []).length, 1);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /href="https:\/\/example.com\?q=a&amp;b=c"/);
});
