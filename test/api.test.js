'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDb, createRepo } = require('../db');
const { createServer } = require('../lib/server');

let server, base;
test.before(async () => {
  server = createServer(createRepo(openDb(':memory:')));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

const call = (p, method = 'GET', body) => fetch(base + p, {
  method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
});

test('create, validate, duplicate', async () => {
  let r = await call('/api/candidates', 'POST', { name: 'A', email: 'a@x.com', role: 'Dev' });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).stage, 'Applied');
  r = await call('/api/candidates', 'POST', { name: '', email: 'bad', role: '' });
  assert.equal(r.status, 400);
  r = await call('/api/candidates', 'POST', { name: 'B', email: 'A@X.com', role: 'Dev' });
  assert.equal(r.status, 400);
  assert.ok((await r.json()).errors.email);
});

test('stage change records history and rejects bad stage', async () => {
  const c = await (await call('/api/candidates', 'POST', { name: 'C', email: 'c@x.com', role: 'QA' })).json();
  let r = await call(`/api/candidates/${c.id}`, 'PATCH', { stage: 'Interview' });
  const u = await r.json();
  assert.equal(u.stage, 'Interview');
  assert.equal(u.history.length, 2);
  r = await call(`/api/candidates/${c.id}`, 'PATCH', { stage: 'Nope' });
  assert.equal(r.status, 400);
});

test('search, filter, metrics, delete', async () => {
  await call('/api/candidates', 'POST', { name: 'Zed Rust', email: 'z@x.com', role: 'Dev', skills: 'Rust' });
  let list = await (await call('/api/candidates?q=rust')).json();
  assert.equal(list.total, 1);
  list = await (await call('/api/candidates?stage=Interview')).json();
  assert.equal(list.total, 1);
  const m = await (await call('/api/metrics')).json();
  assert.equal(m.total, 3);
  assert.equal(m.byStage.Interview, 1);
  const id = list.items[0].id;
  assert.equal((await call(`/api/candidates/${id}`, 'DELETE')).status, 204);
  assert.equal((await call(`/api/candidates/${id}`)).status, 404);
});
