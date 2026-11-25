// ==UserScript==
// @name         Triplenext: автозаполнение размеров
// @namespace    http://tampermonkey.net/
// @version      3.81
// @description  Автозаполнение размеров, передача между вкладками, Auto, перестановка, F2, копирование в Admin
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/aleksandrrybak1969-a11y/-my-userscripts/main/triplenext-autofill-sizes.user.js
// @downloadURL  https://raw.githubusercontent.com/aleksandrrybak1969-a11y/-my-userscripts/main/triplenext-autofill-sizes.user.js
// ==/UserScript==

(function () {
    'use strict';

    const ACTIVE_ADMIN_KEY = 'tng_active_admin_tab';
    const CLIENT_TARGET_KEY = 'tng_target_admin_tab';

    const HIGHLIGHT_DURATION_MS = 10000;

    const isAdminPage =
        location.hostname === 'tngadmin.triplenext.net' &&
        location.pathname.startsWith('/Admin/CompareBag/EditBag/');

    const adminTabId = isAdminPage
        ? 'admin_' + Date.now() + '_' + Math.random().toString(36).slice(2)
        : null;

    const STORAGE_KEY = isAdminPage
        ? 'tng_copied_dimensions_' + adminTabId
        : null;

    // КЛИЕНТСКИЕ САЙТЫ

    if (!isAdminPage) {

        function captureAdminAssociation() {
            const activeAdmin = GM_getValue(ACTIVE_ADMIN_KEY, null);

            if (!activeAdmin || !activeAdmin.id) return;

            sessionStorage.setItem(CLIENT_TARGET_KEY, activeAdmin.id);

            console.log('📌 Клиентская вкладка связана с Admin:', activeAdmin.id);
        }

        if (document.visibilityState === 'visible') {
            captureAdminAssociation();
            setTimeout(captureAdminAssociation, 150);
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                setTimeout(captureAdminAssociation, 100);
            }
        });

        // Отправка выделенного текста в Admin
        let lastSent = { text: '', time: 0 };

        function sendSelectionToAdmin(text) {
            text = (text || '').trim();
            if (!text) return;

            // Фильтр: отправляем только то, что похоже на размеры
            if (!/\d/.test(text)) return;
            if (
                !/[xх×]/i.test(text) &&
                !/\d\s*(mm|мм|cm|см|in|inch|"|″)/i.test(text) &&
                !/(length|длина|width|ширина|height|высота|depth|глубина)/i.test(text)
            ) {
                return;
            }

            const now = Date.now();

            // Дедупликация: не отправляем одно и то же дважды подряд
            if (text === lastSent.text && now - lastSent.time < 1500) return;

            lastSent = { text, time: now };

            const targetAdminId = sessionStorage.getItem(CLIENT_TARGET_KEY);

            if (!targetAdminId) {
                console.log('⚠️ Не найдена исходная вкладка Admin.');
                return;
            }

            const targetStorageKey =
                'tng_copied_dimensions_' + targetAdminId;

            GM_setValue(targetStorageKey, {
                text: text,
                time: Date.now()
            });

            console.log('📐 Размеры отправлены в Admin (выделение):', text);
        }

        // 1) Выделение мышью: срабатывает после отпускания кнопки
        document.addEventListener('mouseup', function () {
            setTimeout(function () {
                const selection = window.getSelection();
                const text = selection ? selection.toString() : '';
                sendSelectionToAdmin(text);
            }, 30);
        }, true);

        // 2) Выделение внутри input/textarea
        document.addEventListener('select', function (e) {
            const el = e.target;
            if (!el || typeof el.selectionStart !== 'number') return;
            if (el.selectionStart === el.selectionEnd) return;

            const text = el.value.substring(el.selectionStart, el.selectionEnd);
            sendSelectionToAdmin(text);
        }, true);

        // 3) Двойной клик (выделяет слово)
        document.addEventListener('dblclick', function () {
            setTimeout(function () {
                const selection = window.getSelection();
                const text = selection ? selection.toString() : '';
                sendSelectionToAdmin(text);
            }, 30);
        }, true);

        return;
    }

    // ADMIN: ЗАПОМИНАНИЕ ВКЛАДКИ

    function markThisAdminAsSource() {
        GM_setValue(ACTIVE_ADMIN_KEY, {
            id: adminTabId,
            time: Date.now()
        });

        console.log('📌 Вкладка Admin запомнена:', adminTabId);
    }

    if (document.visibilityState === 'visible') {
        markThisAdminAsSource();
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            markThisAdminAsSource();
        }
    });

    // НАСТРОЙКИ ПАНЕЛИ

    const UI_SELECTOR = '#tm-fill-sizes, #tm-auto-btn';

    const MODAL_SELECTORS = [
        '.window-mask',
        '.datagrid-mask',
        '.messager-window',
        '.panel.window',
        '.window'
    ].join(',');

    let buttonsHidden = false;
    let panelSuppressed = false;
    let swapMenu = null;

    function applyVisibility() {
        const hide = buttonsHidden || panelSuppressed;

        document.querySelectorAll(UI_SELECTOR).forEach(el => {
            el.style.visibility = hide ? 'hidden' : 'visible';
        });
    }

    function isModalOpen() {
        for (const el of document.querySelectorAll(MODAL_SELECTORS)) {
            const cs = getComputedStyle(el);

            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (el.offsetParent === null) continue;

            return true;
        }

        return false;
    }

    function syncModalState() {
        const open = isModalOpen();

        if (open === panelSuppressed) return;

        panelSuppressed = open;
        applyVisibility();
    }

    document.addEventListener('keydown', e => {
        if (e.key !== 'F2' || e.repeat) return;

        e.preventDefault();
        buttonsHidden = !buttonsHidden;
        applyVisibility();
    }, true);

    setTimeout(init, 2000);

    function init() {
        let tries = 0;

        (function tryCreate() {
            if (createTopPanel() || ++tries > 15) return;
            setTimeout(tryCreate, 1000);
        })();

        const modalObserver = new MutationObserver(syncModalState);

        modalObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        setInterval(syncModalState, 800);

        document.addEventListener('paste', handleClientPaste, true);

        document.addEventListener('copy', handleAdminCopy, true);

        // Выделение мышью в Admin: сразу заполняем поля
        document.addEventListener('mouseup', handleAdminSelection, true);

        document.addEventListener('select', function (e) {
            const el = e.target;
            if (!el || typeof el.selectionStart !== 'number') return;
            if (el.selectionStart === el.selectionEnd) return;

            // Не трогаем поля размеров — там своё меню по dblclick
            if (el.classList && el.classList.contains('combo-text')) return;

            const text = el.value
                .substring(el.selectionStart, el.selectionEnd)
                .trim();

            if (!text) return;
            if (!/\d/.test(text)) return;
            if (
                !/[xх×]/i.test(text) &&
                !/\d\s*(mm|мм|cm|см|in|inch|"|″)/i.test(text) &&
                !/(length|длина|width|ширина|height|высота|depth|глубина)/i.test(text)
            ) {
                return;
            }

            const now = Date.now();

            if (
                text === lastAdminSelection.text &&
                now - lastAdminSelection.time < 1500
            ) {
                return;
            }

            lastAdminSelection = { text, time: now };

            const result = parseClientDimensions(text);
            if (!result) return;

            console.log('📋 Размеры выделены в Admin (input):', text);
            fillDimensions(result, 'выделение в Admin (input)');
        }, true);

        document.addEventListener('dblclick', function (event) {
            const el = event.target;

            if (
                el &&
                el.tagName === 'INPUT' &&
                el.classList.contains('combo-text')
            ) {
                return; // не мешаем меню перестановки
            }

            handleAdminSelection();
        }, true);

        if (typeof GM_addValueChangeListener === 'function') {
            GM_addValueChangeListener(
                STORAGE_KEY,
                function (name, oldValue, newValue) {
                    if (!newValue || !newValue.text) return;
                    receiveCopiedDimensions(newValue.text);
                }
            );
        }

        document.addEventListener(
            'dblclick',
            handleFieldDoubleClick,
            true
        );
    }

    // ВЫДЕЛЕНИЕ В ADMIN

    let lastAdminSelection = { text: '', time: 0 };

    function handleAdminSelection() {
        setTimeout(function () {
            const selection = window.getSelection();
            const text = selection ? selection.toString().trim() : '';

            if (!text) return;

            // Фильтр: только то, что похоже на размеры
            if (!/\d/.test(text)) return;
            if (
                !/[xх×]/i.test(text) &&
                !/\d\s*(mm|мм|cm|см|in|inch|"|″)/i.test(text) &&
                !/(length|длина|width|ширина|height|высота|depth|глубина)/i.test(text)
            ) {
                return;
            }

            const now = Date.now();

            if (
                text === lastAdminSelection.text &&
                now - lastAdminSelection.time < 1500
            ) {
                return;
            }

            lastAdminSelection = { text, time: now };

            const result = parseClientDimensions(text);

            if (!result) return;

            console.log('📋 Размеры выделены в Admin:', text);
            fillDimensions(result, 'выделение в Admin');
        }, 30);
    }

    // ПОИСК ПОЛЕЙ РАЗМЕРОВ

    function collectInputs(labelEl) {
        const visible = list =>
            Array.from(list).filter(inp => inp.offsetParent !== null);

        const row = labelEl.closest('tr');

        if (row) {
            return visible(row.querySelectorAll('input.combo-text'));
        }

        let inputs = [];
        let parent = labelEl.parentElement;

        while (parent && inputs.length < 3) {
            inputs = visible(
                parent.querySelectorAll('input.combo-text')
            );

            parent = parent.parentElement;
        }

        return inputs;
    }

    function getRowInputs(mode) {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT
        );

        let n;
        let sawLabel = false;

        while ((n = walker.nextNode())) {
            const v = n.nodeValue;

            if (v.length > 100) continue;

            const t = v.trim().toLowerCase();

            if (t !== mode && t !== mode + '.') continue;

            const el = n.parentElement;

            if (!el || el.closest(UI_SELECTOR)) continue;

            sawLabel = true;

            const inputs = collectInputs(el);

            if (inputs.length >= 3) {
                return { inputs };
            }
        }

        return {
            error: sawLabel
                ? `В строке "${mode}" меньше трёх полей.`
                : `Не найдена метка "${mode}".`
        };
    }

    function detectInputMode(input) {
        for (const mode of ['cm', 'in']) {
            const target = getRowInputs(mode);

            if (!target.error && target.inputs.includes(input)) {
                return mode;
            }
        }

        return null;
    }

    // РАЗБОР ЧИСЕЛ

    const NUMBER_PATTERN =
        '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[.,]\\d+)';

    const UNIT_PATTERN =
        '(mm|мм|cm|см|inches|inch|in\\.?|["″”“])';

    const NUMBER_UNIT_RE = new RegExp(
        `(${NUMBER_PATTERN})\\s*${UNIT_PATTERN}`,
        'gi'
    );

    const TRIPLE_RE = new RegExp(
        `(?:[A-Za-zА-Яа-я]+\\s*)?(${NUMBER_PATTERN})\\s*` +
        `[xх×]\\s*(?:[A-Za-zА-Яа-я]+\\s*)?(${NUMBER_PATTERN})\\s*` +
        `[xх×]\\s*(?:[A-Za-zА-Яа-я]+\\s*)?(${NUMBER_PATTERN})`,
        'i'
    );

    const PAIR_RE = new RegExp(
        `(?:[A-Za-zА-Яа-я]+\\s*)?(${NUMBER_PATTERN})\\s*` +
        `[xх×]\\s*(?:[A-Za-zА-Яа-я]+\\s*)?(${NUMBER_PATTERN})`,
        'i'
    );

    function parseNumber(value) {
        const s = String(value).trim().replace(',', '.');

        let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);

        if (m) {
            const denominator = Number(m[3]);
            if (!denominator) return NaN;

            return Number(
                (Number(m[1]) + Number(m[2]) / denominator).toFixed(2)
            );
        }

        m = s.match(/^(\d+)\/(\d+)$/);

        if (m) {
            const denominator = Number(m[2]);
            if (!denominator) return NaN;

            return Number(
                (Number(m[1]) / denominator).toFixed(2)
            );
        }

        return Number(s);
    }

    function normalizeUnit(unit) {
        const u = unit.toLowerCase();

        if (u === 'mm' || u === 'мм') return 'mm';
        if (u === 'cm' || u === 'см') return 'cm';

        return 'in';
    }

    function convertUnit(value, unit) {
        if (unit === 'mm') return value / 10;
        return value;
    }

    function formatSize(value) {
        return Number(
            (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2)
        ).toString();
    }

    // РАСПОЗНАВАНИЕ РАЗМЕРОВ

    function parseClientDimensions(text) {
        if (!text || !text.trim()) return null;

        const source = text
            .replace(/\u00a0/g, ' ')
            .replace(/[–—]/g, '-');

        let values = [];
        let unit = null;

        // 1. Три размера с единицей в конце.
        const tailTripleRe = new RegExp(
            `(${NUMBER_PATTERN})\\s*[xх×]\\s*` +
            `(${NUMBER_PATTERN})\\s*[xх×]\\s*` +
            `(${NUMBER_PATTERN})\\s*${UNIT_PATTERN}`,
            'i'
        );

        // 2. Два размера с единицей в конце.
        const tailPairRe = new RegExp(
            `(${NUMBER_PATTERN})\\s*[xх×]\\s*` +
            `(${NUMBER_PATTERN})\\s*${UNIT_PATTERN}`,
            'i'
        );

        const tripleMatch = source.match(tailTripleRe);

        if (tripleMatch) {
            values = [
                parseNumber(tripleMatch[1]),
                parseNumber(tripleMatch[2]),
                parseNumber(tripleMatch[3])
            ];

            unit = normalizeUnit(tripleMatch[4]);

        } else {
            const pairMatch = source.match(tailPairRe);

            if (pairMatch) {
                values = [
                    parseNumber(pairMatch[1]),
                    parseNumber(pairMatch[2])
                ];

                unit = normalizeUnit(pairMatch[3]);
            }
        }

        // --- БЛОК РАСПОЗНАВАНИЯ ТЕКСТА С ПОДПИСЯМИ ---
        if (values.length === 0) {
            const lenMatch = source.match(/(?:length|длина)[^\d]*(\d+(?:[.,]\d+)?)/i);
            const hMatch = source.match(/(?:height|высота)[^\d]*(\d+(?:[.,]\d+)?)/i);
            const dMatch = source.match(/(?:depth|глубина)[^\d]*(\d+(?:[.,]\d+)?)/i);
            const wMatch = source.match(/(?:width|ширина)[^\d]*(\d+(?:[.,]\d+)?)/i);

            if (lenMatch || hMatch || dMatch || wMatch) {
                let tempValues = [];
                if (lenMatch) tempValues.push(parseNumber(lenMatch[1]));
                if (hMatch) tempValues.push(parseNumber(hMatch[1]));
                if (dMatch) tempValues.push(parseNumber(dMatch[1]));
                if (wMatch) tempValues.push(parseNumber(wMatch[1]));

                const unitMatch = source.match(/(mm|см|cm|in|inch|")/i);
                unit = unitMatch ? normalizeUnit(unitMatch[1]) : 'cm';

                values = tempValues.map(v => convertUnit(v, unit));
            }
        }
        // ----------------------------------------------

        // 3. Единица указана после каждого числа.
        if (values.length === 0) {
            const unitMatches = Array.from(
                source.matchAll(NUMBER_UNIT_RE)
            );

            if (unitMatches.length >= 2) {
                const units = [
                    ...new Set(
                        unitMatches.map(m => normalizeUnit(m[2]))
                    )
                ];

                if (units.length !== 1) return null;

                unit = units[0];
                values = unitMatches.map(m => parseNumber(m[1]));
            }
        }

        // 4. Если единиц нет, считаем сантиметрами.
        if (values.length === 0) {
            const triple = source.match(TRIPLE_RE);

            if (triple) {
                values = [
                    parseNumber(triple[1]),
                    parseNumber(triple[2]),
                    parseNumber(triple[3])
                ];
            } else {
                const pair = source.match(PAIR_RE);

                if (!pair) return null;

                values = [
                    parseNumber(pair[1]),
                    parseNumber(pair[2])
                ];
            }

            unit = 'cm';
        }

        if (
            values.length < 2 ||
            values.length > 3 ||
            values.some(v => !Number.isFinite(v) || v < 0)
        ) {
            return null;
        }

        // Миллиметры переводим в сантиметры.
        values = values.map(v => convertUnit(v, unit));

        // Сортируем от меньшего к большему.
        values.sort((a, b) => a - b);

        let depth;
        let height;
        let width;

        if (values.length === 2) {
            depth = 0;
            height = values[0];
            width = values[1];
        } else {
            depth = values[0];
            height = values[1];
            width = values[2];
        }

        return {
            depth: formatSize(depth),
            height: formatSize(height),
            width: formatSize(width),
            unit,
            targetMode: unit === 'in' ? 'in' : 'cm'
        };
    }

    // УСТАНОВКА ЗНАЧЕНИЙ EASYUI

    function flashInput(input) {
        input.style.backgroundColor = '#d4edda';

        if (input._tmHighlightTimer) {
            clearTimeout(input._tmHighlightTimer);
        }

        input._tmHighlightTimer = setTimeout(() => {
            input.style.backgroundColor = '';
            input._tmHighlightTimer = null;
        }, HIGHLIGHT_DURATION_MS);
    }

    function setEasyUIValue(input, value) {
        if (!input) return;

        input.value = value;

        const combo = input.closest('.combo');

        if (combo) {
            const hidden = combo.querySelector('input.combo-value');

            if (hidden) {
                hidden.value = value;

                hidden.dispatchEvent(
                    new Event('change', { bubbles: true })
                );
            }
        }

        input.dispatchEvent(
            new Event('input', { bubbles: true })
        );

        input.dispatchEvent(
            new Event('change', { bubbles: true })
        );

        // Подсветка: если вкладка в фоне — откладываем до возврата
        if (document.visibilityState === 'visible') {
            flashInput(input);
        } else {
            input._tmPendingHighlight = true;
        }
    }

    // ОБЩАЯ ФУНКЦИЯ ЗАПОЛНЕНИЯ

    function fillDimensions(result, sourceDescription) {
        if (!result) return false;

        const target = getRowInputs(result.targetMode);

        if (target.error || target.inputs.length < 3) {
            console.warn(
                'Не удалось найти поля для вставки:',
                result.targetMode
            );
            return false;
        }

        const [depthInput, widthInput, heightInput] = target.inputs;

        setEasyUIValue(depthInput, result.depth);
        setEasyUIValue(heightInput, result.height);
        setEasyUIValue(widthInput, result.width);

        console.log('📐 Размеры заполнены:', {
            depth: result.depth,
            height: result.height,
            width: result.width,
            sourceUnit: result.unit,
            destination: result.targetMode,
            source: sourceDescription
        });

        return true;
    }

    // ПРИЁМ РАЗМЕРОВ С ДРУГИХ ВКЛАДОК

    function receiveCopiedDimensions(text) {
        const result = parseClientDimensions(text);

        if (!result) {
            console.log(
                '⚠️ Скопированный текст не распознан как размеры:',
                text
            );
            return;
        }

        fillDimensions(result, 'копирование с сайта клиента');
    }

    // КОПИРОВАНИЕ НЕПОСРЕДСТВЕННО В ADMIN

    function handleAdminCopy(event) {
        let text = '';

        const selection = window.getSelection();

        if (selection) {
            text = selection.toString().trim();
        }

        if (!text) {
            const el = event.target || document.activeElement;

            if (
                el &&
                typeof el.selectionStart === 'number' &&
                typeof el.selectionEnd === 'number'
            ) {
                text = el.value.substring(
                    el.selectionStart,
                    el.selectionEnd
                ).trim();
            }
        }

        if (!text) return;

        const result = parseClientDimensions(text);

        if (!result) {
            console.log(
                'ℹ️ Скопированный текст не содержит распознаваемых размеров:',
                text
            );
            return;
        }

        console.log(
            '📋 Размеры скопированы непосредственно в Admin:',
            text
        );

        fillDimensions(result, 'копирование непосредственно в Admin');
    }

    // ОБЫЧНАЯ ВСТАВКА CTRL+V

    function handleClientPaste(event) {
        const input = event.target;

        if (
            !input ||
            input.tagName !== 'INPUT' ||
            !input.classList.contains('combo-text') ||
            input.closest(UI_SELECTOR)
        ) {
            return;
        }

        const clipboard = event.clipboardData;

        if (!clipboard) return;

        const text = clipboard.getData('text/plain');

        if (!text) return;

        const result = parseClientDimensions(text);

        if (!result) return;

        if (fillDimensions(result, 'обычная вставка')) {
            event.preventDefault();
        }
    }

    // AUTO: ЗНАЧЕНИЯ ИЗ ТАБЛИЦЫ ADMIN

    function fillFromTable() {
        const elDepth = document.getElementById('Depth');
        const elWidth = document.getElementById('Width');
        const elHeight = document.getElementById('Height');

        if (!elDepth || !elWidth || !elHeight) {
            alert('Не удалось найти ячейки Depth, Width или Height.');
            return;
        }

        const depth = elDepth.textContent.trim();
        const width = elWidth.textContent.trim();
        const height = elHeight.textContent.trim();

        const numRe = /^\d+([.,]\d+)?$/;

        if (
            !numRe.test(depth) ||
            !numRe.test(width) ||
            !numRe.test(height)
        ) {
            alert(
                `В ячейках не числа:\n` +
                `Depth: ${depth}\n` +
                `Width: ${width}\n` +
                `Height: ${height}`
            );
            return;
        }

        const target = getRowInputs('cm');

        if (target.error) {
            alert(target.error);
            return;
        }

        const [dIn, wIn, hIn] = target.inputs;

        setEasyUIValue(dIn, depth.replace(',', '.'));
        setEasyUIValue(wIn, width.replace(',', '.'));
        setEasyUIValue(hIn, height.replace(',', '.'));
    }

    // ПЕРЕСТАНОВКА РАЗМЕРОВ

    function swapDimensions(
        mode,
        firstIndex,
        secondIndex,
        firstName,
        secondName
    ) {
        const target = getRowInputs(mode);

        if (target.error) {
            alert(target.error);
            return;
        }

        const firstInput = target.inputs[firstIndex];
        const secondInput = target.inputs[secondIndex];

        if (!firstInput || !secondInput) {
            alert('Не удалось найти поля для перестановки размеров.');
            return;
        }

        const firstValue = firstInput.value;
        const secondValue = secondInput.value;

        setEasyUIValue(firstInput, secondValue);
        setEasyUIValue(secondInput, firstValue);

        console.log(
            `✅ Перестановка ${firstName} ↔ ${secondName} в "${mode}" выполнена.`
        );
    }

    // ПОДСВЕТКА ПОЛЕЙ ПРИ НАВЕДЕНИИ НА ПЕРЕСТАНОВКУ

    let highlightedInputs = [];

    function highlightSwapTargets(inputs) {
        clearSwapHighlight();

        inputs.forEach(inp => {
            if (!inp) return;

            inp.dataset.tmSwapPrevBg = inp.style.backgroundColor || '';

            inp.style.backgroundColor = '#d4edda';

            highlightedInputs.push(inp);
        });
    }

    function clearSwapHighlight() {
        highlightedInputs.forEach(inp => {
            if (!inp) return;

            inp.style.backgroundColor = inp.dataset.tmSwapPrevBg || '';

            delete inp.dataset.tmSwapPrevBg;
        });

        highlightedInputs = [];
    }

    // МЕНЮ ПЕРЕСТАНОВКИ

    function closeSwapMenu() {
        clearSwapHighlight();

        if (!swapMenu) return;

        swapMenu.remove();
        swapMenu = null;
    }

    function showSwapMenu(input, mode, activeIndex) {
        closeSwapMenu();

        // Получаем поля строки, чтобы подсвечивать их при наведении
        const target = getRowInputs(mode);

        if (target.error || !target.inputs || target.inputs.length < 3) {
            return;
        }

        const allOptions = [
            {
                label: 'DEPTH ↔ WIDTH',
                first: 0,
                second: 1,
                a: 'DEPTH',
                b: 'WIDTH'
            },
            {
                label: 'WIDTH ↔ HEIGHT',
                first: 1,
                second: 2,
                a: 'WIDTH',
                b: 'HEIGHT'
            },
            {
                label: 'DEPTH ↔ HEIGHT',
                first: 0,
                second: 2,
                a: 'DEPTH',
                b: 'HEIGHT'
            }
        ];

        // Порядок кнопок в зависимости от выбранного поля.
        let options;

        if (activeIndex === 0) {
            options = [allOptions[0], allOptions[2]];
        } else if (activeIndex === 1) {
            options = [allOptions[0], allOptions[1]];
        } else {
            options = [allOptions[1], allOptions[2]];
        }

        const menu = document.createElement('div');
        swapMenu = menu;
        menu.id = 'tm-size-swap-menu';

        menu.style.cssText = `
            position: fixed;
            left: 0;
            top: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 7px;
            background: #ffffff;
            border: 1px solid #d5dce5;
            border-radius: 9px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.20);
            color: #263445;
            font: 12px Arial, sans-serif;
            user-select: none;
            white-space: nowrap;
        `;

        // Метка единиц измерения.
        const unitLabel = document.createElement('div');

        unitLabel.textContent = mode.toUpperCase();

        unitLabel.style.cssText = `
            padding: 5px 7px;
            background: ${mode === 'cm' ? '#fff0df' : '#e9f2ff'};
            color: ${mode === 'cm' ? '#d97800' : '#2876b9'};
            border-radius: 5px;
            font-size: 10px;
            font-weight: bold;
        `;

        menu.appendChild(unitLabel);

        // Кнопки перестановки.
        options.forEach(option => {
            const button = document.createElement('button');

            button.type = 'button';
            button.textContent = option.label;

            button.style.cssText = `
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 9px 12px;
                min-width: 112px;
                background: #f5f8fc;
                border: 1px solid #d5e0ec;
                border-radius: 7px;
                color: #34465a;
                font-size: 11px;
                font-weight: bold;
                cursor: pointer;
                white-space: nowrap;
                transition: background 0.15s, border-color 0.15s;
            `;

            button.addEventListener('mouseenter', () => {
                button.style.background = '#e8f2ff';
                button.style.borderColor = '#83b5e5';

                // Подсветка полей, участвующих в перестановке
                highlightSwapTargets([
                    target.inputs[option.first],
                    target.inputs[option.second]
                ]);
            });

            button.addEventListener('mouseleave', () => {
                button.style.background = '#f5f8fc';
                button.style.borderColor = '#d5e0ec';

                // Снятие подсветки полей
                clearSwapHighlight();
            });

            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();

                closeSwapMenu();

                swapDimensions(
                    mode,
                    option.first,
                    option.second,
                    option.a,
                    option.b
                );
            });

            menu.appendChild(button);
        });

        document.body.appendChild(menu);

        // ИСПРАВЛЕНИЕ ПОЗИЦИОНИРОВАНИЯ
        // Получаем положение непосредственно выбранного поля.

        const inputRect = input.getBoundingClientRect();
        const rect = menu.getBoundingClientRect();

        // 5 мм ≈ 19 пикселей.
        const gap = 19;

        const left = Math.max(
            4,
            Math.min(
                inputRect.left + inputRect.width / 2 - rect.width / 2,
                window.innerWidth - rect.width - 4
            )
        );

        const top = mode === 'cm'
            ? inputRect.top - rect.height - gap
            : inputRect.bottom + gap;

        menu.style.left = `${left}px`;

        menu.style.top = `${
            Math.max(
                4,
                Math.min(
                    top,
                    window.innerHeight - rect.height - 4
                )
            )
        }px`;

        // Закрытие при клике вне меню или Escape.
        setTimeout(() => {
            if (swapMenu !== menu) return;

            const outsideHandler = event => {
                if (!menu.contains(event.target)) {
                    closeSwapMenu();

                    document.removeEventListener(
                        'mousedown',
                        outsideHandler,
                        true
                    );

                    document.removeEventListener(
                        'keydown',
                        escapeHandler,
                        true
                    );
                }
            };

            const escapeHandler = event => {
                if (event.key === 'Escape') {
                    closeSwapMenu();

                    document.removeEventListener(
                        'mousedown',
                        outsideHandler,
                        true
                    );

                    document.removeEventListener(
                        'keydown',
                        escapeHandler,
                        true
                    );
                }
            };

            document.addEventListener(
                'mousedown',
                outsideHandler,
                true
            );

            document.addEventListener(
                'keydown',
                escapeHandler,
                true
            );
        }, 0);
    }

    // ДВОЙНОЙ КЛИК ПО ПОЛЮ РАЗМЕРА

    function handleFieldDoubleClick(event) {
        const input = event.target;

        if (
            !input ||
            input.tagName !== 'INPUT' ||
            !input.classList.contains('combo-text') ||
            input.closest(UI_SELECTOR)
        ) {
            return;
        }

        const mode = detectInputMode(input);

        if (!mode) return;

        const target = getRowInputs(mode);

        if (target.error) return;

        const activeIndex = target.inputs.indexOf(input);

        if (activeIndex < 0 || activeIndex > 2) return;

        event.preventDefault();
        event.stopPropagation();

        // Передаём сам input вместо координат мыши.

        showSwapMenu(
            input,
            mode,
            activeIndex
        );
    }

    // ОТЛОЖЕННАЯ ПОДСВЕТКА ПРИ ВОЗВРАТЕ НА ВКЛАДКУ ADMIN

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;

        document.querySelectorAll('input.combo-text').forEach(input => {
            if (input._tmPendingHighlight) {
                input._tmPendingHighlight = false;
                flashInput(input);
            }
        });
    });

    // СОЗДАНИЕ ПАНЕЛИ

    function createTopPanel() {
        let container = document.getElementById('tm-fill-sizes');

        const buttons = Array.from(
            document.querySelectorAll(
                'button, a, input[type="button"]'
            )
        );

        let targetBtn = buttons.find(el =>
            (el.textContent + ' ' + (el.value || ''))
                .includes('Show/hide products')
        );

        let marginLeft = 155;

        if (!targetBtn) {
            targetBtn = buttons.find(el =>
                (el.textContent + ' ' + (el.value || ''))
                    .trim()
                    .includes('New Editor')
            );

            marginLeft = 489;
        }

        if (!targetBtn) {
            console.log(
                '⚠️ Не найдены кнопки Show/hide products или New Editor.'
            );
            return false;
        }

        if (container) {
            if (targetBtn.nextElementSibling === container) {
                return true;
            }

            container.remove();
        }

        container = document.createElement('div');
        container.id = 'tm-fill-sizes';

        container.style.cssText = `
            display: inline-flex;
            position: relative;
            top: 70px;
            align-items: center;
            margin-left: ${marginLeft}px;
            padding: 0;
            gap: 4px;
            background: transparent;
            border: none;
            border-radius: 0;
            box-shadow: none;
            vertical-align: middle;
            font-family: Arial, sans-serif;
            user-select: none;
            visibility: ${(buttonsHidden || panelSuppressed)
                ? 'hidden'
                : 'visible'};
        `;

        const btnAuto = document.createElement('button');

        btnAuto.id = 'tm-auto-btn';
        btnAuto.type = 'button';
        btnAuto.textContent = 'auto';
        btnAuto.title =
            'Взять готовые размеры из ячеек Depth/Width/Height';

        btnAuto.style.cssText = `
            height: 22px;
            min-width: 38px;
            padding: 0 10px;
            background: #FF8500;
            color: #ffffff;
            border: 1px solid #FF8500;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            line-height: 22px;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            vertical-align: middle;
            box-shadow: none;
            transition: filter 0.2s ease;
        `;

        btnAuto.addEventListener('mouseenter', () => {
            btnAuto.style.filter = 'brightness(1.15)';
        });

        btnAuto.addEventListener('mouseleave', () => {
            btnAuto.style.filter = 'none';
        });

        btnAuto.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            fillFromTable();
        });

        container.appendChild(btnAuto);

        targetBtn.parentNode.insertBefore(
            container,
            targetBtn.nextSibling
        );

        console.log(
            '📌 Панель размеров создана. Перестановка — двойной клик.'
        );

        return true;
    }

})();
