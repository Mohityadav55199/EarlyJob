'use strict';
const { DatabaseSync } = require('node:sqlite');

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];

function openDb(file = process.env.DB_FILE || ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT DEFAULT '',
      role TEXT NOT NULL,
      skills TEXT DEFAULT '',
      experience REAL DEFAULT 0,
      source TEXT DEFAULT 'Other',
      notes TEXT DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'Applied',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      from_stage TEXT,
      to_stage TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cand_stage ON candidates(stage);
    CREATE INDEX IF NOT EXISTS idx_hist_cand ON stage_history(candidate_id);
  `);
  return db;
}

class ValidationError extends Error {
  constructor(errors) { super('Validation failed'); this.errors = errors; this.status = 400; }
}

function clean(input, { partial = false } = {}) {
  const errors = {};
  const out = {};
  for (const k of ['name', 'email', 'phone', 'role', 'skills', 'source', 'notes']) {
    if (input[k] !== undefined) out[k] = String(input[k]).trim().slice(0, k === 'notes' ? 2000 : 200);
  }
  if (input.experience !== undefined) {
    const n = Number(input.experience);
    if (!Number.isFinite(n) || n < 0 || n > 60) errors.experience = 'Experience must be between 0 and 60 years';
    else out.experience = n;
  }
  if (input.stage !== undefined) {
    if (!STAGES.includes(input.stage)) errors.stage = `Stage must be one of ${STAGES.join(', ')}`;
    else out.stage = input.stage;
  }
  for (const k of ['name', 'email', 'role']) {
    if (!partial && !out[k]) errors[k] = `${k} is required`;
    else if (partial && k in out && !out[k]) errors[k] = `${k} cannot be empty`;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) errors.email = 'Invalid email address';
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

function createRepo(db) {
  const getStmt = db.prepare('SELECT * FROM candidates WHERE id = ?');
  const histStmt = db.prepare('SELECT from_stage, to_stage, changed_at FROM stage_history WHERE candidate_id = ? ORDER BY id');

  function wrapUnique(fn) {
    try { return fn(); } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new ValidationError({ email: 'A candidate with this email already exists' });
      throw e;
    }
  }

  return {
    stages: STAGES,

    get(id) {
      const c = getStmt.get(id);
      return c ? { ...c, history: histStmt.all(id) } : null;
    },

    create(input) {
      const c = clean(input);
      const stage = c.stage || 'Applied';
      return wrapUnique(() => {
        const r = db.prepare(`INSERT INTO candidates (name,email,phone,role,skills,experience,source,notes,stage)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(c.name, c.email, c.phone || '', c.role, c.skills || '',
          c.experience ?? 0, c.source || 'Other', c.notes || '', stage);
        const id = Number(r.lastInsertRowid);
        db.prepare('INSERT INTO stage_history (candidate_id, from_stage, to_stage) VALUES (?,?,?)').run(id, null, stage);
        return this.get(id);
      });
    },

    update(id, input) {
      const existing = getStmt.get(id);
      if (!existing) return null;
      const c = clean(input, { partial: true });
      const keys = Object.keys(c);
      if (!keys.length) return this.get(id);
      return wrapUnique(() => {
        db.prepare(`UPDATE candidates SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...keys.map((k) => c[k]), id);
        if (c.stage && c.stage !== existing.stage) {
          db.prepare('INSERT INTO stage_history (candidate_id, from_stage, to_stage) VALUES (?,?,?)')
            .run(id, existing.stage, c.stage);
        }
        return this.get(id);
      });
    },

    remove(id) {
      return db.prepare('DELETE FROM candidates WHERE id = ?').run(id).changes > 0;
    },

    list({ q = '', stage = '', role = '', sort = 'created_at', dir = 'desc', page = 1, pageSize = 50 } = {}) {
      const where = [];
      const params = [];
      if (q.trim()) {
        const like = '%' + q.trim().replace(/[\\%_]/g, (m) => '\\' + m) + '%';
        const cols = ['name', 'email', 'role', 'skills', 'notes'];
        where.push('(' + cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
        cols.forEach(() => params.push(like));
      }
      if (stage) { where.push('stage = ?'); params.push(stage); }
      if (role) { where.push('role = ?'); params.push(role); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const sortCol = ['name', 'role', 'stage', 'experience', 'created_at', 'updated_at'].includes(sort) ? sort : 'created_at';
      const d = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      page = Math.max(1, parseInt(page, 10) || 1);
      pageSize = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 50));
      const total = db.prepare(`SELECT COUNT(*) n FROM candidates ${w}`).get(...params).n;
      const items = db.prepare(`SELECT * FROM candidates ${w} ORDER BY ${sortCol} ${d}, id DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize);
      return { items, total, page, pageSize };
    },

    roles() {
      return db.prepare('SELECT DISTINCT role FROM candidates ORDER BY role').all().map((r) => r.role);
    },

    metrics() {
      const total = db.prepare('SELECT COUNT(*) n FROM candidates').get().n;
      const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
      db.prepare('SELECT stage, COUNT(*) n FROM candidates GROUP BY stage').all().forEach((r) => { byStage[r.stage] = r.n; });
      const group = (col) => db.prepare(`SELECT ${col} label, COUNT(*) count FROM candidates GROUP BY ${col} ORDER BY count DESC, label`).all();
      const { Hired: hired, Rejected: rejected } = byStage;
      // funnel: candidates who ever reached each stage
      const funnel = STAGES.filter((s) => s !== 'Rejected').map((s) => ({
        stage: s,
        count: db.prepare('SELECT COUNT(DISTINCT candidate_id) n FROM stage_history WHERE to_stage = ?').get(s).n,
      }));
      const days = db.prepare(`SELECT AVG(julianday(h.changed_at) - julianday(c.created_at)) d FROM stage_history h
        JOIN candidates c ON c.id = h.candidate_id WHERE h.to_stage = 'Hired' AND c.stage = 'Hired'`).get().d;
      const last7 = db.prepare("SELECT COUNT(*) n FROM candidates WHERE created_at >= datetime('now','-7 days')").get().n;
      return {
        total, active: total - hired - rejected, hired, rejected, newLast7Days: last7,
        hireRate: total ? +(hired / total * 100).toFixed(1) : 0,
        avgDaysToHire: days == null ? null : +days.toFixed(1),
        byStage, funnel, byRole: group('role'), bySource: group('source'),
      };
    },
  };
}

function seed(repo) {
  const data = [
    ['Aarav Sharma', 'aarav.sharma@example.com', 'Frontend Developer', 'React, TypeScript, CSS', 3, 'LinkedIn', 'Applied'],
    ['Priya Nair', 'priya.nair@example.com', 'Frontend Developer', 'Vue, JavaScript', 2, 'Referral', 'Screening'],
    ['Rohan Mehta', 'rohan.mehta@example.com', 'Backend Developer', 'Node.js, PostgreSQL, AWS', 5, 'Job Board', 'Interview'],
    ['Sneha Iyer', 'sneha.iyer@example.com', 'Backend Developer', 'Java, Spring, Kafka', 6, 'LinkedIn', 'Offer'],
    ['Karan Verma', 'karan.verma@example.com', 'Product Designer', 'Figma, Prototyping', 4, 'Referral', 'Hired'],
    ['Ananya Das', 'ananya.das@example.com', 'Product Designer', 'Figma, UX Research', 1, 'Career Site', 'Rejected'],
    ['Vikram Singh', 'vikram.singh@example.com', 'Data Analyst', 'SQL, Python, Tableau', 2, 'Job Board', 'Interview'],
    ['Meera Joshi', 'meera.joshi@example.com', 'Data Analyst', 'SQL, Excel, PowerBI', 3, 'LinkedIn', 'Applied'],
    ['Arjun Reddy', 'arjun.reddy@example.com', 'Backend Developer', 'Python, Django', 4, 'Career Site', 'Screening'],
    ['Isha Kapoor', 'isha.kapoor@example.com', 'Frontend Developer', 'React, Next.js', 5, 'Referral', 'Hired'],
  ];
  const path = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'];
  for (const [name, email, role, skills, experience, source, stage] of data) {
    const c = repo.create({ name, email, role, skills, experience, source });
    const steps = stage === 'Rejected' ? ['Screening', 'Rejected'] : path.slice(1, path.indexOf(stage) + 1);
    for (const s of steps) repo.update(c.id, { stage: s });
  }
}

module.exports = { openDb, createRepo, seed, STAGES, ValidationError };
