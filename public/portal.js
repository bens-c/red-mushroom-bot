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

const avatarInput = document.querySelector('#bot-avatar-file');
const avatarPreview = document.querySelector('#bot-avatar-preview');
const avatarUpload = document.querySelector('#bot-avatar-upload');
const avatarReset = document.querySelector('#bot-avatar-reset');

function selectedGuildId() {
  return location.pathname.match(/^\/dashboard\/(\d+)/)?.[1] || null;
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(new Error('The image could not be read.')));
    reader.readAsDataURL(file);
  });
}

async function updateServerAvatar(avatar) {
  const guildId = selectedGuildId();
  if (!guildId) throw new Error('No server selected.');
  const response = await fetch(`/api/guilds/${guildId}/profile-avatar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ avatar })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Profile image update failed.');
  if (avatarPreview && result.avatarUrl) avatarPreview.src = `${result.avatarUrl}${result.avatarUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
  notify(result.message);
}

avatarInput?.addEventListener('change', async () => {
  const file = avatarInput.files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) {
    avatarInput.value = '';
    return notify('Choose a PNG, JPG, or GIF image.', true);
  }
  if (file.size > 2 * 1024 * 1024) {
    avatarInput.value = '';
    return notify('The profile image must be 2 MB or smaller.', true);
  }
  try { avatarPreview.src = await readImage(file); }
  catch (error) { notify(error.message, true); }
});

avatarUpload?.addEventListener('click', async () => {
  const file = avatarInput?.files?.[0];
  if (!file) return notify('Choose an image first.', true);
  avatarUpload.disabled = true;
  try {
    await updateServerAvatar(await readImage(file));
    avatarInput.value = '';
  } catch (error) { notify(error.message, true); }
  finally { avatarUpload.disabled = false; }
});

avatarReset?.addEventListener('click', async () => {
  avatarReset.disabled = true;
  try {
    await updateServerAvatar(null);
    if (avatarInput) avatarInput.value = '';
  } catch (error) { notify(error.message, true); }
  finally { avatarReset.disabled = false; }
});

window.addEventListener('beforeunload', event => {
  if (!settingForms.some(form => form.dataset.changed === 'true')) return;
  event.preventDefault();
});
