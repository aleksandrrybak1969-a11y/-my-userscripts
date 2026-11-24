// ==UserScript==
// @name         TNG Admin поворот колец
// @namespace    http://tampermonkey.net/
// @version      50.2 
// @description  Поворот/стрелки/вертикально + женские и мужские размеры колец. F1 — показать/скрыть весь блок.
// @match        https://tngadmin.triplenext.net/Admin/CompareBag/EditBag/*
// @match        https://yruleradmin.triplenext.net/Admin/CompareBag/EditBag/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/aleksandrrbak1969-ally/-my-userscripts/main/triplenext-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/aleksandrrbak1969-ally/-my-userscripts/main/triplenext-helper.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (!/^\/admin\/comparebag\/editbag\//i.test(location.pathname)) return;

    const AUTO_OK_ALERT = true;
    const BTN_WIDTH = 'auto';
    const BTN_HEIGHT = 22;
    const BTN_OPACITY = 1;
    const BTN_FONT = 'bold 8px Arial, sans-serif';
    const ICON_FONT = 'bold 14px Arial, sans-serif';
    const ICON_BTN_MIN_WIDTH = '22px';

    const LABEL_ROTATE = '↻';
    const LABEL_ARROWS = '⇄';
    const LABEL_VERTICAL = '⇅';
    const VERTICAL_BTN_WIDTH = 'auto';

    const WIDTH_GAP_BELOW_CROP = 25;

    // Женские размеры — старые ключи сохранены для совместимости.
    const RING_SIZES_KEY = 'tm-ring-sizes-v1';
    const RING_LAST_SIZE_KEY = 'tm-ring-last-size-v1';

    // Мужские размеры — отдельные ключи и отдельное сохранение.
    const MALE_RING_SIZES_KEY = 'tm-male-ring-sizes-v1';
    const MALE_RING_LAST_SIZE_KEY = 'tm-male-ring-last-size-v1';

    const RING_DEFAULT_SIZES = ['1.5', '1.8', '2', '2.2', '2.5'];
    const MALE_RING_DEFAULT_SIZES = [];

    const RING_UI_SELECTOR = '#tm-ring-panel';

    const T = {
        rotateStep: 4,
        afterRemoveLines: 80,
        afterRotateMode: 120,
        afterRotate: 120,
        afterSave: 250,
        simpleEditor: 500,
        cropSettle: 2000,
        customEditor: 400,
        ruler: 150,
        cropTimeout: 15000
    };

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const log = (...a) => console.log('[W]', ...a);

    async function waitFor(fn, timeout = 1000, step = 40) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
            const v = fn();
            if (v) return v;
            await sleep(step);
        }
        return fn();
    }

    // Авто-подтверждение
    const ALERT_RE = /changes commit|изменения зафиксированы/i;
    let autoOkUntil = 0;

    if (AUTO_OK_ALERT) {
        const nativeAlert = window.alert;
        window.alert = function(msg) {
            if (Date.now() < autoOkUntil && ALERT_RE.test(String(msg))) return;
            return nativeAlert.apply(this, arguments);
        };

        const nativeConfirm = window.confirm;
        window.confirm = function(msg) {
            if (Date.now() < autoOkUntil && ALERT_RE.test(String(msg))) return true;
            return nativeConfirm.apply(this, arguments);
        };
    }

    function simulateClick(elem) {
        if (!elem) return;
        elem.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
        elem.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
        elem.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
    }

    function clickAt(elem) {
        if (!elem) return;
        const r = elem.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        ['mousedown', 'mouseup', 'click'].forEach(type =>
            elem.dispatchEvent(new MouseEvent(type, {
                bubbles:true, cancelable:true, view:window,
                clientX:x, clientY:y, button:0
            }))
        );
    }

    // Отступы стрелок
    const INSET_KEY = 'wArrowInset_v2';
    const MAX_INSET = 80;
    const MAX_ATTEMPTS = 5;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function loadInset() {
        try {
            const v = JSON.parse(localStorage.getItem(INSET_KEY));
            if (v && isFinite(v.l) && isFinite(v.r)) return {l:v.l, r:v.r};
        } catch (e) {}
        return {l:0, r:0};
    }

    function saveInset(v) {
        try {
            localStorage.setItem(INSET_KEY, JSON.stringify(v));
        } catch (e) {}
    }

    // Перехват кропа
    let trimInfo = null;
    let prevTrim = null;

    function pngSize(body) {
        try {
            const m = /(?:^|&)url=([^&]*)/.exec(String(body));
            if (!m) return null;
            let b64 = decodeURIComponent(m[1]).replace(/^data:image\/\w+;base64,/, '');
            const bin = atob(b64.slice(0, 64));
            if (bin.charCodeAt(1) !== 0x50 ||
                bin.charCodeAt(2) !== 0x4E ||
                bin.charCodeAt(3) !== 0x47) return null;

            const u32 = o => (
                (bin.charCodeAt(o) << 24) |
                (bin.charCodeAt(o + 1) << 16) |
                (bin.charCodeAt(o + 2) << 8) |
                bin.charCodeAt(o + 3)
            ) >>> 0;

            return {w:u32(16), h:u32(20)};
        } catch (e) {
            return null;
        }
    }

    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(m, u) {
        this._u = String(u);
        return _open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (/TrimProductImage/i.test(this._u || '')) {
            const size = pngSize(body);
            this.addEventListener('load', () => {
                try {
                    const r = JSON.parse(this.responseText);
                    trimInfo = {
                        time:Date.now(),
                        srcW:size && size.w,
                        srcH:size && size.h,
                        crop:r.crop
                    };
                } catch (e) {}
            }, {once:true});
        }
        return _send.apply(this, arguments);
    };

    // Вспомогательные функции
    const getArrows = (minWidth = 0) =>
        Array.from(document.querySelectorAll('#canvas svg path[marker-start][marker-end]'))
            .filter(p => p.isConnected && p.getBoundingClientRect().width >= minWidth);

    function imageLocal() {
        const svg = document.querySelector('#canvas svg');
        if (!svg) return null;

        let best = null, area = 0;
        svg.querySelectorAll('image').forEach(img => {
            const r = img.getBoundingClientRect();
            if (r.width * r.height > area) {
                area = r.width * r.height;
                best = r;
            }
        });

        if (!best) return null;

        const s = svg.getBoundingClientRect();
        return {
            x:best.left-s.left,
            y:best.top-s.top,
            w:best.width,
            h:best.height
        };
    }

    async function waitImage() {
        let prev = null;

        for (let i = 0; i < 40; i++) {
            const cur = imageLocal();

            if (cur && prev && cur.w > 50 &&
                Math.abs(cur.x-prev.x) < 0.5 &&
                Math.abs(cur.y-prev.y) < 0.5 &&
                Math.abs(cur.w-prev.w) < 0.5 &&
                Math.abs(cur.h-prev.h) < 0.5) return cur;

            prev = cur;
            await sleep(100);
        }
        return prev;
    }

    async function waitForSvg(timeout = 8000) {
        return await waitFor(() => {
            const svg = document.querySelector('#canvas svg');
            if (!svg) return null;
            const r = svg.getBoundingClientRect();
            return r.width < 10 || r.height < 10 ? null : svg;
        }, timeout, 100);
    }

    // Общий блок
    const MODAL_SELECTORS = [
        '.window-mask',
        '.datagrid-mask',
        '.messager-window',
        '.panel.window',
        '.window'
    ].join(',');

    let panelSuppressed = false;

    function isModalOpen() {
        const nodes = document.querySelectorAll(MODAL_SELECTORS);
        for (const el of nodes) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (el.offsetParent === null) continue;
            return true;
        }
        return false;
    }

    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .w-btn-busy {
            background-color:#dc3545 !important;
            cursor:wait !important;
            opacity:1 !important;
        }
        .w-style-btn {
            border-radius:10px !important;
            box-shadow:none !important;
            transition:filter 0.2s ease !important;
        }
        .w-style-btn:hover { filter:brightness(1.15); }
        .w-style-btn:active { filter:brightness(0.95); }
    `;
    document.head.appendChild(styleEl);

    function makeButton(width, background, font, minWidth) {
        const btn = document.createElement('div');
        btn.classList.add('w-style-btn');

        btn.style.cssText =
            'position:relative; z-index:2; flex:0 0 auto; width:auto; min-width:' +
            (minWidth || '0') + '; height:' +
            BTN_HEIGHT + 'px; display:inline-flex; align-items:center; justify-content:center; ' +
            'padding:0 4px; background-color:' + background + '; border-radius:10px; cursor:pointer; ' +
            'border:1px solid ' + background + '; box-sizing:border-box; opacity:' + BTN_OPACITY + '; ' +
            'color:white; font:' + (font || BTN_FONT) + '; white-space:nowrap; user-select:none; ' +
            'pointer-events:auto; box-shadow:none; transition:filter 0.2s ease;';

        return btn;
    }

    const rotateBtn = makeButton(BTN_WIDTH, '#00B83F', ICON_FONT, ICON_BTN_MIN_WIDTH);

    // Вертикально теперь оранжевая.
    const verticalBtn = makeButton(VERTICAL_BTN_WIDTH, '#F28C28', ICON_FONT, ICON_BTN_MIN_WIDTH);
    verticalBtn.textContent = LABEL_VERTICAL;

    const savedState = localStorage.getItem('rotateBtnState');

    if (savedState === 'place') {
        rotateBtn.textContent = LABEL_ARROWS;
        rotateBtn.dataset.state = 'place';
    } else {
        rotateBtn.textContent = LABEL_ROTATE;
        rotateBtn.dataset.state = 'rotate';
    }

    const BUTTON_OFFSET_X = 182;
    const BUTTON_OFFSET_Y = -27;

    let buttonWantedVisible = localStorage.getItem('rotateBtnDisplay') === 'flex';
    let busy = false;

    let buttonHost = null;
    let buttonLayer = null;
    let buttonGroup = null;
    let buttonRow = null;

    function ensureButtonHost(canvas) {
        const host = canvas && canvas.parentElement;
        if (!host) return null;

        if (host !== buttonHost) {
            if (buttonLayer && buttonLayer.parentElement) buttonLayer.remove();

            buttonHost = host;

            if (getComputedStyle(buttonHost).position === 'static') {
                buttonHost.style.position = 'relative';
            }

            buttonLayer = document.createElement('div');
            buttonLayer.style.cssText =
                'position:absolute; left:0; top:0; width:100%; height:100%; ' +
                'z-index:100; pointer-events:none; overflow:visible;';

            buttonHost.appendChild(buttonLayer);

            buttonGroup = document.createElement('div');
            buttonGroup.id = 'tm-rotation-ring-group';
            buttonGroup.style.cssText =
                'position:absolute; display:none; flex-direction:row; align-items:center; ' +
                'gap:0; width:max-content; z-index:101; pointer-events:none; padding:0; ' +
                'border:none; border-radius:12px; background:transparent; ' +
                'box-sizing:border-box; overflow:visible;';

            buttonRow = document.createElement('div');
            buttonRow.style.cssText =
                'display:flex; align-items:center; gap:4px; padding:0; margin:0; pointer-events:none;';

            buttonGroup.appendChild(buttonRow);
            buttonLayer.appendChild(buttonGroup);

            buttonRow.appendChild(rotateBtn);
            buttonRow.appendChild(verticalBtn);
        } else if (buttonLayer && buttonLayer.parentElement !== buttonHost) {
            buttonHost.appendChild(buttonLayer);
        }

        return buttonHost;
    }

    function applyButtonVisibility() {
        if (!buttonGroup) return;
        buttonGroup.style.display =
            buttonWantedVisible && !panelSuppressed ? 'flex' : 'none';
    }

    function syncModalState() {
        const open = isModalOpen();
        if (open === panelSuppressed) return;
        panelSuppressed = open;
        applyButtonVisibility();
    }

    function updateButtonPosition() {
        const canvas = document.querySelector('#canvas');

        if (!canvas) {
            if (buttonGroup) buttonGroup.style.display = 'none';
            return;
        }

        const host = ensureButtonHost(canvas);
        if (!host || !buttonLayer || !buttonGroup) {
            if (buttonGroup) buttonGroup.style.display = 'none';
            return;
        }

        const r = canvas.getBoundingClientRect();
        const h = host.getBoundingClientRect();

        const left = r.left-h.left-host.clientLeft+host.scrollLeft+BUTTON_OFFSET_X;
        const top = r.top-h.top-host.clientTop+host.scrollTop+BUTTON_OFFSET_Y;

        buttonGroup.style.left = left + 'px';
        buttonGroup.style.top = top + 'px';

        applyButtonVisibility();

        if (canvasObserver) canvasObserver.observe(canvas);
    }

    window.addEventListener('scroll', updateButtonPosition, true);
    window.addEventListener('resize', updateButtonPosition);

    const positionObserver = new MutationObserver(updateButtonPosition);
    positionObserver.observe(document.body, {childList:true, subtree:true});

    const canvasObserver = new ResizeObserver(updateButtonPosition);
    const modalObserver = new MutationObserver(syncModalState);

    modalObserver.observe(document.body, {
        childList:true,
        subtree:true,
        attributes:true,
        attributeFilter:['style','class']
    });

    setInterval(syncModalState, 800);
    updateButtonPosition();

    // Удаление стрелок
    const findRemoveBtn = () =>
        [...document.querySelectorAll('a, button, input[type="button"]')].find(b =>
            (b.value || b.textContent || '').trim().toLowerCase() === 'remove' &&
            b.offsetWidth > 0
        );

    async function removeArrow(arrow) {
        const count = getArrows(0).length;
        clickAt(arrow);
        await sleep(150);

        const rm = await waitFor(findRemoveBtn, 800);
        if (!rm) {
            log('кнопка Remove не найдена');
            return false;
        }

        simulateClick(rm);
        return !!(await waitFor(() => getArrows(0).length < count, 800));
    }

    async function removeOldArrows() {
        for (let i = 0; i < 8; i++) {
            const arrows = getArrows(0);
            if (!arrows.length) return true;

            if (!(await removeArrow(arrows[0]))) {
                log('Remove не убрал линию');
                break;
            }
            await sleep(150);
        }

        const left = getArrows(0).length;
        log('старых стрелок осталось:', left);
        return left === 0;
    }

    async function drawArrow(x1, y1, x2, y2) {
        const svg = await waitForSvg(8000);
        if (!svg) {
            log('drawArrow: нет svg после ожидания');
            return null;
        }

        let r = svg.getBoundingClientRect();
        const midY = r.top+(y1+y2)/2;

        if (midY < 40 || midY > window.innerHeight-40) {
            window.scrollBy(0, midY-window.innerHeight/2);
            await sleep(120);
            r = svg.getBoundingClientRect();
        }

        const A = {x:r.left+x1, y:r.top+y1};
        const B = {x:r.left+x2, y:r.top+y2};
        const before = new Set(getArrows());

        const fire = (type, pt, buttons) => {
            const t = document.elementFromPoint(pt.x, pt.y) || svg;
            t.dispatchEvent(new MouseEvent(type, {
                bubbles:true, cancelable:true, view:window,
                clientX:pt.x, clientY:pt.y,
                screenX:pt.x, screenY:pt.y,
                button:0, buttons
            }));
        };

        rotateBtn.style.pointerEvents = 'none';

        try {
            fire('mousedown', A, 1);
            const N = 10;

            for (let i = 1; i <= N; i++) {
                await sleep(10);
                fire('mousemove', {
                    x:A.x+(B.x-A.x)*i/N,
                    y:A.y+(B.y-A.y)*i/N
                }, 1);
            }

            await sleep(30);
            fire('mouseup', B, 0);
        } finally {
            rotateBtn.style.pointerEvents = 'auto';
        }

        const found = await waitFor(() => getArrows().some(p => !before.has(p)), 1500);

        if (!found) {
            log('НОВАЯ СТРЕЛКА НЕ ПОЯВИЛАСЬ: сайт не принял рисование мышью');
            return null;
        }

        await sleep(120);

        const created = getArrows().filter(p => !before.has(p));
        created.sort((a,b) =>
            b.getBoundingClientRect().width-a.getBoundingClientRect().width
        );

        const arrow = created[0];

        if (created.length > 1) {
            log('вместе с нашей стрелкой появилось ещё:', created.length-1, 'шт.');
        }

        const nums = (arrow.getAttribute('d') || '')
            .match(/-?\d+(\.\d+)?/g)?.map(Number);

        if (!nums || nums.length < 4) {
            return {arrow, sx:NaN, sy:NaN, ex:NaN, ey:NaN};
        }

        const p = {x:nums[0], y:nums[1]};
        const q = {x:nums[nums.length-2], y:nums[nums.length-1]};
        const left = p.x <= q.x ? p : q;
        const right = p.x <= q.x ? q : p;

        return {
            arrow,
            sx:left.x, sy:left.y,
            ex:right.x, ey:right.y
        };
    }

    // Расчёт места стрелки
    let pre = null;

    const rot = (p, deg) => {
        const a = deg*Math.PI/180;
        const c = Math.cos(a), s = Math.sin(a);
        return {x:p.x*c-p.y*s, y:p.x*s+p.y*c};
    };

    function bestRotation(pts) {
        let best = null;

        for (const deg of [pre.cw, -pre.cw]) {
            const r = pts.map(p => rot(p, deg));
            const err = Math.abs(r[0].y-r[1].y);
            if (!best || err < best.err) best = {deg, r, err};
        }
        return best;
    }

    async function fitArrow(x1, y, x2, inset) {
        let res = await drawArrow(x1-inset.l, y, x2+inset.r, y);

        if (!res) {
            log('fitArrow: drawArrow вернул null (нет svg)');
            return {res:null, converged:false};
        }

        let converged = false;
        let prevRes = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS && res; attempt++) {
            const dl = res.sx-x1;
            const dr = x2-res.ex;

            if (!isFinite(dl) || !isFinite(dr)) break;
            if (Math.abs(dl) < 1 && Math.abs(dr) < 1) {
                converged = true;
                break;
            }
            if (attempt === MAX_ATTEMPTS) break;

            if (prevRes) {
                const movedL = Math.abs(res.sx-prevRes.sx);
                const movedR = Math.abs(res.ex-prevRes.ex);

                if ((Math.abs(prevRes.dl) > 5 && movedL < 1) ||
                    (Math.abs(prevRes.dr) > 5 && movedR < 1)) break;
            }

            prevRes = {sx:res.sx, ex:res.ex, dl, dr};
            inset.l = clamp(inset.l+dl, -MAX_INSET, MAX_INSET);
            inset.r = clamp(inset.r+dr, -MAX_INSET, MAX_INSET);

            await removeArrow(res.arrow);
            res = await drawArrow(x1-inset.l, y, x2+inset.r, y);

            if (!res) {
                log('fitArrow: повторный drawArrow вернул null');
                break;
            }
        }

        return {res, converged};
    }

    async function placeArrow() {
        if (!pre || !pre.img) {
            log('нет данных до поворота');
            return;
        }
        if (!trimInfo || trimInfo.time < pre.time) {
            log('нет ответа кропа');
            return;
        }
        if (!trimInfo.srcW || !trimInfo.crop) {
            log('в ответе кропа нет размеров');
            return;
        }

        const post = await waitImage();
        if (!post || post.w < 50) {
            log('не вижу картинку после кропа');
            return;
        }

        const tl = trimInfo.crop.topLeft;
        const rb = trimInfo.crop.rightBottom;
        const cropW = rb.x-tl.x;
        const sX = post.w/cropW;

        const cx = pre.img.w/2;
        const cy = pre.img.h/2;

        const ptsA = [pre.p1, pre.p2].map(p => ({
            x:p.x-pre.img.x-cx,
            y:p.y-pre.img.y-cy
        }));

        const bestA = bestRotation(ptsA);
        const a = Math.abs(bestA.deg)*Math.PI/180;
        const rw = pre.img.w*Math.cos(a)+pre.img.h*Math.sin(a);
        const rh = pre.img.w*Math.sin(a)+pre.img.h*Math.cos(a);

        const kW = trimInfo.srcW/rw;
        const kH = trimInfo.srcH/rh;
        const consistentA = Math.abs(kW-kH)/kW <= 0.02;

        let P = bestA.r.map(p => ({
            x:post.x+((p.x+rw/2)*kW-tl.x)*sX,
            y:post.y+((p.y+rh/2)*kW-tl.y)*sX
        }));

        if (!consistentA) {
            const pt = prevTrim;

            if (pt && pt.srcW && pt.crop) {
                const ptl = pt.crop.topLeft;
                const prb = pt.crop.rightBottom;
                const pcw = prb.x-ptl.x;
                const pch = prb.y-ptl.y;

                const aspectErr = Math.abs((pcw/pch)/(pre.img.w/pre.img.h)-1);

                if (aspectErr < 0.015) {
                    const dispScale = pre.img.w/pcw;

                    const vs = [pre.p1, pre.p2].map(p => ({
                        x:(p.x-pre.img.x)/dispScale+ptl.x-pt.srcW/2,
                        y:(p.y-pre.img.y)/dispScale+ptl.y-pt.srcH/2
                    }));

                    const bestB = bestRotation(vs);

                    P = bestB.r.map(r => ({
                        x:post.x+((r.x+trimInfo.srcW/2)-tl.x)*sX,
                        y:post.y+((r.y+trimInfo.srcH/2)-tl.y)*sX
                    }));
                } else {
                    console.warn('[W] модель A не согласуется');
                }
            }
        }

        const sizeCx = (P[0].x+P[1].x)/2;
        const sizeCy = (P[0].y+P[1].y)/2;
        const L = Math.hypot(P[1].x-P[0].x, P[1].y-P[0].y);
        const x1 = sizeCx-L/2;
        const x2 = sizeCx+L/2;

        log(`расчётная длина стрелки: ${L.toFixed(2)} px`);

        await removeOldArrows();
        await sleep(300);

        const svgReady = await waitForSvg(8000);
        if (!svgReady) {
            log('SVG не появился после удаления стрелок');
            return;
        }

        const inset = loadInset();
        let yWidth = post.y+post.h+WIDTH_GAP_BELOW_CROP;
        const svgH = svgReady.getBoundingClientRect().height;

        if (yWidth > svgH-10) {
            log('Width не помещается ниже кропа, поднимаю до края холста');
            yWidth = svgH-10;
        }

        const ySize = sizeCy;

        log(`граница кропа y=${(post.y+post.h).toFixed(1)}; Width (1-я стрелка) y=${yWidth.toFixed(1)}; Size (2-я стрелка) y=${ySize.toFixed(1)}`);

        const r1 = await fitArrow(x1, yWidth, x2, inset);
        if (r1.converged) saveInset(inset);

        const r2 = await fitArrow(x1, ySize, x2, inset);
        if (r2.converged) saveInset(inset);

        log('Готово: Width под кропом, Size на прежнем месте');
    }

    // Обработчик поворота
    async function handleClick(mode = 'horizontal') {
        let svg = document.querySelector('#canvas svg');
        if (!svg) return;

        if (mode === 'vertical' || rotateBtn.dataset.state === 'rotate') {
            const paths = svg.querySelectorAll('path[marker-start][marker-end]');
            if (paths.length === 0) {
                console.log('Нет нарисованной линии для определения угла');
                return;
            }

            const lastPath = paths[paths.length-1];
            const nums = lastPath.getAttribute('d').match(/-?\d+(\.\d+)?/g)?.map(Number);
            if (!nums || nums.length < 4) return;

            const x1 = nums[0], y1 = nums[1];
            const x2 = nums[nums.length-2], y2 = nums[nums.length-1];

            const angleRad = Math.atan2(y2-y1, x2-x1);
            let lineAngleDeg = angleRad*(180/Math.PI);

            if (lineAngleDeg > 90) lineAngleDeg -= 180;
            if (lineAngleDeg < -90) lineAngleDeg += 180;

            let rotationDeg = mode === 'vertical' ? 90-lineAngleDeg : lineAngleDeg;
            if (rotationDeg > 90) rotationDeg -= 180;
            if (rotationDeg < -90) rotationDeg += 180;

            const clicksNeeded = Math.round(Math.abs(rotationDeg));
            const operationTime = Date.now();

            if (mode === 'horizontal') {
                pre = {
                    time:operationTime,
                    p1:{x:x1, y:y1},
                    p2:{x:x2, y:y2},
                    img:imageLocal(),
                    cw:(rotationDeg > 0 ? -1 : 1)*clicksNeeded
                };
            }

            prevTrim = trimInfo;
            trimInfo = null;

            ['A','F','W','H','D','S','M'].forEach(letter => {
                const btn = document.querySelector(
                    `a.remove-lines-btn[href*="deleteLines('${letter}')"]`
                );
                if (btn) simulateClick(btn);
            });

            await sleep(T.afterRemoveLines);

            if (clicksNeeded > 0) {
                const btnRotateMode = document.querySelector('.tng-rotate-image-icon');
                if (btnRotateMode) simulateClick(btnRotateMode);

                await sleep(T.afterRotateMode);

                const btnLeft = document.querySelector('.tng-turn-left-icon');
                const btnRight = document.querySelector('.tng-turn-right-icon');

                const targetBtn = mode === 'vertical'
                    ? (rotationDeg > 0 ? btnRight : btnLeft)
                    : (rotationDeg > 0 ? btnLeft : btnRight);

                if (targetBtn) {
                    for (let i = 0; i < clicksNeeded; i++) {
                        simulateClick(targetBtn);
                        await sleep(T.rotateStep);
                    }
                }

                await sleep(T.afterRotate);

                const btnSaveImg = document.querySelector('.save-img-btn');
                if (btnSaveImg) {
                    autoOkUntil = Date.now()+10000;
                    simulateClick(btnSaveImg);
                }

                await sleep(T.afterSave);

                document.querySelectorAll('button, a, input[type="button"]').forEach(btn => {
                    const text = (btn.value || btn.textContent || '').trim().toUpperCase();
                    if ((text === 'OK' || text === 'ОК') &&
                        btn.offsetWidth > 0 && btn.offsetHeight > 0) {
                        simulateClick(btn);
                    }
                });

                await sleep(200);
                autoOkUntil = 0;
            }

            const btnSimpleEditor = document.getElementById('btn-use-simple-editor');
            if (btnSimpleEditor) {
                simulateClick(btnSimpleEditor);
                await sleep(T.simpleEditor);
            }

            const btnAutoCrop = await waitFor(() => {
                const b = document.getElementById('btn-trim-product-image');
                return b && b.offsetWidth > 0 && !b.disabled &&
                    !b.classList.contains('disabled') ? b : null;
            }, 6000, 50);

            if (btnAutoCrop) {
                simulateClick(btnAutoCrop);
                const got = await waitFor(
                    () => trimInfo && trimInfo.time >= operationTime,
                    T.cropTimeout,
                    50
                );
                if (got) await sleep(T.cropSettle);
            }

            const btnCustomEditor = document.getElementById('btn-use-custom-editor');
            if (btnCustomEditor) {
                simulateClick(btnCustomEditor);
                await sleep(T.customEditor);
            }

            const btnRuler = document.querySelector('.tng-ruler-icon');
            if (btnRuler) {
                simulateClick(btnRuler);
                await sleep(T.ruler);
            }

            if (mode === 'vertical') {
                rotateBtn.textContent = LABEL_ROTATE;
                rotateBtn.dataset.state = 'rotate';
                localStorage.setItem('rotateBtnState', 'rotate');
                console.log('✅ Вертикальный поворот завершён! Второй этап не требуется.');
                return;
            }

            rotateBtn.textContent = LABEL_ARROWS;
            rotateBtn.dataset.state = 'place';
            localStorage.setItem('rotateBtnState', 'place');
            console.log('✅ Этап 1 завершен!');
        } else if (rotateBtn.dataset.state === 'place') {
            try {
                await placeArrow();
            } catch (err) {
                console.error('[W] ошибка:', err);
            }

            rotateBtn.textContent = LABEL_ROTATE;
            rotateBtn.dataset.state = 'rotate';
            localStorage.setItem('rotateBtnState', 'rotate');
        }
    }

    // Действия кнопок
    rotateBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        rotateBtn.classList.add('w-btn-busy');

        try {
            await handleClick();
        } finally {
            busy = false;
            rotateBtn.classList.remove('w-btn-busy');
            rotateBtn.style.opacity = String(BTN_OPACITY);
        }
    };

    verticalBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        verticalBtn.classList.add('w-btn-busy');

        try {
            await handleClick('vertical');
        } catch (err) {
            console.error('[W] ошибка вертикального поворота:', err);
        } finally {
            busy = false;
            verticalBtn.classList.remove('w-btn-busy');
            verticalBtn.style.opacity = String(BTN_OPACITY);
        }
    };

    // F1 — показать/скрыть весь блок.
    document.addEventListener('keydown', e => {
        if (e.code !== 'F1' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

        const target = e.target;
        if (target && (target.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;

        buttonWantedVisible = !buttonWantedVisible;
        localStorage.setItem('rotateBtnDisplay', buttonWantedVisible ? 'flex' : 'none');
        applyButtonVisibility();
    }, true);

    updateButtonPosition();

    // Панель размеров колец
    const ringCleanNumber = v => String(v).trim().replace(',', '.');

    function loadSizeList(key, defaults) {
        try {
            const saved = JSON.parse(localStorage.getItem(key));
            if (Array.isArray(saved)) {
                return saved.map(ringCleanNumber)
                    .filter(s => /^\d+(\.\d+)?$/.test(s));
            }
        } catch (e) {}
        return defaults.slice();
    }

    function saveSizeList(key, list) {
        try {
            localStorage.setItem(key, JSON.stringify(list));
        } catch (e) {}
    }

    function loadRingSizes() {
        return loadSizeList(RING_SIZES_KEY, RING_DEFAULT_SIZES);
    }

    function loadMaleRingSizes() {
        return loadSizeList(MALE_RING_SIZES_KEY, MALE_RING_DEFAULT_SIZES);
    }

    function findCellByText(text) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;

        while ((n = walker.nextNode())) {
            const v = n.nodeValue;
            if (v.length > 100 || v.trim().toLowerCase() !== text) continue;

            const el = n.parentElement;
            if (!el) continue;

            const cell = el.closest('th, td');
            if (cell && !el.closest(RING_UI_SELECTOR)) return cell;
        }
        return null;
    }

    function collectInputs(labelEl) {
        const visible = list =>
            Array.from(list).filter(inp => inp.offsetParent !== null);

        const row = labelEl.closest('tr');
        if (row) return visible(row.querySelectorAll('input.combo-text'));

        let inputs = [];
        let parent = labelEl.parentElement;

        while (parent && inputs.length < 3) {
            inputs = visible(parent.querySelectorAll('input.combo-text'));
            parent = parent.parentElement;
        }
        return inputs;
    }

    function getCmRowInputs() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        let sawLabel = false;

        while ((n = walker.nextNode())) {
            const v = n.nodeValue;
            if (v.length > 100) continue;

            const t = v.trim().toLowerCase();
            if (t !== 'cm' && t !== 'cm.') continue;

            const el = n.parentElement;
            if (!el || el.closest(RING_UI_SELECTOR)) continue;

            sawLabel = true;
            const inputs = collectInputs(el);
            if (inputs.length >= 3) return {inputs};
        }

        return {
            error:sawLabel
                ? 'В строке "cm" меньше трёх полей.'
                : 'Не найдена метка "cm".'
        };
    }

    function setEasyUIValue(input, value) {
        if (!input) return;

        input.value = value;
        const combo = input.closest('.combo');

        if (combo) {
            const hidden = combo.querySelector('input.combo-value');
            if (hidden) hidden.value = value;
        }

        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));

        input.style.backgroundColor = '#d4edda';
        setTimeout(() => {input.style.backgroundColor = '';}, 2000);
    }

    function fillWidthCm(value) {
        const target = getCmRowInputs();

        if (target.error) {
            alert(target.error);
            return;
        }

        setEasyUIValue(target.inputs[1], ringCleanNumber(value));
        console.log('💍 Width (cm) =', value);
    }

    // Универсальная работа с двумя независимыми списками.
    const RING_GROUPS = {
        female: {
            sizesKey:RING_SIZES_KEY,
            lastKey:RING_LAST_SIZE_KEY,
            defaults:RING_DEFAULT_SIZES,
            label:'Женские размеры',
            buttonLabel:'ЖЕН',
            mainColor:'#D85A91',
            mainBorder:'#B83D72'
        },
        male: {
            sizesKey:MALE_RING_SIZES_KEY,
            lastKey:MALE_RING_LAST_SIZE_KEY,
            defaults:MALE_RING_DEFAULT_SIZES,
            label:'Мужские размеры',
            buttonLabel:'МУЖ',
            mainColor:'#3498DB',
            mainBorder:'#2475AD'
        }
    };

    function getGroupSizes(type) {
        const cfg = RING_GROUPS[type];
        return loadSizeList(cfg.sizesKey, cfg.defaults);
    }

    function getLastGroupSize(type) {
        const cfg = RING_GROUPS[type];
        const sizes = getGroupSizes(type);
        const saved = localStorage.getItem(cfg.lastKey);

        return sizes.includes(saved) ? saved : (sizes[0] || '');
    }

    function setLastGroupSize(type, size) {
        const cfg = RING_GROUPS[type];
        if (size) localStorage.setItem(cfg.lastKey, size);
    }

    function editGroupSizes(type) {
        const cfg = RING_GROUPS[type];
        const current = getGroupSizes(type).join(', ');

        const answer = prompt(
            cfg.label + ' (Width, см) через запятую:',
            current
        );

        if (answer === null) return;

        const list = answer
            .split(/[;,\s]+/)
            .map(ringCleanNumber)
            .filter(s => /^\d+(\.\d+)?$/.test(s));

        if (!list.length) {
            alert('Не найдено ни одного корректного числа. Список не изменён.');
            return;
        }

        saveSizeList(cfg.sizesKey, list);

        const last = localStorage.getItem(cfg.lastKey);
        if (!list.includes(last)) {
            localStorage.setItem(cfg.lastKey, list[0]);
        }

        renderRingButtons();
    }

    function closeRingDropdowns() {
        document.querySelectorAll('.tm-ring-dropdown').forEach(dropdown => {
            dropdown.style.display = 'none';
        });
    }

    function toggleRingDropdown(dropdown) {
        if (!dropdown) return;

        const shouldOpen = dropdown.style.display !== 'flex';
        closeRingDropdowns();

        if (shouldOpen) dropdown.style.display = 'flex';
    }

    function selectGroupSize(type, size) {
        setLastGroupSize(type, size);

        const mainBtn = document.getElementById('tm-ring-main-' + type);
        if (mainBtn) mainBtn.textContent = size;

        fillWidthCm(size);
        closeRingDropdowns();
    }

    function makeRingBtn(text, title, bg, border) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.title = title;
        btn.classList.add('w-style-btn');

        btn.style.cssText = `
            width:auto;
            min-width:0;
            height:22px;
            box-sizing:border-box;
            padding:0 8px;
            margin:0;
            background:${bg};
            color:#ffffff;
            border:1px solid ${border};
            border-radius:10px;
            font-size:10px;
            font-weight:bold;
            font-family:Arial,sans-serif;
            cursor:pointer;
            line-height:22px;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            vertical-align:middle;
            white-space:nowrap;
            box-shadow:none;
            transition:filter 0.2s ease;
        `;

        return btn;
    }

    function createRingGroup(type) {
        const cfg = RING_GROUPS[type];
        const sizes = getGroupSizes(type);
        const lastSize = getLastGroupSize(type);

        // Отдельная обёртка нужна, чтобы каждый список открывался над своей кнопкой.
        const group = document.createElement('div');
        group.className = 'tm-ring-size-group';
        group.style.cssText = `
            position:relative;
            display:flex;
            flex-direction:row;
            align-items:center;
            gap:3px;
            width:max-content;
            height:22px;
            overflow:visible;
        `;

        const mainBtn = makeRingBtn(
            lastSize || cfg.buttonLabel,
            cfg.label + ': ЛКМ — вставить последний размер; ПКМ — открыть список; двойной клик — редактировать список',
            cfg.mainColor,
            cfg.mainBorder
        );

        mainBtn.id = 'tm-ring-main-' + type;

        mainBtn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();

            // Второй клик из двойного — игнорируем, чтобы не вставить размер дважды.
            if (e.detail > 1) return;

            const selected = getLastGroupSize(type);
            if (selected) selectGroupSize(type, selected);
            else editGroupSizes(type);
        });

        mainBtn.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            closeRingDropdowns();
            editGroupSizes(type);
        });

        mainBtn.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleRingDropdown(dropdown);
        });

        group.appendChild(mainBtn);

        const dropdown = document.createElement('div');
        dropdown.className = 'tm-ring-dropdown';
        dropdown.id = 'tm-ring-dropdown-' + type;

        // Список открывается ВВЕРХ: bottom:27px прижимает его над кнопкой.
        dropdown.style.cssText = `
            position:absolute;
            display:none;
            flex-direction:column;
            align-items:stretch;
            gap:3px;
            left:0;
            bottom:27px;
            min-width:58px;
            max-height:220px;
            overflow-y:auto;
            padding:5px;
            background:#30343b;
            border:1px solid #666;
            border-radius:9px;
            box-shadow:0 3px 10px rgba(0,0,0,0.35);
            z-index:10000;
            box-sizing:border-box;
        `;

        sizes.forEach(size => {
            const item = makeRingBtn(
                size,
                'Выбрать размер ' + size,
                size === lastSize ? cfg.mainColor : '#505761',
                size === lastSize ? cfg.mainBorder : '#68717c'
            );

            item.style.width = '100%';

            item.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                selectGroupSize(type, size);
            });

            dropdown.appendChild(item);
        });

        group.appendChild(dropdown);

        // Кнопка-карандаш удалена — редактирование списка теперь по двойному клику.

        return group;
    }

    function renderRingButtons() {
        const container = document.getElementById('tm-ring-panel');
        if (!container) return;

        container.innerHTML = '';

        // Сначала женская розовая группа.
        container.appendChild(createRingGroup('female'));

        // Сразу справа от неё — мужская голубая группа.
        container.appendChild(createRingGroup('male'));
    }

    document.addEventListener('mousedown', e => {
        const panel = document.getElementById('tm-ring-panel');
        if (panel && !panel.contains(e.target)) closeRingDropdowns();
    });

    document.addEventListener('contextmenu', e => {
        if (e.target instanceof Element && e.target.closest('#tm-ring-panel')) {
            e.preventDefault();
        }
    });

    // Создание панели размеров внутри общего блока.
    function createRingPanel() {
        const canvas = document.querySelector('#canvas');
        if (!canvas) return false;

        ensureButtonHost(canvas);
        if (!buttonGroup) return false;

        let container = document.getElementById('tm-ring-panel');

        if (container && container.parentElement === buttonGroup) return true;
        if (container) container.remove();

        container = document.createElement('div');
        container.id = 'tm-ring-panel';

        container.style.cssText = `
            position:relative;
            display:flex;
            flex-direction:row;
            align-items:center;
            gap:4px;
            width:max-content;
            height:22px;
            margin:0 0 0 3.75px;
            padding:0;
            z-index:102;
            border:none;
            border-radius:12px;
            overflow:visible;
            box-shadow:none;
            font-family:Arial,sans-serif;
            user-select:none;
            pointer-events:auto;
            box-sizing:border-box;
        `;

        buttonGroup.appendChild(container);
        renderRingButtons();

        return true;
    }

    setTimeout(() => {
        let tries = 0;

        (function tryCreate() {
            if (createRingPanel() || ++tries > 15) return;
            setTimeout(tryCreate, 1000);
        })();

        setInterval(() => {
            createRingPanel();
            updateButtonPosition();
        }, 800);
    }, 2000);

})();
