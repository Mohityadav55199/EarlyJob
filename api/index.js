'use strict';

// Serverless: state lives in memory for the life of the function instance.
let handler;
let initError;
try {
  const { openDb, createRepo, seed } = require('../db');
  const { createServer } = require('../lib/server');
  const repo = createRepo(openDb());
  seed(repo);
  const server = createServer(repo);
  handler = (req, res) => server.emit('request', req, res);
} catch (e) {
  initError = e;
  console.error('Startup failed:', e);
}

module.exports = (req, res) => {
  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Startup failed', message: String(initError.message), node: process.version }));
  }
  return handler(req, res);
};
