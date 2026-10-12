const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/server');

function request(server, method, path, payload, token, extraHeaders = {}) {
  const { port } = server.address();
  const headers = { ...extraHeaders };

  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(JSON.stringify(payload));
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on('error', reject);

    if (payload) {
      req.write(JSON.stringify(payload));
    }

    req.end();
  });
}

test('GET /health returns status ok', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const response = await request(server, 'GET', '/health');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { status: 'ok', service: 'worklink' });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET / returns welcome payload for API clients', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const response = await request(server, 'GET', '/');
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Welcome to Worklink/);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET / serves the dashboard HTML for browsers', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const response = await request(server, 'GET', '/', undefined, undefined, { Accept: 'text/html' });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Job dashboard/);
    assert.match(response.body, /<script src="\/app.js"><\/script>/);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /login returns a token for valid credentials', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const response = await request(server, 'POST', '/login', { username: 'admin', password: 'admin' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.token);
    assert.equal(body.user.username, 'admin');
    assert.equal(body.user.role, 'admin');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('manager users can log in and receive their role', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const response = await request(server, 'POST', '/login', { username: 'manager', password: 'manager' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.user.username, 'manager');
    assert.equal(body.user.role, 'manager');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /jobs requires authentication', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const response = await request(server, 'GET', '/jobs');
    assert.equal(response.statusCode, 401);
    assert.deepEqual(JSON.parse(response.body), { error: 'Unauthorized' });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('member users can read jobs but cannot create or edit them', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const loginResponse = await request(server, 'POST', '/login', { username: 'member', password: 'member' });
    const token = JSON.parse(loginResponse.body).token;

    const readResponse = await request(server, 'GET', '/jobs', undefined, token);
    assert.equal(readResponse.statusCode, 200);

    const createResponse = await request(server, 'POST', '/jobs', { title: 'Readonly job' }, token);
    assert.equal(createResponse.statusCode, 403);
    assert.deepEqual(JSON.parse(createResponse.body), { error: 'Forbidden' });

    const listResponse = await request(server, 'GET', '/jobs', undefined, token);
    const jobs = JSON.parse(listResponse.body);
    assert.ok(Array.isArray(jobs));

    if (jobs.length > 0) {
      const patchResponse = await request(server, 'PATCH', `/jobs/${jobs[0].id}`, { priority: 'high' }, token);
      assert.equal(patchResponse.statusCode, 403);
      assert.deepEqual(JSON.parse(patchResponse.body), { error: 'Forbidden' });
    }
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /jobs creates a job and GET /jobs/:id gets it with a valid token', async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const loginResponse = await request(server, 'POST', '/login', { username: 'admin', password: 'admin' });
    const token = JSON.parse(loginResponse.body).token;

    const createResponse = await request(server, 'POST', '/jobs', {
      title: 'Build landing page',
      description: 'Create the new homepage hero section',
      status: 'queued',
      priority: 'high',
      assignee: 'alice',
    }, token);
    assert.equal(createResponse.statusCode, 201);
    const created = JSON.parse(createResponse.body);
    assert.equal(created.title, 'Build landing page');
    assert.equal(created.status, 'queued');
    assert.equal(created.priority, 'high');
    assert.equal(created.assignee, 'alice');
    assert.ok(created.id);

    const readResponse = await request(server, 'GET', `/jobs/${created.id}`, undefined, token);
    assert.equal(readResponse.statusCode, 200);
    const job = JSON.parse(readResponse.body);
    assert.equal(job.title, 'Build landing page');
    assert.equal(job.description, 'Create the new homepage hero section');

    const patchResponse = await request(server, 'PATCH', `/jobs/${created.id}`, { status: 'in_progress', priority: 'low' }, token);
    assert.equal(patchResponse.statusCode, 200);
    const patched = JSON.parse(patchResponse.body);
    assert.equal(patched.status, 'in_progress');
    assert.equal(patched.priority, 'low');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
