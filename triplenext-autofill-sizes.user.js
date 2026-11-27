
// ==UserScript==
// @name         Triplenext: автозаполнение размеров
// @namespace    http://tampermonkey.net/
// @version      3.85
// @description  Автозаполнение размеров, передача между вкладками, перестановка и деление на 10
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
    const HIGHLIGHT_DURATION_MS = 3000;

    const DEBUG = GM_getValue('tng_debug', false);
    const log = DEBUG ? console.log.bind(console) : () => {};
    const warn = DEBUG ? console.warn.bind(console) : () => {};

    const isAdminPage =
        location.hostname === 'tngadmin.triplenext.net' &&
        location.pathname.startsWith('/Admin/CompareBag/EditBag/');

    const adminTabId = isAdminPage
        ? 'admin_' + Date.now() + '_' + Math.random().toString(36).slice(2)
        : null;

    const STORAGE_KEY = isAdminPage
        ? 'tng_copied_dimensions_' + adminTabId
        : null;

    const UI_SELECTOR = '#tm-fill-sizes, #tm-auto-btn, #tm-div10-btn';

    const MODAL_SELECTORS = [
        '.window-mask',
        '.datagrid-mask',
        '.messager-window',
        '.panel.window',
        '.window'
    ].join(',');

    // ============================================================
    // ИЗВЛЕЧЕНИЕ ЧИСЕЛ
    // ============================================================

    const NUMBER_RE =
        /(?<![\d.,])(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[.,]\d+)(?![\d.,])/g;

    function parseNumber(value) {
        const s = value.trim().replace(',', '.');

        let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);

        if (m) {
            const denominator = Number(m[3]);
            if (!denominator) return NaN;
            return Number(m[1]) + Number(m[2]) / denominator;
        }

        m = s.match(/^(\d+)\s*\/\s*(\d+)$/);

        if (m) {
            const denominator = Number(m[2]);
            if (!denominator) return NaN;
            return Number(m[1]) / denominator;
        }

        return Number(s);
    }

    function formatNumber(value) {
        return parseFloat(value.toFixed(2)).toString();
    }

    function extractNumbers(text) {
        if (!text) return null;

        const matches = [...text.matchAll(NUMBER_RE)];

        if (matches.length < 1 || matches.length > 3) {
            return null;
        }

        const numbers = matches.map(match => ({
            raw: match[0].trim().replace(/\s+/g, ' '),
            value: parseNumber(match[0])
        }));

        if (numbers.some(n =>
            !Number.isFinite(n.value) || n.value < 0
        )) {
            return null;
        }

        return numbers;
    }

// ============================================================
// КЛИЕНТСКИЕ САЙТЫ: ПЕРЕДАЧА В ADMIN
// ============================================================

if (!isAdminPage) {
    let lastSent = { text: '', time: 0 };

    function captureAdminAssociation() {
        const active = GM_getValue(ACTIVE_ADMIN_KEY, null);
        if (!active || !active.id) return;

        sessionStorage.setItem(CLIENT_TARGET_KEY, active.id);
    }

    function sendSelection(text) {
        text = (text || '').trim();
        if (!extractNumbers(text)) return;

        const now = Date.now();

        if (text === lastSent.text && now - lastSent.time < 1500) return;
        lastSent = { text, time: now };

        const active = GM_getValue(ACTIVE_ADMIN_KEY, null);
        const targetId = active?.id ||
            sessionStorage.getItem(CLIENT_TARGET_KEY);

        if (!targetId) return;

        GM_setValue('tng_copied_dimensions_' + targetId, {
            text,
            time: now
        });
    }

    if (document.visibilityState === 'visible') {
        captureAdminAssociation();
        setTimeout(captureAdminAssociation, 150);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            setTimeout(captureAdminAssociation, 100);
        }
    });

    document.addEventListener('mouseup', () => {
        setTimeout(() => {
            sendSelection(window.getSelection()?.toString());
        }, 30);
    }, true);

    document.addEventListener('dblclick', () => {
        setTimeout(() => {
            sendSelection(window.getSelection()?.toString());
        }, 30);
    }, true);

    document.addEventListener('select', e => {
        const el = e.target;

        if (!el || typeof el.selectionStart !== 'number') return;

        const text = el.value.substring(
            el.selectionStart,
            el.selectionEnd
        );

        sendSelection(text);
    }, true);

    return;
}

// ============================================================
// ADMIN: АКТИВНАЯ ВКЛАДКА
// ============================================================

function markThisAdminAsSource() {
    GM_setValue(ACTIVE_ADMIN_KEY, {
        id: adminTabId,
        time: Date.now()
    });

    log('Активная Admin-вкладка:', adminTabId);
}

if (document.visibilityState === 'visible') {
    markThisAdminAsSource();
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        markThisAdminAsSource();
    }
});

// ============================================================
// СОСТОЯНИЕ
// ============================================================

let lastAdminSelection = '';

let buttonsHidden = false;
let panelSuppressed = false;

let swapMenu = null;
let swapCleanup = null;

const rowCache = new Map();
let highlightedInputs = [];

// ============================================================
// ПОИСК ПОЛЕЙ
// Порядок: Depth, Width, Height
// ============================================================

function collectInputs(labelEl) {
    const row = labelEl.closest('tr');

    if (row) {
        return [...row.querySelectorAll('input.combo-text')]
            .filter(input => input.offsetParent !== null);
    }

    let parent = labelEl.parentElement;
    let inputs = [];

    while (parent && inputs.length < 2) {
        inputs = [...parent.querySelectorAll('input.combo-text')]
            .filter(input => input.offsetParent !== null);

        parent = parent.parentElement;
    }

    return inputs;
}

function getRowInputs(mode) {
    const now = Date.now();
    const cached = rowCache.get(mode);

    if (cached && now - cached.time < 300) {
        return cached.value;
    }

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT
    );

    let node;
    let sawLabel = false;
    let result = null;

    while ((node = walker.nextNode())) {
        if (node.nodeValue.length > 100) continue;

        const text = node.nodeValue.trim().toLowerCase();

        if (text !== mode && text !== mode + '.') continue;

        const el = node.parentElement;

        if (!el || el.closest(UI_SELECTOR)) continue;

        sawLabel = true;

        const inputs = collectInputs(el);

        if (inputs.length >= 3) {
            result = { inputs };
            break;
        }
    }

    if (!result) {
        result = {
            error: sawLabel
                ? `В строке "${mode}" меньше трёх полей.`
                : `Не найдена строка "${mode}".`
        };
    }

    rowCache.set(mode, {
        time: now,
        value: result
    });

    return result;
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

// ============================================================
// ПОДСВЕТКА ПОЛЕЙ
// ============================================================

function flashInput(input) {
    input.style.backgroundColor = '#d4edda';

    clearTimeout(input._tmHighlightTimer);

    input._tmHighlightTimer = setTimeout(() => {
        input.style.backgroundColor = '';
        input._tmHighlightTimer = null;
    }, HIGHLIGHT_DURATION_MS);
}

function setEasyUIValue(input, value) {
    if (!input) return;

    value = String(value);
    input.value = value;

    const combo = input.closest('.combo');
    const hidden = combo?.querySelector('input.combo-value');

    if (hidden) {
        hidden.value = value;
        hidden.dispatchEvent(new Event('change', {
            bubbles: true
        }));
    }

    input.dispatchEvent(new Event('input', {
        bubbles: true
    }));

    input.dispatchEvent(new Event('change', {
        bubbles: true
    }));

    // Нули и пустые значения не подсвечиваем
    if (value.trim() === '' || Number(value) === 0) {
        clearTimeout(input._tmHighlightTimer);
        input._tmHighlightTimer = null;
        input.style.backgroundColor = '';
        input._tmPendingHighlight = false;
        return;
    }

    if (document.visibilityState === 'visible') {
        flashInput(input);
    } else {
        input._tmPendingHighlight = true;
    }
}

// ============================================================
// ДРОБИ: ПРЕОБРАЗОВАНИЕ ТОЛЬКО ДЛЯ ДЮЙМОВ
// ============================================================

function getOutputValue(number, mode) {
    if (mode === 'in') {
        return formatNumber(number.value);
    }

    return number.raw;
}

// ============================================================
// ЗАПОЛНЕНИЕ ЧИСЕЛ
// ============================================================

function fillNumbers(numbers, clickedInput, mode, source) {
    if (!numbers || !numbers.length) return false;

    rowCache.clear();

    const target = getRowInputs(mode);

    if (target.error) {
        warn(target.error);
        return false;
    }

    const [depthInput, widthInput, heightInput] = target.inputs;

    const sorted = [...numbers].sort(
        (a, b) => a.value - b.value
    );

    // Одно число: только выбранная ячейка
    if (sorted.length === 1) {
        if (!clickedInput) return false;

        setEasyUIValue(
            clickedInput,
            getOutputValue(sorted[0], mode)
        );
    }

    // Два числа: Height и Width
    // Depth остаётся без изменений
    if (sorted.length === 2) {
        setEasyUIValue(
            heightInput,
            getOutputValue(sorted[0], mode)
        );

        setEasyUIValue(
            widthInput,
            getOutputValue(sorted[1], mode)
        );
    }

    // Три числа: Depth, Height и Width
    if (sorted.length === 3) {
        setEasyUIValue(
            depthInput,
            getOutputValue(sorted[0], mode)
        );

        setEasyUIValue(
            heightInput,
            getOutputValue(sorted[1], mode)
        );

        setEasyUIValue(
            widthInput,
            getOutputValue(sorted[2], mode)
        );
    }

    log('Заполнены размеры:', {
        numbers: sorted.map(n => n.raw),
        mode,
        source
    });

    return true;
}

function fillFromText(text, clickedInput, source) {
    const numbers = extractNumbers(text);

    if (!numbers) {
        log('Не удалось извлечь от 1 до 3 чисел:', text);
        return false;
    }

    const mode = detectInputMode(clickedInput);

    if (!mode) {
        log('Не удалось определить строку размеров.');
        return false;
    }

    return fillNumbers(numbers, clickedInput, mode, source);
}

// ============================================================
// ЗАПОМИНАНИЕ ВЫДЕЛЕНИЯ В ADMIN
// ============================================================

function captureAdminSelection() {
    setTimeout(() => {
        const text = window.getSelection()?.toString().trim();

        if (!text || !extractNumbers(text)) return;

        lastAdminSelection = text;
        log('Запомнено выделение:', text);
    }, 30);
}

function captureInputSelection(event) {
    const el = event.target;

    if (!el || typeof el.selectionStart !== 'number') return;
    if (el.selectionStart === el.selectionEnd) return;

    const text = el.value.substring(
        el.selectionStart,
        el.selectionEnd
    ).trim();

    if (!extractNumbers(text)) return;

    lastAdminSelection = text;
    log('Запомнено выделение в поле:', text);
}

// ============================================================
// КЛИК ПО ЯЧЕЙКЕ = ВСТАВКА
// ============================================================

function handleComboClick(event) {
    const input = event.target;

    if (
        !input ||
        input.tagName !== 'INPUT' ||
        !input.classList.contains('combo-text') ||
        input.closest(UI_SELECTOR)
    ) return;

    if (!lastAdminSelection) return;

    const success = fillFromText(
        lastAdminSelection,
        input,
        'выделение мышкой'
    );

    if (success) {
        lastAdminSelection = '';
    }
}

// ============================================================
// ПРИЁМ ДАННЫХ С КЛИЕНТСКИХ САЙТОВ
// ============================================================

function receiveCopiedDimensions(text) {
    rowCache.clear();

    if (!extractNumbers(text)) {
        log('Полученный текст не распознан:', text);
        return;
    }

    lastAdminSelection = text;
    log('Получены числа с клиентского сайта:', text);
}

// ============================================================
// ОБЫЧНАЯ ВСТАВКА CTRL + V
// ============================================================

function handleClientPaste(event) {
    const input = event.target;

    if (
        !input ||
        input.tagName !== 'INPUT' ||
        !input.classList.contains('combo-text') ||
        input.closest(UI_SELECTOR)
    ) return;

    const text = event.clipboardData?.getData('text/plain');

    if (!text) return;

    const success = fillFromText(
        text,
        input,
        'обычная вставка'
    );

    if (success) {
        event.preventDefault();
        lastAdminSelection = '';
    }
}

// ============================================================
// AUTO: ЗАПОЛНЕНИЕ ИЗ ТАБЛИЦЫ
// ============================================================

function fillFromTable() {
    rowCache.clear();

    const target = getRowInputs('cm');

    if (target.error) {
        alert(target.error);
        return;
    }

    const elements = {
        depth: document.getElementById('Depth'),
        width: document.getElementById('Width'),
        height: document.getElementById('Height')
    };

    if (Object.values(elements).some(el => !el)) {
        alert('Не удалось найти ячейки Depth, Width или Height.');
        return;
    }

    const values = {};

    for (const key of Object.keys(elements)) {
        values[key] = elements[key].textContent.trim();

        if (!/^\d+(?:[.,]\d+)?$/.test(values[key])) {
            alert(`В ячейке ${key} не число: ${values[key]}`);
            return;
        }

        values[key] = values[key].replace(',', '.');
    }

    const [depthInput, widthInput, heightInput] = target.inputs;

    setEasyUIValue(depthInput, values.depth);
    setEasyUIValue(widthInput, values.width);
    setEasyUIValue(heightInput, values.height);
}

// ============================================================
// ДАЛЕЕ ВСТАВИТЬ ЧАСТЬ 2
// ============================================================

// ============================================================
// ÷10: ДВОЙНОЙ КЛИК ПО КНОПКЕ
// ============================================================

function divideCurrentRowBy10() {
    rowCache.clear();

    const target = getRowInputs('cm');

    if (target.error) {
        alert(target.error);
        return;
    }

    const conversions = [];

    target.inputs.forEach(input => {
        const raw = input.value.trim().replace(',', '.');
        const num = Number(raw);

        if (!raw || !Number.isFinite(num) || num === 0) return;

        const divided = formatNumber(num / 10);

        conversions.push(`${raw} → ${divided}`);

        setEasyUIValue(input, divided);
    });

    log('Деление на 10:', conversions);
}

// ============================================================
// ПЕРЕСТАНОВКА РАЗМЕРОВ
// ============================================================

function swapDimensions(mode, first, second) {
    const target = getRowInputs(mode);

    if (target.error) {
        alert(target.error);
        return;
    }

    const a = target.inputs[first];
    const b = target.inputs[second];

    if (!a || !b) return;

    const value = a.value;

    setEasyUIValue(a, b.value);
    setEasyUIValue(b, value);

    log('Перестановка выполнена:', mode, first, second);
}

// ============================================================
// ПОДСВЕТКА ПОЛЕЙ ПРИ ПЕРЕСТАНОВКЕ
// ============================================================

function clearSwapHighlight() {
    highlightedInputs.forEach(input => {
        input.style.backgroundColor =
            input.dataset.tmSwapPrevBg || '';

        delete input.dataset.tmSwapPrevBg;
    });

    highlightedInputs = [];
}

function highlightSwapTargets(inputs) {
    clearSwapHighlight();

    inputs.forEach(input => {
        if (!input) return;

        input.dataset.tmSwapPrevBg =
            input.style.backgroundColor || '';

        input.style.backgroundColor = '#d4edda';

        highlightedInputs.push(input);
    });
}

// ============================================================
// ЗАКРЫТИЕ МЕНЮ
// ============================================================

function closeSwapMenu() {
    clearSwapHighlight();

    if (swapCleanup) {
        swapCleanup();
        swapCleanup = null;
    }

    if (swapMenu) {
        swapMenu.remove();
        swapMenu = null;
    }
}

// ============================================================
// МЕНЮ ПЕРЕСТАНОВКИ
// ============================================================

function showSwapMenu(input, mode, activeIndex) {
    closeSwapMenu();

    const target = getRowInputs(mode);

    if (target.error || target.inputs.length < 3) return;

    const allOptions = [
        { label: 'DEPTH ↔ WIDTH', first: 0, second: 1 },
        { label: 'WIDTH ↔ HEIGHT', first: 1, second: 2 },
        { label: 'DEPTH ↔ HEIGHT', first: 0, second: 2 }
    ];

    const options = activeIndex === 0
        ? [allOptions[0], allOptions[2]]
        : activeIndex === 1
            ? [allOptions[0], allOptions[1]]
            : [allOptions[1], allOptions[2]];

    const menu = document.createElement('div');

    swapMenu = menu;
    menu.id = 'tm-size-swap-menu';

    menu.style.cssText = `
        position:fixed;
        z-index:2147483647;
        display:flex;
        align-items:center;
        gap:7px;
        padding:7px;
        background:#fff;
        border:1px solid #d5dce5;
        border-radius:9px;
        box-shadow:0 4px 16px rgba(0,0,0,.2);
        color:#263445;
        font:12px Arial,sans-serif;
        user-select:none;
        white-space:nowrap;
    `;

    const label = document.createElement('div');

    label.textContent = mode.toUpperCase();

    label.style.cssText = `
        padding:5px 7px;
        background:${mode === 'cm' ? '#fff0df' : '#e9f2ff'};
        color:${mode === 'cm' ? '#d97800' : '#2876b9'};
        border-radius:5px;
        font-size:10px;
        font-weight:bold;
    `;

    menu.appendChild(label);

    options.forEach(option => {
        const button = document.createElement('button');

        button.type = 'button';
        button.textContent = option.label;

        button.style.cssText = `
            padding:9px 12px;
            min-width:112px;
            background:#f5f8fc;
            border:1px solid #d5e0ec;
            border-radius:7px;
            color:#34465a;
            font-size:11px;
            font-weight:bold;
            cursor:pointer;
            white-space:nowrap;
        `;

        button.addEventListener('mouseenter', () => {
            button.style.background = '#e8f2ff';

            highlightSwapTargets([
                target.inputs[option.first],
                target.inputs[option.second]
            ]);
        });

        button.addEventListener('mouseleave', () => {
            button.style.background = '#f5f8fc';
            clearSwapHighlight();
        });

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            closeSwapMenu();

            swapDimensions(
                mode,
                option.first,
                option.second
            );
        });

        menu.appendChild(button);
    });

    document.body.appendChild(menu);

    const inputRect = input.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    const left = Math.max(
        4,
        Math.min(
            inputRect.left + inputRect.width / 2 - menuRect.width / 2,
            window.innerWidth - menuRect.width - 4
        )
    );

    const top = mode === 'cm'
        ? inputRect.top - menuRect.height - 19
        : inputRect.bottom + 19;

    menu.style.left = `${left}px`;

    menu.style.top = `${
        Math.max(
            4,
            Math.min(
                top,
                window.innerHeight - menuRect.height - 4
            )
        )
    }px`;

    const outsideHandler = event => {
        if (!menu.contains(event.target)) {
            closeSwapMenu();
        }
    };

    const escapeHandler = event => {
        if (event.key === 'Escape') {
            closeSwapMenu();
        }
    };

    setTimeout(() => {
        if (swapMenu !== menu) return;

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

        swapCleanup = () => {
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
        };
    }, 0);
}

// ============================================================
// ДВОЙНОЙ КЛИК ПО ЯЧЕЙКЕ = МЕНЮ ПЕРЕСТАНОВКИ
// ============================================================

function handleFieldDoubleClick(event) {
    const input = event.target;

    if (
        !input ||
        input.tagName !== 'INPUT' ||
        !input.classList.contains('combo-text') ||
        input.closest(UI_SELECTOR)
    ) return;

    const mode = detectInputMode(input);

    if (!mode) return;

    const target = getRowInputs(mode);

    if (target.error) return;

    const index = target.inputs.indexOf(input);

    if (index < 0 || index > 2) return;

    event.preventDefault();
    event.stopPropagation();

    showSwapMenu(input, mode, index);
}

// ============================================================
// СОЗДАНИЕ КНОПКИ
// ============================================================

function createButton(id, text, color, title, action) {
    const button = document.createElement('button');

    button.id = id;
    button.type = 'button';
    button.textContent = text;
    button.title = title;

    button.style.cssText = `
        height:22px;
        min-width:38px;
        padding:0 10px;
        background:${color};
        color:#fff;
        border:1px solid ${color};
        border-radius:12px;
        font-size:12px;
        font-weight:bold;
        cursor:pointer;
        line-height:22px;
        box-sizing:border-box;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        transition:filter .2s ease;
    `;

    button.addEventListener('mouseenter', () => {
        button.style.filter = 'brightness(1.15)';
    });

    button.addEventListener('mouseleave', () => {
        button.style.filter = 'none';
    });

    if (action === 'divide') {
    // Одинарный клик
button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();

    divideCurrentRowBy10();
});
} else {
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        fillFromTable();
    });
}

return button;
}
// ============================================================
// СОЗДАНИЕ ПАНЕЛИ
// ============================================================

function createTopPanel() {
    let container = document.getElementById('tm-fill-sizes');

    const buttons = [
        ...document.querySelectorAll(
            'button, a, input[type="button"]'
        )
    ];

    let target = buttons.find(el =>
        (el.textContent + ' ' + (el.value || ''))
            .includes('Show/hide products')
    );

    let marginLeft = 155;

    if (!target) {
        target = buttons.find(el =>
            (el.textContent + ' ' + (el.value || ''))
                .trim().includes('New Editor')
        );

        marginLeft = 489;
    }

    if (!target) {
        log('Не найдена кнопка для размещения панели.');
        return false;
    }

    if (container) {
        if (target.nextElementSibling === container) {
            return true;
        }

        container.remove();
    }

    container = document.createElement('div');

    container.id = 'tm-fill-sizes';

    container.style.cssText = `
        display:inline-flex;
        position:relative;
        top:70px;
        align-items:center;
        margin-left:${marginLeft}px;
        gap:4px;
        vertical-align:middle;
        font-family:Arial,sans-serif;
        user-select:none;
        visibility:${buttonsHidden || panelSuppressed ? 'hidden' : 'visible'};
    `;

    const auto = createButton(
        'tm-auto-btn',
        'auto',
        '#FF8500',
        'Взять размеры из таблицы Depth/Width/Height'
    );

    const div10 = createButton(
        'tm-div10-btn',
        '÷10',
        '#6c757d',
        'Двойной клик: разделить размеры в сантиметрах на 10',
        'divide'
    );

    div10.style.marginLeft = '4px';

    container.append(auto, div10);

    target.parentNode.insertBefore(
        container,
        target.nextSibling
    );

    log('Панель размеров создана.');

    return true;
}

// ============================================================
// ВИДИМОСТЬ ПАНЕЛИ
// ============================================================

function applyVisibility() {
    const hide = buttonsHidden || panelSuppressed;

    document.querySelectorAll(UI_SELECTOR).forEach(el => {
        el.style.visibility = hide ? 'hidden' : 'visible';
    });
}

function isModalOpen() {
    return [...document.querySelectorAll(MODAL_SELECTORS)].some(el => {
        const style = getComputedStyle(el);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            el.offsetParent !== null
        );
    });
}

function syncModalState() {
    const open = isModalOpen();

    if (open === panelSuppressed) return;

    panelSuppressed = open;
    applyVisibility();
}

// ============================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================

function init() {
    let tries = 0;

    function tryCreate() {
        if (createTopPanel() || ++tries > 15) return;

        setTimeout(tryCreate, 1000);
    }

    tryCreate();

    // Следим за модальными окнами
    const observer = new MutationObserver(syncModalState);

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });

    setInterval(syncModalState, 800);

    // Обычная вставка
    document.addEventListener(
        'paste',
        handleClientPaste,
        true
    );

    // Двойной клик по ячейке
    document.addEventListener(
        'dblclick',
        handleFieldDoubleClick,
        true
    );

    // Клик по ячейке = вставка
    document.addEventListener(
        'mousedown',
        handleComboClick,
        true
    );

    // Запоминание выделения мышкой
    document.addEventListener(
        'mouseup',
        captureAdminSelection,
        true
    );

    // Запоминание выделения внутри input
    document.addEventListener(
        'select',
        captureInputSelection,
        true
    );

    // F2 = скрыть или показать панель
    document.addEventListener('keydown', event => {
        if (event.key !== 'F2' || event.repeat) return;

        event.preventDefault();

        buttonsHidden = !buttonsHidden;

        applyVisibility();
    }, true);

    // Подсветка при возвращении на вкладку
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;

        rowCache.clear();

        document.querySelectorAll('input.combo-text').forEach(input => {
            if (!input._tmPendingHighlight) return;

            input._tmPendingHighlight = false;
            flashInput(input);
        });
    });

    // Получение чисел с клиентских вкладок
    if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(
            STORAGE_KEY,
            (name, oldValue, newValue) => {
                if (!newValue?.text) return;

                receiveCopiedDimensions(newValue.text);
            }
        );
    }
}

// ============================================================
// ЗАПУСК
// ============================================================

setTimeout(init, 2000);

})();
