const router = require('express').Router();
const fetch  = require('node-fetch');
const db     = require('../db');

// Use HTTPS explicitly to avoid HTTP→HTTPS redirect (which converts POST→GET)
const SERVER_URL = 'https://www.severfoods.ru/api/offline_sync.php';

function syncToken() { return process.env.OFFLINE_SYNC_TOKEN || ''; }

// GET /api/auth/me
router.get('/me', (req, res) => {
    const raw = db.getMeta('session');
    if (!raw) return res.status(401).json({ ok: false });
    try {
        const sess = JSON.parse(raw);
        if (new Date(sess.expires_at) > new Date()) return res.json({ ok: true, employee: sess.employee });
    } catch (_) {}
    res.status(401).json({ ok: false });
});

// POST /api/auth/login  — QR-based, same as web version
router.post('/login', async (req, res) => {
    const { qr_code, role, meal_point_id } = req.body || {};
    if (!qr_code) return res.status(400).json({ ok: false, error: 'Отсканируйте QR-код' });

    // Try server auth
    try {
        const r = await fetch(`${SERVER_URL}?action=auth`, {
            method:  'POST',
            headers: {
                'X-Sync-Token': syncToken(),
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body:    JSON.stringify({ qr_code, role: role || 'operator', meal_point_id }),
            redirect: 'follow',
            timeout: 12000,
        });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch(_) { throw new Error('Bad response: ' + text.slice(0,100)); }
        if (!data.ok) return res.status(401).json({ ok: false, error: data.error });

        db.setMeta('session', JSON.stringify({ employee: data.employee, expires_at: data.expires_at }));
        return res.json({ ok: true, employee: data.employee });

    } catch (_) {
        // Offline fallback: look up QR in local employees table
        const emp = db.getEmployeeByQr(qr_code);
        if (!emp) return res.status(401).json({ ok: false, error: 'QR-код не найден. Подключитесь к серверу для первой синхронизации.' });

        const adminRoles    = ['admin', 'super_admin'];
        const operatorRoles = ['operator', 'admin', 'super_admin'];

        if (role === 'admin' && !adminRoles.includes(emp.role)) {
            return res.status(401).json({ ok: false, error: 'Недостаточно прав для входа как администратор' });
        }
        if (role === 'operator' && !operatorRoles.includes(emp.role)) {
            return res.status(401).json({ ok: false, error: 'Недостаточно прав для входа как оператор' });
        }

        // Attach selected point from local DB if provided
        if (meal_point_id) {
            emp.selected_point_id = parseInt(meal_point_id);
            const pts = db.getMealPoints();
            const pt  = pts.find(p => p.id === emp.selected_point_id);
            emp.selected_point_name = pt ? pt.point_name : null;
        }

        const expires_at = new Date(Date.now() + 30 * 86400_000).toISOString();
        db.setMeta('session', JSON.stringify({ employee: emp, expires_at }));
        return res.json({ ok: true, employee: emp, offline: true });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    db.setMeta('session', null);
    res.json({ ok: true });
});

module.exports = router;
