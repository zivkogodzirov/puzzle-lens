/**
 * A tiny Markdown reader for the app's own texts (the "What to test" steps, docs/TEST-NOW.md):
 * headings (#, ##, ###), paragraphs, numbered and bulleted lists (one level of nesting, by
 * indentation). Inline formatting and drawing are in miniMarkdown.tsx (Preact elements, no HTML
 * strings, so nothing in the text can run as code).
 */
export type MdBlock = { kind: 'h'; level: 1 | 2 | 3; text: string } | { kind: 'p'; text: string } | { kind: 'ol' | 'ul'; items: MdItem[]; start: number };

export interface MdItem {
  text: string;
  sub: { kind: 'ol' | 'ul'; items: string[]; start: number } | null;
}

/** Splits Markdown text into blocks. */
export function parseMd(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  let para: string[] = [];
  let list: Extract<MdBlock, { kind: 'ol' | 'ul' }> | null = null;
  const flushPara = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list) out.push(list);
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      // A blank line inside a list keeps the list going (loose lists).
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      out.push({ kind: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
      continue;
    }
    const item = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line) ?? /^(\s*)([-*•])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const indent = item[1]!.replace(/\t/g, '  ').length;
      const kind = /\d/.test(item[2]!) ? 'ol' : 'ul';
      const n = kind === 'ol' ? Number(item[2]) : 1;
      if (indent >= 2 && list && list.items.length) {
        const last = list.items[list.items.length - 1]!;
        last.sub ??= { kind, items: [], start: n };
        last.sub.items.push(item[3]!);
        continue;
      }
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [], start: n };
      }
      list.items.push({ text: item[3]!, sub: null });
      continue;
    }
    // A continuation line of a list item (indented), or a new paragraph.
    if (list && /^\s{2,}\S/.test(raw) && list.items.length) {
      const last = list.items[list.items.length - 1]!;
      if (last.sub) last.sub.items[last.sub.items.length - 1] += ` ${line.trim()}`;
      else last.text += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out;
}
