/* ============================================================
   PFM Rep Activity Dashboard — Frontend
   Vanilla JS, no build step. All state in `state` object.
   Manual refresh only — no setInterval anywhere.
   ============================================================ */

// ── State ──────────────────────────────────────────────────────
const state = {
  date:             todayISO(),
  view:             'groups',       // 'groups' | 'group' | 'member'
  selectedGroupId:  null,
  selectedGroupName: null,
  selectedMemberId: null,
  selectedMemberName: null,
  memberRange:      7,              // days of history to show
  cache:            {}              // URL → response JSON
};

// ── Utilities ──────────────────────────────────────────────────
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return isoStr; }
}

function initials(name) {
  return (name || '?').split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

function catIcon(cat) {
  const icons = { check_in: '🏪', photo: '📸', note: '📝', agenda: '📋', general: '💬' };
  return icons[cat] || '💬';
}

function catLabel(cat) {
  const labels = { check_in: 'Check-in', photo: 'Photo', note: 'Note', agenda: 'Agenda', general: 'General' };
  return labels[cat] || cat;
}

function dateRangeBack(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

// ── API ────────────────────────────────────────────────────────
const PASS = localStorage.getItem('dashKey') || '';

async function api(url) {
  if (state.cache[url]) return state.cache[url];
  const headers = PASS ? { 'x-dashboard-key': PASS } : {};
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    const key = prompt('Dashboard password:');
    if (key) {
      localStorage.setItem('dashKey', key);
      location.reload();
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  state.cache[url] = data;
  return data;
}

async function post(url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (PASS) headers['x-dashboard-key'] = PASS;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Loading / Toast ────────────────────────────────────────────
function showLoading()  { document.getElementById('loading').classList.remove('hidden'); }
function hideLoading()  { document.getElementById('loading').classList.add('hidden'); }
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ── Navigation ─────────────────────────────────────────────────
function navigate(view, params = {}) {
  state.view = view;
  if (params.groupId)    { state.selectedGroupId   = params.groupId;   state.selectedGroupName  = params.groupName; }
  if (params.memberId)   { state.selectedMemberId  = params.memberId;  state.selectedMemberName = params.memberName; }
  renderBreadcrumb();
  render();
}

function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  const parts = [];
  if (state.view !== 'groups') {
    parts.push(`<span class="crumb" onclick="navigate('groups')">Groups</span>`);
  }
  if (state.view === 'group') {
    parts.push(`<span class="sep">/</span><span class="current">${esc(state.selectedGroupName)}</span>`);
  }
  if (state.view === 'member') {
    parts.push(`<span class="sep">/</span>`);
    parts.push(`<span class="crumb" onclick="navigate('group',{groupId:${state.selectedGroupId},groupName:'${esc(state.selectedGroupName)}'})">
      ${esc(state.selectedGroupName)}</span>`);
    parts.push(`<span class="sep">/</span><span class="current">${esc(state.selectedMemberName)}</span>`);
  }
  bc.innerHTML = parts.join('');
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Main render dispatcher ──────────────────────────────────────
async function render() {
  ['groups','group','member'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('active', state.view === v);
  });
  showLoading();
  try {
    if (state.view === 'groups') await renderGroups();
    if (state.view === 'group')  await renderGroup(state.selectedGroupId);
    if (state.view === 'member') await renderMember(state.selectedMemberId);
  } catch (err) {
    showToast(err.message, true);
    console.error(err);
  } finally {
    hideLoading();
  }
}

// ── View: Group List ────────────────────────────────────────────
async function renderGroups() {
  const groups = await api(`/api/groups?date=${state.date}`);
  const grid   = document.getElementById('groups-grid');

  if (!groups.length) {
    grid.innerHTML = `<div class="empty-state">
      <h3>No groups configured yet</h3>
      <p>Groups appear here once the bot starts receiving messages.</p>
    </div>`;
    return;
  }

  grid.innerHTML = groups.map(g => {
    const inactive = g.inactiveMembers || 0;
    const active   = g.activeMembers   || 0;
    const total    = g.totalMembers    || 0;
    const msgs     = g.totalMessages   || 0;
    const last     = g.lastActivity ? `Last: ${fmtTime(g.lastActivity)}` : 'No activity';
    const hasInactive = inactive > 0;

    return `
      <div class="group-card ${hasInactive ? 'has-inactive' : 'all-active'}"
           onclick="navigate('group',{groupId:${g.id},groupName:'${esc(g.team_name)}'})">
        <div class="group-card-name">${esc(g.team_name)}</div>
        <div class="group-stats">
          <div class="stat-row"><span>Members</span><span class="stat-val">${total}</span></div>
          <div class="stat-row"><span>Active today</span><span class="stat-val" style="color:var(--green)">${active}</span></div>
          <div class="stat-row"><span>Messages</span><span class="stat-val">${msgs}</span></div>
          <div class="stat-row"><span style="color:var(--text-muted);font-size:11px">${last}</span></div>
        </div>
        <div class="group-card-footer">
          ${hasInactive
            ? `<span class="inactive-badge">⚠ ${inactive} inactive</span>`
            : `<span class="all-good-badge">✓ All active</span>`}
          <span class="view-link">View details →</span>
        </div>
      </div>`;
  }).join('');
}

// ── View: Group Detail ──────────────────────────────────────────
async function renderGroup(groupId) {
  const detail = await api(`/api/groups/${groupId}?date=${state.date}`);
  const { group, members, cachedSummary, summaryGeneratedAt } = detail;

  // Summary bar
  const active   = members.filter(m => !m.inactive).length;
  const inactive = members.filter(m =>  m.inactive).length;
  const total    = members.length;
  const msgs     = members.reduce((s, m) => s + (m.messageCount || 0), 0);

  document.getElementById('group-summary-bar').innerHTML = `
    <div class="summary-stat"><span class="s-value">${total}</span><span class="s-label">Members</span></div>
    <div class="summary-stat stat-active"><span class="s-value">${active}</span><span class="s-label">Active</span></div>
    <div class="summary-stat stat-inactive"><span class="s-value">${inactive}</span><span class="s-label">Inactive</span></div>
    <div class="summary-stat"><span class="s-value">${msgs}</span><span class="s-label">Messages</span></div>
    <div style="flex:1"></div>
    <div style="display:flex;align-items:center">
      <button class="btn btn-outline btn-sm" onclick="generateGroupSummary(${group.id})">
        ✦ AI Summary
      </button>
    </div>`;

  // AI summary
  const aiBox = document.getElementById('group-ai-summary');
  if (cachedSummary) {
    aiBox.classList.remove('hidden');
    aiBox.innerHTML = `
      <span class="ai-icon">✦</span>
      <div class="ai-text">
        ${esc(cachedSummary)}
        <div class="ai-meta">Generated ${summaryGeneratedAt ? fmtTime(summaryGeneratedAt) : ''}</div>
      </div>
      <div class="ai-actions">
        <button class="btn btn-outline btn-sm" onclick="generateGroupSummary(${group.id})">↺ Refresh</button>
      </div>`;
  } else {
    aiBox.classList.add('hidden');
  }

  // Members
  if (!members.length) {
    document.getElementById('members-list').innerHTML = `
      <div class="empty-state"><h3>No members yet</h3><p>Members appear as messages arrive.</p></div>`;
    return;
  }

  document.getElementById('members-list').innerHTML = members.map(m => {
    const cats = [];
    if (m.checkIns) cats.push(`<span class="cat-pill cat-check_in">${catIcon('check_in')} ${m.checkIns}</span>`);
    if (m.photos)   cats.push(`<span class="cat-pill cat-photo">${catIcon('photo')} ${m.photos}</span>`);
    if (m.notes)    cats.push(`<span class="cat-pill cat-note">${catIcon('note')} ${m.notes}</span>`);
    if (m.agendas)  cats.push(`<span class="cat-pill cat-agenda">${catIcon('agenda')} ${m.agendas}</span>`);
    if (m.general)  cats.push(`<span class="cat-pill cat-general">${catIcon('general')} ${m.general}</span>`);

    const lastTime = m.lastMessageTime ? fmtTime(m.lastMessageTime) : null;

    return `
      <div class="member-card ${m.inactive ? 'inactive' : ''}"
           onclick="navigate('member',{memberId:${m.id},memberName:'${esc(m.name)}',groupId:${groupId},groupName:'${esc(group.team_name)}'})">
        <div class="member-avatar">${initials(m.name)}</div>
        <div class="member-info">
          <div class="member-name">${esc(m.name)}</div>
          <div class="member-sub">${lastTime ? `Last message: ${lastTime}` : m.inactive ? 'No messages today' : ''}</div>
          ${cats.length ? `<div class="member-cats">${cats.join('')}</div>` : ''}
        </div>
        <div class="member-meta">
          <div class="msg-count">${m.messageCount}</div>
          <div class="msg-label">msg${m.messageCount !== 1 ? 's' : ''}</div>
          ${m.inactive ? '<div class="inactive-label">INACTIVE</div>' : ''}
        </div>
      </div>`;
  }).join('');
}

async function generateGroupSummary(groupId) {
  const aiBox = document.getElementById('group-ai-summary');
  aiBox.classList.remove('hidden');
  aiBox.innerHTML = `<span class="ai-icon">✦</span><div class="ai-text">Generating summary…</div>`;
  // Bust cache for group detail so summary refreshes
  delete state.cache[`/api/groups/${groupId}?date=${state.date}`];
  try {
    const result = await post('/api/summaries/generate', { scope: 'group', scopeId: groupId, date: state.date });
    aiBox.innerHTML = `
      <span class="ai-icon">✦</span>
      <div class="ai-text">
        ${esc(result.summary_text)}
        <div class="ai-meta">Generated ${fmtTime(result.generated_at)}</div>
      </div>
      <div class="ai-actions">
        <button class="btn btn-outline btn-sm" onclick="generateGroupSummary(${groupId})">↺ Refresh</button>
      </div>`;
  } catch (err) {
    aiBox.innerHTML = `<span class="ai-icon">✦</span><div class="ai-text" style="color:var(--red)">${esc(err.message)}</div>`;
  }
}

// ── View: Member Detail ─────────────────────────────────────────
async function renderMember(memberId) {
  const dateFrom = dateRangeBack(state.memberRange);
  const detail   = await api(`/api/members/${memberId}?dateFrom=${dateFrom}&dateTo=${state.date}`);
  const messages = await api(`/api/members/${memberId}/messages?date=${state.date}`);

  // Header
  document.getElementById('member-header').innerHTML = `
    <div class="member-header-avatar">${initials(detail.member.name)}</div>
    <div class="member-header-info">
      <h2>${esc(detail.member.name)}</h2>
      <p>${esc(detail.member.team_name)} — History: last ${state.memberRange} days</p>
    </div>`;

  // Range tabs
  document.getElementById('member-range-tabs').innerHTML =
    [7, 14, 30].map(d => `
      <button class="range-tab ${state.memberRange === d ? 'active' : ''}"
              onclick="setMemberRange(${d})">
        Last ${d} days
      </button>`).join('');

  // Content
  const content = document.getElementById('member-content');

  // Daily history table
  const rows = detail.dailyStats.length
    ? detail.dailyStats.map(day => `
        <tr>
          <td><span class="day-link" onclick="setDateAndView('${day.date}')">${fmtDate(day.date)}</span></td>
          <td>${day.messageCount || '<span class="zero">0</span>'}</td>
          <td class="${day.checkIns ? '' : 'zero'}">${day.checkIns || 0}</td>
          <td class="${day.photos   ? '' : 'zero'}">${day.photos   || 0}</td>
          <td class="${day.notes    ? '' : 'zero'}">${day.notes    || 0}</td>
          <td>${day.lastMessageTime ? fmtTime(day.lastMessageTime) : '—'}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No data in this range</td></tr>`;

  // Messages for selected date
  const msgHTML = messages.length
    ? messages.map(m => `
        <div class="message-item">
          <span class="message-time">${fmtTime(m.timestamp)}</span>
          <span class="message-cat-dot dot-${m.category || 'general'}"></span>
          <div class="message-body">
            <span title="${catLabel(m.category)}">${catIcon(m.category)} ${esc(m.raw_body)}</span>
            ${m.store_name ? `<div class="message-store">📍 ${esc(m.store_name)}</div>` : ''}
            ${m.media_url  ? `<a href="${esc(m.media_url)}" target="_blank" class="message-photo-link">📎 View photo</a>` : ''}
          </div>
        </div>`).join('')
    : `<div class="no-messages">No messages on ${fmtDate(state.date)}</div>`;

  content.innerHTML = `
    <div class="history-section">
      <div class="history-section-title">Activity History</div>
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th><th>Messages</th><th>Check-ins</th>
            <th>Photos</th><th>Notes</th><th>Last Active</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="messages-section">
      <div class="messages-section-title">
        <span>Messages on ${fmtDate(state.date)}</span>
        <button class="btn btn-outline btn-sm" onclick="generateMemberSummary(${memberId},'sum-${memberId}')">
          ✦ Summarise
        </button>
      </div>
      <div id="sum-${memberId}"></div>
      ${msgHTML}
    </div>`;
}

async function generateMemberSummary(memberId, containerId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  box.innerHTML = `<div style="padding:12px 18px;font-size:13px;color:var(--text-muted)">Generating…</div>`;
  delete state.cache[`/api/summaries/member/${memberId}?date=${state.date}`];
  try {
    const result = await post('/api/summaries/generate', { scope: 'member', scopeId: memberId, date: state.date });
    box.innerHTML = `
      <div class="ai-summary-box" style="margin:0;border-radius:0;border-left:none;border-right:none;border-top:none">
        <span class="ai-icon">✦</span>
        <div class="ai-text">${esc(result.summary_text)}<div class="ai-meta">Generated ${fmtTime(result.generated_at)}</div></div>
      </div>`;
  } catch (err) {
    box.innerHTML = `<div style="padding:12px 18px;font-size:13px;color:var(--red)">${esc(err.message)}</div>`;
  }
}

function setMemberRange(days) {
  state.memberRange = days;
  // Bust member cache
  const prefix = `/api/members/${state.selectedMemberId}`;
  Object.keys(state.cache).forEach(k => { if (k.startsWith(prefix)) delete state.cache[k]; });
  render();
}

function setDateAndView(date) {
  state.date = date;
  document.getElementById('datePicker').value = date;
  // bust all cache
  state.cache = {};
  render();
}

// ── Controls ────────────────────────────────────────────────────
function onRefresh() {
  state.cache = {};
  document.getElementById('lastRefresh').textContent = `Refreshed ${fmtTime(new Date().toISOString())}`;
  render();
}

function onDateChange(e) {
  state.date = e.target.value;
  state.cache = {};
  render();
}

// ── Init ────────────────────────────────────────────────────────
async function init() {
  // Load branding
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    if (cfg.companyName) {
      document.getElementById('companyName').textContent = cfg.companyName + ' · Rep Dashboard';
      document.title = cfg.companyName + ' Dashboard';
    }
    if (cfg.companyLogoUrl) {
      const logo = document.getElementById('companyLogo');
      logo.src = cfg.companyLogoUrl;
      logo.classList.remove('hidden');
    }
  } catch (_) {}

  // Set date picker
  const picker = document.getElementById('datePicker');
  picker.value = state.date;
  picker.addEventListener('change', onDateChange);

  // Hint picker with data-backed dates
  try {
    const dates = await api('/api/dates');
    if (dates.length) {
      const dl = document.createElement('datalist');
      dl.id = 'date-options';
      dates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        dl.appendChild(opt);
      });
      document.body.appendChild(dl);
      picker.setAttribute('list', 'date-options');
    }
  } catch (_) {}

  // Buttons
  document.getElementById('refreshBtn').addEventListener('click', onRefresh);

  // Initial render
  document.getElementById('lastRefresh').textContent = `Loaded ${fmtTime(new Date().toISOString())}`;
  await render();
}

document.addEventListener('DOMContentLoaded', init);
