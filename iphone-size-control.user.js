// ==UserScript==
// @name         айфоны Bonaventura
// @namespace    http://tampermonkey.net/
// @version      2.6.0
// @description  Автозаполнение и визуальный контроль размеров iPhone (округление до 2 знаков)
// @match        https://tngadmin.triplenext.net/Admin/CompareBag/EditBag/*
// @match        https://yruleradmin.triplenext.net/Admin/CompareBag/EditBag/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/aleksandrrybak1969-a11y/-my-userscripts/main/iphone-size-control.user.js
// @downloadURL  https://raw.githubusercontent.com/aleksandrrybak1969-a11y/-my-userscripts/main/iphone-size-control.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================================
    // СПРАВОЧНИК: H / W / D в см
    // =====================================================================

    const IPHONE_SIZES = {
        'iphone 18 pro max':   { h: 16.34, w: 7.8,   d: 0.9    },
        'iphone 18 pro':       { h: 15,    w: 7.19,  d: 0.875  },
        'iphone 17 pro max':   { h: 16.34, w: 7.8,   d: 0.875  },
        'iphone 17 pro':       { h: 15,    w: 7.19,  d: 0.875  },
        'iphone 17 air':       { h: 15.62, w: 7.47,  d: 0.564  },
        'iphone 17':           { h: 14.96, w: 7.15,  d: 0.795  },
        'iphone 16 pro max':   { h: 16.3,  w: 7.76,  d: 0.825  },
        'iphone 16 pro':       { h: 14.96, w: 7.15,  d: 0.825  },
        'iphone 16 plus':      { h: 16.09, w: 7.78,  d: 0.78   },
        'iphone 16e':          { h: 14.67, w: 7.15,  d: 0.78   },
        'iphone 16':           { h: 14.76, w: 7.16,  d: 0.78   },
        'iphone 15 pro max':   { h: 15.99, w: 7.67,  d: 0.825  },
        'iphone 15 pro':       { h: 14.66, w: 7.06,  d: 0.825  },
        'iphone 15 plus':      { h: 16.09, w: 7.78,  d: 0.78   },
        'iphone 15':           { h: 14.76, w: 7.16,  d: 0.78   },
        'iphone 14 pro max':   { h: 16.07, w: 7.76,  d: 0.785  },
        'iphone 14 plus':      { h: 16.08, w: 7.81,  d: 0.78   },
        'iphone 14 pro':       { h: 14.75, w: 7.15,  d: 0.785  },
        'iphone 14':           { h: 14.67, w: 7.15,  d: 0.78   },
        'iphone 13 pro max':   { h: 16.08, w: 7.81,  d: 0.765  },
        'iphone 13 pro':       { h: 14.67, w: 7.15,  d: 0.765  },
        'iphone 13':           { h: 14.67, w: 7.15,  d: 0.765  },
        'iphone 13 mini':      { h: 13.15, w: 6.42,  d: 0.765  },
        'iphone 12 pro max':   { h: 16.08, w: 7.81,  d: 0.74   },
        'iphone 12 12 pro':    { h: 14.67, w: 7.15,  d: 0.74   },
        'iphone 12 mini':      { h: 13.15, w: 6.42,  d: 0.74   },
        'iphone 11 pro max':   { h: 15.8,  w: 7.78,  d: 0.81   },
        'iphone 11 pro':       { h: 14.4,  w: 7.14,  d: 0.81   },
        'iphone 11':           { h: 15.09, w: 7.57,  d: 0.83   },
        'iphone x xs':         { h: 14.36, w: 7.09,  d: 0.77   },
        'iphone se 8 7 6s 6':  { h: 13.84, w: 6.73,  d: 0.73   }
    };

    // =====================================================================
    // НАСТРОЙКИ
    // =====================================================================

    const GREEN_DURATION = 5000;
    const CHECK_DELAY = 300;
    const VALUE_TOLERANCE = 0.0001;

    let isFilling = false;
    let currentCategory = null;
    let inputTimer = null;
    let categoryTimer = null;

    const greenTimers = new WeakMap();

    // =====================================================================
    // ОКРУГЛЕНИЕ ДО 2 ЗНАКОВ
    // =====================================================================

    function round2(value) {
        return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    }

    function formatValue(value) {
        return String(round2(value));
    }

    // =====================================================================
    // ЦВЕТОВАЯ ПОДСВЕТКА
    // =====================================================================

    const style = document.createElement('style');

    style.textContent = `
        input.iphone-size-invalid {
            background-color: #ffe0e0 !important;
            border: 2px solid #dc3545 !important;
            box-shadow: 0 0 4px rgba(220, 53, 69, 0.6) !important;
        }

        input.iphone-size-valid {
            background-color: #d4edda !important;
            border: 2px solid #28a745 !important;
            box-shadow: 0 0 4px rgba(40, 167, 69, 0.5) !important;
        }
    `;

    document.head.appendChild(style);

    function clearGreenTimer(input) {
        const timer = greenTimers.get(input);

        if (timer) {
            clearTimeout(timer);
            greenTimers.delete(input);
        }
    }

    function showGreen(input) {
        if (!input) return;

        clearGreenTimer(input);

        input.classList.remove('iphone-size-invalid');
        input.classList.add('iphone-size-valid');

        const timer = setTimeout(() => {
            input.classList.remove('iphone-size-valid');
            greenTimers.delete(input);
        }, GREEN_DURATION);

        greenTimers.set(input, timer);
    }

    function showRed(input) {
        if (!input) return;

        clearGreenTimer(input);

        input.classList.remove('iphone-size-valid');
        input.classList.add('iphone-size-invalid');
    }

    function clearHighlight(input) {
        if (!input) return;

        clearGreenTimer(input);

        input.classList.remove(
            'iphone-size-invalid',
            'iphone-size-valid'
        );
    }

    // =====================================================================
    // ЧТЕНИЕ ВЫБРАННОЙ МОДЕЛИ
    // =====================================================================

    function getSelectedName() {
        const el = document.querySelector(
            '#CategoryId_chosen > a.chosen-single > span'
        );

        return el ? el.textContent.trim() : null;
    }

    function normalizeName(name) {
        return String(name)
            .toLowerCase()
            .replace(/[\/\\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // =====================================================================
    // ПОИСК ТОЛЬКО ТРЁХ ПОЛЕЙ
    // DEPTH / WIDTH / HEIGHT
    // =====================================================================

    function collectInputs(labelEl) {
        const visible = list =>
            Array.from(list).filter(
                input => input.offsetParent !== null
            );

        const row = labelEl.closest('tr');

        if (row) {
            return visible(
                row.querySelectorAll('input.combo-text')
            );
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

            if (!el) continue;

            sawLabel = true;

            const inputs = collectInputs(el);

            if (inputs.length >= 3) {
                return {
                    inputs: inputs.slice(0, 3)
                };
            }
        }

        return {
            error: sawLabel
                ? `В строке "${mode}" меньше трёх полей.`
                : `Не найдена метка "${mode}".`
        };
    }

    // =====================================================================
    // ЧИСЛОВЫЕ ЗНАЧЕНИЯ
    // =====================================================================

    function getNumericValue(input) {
        if (!input) return NaN;

        const value = input.value
            .trim()
            .replace(',', '.')
            .replace(/\s/g, '');

        if (value === '') return NaN;

        return Number(value);
    }

    function isZero(input) {
        const value = getNumericValue(input);

        return Number.isFinite(value) &&
            Math.abs(round2(value)) <= VALUE_TOLERANCE;
    }

    function isCorrect(input, expected) {
        const actual = getNumericValue(input);

        return Number.isFinite(actual) &&
            Math.abs(round2(actual) - round2(expected)) <= VALUE_TOLERANCE;
    }

    // =====================================================================
    // УСТАНОВКА ЗНАЧЕНИЙ EASYUI
    // =====================================================================

    function setEasyUIValue(input, value) {
        if (!input) return;

        const formatted = formatValue(value);

        input.value = formatted;

        const combo = input.closest('.combo');

        if (combo) {
            const hidden = combo.querySelector(
                'input.combo-value'
            );

            if (hidden) {
                hidden.value = formatted;
            }
        }

        input.dispatchEvent(
            new Event('input', { bubbles: true })
        );

        input.dispatchEvent(
            new Event('change', { bubbles: true })
        );
    }

    // =====================================================================
    // АВТОЗАПОЛНЕНИЕ НУЛЕЙ ПРИ ЗАГРУЗКЕ
    // =====================================================================

    function fillZeroFields(inputs, size) {
        const expected = [
            size.d,
            size.w,
            size.h
        ];

        isFilling = true;

        try {
            inputs.forEach((input, index) => {
                if (
                    input &&
                    typeof expected[index] === 'number' &&
                    isZero(input)
                ) {
                    setEasyUIValue(
                        input,
                        expected[index]
                    );
                }
            });
        } finally {
            isFilling = false;
        }
    }

    // =====================================================================
    // ПОЛНАЯ ЗАМЕНА РАЗМЕРОВ ПРИ СМЕНЕ КАТЕГОРИИ
    // =====================================================================

    function replaceAllSizes(inputs, size) {
        const expected = [
            size.d,
            size.w,
            size.h
        ];

        isFilling = true;

        try {
            inputs.forEach((input, index) => {
                if (
                    input &&
                    typeof expected[index] === 'number'
                ) {
                    setEasyUIValue(
                        input,
                        expected[index]
                    );
                }
            });
        } finally {
            isFilling = false;
        }
    }

    // =====================================================================
    // ПРОВЕРКА И ПОДСВЕТКА
    // =====================================================================

    function validateSizes(inputs, size, greenAll = false, changedInput = null) {
        const expected = [
            size.d,
            size.w,
            size.h
        ];

        let hasErrors = false;

        inputs.forEach((input, index) => {
            const correct = isCorrect(
                input,
                expected[index]
            );

            if (!correct) {
                showRed(input);
                hasErrors = true;
                return;
            }

            const wasRed = input.classList.contains(
                'iphone-size-invalid'
            );

            input.classList.remove('iphone-size-invalid');

            if (
                greenAll ||
                wasRed ||
                input === changedInput
            ) {
                showGreen(input);
            }
        });

        return !hasErrors;
    }

    // =====================================================================
    // ПОЛУЧЕНИЕ ТЕКУЩЕЙ МОДЕЛИ И ПОЛЕЙ
    // =====================================================================

    function getCurrentData() {
        const name = getSelectedName();

        if (!name) return null;

        const key = normalizeName(name);
        const size = IPHONE_SIZES[key];

        if (!size) return null;

        const target = getRowInputs('cm');

        if (target.error) {
            console.warn('⚠️', target.error);
            return null;
        }

        if (target.inputs.length !== 3) {
            return null;
        }

        return {
            name,
            key,
            size,
            inputs: target.inputs
        };
    }

    // =====================================================================
    // ОСНОВНАЯ ПРОВЕРКА
    // =====================================================================

    function processSizes(mode = 'check', changedInput = null) {
        const data = getCurrentData();

        if (!data) return;

        const {
            name,
            key,
            size,
            inputs
        } = data;

        if (mode === 'fill-zero') {
            fillZeroFields(inputs, size);
        }

        if (mode === 'replace-all') {
            replaceAllSizes(inputs, size);
        }

        const greenAll =
            mode === 'fill-zero' ||
            mode === 'replace-all';

        const correct = validateSizes(
            inputs,
            size,
            greenAll,
            changedInput
        );

        currentCategory = key;

        console.log(
            correct
                ? `✅ "${name}" — размеры правильные.`
                : `❌ "${name}" — есть неправильные размеры.`
        );
    }

    // =====================================================================
    // ПРОВЕРКА РУЧНОГО ИЗМЕНЕНИЯ ПОЛЕЙ
    // =====================================================================

    function isManagedInput(input) {
        if (!input || !input.matches('input.combo-text')) {
            return false;
        }

        const data = getCurrentData();

        return !!data && data.inputs.includes(input);
    }

    document.addEventListener('input', event => {
        if (isFilling) return;

        const input = event.target;

        if (!isManagedInput(input)) return;

        clearTimeout(inputTimer);

        inputTimer = setTimeout(() => {
            processSizes('check', input);
        }, CHECK_DELAY);

    }, true);

    document.addEventListener('change', event => {
        if (isFilling) return;

        const input = event.target;

        if (!isManagedInput(input)) return;

        clearTimeout(inputTimer);
        processSizes('check', input);

    }, true);

    // =====================================================================
    // ВЫБОР КАТЕГОРИИ
    // =====================================================================

    function getCategoryKeyFromListItem(li) {
        if (!li) return null;

        const key = normalizeName(li.textContent || '');
        return IPHONE_SIZES[key] ? key : null;
    }

    function forceApplySelectedCategory(expectedKey = null) {
        clearTimeout(categoryTimer);

        let attempts = 0;

        function tryApply() {
            const data = getCurrentData();

            if (data && (!expectedKey || data.key === expectedKey)) {
                clearTimeout(inputTimer);
                processSizes('replace-all');
                console.log(`🔄 Размеры принудительно обновлены для "${data.name}".`);
                return;
            }

            attempts++;
            if (attempts < 20) {
                categoryTimer = setTimeout(tryApply, 200);
            } else {
                console.warn('⚠️ Не удалось дождаться обновления выбранной категории.');
            }
        }

        categoryTimer = setTimeout(tryApply, 250);
    }

    function bindCategoryWatcher() {
        const select = document.getElementById('CategoryId');

        if (!select || select.dataset.iphoneWatcher) {
            return false;
        }

        select.dataset.iphoneWatcher = 'true';
        select.addEventListener('change', () => forceApplySelectedCategory());

        if (window.jQuery) {
            window.jQuery(select).on(
                'chosen:updated.iphoneSizeControl',
                () => forceApplySelectedCategory()
            );
        }

        console.log('📌 Контроль выбора категории активирован.');
        return true;
    }

    document.addEventListener('click', event => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const li = target.closest('#CategoryId_chosen .chosen-results li');
        if (!li || li.classList.contains('disabled-result')) return;

        const expectedKey = getCategoryKeyFromListItem(li);
        forceApplySelectedCategory(expectedKey);
    }, true);

    function bindChosenTextWatcher() {
        const selected = document.querySelector(
            '#CategoryId_chosen > a.chosen-single > span'
        );

        if (!selected || selected.dataset.iphoneTextWatcher) return;

        selected.dataset.iphoneTextWatcher = 'true';

        const observer = new MutationObserver(() => {
            forceApplySelectedCategory();
        });

        observer.observe(selected, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    // =====================================================================
    // ПЕРВОНАЧАЛЬНАЯ ЗАГРУЗКА СТРАНИЦЫ
    // =====================================================================

    let tries = 0;

    function initialize() {
        bindCategoryWatcher();
        bindChosenTextWatcher();

        const data = getCurrentData();

        if (data) {
            processSizes('fill-zero');

            console.log(
                '🚀 Проверка размеров завершена.'
            );

            return;
        }

        if (++tries < 40) {
            setTimeout(initialize, 500);
        } else {
            console.warn(
                '⚠️ Не удалось найти категорию или CM-поля.'
            );
        }
    }

    initialize();

    console.log(
        '📱 iPhone Size Control v2.6.0 запущен.'
    );

})();
