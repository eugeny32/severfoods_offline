'use strict';

// ── State ──────────────────────────────────────────────────
let currentUser    = null;
let currentPage    = 'scanner';
let currentMealType = 'breakfast';
let allEmployees   = [];
let scannerActive  = false;
let scanCooldown   = false;
let scanInterval   = null;
let videoStream    = null;
let chatLoaded     = false;

const MEAL_LABELS = { breakfast:'Завтрак', lunch:'Обед', dinner:'Ужин', night:'Ночной' };
const ROLE_LABELS = { operator:'Оператор', admin:'Администратор', super_admin:'Супер-администратор' };

// ── Init ──────────────────────────────────────────────────
(async function init() {
    // Check cached session
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data.ok) { onLogin(data.employee); return; }
        }
    } catch (_) {}

    showLogin();
})();

// ── Auth ──────────────────────────────────────────────────
function showLogin() {
    document.getElementById('loginScreen').style.display = '';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginInput').focus();
}

async function doLogin() {
    const login    = document.getElementById('loginInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const btn      = document.getElementById('loginBtn');
    const errEl    = document.getElementById('loginError');

    if (!login || !password) { showLoginError('Введите логин и пароль'); return; }

    btn.disabled = true;
    btn.textContent = 'Вход…';
    errEl.style.display = 'none';

    try {
        const res  = await fetch('/api/auth/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ login, password }),
        });
        const data = await res.json();

        if (data.ok) {
            if (data.offline) showOfflineNote();
            onLogin(data.employee);
        } else {
            showLoginError(data.error || 'Ошибка входа');
        }
    } catch (_) {
        showLoginError('Ошибка соединения с локальным сервером');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
    }
}

function showLoginError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.style.display = '';
}

function showOfflineNote() {
    document.getElementById('loginOfflineNote').style.display = '';
}

function onLogin(employee) {
    currentUser = employee;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = '';

    // Set user panel
    const initials = employee.full_name.split(' ').slice(0,2).map(w=>w[0]).join('');
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userName').textContent   = employee.full_name;
    document.getElementById('userRole').textContent   = ROLE_LABELS[employee.role] || 'Сотрудник';

    applyRoleNavFilter(employee.role);
    loadEmployees();
    pollSyncStatus();
    setInterval(pollSyncStatus, 10000);
}

async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    stopScanner();
    chatLoaded = false;
    document.getElementById('chatView').src = 'about:blank';
    document.getElementById('loginInput').value    = '';
    document.getElementById('passwordInput').value = '';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('loginOfflineNote').style.display = 'none';
    showLogin();
}

// ── Role-based nav ─────────────────────────────────────────
const ROLE_WEIGHT = { super_admin: 4, admin: 3, operator: 2, employee: 1 };

function hasAccess(roleAttr) {
    if (roleAttr === 'all') return true;
    if (!currentUser) return false;
    const allowed = roleAttr.split(',');
    return allowed.includes(currentUser.role) || currentUser.role === 'super_admin';
}

function applyRoleNavFilter(role) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        const attr = btn.dataset.roles || 'all';
        btn.style.display = hasAccess(attr) ? '' : 'none';
    });
}

// ── Navigation ─────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

function navigateTo(page) {
    if (!hasAccess(document.querySelector(`[data-page="${page}"]`)?.dataset.roles || 'all')) return;

    currentPage = page;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

    if (page !== 'scanner') stopScanner();
    if (page === 'employees') loadEmployees();
    if (page === 'logs')      loadLogs();
    if (page === 'settings')  renderSettings();
    if (page === 'chat')      loadChat();
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
async function startScanner() {
    if (scannerActive) return;

    const video  = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');

    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 } }
        });
        video.srcObject = videoStream;
        await video.play();

        scannerActive = true;
        document.getElementById('scanStartBtn').style.display  = 'none';
        document.getElementById('scanActiveUi').style.display  = '';

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        scanInterval = setInterval(() => {
            if (!scannerActive || scanCooldown) return;
            if (video.readyState < video.HAVE_ENOUGH_DATA) return;
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (typeof jsQR !== 'undefined') {
                const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                if (code?.data) handleQrScan(code.data);
            }
        }, 200);
    } catch (err) {
        document.getElementById('scanHint').textContent = 'Нет доступа к камере';
    }
}

function stopScanner() {
    scannerActive = false;
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    if (videoStream)  { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
    document.getElementById('scanStartBtn').style.display = '';
    document.getElementById('scanActiveUi').style.display = 'none';
    const video = document.getElementById('scannerVideo');
    video.srcObject = null;
}

async function handleQrScan(qrData) {
    if (scanCooldown) return;
    scanCooldown = true;

    try {
        const scanRes = await fetch(`/api/employees/scan?qr=${encodeURIComponent(qrData)}`);
        const scanData = await scanRes.json();

        if (!scanData.ok) { showResult(null, 'error', 'QR-код не найден'); return; }

        const emp = scanData.employee;
        const logRes = await fetch('/api/meal_logs', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id:     emp.id,
                meal_type:       currentMealType,
                meal_point_id:   currentUser?.assigned_point_id || null,
                meal_point_name: 'Офлайн',
                operator_name:   currentUser?.full_name || 'Оператор',
            }),
        });
        const log = await logRes.json();

        if (log.ok)                       showResult(emp, 'ok',    `${MEAL_LABELS[currentMealType]} зафиксирован`);
        else if (log.error === 'duplicate') showResult(emp, 'dup',   log.message || 'Уже зафиксировано сегодня');
        else                               showResult(emp, 'error', log.message || 'Ошибка записи');
    } catch (_) {
        showResult(null, 'error', 'Ошибка локального сервера');
    } finally {
        setTimeout(() => { scanCooldown = false; }, 3000);
    }
}

function showResult(emp, type, message) {
    const icons  = { ok:'✅', error:'❌', dup:'⚠️' };
    const msgCls = { ok:'msg-ok', error:'msg-error', dup:'msg-dup' };
    document.getElementById('resultIdle').style.display = 'none';
    const card = document.getElementById('resultCard');
    card.style.display = 'flex';
    document.getElementById('resultIcon').textContent = icons[type] || '?';
    document.getElementById('resultIcon').className   = `result-icon ${type}`;
    document.getElementById('resultName').textContent = emp ? emp.full_name : '—';
    document.getElementById('resultOrg').textContent  = emp ? (emp.organization || '') : '';
    document.getElementById('resultPos').textContent  = emp ? (emp.position || '') : '';
    const msgEl = document.getElementById('resultMsg');
    msgEl.textContent = message;
    msgEl.className   = `result-msg ${msgCls[type]}`;
}

function clearResult() {
    document.getElementById('resultIdle').style.display = '';
    document.getElementById('resultCard').style.display = 'none';
}

// Enter key on password field
document.getElementById('passwordInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ── Employees by org ───────────────────────────────────────
async function loadEmployees() {
    const res  = await fetch('/api/employees');
    const data = await res.json();
    allEmployees = data.employees || [];
    renderEmployeesByOrg(allEmployees);
}

function filterEmployees() {
    const q = document.getElementById('empSearch').value.toLowerCase();
    renderEmployeesByOrg(q
        ? allEmployees.filter(e =>
            e.full_name.toLowerCase().includes(q) ||
            (e.organization || '').toLowerCase().includes(q) ||
            (e.department   || '').toLowerCase().includes(q))
        : allEmployees);
}

function renderEmployeesByOrg(list) {
    document.getElementById('empTotal').textContent = `${list.length} сотрудников`;

    const orgs = {};
    list.forEach(e => {
        const org = e.organization || 'Без организации';
        if (!orgs[org]) orgs[org] = [];
        orgs[org].push(e);
    });

    const html = Object.entries(orgs)
        .sort(([a],[b]) => a.localeCompare(b, 'ru'))
        .map(([org, emps]) => `
        <div class="org-section">
            <div class="org-header" onclick="toggleOrg(this)">
                <div class="org-header-left">
                    <svg class="org-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    <span class="org-name">${esc(org)}</span>
                </div>
                <span class="org-count">${emps.length}</span>
            </div>
            <div class="org-cards">
                ${emps.map(e => renderEmpCard(e)).join('')}
            </div>
        </div>`).join('');

    document.getElementById('orgList').innerHTML = html;
}

function toggleOrg(header) {
    const section = header.closest('.org-section');
    section.classList.toggle('collapsed');
}

function renderEmpCard(e) {
    const initials   = e.full_name.split(' ').slice(0,2).map(w=>w[0]).join('');
    const roleLabel  = ROLE_LABELS[e.role] || '';
    const roleColors = {
        operator:    'bg:#fff7ed;color:#c2410c',
        admin:       'bg:#fff5f5;color:#9b1c1c',
        super_admin: 'bg:#f0fdf4;color:#166534',
    };
    const rc = roleColors[e.role] || '';
    return `<div class="emp-card">
        <div class="emp-avatar" style="background:${roleAvatarBg(e.role)}">${initials}</div>
        <div class="emp-card-body">
            <div class="emp-card-name">${esc(e.full_name)}</div>
            ${e.department ? `<div class="emp-card-org">${esc(e.department)}</div>` : ''}
            ${e.position   ? `<div class="emp-card-pos">${esc(e.position)}</div>` : ''}
            ${roleLabel ? `<span class="emp-card-role" style="${rc.replace('bg:','background:')}">${esc(roleLabel)}</span>` : ''}
        </div>
        ${e.qr_code ? `<div class="emp-card-qr" title="Есть QR-код">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        </div>` : ''}
    </div>`;
}

function roleAvatarBg(role) {
    const m = { operator:'#c2410c', admin:'#9b1c1c', super_admin:'#166534' };
    return m[role] || '#003366';
}

// ── Chat ──────────────────────────────────────────────────
function loadChat() {
    const syncStatus = document.getElementById('syncDot').classList.contains('online');
    const chatView   = document.getElementById('chatView');
    const offlineMsg = document.getElementById('chatOffline');

    // Check connectivity by trying a ping
    fetch('/api/sync/status').then(r => r.json()).then(d => {
        const online = d.status?.online;
        if (online) {
            offlineMsg.style.display = 'none';
            chatView.style.display   = '';
            if (!chatLoaded) {
                chatView.src = 'https://severfoods.ru/chat.php';
                chatLoaded = true;
            }
        } else {
            chatView.style.display   = 'none';
            offlineMsg.style.display = '';
        }
    }).catch(() => {
        chatView.style.display   = 'none';
        offlineMsg.style.display = '';
    });
}

// ── Logs ──────────────────────────────────────────────────
async function loadLogs() {
    const mealFilter = document.getElementById('logsMealFilter')?.value || '';
    const pointId    = (currentUser?.role === 'operator') ? currentUser.assigned_point_id : null;
    let url = `/api/meal_logs?limit=300${pointId ? '&point_id=' + pointId : ''}`;

    const res  = await fetch(url);
    const data = await res.json();
    let logs   = data.logs || [];

    if (mealFilter) logs = logs.filter(l => l.meal_type === mealFilter);

    // Stats
    const stats = { breakfast:0, lunch:0, dinner:0, night:0 };
    logs.forEach(l => { if (stats[l.meal_type] !== undefined) stats[l.meal_type]++; });
    const mtCls = { breakfast:'mt-breakfast', lunch:'mt-lunch', dinner:'mt-dinner', night:'mt-night' };

    document.getElementById('logsStats').innerHTML = Object.entries(stats).map(([k,v]) =>
        `<div class="logs-stat-item"><span class="${mtCls[k]} meal-label">${MEAL_LABELS[k]}</span><span class="logs-stat-count">${v}</span></div>`
    ).join('');

    document.getElementById('logsBody').innerHTML = logs.map(l => {
        const dt     = new Date(l.scanned_at).toLocaleString('ru-RU');
        const synced = l.synced
            ? '<span class="badge badge-sync">Синхр.</span>'
            : '<span class="badge badge-unsync">Офлайн</span>';
        return `<tr>
            <td>${dt}</td>
            <td>${esc(l.employee_name || String(l.employee_id))}</td>
            <td>${esc(l.organization || '—')}</td>
            <td><span class="${mtCls[l.meal_type]} meal-label">${MEAL_LABELS[l.meal_type] || l.meal_type}</span></td>
            <td>${esc(l.meal_point_name || '—')}</td>
            <td>${synced}</td>
        </tr>`;
    }).join('');
}

// ── Settings ──────────────────────────────────────────────
function renderSettings() {
    const role = currentUser?.role;
    let html = '';

    // All roles: sync info
    html += `<div class="settings-card">
        <h3>Синхронизация</h3>
        <div class="setting-row"><label>Статус</label><span id="setInfoStatus">—</span></div>
        <div class="setting-row"><label>Последняя синхронизация</label><span id="setInfoSync">—</span></div>
        <div class="setting-row"><label>Сотрудников в базе</label><span id="setInfoEmp">—</span></div>
        <div class="setting-row"><label>Несинхронизированных записей</label><span id="setInfoUnsynced">—</span></div>
        <button class="btn-primary" onclick="syncNow()">Синхронизировать сейчас</button>
    </div>`;

    // operator+: point info
    if (['operator','admin','super_admin'].includes(role)) {
        html += `<div class="settings-card">
            <h3>Точка питания</h3>
            <div class="setting-row"><label>Привязанная точка</label>
                <span id="setPointName">—</span>
            </div>
            <div id="setPointSchedules" style="margin-top:8px"></div>
        </div>`;
    }

    // admin+: DB info
    if (['admin','super_admin'].includes(role)) {
        html += `<div class="settings-card">
            <h3>База данных</h3>
            <div class="setting-row"><label>Расположение</label><span class="setting-mono">%AppData%\\severfoods-offline\\severfoods.db</span></div>
            <div class="setting-row"><label>Сервер синхронизации</label><span class="setting-mono">https://severfoods.ru</span></div>
            <button class="btn-secondary" onclick="syncNow()">Принудительная синхронизация</button>
        </div>`;
    }

    // super_admin only: token config
    if (role === 'super_admin') {
        const token = '••••••••••••••••';
        html += `<div class="settings-card">
            <h3>Конфигурация</h3>
            <div class="setting-row">
                <label>Токен синхронизации</label>
                <span class="setting-mono">${token}</span>
            </div>
            <p class="setting-note">Токен хранится в файле <code>.env</code> рядом с приложением.<br>
            Должен совпадать с <code>OFFLINE_SYNC_TOKEN</code> на сервере severfoods.ru.</p>
        </div>`;
    }

    // All: about
    html += `<div class="settings-card">
        <h3>О программе</h3>
        <div class="setting-row"><label>Версия</label><span>1.0.0</span></div>
        <div class="setting-row"><label>Пользователь</label><span>${esc(currentUser?.full_name || '—')}</span></div>
        <div class="setting-row"><label>Роль</label><span>${esc(ROLE_LABELS[role] || 'Сотрудник')}</span></div>
        <button class="btn-logout-settings" onclick="doLogout()">Выйти из аккаунта</button>
    </div>`;

    document.getElementById('settingsContent').innerHTML = html;

    // Fill sync info
    fetch('/api/sync/status').then(r => r.json()).then(d => {
        const s = d.status;
        if (!s) return;
        const statusEl = document.getElementById('setInfoStatus');
        if (statusEl) statusEl.textContent = s.online ? 'Онлайн' : 'Офлайн';
        const syncEl = document.getElementById('setInfoSync');
        if (syncEl) syncEl.textContent = s.lastSync ? new Date(s.lastSync).toLocaleString('ru-RU') : 'нет';
        const empEl = document.getElementById('setInfoEmp');
        if (empEl) empEl.textContent = s.employees || allEmployees.length || '—';
    });

    // Fill point info for operator
    if (['operator','admin','super_admin'].includes(role) && currentUser?.assigned_point_id) {
        fetch('/api/meal_points').then(r => r.json()).then(d => {
            const pt = (d.meal_points || []).find(p => p.id === currentUser.assigned_point_id);
            const nameEl = document.getElementById('setPointName');
            if (nameEl && pt) {
                nameEl.textContent = pt.point_name + (pt.city ? ` (${pt.city})` : '');
                const schEl = document.getElementById('setPointSchedules');
                if (schEl && pt.schedules?.length) {
                    schEl.innerHTML = pt.schedules.map(s =>
                        `<div class="setting-row"><label>${MEAL_LABELS[s.meal_type] || s.meal_type}</label>
                         <span>${s.start_time} – ${s.end_time}</span></div>`
                    ).join('');
                }
            }
        });
    }
}

// ── Sync ──────────────────────────────────────────────────
async function syncNow() {
    const btn = document.getElementById('btnSync');
    if (btn) btn.disabled = true;
    try {
        let status;
        if (window.electron) {
            status = await window.electron.syncNow();
        } else {
            const r = await fetch('/api/sync/now', { method: 'POST' });
            status = (await r.json()).status;
        }
        updateSyncUI(status);
        // Reload employees after sync
        if (currentPage === 'employees') loadEmployees();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function pollSyncStatus() {
    try {
        let status;
        if (window.electron) {
            status = await window.electron.syncStatus();
        } else {
            const r = await fetch('/api/sync/status');
            status  = (await r.json()).status;
        }
        updateSyncUI(status);
    } catch (_) {}
}

function updateSyncUI(status) {
    if (!status) return;
    const dot   = document.getElementById('syncDot');
    const label = document.getElementById('syncLabel');
    const time  = document.getElementById('syncTime');
    if (!dot) return;

    dot.className = 'sync-dot';
    if (status.inProgress) {
        dot.classList.add('syncing'); label.textContent = 'Синхронизация…';
    } else if (status.online && status.lastSyncOk) {
        dot.classList.add('online');  label.textContent = 'Онлайн';
    } else if (!status.online) {
        label.textContent = 'Нет связи';
    } else {
        dot.classList.add('error'); label.textContent = 'Ошибка синхр.';
    }

    if (status.lastSync) {
        time.textContent = new Date(status.lastSync).toLocaleString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    }
}

// ── Utilities ─────────────────────────────────────────────
function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
