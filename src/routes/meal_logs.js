const router = require('express').Router();
const db     = require('../db');
const crypto = require('crypto');

const VALID_TYPES = ['breakfast', 'lunch', 'dinner', 'night'];

// GET /api/meal_logs?limit=200&offset=0&point_id=N
router.get('/', (req, res) => {
    const limit   = Math.min(parseInt(req.query.limit   || '200'), 1000);
    const offset  = parseInt(req.query.offset  || '0');
    const pointId = req.query.point_id ? parseInt(req.query.point_id) : null;
    res.json({ ok: true, logs: db.getMealLogs(limit, offset, pointId) });
});

// POST /api/meal_logs — register a meal scan
router.post('/', (req, res) => {
    const { employee_id, meal_type, meal_point_id, meal_point_name, operator_name } = req.body || {};

    if (!employee_id || !VALID_TYPES.includes(meal_type)) {
        return res.status(400).json({ ok: false, error: 'invalid_params' });
    }

    // local dedup: same employee + type + today
    if (db.hasTodayLog(employee_id, meal_type)) {
        return res.json({ ok: false, error: 'duplicate', message: 'Уже зафиксировано сегодня' });
    }

    const offline_id  = crypto.randomUUID();
    const scanned_at  = new Date().toISOString().replace('T', ' ').slice(0, 19);

    db.insertMealLog({
        offline_id,
        employee_id,
        meal_type,
        meal_point_id:   meal_point_id   || null,
        meal_point_name: meal_point_name || 'Офлайн',
        operator_name:   operator_name   || 'Офлайн',
        scanned_at,
    });

    res.json({ ok: true, offline_id, scanned_at });
});

module.exports = router;
