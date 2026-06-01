const path = require('path');
const fs   = require('fs');
const initSqlJs = require('sql.js');

let db     = null;
let dbPath = null;

async function init() {
    const { app } = require('electron');
    dbPath = path.join(app.getPath('userData'), 'severfoods.db');
    _dbPath = dbPath;

    const SQL = await initSqlJs();
    db = fs.existsSync(dbPath)
        ? new SQL.Database(fs.readFileSync(dbPath))
        : new SQL.Database();

    db.run(`PRAGMA foreign_keys = ON`);
    _createSchema();
    _save();
}

function _save() {
    if (!db || !dbPath) return;
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function _createSchema() {
    db.run(`
        CREATE TABLE IF NOT EXISTS employees (
            id                INTEGER PRIMARY KEY,
            full_name         TEXT NOT NULL,
            birth_date        TEXT,
            organization      TEXT,
            department        TEXT,
            position          TEXT,
            vjg_type          TEXT,
            price             REAL DEFAULT 0,
            qr_code           TEXT,
            qr_expires_at     TEXT,
            qr_status         TEXT,
            is_active         INTEGER DEFAULT 1,
            role              TEXT,
            login             TEXT,
            assigned_point_id INTEGER,
            updated_ts        INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS meal_points (
            id         INTEGER PRIMARY KEY,
            point_name TEXT, point_code TEXT,
            city TEXT, address TEXT, is_active INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS meal_point_schedules (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            meal_point_id INTEGER,
            meal_type TEXT, start_time TEXT, end_time TEXT, days_of_week TEXT
        );
        CREATE TABLE IF NOT EXISTS meal_logs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            offline_id      TEXT UNIQUE,
            employee_id     INTEGER NOT NULL,
            meal_type       TEXT NOT NULL,
            access_granted  INTEGER DEFAULT 1,
            meal_point_id   INTEGER,
            meal_point_name TEXT,
            operator_name   TEXT DEFAULT 'Офлайн',
            scanned_at      TEXT NOT NULL,
            synced          INTEGER DEFAULT 0,
            server_id       INTEGER
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY, value TEXT
        );
    `);

    // add login column if upgrading from older schema
    try { db.run(`ALTER TABLE employees ADD COLUMN login TEXT`); } catch (_) {}
}

// ── helpers ──────────────────────────────────────────────

function _all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function _get(sql, params = []) {
    return _all(sql, params)[0] || null;
}

function _run(sql, params = []) {
    db.run(sql, params);
    _save();
}

// ── employees ─────────────────────────────────────────────

function upsertEmployee(e) {
    _run(`
        INSERT INTO employees
            (id, full_name, birth_date, organization, department, position,
             vjg_type, price, qr_code, qr_expires_at, qr_status,
             is_active, role, login, assigned_point_id, updated_ts)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            full_name=excluded.full_name, birth_date=excluded.birth_date,
            organization=excluded.organization, department=excluded.department,
            position=excluded.position, vjg_type=excluded.vjg_type,
            price=excluded.price, qr_code=excluded.qr_code,
            qr_expires_at=excluded.qr_expires_at, qr_status=excluded.qr_status,
            is_active=excluded.is_active, role=excluded.role,
            login=excluded.login,
            assigned_point_id=excluded.assigned_point_id, updated_ts=excluded.updated_ts
    `, [
        e.id, e.full_name, e.birth_date ?? null, e.organization ?? null,
        e.department ?? null, e.position ?? null, e.vjg_type ?? null,
        e.price ?? 0, e.qr_code ?? null, e.qr_expires_at ?? null,
        e.qr_status ?? null, e.is_active ?? 1, e.role ?? null,
        e.login ?? null, e.assigned_point_id ?? null, e.updated_ts ?? 0,
    ]);
}

function getAllEmployees() {
    return _all('SELECT * FROM employees WHERE is_active = 1 ORDER BY organization, full_name');
}

function getEmployeeByQr(qrCode) {
    return _get('SELECT * FROM employees WHERE qr_code = ? AND is_active = 1 LIMIT 1', [qrCode]);
}

// ── meal_points ───────────────────────────────────────────

function upsertMealPoint(p, schedules) {
    _run(`INSERT INTO meal_points (id, point_name, point_code, city, address, is_active)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            point_name=excluded.point_name, point_code=excluded.point_code,
            city=excluded.city, address=excluded.address, is_active=excluded.is_active`,
        [p.id, p.point_name, p.point_code, p.city, p.address, p.is_active]);

    db.run('DELETE FROM meal_point_schedules WHERE meal_point_id = ?', [p.id]);
    for (const s of (schedules || [])) {
        db.run('INSERT INTO meal_point_schedules (meal_point_id, meal_type, start_time, end_time, days_of_week) VALUES (?,?,?,?,?)',
            [p.id, s.meal_type, s.start_time, s.end_time, s.days_of_week]);
    }
    _save();
}

function getMealPoints() {
    return _all('SELECT * FROM meal_points WHERE is_active = 1 ORDER BY point_name').map(p => ({
        ...p, schedules: _all('SELECT * FROM meal_point_schedules WHERE meal_point_id = ?', [p.id]),
    }));
}

// ── meal_logs ─────────────────────────────────────────────

function insertMealLog(log) {
    _run(`INSERT INTO meal_logs
            (offline_id, employee_id, meal_type, access_granted,
             meal_point_id, meal_point_name, operator_name, scanned_at, synced)
          VALUES (?,?,?,1,?,?,?,?,0)`,
        [log.offline_id, log.employee_id, log.meal_type,
         log.meal_point_id ?? null, log.meal_point_name ?? 'Офлайн',
         log.operator_name ?? 'Офлайн', log.scanned_at]);
}

function getMealLogs(limit = 200, offset = 0, pointId = null, since = null) {
    let where = '';
    const params = [];
    if (pointId) { where += ' AND ml.meal_point_id = ?'; params.push(parseInt(pointId)); }
    if (since)   { where += ' AND ml.scanned_at >= ?';   params.push(since); }
    params.push(limit, offset);
    return _all(`SELECT ml.*, e.full_name AS employee_name, e.organization
                 FROM meal_logs ml LEFT JOIN employees e ON e.id = ml.employee_id
                 WHERE 1=1 ${where}
                 ORDER BY ml.scanned_at DESC LIMIT ? OFFSET ?`, params);
}

function getUnsyncedLogs() {
    return _all('SELECT * FROM meal_logs WHERE synced = 0 ORDER BY scanned_at ASC');
}

function markLogsSynced(results) {
    for (const r of results) {
        if (r.status === 'ok' || r.status === 'duplicate') {
            db.run('UPDATE meal_logs SET synced=1, server_id=? WHERE offline_id=?', [r.server_id || null, r.offline_id]);
        }
    }
    _save();
}

function hasTodayLog(employeeId, mealType) {
    const today = new Date().toISOString().slice(0, 10);
    return !!_get(`SELECT 1 FROM meal_logs
                   WHERE employee_id=? AND meal_type=? AND DATE(scanned_at)=? AND access_granted=1 LIMIT 1`,
        [employeeId, mealType, today]);
}

// ── sync_meta ─────────────────────────────────────────────

function getMeta(key) {
    const row = _get('SELECT value FROM sync_meta WHERE key=?', [key]);
    return row ? row.value : null;
}

function setMeta(key, value) {
    _run('INSERT INTO sync_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [key, value === null ? null : String(value)]);
}

function updateSchedules(pointId, schedules) {
    db.run('DELETE FROM meal_point_schedules WHERE meal_point_id = ?', [pointId]);
    for (const s of schedules) {
        db.run('INSERT INTO meal_point_schedules (meal_point_id, meal_type, start_time, end_time, days_of_week) VALUES (?,?,?,?,?)',
            [pointId, s.meal_type, s.start_time, s.end_time, s.days_of_week || null]);
    }
    _save();
}

let _dbPath = null;
function getDbPath() { return _dbPath; }

module.exports = {
    init,
    upsertEmployee, getAllEmployees, getEmployeeByQr,
    upsertMealPoint, getMealPoints, updateSchedules,
    insertMealLog, getMealLogs, getUnsyncedLogs, markLogsSynced, hasTodayLog,
    getMeta, setMeta, getDbPath,
};
