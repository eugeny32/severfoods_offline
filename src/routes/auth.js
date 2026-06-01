const router = require('express').Router();
const fetch  = require('node-fetch');
const crypto = require('crypto');
const db     = require('../db');

const SERVER_URL = 'https://severfoods.ru/api/offline_sync.php';

function hashPw(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
}

// GET /api/auth/me — restore session from cache
router.get('/me', (req, res) => {
    const raw = db.getMeta('session');
    if (!raw) return res.status(401).json({ ok: false });
    try {
        const sess = JSON.parse(raw);
        if (new Date(sess.expires_at) > new Date()) {
            return res.json({ ok: true, employee: sess.employee });
        }
    } catch (_) {}
    res.status(401).json({ ok: false });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { login, password } = req.body || {};
    if (!login || !password) {
        return res.status(400).json({ ok: false, error: 'Введите логин и пароль' });
    }

    // Try server auth
    try {
        const r = await fetch(`${SERVER_URL}?action=auth`, {
            method:  'POST',
            headers: {
                'X-Sync-Token': process.env.OFFLINE_SYNC_TOKEN || '',
                'Content-Type': 'application/json',
            },
            body:    JSON.stringify({ login, password }),
            timeout: 10000,
        });
        const data = await r.json();
        if (!data.ok) return res.status(401).json({ ok: false, error: data.error });

        // Cache session + local pw hash for offline reauth
        const session = { employee: data.employee, session_token: data.session_token, expires_at: data.expires_at };
        db.setMeta('session', JSON.stringify(session));
        db.setMeta('pw_hash_' + login, hashPw(password, login));

        return res.json({ ok: true, employee: data.employee });
    } catch (_) {
        // Offline fallback: verify cached password hash
        const raw = db.getMeta('session');
        if (raw) {
            try {
                const sess = JSON.parse(raw);
                if (sess.employee?.login === login && new Date(sess.expires_at) > new Date()) {
                    const storedHash = db.getMeta('pw_hash_' + login);
                    if (storedHash && storedHash === hashPw(password, login)) {
                        return res.json({ ok: true, employee: sess.employee, offline: true });
                    }
                }
            } catch (_2) {}
        }
        return res.status(401).json({ ok: false, error: 'Нет связи с сервером. Войдите онлайн хотя бы один раз.' });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    db.setMeta('session', null);
    res.json({ ok: true });
});

module.exports = router;
