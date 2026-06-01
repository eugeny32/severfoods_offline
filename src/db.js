const Database = require('better-sqlite3');
const path     = require('path');
const { app }  = require('electron');

let db;

function getDb() {
    if (db) return db;

    const dbPath = path.join(app.getPath('userData'), 'severfoods.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS employees (
            id               INTEGER PRIMARY KEY,
            full_name        TEXT    NOT NULL,
            birth_date       TEXT,
            organization     TEXT,
            department       TEXT,
            position         TEXT,
            vjg_type         TEXT,
            price            REAL    DEFAULT 0,
            qr_code          TEXT,
            qr_expires_at    TEXT,
            qr_status        TEXT,
            is_active        INTEGER DEFAULT 1,
            role             TEXT,
            assigned_point_id INTEGER,
            updated_ts       INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS meal_points (
            id         INTEGER PRIMARY KEY,
            point_name TEXT,
            point_code TEXT,
            city       TEXT,
            address    TEXT,
            is_active  INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS meal_point_schedules (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            meal_point_id  INTEGER,
            meal_type      TEXT,
            start_time     TEXT,
            end_time       TEXT,
            days_of_week   TEXT
        );

        CREATE TABLE IF NOT EXISTS meal_logs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            offline_id      TEXT UNIQUE,
            employee_id     INTEGER NOT NULL,
            meal_type       TEXT    NOT NULL,
            access_granted  INTEGER DEFAULT 1,
            meal_point_id   INTEGER,
            meal_point_name TEXT,
            operator_name   TEXT    DEFAULT 'Офлайн',
            scanned_at      TEXT    NOT NULL,
            synced          INTEGER DEFAULT 0,
            server_id       INTEGER
        );

        CREATE TABLE IF NOT EXISTS sync_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_meal_logs_unsynced
            ON meal_logs(synced) WHERE synced = 0;

        CREATE INDEX IF NOT EXISTS idx_employees_qr
            ON employees(qr_code) WHERE qr_code IS NOT NULL;
    `);

    return db;
}

// ── employees ────────────────────────────────────────────

function upsertEmployee(e) {
    const db = getDb();
    db.prepare(`
        INSERT INTO employees
            (id, full_name, birth_date, organization, department, position,
             vjg_type, price, qr_code, qr_expires_at, qr_status,
             is_active, role, assigned_point_id, updated_ts)
        VALUES
            (@id, @full_name, @birth_date, @organization, @department, @position,
             @vjg_type, @price, @qr_code, @qr_expires_at, @qr_status,
             @is_active, @role, @assigned_point_id, @updated_ts)
        ON CONFLICT(id) DO UPDATE SET
            full_name         = excluded.full_name,
            birth_date        = excluded.birth_date,
            organization      = excluded.organization,
            department        = excluded.department,
            position          = excluded.position,
            vjg_type          = excluded.vjg_type,
            price             = excluded.price,
            qr_code           = excluded.qr_code,
            qr_expires_at     = excluded.qr_expires_at,
            qr_status         = excluded.qr_status,
            is_active         = excluded.is_active,
            role              = excluded.role,
            assigned_point_id = excluded.assigned_point_id,
            updated_ts        = excluded.updated_ts
    `).run(e);
}

function getAllEmployees() {
    return getDb().prepare(
        'SELECT * FROM employees WHERE is_active = 1 ORDER BY full_name'
    ).all();
}

function getEmployeeByQr(qrCode) {
    return getDb().prepare(
        'SELECT * FROM employees WHERE qr_code = ? AND is_active = 1 LIMIT 1'
    ).get(qrCode) || null;
}

// ── meal_points ──────────────────────────────────────────

function upsertMealPoint(p, schedules) {
    const db = getDb();
    db.prepare(`
        INSERT INTO meal_points (id, point_name, point_code, city, address, is_active)
        VALUES (@id, @point_name, @point_code, @city, @address, @is_active)
        ON CONFLICT(id) DO UPDATE SET
            point_name = excluded.point_name,
            point_code = excluded.point_code,
            city       = excluded.city,
            address    = excluded.address,
            is_active  = excluded.is_active
    `).run(p);

    db.prepare('DELETE FROM meal_point_schedules WHERE meal_point_id = ?').run(p.id);
    const ins = db.prepare(`
        INSERT INTO meal_point_schedules (meal_point_id, meal_type, start_time, end_time, days_of_week)
        VALUES (?, ?, ?, ?, ?)
    `);
    for (const s of (schedules || [])) {
        ins.run(p.id, s.meal_type, s.start_time, s.end_time, s.days_of_week);
    }
}

function getMealPoints() {
    const db   = getDb();
    const pts  = db.prepare('SELECT * FROM meal_points WHERE is_active = 1 ORDER BY point_name').all();
    const sch  = db.prepare('SELECT * FROM meal_point_schedules WHERE meal_point_id = ?');
    return pts.map(p => ({ ...p, schedules: sch.all(p.id) }));
}

// ── meal_logs ─────────────────────────────────────────────

function insertMealLog(log) {
    return getDb().prepare(`
        INSERT INTO meal_logs
            (offline_id, employee_id, meal_type, access_granted,
             meal_point_id, meal_point_name, operator_name, scanned_at, synced)
        VALUES
            (@offline_id, @employee_id, @meal_type, 1,
             @meal_point_id, @meal_point_name, @operator_name, @scanned_at, 0)
    `).run(log);
}

function getMealLogs(limit = 200, offset = 0) {
    return getDb().prepare(`
        SELECT ml.*, e.full_name AS employee_name, e.organization
        FROM meal_logs ml
        LEFT JOIN employees e ON e.id = ml.employee_id
        ORDER BY ml.scanned_at DESC
        LIMIT ? OFFSET ?
    `).all(limit, offset);
}

function getUnsyncedLogs() {
    return getDb().prepare(
        'SELECT * FROM meal_logs WHERE synced = 0 ORDER BY scanned_at ASC'
    ).all();
}

function markLogsSynced(results) {
    const db  = getDb();
    const upd = db.prepare(
        'UPDATE meal_logs SET synced = 1, server_id = ? WHERE offline_id = ?'
    );
    const tx = db.transaction((rows) => {
        for (const r of rows) {
            if (r.status === 'ok' || r.status === 'duplicate') {
                upd.run(r.server_id || null, r.offline_id);
            }
        }
    });
    tx(results);
}

function hasTodayLog(employeeId, mealType) {
    const today = new Date().toISOString().slice(0, 10);
    return !!getDb().prepare(`
        SELECT 1 FROM meal_logs
        WHERE employee_id = ? AND meal_type = ? AND DATE(scanned_at) = ? AND access_granted = 1
        LIMIT 1
    `).get(employeeId, mealType, today);
}

// ── sync_meta ────────────────────────────────────────────

function getMeta(key) {
    const row = getDb().prepare('SELECT value FROM sync_meta WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setMeta(key, value) {
    getDb().prepare(
        'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, String(value));
}

module.exports = {
    getDb,
    upsertEmployee, getAllEmployees, getEmployeeByQr,
    upsertMealPoint, getMealPoints,
    insertMealLog, getMealLogs, getUnsyncedLogs, markLogsSynced, hasTodayLog,
    getMeta, setMeta,
};
