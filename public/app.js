const state = {
  token: localStorage.getItem('worklink-token') || '',
  username: '',
  role: 'member',
};

const loginPanel = document.getElementById('loginPanel');
const appPanel = document.getElementById('appPanel');
const currentUser = document.getElementById('currentUser');
const logoutButton = document.getElementById('logoutButton');
const loginForm = document.getElementById('loginForm');
const jobForm = document.getElementById('jobForm');
const jobList = document.getElementById('jobList');
const createJobPanel = document.getElementById('createJobPanel');
const roleNotice = document.getElementById('roleNotice');

function setLoggedIn(loggedIn) {
  loginPanel.classList.toggle('hidden', loggedIn);
  appPanel.classList.toggle('hidden', !loggedIn);
  logoutButton.classList.toggle('hidden', !loggedIn);
  currentUser.classList.toggle('hidden', !loggedIn);
}

function canManageJobs() {
  return ['admin', 'manager'].includes(state.role);
}

function applyRoleState() {
  const managing = canManageJobs();
  createJobPanel.classList.toggle('hidden', !managing);
  roleNotice.classList.toggle('hidden', managing);

  const actionSelector = document.querySelectorAll('.job-status, .job-priority');
  actionSelector.forEach((control) => {
    control.disabled = !managing;
  });
}

function updateUserBadge() {
  const label = state.username ? `${state.username} (${state.role})` : 'Signed in';
  currentUser.textContent = label;
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.token}`,
  };
}

async function login(username, password) {
  const response = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Login failed');
  }

  state.token = payload.token;
  state.username = payload.user.username;
  state.role = payload.user.role || 'member';
  localStorage.setItem('worklink-token', state.token);
  updateUserBadge();
  setLoggedIn(true);
  applyRoleState();
  return payload;
}

async function loadProfile() {
  if (!state.token) {
    return;
  }

  const response = await fetch('/me', {
    headers: { Authorization: `Bearer ${state.token}` },
  });

  if (!response.ok) {
    throw new Error('Unable to load user profile');
  }

  const user = await response.json();
  state.username = user.username;
  state.role = user.role || 'member';
  updateUserBadge();
  applyRoleState();
}

async function loadJobs() {
  if (!state.token) {
    return;
  }

  const response = await fetch('/jobs', {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Unable to load jobs');
  }

  const jobs = await response.json();
  renderJobs(jobs);
}

async function createJob(formData) {
  const response = await fetch('/jobs', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(formData),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Unable to create job');
  }

  jobForm.reset();
  await loadJobs();
}

async function updateJobStatus(jobId, updates) {
  const response = await fetch(`/jobs/${jobId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Unable to update job');
  }

  await loadJobs();
}

function renderJobs(jobs) {
  if (!jobs.length) {
    jobList.innerHTML = '<p>No jobs yet.</p>';
    return;
  }

  jobList.innerHTML = jobs
    .map(
      (job) => `
        <article class="job-card" data-id="${job.id}">
          <div class="job-header">
            <h3>${escapeHtml(job.title)}</h3>
            <span class="badge status-${job.status}">${job.status.replace('_', ' ')}</span>
          </div>
          <p>${escapeHtml(job.description || 'No description')}</p>
          <div class="job-meta">
            <span class="badge priority-${job.priority}">${job.priority}</span>
            <span class="badge">Assignee: ${escapeHtml(job.assignee || 'Unassigned')}</span>
          </div>
          <div class="inline-fields" style="margin-top: 12px;">
            <label>
              Status
              <select class="job-status" data-id="${job.id}" ${canManageJobs() ? '' : 'disabled'}>
                <option value="queued" ${job.status === 'queued' ? 'selected' : ''}>Queued</option>
                <option value="in_progress" ${job.status === 'in_progress' ? 'selected' : ''}>In progress</option>
                <option value="done" ${job.status === 'done' ? 'selected' : ''}>Done</option>
                <option value="blocked" ${job.status === 'blocked' ? 'selected' : ''}>Blocked</option>
              </select>
            </label>
            <label>
              Priority
              <select class="job-priority" data-id="${job.id}" ${canManageJobs() ? '' : 'disabled'}>
                <option value="low" ${job.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${job.priority === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="high" ${job.priority === 'high' ? 'selected' : ''}>High</option>
              </select>
            </label>
          </div>
        </article>
      `,
    )
    .join('');

  document.querySelectorAll('.job-status').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const id = event.target.dataset.id;
      await updateJobStatus(id, { status: event.target.value });
    });
  });

  document.querySelectorAll('.job-priority').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const id = event.target.dataset.id;
      await updateJobStatus(id, { priority: event.target.value });
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);

  try {
    await login(formData.get('username'), formData.get('password'));
    await loadProfile();
    await loadJobs();
  } catch (error) {
    alert(error.message);
  }
});

jobForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(jobForm);
  const payload = {
    title: formData.get('title'),
    description: formData.get('description') || '',
    status: formData.get('status'),
    priority: formData.get('priority') || 'medium',
    assignee: formData.get('assignee') || '',
  };

  try {
    await createJob(payload);
  } catch (error) {
    alert(error.message);
  }
});

logoutButton.addEventListener('click', () => {
  state.token = '';
  state.username = '';
  state.role = 'member';
  localStorage.removeItem('worklink-token');
  updateUserBadge();
  setLoggedIn(false);
  jobList.innerHTML = '';
  applyRoleState();
});

updateUserBadge();
setLoggedIn(Boolean(state.token));
if (state.token) {
  loadProfile()
    .then(() => loadJobs())
    .catch(() => {
      state.token = '';
      state.username = '';
      state.role = 'member';
      localStorage.removeItem('worklink-token');
      updateUserBadge();
      setLoggedIn(false);
    });
}
