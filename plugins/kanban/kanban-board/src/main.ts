// ── Types ───────────────────────────────────────────────

interface Block {
  agent: string;
  content: string;
  decision_log: string;
  verdict: "ok" | "nok";
  timestamp: string;
}

interface Task {
  id: number;
  title: string;
  status: string;
  priority: string;
  pipeline: string;
  rank: number;
  description: string | null;
  blocks: string;
  loop_count: number;
  tags: string | null;
  attachments: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface PipelinesFile {
  pipelines: Record<string, { stages: string[] }>;
  default: string;
  max_loops: number;
}

interface BoardResponse {
  columns: Record<string, Task[]>;
  column_order: string[];
  pipeline: string;
  pipelines: string[];
}

// ── State ───────────────────────────────────────────────

let currentPipeline: string = localStorage.getItem('kanban-pipeline') || '';
let currentMaxLoops: number = 3;
let isDragging = false;
let currentView: "board" | "list" = "board";
let currentSearch = '';
let currentSort: string = localStorage.getItem('kanban-sort') || 'default';
let hideOldDone: boolean = localStorage.getItem('kanban-hide-old') === 'true';
let cachedColumnOrder: string[] = [];

// ── Helpers ─────────────────────────────────────────────

function priorityClass(p: string): string {
  return p === "high" || p === "medium" || p === "low" ? p : "";
}

function isOlderThan3Days(d: string): boolean {
  return d ? Date.now() - new Date(d).getTime() > 3 * 86400000 : false;
}

function sortTasks(tasks: Task[]): Task[] {
  if (currentSort === 'default') return tasks;
  return [...tasks].sort((a, b) => {
    if (currentSort === 'created_asc') return a.created_at.localeCompare(b.created_at);
    if (currentSort === 'created_desc') return b.created_at.localeCompare(a.created_at);
    if (currentSort === 'completed_desc') return (b.completed_at || '').localeCompare(a.completed_at || '');
    return 0;
  });
}

function parseTags(tags: string | null): string[] {
  if (!tags || tags === "null") return [];
  try { const p = JSON.parse(tags); return Array.isArray(p) ? p : []; } catch { return []; }
}

function parseJsonArray(raw: string | null): any[] {
  if (!raw || raw === "null") return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

function timeAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr + "Z").getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return dateStr.slice(0, 10);
}

function applySearchFilter() {
  const q = currentSearch.toLowerCase().replace(/^#/, '');
  const anyFilter = q.length > 0 || hideOldDone;

  if (currentView === 'board') {
    document.querySelectorAll<HTMLElement>('.card').forEach(card => {
      const searchOk = !q || (() => {
        const id = card.dataset.id || '';
        const title = card.querySelector('.card-title')?.textContent?.toLowerCase() || '';
        const desc = card.querySelector('.card-desc')?.textContent?.toLowerCase() || '';
        const tags = [...card.querySelectorAll('.tag')].map(t => t.textContent?.toLowerCase() || '').join(' ');
        return id === q || title.includes(q) || desc.includes(q) || tags.includes(q);
      })();
      const doneHidden = hideOldDone && card.dataset.status === 'done' && isOlderThan3Days(card.dataset.completedAt || '');
      card.style.display = (searchOk && !doneHidden) ? '' : 'none';
    });
    document.querySelectorAll<HTMLElement>('.column').forEach(col => {
      const cards = col.querySelectorAll<HTMLElement>('.card');
      const visible = [...cards].filter(c => c.style.display !== 'none').length;
      const countEl = col.querySelector<HTMLElement>('.count');
      if (countEl) countEl.textContent = anyFilter ? `${visible}/${cards.length}` : `${cards.length}`;
    });
  } else {
    document.querySelectorAll<HTMLElement>('#list-view tbody tr').forEach(row => {
      const searchOk = !q || (() => {
        const id = row.dataset.id || '';
        const title = row.querySelector('.col-title')?.textContent?.toLowerCase() || '';
        const tags = [...row.querySelectorAll('.tag')].map(t => t.textContent?.toLowerCase() || '').join(' ');
        return id === q || title.includes(q) || tags.includes(q);
      })();
      const doneHidden = hideOldDone && row.classList.contains('status-done') && isOlderThan3Days(row.dataset.completedAt || '');
      row.style.display = (searchOk && !doneHidden) ? '' : 'none';
    });
  }
}

// ── Markdown ────────────────────────────────────────────

const RE_CODE_BLOCK = /```[\s\S]*?```/g;
const RE_CODE_OPEN = /```\w*\n?/;
const RE_CODE_CLOSE = /```$/;
const RE_MERMAID_OPEN = /^```mermaid\s*\n?/;
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
let mermaidCounter = 0;

function md(text: string): string {
  const codeBlocks: string[] = [];
  let s = text.replace(RE_CODE_BLOCK, (match) => {
    if (RE_MERMAID_OPEN.test(match)) {
      const diagram = match.replace(RE_MERMAID_OPEN, "").replace(RE_CODE_CLOSE, "").trim();
      codeBlocks.push(`<pre class="mermaid" id="mermaid-${++mermaidCounter}">${diagram}</pre>`);
    } else {
      codeBlocks.push(`<pre><code>${match.replace(RE_CODE_OPEN, "").replace(RE_CODE_CLOSE, "")}</code></pre>`);
    }
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

async function renderMermaid(container: HTMLElement) {
  const m = (window as any).__mermaid;
  if (!m) return;
  const els = container.querySelectorAll("pre.mermaid");
  if (els.length > 0) try { await m.run({ nodes: els }); } catch { /* ok */ }
}

// ── Card rendering ──────────────────────────────────────

function renderCard(task: Task): string {
  const pBadge = priorityClass(task.priority) ? `<span class="badge ${task.priority}">${task.priority}</span>` : "";
  const dateBadge = task.completed_at
    ? `<span class="badge date">${task.completed_at.slice(0, 10)}</span>`
    : task.created_at ? `<span class="badge created">${timeAgo(task.created_at)}</span>` : "";

  const isBlocked = task.loop_count >= currentMaxLoops;
  const blockedBadge = isBlocked ? `<span class="badge blocked">BLOCKED</span>` : "";

  const blocks: Block[] = parseJsonArray(task.blocks);
  const last = blocks.length > 0 ? blocks[blocks.length - 1] : null;
  const verdictBadge = last
    ? `<span class="badge ${last.verdict === 'ok' ? 'verdict-ok' : 'verdict-nok'}">${last.agent}: ${last.verdict}</span>` : "";

  const tags = parseTags(task.tags).map(t => `<span class="tag">${t}</span>`).join("");
  const desc = task.description ? task.description.split("\n")[0].slice(0, 80) : "";
  const noteCount = parseJsonArray(task.notes).length;
  const notesBadge = noteCount > 0 ? `<span class="badge notes-count" title="${noteCount} note(s)">\u{1F4AC} ${noteCount}</span>` : "";

  return `
    <div class="card ${isBlocked ? 'card-blocked' : ''}" draggable="true" data-id="${task.id}" data-status="${task.status}" data-completed-at="${task.completed_at || ''}">
      <div class="card-header">
        <span class="card-id">#${task.id}</span>
        ${pBadge}${blockedBadge}${verdictBadge}
      </div>
      <div class="card-title">${task.title}</div>
      ${desc ? `<div class="card-desc">${desc}</div>` : ""}
      <div class="card-footer">${notesBadge}${dateBadge}</div>
      ${tags ? `<div class="card-tags">${tags}</div>` : ""}
    </div>`;
}

function renderColumn(key: string, label: string, tasks: Task[]): string {
  const addBtn = key === "todo" ? `<button class="add-card-btn" id="add-card-btn" title="Add card">+</button>` : "";
  return `
    <div class="column ${key}" data-column="${key}">
      <div class="column-header">
        <span>${label}</span>
        <div class="column-header-right">${addBtn}<span class="count">${tasks.length}</span></div>
      </div>
      <div class="column-body" data-column="${key}">
        ${sortTasks(tasks).map(renderCard).join("") || '<div class="empty">No items</div>'}
      </div>
    </div>`;
}

// ── Task Detail ─────────────────────────────────────────

async function uploadFiles(taskId: number, files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    const data: string = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(file); });
    await fetch(`/api/task/${taskId}/attachment`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, data }),
    });
  }
  showTaskDetail(taskId);
}

async function showTaskDetail(id: number) {
  const overlay = document.getElementById("modal-overlay")!;
  const content = document.getElementById("modal-content")!;
  content.innerHTML = '<div style="color:#94a3b8">Loading...</div>';
  overlay.classList.remove("hidden");

  try {
    const task: Task = await (await fetch(`/api/task/${id}`)).json();
    const columns = ["todo", ...(cachedColumnOrder.slice(1, -1)), "done"];
    const currentIdx = Math.max(0, columns.indexOf(task.status));

    const tags = parseTags(task.tags);
    const tagsHtml = tags.length ? `<div class="modal-tags">${tags.map(t => `<span class="tag">${t}</span>`).join("")}</div>` : "";

    const meta = [
      `<strong>Pipeline:</strong> ${task.pipeline}`,
      `<strong>Status:</strong> ${task.status}`,
      `<strong>Priority:</strong> ${task.priority}`,
      `<strong>Created:</strong> ${task.created_at?.slice(0, 10) || "-"}`,
      task.started_at ? `<strong>Started:</strong> ${task.started_at.slice(0, 10)}` : "",
      task.completed_at ? `<strong>Completed:</strong> ${task.completed_at.slice(0, 10)}` : "",
    ].filter(Boolean).join(" &nbsp;|&nbsp; ");

    const progressHtml = `<div class="lifecycle-progress">${columns.map((col, i) => `
      <div class="progress-step ${i < currentIdx ? 'completed' : ''} ${i === currentIdx ? 'current' : ''}">
        <div class="step-dot"></div><span class="step-label">${col === 'todo' ? 'Todo' : col === 'done' ? 'Done' : col}</span>
      </div>`).join('<div class="progress-line"></div>')}</div>`;

    const isBlocked = task.loop_count >= currentMaxLoops;
    const blockedHtml = isBlocked
      ? `<div class="blocked-banner"><strong>BLOCKED</strong> — ${task.loop_count} failed loops (max: ${currentMaxLoops}). Add a comment to unblock.</div>` : "";

    const attachments = parseJsonArray(task.attachments);
    const attachmentsHtml = attachments.length > 0
      ? `<div class="attachments-grid">${attachments.map((a: any) =>
          `<div class="attachment-thumb"><img src="${a.url}" alt="${a.filename}" loading="lazy" /><button class="attachment-remove" data-id="${id}" data-name="${a.storedName}">&times;</button></div>`
        ).join('')}</div>` : '';

    const reqBody = task.description ? md(task.description) : `<span class="phase-empty">Not yet documented</span>`;
    const requirementSection = `
      <div class="lifecycle-phase phase-requirement ${currentIdx === 0 ? 'active' : ''}">
        <div class="phase-header"><span class="phase-icon">\u{1F4CB}</span><span class="phase-label">Requirements</span>
          <button class="phase-edit-btn" id="req-edit-btn">&#9998;</button></div>
        <div class="phase-body" id="req-body-view">${reqBody}${attachmentsHtml}</div>
        <div class="phase-body hidden" id="req-body-edit">
          <textarea id="req-textarea" rows="8">${(task.description || '').replace(/</g, '&lt;')}</textarea>
          <div class="attachment-drop-zone" id="attachment-drop-zone"><span>\u{1F4CE} Drop images here or click</span><input type="file" id="attachment-input" accept="image/*" multiple hidden /></div>
          <div class="phase-edit-actions"><button class="phase-save-btn" id="req-save-btn">Save</button><button class="phase-cancel-btn" id="req-cancel-btn">Cancel</button></div>
        </div>
      </div>`;

    const blocks: Block[] = parseJsonArray(task.blocks);
    const blocksHtml = blocks.map((block, idx) => `
      <div class="lifecycle-phase phase-block ${block.verdict === 'ok' ? 'block-ok' : 'block-nok'}">
        <div class="phase-header">
          <span class="phase-icon">${block.verdict === 'ok' ? '\u2705' : '\u274C'}</span>
          <span class="phase-label">${block.agent}</span>
          <span class="block-meta">${block.verdict.toUpperCase()} &middot; ${block.timestamp?.slice(0, 16) || ''}</span>
          <span class="block-index">#${idx + 1}</span>
        </div>
        <div class="phase-body">
          <div class="block-content">${md(block.content || '')}</div>
          ${block.decision_log ? `<details class="block-decision-log"><summary>Decision Log</summary><div>${md(block.decision_log)}</div></details>` : ''}
        </div>
      </div>`).join('');

    const notes = parseJsonArray(task.notes);
    const notesHtml = notes.map((n: any) => `
      <div class="note-entry">
        <div class="note-header"><span class="note-author">${n.author || 'user'}</span><span class="note-time">${n.timestamp?.slice(0, 16).replace('T', ' ') || ''}</span>
          <button class="note-delete" data-note-id="${n.id}">&times;</button></div>
        <div class="note-text">${md(n.text || '')}</div>
      </div>`).join('');

    content.innerHTML = `
      <h1>#${task.id} ${task.title}</h1>
      <div class="modal-meta">${meta}</div>${tagsHtml}${blockedHtml}${progressHtml}
      <div class="lifecycle-sections">${requirementSection}${blocksHtml}</div>
      <div class="notes-section ${isBlocked ? 'notes-highlighted' : ''}">
        <div class="notes-header"><span>${isBlocked ? '\u{1F6A8} Add a comment to unblock' : 'Notes'}</span><span class="notes-count">${notes.length}</span></div>
        <div class="notes-list">${notesHtml}</div>
        <form class="note-form" id="note-form">
          <textarea id="note-input" rows="2" placeholder="${isBlocked ? 'Comment to unblock...' : 'Add a note...'}"></textarea>
          <button type="submit" class="note-submit">${isBlocked ? 'Unblock & Add Note' : 'Add Note'}</button>
        </form>
      </div>
      <div class="modal-danger-zone"><button class="delete-task-btn" id="delete-task-btn">Delete Card</button></div>`;

    renderMermaid(content);

    // Event handlers
    document.getElementById("delete-task-btn")!.addEventListener("click", async () => {
      if (!confirm(`Delete card #${task.id}?`)) return;
      await fetch(`/api/task/${id}`, { method: "DELETE" });
      overlay.classList.add("hidden");
      refreshCurrentView();
    });

    const reqView = document.getElementById("req-body-view")!;
    const reqEdit = document.getElementById("req-body-edit")!;
    const reqTextarea = document.getElementById("req-textarea") as HTMLTextAreaElement;
    document.getElementById("req-edit-btn")!.addEventListener("click", () => { reqView.classList.add("hidden"); reqEdit.classList.remove("hidden"); reqTextarea.focus(); });
    document.getElementById("req-cancel-btn")!.addEventListener("click", () => { reqTextarea.value = task.description || ''; reqEdit.classList.add("hidden"); reqView.classList.remove("hidden"); });
    document.getElementById("req-save-btn")!.addEventListener("click", async () => {
      await fetch(`/api/task/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: reqTextarea.value }) });
      showTaskDetail(id);
    });

    const dropZone = document.getElementById("attachment-drop-zone");
    const fileInput = document.getElementById("attachment-input") as HTMLInputElement | null;
    if (dropZone && fileInput) {
      dropZone.addEventListener("click", () => fileInput.click());
      dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drop-active"); });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drop-active"));
      dropZone.addEventListener("drop", async e => { e.preventDefault(); dropZone.classList.remove("drop-active"); const f = (e as DragEvent).dataTransfer?.files; if (f) await uploadFiles(id, f); });
      fileInput.addEventListener("change", async () => { if (fileInput.files) await uploadFiles(id, fileInput.files); });
    }
    content.querySelectorAll(".attachment-remove").forEach(btn => {
      btn.addEventListener("click", async e => { e.stopPropagation(); const el = btn as HTMLElement; await fetch(`/api/task/${id}/attachment/${encodeURIComponent(el.dataset.name!)}`, { method: "DELETE" }); showTaskDetail(id); });
    });

    (document.getElementById("note-form") as HTMLFormElement).addEventListener("submit", async e => {
      e.preventDefault();
      const input = document.getElementById("note-input") as HTMLTextAreaElement;
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      await fetch(`/api/task/${id}/note`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      showTaskDetail(id);
    });
    content.querySelectorAll(".note-delete").forEach(btn => {
      btn.addEventListener("click", async e => { e.stopPropagation(); await fetch(`/api/task/${id}/note/${(btn as HTMLElement).dataset.noteId}`, { method: "DELETE" }); showTaskDetail(id); });
    });
  } catch {
    content.innerHTML = '<div style="color:#ef4444">Failed to load</div>';
  }
}

// ── Board ───────────────────────────────────────────────

async function loadBoard() {
  const board = document.getElementById("board")!;
  const params = currentPipeline ? `?pipeline=${encodeURIComponent(currentPipeline)}` : "";

  try {
    const data: BoardResponse = await (await fetch(`/api/board${params}`)).json();
    cachedColumnOrder = data.column_order;
    currentPipeline = data.pipeline;

    renderPipelineSelector(data.pipelines, data.pipeline);

    board.innerHTML = data.column_order.map(col =>
      renderColumn(col, col === 'todo' ? '\u{1F4CB} Todo' : col === 'done' ? '\u2705 Done' : `\u{1F916} ${col}`, data.columns[col] || [])
    ).join("");

    const doneCount = (data.columns["done"] || []).length;
    let total = 0;
    for (const col of data.column_order) total += (data.columns[col] || []).length;
    document.getElementById("count-summary")!.textContent = `${doneCount}/${total} completed`;

    board.querySelectorAll(".card").forEach(el => {
      el.addEventListener("click", e => {
        const copyBtn = (e.target as HTMLElement).closest(".card-copy-btn") as HTMLElement | null;
        if (copyBtn) { e.stopPropagation(); navigator.clipboard.writeText(copyBtn.dataset.copy!); return; }
        showTaskDetail(parseInt((el as HTMLElement).dataset.id!));
      });
    });

    setupDragAndDrop();
    applySearchFilter();

    document.getElementById("add-card-btn")?.addEventListener("click", e => {
      e.stopPropagation();
      document.getElementById("add-card-overlay")!.classList.remove("hidden");
      (document.getElementById("add-title") as HTMLInputElement).focus();
    });
  } catch (err) {
    console.error("loadBoard failed:", err);
    board.innerHTML = `<div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;color:#ef4444;padding:48px">Cannot load board. Run /kanban-init first.</div>`;
  }
}

// ── List View ───────────────────────────────────────────

async function loadListView() {
  const listView = document.getElementById("list-view")!;
  const params = currentPipeline ? `?pipeline=${encodeURIComponent(currentPipeline)}` : "";

  try {
    const data: BoardResponse = await (await fetch(`/api/board${params}`)).json();
    renderPipelineSelector(data.pipelines, data.pipeline);

    const allTasks: Task[] = [];
    for (const col of data.column_order) for (const t of (data.columns[col] || [])) allTasks.push(t);

    const displayTasks = currentSort === 'default' ? [...allTasks].sort((a, b) => b.id - a.id) : sortTasks(allTasks);
    const doneCount = displayTasks.filter(t => t.status === "done").length;
    document.getElementById("count-summary")!.textContent = `${doneCount}/${displayTasks.length} completed`;

    const statusOpts = data.column_order.map(col => `<option value="${col}">${col}</option>`).join("");
    const rows = displayTasks.map(t => {
      const isBlocked = t.loop_count >= currentMaxLoops;
      return `
        <tr class="status-${t.status} ${isBlocked ? 'row-blocked' : ''}" data-id="${t.id}" data-completed-at="${t.completed_at || ''}">
          <td class="col-id">#${t.id}</td>
          <td class="col-title">${t.title}</td>
          <td><select class="list-status-select" data-id="${t.id}" data-field="status">${statusOpts.replace(`value="${t.status}"`, `value="${t.status}" selected`)}</select></td>
          <td><select class="list-priority-select ${priorityClass(t.priority)}" data-id="${t.id}" data-field="priority">
            ${["high", "medium", "low"].map(p => `<option value="${p}" ${p === t.priority ? "selected" : ""}>${p[0].toUpperCase() + p.slice(1)}</option>`).join("")}
          </select></td>
          <td>${parseTags(t.tags).map(tag => `<span class="tag">${tag}</span>`).join("")}</td>
          <td class="list-date">${t.created_at?.slice(0, 10) || ""}</td>
          <td class="list-date">${t.completed_at?.slice(0, 10) || ""}</td>
        </tr>`;
    }).join("");

    listView.innerHTML = `<table class="list-table"><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Tags</th><th>Created</th><th>Completed</th></tr></thead><tbody>${rows}</tbody></table>`;

    listView.querySelectorAll("select").forEach(sel => {
      sel.addEventListener("change", async e => {
        e.stopPropagation();
        const el = sel as HTMLSelectElement;
        const resp = await fetch(`/api/task/${el.dataset.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [el.dataset.field!]: el.value }),
        });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); if (err.error) showToast(err.error); }
        loadListView();
      });
    });

    listView.querySelectorAll(".col-title").forEach(el => {
      el.addEventListener("click", e => {
        e.stopPropagation();
        showTaskDetail(parseInt(((el as HTMLElement).closest("tr")! as HTMLElement).dataset.id!));
      });
    });

    applySearchFilter();
  } catch (err) {
    console.error("loadListView failed:", err);
    listView.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;color:#ef4444;padding:48px">Failed to load</div>`;
  }
}

// ── Pipeline selector ───────────────────────────────────

function renderPipelineSelector(pipelines: string[], active: string) {
  const container = document.getElementById("pipeline-filter")!;
  if (pipelines.length <= 1) {
    container.innerHTML = `<span class="pipeline-label">${active}</span>`;
    return;
  }
  container.innerHTML = `<select id="pipeline-select">${pipelines.map(p =>
    `<option value="${p}" ${p === active ? "selected" : ""}>${p}</option>`
  ).join("")}</select>`;

  document.getElementById("pipeline-select")!.addEventListener("change", e => {
    currentPipeline = (e.target as HTMLSelectElement).value;
    localStorage.setItem('kanban-pipeline', currentPipeline);
    refreshCurrentView();
  });
}

// ── Drag & Drop ─────────────────────────────────────────

function getInsertBeforeCard(column: HTMLElement, y: number): HTMLElement | null {
  for (const card of column.querySelectorAll(".card:not(.dragging)")) {
    if (y < (card as HTMLElement).getBoundingClientRect().top + (card as HTMLElement).getBoundingClientRect().height / 2)
      return card as HTMLElement;
  }
  return null;
}

function clearDropIndicators() { document.querySelectorAll(".drop-indicator").forEach(el => el.remove()); }

function setupDragAndDrop() {
  document.querySelectorAll(".card").forEach(card => {
    card.addEventListener("dragstart", e => {
      (e as DragEvent).dataTransfer!.setData("text/plain", (card as HTMLElement).dataset.id!);
      (card as HTMLElement).classList.add("dragging");
      isDragging = true;
    });
    card.addEventListener("dragend", () => { (card as HTMLElement).classList.remove("dragging"); clearDropIndicators(); isDragging = false; });
  });

  document.querySelectorAll(".column-body").forEach(col => {
    col.addEventListener("dragover", e => {
      e.preventDefault();
      (col as HTMLElement).classList.add("drag-over");
      const before = getInsertBeforeCard(col as HTMLElement, (e as DragEvent).clientY);
      clearDropIndicators();
      const ind = document.createElement("div"); ind.className = "drop-indicator";
      if (before) col.insertBefore(ind, before); else col.appendChild(ind);
    });
    col.addEventListener("dragleave", e => {
      if (!(col as HTMLElement).contains((e as DragEvent).relatedTarget as Node)) {
        (col as HTMLElement).classList.remove("drag-over"); clearDropIndicators();
      }
    });
    col.addEventListener("drop", async e => {
      e.preventDefault();
      (col as HTMLElement).classList.remove("drag-over");
      clearDropIndicators();
      const id = parseInt((e as DragEvent).dataTransfer!.getData("text/plain"));
      const newStatus = (col as HTMLElement).dataset.column!;
      const before = getInsertBeforeCard(col as HTMLElement, (e as DragEvent).clientY);
      const cards = [...(col as HTMLElement).querySelectorAll(".card:not(.dragging)")];
      let afterId: number | null = null, beforeId: number | null = null;
      if (before) {
        beforeId = parseInt(before.dataset.id!);
        const idx = cards.indexOf(before);
        if (idx > 0) afterId = parseInt((cards[idx - 1] as HTMLElement).dataset.id!);
      } else if (cards.length > 0) {
        afterId = parseInt((cards[cards.length - 1] as HTMLElement).dataset.id!);
      }
      const resp = await fetch(`/api/task/${id}/reorder`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, afterId, beforeId }),
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({})); if (err.error) showToast(err.error); }
      loadBoard();
    });
  });
}

// ── Pipeline Settings ───────────────────────────────────

interface AgentInfo {
  name: string;
  source: string;
  description?: string;
  model?: string;
  color?: string;
  tools?: string[];
  prompt?: string;
}

async function showPipelineSettings() {
  const overlay = document.getElementById("pipeline-overlay")!;
  const content = document.getElementById("pipeline-content")!;
  overlay.classList.remove("hidden");

  const allPipelines: PipelinesFile = await (await fetch("/api/pipelines")).json();
  const agents: AgentInfo[] = await (await fetch("/api/agents")).json();
  const agentMap = new Map<string, AgentInfo>();
  for (const a of agents) agentMap.set(a.name, a);

  let editingName: string = currentPipeline || allPipelines.default;
  let selectedAgent: string | null = null;

  function agentBadge(name: string): string {
    const a = agentMap.get(name);
    const model = a?.model ? `<span class="agent-detail-model">${a.model}</span>` : '';
    const source = a?.source ? `<span class="agent-detail-source">${a.source}</span>` : '';
    return `${name} ${model} ${source}`;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderAgentDetail(name: string): string {
    const a = agentMap.get(name);
    if (!a) return `<div class="agent-detail-empty">Agent "${name}" not found</div>`;

    const badges = [
      a.model ? `<span class="agent-badge agent-badge--model">${a.model}</span>` : '',
      `<span class="agent-badge agent-badge--source">${a.source}</span>`,
    ].filter(Boolean).join('');

    const toolsHtml = a.tools && a.tools.length > 0 ? `
      <div class="agent-detail-section">
        <span class="agent-detail-section-title">Tools</span>
        <div class="agent-detail-tool-list">${a.tools.map(t => `<span class="agent-detail-tool">${t}</span>`).join('')}</div>
      </div>` : '';

    const promptHtml = a.prompt ? `
      <div class="agent-detail-section">
        <span class="agent-detail-section-title">Prompt</span>
        <pre class="agent-detail-prompt">${escapeHtml(a.prompt)}</pre>
      </div>` : '';

    return `
      <div class="agent-detail">
        <div class="agent-detail-header">
          <div class="agent-detail-title-group">
            <span class="agent-detail-name">${a.name}</span>
            <div class="agent-detail-badges">${badges}</div>
          </div>
        </div>
        ${a.description ? `<p class="agent-detail-desc">${a.description}</p>` : ''}
        ${toolsHtml}
        ${promptHtml}
      </div>`;
  }

  function render() {
    const pipelineNames = Object.keys(allPipelines.pipelines);
    const pipeline = allPipelines.pipelines[editingName] || { stages: [] };

    const tabsHtml = pipelineNames.map(n =>
      `<button class="pipeline-tab ${n === editingName ? 'active' : ''}" data-name="${n}">${n}</button>`
    ).join('') + `<button class="pipeline-tab pipeline-add-tab" id="add-pipeline-btn">+</button>`;

    const stagesHtml = pipeline.stages.map((s, i) => `
      <div class="pipeline-stage ${s === selectedAgent ? 'selected' : ''}" draggable="true" data-index="${i}" data-agent="${s}">
        <span class="pipeline-drag-handle">\u2630</span>
        <span class="pipeline-stage-name">${s}</span>
        ${agentMap.get(s)?.model ? `<span class="pipeline-stage-model">${agentMap.get(s)!.model}</span>` : ''}
        <button class="pipeline-remove-btn" data-index="${i}">\u{1F5D1}\uFE0F</button>
      </div>`).join('');

    const unused = agents.filter(a => !pipeline.stages.includes(a.name));
    const addOpts = unused.map(a => `<option value="${a.name}">${a.name} (${a.source})</option>`).join('');

    const detailHtml = selectedAgent ? renderAgentDetail(selectedAgent) : '';

    content.innerHTML = `
      <div class="pipeline-settings">
        <div class="pipeline-tabs">${tabsHtml}</div>
        <div class="pipeline-settings-body">
          <div class="pipeline-settings-left">
            <div class="pipeline-config-row">
              <label class="pipeline-config-label">Max loops</label>
              <input type="number" id="pipeline-max-loops" class="pipeline-config-input" value="${allPipelines.max_loops}" min="1" max="10" />
            </div>
            <div class="pipeline-section">
              <label class="pipeline-section-title">Stages</label>
              <div id="pipeline-stages-list" class="pipeline-stages-list">${stagesHtml}</div>
            </div>
            ${unused.length > 0 ? `<div class="pipeline-add-row">
              <select id="pipeline-add-select" class="pipeline-add-select"><option value="">Add agent…</option>${addOpts}</select>
              <button type="button" id="pipeline-add-btn" class="pipeline-add-btn">Add</button></div>` : ''}
            <div class="pipeline-footer-row">
              <label class="pipeline-default-label"><input type="radio" name="default-pipeline" ${editingName === allPipelines.default ? 'checked' : ''} id="set-default-radio" /> Default pipeline</label>
              <button type="button" id="delete-pipeline-btn" class="pipeline-delete-btn" ${pipelineNames.length <= 1 ? 'disabled' : ''}>Delete "${editingName}"</button>
            </div>
          </div>
          <div class="pipeline-settings-right">${detailHtml || '<div class="agent-detail-empty">Select a stage to view details</div>'}</div>
        </div>
        <div class="pipeline-actions">
          <button type="button" id="pipeline-cancel-btn" class="pipeline-btn-secondary">Cancel</button>
          <button type="button" id="pipeline-save-btn" class="pipeline-btn-primary">Save</button>
        </div>
      </div>`;

    // Tab clicks
    content.querySelectorAll('.pipeline-tab:not(.pipeline-add-tab)').forEach(btn => {
      btn.addEventListener('click', () => { editingName = (btn as HTMLElement).dataset.name!; selectedAgent = null; render(); });
    });

    // Stage clicks → show agent detail
    content.querySelectorAll('.pipeline-stage').forEach(el => {
      el.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('.pipeline-remove-btn') || (e.target as HTMLElement).closest('.pipeline-drag-handle')) return;
        selectedAgent = (el as HTMLElement).dataset.agent || null;
        render();
      });
    });

    // Add pipeline
    document.getElementById('add-pipeline-btn')?.addEventListener('click', () => {
      const name = prompt('Pipeline name:');
      if (name && !allPipelines.pipelines[name]) {
        allPipelines.pipelines[name] = { stages: [] };
        editingName = name;
        selectedAgent = null;
        render();
      }
    });

    // Remove stage
    content.querySelectorAll('.pipeline-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index!);
        if (pipeline.stages[idx] === selectedAgent) selectedAgent = null;
        pipeline.stages.splice(idx, 1);
        render();
      });
    });

    // Add stage
    document.getElementById('pipeline-add-btn')?.addEventListener('click', () => {
      const sel = document.getElementById('pipeline-add-select') as HTMLSelectElement;
      if (sel.value) { pipeline.stages.push(sel.value); selectedAgent = sel.value; render(); }
    });

    // Delete pipeline
    document.getElementById('delete-pipeline-btn')?.addEventListener('click', () => {
      if (Object.keys(allPipelines.pipelines).length <= 1) return;
      delete allPipelines.pipelines[editingName];
      if (allPipelines.default === editingName) allPipelines.default = Object.keys(allPipelines.pipelines)[0];
      editingName = allPipelines.default;
      selectedAgent = null;
      render();
    });

    // Save
    document.getElementById('pipeline-save-btn')!.addEventListener('click', async () => {
      allPipelines.max_loops = parseInt((document.getElementById('pipeline-max-loops') as HTMLInputElement).value) || 3;
      if ((document.getElementById('set-default-radio') as HTMLInputElement).checked) allPipelines.default = editingName;
      await fetch('/api/pipelines', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(allPipelines) });
      overlay.classList.add('hidden');
      currentPipeline = editingName;
      localStorage.setItem('kanban-pipeline', currentPipeline);
      refreshCurrentView();
    });

    document.getElementById('pipeline-cancel-btn')!.addEventListener('click', () => overlay.classList.add('hidden'));

    // Stage drag-and-drop
    const list = document.getElementById('pipeline-stages-list')!;
    let dragIdx: number | null = null;
    list.querySelectorAll('.pipeline-stage').forEach(el => {
      el.addEventListener('dragstart', e => { dragIdx = parseInt((el as HTMLElement).dataset.index!); (el as HTMLElement).classList.add('dragging'); (e as DragEvent).dataTransfer!.effectAllowed = 'move'; });
      el.addEventListener('dragend', () => { (el as HTMLElement).classList.remove('dragging'); dragIdx = null; });
      el.addEventListener('dragover', e => { e.preventDefault(); (el as HTMLElement).classList.add('drag-over'); });
      el.addEventListener('dragleave', () => (el as HTMLElement).classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault(); (el as HTMLElement).classList.remove('drag-over');
        const dropIdx = parseInt((el as HTMLElement).dataset.index!);
        if (dragIdx !== null && dragIdx !== dropIdx) { const [moved] = pipeline.stages.splice(dragIdx, 1); pipeline.stages.splice(dropIdx, 0, moved); render(); }
      });
    });
  }

  render();
}

// ── Toast ───────────────────────────────────────────────

function showToast(message: string) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── View switching ──────────────────────────────────────

function switchView(view: "board" | "list") {
  currentView = view;
  document.getElementById("board")!.classList.toggle("hidden", view !== "board");
  document.getElementById("list-view")!.classList.toggle("hidden", view !== "list");
  document.getElementById("tab-board")!.classList.toggle("active", view === "board");
  document.getElementById("tab-list")!.classList.toggle("active", view === "list");
  if (view === "board") loadBoard(); else loadListView();
}

function refreshCurrentView() { if (currentView === "board") loadBoard(); else loadListView(); }

// ── Theme ───────────────────────────────────────────────

function getTheme(): "light" | "dark" {
  const saved = localStorage.getItem('kanban-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('kanban-theme', theme);
  const btn = document.getElementById('theme-toggle-btn')!;
  btn.innerHTML = theme === 'dark'
    ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.6 3.6l.7.7M11.7 11.7l.7.7M3.6 12.4l.7-.7M11.7 4.3l.7-.7"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13.5 9.2A5.5 5.5 0 0 1 6.8 2.5 5.5 5.5 0 1 0 13.5 9.2z"/></svg>';
  btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

applyTheme(getTheme());

document.getElementById('theme-toggle-btn')!.addEventListener('click', () => {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
});

// ── Init ────────────────────────────────────────────────

// Load max_loops
fetch("/api/pipelines").then(r => r.json()).then((d: PipelinesFile) => { currentMaxLoops = d.max_loops; }).catch(() => {});

document.querySelector("header h1")!.textContent = "Kanban Board";
switchView("board");

(document.getElementById("sort-select") as HTMLSelectElement).value = currentSort;
if (hideOldDone) document.getElementById("hide-done-btn")!.classList.add("active");

document.getElementById("tab-board")!.addEventListener("click", () => switchView("board"));
document.getElementById("tab-list")!.addEventListener("click", () => switchView("list"));
document.getElementById("pipeline-settings-btn")!.addEventListener("click", showPipelineSettings);
document.getElementById("pipeline-close")!.addEventListener("click", () => document.getElementById("pipeline-overlay")!.classList.add("hidden"));
document.getElementById("pipeline-overlay")!.addEventListener("click", e => { if (e.target === e.currentTarget) document.getElementById("pipeline-overlay")!.classList.add("hidden"); });
document.getElementById("refresh-btn")!.addEventListener("click", refreshCurrentView);
document.getElementById("search-input")!.addEventListener("input", e => { currentSearch = (e.target as HTMLInputElement).value.trim(); applySearchFilter(); });
document.getElementById("sort-select")!.addEventListener("change", e => { currentSort = (e.target as HTMLSelectElement).value; localStorage.setItem('kanban-sort', currentSort); refreshCurrentView(); });
document.getElementById("hide-done-btn")!.addEventListener("click", () => { hideOldDone = !hideOldDone; localStorage.setItem('kanban-hide-old', String(hideOldDone)); document.getElementById("hide-done-btn")!.classList.toggle("active", hideOldDone); applySearchFilter(); });

document.getElementById("modal-close")!.addEventListener("click", () => document.getElementById("modal-overlay")!.classList.add("hidden"));
document.getElementById("modal-overlay")!.addEventListener("click", e => { if (e.target === e.currentTarget) document.getElementById("modal-overlay")!.classList.add("hidden"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { document.getElementById("modal-overlay")!.classList.add("hidden"); document.getElementById("add-card-overlay")!.classList.add("hidden"); document.getElementById("pipeline-overlay")!.classList.add("hidden"); } });

setInterval(() => {
  if (isDragging) return;
  if (!document.getElementById("modal-overlay")!.classList.contains("hidden")) return;
  if (!document.getElementById("add-card-overlay")!.classList.contains("hidden")) return;
  if (!document.getElementById("pipeline-overlay")!.classList.contains("hidden")) return;
  refreshCurrentView();
}, 10000);

// Add card
const addCardOverlay = document.getElementById("add-card-overlay")!;
let pendingFiles: File[] = [];

function renderAddPreview() {
  const p = document.getElementById("add-attachment-preview")!;
  if (!pendingFiles.length) { p.innerHTML = ""; return; }
  p.innerHTML = pendingFiles.map((f, i) => `<div class="attachment-thumb"><img src="${URL.createObjectURL(f)}" /><button class="attachment-remove" data-idx="${i}" type="button">&times;</button></div>`).join("");
  p.querySelectorAll(".attachment-remove").forEach(btn => btn.addEventListener("click", e => { e.stopPropagation(); pendingFiles.splice(parseInt((btn as HTMLElement).dataset.idx!), 1); renderAddPreview(); }));
}

document.getElementById("add-card-close")!.addEventListener("click", () => { addCardOverlay.classList.add("hidden"); pendingFiles = []; renderAddPreview(); });
addCardOverlay.addEventListener("click", e => { if (e.target === e.currentTarget) { addCardOverlay.classList.add("hidden"); pendingFiles = []; renderAddPreview(); } });

const addZone = document.getElementById("add-attachment-zone")!;
const addInput = document.getElementById("add-attachment-input") as HTMLInputElement;
addZone.addEventListener("click", () => addInput.click());
addZone.addEventListener("dragover", e => { e.preventDefault(); addZone.classList.add("drop-active"); });
addZone.addEventListener("dragleave", () => addZone.classList.remove("drop-active"));
addZone.addEventListener("drop", e => { e.preventDefault(); addZone.classList.remove("drop-active"); const f = (e as DragEvent).dataTransfer?.files; if (f) for (const file of Array.from(f)) if (file.type.startsWith("image/")) pendingFiles.push(file); renderAddPreview(); });
addInput.addEventListener("change", () => { if (addInput.files) for (const f of Array.from(addInput.files)) if (f.type.startsWith("image/")) pendingFiles.push(f); addInput.value = ""; renderAddPreview(); });

document.getElementById("add-card-form")!.addEventListener("submit", async e => {
  e.preventDefault();
  const title = (document.getElementById("add-title") as HTMLInputElement).value.trim();
  if (!title) return;
  const priority = (document.getElementById("add-priority") as HTMLSelectElement).value;
  const description = (document.getElementById("add-description") as HTMLTextAreaElement).value.trim() || null;
  const tagsRaw = (document.getElementById("add-tags") as HTMLInputElement).value.trim();
  const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : null;
  const pipeline = currentPipeline || undefined;

  const btn = document.querySelector("#add-card-form .form-submit") as HTMLButtonElement;
  btn.disabled = true;
  const res = await fetch("/api/task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, priority, description, tags, pipeline }) });
  const result = await res.json();
  if (pendingFiles.length > 0 && result.id) await uploadFiles(result.id, pendingFiles as any);
  pendingFiles = [];
  btn.disabled = false;
  (document.getElementById("add-card-form") as HTMLFormElement).reset();
  renderAddPreview();
  addCardOverlay.classList.add("hidden");
  refreshCurrentView();
});
