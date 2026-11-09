/**
 * A tiny Markdown reader for the app's own texts (the "What to test" steps, docs/TEST-NOW.md):
 * headings (#, ##, ###), paragraphs, numbered and bulleted lists (one level of nesting, by
 * indentation), **bold**, *italic*, `code` and [links](…). Builds Preact elements (no HTML
 * strings), so nothing in the text can run as code.
 */
import type { ComponentChildren, VNode } from 'preact';
import type { MdBlock } from './markdown';

export { parseMd, type MdBlock, type MdItem } from './markdown';

/** Inline formatting: **bold**, *italic*, `code`, [text](href). */
export function inlineMd(text: string, key = 'i'): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*\s][^*]*?)\*)|(_([^_\s][^_]*?)_)/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const id = `${key}-${k++}`;
    if (m[2] !== undefined) out.push(<strong key={id}>{inlineMd(m[2], id)}</strong>);
    else if (m[4] !== undefined) out.push(<code key={id}>{m[4]}</code>);
    else if (m[6] !== undefined) {
      const href = m[7]!;
      // Only the app's own screens (#/…) and web pages open; anything else stays plain text.
      if (href.startsWith('#/') || href.startsWith('https://'))
        out.push(
          <a key={id} href={href} target={href.startsWith('https://') ? '_blank' : undefined} rel="noreferrer">
            {m[6]}
          </a>,
        );
      else out.push(m[6]);
    } else if (m[9] !== undefined) out.push(<em key={id}>{inlineMd(m[9], id)}</em>);
    else if (m[11] !== undefined) out.push(<em key={id}>{inlineMd(m[11], id)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders blocks; `item` may wrap each top-level list item (e.g. to add a tick box). */
export function renderMd(blocks: MdBlock[], item?: (content: VNode, blockIndex: number, itemIndex: number) => VNode): VNode[] {
  return blocks.map((b, bi) => {
    if (b.kind === 'h') {
      const Tag = b.level === 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4';
      return <Tag key={bi}>{inlineMd(b.text, `h${bi}`)}</Tag>;
    }
    if (b.kind === 'p') return <p key={bi}>{inlineMd(b.text, `p${bi}`)}</p>;
    const List = b.kind;
    return (
      <List key={bi} start={b.kind === 'ol' ? b.start : undefined} class="md-list">
        {b.items.map((it, ii) => {
          const Sub = it.sub?.kind ?? 'ul';
          const content = (
            <span>
              {inlineMd(it.text, `l${bi}-${ii}`)}
              {it.sub && (
                <Sub start={Sub === 'ol' ? it.sub.start : undefined}>
                  {it.sub.items.map((s, si) => (
                    <li key={si}>{inlineMd(s, `s${bi}-${ii}-${si}`)}</li>
                  ))}
                </Sub>
              )}
            </span>
          );
          return <li key={ii}>{item ? item(content, bi, ii) : content}</li>;
        })}
      </List>
    );
  });
}
