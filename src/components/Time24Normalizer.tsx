import { useEffect } from 'react';
import { to24Hour } from '@/lib/productLabel';

// Shows every date-and-time stamp on the 24-hour (railway) clock, on every page: "15-10-2026 12:33 PM" reads
// "15-10-2026 12:33". Product names carry the sale date/time they were saved with, and older ones were saved with
// AM/PM, so the stored text is left alone and only what is displayed is changed. Only a time that follows a date is
// touched, so times typed inside notes or messages are never rewritten.

const STAMP = /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M/gi;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'NOSCRIPT']);

function fix(node: Node) {
  if (node.nodeType === 3) {
    const t = node.nodeValue;
    if (t && /[AP]M/i.test(t) && STAMP.test(t)) {
      STAMP.lastIndex = 0;
      const next = t.replace(STAMP, (m) => to24Hour(m.replace(/,/, '')));
      if (next !== t) node.nodeValue = next;
    }
    STAMP.lastIndex = 0;
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as HTMLElement;
  if (SKIP.has(el.tagName) || el.isContentEditable || el.closest?.('[data-keep-12h]')) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (p && !SKIP.has(p.tagName) && !p.isContentEditable) texts.push(n);
  }
  texts.forEach(fix);
}

export function Time24Normalizer() {
  useEffect(() => {
    let queued = false;
    const pending = new Set<Node>();
    const flush = () => { queued = false; const todo = [...pending]; pending.clear(); todo.forEach((n) => { if (n.isConnected) fix(n); }); };
    const schedule = (n: Node) => { pending.add(n); if (!queued) { queued = true; window.setTimeout(flush, 30); } };
    fix(document.body);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') schedule(m.target);
        else m.addedNodes.forEach((n) => schedule(n));
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
