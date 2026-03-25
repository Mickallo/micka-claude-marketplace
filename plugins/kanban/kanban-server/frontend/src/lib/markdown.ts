const RE_CODE_BLOCK = /```[\s\S]*?```/g;
const RE_CODE_OPEN = /```\w*\n?/;
const RE_CODE_CLOSE = /```$/;
const RE_BOLD = /\*\*(.+?)\*\*/g;
const RE_INLINE_CODE = /`([^`]+)`/g;
const RE_CB_PLACEHOLDER = /^\x00CB(\d+)\x00$/;
const RE_H3 = /^### (.+)$/;
const RE_H2 = /^## (.+)$/;
const RE_H1 = /^# (.+)$/;
const RE_UL = /^[-*]\s+(.+)$/;
const RE_OL = /^\d+\.\s+(.+)$/;
const RE_TABLE_ROW = /^\|(.+)\|$/;
const RE_TABLE_SEP = /^\|[\s:-]+\|$/;

export function md(text: string): string {
  const codeBlocks: string[] = [];
  let s = text.replace(RE_CODE_BLOCK, (match) => {
    codeBlocks.push(`<pre><code>${match.replace(RE_CODE_OPEN, "").replace(RE_CODE_CLOSE, "")}</code></pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });
  s = s.replace(RE_BOLD, "<strong>$1</strong>").replace(RE_INLINE_CODE, "<code>$1</code>");

  const lines = s.split("\n"), out: string[] = [];
  let inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { out.push("</ul>"); inUl = false; } if (inOl) { out.push("</ol>"); inOl = false; } };

  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    const cb = t.match(RE_CB_PLACEHOLDER);
    if (cb) { closeLists(); out.push(codeBlocks[parseInt(cb[1])]); i++; continue; }
    if (RE_TABLE_ROW.test(t)) {
      closeLists();
      const rows: string[] = [];
      while (i < lines.length && RE_TABLE_ROW.test(lines[i].trim())) { rows.push(lines[i].trim()); i++; }
      if (rows.length >= 2) {
        const hasSep = RE_TABLE_SEP.test(rows[1]);
        let h = '<table class="md-table">';
        if (hasSep) { const cells = rows[0].slice(1, -1).split("|").map(c => c.trim()); h += "<thead><tr>" + cells.map(c => `<th>${c}</th>`).join("") + "</tr></thead>"; }
        h += "<tbody>";
        for (let r = hasSep ? 2 : 0; r < rows.length; r++) { if (RE_TABLE_SEP.test(rows[r])) continue; const cells = rows[r].slice(1, -1).split("|").map(c => c.trim()); h += "<tr>" + cells.map(c => `<td>${c}</td>`).join("") + "</tr>"; }
        h += "</tbody></table>"; out.push(h);
      } else { out.push(`<p>${rows[0]}</p>`); }
      continue;
    }
    const h3 = t.match(RE_H3); if (h3) { closeLists(); out.push(`<h3>${h3[1]}</h3>`); i++; continue; }
    const h2 = t.match(RE_H2); if (h2) { closeLists(); out.push(`<h2>${h2[1]}</h2>`); i++; continue; }
    const h1 = t.match(RE_H1); if (h1) { closeLists(); out.push(`<h1>${h1[1]}</h1>`); i++; continue; }
    const ul = t.match(RE_UL); if (ul) { if (inOl) { out.push("</ol>"); inOl = false; } if (!inUl) { out.push("<ul>"); inUl = true; } out.push(`<li>${ul[1]}</li>`); i++; continue; }
    const ol = t.match(RE_OL); if (ol) { if (inUl) { out.push("</ul>"); inUl = false; } if (!inOl) { out.push("<ol>"); inOl = true; } out.push(`<li>${ol[1]}</li>`); i++; continue; }
    closeLists();
    out.push(t === "" ? "" : `<p>${t}</p>`);
    i++;
  }
  closeLists();
  return out.join("\n");
}
