// Minimal, zero-dependency Markdown → HTML for emails. Covers the constructs we
// actually use: headings, bold/italic/code, blockquotes, hr, unordered lists,
// pipe tables, and paragraphs. Not a full CommonMark implementation.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Inline formatting on already-escaped text.
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function tableRow(line) {
  // "| a | b |" → ["a","b"]
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}
const isTableSep = (line) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');

export function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }

    // Blockquote (consecutive `>` lines)
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`); i++;
      }
      out.push('</ul>');
      continue;
    }

    // Pipe table
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = tableRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(tableRow(lines[i])); i++; }
      const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
      const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }

    // Paragraph (consecutive plain lines)
    const buf = [];
    while (
      i < lines.length && !/^\s*$/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }

  return out.join('\n');
}

// Wrap body HTML in an email-friendly document with light styling.
export function wrapHtml(bodyHtml, footerHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9">
<div style="max-width:680px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a">
<style>
  h1{font-size:22px;margin:18px 0 8px} h2{font-size:18px;margin:20px 0 6px;border-bottom:1px solid #eee;padding-bottom:4px}
  h3{font-size:15px;margin:16px 0 4px} p{margin:8px 0} ul{margin:8px 0 8px 20px;padding:0} li{margin:3px 0}
  blockquote{margin:10px 0;padding:8px 12px;border-left:3px solid #d0d0d0;background:#fafafa;color:#555}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
  th,td{border:1px solid #e2e2e2;padding:6px 10px;text-align:left;vertical-align:top}
  th{background:#f2f3f5} hr{border:none;border-top:1px solid #e2e2e2;margin:16px 0}
  code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:90%}
</style>
${bodyHtml}
${footerHtml || ''}
</div></body></html>`;
}
