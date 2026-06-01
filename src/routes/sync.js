const router = require('express').Router();
const sync   = require('../sync');

router.get('/status', (req, res) => {
    res.json({ ok: true, status: sync.getStatus() });
});

router.post('/now', async (req, res) => {
    await sync.runSync();
    res.json({ ok: true, status: sync.getStatus() });
});

module.exports = router;
