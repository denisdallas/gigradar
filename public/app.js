const state = { items: [], sources: [], summary: {}, meta: { countries: [] }, view: 'all', search: '', country: '', sort: 'score' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const adminKey = () => sessionStorage.getItem('gigradar-admin-key') || '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (adminKey()) headers.Authorization = `Bearer ${adminKey()}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function refresh() {
  try {
    const [summary, sources, meta, items] = await Promise.all([
      api('/api/summary'), api('/api/sources'), api('/api/meta'), api('/api/opportunities?limit=250')
    ]);
    state.summary = summary; state.sources = sources; state.meta = meta; state.items = items;
    render();
  } catch (error) { toast(error.message, 'error'); }
}

function render() {
  const total = Number(state.summary.total || 0);
  const gigs = Number(state.summary.gigs || 0);
  const prospects = Number(state.summary.prospects || 0);
  const review = Number(state.summary.needs_review || 0);
  $('#stat-total').textContent = total;
  $('#stat-gigs').textContent = gigs;
  $('#stat-prospects').textContent = prospects;
  $('#stat-review').textContent = review;
  $('#all-count').textContent = total;
  $('#gig-count').textContent = gigs;
  $('#prospect-count').textContent = prospects;
  $('#saved-count').textContent = Number(state.summary.shortlisted || 0);
  $('#tab-all').textContent = total;
  $('#tab-gigs').textContent = gigs;
  $('#tab-prospects').textContent = prospects;
  $('#today-date').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
  renderRun(); renderCountryFilters(); renderConnection(); renderItems();
}

function renderRun() {
  const run = state.summary.latest_run;
  if (!run) { $('#last-run').innerHTML = '<i></i> No scan yet'; return; }
  const date = new Date(run.started_at);
  $('#last-run').innerHTML = `<i class="${run.status === 'failed' ? 'dot-error' : ''}"></i> Last scan ${escapeHtml(timeAgo(date))}`;
}

function renderConnection() {
  const { groq, ntfy, admin_key } = state.summary.integrations || {};
  const enabled = state.sources.filter(source => source.enabled).length;
  const available = [groq && 'Groq', ntfy && 'ntfy'].filter(Boolean);
  $('#connection-title').textContent = enabled ? `${enabled} source${enabled === 1 ? '' : 's'} connected` : 'No sources yet';
  $('#connection-copy').textContent = available.length ? `${available.join(' · ')} connected` : 'Add an RSS feed to start';
  $('#connection-dot').classList.toggle('online', enabled > 0);
  $('#integration-list').innerHTML = [
    ['RSS discovery', `${enabled} source${enabled === 1 ? '' : 's'} configured`, enabled > 0],
    ['Groq qualification', groq ? 'Connected' : 'Add GROQ_API_KEY to the server', Boolean(groq)],
    ['ntfy notifications', ntfy ? 'Connected' : 'Add NTFY_TOPIC to the server', Boolean(ntfy)],
    ['Dashboard writes', admin_key ? 'Protected with admin key' : 'Local mode: no admin key configured', Boolean(admin_key)]
  ].map(([name, detail, ok]) => `<div class="integration-row"><span class="integration-indicator ${ok ? 'on' : ''}"></span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div></div>`).join('') +
    state.sources.map(source => `<div class="integration-row"><span class="integration-indicator ${source.last_error ? '' : source.last_checked_at ? 'on' : ''}"></span><div><strong>${escapeHtml(source.name)} · ${escapeHtml(source.country)}</strong><small>${source.last_error ? escapeHtml(source.last_error) : source.last_checked_at ? `Last scanned ${escapeHtml(timeAgo(new Date(source.last_checked_at)))}` : 'Not scanned yet'}</small></div></div>`).join('') +
    (state.summary.latest_run?.errors || []).map(error => `<div class="integration-row"><span class="integration-indicator"></span><div><strong>Last scan note</strong><small>${escapeHtml(error)}</small></div></div>`).join('');
}

function renderCountryFilters() {
  const countries = state.meta.countries || [];
  const seen = new Set($$('#country-filter option').map(option => option.value));
  for (const country of countries) {
    if (seen.has(country)) continue;
    $('#country-filter').insertAdjacentHTML('beforeend', `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`);
  }
  if (!$('#source-country').options.length) {
    $('#source-country').innerHTML = countries.map(country => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join('') + '<option value="Remote / Europe-wide">Remote / Europe-wide</option>';
  }
  $('#country-list').innerHTML = countries.slice(0, 7).map(country => {
    const count = state.items.filter(item => item.country === country && item.status === 'new').length;
    return `<button class="country-item ${state.country === country ? 'selected' : ''}" data-country="${escapeHtml(country)}"><span><i class="country-dot"></i>${escapeHtml(country)}</span><small>${count}</small></button>`;
  }).join('') + `<button class="country-more" data-action="all-countries">View all markets <span>→</span></button>`;
}

function visibleItems() {
  let items = state.items.filter(item => item.status !== 'dismissed');
  if (state.view === 'active_gig' || state.view === 'business_prospect') items = items.filter(item => item.kind === state.view);
  if (state.view === 'shortlisted') items = items.filter(item => item.status === 'shortlisted');
  if (state.country) items = items.filter(item => item.country === state.country);
  if (state.search) {
    const q = state.search.toLowerCase();
    items = items.filter(item => `${item.title} ${item.organization} ${item.summary} ${item.country}`.toLowerCase().includes(q));
  }
  return items.sort((a, b) => state.sort === 'recent'
    ? new Date(b.published_at || b.discovered_at) - new Date(a.published_at || a.discovered_at)
    : b.score - a.score);
}

function renderItems() {
  const items = visibleItems();
  $('#result-count').textContent = items.length;
  $('#opportunity-list').hidden = items.length === 0;
  $('#empty-state').hidden = items.length !== 0;
  const heading = state.view === 'active_gig' ? 'Active gigs' : state.view === 'business_prospect' ? 'Business prospects' : state.view === 'shortlisted' ? 'Shortlisted opportunities' : 'Latest opportunities';
  $('#list-heading').childNodes[0].textContent = `${heading} `;
  $('#breadcrumb-current').textContent = state.country || heading;
  $('#opportunity-list').innerHTML = items.map(renderCard).join('');
}

function renderCard(item) {
  const isGig = item.kind === 'active_gig';
  const label = isGig ? 'ACTIVE GIG' : 'BUSINESS PROSPECT';
  const statusText = item.qualification_status === 'qualified' ? 'GROQ QUALIFIED' : item.qualification_status === 'not_relevant' ? 'LOW FIT' : 'NEEDS REVIEW';
  const published = item.published_at ? timeAgo(new Date(item.published_at)) : 'Date not listed';
  return `<article class="opportunity-card">
    <div class="card-symbol ${isGig ? 'gig-symbol' : 'prospect-symbol'}">${isGig ? '↗' : '⌂'}</div>
    <div class="card-main"><div class="card-meta"><span class="kind-label ${isGig ? 'kind-gig' : 'kind-prospect'}"><i></i>${label}</span><span class="meta-dot">·</span><span>${escapeHtml(item.country)}</span><span class="meta-dot">·</span><span>${escapeHtml(published)}</span></div>
      <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
      <div class="organization">${escapeHtml(item.organization || item.source_name || 'Source')}</div>
      <p class="card-summary">${escapeHtml(item.summary || 'No description was provided by the source.')}</p>
      ${item.assessment ? `<p class="assessment-note"><span>RADAR NOTE</span> ${escapeHtml(item.assessment)}</p>` : ''}
      <div class="card-bottom"><span class="source-chip"><span class="source-icon">↗</span>${escapeHtml(item.source_name || 'Public feed')}</span><span class="qualification ${item.qualification_status === 'qualified' ? 'is-qualified' : ''}"><i></i>${statusText}</span></div>
    </div>
    <div class="card-side"><div class="fit-label">FIT SCORE</div><div class="fit-score ${item.score >= 75 ? 'high-fit' : ''}">${Number(item.score || 0)}<small>/100</small></div>
      <button class="save-button ${item.status === 'shortlisted' ? 'saved' : ''}" data-action="shortlist" data-id="${escapeHtml(item.id)}" aria-label="${item.status === 'shortlisted' ? 'Remove from shortlist' : 'Shortlist opportunity'}">${item.status === 'shortlisted' ? '★' : '☆'}</button>
      <button class="dismiss-button" data-action="dismiss" data-id="${escapeHtml(item.id)}" aria-label="Dismiss opportunity" title="Dismiss">×</button>
    </div>
  </article>`;
}

function timeAgo(date) {
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toast(message, type = 'success') {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show ${type === 'error' ? 'toast-error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = 'toast'; }, 3200);
}

function openDialog(id) { document.getElementById(id).showModal(); }
function closeDialog(id) { document.getElementById(id).close(); }

$('#source-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('[type="submit"]');
  const error = $('#source-error');
  error.textContent = '';
  button.disabled = true;
  const key = form.get('admin_key') || adminKey();
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  try {
    const response = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: form.get('name'), feed_url: form.get('feed_url'), kind: form.get('kind'), country: form.get('country') }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Could not save source (${response.status})`);
    if (key) sessionStorage.setItem('gigradar-admin-key', key);
    closeDialog('source-modal'); event.currentTarget.reset(); toast('Source added. Scan it when you’re ready.'); await refresh();
  } catch (err) { error.textContent = err.message; }
  finally { button.disabled = false; }
});

$('#sync-button').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; button.classList.add('is-loading');
  try {
    const result = await api('/api/discover', { method: 'POST' });
    if (!result.sources_checked) toast('Add a source before scanning.');
    else toast(`${result.items_added} new item${result.items_added === 1 ? '' : 's'} added from ${result.sources_checked} source${result.sources_checked === 1 ? '' : 's'}.`);
    if (result.errors.length) toast(`${result.errors.length} scan note${result.errors.length === 1 ? '' : 's'}; see Settings → Connections.`, 'error');
    await refresh();
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; button.classList.remove('is-loading'); }
});

$('#save-key').addEventListener('click', () => {
  const value = $('#settings-admin-key').value.trim();
  if (value) sessionStorage.setItem('gigradar-admin-key', value);
  else sessionStorage.removeItem('gigradar-admin-key');
  closeDialog('settings-modal'); toast('Session settings saved.');
});
$('#clear-key').addEventListener('click', () => { sessionStorage.removeItem('gigradar-admin-key'); $('#settings-admin-key').value = ''; toast('Session key cleared.'); });
$('#settings-button').addEventListener('click', () => { $('#settings-admin-key').value = adminKey(); openDialog('settings-modal'); });
$('#add-source-button').addEventListener('click', () => openDialog('source-modal'));
$('#empty-add-source').addEventListener('click', () => openDialog('source-modal'));

$$('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
$$('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-filter]').forEach(button => button.addEventListener('click', () => setView(button.dataset.filter)));

function setView(view) {
  state.view = view;
  if (view === 'shortlisted') state.country = '';
  if (['active_gig', 'business_prospect', 'all'].includes(view)) {
    $$('.view-tab').forEach(tab => { const selected = tab.dataset.filter === view; tab.classList.toggle('selected', selected); tab.setAttribute('aria-selected', String(selected)); });
  }
  $$('.nav-item').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  $('#country-filter').value = state.country;
  renderItems(); renderCountryFilters();
}

$('#country-filter').addEventListener('change', event => { state.country = event.target.value; renderCountryFilters(); renderItems(); });
$('#search-input').addEventListener('input', event => { state.search = event.target.value.trim(); renderItems(); });
$('#sort-filter').addEventListener('change', event => { state.sort = event.target.value; renderItems(); });
$('#country-list').addEventListener('click', event => {
  const button = event.target.closest('[data-country]');
  if (button) { state.country = state.country === button.dataset.country ? '' : button.dataset.country; $('#country-filter').value = state.country; renderCountryFilters(); renderItems(); }
  if (event.target.closest('[data-action="all-countries"]')) { state.country = ''; $('#country-filter').focus(); }
});

$('#opportunity-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-action="shortlist"]');
  const dismissButton = event.target.closest('[data-action="dismiss"]');
  const actionButton = button || dismissButton;
  if (!actionButton) return;
  const item = state.items.find(row => row.id === actionButton.dataset.id);
  if (!item) return;
  try {
    if (dismissButton) {
      await api(`/api/opportunities/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) });
      await refresh(); toast('Opportunity dismissed.');
    } else {
      await api(`/api/opportunities/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ status: item.status === 'shortlisted' ? 'new' : 'shortlisted' }) });
      await refresh(); toast(item.status === 'shortlisted' ? 'Removed from shortlist.' : 'Added to your shortlist.');
    }
  } catch (error) { toast(error.message, 'error'); }
});

document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-input').focus(); } });
refresh();
