const express = require('express');
const path    = require('path');

const authRouter       = require('./routes/auth');
const employeesRouter  = require('./routes/employees');
const mealLogsRouter   = require('./routes/meal_logs');
const mealPointsRouter = require('./routes/meal_points');
const syncRouter       = require('./routes/sync');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth',        authRouter);
app.use('/api/employees',   employeesRouter);
app.use('/api/meal_logs',   mealLogsRouter);
app.use('/api/meal_points', mealPointsRouter);
app.use('/api/sync',        syncRouter);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

function start(port) {
    return new Promise((resolve, reject) => {
        const srv = app.listen(port, '127.0.0.1', () => { console.log(`[server] :${port}`); resolve(srv); });
        srv.on('error', reject);
    });
}

module.exports = { start };
