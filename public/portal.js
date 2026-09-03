const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
const toast = document.querySelector('#toast');
const saveBar = document.querySelector('#save-bar');
const saveAllButton = document.querySelector('#save-all');

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

async function submitForm(form) {
  const data = Object.fromEntries(new FormData(form));
  const guildMatch = location.pathname.match(/^\/dashboard\/(\d+)/);
  const path = form.getAttribute('action') || '';
  const url = path.startsWith('/') ? path : guildMatch ? `/api/guilds/${guildMatch[1]}/${path}` : path;
  const response = await fetch(url, { method: (form.getAttribute('method') || 'post').toUpperCase(), headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

document.querySelectorAll('.api-form').forEach(form => form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"], button:not([type])');
  if (button) button.disabled = true;
  try {
    const result = await submitForm(form);
    notify(result.message || 'Saved.');
    if (result.redirect) location.href = result.redirect;
    else setTimeout(() => location.reload(), 450);
  } catch (error) {
    notify(error.message, true);
    if (button) button.disabled = false;
  }
}));

const settingForms = [...document.querySelectorAll('.setting-form')];

function markChanged(form) {
  form.dataset.changed = 'true';
  form.classList.add('changed');
  saveBar?.classList.add('show');
}

for (const form of settingForms) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    markChanged(form);
  });
  for (const control of form.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    control.addEventListener(control.matches('select') ? 'change' : 'input', () => markChanged(form));
  }
}

saveAllButton?.addEventListener('click', async () => {
  const changedForms = settingForms.filter(form => form.dataset.changed === 'true');
  if (!changedForms.length) return saveBar.classList.remove('show');
  saveAllButton.disabled = true;
  saveAllButton.textContent = 'Saving…';
  try {
    const guildMatch = location.pathname.match(/^\/dashboard\/(\d+)/);
    if (!guildMatch) throw new Error('No server selected.');
    const settings = changedForms.map(form => Object.fromEntries(new FormData(form)));
    const response = await fetch(`/api/guilds/${guildMatch[1]}/settings/bulk`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ settings }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Saving failed.');
    for (const form of changedForms) {
      delete form.dataset.changed;
      form.classList.remove('changed');
    }
    saveBar.classList.remove('show');
    notify(result.message);
  } catch (error) {
    notify(error.message, true);
  } finally {
    saveAllButton.disabled = false;
    saveAllButton.textContent = 'Save changes';
  }
});

window.addEventListener('beforeunload', event => {
  if (!settingForms.some(form => form.dataset.changed === 'true')) return;
  event.preventDefault();
});
