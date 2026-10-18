'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOURCES = ['LinkedIn', 'Referral', 'Job Board', 'Career Site', 'Other'];

const state = { view: 'dashboard', stages: [], roles: [], q: '', role: '', stage: '', sort: 'created_at', dir: 'desc', page: 1 };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { errors: data.errors });
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
const badge = (s) => `<span class="badge" style="--c:var(--${s})">${esc(s)}</span>`;
const fmtDate = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- Meta / filters ---------- */
async function loadMeta() {
  const meta = await api('/meta');
  state.stages = meta.stages; state.roles = meta.roles;
  $('#f-role').innerHTML = '<option value="">All roles</option>' + meta.roles.map((r) => `<option ${r === state.role ? 'selected' : ''}>${esc(r)}</option>`).join('');
  $('#f-stage').innerHTML = '<option value="">All stages</option>' + meta.stages.map((s) => `<option ${s === state.stage ? 'selected' : ''}>${s}</option>`).join('');
}

/* ---------- Dashboard ---------- */
function bars(rows, colorFn) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return '<div class="muted">No data</div>';
  return rows.map((r) => `<div class="bar-row"><span class="lab" title="${esc(r.label)}">${esc(r.label)}</span>
    <div class="bar"><i style="width:${r.count / max * 100}%;${colorFn ? `background:var(--${r.label})` : ''}"></i></div><span class="n">${r.count}</span></div>`).join('');
}

async function renderDashboard() {
  const m = await api('/metrics');
  const kpi = (v, l) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('#view-dashboard').innerHTML = `
    <div class="kpis">
      ${kpi(m.total, 'Total candidates')}${kpi(m.active, 'In pipeline')}${kpi(m.hired, 'Hired')}
      ${kpi(m.rejected, 'Rejected')}${kpi(m.hireRate + '%', 'Hire rate')}${kpi(m.newLast7Days, 'New (7 days)')}
      ${kpi(m.avgDaysToHire == null ? '—' : m.avgDaysToHire + 'd', 'Avg time to hire')}
    </div>
    <div class="grid2">
      <div class="card"><h3>Candidates by stage</h3>${bars(state.stages.map((s) => ({ label: s, count: m.byStage[s] })), true)}</div>
      <div class="card"><h3>Hiring funnel (ever reached)</h3>${bars(m.funnel.map((f) => ({ label: f.stage, count: f.count })), true)}</div>
      <div class="card"><h3>By role</h3>${bars(m.byRole)}</div>
      <div class="card"><h3>By source</h3>${bars(m.bySource)}</div>
    </div>`;
}

/* ---------- Data fetch with filters ---------- */
function query(extra = {}) {
  const p = new URLSearchParams({ q: state.q, role: state.role, stage: state.stage, sort: state.sort, dir: state.dir, page: state.page, ...extra });
  return '/candidates?' + p;
}

/* ---------- Board ---------- */
async function renderBoard() {
  const { items } = await api(query({ pageSize: 200, page: 1, sort: 'updated_at', dir: 'desc' }));
  const stages = state.stage ? [state.stage] : state.stages;
  $('#view-board').innerHTML = `<div class="board" style="grid-template-columns:repeat(${stages.length},minmax(210px,1fr))">${stages.map((s) => {
    const col = items.filter((c) => c.stage === s);
    return `<div class="col" data-stage="${s}"><h4><span><i class="dot" style="--c:var(--${s})"></i>${s}</span><span class="muted">${col.length}</span></h4>
      ${col.map((c) => `<div class="cand" draggable="true" data-id="${c.id}"><b>${esc(c.name)}</b><small>${esc(c.role)} · ${c.experience}y</small></div>`).join('')}</div>`;
  }).join('')}</div>`;
  const root = $('#view-board');
  root.querySelectorAll('.cand').forEach((el) => {
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', el.dataset.id));
    el.addEventListener('click', () => openCandidate(+el.dataset.id));
  });
  root.querySelectorAll('.col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      await moveStage(+id, col.dataset.stage);
    });
  });
}

async function moveStage(id, stage) {
  try { await api('/candidates/' + id, { method: 'PATCH', body: { stage } }); toast('Moved to ' + stage); await refresh(); }
  catch (e) { toast(e.message); }
}

/* ---------- List ---------- */
async function renderList() {
  const { items, total, page, pageSize } = await api(query({ pageSize: 15 }));
  const th = (k, label) => `<th data-sort="${k}">${label}${state.sort === k ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  $('#view-list').innerHTML = items.length ? `<div class="table-wrap"><table><thead><tr>
    ${th('name', 'Name')}${th('role', 'Role')}${th('stage', 'Stage')}${th('experience', 'Exp.')}<th>Skills</th>${th('created_at', 'Added')}</tr></thead><tbody>
    ${items.map((c) => `<tr data-id="${c.id}"><td><b>${esc(c.name)}</b><br><span class="muted">${esc(c.email)}</span></td><td>${esc(c.role)}</td>
      <td>${badge(c.stage)}</td><td>${c.experience}y</td><td class="muted">${esc(c.skills)}</td><td class="muted">${fmtDate(c.created_at)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="pager"><span class="muted">${total} candidate${total === 1 ? '' : 's'}</span>
      <button id="prev" ${page <= 1 ? 'disabled' : ''}>Prev</button><span>${page} / ${pages}</span><button id="next" ${page >= pages ? 'disabled' : ''}>Next</button></div>`
    : '<div class="empty">No candidates match your search.</div>';
  const root = $('#view-list');
  root.querySelectorAll('th[data-sort]').forEach((h) => h.addEventListener('click', () => {
    const k = h.dataset.sort;
    state.dir = state.sort === k && state.dir === 'asc' ? 'desc' : 'asc'; state.sort = k; state.page = 1; render();
  }));
  root.querySelectorAll('tbody tr').forEach((r) => r.addEventListener('click', () => openCandidate(+r.dataset.id)));
  $('#prev', root)?.addEventListener('click', () => { state.page--; render(); });
  $('#next', root)?.addEventListener('click', () => { state.page++; render(); });
}

/* ---------- Modal: add / edit ---------- */
const modal = $('#modal');
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

function field(name, label, c, attrs = '', cls = '') {
  return `<div class="${cls}"><label for="m-${name}">${label}</label><input id="m-${name}" name="${name}" value="${esc(c[name])}" ${attrs}><div class="err" data-err="${name}"></div></div>`;
}

async function openCandidate(id) {
  const c = id ? await api('/candidates/' + id) : { experience: 0, source: 'LinkedIn', stage: 'Applied', history: [] };
  modal.innerHTML = `<form class="modal" novalidate><h2>${id ? 'Candidate' : 'Add candidate'}</h2><div class="form">
    ${field('name', 'Name *', c)}${field('email', 'Email *', c, 'type="email"')}
    ${field('phone', 'Phone', c)}${field('role', 'Role applied *', c, 'list="roles"')}
    <datalist id="roles">${state.roles.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
    <div><label for="m-experience">Experience (years)</label><input id="m-experience" name="experience" type="number" min="0" max="60" step="0.5" value="${c.experience}"><div class="err" data-err="experience"></div></div>
    <div><label for="m-source">Source</label><select id="m-source" name="source">${SOURCES.map((s) => `<option ${s === c.source ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="full"><label for="m-stage">Stage</label><select id="m-stage" name="stage">${state.stages.map((s) => `<option ${s === c.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    ${field('skills', 'Skills (comma separated)', c, '', 'full')}
    <div class="full"><label for="m-notes">Notes</label><textarea id="m-notes" name="notes" rows="3">${esc(c.notes)}</textarea></div>
  </div>
  ${id ? `<ul class="history">${c.history.map((h) => `<li>${h.from_stage ? esc(h.from_stage) + ' → ' : 'Added as '}${esc(h.to_stage)} <span>(${fmtDate(h.changed_at)})</span></li>`).join('')}</ul>` : ''}
  <div class="actions">${id ? '<button type="button" class="danger" id="del">Delete</button>' : ''}<span class="spacer"></span>
    <button type="button" id="cancel">Cancel</button><button class="primary" type="submit">Save</button></div></form>`;
  modal.showModal();
  $('#cancel', modal).onclick = () => modal.close();
  if (id) $('#del', modal).onclick = async () => {
    if (!confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    await api('/candidates/' + id, { method: 'DELETE' }); modal.close(); toast('Candidate deleted'); refresh();
  };
  $('form', modal).onsubmit = async (e) => {
    e.preventDefault();
    modal.querySelectorAll('.err').forEach((x) => { x.textContent = ''; });
    const body = Object.fromEntries(new FormData(e.target));
    try {
      await api(id ? '/candidates/' + id : '/candidates', { method: id ? 'PATCH' : 'POST', body });
      modal.close(); toast(id ? 'Saved' : 'Candidate added'); refresh();
    } catch (err) {
      Object.entries(err.errors || {}).forEach(([k, v]) => { const el = $(`[data-err="${k}"]`, modal); if (el) el.textContent = v; });
      if (!err.errors) toast(err.message);
    }
  };
}

/* ---------- Routing ---------- */
async function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  ['dashboard', 'board', 'list'].forEach((v) => { $('#view-' + v).hidden = v !== state.view; });
  $('#toolbar').hidden = state.view === 'dashboard';
  try {
    if (state.view === 'dashboard') await renderDashboard();
    else if (state.view === 'board') await renderBoard();
    else await renderList();
  } catch (e) { toast(e.message); }
}
async function refresh() { await loadMeta(); await render(); }

document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; state.page = 1; render(); }));
$('#add-btn').addEventListener('click', () => openCandidate(null));
$('#q').addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 1; render(); }));
$('#f-role').addEventListener('change', (e) => { state.role = e.target.value; state.page = 1; render(); });
$('#f-stage').addEventListener('change', (e) => { state.stage = e.target.value; state.page = 1; render(); });

refresh();
