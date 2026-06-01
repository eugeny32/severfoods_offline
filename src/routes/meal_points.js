const router = require('express').Router();
const db     = require('../db');

router.get('/', (req, res) => {
    res.json({ ok: true, meal_points: db.getMealPoints() });
});

module.exports = router;
