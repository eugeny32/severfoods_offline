'use strict';

// ── State ──────────────────────────────────────────────────
let currentPage    = 'scanner';
let currentMealType = 'breakfast';
let scannerActive  = false;
let scanCooldown   = false;
let allEmployees   = [];

const MEAL_LABELS = {
    breakfast: 'Завтрак',
    lunch:     'Обед',
    dinner:    'Ужин',
    night:     'Ночной приём',
};

// ── Navigation ─────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        navigateTo(page);
    });
});

function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

    if (page === 'scanner')   startScanner();
    else                       stopScanner();

    if (page === 'employees') loadEmployees();
    if (page === 'logs')      loadLogs();
    if (page === 'settings')  loadSettingsInfo();
}

// ── Meal type picker ───────────────────────────────────────
document.querySelectorAll('.mt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentMealType = btn.dataset.type;
        document.querySelectorAll('.mt-btn').forEach(b => b.classList.toggle('active', b.dataset.type === currentMealType));
        clearResult();
    });
});

// ── Scanner ────────────────────────────────────────────────
let scanInterval = null;
let videoStream  = null;

async function startScanner() {
    if (scannerActive) return;
    scannerActive = true;
    clearResult();

    const video  = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');
    const ctx    = canvas.getContext('2d', { willReadFrequently: true });

    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = videoStream;
        await video.play();

        scanInterval = setInterval(() => {
            if (scanCooldown || !scannerActive) return;
            if (video.readyState < video.HAVE_ENOUGH_DATA) return;

            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Use jsQR via global (loaded from CDN or local)
            if (typeof jsQR !== 'undefined') {
                const code = jsQR(imgData.data, imgData.width, imgData.height, {
                    inversionAttempts: 'dontInvert',
                });
                if (code && code.data) {
                    handleQrScan(code.data);
                }
            }
        }, 200);
    } catch (err) {
        console.error('Camera error:', err);
        showHint('Нет доступа к камере. Используйте ручной ввод.');
    }
}

function stopScanner() {
    scannerActive = false;
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    if (videoStream)  { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
}

async function handleQrScan(qrData) {
    if (scanCooldown) return;
    scanCooldown = true;

    try {
        const res  = await fetch(`/api/employees/scan?qr=${encodeURIComponent(qrData)}`);
        const data = await res.json();

        if (!data.ok) {
            showResult(null, 'error', 'QR-код не распознан или сотрудник не найден');
            return;
        }

        const emp = data.employee;
        const log = await fetch('/api/meal_logs', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                employee_id:     emp.id,
                meal_type:       currentMealType,
                meal_point_name: 'Офлайн',
                operator_name:   'Сканер',
            }),
        }).then(r => r.json());

        if (log.ok) {
            showResult(emp, 'ok', `${MEAL_LABELS[currentMealType]} зафиксирован`);
        } else if (log.error === 'duplicate') {
            showResult(emp, 'dup', log.message || 'Уже зафиксировано сегодня');
        } else {
            showResult(emp, 'error', log.message || 'Ошибка записи');
        }
    } catch (err) {
        showResult(null, 'error', 'Ошибка соединения с локальным сервером');
    } finally {
        setTimeout(() => { scanCooldown = false; }, 3000);
    }
}

function showResult(emp, type, message) {
    const icons = { ok: '✅', error: '❌', dup: '⚠️' };
    const msgCls = { ok: 'msg-ok', error: 'msg-error', dup: 'msg-dup' };

    document.getElementById('resultIdle').style.display = 'none';
    const card = document.getElementById('resultCard');
    card.style.display = 'flex';

    document.getElementById('resultIcon').textContent  = icons[type] || '?';
    document.getElementById('resultIcon').className    = `result-icon ${type}`;
    document.getElementById('resultName').textContent  = emp ? emp.full_name : '—';
    document.getElementById('resultOrg').textContent   = emp ? (emp.organization || '') : '';
    document.getElementById('resultPos').textContent   = emp ? (emp.position || '') : '';

    const msgEl = document.getElementById('resultMsg');
    msgEl.textContent  = message;
    msgEl.className    = `result-msg ${msgCls[type]}`;
}

function clearResult() {
    document.getElementById('resultIdle').style.display = '';
    document.getElementById('resultCard').style.display = 'none';
}

function showHint(msg) {
    document.querySelector('.scan-hint').textContent = msg;
}

// ── Employees ──────────────────────────────────────────────
async function loadEmployees() {
    const res  = await fetch('/api/employees');
    const data = await res.json();
    allEmployees = data.employees || [];
    renderEmployees(allEmployees);
}

function filterEmployees() {
    const q = document.getElementById('empSearch').value.toLowerCase();
    renderEmployees(q
        ? allEmployees.filter(e =>
            e.full_name.toLowerCase().includes(q) ||
            (e.organization || '').toLowerCase().includes(q))
        : allEmployees
    );
}

function renderEmployees(list) {
    const grid = document.getElementById('empGrid');
    grid.innerHTML = list.map(e => {
        const initials = e.full_name.split(' ').slice(0, 2).map(w => w[0]).join('');
        const roleMap  = { operator: 'Оператор', admin: 'Администратор', super_admin: 'Супер-администратор' };
        const roleLabel = e.role ? roleMap[e.role] || e.role : 'Сотрудник';
        return `<div class="emp-card">
            <div class="emp-avatar">${initials}</div>
            <div>
                <div class="emp-card-name">${esc(e.full_name)}</div>
                <div class="emp-card-org">${esc(e.organization || '')}${e.department ? ' · ' + esc(e.department) : ''}</div>
                <span class="emp-card-role">${esc(roleLabel)}</span>
            </div>
        </div>`;
    }).join('');
}

// ── Logs ──────────────────────────────────────────────────
async function loadLogs() {
    const res  = await fetch('/api/meal_logs?limit=300');
    const data = await res.json();
    const tbody = document.getElementById('logsBody');
    const mtCls = { breakfast:'mt-breakfast', lunch:'mt-lunch', dinner:'mt-dinner', night:'mt-night' };

    tbody.innerHTML = (data.logs || []).map(l => {
        const dt     = new Date(l.scanned_at).toLocaleString('ru-RU');
        const synced = l.synced ? '<span class="badge badge-sync">Синхр.</span>' : '<span class="badge badge-unsync">Офлайн</span>';
        return `<tr>
            <td>${dt}</td>
            <td>${esc(l.employee_name || String(l.employee_id))}</td>
            <td>${esc(l.organization || '—')}</td>
            <td><span class="${mtCls[l.meal_type] || ''} meal-label">${MEAL_LABELS[l.meal_type] || l.meal_type}</span></td>
            <td>${esc(l.meal_point_name || '—')}</td>
            <td>${synced}</td>
        </tr>`;
    }).join('');
}

// ── Settings ──────────────────────────────────────────────
function loadSettingsInfo() {
    fetch('/api/sync/status').then(r => r.json()).then(d => {
        if (!d.status) return;
        document.getElementById('infoEmp').textContent  = d.status.employees || '—';
        const ls = d.status.lastSync ? new Date(d.status.lastSync).toLocaleString('ru-RU') : 'нет';
        document.getElementById('infoSync').textContent = ls;
    });
}

function saveSettings() {
    alert('Настройки синхронизируются через конфигурационный файл .env на сервере.\nОбратитесь к администратору.');
}

// ── Sync ──────────────────────────────────────────────────
async function syncNow() {
    const btn = document.getElementById('btnSync');
    btn.disabled = true;

    try {
        let data;
        if (window.electron) {
            data = await window.electron.syncNow();
        } else {
            const res = await fetch('/api/sync/now', { method: 'POST' });
            data = (await res.json()).status;
        }
        updateSyncUI(data);
    } catch (err) {
        console.error('Sync error:', err);
    } finally {
        btn.disabled = false;
    }
}

function updateSyncUI(status) {
    if (!status) return;
    const dot   = document.getElementById('syncDot');
    const label = document.getElementById('syncLabel');
    const time  = document.getElementById('syncTime');

    dot.className = 'sync-dot';
    if (status.inProgress) {
        dot.classList.add('syncing');
        label.textContent = 'Синхронизация…';
    } else if (status.online && status.lastSyncOk) {
        dot.classList.add('online');
        label.textContent = 'Онлайн';
    } else if (!status.online) {
        label.textContent = 'Нет связи';
    } else {
        dot.classList.add('error');
        label.textContent = 'Ошибка синхр.';
    }

    if (status.lastSync) {
        time.textContent = 'Синхр: ' + new Date(status.lastSync).toLocaleString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    }
}

// Poll sync status every 10s
async function pollSyncStatus() {
    try {
        let status;
        if (window.electron) {
            status = await window.electron.syncStatus();
        } else {
            const res = await fetch('/api/sync/status');
            status = (await res.json()).status;
        }
        updateSyncUI(status);
    } catch (_) {}
}

// Listen to IPC sync-status-update from Electron main process
if (window.electron) {
    // preload exposes this via contextBridge
}

// ── Utilities ─────────────────────────────────────────────
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────
pollSyncStatus();
setInterval(pollSyncStatus, 10_000);
startScanner();
