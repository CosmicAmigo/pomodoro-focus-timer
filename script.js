"use strict";

const MODES = {
    work: { label: "Focus" },
    short: { label: "Short Break" },
    long: { label: "Long Break" }
};

const DEFAULT_SETTINGS = {
    work: 25,
    short: 5,
    long: 15,
    sound: true,
    notify: false,
    sessionsBeforeLong: 4
};

const CIRCUMFERENCE = 2 * Math.PI * 90;
const TICK_MS = 250;

const state = {
    mode: "work",
    settings: Object.assign({}, DEFAULT_SETTINGS),
    remainingMs: DEFAULT_SETTINGS.work * 60 * 1000,
    endsAt: null,
    running: false,
    sessionsCompleted: 0,
    totalFocusMs: 0,
    workSessionsInRow: 0,
    tasks: [],
    lastTickAt: 0,
    ticker: null
};

const els = {
    time: document.getElementById("time"),
    modeLabel: document.getElementById("mode-label"),
    progress: document.querySelector(".timer-progress"),
    startPause: document.getElementById("start-pause"),
    reset: document.getElementById("reset"),
    skip: document.getElementById("skip"),
    sessionCount: document.getElementById("session-count"),
    totalFocus: document.getElementById("total-focus"),
    soundToggle: document.getElementById("sound-toggle"),
    notifyToggle: document.getElementById("notify-toggle"),
    themeToggle: document.getElementById("theme-toggle"),
    taskForm: document.getElementById("task-form"),
    taskInput: document.getElementById("task-input"),
    taskList: document.getElementById("task-list"),
    tasksProgress: document.getElementById("tasks-progress"),
    tabs: document.querySelectorAll(".mode-tab"),
    inputs: {
        work: document.getElementById("work-duration"),
        short: document.getElementById("short-duration"),
        long: document.getElementById("long-duration")
    }
};

const STORAGE_KEY = "pomodoro-focus-timer/v1";
const THEME_KEY = "pomodoro-focus-timer/theme";
const THEME_QUERY = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let saveHandle = null;

function loadTheme() {
    let theme = null;

    try {
        theme = localStorage.getItem(THEME_KEY);
    } catch (error) {
        console.warn("Could not read theme:", error);
    }

    if (theme !== "light" && theme !== "dark") {
        theme = THEME_QUERY && THEME_QUERY.matches ? "dark" : "light";
    }

    applyTheme(theme);
}

function applyTheme(theme) {
    const isLight = theme === "light";
    document.body.classList.toggle("theme-light", isLight);
    if (els.themeToggle) {
        els.themeToggle.textContent = isLight ? "Dark" : "Light";
        els.themeToggle.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
    }
}

function toggleTheme() {
    const isLight = document.body.classList.contains("theme-light");
    const next = isLight ? "dark" : "light";
    applyTheme(next);
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch (error) {
        console.warn("Could not save theme:", error);
    }
}

function saveState() {
    if (saveHandle !== null) {
        clearTimeout(saveHandle);
        saveHandle = null;
    }

    try {
        const payload = {
            settings: state.settings,
            stats: {
                sessionsCompleted: state.sessionsCompleted,
                totalFocusMs: state.totalFocusMs,
                workSessionsInRow: state.workSessionsInRow
            },
            tasks: state.tasks,
            timer: {
                mode: state.mode,
                remainingMs: state.remainingMs,
                endsAt: state.running ? state.endsAt : null
            }
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn("Could not save state:", error);
    }
}

function queueSave() {
    if (saveHandle !== null) return;
    saveHandle = setTimeout(saveState, 2000);
}

function loadState() {
    let saved = null;

    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (error) {
        console.warn("Could not read saved state:", error);
    }

    if (!saved || typeof saved !== "object") return;

    if (saved.settings) {
        state.settings.work = clampMinutes(saved.settings.work, 1, 120, DEFAULT_SETTINGS.work);
        state.settings.short = clampMinutes(saved.settings.short, 1, 60, DEFAULT_SETTINGS.short);
        state.settings.long = clampMinutes(saved.settings.long, 1, 60, DEFAULT_SETTINGS.long);
        state.settings.sound = saved.settings.sound !== false;
        state.settings.notify = saved.settings.notify === true;
    }

    if (saved.stats) {
        state.sessionsCompleted = positiveInt(saved.stats.sessionsCompleted);
        state.totalFocusMs = positiveInt(saved.stats.totalFocusMs);
        state.workSessionsInRow = positiveInt(saved.stats.workSessionsInRow);
    }

    if (Array.isArray(saved.tasks)) {
        state.tasks = saved.tasks
            .filter(function (task) {
                return task && typeof task.text === "string" && task.text.trim();
            })
            .slice(0, 50)
            .map(function (task) {
                return {
                    id: typeof task.id === "string" && task.id ? task.id : makeId(),
                    text: task.text.trim().slice(0, 120),
                    done: task.done === true
                };
            });
    }

    if (saved.timer && MODES[saved.timer.mode]) {
        state.mode = saved.timer.mode;
        const total = modeDurationMs(state.mode);
        const savedRemaining = positiveInt(saved.timer.remainingMs);

        if (saved.timer.endsAt && Number(saved.timer.endsAt) > Date.now()) {
            state.endsAt = Number(saved.timer.endsAt);
            state.remainingMs = Math.min(total, state.endsAt - Date.now());
            state.running = true;
        } else {
            state.remainingMs = Math.min(total, savedRemaining || total);
            state.running = false;
            state.endsAt = null;
        }
    }
}

function positiveInt(value) {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function modeDurationMs(mode) {
    return state.settings[mode] * 60 * 1000;
}

function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return hours > 0 ? hours + ":" + mm + ":" + ss : mm + ":" + ss;
}

function formatTotal(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? hours + "h " + (minutes % 60) + "m" : minutes + "m";
}

function makeId() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function addTask(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    state.tasks.push({ id: makeId(), text: trimmed.slice(0, 120), done: false });
    renderTasks();
}

function toggleTask(id) {
    const task = state.tasks.find(function (item) {
        return item.id === id;
    });
    if (!task) return;
    task.done = !task.done;
    renderTasks();
}

function removeTask(id) {
    state.tasks = state.tasks.filter(function (item) {
        return item.id !== id;
    });
    renderTasks();
}

function renderTasks() {
    els.taskList.textContent = "";

    state.tasks.forEach(function (task) {
        const item = document.createElement("li");
        item.className = "task-item" + (task.done ? " done" : "");
        item.dataset.id = task.id;

        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "task-check";
        check.checked = task.done;
        check.setAttribute("aria-label", "Mark done: " + task.text);

        const label = document.createElement("span");
        label.className = "task-text";
        label.textContent = task.text;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "task-remove";
        remove.textContent = "\u00d7";
        remove.setAttribute("aria-label", "Remove task: " + task.text);

        item.appendChild(check);
        item.appendChild(label);
        item.appendChild(remove);
        els.taskList.appendChild(item);
    });

    const total = state.tasks.length;
    const done = state.tasks.filter(function (task) {
        return task.done;
    }).length;

    els.tasksProgress.textContent = total === 0 ? "0 of 0 done" : done + " of " + total + " done";
    queueSave();
}

function render() {
    els.time.textContent = formatClock(state.remainingMs);
    els.modeLabel.textContent = MODES[state.mode].label;
    els.startPause.textContent = state.running ? "Pause" : "Start";

    const total = modeDurationMs(state.mode);
    const elapsed = total - state.remainingMs;
    const ratio = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0;
    els.progress.style.strokeDashoffset = (ratio * CIRCUMFERENCE).toFixed(2);

    els.sessionCount.textContent = String(state.sessionsCompleted);
    els.totalFocus.textContent = formatTotal(state.totalFocusMs);

    document.title = state.running
        ? formatClock(state.remainingMs) + " · " + MODES[state.mode].label
        : "Pomodoro Focus Timer";

    document.body.classList.remove("mode-work", "mode-short", "mode-long");
    document.body.classList.add("mode-" + state.mode);

    els.tabs.forEach(function (tab) {
        tab.classList.toggle("active", tab.dataset.mode === state.mode);
    });

    queueSave();
}

function stopTicker() {
    if (state.ticker !== null) {
        clearInterval(state.ticker);
        state.ticker = null;
    }
}

function startTicker() {
    stopTicker();
    state.lastTickAt = Date.now();
    state.ticker = setInterval(tick, TICK_MS);
}

function tick() {
    if (!state.running) return;

    const now = Date.now();
    if (state.mode === "work") {
        state.totalFocusMs += Math.max(0, now - state.lastTickAt);
    }
    state.lastTickAt = now;
    state.remainingMs = Math.max(0, state.endsAt - now);

    if (state.remainingMs <= 0) {
        completeSession();
        return;
    }

    render();
}

function startTimer() {
    if (state.running) return;
    if (state.remainingMs <= 0) state.remainingMs = modeDurationMs(state.mode);

    state.endsAt = Date.now() + state.remainingMs;
    state.running = true;
    startTicker();
    render();
}

function pauseTimer() {
    if (!state.running) return;

    const now = Date.now();
    if (state.mode === "work") {
        state.totalFocusMs += Math.max(0, now - state.lastTickAt);
    }
    state.remainingMs = Math.max(0, state.endsAt - now);
    state.endsAt = null;
    state.running = false;
    stopTicker();
    render();
}

function toggleTimer() {
    if (state.running) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function resetTimer() {
    stopTicker();
    state.running = false;
    state.endsAt = null;
    state.remainingMs = modeDurationMs(state.mode);
    render();
}

function setMode(mode) {
    if (!MODES[mode]) return;
    stopTicker();
    state.mode = mode;
    state.running = false;
    state.endsAt = null;
    state.remainingMs = modeDurationMs(mode);
    render();
}

function nextMode() {
    if (state.mode === "work") {
        return state.workSessionsInRow > 0 && state.workSessionsInRow % state.settings.sessionsBeforeLong === 0
            ? "long"
            : "short";
    }
    return "work";
}

function completeSession() {
    stopTicker();
    state.running = false;
    state.endsAt = null;
    state.remainingMs = 0;

    const wasWork = state.mode === "work";

    if (wasWork) {
        state.sessionsCompleted += 1;
        state.workSessionsInRow += 1;
    }

    playChime();
    notifySessionEnd(wasWork);
    render();

    const upcoming = nextMode();
    window.setTimeout(function () {
        setMode(upcoming);
    }, 800);
}

function skipSession() {
    if (state.mode === "work") {
        const elapsed = Math.max(0, modeDurationMs(state.mode) - state.remainingMs);
        state.totalFocusMs += elapsed;
    }
    stopTicker();
    state.running = false;
    state.endsAt = null;
    state.remainingMs = 0;
    completeSession();
}

function playChime() {
    if (!els.soundToggle.checked) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;

    try {
        const ctx = new AudioCtor();
        const now = ctx.currentTime;
        [660, 880].forEach(function (frequency, index) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, now + index * 0.18);
            gain.gain.exponentialRampToValueAtTime(0.25, now + index * 0.18 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.9);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + index * 0.18);
            osc.stop(now + index * 0.18 + 1);
        });
        window.setTimeout(function () {
            if (typeof ctx.close === "function") ctx.close();
        }, 1600);
    } catch (error) {
        console.warn("Audio unavailable:", error);
    }
}

function notifySessionEnd(wasWork) {
    if (!state.settings.notify) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    const title = wasWork ? "Focus session complete" : "Break is over";
    const body = wasWork
        ? "Nice work. Take a " + state.settings.short + " minute break."
        : "Back to it: " + state.settings.work + " minutes of focus.";

    try {
        new Notification(title, { body: body, tag: "pomodoro-focus-timer", silent: true });
    } catch (error) {
        console.warn("Could not show notification:", error);
    }
}

function applySettings() {
    const next = {
        work: clampMinutes(els.inputs.work.value, 1, 120, DEFAULT_SETTINGS.work),
        short: clampMinutes(els.inputs.short.value, 1, 60, DEFAULT_SETTINGS.short),
        long: clampMinutes(els.inputs.long.value, 1, 60, DEFAULT_SETTINGS.long)
    };

    const wasRunning = state.running;
    state.settings.work = next.work;
    state.settings.short = next.short;
    state.settings.long = next.long;

    if (!wasRunning) {
        state.remainingMs = modeDurationMs(state.mode);
    }
    render();
}

function clampMinutes(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

els.startPause.addEventListener("click", toggleTimer);
els.reset.addEventListener("click", resetTimer);
els.skip.addEventListener("click", skipSession);

els.tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
        setMode(tab.dataset.mode);
    });
});

Object.keys(els.inputs).forEach(function (mode) {
    els.inputs[mode].addEventListener("change", applySettings);
});

els.soundToggle.addEventListener("change", function () {
    state.settings.sound = els.soundToggle.checked;
    queueSave();
});

els.notifyToggle.addEventListener("change", function () {
    if (typeof Notification === "undefined") {
        els.notifyToggle.checked = false;
        return;
    }

    if (!els.notifyToggle.checked) {
        state.settings.notify = false;
        queueSave();
        return;
    }

    Notification.requestPermission().then(function (permission) {
        state.settings.notify = permission === "granted";
        els.notifyToggle.checked = state.settings.notify;
        queueSave();
    }).catch(function () {
        state.settings.notify = false;
        els.notifyToggle.checked = false;
        queueSave();
    });
});

els.taskForm.addEventListener("submit", function (event) {
    event.preventDefault();
    addTask(els.taskInput.value);
    els.taskInput.value = "";
});

els.taskList.addEventListener("click", function (event) {
    const item = event.target.closest(".task-item");
    if (!item) return;

    if (event.target.classList.contains("task-check")) {
        toggleTask(item.dataset.id);
    } else if (event.target.classList.contains("task-remove")) {
        removeTask(item.dataset.id);
    }
});

if (els.themeToggle) {
    els.themeToggle.addEventListener("click", toggleTheme);
}

loadTheme();

document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
        saveState();
        return;
    }
    if (state.running) {
        tick();
    }
});

window.addEventListener("beforeunload", saveState);

document.addEventListener("keydown", function (event) {
    if (event.target instanceof HTMLInputElement) return;

    if (event.code === "Space") {
        event.preventDefault();
        toggleTimer();
    } else if (event.key === "r" || event.key === "R") {
        resetTimer();
    } else if (event.key === "s" || event.key === "S") {
        skipSession();
    }
});

loadState();

els.inputs.work.value = String(state.settings.work);
els.inputs.short.value = String(state.settings.short);
els.inputs.long.value = String(state.settings.long);
els.soundToggle.checked = state.settings.sound;
els.notifyToggle.checked = state.settings.notify
    && typeof Notification !== "undefined"
    && Notification.permission === "granted";

if (state.running) {
    startTicker();
}

render();
renderTasks();
