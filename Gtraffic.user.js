// ==UserScript==
// @name         GTraffic Bypass Pro (OLLIE v2.4 - Full Widget)
// @namespace    ollie.bench
// @version      2.4
// @description  Bypass gtraffic.io - full widget UI + auto-probe API base + cooldown + error detail + manual URL
// @match        https://gtraffic.io/*
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// @connect      www.google.com
// @connect      client.gtraffic.io
// @connect      cdn.gtraffic.io
// @connect      gtraffic.io
// @connect      api-client.ontops.link
// @connect      ontops.link
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const W = unsafeWindow || window;
    const log = (...a) => console.log('[OLLIE-GT]', ...a);

    // ============================================================
    // CONFIG
    // ============================================================
    const CONFIG = {
        API_BASES: [
            'https://client.gtraffic.io/api/',
            'https://client.gtraffic.io/v1/',
            'https://client.gtraffic.io/',
            'https://api.gtraffic.io/',
            'https://api.gtraffic.io/api/',
            'https://api.gtraffic.io/v1/',
            'https://api-client.ontops.link/',
            'https://api-client.ontops.link/v1/',
            'https://api-client.ontops.link/api/',
            'https://cdn.gtraffic.io/api/',
            'https://cdn.gtraffic.io/',
            'https://gtraffic.io/api/',
            'https://gtraffic.io/api/v1/'
        ],
        A_DMM: 'Bo be chym det ca lo nha may nhe,dinh bypass site cua bo a',
        TZ: 420,
        bver: '131.0.0.0',
        cooldownSeconds: 30,
        cooldownOnError: 60,
        maxRetries: 3,
        autoSolveOCR: true,
        autoSubmit: true,
        debugMode: true,
        probeTimeout: 5000
    };

    const STATE = {
        cooldownUntil: 0,
        countdownTimer: null,
        codes: [],
        banned: false,
        worker: null,
        busy: false,
        errorLog: [],
        currentPhase: 'idle',
        manualUrl: '',
        ocrFailed: false,
        workingBase: null,
        probingBase: false,
        lastKeyword: '',
        lastDomain: ''
    };

    // ============================================================
    // ERROR CODES
    // ============================================================
    const ERR = {
        OCR_NO_TESSERACT: { code: 'E001', msg: 'Tesseract.js chưa load', hint: 'Đợi 3s, hoặc nhập URL thủ công' },
        OCR_NO_KEYWORD: { code: 'E002', msg: 'Không tìm thấy ảnh keyword', hint: 'Nhập URL thủ công' },
        OCR_NO_DOMAIN: { code: 'E003', msg: 'Không đọc được domain', hint: 'Ảnh mờ — nhập URL thủ công' },
        OCR_EMPTY: { code: 'E004', msg: 'OCR trả về rỗng', hint: 'Nhập URL thủ công' },
        OCR_FAIL: { code: 'E005', msg: 'OCR thất bại', hint: 'Nhập URL thủ công' },
        NET_OPTIONS: { code: 'E101', msg: 'OPTIONS /ch thất bại', hint: 'Server không phản hồi' },
        NET_CHALLENGE: { code: 'E102', msg: 'GET browser-challenge.js thất bại', hint: 'Kiểm tra kết nối' },
        NET_SOLVE: { code: 'E103', msg: 'POST browser-solve thất bại', hint: 'Server từ chối domProof' },
        NET_CODE: { code: 'E104', msg: 'POST /code thất bại', hint: 'Content-Key sai hoặc hết hạn' },
        NET_TIMEOUT: { code: 'E105', msg: 'Hết thời gian chờ', hint: 'Mạng chậm hoặc server treo' },
        NET_STATUS: { code: 'E106', msg: 'HTTP status lỗi', hint: 'Xem chi tiết bên dưới' },
        NO_BASE: { code: 'E107', msg: 'Không tìm được API base', hint: 'F12 Network → xem URL OPTIONS thật' },
        HDR_NO_TIME: { code: 'E201', msg: 'Thiếu header Time', hint: 'Sai endpoint — base không đúng' },
        HDR_NO_CD: { code: 'E202', msg: 'Thiếu header Cd', hint: 'Dùng mặc định 60s' },
        HDR_BAD_RESPONSE: { code: 'E203', msg: 'Response không phải JSON', hint: 'Server trả HTML — có thể bị block' },
        CHAL_NO_ID: { code: 'E301', msg: 'Không tìm thấy challengeId', hint: 'Server đổi format' },
        CHAL_NO_TOKEN: { code: 'E302', msg: 'Không tìm thấy token', hint: 'Server đổi format' },
        CODE_NO_RESULT: { code: 'E401', msg: 'Response không có mã', hint: 'Server trả success=false' },
        CODE_BAD_JSON: { code: 'E402', msg: 'Parse JSON thất bại', hint: 'Response không phải JSON' },
        CODE_BANNED: { code: 'E403', msg: 'Bị chặn (403/429)', hint: 'Chờ cooldown 60s' },
        CODE_INVALID: { code: 'E404', msg: 'Mã không hợp lệ', hint: 'Mã trả về sai format' },
        SEARCH_FAIL: { code: 'E501', msg: 'Google search thất bại', hint: 'Nhập URL thủ công' },
        SEARCH_NOT_FOUND: { code: 'E502', msg: 'Không tìm thấy URL', hint: 'Nhập URL thủ công' },
        SUBMIT_NO_INPUT: { code: 'E601', msg: 'Không tìm thấy input', hint: 'Bấm submit thủ công' },
        SUBMIT_NO_BTN: { code: 'E602', msg: 'Không tìm thấy nút submit', hint: 'Bấm submit thủ công' },
        MANUAL_URL_INVALID: { code: 'E701', msg: 'URL thủ công không hợp lệ', hint: 'Phải bắt đầu http(s)://' }
    };

    function makeError(errDef, detail) {
        return { code: errDef.code, msg: errDef.msg, hint: errDef.hint, detail: detail || '', ts: Date.now() };
    }

    function logError(error) {
        STATE.errorLog.unshift(error);
        if (STATE.errorLog.length > 20) STATE.errorLog.pop();
        log('❌', error.code, error.msg, error.detail);
        renderBanner();
    }

    // ============================================================
    // UTILS
    // ============================================================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function gmRequest(opts, phase, timeout) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: timeout || 30000,
                ...opts,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 400) resolve(res);
                    else {
                        const err = makeError(ERR.NET_STATUS,
                            `HTTP ${res.status} | phase=${phase} | body=${(res.responseText || '').slice(0, 300)}`);
                        err.httpStatus = res.status;
                        err.phase = phase;
                        err.body = (res.responseText || '').slice(0, 300);
                        reject(err);
                    }
                },
                onerror: (e) => reject(makeError(ERR.NET_STATUS, `Network | phase=${phase} | ${e.error || 'unknown'}`)),
                ontimeout: () => reject(makeError(ERR.NET_TIMEOUT, `phase=${phase}`))
            });
        });
    }

    function getHeader(res, name) {
        const raw = res.responseHeaders || '';
        const m = raw.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
        return m ? m[1].trim() : '';
    }

    function extractJsVar(text, name) {
        const i = text.indexOf(name);
        if (i === -1) return '';
        const p = text.indexOf("'", i);
        if (p === -1) return '';
        const q = text.indexOf("'", p + 1);
        return q === -1 ? '' : text.substring(p + 1, q);
    }

    function codeFromTime(ts, icm, tz = CONFIG.TZ) {
        const d = new Date((ts + tz * 60) * 1000);
        const val = (d.getUTCSeconds() + d.getUTCMinutes()) * d.getUTCHours() +
            (icm > 3 ? -d.getUTCDate() : d.getUTCDate());
        let res = val % 10;
        return res < 0 ? (res + 10) % 10 : res;
    }

    function getCanvasFp() {
        try {
            const c = document.createElement('canvas');
            c.width = 200; c.height = 40;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#ff6600'; ctx.fillRect(0, 200, 40);
            ctx.fillStyle = '#006699'; ctx.font = '16px Arial,sans-serif';
            ctx.fillText(navigator.userAgent, 2, 12);
            return c.toDataURL('image/png').slice(0, 64);
        } catch (e) { return 'data:image/png;base64,nativecanvasfp'; }
    }

    // ============================================================
    // PROBE BASE
    // ============================================================
    async function probeBase(base, rid, href, origin) {
        try {
            const r = await gmRequest({
                method: 'OPTIONS',
                url: base + 'ch',
                headers: { 'rid': rid, 'Origin': origin, 'Referer': href }
            }, `probe ${base}`, CONFIG.probeTimeout);
            const timeHdr = getHeader(r, 'Time');
            if (timeHdr) {
                return { ok: true, base, time: timeHdr, cd: getHeader(r, 'Cd'), icm: getHeader(r, 'Icm') };
            }
            return { ok: false, base, reason: 'thiếu Time header' };
        } catch (e) {
            return { ok: false, base, reason: `${e.code || '?'} ${e.msg || e.message}` };
        }
    }

    async function findWorkingBase(rid, href, origin, updateStatus) {
        if (STATE.workingBase) return STATE.workingBase;
        if (STATE.probingBase) {
            for (let i = 0; i < 60; i++) {
                await sleep(200);
                if (STATE.workingBase) return STATE.workingBase;
                if (!STATE.probingBase) break;
            }
        }
        STATE.probingBase = true;
        try {
            for (let i = 0; i < CONFIG.API_BASES.length; i++) {
                const base = CONFIG.API_BASES[i];
                updateStatus?.(`Dò base ${i + 1}/${CONFIG.API_BASES.length}: ${base}`, '#38bdf8');
                const r = await probeBase(base, rid, href, origin);
                if (r.ok) {
                    log(`✓ BASE OK: ${base} Time=${r.time} Cd=${r.cd} Icm=${r.icm}`);
                    STATE.workingBase = base;
                    try { GM_setValue('workingBase', base); } catch (e) {}
                    renderBanner();
                    return base;
                } else {
                    log(`✗ base fail: ${base} — ${r.reason}`);
                }
            }
            throw makeError(ERR.NO_BASE, `Đã thử ${CONFIG.API_BASES.length} base, không cái nào trả Time`);
        } finally {
            STATE.probingBase = false;
        }
    }

    // ============================================================
    // CORE FLOW
    // ============================================================
    async function doGetCode(rid, href, origin, updateStatus) {
        STATE.currentPhase = 'probe API base';
        updateStatus?.('Đang dò API base...', '#38bdf8');
        const base = await findWorkingBase(rid, href, origin, updateStatus);

        // BƯỚC 1
        STATE.currentPhase = 'OPTIONS /ch';
        updateStatus?.(`Bước 1/5: OPTIONS ${base}ch`, '#38bdf8');
        let r1;
        try {
            r1 = await gmRequest({
                method: 'OPTIONS',
                url: base + 'ch',
                headers: { 'rid': rid, 'Origin': origin, 'Referer': href }
            }, 'OPTIONS /ch');
        } catch (e) { logError(e); throw e; }

        const cd = parseInt(getHeader(r1, 'Cd') || '60', 10);
        const icm = parseInt(getHeader(r1, 'Icm') || '1', 10);
        const ts = parseInt(getHeader(r1, 'Time') || '0', 10);
        if (!ts) {
            throw makeError(ERR.HDR_NO_TIME, `Cd=${getHeader(r1, 'Cd')} Icm=${getHeader(r1, 'Icm')} base=${base}`);
        }
        const code = codeFromTime(ts, icm);
        const codeVersion = (code + 4) * 3 - 10;
        log(`B1 OK: Cd=${cd}s Icm=${icm} Time=${ts} code=${code} v=${codeVersion}`);

        // BƯỚC 2
        STATE.currentPhase = 'GET browser-challenge.js';
        updateStatus?.('Bước 2/5: browser-challenge.js', '#38bdf8');
        let r2;
        try {
            r2 = await gmRequest({
                method: 'GET',
                url: `${base}browser-challenge.js?rid=${rid}&t=${Date.now()}`,
                headers: { 'rid': rid, 'Origin': origin, 'Referer': href }
            }, 'GET browser-challenge.js');
        } catch (e) { logError(e); throw e; }

        const challengeId = extractJsVar(r2.responseText, 'challengeId');
        const token = extractJsVar(r2.responseText, 'token');
        log(`B2 OK: challengeId=${challengeId.slice(0, 8)} token=${token.slice(0, 8)}`);

        // BƯỚC 3
        if (challengeId) {
            STATE.currentPhase = 'POST browser-solve';
            updateStatus?.('Bước 3/5: browser-solve', '#38bdf8');
            try {
                const domParts = [
                    navigator.userAgent, navigator.language || 'vi-VN',
                    navigator.platform || 'Win32',
                    `${window.screen.width}x${window.screen.height}`,
                    String(window.devicePixelRatio || 1), 'webdriver-0',
                    ('ontouchstart' in window ? 'touch-1' : 'touch-0'),
                    (document.visibilityState === 'visible' ? 'visibility-visible' : 'visibility-hidden'),
                    getCanvasFp()
                ];
                const domProof = btoa(unescape(encodeURIComponent(domParts.join('|'))));
                await gmRequest({
                    method: 'POST',
                    url: base + 'browser-solve',
                    headers: { 'rid': rid, 'Origin': origin, 'Referer': href, 'Content-Type': 'application/json' },
                    data: JSON.stringify({ challengeId, rid, token, domProof })
                }, 'POST browser-solve');
                log('B3 OK: browser-solve');
            } catch (e) { logError(e); throw e; }
        } else {
            log('B3 SKIP: no challengeId');
        }

        // BƯỚC 4
        STATE.currentPhase = `chờ ${cd}s`;
        for (let rem = cd; rem > 0; rem--) {
            updateStatus?.(`Bước 4/5: đếm ngược ${rem}s`, rem, cd);
            await sleep(1000);
        }

        // BƯỚC 5
        STATE.currentPhase = 'POST /code';
        updateStatus?.('Bước 5/5: nhận mã', '#38bdf8');
        const uaBody = navigator.userAgent.slice(0, -1) + String(icm);
        const payload = {
            a_dmm: CONFIG.A_DMM,
            screen: `${window.screen.width}x ${window.screen.height}`,
            brower_name: 'Chrome', brower_version: CONFIG.bver,
            os_name: 'Windows', os_version: '10',
            href: href, user_agent: uaBody, hostname: origin,
            code: String(code), code_version: String(codeVersion)
        };
        const signed = { ...payload, brower_version: CONFIG.bver.slice(0, -1) + String(icm) };
        const contentKey = btoa(unescape(encodeURIComponent(JSON.stringify(signed))));

        let r5;
        try {
            r5 = await gmRequest({
                method: 'POST',
                url: base + 'code',
                headers: {
                    'rid': rid, 'Content-Key': contentKey,
                    'Origin': origin, 'Referer': href, 'Content-Type': 'application/json'
                },
                data: JSON.stringify(payload)
            }, 'POST /code');
        } catch (e) { logError(e); throw e; }

        let resData;
        try { resData = JSON.parse(r5.responseText); }
        catch (e) {
            throw makeError(ERR.CODE_BAD_JSON, `body=${r5.responseText.slice(0, 300)}`);
        }
        if (resData && resData.code) {
            log(`B5 OK: mã=${resData.code}`);
            return resData.code;
        }
        throw makeError(ERR.CODE_NO_RESULT, `response=${JSON.stringify(resData).slice(0, 200)}`);
    }

    // ============================================================
    // COOLDOWN
    // ============================================================
    function startCooldown(seconds, reason) {
        STATE.cooldownUntil = Date.now() + seconds * 1000;
        log(`COOLDOWN ${seconds}s — ${reason}`);
        try { GM_setValue('cooldownUntil', STATE.cooldownUntil); } catch (e) {}
        renderBanner();
        if (!STATE.countdownTimer) {
            STATE.countdownTimer = setInterval(tickCooldown, 1000);
            tickCooldown();
        }
    }

    function tickCooldown() {
        const left = Math.max(0, Math.ceil((STATE.cooldownUntil - Date.now()) / 1000));
        const el = document.getElementById('gt-cd');
        if (el) {
            el.textContent = left > 0 ? `🔒 ${left}s` : '✓ Ready';
            el.style.color = left > 0 ? '#f59e0b' : '#0f0';
        }
        if (left <= 0) {
            clearInterval(STATE.countdownTimer);
            STATE.countdownTimer = null;
            STATE.cooldownUntil = 0;
            try { GM_setValue('cooldownUntil', 0); } catch (e) {}
            renderBanner();
        }
    }

    function waitCooldown() {
        if (Date.now() >= STATE.cooldownUntil) return Promise.resolve();
        return new Promise(r => {
            const check = () => {
                if (Date.now() >= STATE.cooldownUntil) r();
                else setTimeout(check, 500);
            };
            check();
        });
    }

    try {
        const saved = GM_getValue('cooldownUntil', 0);
        if (saved > Date.now()) {
            STATE.cooldownUntil = saved;
            STATE.countdownTimer = setInterval(tickCooldown, 1000);
        }
        const savedBase = GM_getValue('workingBase', '');
        if (savedBase) {
            STATE.workingBase = savedBase;
            log('restore base:', savedBase);
        }
    } catch (e) {}

    // ============================================================
    // OCR
    // ============================================================
    async function getWorker() {
        if (STATE.worker) return STATE.worker;
        if (typeof Tesseract === 'undefined') throw makeError(ERR.OCR_NO_TESSERACT);
        STATE.worker = await Tesseract.createWorker('eng');
        await STATE.worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-_/:'
        });
        return STATE.worker;
    }

    function fetchImageAsDataUrl(url) {
        return new Promise((resolve, reject) => {
            if (!url) return reject(makeError(ERR.OCR_NO_KEYWORD, 'empty url'));
            if (url.startsWith('data:')) return resolve(url);
            GM_xmlhttpRequest({
                method: 'GET', url, responseType: 'blob',
                onload: (res) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => reject(makeError(ERR.OCR_FAIL, 'FileReader error'));
                    reader.readAsDataURL(res.response);
                },
                onerror: (e) => reject(makeError(ERR.OCR_FAIL, `tải ảnh: ${e.error || 'unknown'}`))
            });
        });
    }

    async function enhanceImage(dataUrl, scale = 2.5) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const w = Math.round((img.naturalWidth || img.width) * scale);
                    const h = Math.round((img.naturalHeight || img.height) * scale);
                    canvas.width = w; canvas.height = h;
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, w, h);
                    const imgData = ctx.getImageData(0, 0, w, h);
                    const d = imgData.data;
                    for (let i = 0; i < d.length; i += 4) {
                        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                        let val = (gray - 128) * 1.8 + 128;
                        val = Math.max(0, Math.min(255, val));
                        d[i] = val; d[i + 1] = val; d[i + 2] = val;
                    }
                    ctx.putImageData(imgData, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                } catch (e) { reject(makeError(ERR.OCR_FAIL, `enhance: ${e.message}`)); }
            };
            img.onerror = () => reject(makeError(ERR.OCR_FAIL, 'không load ảnh'));
            img.src = dataUrl;
        });
    }

    async function runAutoOCR() {
        let keyword = '';
        try {
            const keyImg = document.querySelector('span.notranslate img,span.font-mono img,img[alt*="tu khoa" i],img[alt*="từ khóa" i]');
            if (keyImg) {
                const data = await fetchImageAsDataUrl(keyImg.currentSrc || keyImg.src);
                const w = await getWorker();
                const res = await w.recognize(data);
                keyword = res.data.text.split('\n')[0].replace(/[^a-zA-Z0-9\u00C0-\u1EF9\s_-]/g, '').trim();
            } else {
                const span = document.querySelector('span.text-slate-900.font-mono,span.notranslate');
                if (span) keyword = span.innerText.trim();
            }
            if (!keyword) throw makeError(ERR.OCR_NO_KEYWORD, 'no keyword');
        } catch (e) {
            if (!e.code) e = makeError(ERR.OCR_FAIL, e.message);
            throw e;
        }

        let domain = '';
        try {
            const targetImg = document.querySelector('img.gallery-item,img[alt*="tim kiem" i],img[alt*="tìm kiếm" i],img[src*="cdn.gtraffic.io"]');
            if (targetImg) {
                const raw = targetImg.currentSrc || targetImg.src;
                const data = await fetchImageAsDataUrl(raw);
                const enhanced = await enhanceImage(data, 2.5);
                const w = await getWorker();
                const res = await w.recognize(enhanced);
                const lines = res.data.text.split('\n').map(l => l.trim()).filter(Boolean);
                for (const line of lines.slice(0, 3)) {
                    const m = line.match(/(?:https?|hitps|htt?ps?)[^\s/]*[/:.]+(?:www[a-z0-9]*\.)?([a-zA-Z0-9-]{4,})/i);
                    if (m && m[1]) { domain = m[1].toLowerCase().replace(/[^a-z0-9-]/g, ''); break; }
                }
                if (!domain && lines.length) {
                    const tokens = lines.slice(0, 2).join(' ').match(/[a-zA-Z0-9-]{4,}/g) || [];
                    const filtered = tokens.filter(t => !['https', 'http', 'hitps', 'www', 'com', 'net', 'vi-vn'].includes(t.toLowerCase()));
                    if (filtered.length) domain = filtered.reduce((a, b) => a.length >= b.length ? a : b);
                }
            }
            if (!domain) throw makeError(ERR.OCR_NO_DOMAIN, 'no domain');
        } catch (e) {
            if (!e.code) e = makeError(ERR.OCR_FAIL, e.message);
            throw e;
        }

        STATE.lastKeyword = keyword;
        STATE.lastDomain = domain;
        return { keyword, domain };
    }

    // ============================================================
    // SEARCH GOOGLE
    // ============================================================
    function searchGoogle(query, num = 30) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}`,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                onload: (res) => {
                    if (res.status >= 200 && res.status < 400) resolve(res.responseText || '');
                    else { const e = makeError(ERR.SEARCH_FAIL, `HTTP ${res.status}`); logError(e); reject(e); }
                },
                onerror: (e) => { const err = makeError(ERR.SEARCH_FAIL, `network: ${e.error || 'unknown'}`); logError(err); reject(err); },
                ontimeout: () => { const e = makeError(ERR.SEARCH_FAIL, 'timeout'); logError(e); reject(e); }
            });
        });
    }

    function extractUrls(html) {
        const urls = new Set();
        let match;
        const redirectRegex = /href=["']\/url\?(?:q|url)=([^"'&]+)/gi;
        while ((match = redirectRegex.exec(html)) !== null) {
            try {
                const u = decodeURIComponent(match[1]);
                if (u.startsWith('http')) urls.add(u);
            } catch (e) {}
        }
        const aHrefRegex = /<a[^>]+href=["'](https?:\/\/[^"'\s]+)["']/gi;
        while ((match = aHrefRegex.exec(html)) !== null) urls.add(match[1].split('&')[0]);
        return Array.from(urls);
    }

    function isJunkUrl(url) {
        const u = url.toLowerCase();
        const junk = ['google.', 'googleadservices.', 'googlesyndication.', 'googletagmanager.',
            'google-analytics.', 'googleusercontent.', 'gstatic.', 'googleapis.', 'doubleclick.',
            'schema.org', 'w3.org', 'youtube.com', 'youtu.be'];
        if (junk.some(d => u.includes(d))) return true;
        if (u.includes('/pagead/') || u.includes('/conversion/') || u.includes('/aclk')) return true;
        return /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|json)(?:\?|$)/i.test(url);
    }

    function matchDomain(url, targetDomain) {
        const ul = url.toLowerCase();
        const raw = targetDomain.toLowerCase().replace(/^https?:\/\//, '');
        if (raw.length >= 4 && ul.includes(raw)) return true;
        const tokens = raw.split(/[^a-z0-9]+/i).filter(t => t.length >= 4);
        if (!tokens.length) return false;
        const main = tokens.filter(t => t.length >= 5 && t !== 'http' && t !== 'https');
        if (main.length) {
            if (main.every(t => ul.includes(t))) return true;
            const longest = main.reduce((a, b) => a.length >= b.length ? a : b);
            if (longest.length >= 6 && ul.includes(longest)) return true;
        }
        for (const t of tokens) {
            if (t.length >= 7) {
                for (let len = t.length - 1; len >= 6; len--) {
                    if (ul.includes(t.slice(0, len)) || ul.includes(t.slice(-len))) return true;
                }
            }
        }
        return false;
    }

    async function autoFindUrl(keyword, domain) {
        const clean = domain.replace(/[*_~`!@#$%^&()+=|\[\]{};:?,/<>]+/g, ' ').trim();
        let html = await searchGoogle(`"${keyword}" ${clean}`, 30);
        let urls = extractUrls(html);
        let found = urls.find(u => !isJunkUrl(u) && matchDomain(u, domain));
        if (!found) {
            html = await searchGoogle(keyword, 50);
            urls = extractUrls(html);
            found = urls.find(u => !isJunkUrl(u) && matchDomain(u, domain));
        }
        if (!found) throw makeError(ERR.SEARCH_NOT_FOUND, `kw="${keyword}" domain="${domain}" urls=${urls.length}`);
        return found;
    }

    // ============================================================
    // FILL & SUBMIT
    // ============================================================
    function fillAndSubmit(code) {
        try { GM_setClipboard(code); } catch (e) {}
        const inputs = Array.from(document.querySelectorAll('input'))
            .filter(inp => inp.id !== 'gt-manual-url' && !inp.closest('#gt-panel') &&
                inp.type !== 'hidden' && inp.type !== 'checkbox' && inp.type !== 'radio');
        if (!inputs.length) { logError(makeError(ERR.SUBMIT_NO_INPUT)); return; }
        for (const inp of inputs) {
            inp.value = code;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        setTimeout(() => {
            const btns = Array.from(document.querySelectorAll('button,a.btn,input[type="submit"]'))
                .filter(b => !b.closest('#gt-panel'));
            const submit = btns.find(b => /tiếp tục|xác nhận|nhập mã|lấy mã|gửi mã|hoàn thành|xác minh|submit|continue|verify/i.test((b.textContent || b.value || '').trim()));
            if (submit) submit.click();
            else logError(makeError(ERR.SUBMIT_NO_BTN));
        }, 500);
    }

    function validateManualUrl(raw) {
        if (!raw) return null;
        let url = raw.trim();
        if (!/^https?:\/\//i.test(url)) {
            logError(makeError(ERR.MANUAL_URL_INVALID, `input="${url}"`));
            return null;
        }
        try { return new URL(url).toString(); }
        catch (e) { logError(makeError(ERR.MANUAL_URL_INVALID, e.message)); return null; }
    }

    // ============================================================
    // BANNER UI
    // ============================================================
    let banner;
    function ensureBanner() {
        if (banner && banner.isConnected) return banner;
        banner = document.createElement('div');
        banner.id = 'gt-panel';
        banner.style.cssText = `
            position:fixed;bottom:16px;right:16px;z-index:2147483647;
            width:420px;background:#0b1120;border:2px solid #10b981;
            border-radius:12px;font-family:monospace;font-size:12px;
            color:#f1f5f9;box-shadow:0 20px 40px -12px rgba(0,0,0,0.6);
            overflow:hidden;max-height:92vh;display:flex;flex-direction:column;
        `;
        (document.body || document.documentElement).appendChild(banner);
        return banner;
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderBanner() {
        const b = ensureBanner();
        const left = Math.max(0, Math.ceil((STATE.cooldownUntil - Date.now()) / 1000));
        const baseStatus = STATE.workingBase ? `✓ ${STATE.workingBase}` : '❓ chưa dò';

        const codesHtml = STATE.codes.length
            ? STATE.codes.map(c => `
                <div style="margin:4px 0;padding:4px;background:#111;border-radius:4px;display:flex;justify-content:space-between;gap:4px;">
                    <span style="color:#10b981;font-weight:bold;">${esc(c)}</span>
                    <button data-copy="${esc(c)}" style="background:#10b981;color:#000;border:0;padding:1px 6px;cursor:pointer;font-size:10px;border-radius:3px;">COPY</button>
                </div>
            `).join('')
            : '<div style="color:#666;font-size:10px;">Chưa có mã</div>';

        const errorsHtml = STATE.errorLog.length
            ? STATE.errorLog.slice(0, 5).map(e => `
                <div style="margin:4px 0;padding:6px;background:#2a0e0e;border:1px solid #7f1d1d;border-radius:4px;font-size:10px;line-height:1.4;">
                    <div style="color:#fca5a5;font-weight:bold;">[${esc(e.code)}] ${esc(e.msg)}</div>
                    ${e.phase ? `<div style="color:#f87171;">phase: ${esc(e.phase)}</div>` : ''}
                    ${e.detail ? `<div style="color:#fbbf24;word-break:break-all;">${esc(e.detail)}</div>` : ''}
                    <div style="color:#9ca3af;">💡 ${esc(e.hint)}</div>
                </div>
            `).join('')
            : '<div style="color:#666;font-size:10px;">Chưa có lỗi</div>';

        const manualSection = `
            <div style="margin-top:8px;padding:8px;background:#0f172a;border:1px solid ${STATE.ocrFailed ? '#f59e0b' : '#1e293b'};border-radius:6px;">
                <div style="font-size:10px;color:${STATE.ocrFailed ? '#f59e0b' : '#64748b'};margin-bottom:4px;font-weight:bold;text-transform:uppercase;">
                    ${STATE.ocrFailed ? '⚠️ OCR lỗi — nhập URL thủ công' : '🔗 URL thủ công (tùy chọn)'}
                </div>
                <input id="gt-manual-url" type="text" placeholder="https://gtraffic.io/Z7VQitT"
                    value="${esc(STATE.manualUrl)}"
                    style="width:100%;background:#020617;border:1px solid #334155;border-radius:4px;padding:6px 8px;font-size:11px;color:#f1f5f9;font-family:monospace;outline:none;box-sizing:border-box;margin-bottom:6px;">
                <div style="display:flex;gap:4px;">
                    <button id="gt-use-manual" style="flex:1;background:#0284c7;color:#fff;border:0;padding:5px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">
                        DÙNG URL NÀY
                    </button>
                    <button id="gt-paste" style="background:#334155;color:#38bdf8;border:0;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:10px;">
                        📋 PASTE
                    </button>
                </div>
            </div>
        `;

        b.innerHTML = `
            <div style="padding:10px 12px;background:#111827;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <span style="color:#fff;font-weight:bold;">🐤 OLLIE v2.4 · ${STATE.codes.length} mã</span>
                <span id="gt-cd" style="font-size:11px;font-weight:bold;">${left > 0 ? `🔒 ${left}s` : '✓ Ready'}</span>
                <button id="gt-close" style="background:none;border:0;color:#f66;font-size:16px;cursor:pointer;">×</button>
            </div>
            <div style="padding:10px 12px;overflow-y:auto;flex:1;">
                <div style="font-size:10px;color:#64748b;margin-bottom:6px;padding:4px 6px;background:#0f172a;border-radius:4px;">
                    <b>API base:</b> <span style="color:#38bdf8;">${esc(baseStatus)}</span>
                    ${STATE.lastKeyword ? `<br><b>Keyword:</b> <span style="color:#38bdf8;">${esc(STATE.lastKeyword)}</span>` : ''}
                    ${STATE.lastDomain ? `<br><b>Domain:</b> <span style="color:#38bdf8;">${esc(STATE.lastDomain)}</span>` : ''}
                </div>
                <div style="display:flex;gap:4px;margin-bottom:8px;">
                    <button id="gt-start" style="flex:1;background:${STATE.busy ? '#e11d48' : '#10b981'};color:#000;border:0;padding:8px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;">
                        ${STATE.busy ? 'DỪNG' : 'CHẠY — LẤY MÃ'}
                    </button>
                    <button id="gt-redetect-base" style="background:#334155;color:#38bdf8;border:0;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:10px;font-weight:bold;" title="Xoá base cache, dò lại">
                        🔄 BASE
                    </button>
                </div>
                <div id="gt-status" style="font-size:11px;color:#94a3b8;margin-bottom:8px;padding:6px;background:#0f172a;border-radius:4px;min-height:20px;">Sẵn sàng</div>

                ${manualSection}

                <div style="font-size:10px;color:#64748b;margin:8px 0 4px;text-transform:uppercase;font-weight:bold;">Mã đã lấy</div>
                <div style="max-height:120px;overflow-y:auto;">${codesHtml}</div>

                <div style="font-size:10px;color:#64748b;margin:8px 0 4px;text-transform:uppercase;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">
                    <span>Lỗi gần đây (${STATE.errorLog.length})</span>
                    <button id="gt-clear-err" style="background:#1e293b;color:#94a3b8;border:0;padding:1px 6px;font-size:9px;border-radius:3px;cursor:pointer;">XÓA</button>
                </div>
                <div style="max-height:150px;overflow-y:auto;">${errorsHtml}</div>
            </div>
        `;

        b.querySelector('#gt-close').onclick = () => { b.style.display = 'none'; };
        b.querySelector('#gt-clear-err').onclick = () => { STATE.errorLog = []; renderBanner(); };
        b.querySelector('#gt-start').onclick = () => {
            if (STATE.busy) stopAll();
            else runBypass();
        };
        b.querySelector('#gt-redetect-base').onclick = () => {
            STATE.workingBase = null;
            try { GM_setValue('workingBase', ''); } catch (e) {}
            setStatus('Đã xoá base cache — chạy lại sẽ dò', '#f59e0b');
            renderBanner();
        };

        const manualInput = b.querySelector('#gt-manual-url');
        if (manualInput) {
            manualInput.addEventListener('input', () => { STATE.manualUrl = manualInput.value; });
            manualInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') b.querySelector('#gt-use-manual').click();
            });
        }

        b.querySelector('#gt-use-manual').onclick = () => {
            const raw = manualInput.value.trim();
            const url = validateManualUrl(raw);
            if (!url) {
                setStatus('[E701] URL không hợp lệ — phải bắt đầu http(s)://', '#ef4444');
                manualInput.style.borderColor = '#ef4444';
                return;
            }
            manualInput.style.borderColor = '#10b981';
            STATE.manualUrl = url;
            runBypassWithUrl(url);
        };

        b.querySelector('#gt-paste').onclick = async () => {
            try {
                const txt = await navigator.clipboard.readText();
                manualInput.value = txt;
                STATE.manualUrl = txt;
            } catch (e) {
                setStatus('Không đọc được clipboard', '#f59e0b');
            }
        };

        b.querySelectorAll('[data-copy]').forEach(btn => {
            btn.onclick = () => {
                const v = btn.dataset.copy;
                try { GM_setClipboard(v); } catch (e) { navigator.clipboard.writeText(v); }
                btn.textContent = '✓';
                setTimeout(() => (btn.textContent = 'COPY'), 1000);
            };
        });
    }

    function setStatus(msg, color) {
        const el = document.getElementById('gt-status');
        if (el) {
            el.textContent = msg;
            el.style.color = color || '#94a3b8';
        }
    }

    // ============================================================
    // RUN
    // ============================================================
    async function runBypassWithUrl(url) {
        if (STATE.busy) { log('đang chạy'); return; }
        STATE.busy = true;
        STATE.currentPhase = 'manual-url';
        renderBanner();

        try {
            await waitCooldown();
            const origin = new URL(url).origin;
            const rid = crypto.randomUUID();
            setStatus(`RID: ${rid.slice(0, 8)} | URL: ${url.slice(0, 60)}`, '#38bdf8');
            const code = await doGetCode(rid, url, origin, (msg) => setStatus(msg, '#38bdf8'));
            STATE.codes.push(code);
            setStatus(`✓ Mã: ${code}`, '#10b981');
            if (CONFIG.autoSubmit) fillAndSubmit(code);
            try { GM_notification({ title: 'Lấy mã thành công!', text: code, timeout: 5000 }); } catch (e) {}
            startCooldown(CONFIG.cooldownSeconds, 'chống lock IP');
        } catch (e) {
            const errMsg = e.code ? `[${e.code}] ${e.msg}` : `Lỗi: ${e.message || 'unknown'}`;
            setStatus(errMsg, '#ef4444');
            if (!e.code) logError(makeError({ code: 'E999', msg: e.message || 'unknown', hint: 'Xem console' }, ''));
            else logError(e);
            startCooldown(CONFIG.cooldownOnError, 'lỗi — chờ lâu');
        } finally {
            STATE.busy = false;
            STATE.currentPhase = 'idle';
            renderBanner();
        }
    }

    async function runBypass() {
        if (STATE.busy) return;

        if (STATE.manualUrl) {
            const url = validateManualUrl(STATE.manualUrl);
            if (url) return runBypassWithUrl(url);
        }

        STATE.busy = true;
        STATE.currentPhase = 'start';
        STATE.ocrFailed = false;
        renderBanner();

        try {
            await waitCooldown();

            setStatus('OCR đọc keyword + domain...', '#38bdf8');
            let ocrData;
            try {
                ocrData = await runAutoOCR();
            } catch (e) {
                STATE.ocrFailed = true;
                setStatus(`[${e.code}] ${e.msg} — nhập URL thủ công bên dưới`, '#f59e0b');
                logError(e);
                STATE.busy = false;
                renderBanner();
                setTimeout(() => {
                    const inp = document.getElementById('gt-manual-url');
                    if (inp) { inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                }, 200);
                return;
            }

            const { keyword, domain } = ocrData;
            setStatus(`OCR: "${keyword}" | "${domain}"`, '#38bdf8');

            setStatus('Search Google tìm URL...', '#38bdf8');
            let url;
            try {
                url = await autoFindUrl(keyword, domain);
            } catch (e) {
                STATE.ocrFailed = true;
                setStatus(`[${e.code}] ${e.msg} — nhập URL thủ công`, '#f59e0b');
                logError(e);
                STATE.busy = false;
                renderBanner();
                setTimeout(() => {
                    const inp = document.getElementById('gt-manual-url');
                    if (inp) { inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                }, 200);
                return;
            }

            setStatus(`URL: ${url}`, '#38bdf8');
            const rid = crypto.randomUUID();
            const origin = new URL(url).origin;
            const code = await doGetCode(rid, url, origin, (msg) => setStatus(msg, '#38bdf8'));
            STATE.codes.push(code);
            setStatus(`✓ Mã: ${code}`, '#10b981');
            if (CONFIG.autoSubmit) fillAndSubmit(code);
            try { GM_notification({ title: 'Lấy mã thành công!', text: code, timeout: 5000 }); } catch (e) {}
            startCooldown(CONFIG.cooldownSeconds, 'chống lock IP');
        } catch (e) {
            const errMsg = e.code ? `[${e.code}] ${e.msg}` : `Lỗi: ${e.message || 'unknown'}`;
            setStatus(errMsg, '#ef4444');
            if (!e.code) logError(makeError({ code: 'E999', msg: e.message || 'unknown', hint: 'Xem console' }, ''));
            else logError(e);
            startCooldown(CONFIG.cooldownOnError, 'lỗi — chờ lâu');
        } finally {
            STATE.busy = false;
            STATE.currentPhase = 'idle';
            renderBanner();
        }
    }

    function stopAll() {
        STATE.busy = false;
        setStatus('Đã dừng', '#f59e0b');
        renderBanner();
    }

    // ============================================================
    // BOOT
    // ============================================================
    function boot() {
        renderBanner();
        log('armed | bases:', CONFIG.API_BASES.length);
        if (CONFIG.autoSolveOCR) {
            runAutoOCR().then(({ keyword, domain }) => {
                setStatus(`OCR OK: "${keyword}" | "${domain}"`, '#10b981');
            }).catch(e => {
                STATE.ocrFailed = true;
                setStatus(`[${e.code || '?'}] ${e.msg || e.message} — nhập URL thủ công`, '#f59e0b');
                renderBanner();
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();