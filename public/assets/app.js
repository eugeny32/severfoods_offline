'use strict';

// ── State ──────────────────────────────────────────────────
let currentUser     = null;
let currentPage     = 'scanner';
let currentMealType = 'breakfast';
let allEmployees    = [];

let scannerActive = false;
let scanCooldown  = false;
let scanInterval  = null;
let videoStream   = null;

let loginCamActive = false;
let loginCamRole   = null;
let loginCamStream = null;
let loginCamInterval = null;

let chatLoaded = false;

const MEAL_LABELS = { breakfast:'Завтрак', lunch:'Обед', dinner:'Ужин', night:'Ночной' };
const ROLE_LABELS = { operator:'Оператор', admin:'Администратор', super_admin:'Супер-администратор' };
const ROLE_COLORS = { operator:'#c2410c', admin:'#9b1c1c', super_admin:'#166534' };

// ── Init ──────────────────────────────────────────────────
(async function boot() {
    await loadLoginPoints();

    try {
        const r = await fetch('/api/auth/me');
        if (r.ok) { const d = await r.json(); if (d.ok) { onLogin(d.employee); return; } }
    } catch (_) {}

    showLogin();
})();

// ── Login points dropdown ──────────────────────────────────
async function loadLoginPoints() {
    try {
        const r = await fetch('/api/meal_points');
        const d = await r.json();
        const sel = document.getElementById('opPointSelect');
        (d.meal_points || []).forEach(p => {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.point_name + (p.city ? ` — ${p.city}` : '');
            sel.appendChild(o);
        });
    } catch (_) {}
}

// ── Login tabs ────────────────────────────────────────────
function switchLoginTab(tab) {
    const isOp = tab === 'operator';
    document.getElementById('formOperator').classList.toggle('active',  isOp);
    document.getElementById('formAdmin').classList.toggle('active',    !isOp);
    document.getElementById('tabOperator').classList.toggle('active',   isOp);
    document.getElementById('tabAdmin').classList.toggle('active',     !isOp);
    stopLoginCam();
    setTimeout(() => {
        const inp = isOp ? document.getElementById('opQrInput') : document.getElementById('adQrInput');
        if (inp) inp.focus();
    }, 50);
}

// ── Login camera ──────────────────────────────────────────
async function toggleLoginCam(role) {
    if (loginCamActive && loginCamRole === role) { stopLoginCam(); return; }
    stopLoginCam();

    loginCamRole   = role;
    loginCamActive = true;

    const videoId  = role === 'operator' ? 'loginVideoOp'  : 'loginVideoAd';
    const canvasId = role === 'operator' ? 'loginCanvasOp' : 'loginCanvasAd';
    const preview  = document.getElementById(role === 'operator' ? 'camPreviewOperator' : 'camPreviewAdmin');
    const btn      = document.getElementById(role === 'operator' ? 'opCamBtn' : 'adCamBtn');

    preview.style.display = '';
    if (btn) btn.classList.add('active');

    const video  = document.getElementById(videoId);
    const canvas = document.getElementById(canvasId);
    const ctx    = canvas.getContext('2d', { willReadFrequently: true });

    try {
        loginCamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment' } });
        video.srcObject = loginCamStream;
        await video.play();

        loginCamInterval = setInterval(() => {
            if (!loginCamActive || video.readyState < video.HAVE_ENOUGH_DATA) return;
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (typeof jsQR !== 'undefined') {
                const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                if (code?.data) {
                    const inputId = role === 'operator' ? 'opQrInput' : 'adQrInput';
                    document.getElementById(inputId).value = code.data;
                    stopLoginCam();
                    doLogin(role);
                }
            }
        }, 200);
    } catch (_) {
        preview.style.display = 'none';
        loginCamActive = false;
    }
}

function stopLoginCam() {
    loginCamActive = false;
    if (loginCamInterval) { clearInterval(loginCamInterval); loginCamInterval = null; }
    if (loginCamStream)   { loginCamStream.getTracks().forEach(t => t.stop()); loginCamStream = null; }
    ['camPreviewOperator','camPreviewAdmin'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    ['opCamBtn','adCamBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
}

// ── Login ─────────────────────────────────────────────────
async function doLogin(role) {
    const qrInput  = document.getElementById(role === 'operator' ? 'opQrInput' : 'adQrInput');
    const qr_code  = qrInput.value.trim();
    const pointSel = document.getElementById('opPointSelect');
    const meal_point_id = (role === 'operator' && pointSel) ? parseInt(pointSel.value) || null : null;

    if (!qr_code) { showLoginError('Отсканируйте или введите QR-код'); return; }
    if (role === 'operator' && !meal_point_id) { showLoginError('Выберите точку питания'); return; }

    const btns = document.querySelectorAll('.btn-login');
    btns.forEach(b => { b.disabled = true; });
    hideLoginError();

    try {
        const r    = await fetch('/api/auth/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ qr_code, role, meal_point_id }),
        });
        const data = await r.json();

        if (data.ok) {
            if (data.offline) document.getElementById('loginOfflineNote').style.display = '';
            onLogin(data.employee);
        } else {
            showLoginError(data.error || 'Ошибка входа');
        }
    } catch (_) {
        showLoginError('Ошибка соединения с локальным сервером');
    } finally {
        btns.forEach(b => { b.disabled = false; });
    }
}

function showLoginError(msg) {
    const el = document.getElementById('loginError');
    document.getElementById('loginErrorText').textContent = msg;
    el.style.display = 'flex';
}
function hideLoginError() { document.getElementById('loginError').style.display = 'none'; }

// Enter key on QR inputs
['opQrInput','adQrInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(id === 'opQrInput' ? 'operator' : 'admin'); });
});

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    setTimeout(() => document.getElementById('opQrInput')?.focus(), 100);
}

function onLogin(emp) {
    currentUser = emp;
    stopLoginCam();
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = '';

    const initials = emp.full_name.split(' ').slice(0,2).map(w => w[0]).join('');
    document.getElementById('userAvatar').textContent = initials;
    document.getElementById('userName').textContent   = emp.full_name;
    document.getElementById('userRole').textContent   = ROLE_LABELS[emp.role] || 'Сотрудник';

    // Show selected point name in logo sub
    const pt = emp.selected_point_name || emp.organization || 'Offline';
    document.getElementById('logoPointName').textContent = pt;

    applyRoleNavFilter(emp.role);
    loadEmployees();
    pollSyncStatus();
    setInterval(pollSyncStatus, 10000);
}

async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    stopScanner();
    chatLoaded = false;
    const cv = document.getElementById('chatView');
    if (cv) cv.src = 'about:blank';
    document.getElementById('opQrInput').value = '';
    document.getElementById('adQrInput').value = '';
    hideLoginError();
    document.getElementById('loginOfflineNote').style.display = 'none';
    showLogin();
}

// ── Role-based nav ─────────────────────────────────────────
function hasAccess(roleAttr) {
    if (roleAttr === 'all' || !roleAttr) return true;
    if (!currentUser) return false;
    if (currentUser.role === 'super_admin') return true;
    return roleAttr.split(',').includes(currentUser.role);
}

function applyRoleNavFilter(role) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.style.display = hasAccess(btn.dataset.roles) ? '' : 'none';
    });
}

// ── Navigation ─────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

function navigateTo(page) {
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
function startScanner() {
    if (scannerActive) return;
    const video  = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');

    navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment', width:{ ideal:1280 } } })
        .then(stream => {
            videoStream = stream;
            video.srcObject = stream;
            return video.play();
        })
        .then(() => {
            scannerActive = true;
            document.getElementById('scanStartBtn').style.display  = 'none';
            const ui = document.getElementById('scanActiveUi');
            ui.style.display = 'flex';

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            scanInterval = setInterval(() => {
                if (!scannerActive || scanCooldown || video.readyState < video.HAVE_ENOUGH_DATA) return;
                canvas.width  = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                if (typeof jsQR !== 'undefined') {
                    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                    if (code?.data) handleQrScan(code.data);
                }
            }, 200);
        })
        .catch(() => {
            document.getElementById('scanHint').textContent = 'Нет доступа к камере';
        });
}

function stopScanner() {
    scannerActive = false;
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    if (videoStream)  { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
    const video = document.getElementById('scannerVideo');
    if (video) video.srcObject = null;
    const startBtn = document.getElementById('scanStartBtn');
    const activeUi = document.getElementById('scanActiveUi');
    if (startBtn) startBtn.style.display = '';
    if (activeUi) activeUi.style.display = 'none';
}

async function handleQrScan(qrData) {
    if (scanCooldown) return;
    scanCooldown = true;
    try {
        const scanRes  = await fetch(`/api/employees/scan?qr=${encodeURIComponent(qrData)}`);
        const scanData = await scanRes.json();
        if (!scanData.ok) { showResult(null, 'error', 'QR-код не найден'); return; }

        const emp    = scanData.employee;
        const ptId   = currentUser?.selected_point_id || currentUser?.assigned_point_id || null;
        const ptName = currentUser?.selected_point_name || 'Офлайн';

        const logRes = await fetch('/api/meal_logs', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id:     emp.id,
                meal_type:       currentMealType,
                meal_point_id:   ptId,
                meal_point_name: ptName,
                operator_name:   currentUser?.full_name || 'Оператор',
            }),
        });
        const log = await logRes.json();

        if (log.ok)                        showResult(emp, 'ok',    `${MEAL_LABELS[currentMealType]} зафиксирован`);
        else if (log.error === 'duplicate') showResult(emp, 'dup',   log.message || 'Уже зафиксировано сегодня');
        else                                showResult(emp, 'error', log.message || 'Ошибка записи');
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
    document.getElementById('resultCard').style.display = 'flex';
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

// ── Employees by org ───────────────────────────────────────
async function loadEmployees() {
    const res  = await fetch('/api/employees');
    const data = await res.json();
    allEmployees = data.employees || [];
    renderEmployeesByOrg(allEmployees);
}

function filterEmployees() {
    const q = document.getElementById('empSearch').value.toLowerCase();
    renderEmployeesByOrg(q ? allEmployees.filter(e =>
        e.full_name.toLowerCase().includes(q) ||
        (e.organization || '').toLowerCase().includes(q) ||
        (e.department   || '').toLowerCase().includes(q)) : allEmployees);
}

function renderEmployeesByOrg(list) {
    document.getElementById('empTotal').textContent = `${list.length} сотрудников`;
    const orgs = {};
    list.forEach(e => { const o = e.organization || 'Без организации'; (orgs[o] = orgs[o] || []).push(e); });

    document.getElementById('orgList').innerHTML = Object.entries(orgs)
        .sort(([a],[b]) => a.localeCompare(b,'ru'))
        .map(([org, emps]) => `
        <div class="org-section">
            <div class="org-header" onclick="this.closest('.org-section').classList.toggle('collapsed')">
                <div class="org-header-left">
                    <i class="fas fa-chevron-down org-chevron"></i>
                    <span class="org-name">${esc(org)}</span>
                </div>
                <span class="org-count">${emps.length}</span>
            </div>
            <div class="org-cards">${emps.map(empCard).join('')}</div>
        </div>`).join('');
}

function empCard(e) {
    const initials = e.full_name.split(' ').slice(0,2).map(w => w[0]).join('');
    const rl       = ROLE_LABELS[e.role] || '';
    const rc       = ROLE_COLORS[e.role];
    const roleHtml = rl ? `<span class="emp-card-role" style="background:${rc}22;color:${rc}">${esc(rl)}</span>` : '';
    return `<div class="emp-card">
        <div class="emp-avatar" style="background:${rc || '#003366'}">${initials}</div>
        <div class="emp-card-body">
            <div class="emp-card-name">${esc(e.full_name)}</div>
            ${e.department ? `<div class="emp-card-sub">${esc(e.department)}</div>` : ''}
            ${e.position   ? `<div class="emp-card-sub" style="color:#94a3b8">${esc(e.position)}</div>` : ''}
            ${roleHtml}
        </div>
    </div>`;
}

// ── Chat ──────────────────────────────────────────────────
function loadChat() {
    fetch('/api/sync/status').then(r => r.json()).then(d => {
        const online   = d.status?.online;
        const chatView = document.getElementById('chatView');
        const offline  = document.getElementById('chatOffline');
        if (online) {
            offline.style.display  = 'none';
            chatView.style.display = '';
            if (!chatLoaded) { chatView.src = 'https://severfoods.ru/chat.php'; chatLoaded = true; }
        } else {
            chatView.style.display = 'none';
            offline.style.display  = 'flex';
        }
    }).catch(() => {
        document.getElementById('chatView').style.display   = 'none';
        document.getElementById('chatOffline').style.display = 'flex';
    });
}

// ── Logs ──────────────────────────────────────────────────
async function loadLogs() {
    const mealFilter = document.getElementById('logsMealFilter')?.value || '';
    const pointId    = currentUser?.role === 'operator' ? (currentUser.selected_point_id || null) : null;
    let url = `/api/meal_logs?limit=300${pointId ? '&point_id=' + pointId : ''}`;

    const data = await fetch(url).then(r => r.json());
    let logs = data.logs || [];
    if (mealFilter) logs = logs.filter(l => l.meal_type === mealFilter);

    const stats = { breakfast:0, lunch:0, dinner:0, night:0 };
    logs.forEach(l => { if (l.meal_type in stats) stats[l.meal_type]++; });
    const mtCls = { breakfast:'mt-breakfast', lunch:'mt-lunch', dinner:'mt-dinner', night:'mt-night' };

    document.getElementById('logsStats').innerHTML = Object.entries(stats).map(([k,v]) =>
        `<div class="logs-stat-item"><span class="${mtCls[k]} meal-label">${MEAL_LABELS[k]}</span><span class="logs-stat-count">${v}</span></div>`
    ).join('');

    document.getElementById('logsBody').innerHTML = logs.map(l => {
        const dt = new Date(l.scanned_at).toLocaleString('ru-RU');
        const s  = l.synced ? '<span class="badge badge-sync">Синхр.</span>' : '<span class="badge badge-unsync">Офлайн</span>';
        return `<tr>
            <td>${dt}</td>
            <td>${esc(l.employee_name || String(l.employee_id))}</td>
            <td>${esc(l.organization || '—')}</td>
            <td><span class="${mtCls[l.meal_type]} meal-label">${MEAL_LABELS[l.meal_type] || l.meal_type}</span></td>
            <td>${esc(l.meal_point_name || '—')}</td>
            <td>${s}</td>
        </tr>`;
    }).join('');
}

// ── Settings ──────────────────────────────────────────────
function renderSettings() {
    const role = currentUser?.role;
    let html = '';

    html += `<div class="settings-card">
        <h3><i class="fas fa-sync-alt"></i> Синхронизация</h3>
        <div class="setting-row"><label>Статус сервера</label><span id="setStatus">—</span></div>
        <div class="setting-row"><label>Последняя синхронизация</label><span id="setSync">—</span></div>
        <div class="setting-row"><label>Сотрудников в базе</label><span id="setEmp">—</span></div>
        <button class="btn-primary" onclick="syncNow()"><i class="fas fa-sync-alt"></i> Синхронизировать</button>
    </div>`;

    if (['operator','admin','super_admin'].includes(role)) {
        const ptName = currentUser?.selected_point_name || '—';
        html += `<div class="settings-card">
            <h3><i class="fas fa-map-marker-alt"></i> Точка питания</h3>
            <div class="setting-row"><label>Текущая точка</label><span>${esc(ptName)}</span></div>
            <div id="setPtSchedules"></div>
        </div>`;
    }

    if (['admin','super_admin'].includes(role)) {
        html += `<div class="settings-card">
            <h3><i class="fas fa-database"></i> База данных</h3>
            <div class="setting-row"><label>Файл БД</label><span class="setting-mono">%AppData%\\severfoods-offline\\severfoods.db</span></div>
            <div class="setting-row"><label>Сервер</label><span class="setting-mono">https://severfoods.ru</span></div>
        </div>`;
    }

    if (role === 'super_admin') {
        html += `<div class="settings-card">
            <h3><i class="fas fa-key"></i> Токен синхронизации</h3>
            <p class="setting-note">
                Токен хранится в файле <code>.env</code> рядом с приложением.<br>
                Должен совпадать с <code>OFFLINE_SYNC_TOKEN</code> на сервере.
            </p>
        </div>`;
    }

    html += `<div class="settings-card">
        <h3><i class="fas fa-info-circle"></i> О программе</h3>
        <div class="setting-row"><label>Версия</label><span>1.0.0</span></div>
        <div class="setting-row"><label>Пользователь</label><span>${esc(currentUser?.full_name || '—')}</span></div>
        <div class="setting-row"><label>Роль</label><span>${esc(ROLE_LABELS[role] || 'Сотрудник')}</span></div>
        <button class="btn-logout-settings" onclick="doLogout()"><i class="fas fa-sign-out-alt"></i> Выйти из аккаунта</button>
    </div>`;

    document.getElementById('settingsContent').innerHTML = html;

    fetch('/api/sync/status').then(r => r.json()).then(d => {
        const s = d.status || {};
        const statusEl = document.getElementById('setStatus');
        if (statusEl) statusEl.textContent = s.online ? '🟢 Онлайн' : '⚫ Офлайн';
        const syncEl = document.getElementById('setSync');
        if (syncEl) syncEl.textContent = s.lastSync ? new Date(s.lastSync).toLocaleString('ru-RU') : 'нет';
        const empEl = document.getElementById('setEmp');
        if (empEl) empEl.textContent = s.employees || allEmployees.length || '—';
    });

    if (['operator','admin','super_admin'].includes(role)) {
        const ptId = currentUser?.selected_point_id || currentUser?.assigned_point_id;
        if (ptId) {
            fetch('/api/meal_points').then(r => r.json()).then(d => {
                const pt  = (d.meal_points || []).find(p => p.id === ptId);
                const el  = document.getElementById('setPtSchedules');
                if (el && pt?.schedules?.length) {
                    el.innerHTML = pt.schedules.map(s =>
                        `<div class="setting-row"><label>${MEAL_LABELS[s.meal_type] || s.meal_type}</label><span>${s.start_time} – ${s.end_time}</span></div>`
                    ).join('');
                }
            });
        }
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
            const r = await fetch('/api/sync/now', { method:'POST' });
            status  = (await r.json()).status;
        }
        updateSyncUI(status);
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
    if (status.inProgress)               { dot.classList.add('syncing'); label.textContent = 'Синхронизация…'; }
    else if (status.online && status.lastSyncOk) { dot.classList.add('online');  label.textContent = 'Онлайн'; }
    else if (!status.online)             { label.textContent = 'Нет связи'; }
    else                                 { dot.classList.add('error'); label.textContent = 'Ошибка'; }

    if (status.lastSync) {
        time.textContent = new Date(status.lastSync).toLocaleString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    }
}

// ── Utility ───────────────────────────────────────────────
function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
