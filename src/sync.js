const fetch = require('node-fetch');
const db    = require('./db');

const BASE_URL    = 'https://severfoods.ru/api/offline_sync.php';
const SYNC_TOKEN  = process.env.OFFLINE_SYNC_TOKEN || '';
const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let _status = {
    online:       false,
    lastSync:     null,
    lastSyncOk:   false,
    syncError:    null,
    inProgress:   false,
    employees:    0,
    mealPoints:   0,
};
let _timer   = null;
let _netCheck = null;

function getStatus() {
    return { ..._status };
}

// Broadcast status to renderer via BrowserWindow if available
function notifyStatus() {
    try {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(w => {
            w.webContents.send('sync-status-update', getStatus());
        });
    } catch (_) {}
}

async function api(action, opts = {}) {
    const url    = `${BASE_URL}?action=${action}`;
    const method = opts.method || 'GET';
    const body   = opts.body ? JSON.stringify(opts.body) : undefined;
    const since  = opts.since ? `&since=${encodeURIComponent(opts.since)}` : '';

    const res = await fetch(url + since, {
        method,
        headers: {
            'X-Sync-Token':  SYNC_TOKEN,
            'Content-Type':  'application/json',
        },
        body,
        timeout: 15000,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Server error');
    return data;
}

async function checkOnline() {
    try {
        await api('ping');
        return true;
    } catch (_) {
        return false;
    }
}

async function pullEmployees() {
    const data = await api('employees');
    for (const e of data.employees) {
        db.upsertEmployee(e);
    }
    return data.employees.length;
}

async function pullMealPoints() {
    const data = await api('meal_points');
    for (const p of data.meal_points) {
        db.upsertMealPoint(p, p.schedules);
    }
    return data.meal_points.length;
}

async function pushLogs() {
    const logs = db.getUnsyncedLogs();
    if (!logs.length) return { inserted: 0, skipped: 0, errors: 0 };

    const data = await api('push', {
        method: 'POST',
        body: { records: logs },
    });

    db.markLogsSynced(data.results || []);
    return { inserted: data.inserted, skipped: data.skipped, errors: data.errors };
}

async function runSync() {
    if (_status.inProgress) return;
    _status.inProgress = true;
    notifyStatus();

    try {
        const online = await checkOnline();
        _status.online = online;

        if (!online) {
            _status.lastSyncOk = false;
            _status.syncError  = 'Нет подключения к серверу';
            return;
        }

        const empCount = await pullEmployees();
        const ptCount  = await pullMealPoints();
        const pushRes  = await pushLogs();

        _status.employees   = empCount;
        _status.mealPoints  = ptCount;
        _status.lastSync    = new Date().toISOString();
        _status.lastSyncOk  = true;
        _status.syncError   = null;

        db.setMeta('last_sync', _status.lastSync);
        db.setMeta('employees_count', String(empCount));

        console.log(`[sync] OK — emp:${empCount} pts:${ptCount} pushed:${pushRes.inserted} dup:${pushRes.skipped}`);
    } catch (err) {
        _status.lastSyncOk = false;
        _status.syncError  = err.message;
        console.error('[sync] error:', err.message);
    } finally {
        _status.inProgress = false;
        notifyStatus();
    }
}

async function networkMonitorLoop() {
    let wasOnline = _status.online;
    const isNow   = await checkOnline();
    _status.online = isNow;

    if (!wasOnline && isNow) {
        console.log('[sync] Network restored — triggering sync');
        await runSync();
    }
}

function init() {
    // restore last sync time from db
    const last = db.getMeta('last_sync');
    if (last) _status.lastSync = last;

    // initial sync
    setTimeout(runSync, 5000);

    // hourly timer
    _timer = setInterval(runSync, SYNC_INTERVAL_MS);

    // network monitor every 30s
    _netCheck = setInterval(networkMonitorLoop, 30_000);
}

function destroy() {
    if (_timer)    clearInterval(_timer);
    if (_netCheck) clearInterval(_netCheck);
}

module.exports = { init, destroy, runSync, getStatus };
