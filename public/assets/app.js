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

// ── USB QR Scanner Input ───────────────────────────────────
const RU_TO_EN = {
    'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p',
    'х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k',
    'д':'l','ж':';','э':"'",'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m',
    'б':',','ю':'.',
    'Й':'Q','Ц':'W','У':'E','К':'R','Е':'T','Н':'Y','Г':'U','Ш':'I','Щ':'O','З':'P',
    'Х':'{','Ъ':'}','Ф':'A','Ы':'S','В':'D','А':'F','П':'G','Р':'H','О':'J','Л':'K',
    'Д':'L','Ж':':','Э':'"','Я':'Z','Ч':'X','С':'C','М':'V','И':'B','Т':'N','Ь':'M',
    'Б':'<','Ю':'>',
};

let _idleTimer = null;
let _idleCountdown = null;
const IDLE_MS = 5000;

function initUsbQrInput() {
    const input   = document.getElementById('qrUsbInput');
    const pillLay = document.getElementById('qsfLayout');
    const pillIdle= document.getElementById('qsfIdle');
    const pillSec = document.getElementById('qsfIdleSec');
    if (!input) return;

    // RU→EN layout conversion on keydown
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = input.value.trim();
            if (val) { handleQrScan(val); input.value = ''; }
            return;
        }
        const mapped = RU_TO_EN[e.key];
        if (mapped) {
            e.preventDefault();
            const s = input.selectionStart, end = input.selectionEnd;
            input.value = input.value.slice(0, s) + mapped + input.value.slice(end);
            input.setSelectionRange(s+1, s+1);
            pillLay.style.display = '';
            setTimeout(() => { pillLay.style.display = 'none'; }, 1500);
            input.dispatchEvent(new Event('input'));
        }
    });

    // Paste: convert RU chars
    input.addEventListener('paste', e => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        const converted = pasted.split('').map(c => RU_TO_EN[c] || c).join('');
        const s = input.selectionStart, end = input.selectionEnd;
        input.value = input.value.slice(0, s) + converted + input.value.slice(end);
        input.setSelectionRange(s + converted.length, s + converted.length);
    });

    // Idle watcher: auto-focus after IDLE_MS
    function resetIdle() {
        clearTimeout(_idleTimer);
        clearInterval(_idleCountdown);
        pillIdle.style.display = 'none';
        _idleTimer = setTimeout(() => {
            let sec = Math.ceil(IDLE_MS / 1000);
            pillSec.textContent = sec;
            pillIdle.style.display = '';
            _idleCountdown = setInterval(() => {
                sec--;
                pillSec.textContent = sec;
                if (sec <= 0) {
                    clearInterval(_idleCountdown);
                    pillIdle.style.display = 'none';
                    input.focus();
                }
            }, 1000);
        }, IDLE_MS);
    }

    ['click','keydown','mousemove','touchstart'].forEach(ev =>
        document.addEventListener(ev, resetIdle, { passive: true })
    );
    resetIdle();
    input.focus();
}
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
    loadMealPointsCache().then(() => {
        updateMealTypeAuto();
        loadTodayStats();
    });
    pollSyncStatus();
    setInterval(pollSyncStatus, 10000);
    initUsbQrInput();
}

async function loadMealPointsCache() {
    try {
        const res  = await fetch('/api/meal_points');
        const data = await res.json();
        window._mealPoints = data.meal_points || [];
    } catch (_) { window._mealPoints = []; }
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
    if (page === 'scanner')   { updateMealTypeAuto(); loadTodayStats(); }
    if (page === 'employees') loadEmployees();
    if (page === 'logs')      loadLogs();
    if (page === 'settings')  renderSettings();
    if (page === 'chat')      loadChat();
}

// ── Auto meal type by schedule ─────────────────────────────
const MEAL_ICONS = { breakfast:'☀️', lunch:'🌞', dinner:'🌙', night:'⭐' };

function getMealTypeBySchedule() {
    const pts = typeof db !== 'undefined' ? [] : null; // client side — use cached
    // Use currentUser point
    const ptId = currentUser?.selected_point_id || currentUser?.assigned_point_id || null;
    if (!ptId || !window._mealPoints) return guessMealTypeByTime();

    const pt = window._mealPoints.find(p => p.id === ptId);
    if (!pt?.schedules?.length) return guessMealTypeByTime();

    const now = new Date();
    const hhmm = now.getHours() * 60 + now.getMinutes();
    const dayIdx = now.getDay(); // 0=Sun,1=Mon...

    for (const s of pt.schedules) {
        const days = s.days_of_week ? s.days_of_week.split(',').map(Number) : [1,2,3,4,5,6,0];
        if (!days.includes(dayIdx)) continue;
        const [sh,sm] = s.start_time.split(':').map(Number);
        const [eh,em] = s.end_time.split(':').map(Number);
        const start = sh * 60 + sm, end = eh * 60 + em;
        if (hhmm >= start && hhmm <= end) return s.meal_type;
    }
    return guessMealTypeByTime();
}

function guessMealTypeByTime() {
    const h = new Date().getHours();
    if (h >= 6  && h < 11) return 'breakfast';
    if (h >= 11 && h < 16) return 'lunch';
    if (h >= 16 && h < 22) return 'dinner';
    return 'night';
}

function updateMealTypeAuto() {
    currentMealType = getMealTypeBySchedule();
    const icon  = document.getElementById('mealTypeIcon');
    const label = document.getElementById('mealTypeLabel');
    if (icon)  icon.textContent  = MEAL_ICONS[currentMealType] || '';
    if (label) label.textContent = MEAL_LABELS[currentMealType] || currentMealType;
}

// Refresh meal type every minute
setInterval(updateMealTypeAuto, 60000);

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

// Manual check button: show when user types manually
document.getElementById('qrUsbInput')?.addEventListener('input', e => {
    const btn = document.getElementById('manualCheckBtn');
    const badge = document.getElementById('modeBadge');
    if (btn) btn.style.display = e.target.value.trim() ? '' : 'none';
    if (badge) badge.style.display = e.target.value.trim() ? 'none' : '';
});

function doManualCheck() {
    const input = document.getElementById('qrUsbInput');
    const val = input?.value.trim();
    if (val) { handleQrScan(val); input.value = ''; document.getElementById('manualCheckBtn').style.display = 'none'; document.getElementById('modeBadge').style.display = ''; }
}

async function handleQrScan(qrData) {
    if (scanCooldown) return;
    scanCooldown = true;
    updateMealTypeAuto(); // re-check type at scan time
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

        if (log.ok) {
            showResult(emp, 'ok', `${MEAL_LABELS[currentMealType]} зафиксирован`);
            addToScanLog(emp, 'ok');
            updateScanStats(currentMealType, 1);
        } else if (log.error === 'duplicate') {
            showResult(emp, 'dup', log.message || 'Уже зафиксировано сегодня');
            addToScanLog(emp, 'dup');
        } else {
            showResult(emp, 'error', log.message || 'Ошибка записи');
            addToScanLog(emp, 'error');
        }
    } catch (_) {
        showResult(null, 'error', 'Ошибка локального сервера');
    } finally {
        setTimeout(() => { scanCooldown = false; }, 3000);
    }
}

function showResult(emp, type, message) {
    const icons  = { ok:'✅', error:'❌', dup:'⚠️' };
    const msgCls = { ok:'msg-ok', error:'msg-error', dup:'msg-dup' };
    document.getElementById('resultIdle').style.display  = 'none';
    document.getElementById('resultCard').style.display  = 'flex';
    document.getElementById('resultIcon').textContent    = icons[type] || '?';
    document.getElementById('resultIcon').className      = `result-icon ${type}`;
    document.getElementById('resultName').textContent    = emp ? emp.full_name : '—';
    document.getElementById('resultOrg').textContent     = emp ? (emp.organization || '') : '';
    document.getElementById('resultPos').textContent     = emp ? (emp.position || '') : '';
    const msgEl = document.getElementById('resultMsg');
    msgEl.textContent = message;
    msgEl.className   = `result-msg ${msgCls[type]}`;
}

// ── Scan log (today's history in right panel) ───────────────
let scanLogEntries = [];

function addToScanLog(emp, type) {
    const now = new Date();
    const time = now.toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    scanLogEntries.unshift({ name: emp?.full_name || '—', type, time });
    if (scanLogEntries.length > 200) scanLogEntries.pop();
    renderScanLog();
}

function renderScanLog() {
    const header = document.getElementById('scanLogHeader');
    const list   = document.getElementById('scanLogList');
    const count  = document.getElementById('scanLogCount');
    if (!list) return;
    const ok = scanLogEntries.filter(e => e.type === 'ok').length;
    header.style.display = scanLogEntries.length ? '' : 'none';
    if (count) count.textContent = ok;
    list.innerHTML = scanLogEntries.map(e => `
        <div class="scan-log-item">
            <span class="scan-log-dot ${e.type}"></span>
            <span class="scan-log-item-name">${esc(e.name)}</span>
            <span class="scan-log-item-time">${e.time}</span>
        </div>`).join('');
}

// ── Today stats + scan log from DB ────────────────────────
const _todayStats = { breakfast:0, lunch:0, dinner:0, night:0 };

function renderTodayStats() {
    for (const t of Object.keys(_todayStats)) {
        const el = document.getElementById(`stat_${t}`);
        if (el) el.textContent = _todayStats[t];
    }
}

function updateScanStats(type, delta) {
    if (type && type in _todayStats) _todayStats[type] += delta;
    renderTodayStats();
}

async function loadTodayStats() {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const ptId  = currentUser?.selected_point_id || currentUser?.assigned_point_id || null;
        const url   = ptId
            ? `/api/meal_logs?limit=2000&since=${today}T00:00:00&point_id=${ptId}`
            : `/api/meal_logs?limit=2000&since=${today}T00:00:00`;
        const data  = await fetch(url).then(r => r.json());

        for (const k of Object.keys(_todayStats)) _todayStats[k] = 0;
        scanLogEntries = [];

        (data.logs || []).forEach(l => {
            if (l.meal_type in _todayStats) _todayStats[l.meal_type]++;
            // Populate scan log from DB (access_granted only, today)
            const time = l.scanned_at
                ? new Date(l.scanned_at.replace(' ', 'T'))
                    .toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
                : '—';
            scanLogEntries.push({ name: l.employee_name || '—', type: 'ok', time });
        });

        // DB returns DESC, keep that order (newest first)
        renderTodayStats();
        renderScanLog();
    } catch (_) {}
}

// ── Employees ──────────────────────────────────────────────
async function loadEmployees() {
    const res  = await fetch('/api/employees');
    const data = await res.json();
    allEmployees = data.employees || [];
    renderOrgChips();
    document.getElementById('empTotalBadge').textContent = `(${allEmployees.length})`;
}

function renderOrgChips() {
    const orgs = {};
    allEmployees.forEach(e => { const o = e.organization || 'Без организации'; orgs[o] = (orgs[o] || 0) + 1; });

    const entries = Object.entries(orgs).sort(([a],[b]) => a.localeCompare(b,'ru'));

    if (!entries.length) {
        document.getElementById('orgChips').innerHTML =
            '<div class="empty-state"><i class="fas fa-users-slash"></i><p>Нет данных о сотрудниках.<br>Выполните синхронизацию с сервером.</p></div>';
        return;
    }

    // Store org names in a registry to avoid quote issues in onclick
    window._orgRegistry = Object.fromEntries(entries.map(([o],i) => [i, o]));

    document.getElementById('orgChips').innerHTML = entries
        .map(([org, cnt], i) => `
        <button class="org-chip" onclick="openOrgModal(window._orgRegistry[${i}])">
            <div class="org-chip-name">${esc(org)}</div>
            <div class="org-chip-count">${cnt}</div>
            <div class="org-chip-label">сотрудников</div>
        </button>`).join('');
}

function searchEmployees() {
    const q = document.getElementById('empSearch').value.toLowerCase().trim();
    const resultsWrap = document.getElementById('empSearchResults');
    const chipsWrap   = document.getElementById('orgChips');

    if (!q) {
        resultsWrap.style.display = 'none';
        chipsWrap.style.display   = '';
        return;
    }

    chipsWrap.style.display   = 'none';
    resultsWrap.style.display = '';

    const list = allEmployees.filter(e =>
        e.full_name.toLowerCase().includes(q) ||
        (e.organization || '').toLowerCase().includes(q) ||
        (e.department   || '').toLowerCase().includes(q));

    document.getElementById('empSearchBody').innerHTML = list.length
        ? list.map(empTableRow).join('')
        : '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:24px">Ничего не найдено</td></tr>';
}

function openOrgModal(org) {
    const list = allEmployees
        .filter(e => (e.organization || 'Без организации') === org)
        .sort((a,b) => a.full_name.localeCompare(b.full_name,'ru'));

    document.getElementById('orgModalTitle').innerHTML = `<i class="fas fa-users"></i> ${esc(org)}`;
    document.getElementById('orgModalBody').innerHTML = `
        <div style="font-size:12px;color:#64748b;padding:10px 16px 0">Всего: <strong>${list.length}</strong> сотрудников</div>
        <div class="emp-table-wrap" style="padding:8px 4px">
            <table class="emp-table">
                <thead><tr><th>Сотрудник</th><th>QR-статус</th><th>Действия</th></tr></thead>
                <tbody>${list.map(empTableRow).join('')}</tbody>
            </table>
        </div>`;
    openModal('orgModal');
}

function empTableRow(e) {
    const sc    = e.qr_status || 'active';
    const scMap = { active:'Активен', expired:'Истёк', blocked:'Заблок.' };
    const id    = e.id;

    let actions = `<button class="btn-sm green" title="Ручной пропуск" onclick="openManualModal(${id})"><i class="fas fa-sign-out-alt"></i></button>`;
    if (e.qr_code) {
        actions += `<button class="btn-sm blue" title="QR-код" onclick="showQrModal(${id})"><i class="fas fa-qrcode"></i></button>`;
    }
    actions += `<button class="btn-sm" title="Подробнее" onclick="openEmpCard(${id})"><i class="fas fa-info-circle"></i></button>`;

    return `<tr>
        <td><div class="emp-name">${esc(e.full_name)}</div>
            <div class="emp-org">${esc(e.department || e.organization || '')}</div></td>
        <td><span class="qr-status-badge ${sc}">${scMap[sc] || sc}</span></td>
        <td><div class="emp-actions">${actions}</div></td>
    </tr>`;
}

function openEmpCard(empId) {
    const e = allEmployees.find(x => x.id === empId);
    if (!e) return;

    const rc       = ROLE_COLORS[e.role] || '#003366';
    const rl       = ROLE_LABELS[e.role] || '';
    const initials = e.full_name.split(' ').slice(0,2).map(w=>w[0]).join('');
    const scMap    = { active:'Активен', expired:'Истёк', blocked:'Заблок.' };
    const sc       = e.qr_status || 'active';
    const scClass  = { active:'#166534', expired:'#991b1b', blocked:'#854d0e' };

    document.getElementById('empCardBody').innerHTML = `
        <div class="emp-card-info">
            <div class="emp-card-top">
                <div class="emp-card-avatar" style="background:${rc}">${initials}</div>
                <div>
                    <div class="emp-card-fullname">${esc(e.full_name)}</div>
                    ${rl ? `<span class="emp-card-role-badge" style="background:${rc}22;color:${rc}">${esc(rl)}</span>` : ''}
                </div>
            </div>
            ${e.organization ? `<div class="emp-info-row"><span class="lbl"><i class="fas fa-building"></i> Организация</span><span class="val">${esc(e.organization)}</span></div>` : ''}
            ${e.department   ? `<div class="emp-info-row"><span class="lbl"><i class="fas fa-sitemap"></i> Отдел</span><span class="val">${esc(e.department)}</span></div>` : ''}
            ${e.position     ? `<div class="emp-info-row"><span class="lbl"><i class="fas fa-briefcase"></i> Должность</span><span class="val">${esc(e.position)}</span></div>` : ''}
            ${e.birth_date   ? `<div class="emp-info-row"><span class="lbl"><i class="fas fa-birthday-cake"></i> Дата рождения</span><span class="val">${esc(e.birth_date)}</span></div>` : ''}
            ${e.vjg_type     ? `<div class="emp-info-row"><span class="lbl"><i class="fas fa-utensils"></i> Тип питания</span><span class="val">${esc(e.vjg_type)}</span></div>` : ''}
            <div class="emp-info-row"><span class="lbl"><i class="fas fa-qrcode"></i> QR-статус</span>
                <span class="val" style="color:${scClass[sc]||'#0f172a'}">${scMap[sc]||sc}
                ${e.qr_expires_at ? `<span style="color:#94a3b8;font-weight:400"> · до ${esc(e.qr_expires_at)}</span>` : ''}</span></div>
            <div class="emp-card-actions">
                <button class="btn-sm green" onclick="openManualModal(${e.id})"><i class="fas fa-sign-out-alt"></i> Ручной пропуск</button>
                ${e.qr_code ? `<button class="btn-sm blue" onclick="showQrModal(${e.id})"><i class="fas fa-qrcode"></i> QR-код</button>` : ''}
                <a class="btn-sm" href="https://www.severfoods.ru/print_qr.php?id=${e.id}" target="_blank" title="Печать QR"><i class="fas fa-print"></i> Печать</a>
            </div>
        </div>`;
    openModal('empCardModal');
}

// ── Manual pass ───────────────────────────────────────────
let _manualEmpId = null;

function openManualModal(empId) {
    const emp = allEmployees.find(e => e.id === empId);
    _manualEmpId = empId;
    updateMealTypeAuto();
    document.getElementById('manualEmpName').textContent = emp?.full_name || '';
    document.getElementById('manualMealInfo').innerHTML =
        `<span style="font-size:15px">${MEAL_ICONS[currentMealType] || ''}</span>
         <strong>${MEAL_LABELS[currentMealType]}</strong>
         <span style="color:#94a3b8;font-size:12px"> — по расписанию</span>`;
    document.getElementById('manualResult').innerHTML = '';
    // Auto-confirm after 400ms so modal flashes the type, then submits
    openModal('manualModal');
    setTimeout(() => doManualPass(currentMealType), 500);
}

async function doManualPass(mealType) {
    if (!_manualEmpId) return;
    const ptId   = currentUser?.selected_point_id || currentUser?.assigned_point_id || null;
    const ptName = currentUser?.selected_point_name || 'Офлайн';

    const res  = await fetch('/api/meal_logs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            employee_id:     _manualEmpId,
            meal_type:       mealType,
            meal_point_id:   ptId,
            meal_point_name: ptName,
            operator_name:   currentUser?.full_name || 'Оператор',
        }),
    });
    const data = await res.json();
    const el   = document.getElementById('manualResult');

    if (data.ok) {
        el.innerHTML = `<div class="msg-ok" style="padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600">✅ ${MEAL_LABELS[mealType]} зафиксирован</div>`;
        updateScanStats(mealType, 1);
        const emp = allEmployees.find(e => e.id === _manualEmpId);
        addToScanLog(emp, 'ok');
        setTimeout(() => closeModal('manualModal'), 1500);
    } else if (data.error === 'duplicate') {
        el.innerHTML = `<div class="msg-dup" style="padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600">⚠️ Уже зафиксировано сегодня</div>`;
        setTimeout(() => closeModal('manualModal'), 1800);
    } else {
        el.innerHTML = `<div class="msg-error" style="padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600">❌ ${data.message || 'Ошибка'}</div>`;
    }
}

// ── QR modal ──────────────────────────────────────────────
function showQrModal(empId) {
    const emp = allEmployees.find(e => e.id === empId);
    if (!emp?.qr_code) return;

    document.getElementById('qrModalName').textContent = emp.full_name;
    document.getElementById('qrModalCode').textContent = emp.qr_code;

    const canvas = document.getElementById('qrCanvas');
    if (typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvas, emp.qr_code, { width: 240, margin: 2 }, () => {});
    } else {
        canvas.style.display = 'none';
    }
    openModal('qrModal');
}

// ── Modal helpers ─────────────────────────────────────────
function openModal(id) {
    document.getElementById(id).classList.add('open');
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
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
