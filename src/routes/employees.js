const router = require('express').Router();
const db     = require('../db');

// GET /api/employees — list all active employees
router.get('/', (req, res) => {
    const q    = (req.query.q || '').toLowerCase();
    let rows   = db.getAllEmployees();
    if (q) {
        rows = rows.filter(e =>
            e.full_name.toLowerCase().includes(q) ||
            (e.organization || '').toLowerCase().includes(q) ||
            (e.department   || '').toLowerCase().includes(q)
        );
    }
    res.json({ ok: true, employees: rows });
});

// GET /api/employees/scan?qr=... — look up by QR code
router.get('/scan', (req, res) => {
    const qr  = req.query.qr || '';
    const emp = db.getEmployeeByQr(qr);
    if (!emp) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, employee: emp });
});

module.exports = router;
