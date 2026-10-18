'use strict';
const { openDb, createRepo, seed } = require('../db');
const { createServer } = require('../lib/server');

// Serverless: state lives in memory for the life of the function instance.
const repo = createRepo(openDb());
seed(repo);
const server = createServer(repo);

module.exports = (req, res) => server.emit('request', req, res);
