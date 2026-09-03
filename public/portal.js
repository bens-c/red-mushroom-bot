const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
const toast = document.querySelector('#toast');

function notify(message, error = false) {
  if (!toast) return;
  toast.textContent = message;
  toast.className = error ? 'show error' : 'show';
  setTimeout(() => { toast.className = ''; }, 3200);
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === button.dataset.tab));
}));

document.querySelectorAll('.api-form').forEach(form => form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"], button:not([type])');
  if (button) button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    const guildMatch = location.pathname.match(/^\/dashboard\/(\d+)/);
    const path = form.getAttribute('action') || '';
    const url = path.startsWith('/') ? path : guildMatch ? `/api/guilds/${guildMatch[1]}/${path}` : path;
    const response = await fetch(url, { method: (form.getAttribute('method') || 'post').toUpperCase(), headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    notify(result.message || 'Saved.');
    if (result.redirect) location.href = result.redirect;
    else setTimeout(() => location.reload(), 450);
  } catch (error) {
    notify(error.message, true);
    if (button) button.disabled = false;
  }
}));
