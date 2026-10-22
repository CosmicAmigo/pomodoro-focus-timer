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
    ambient: false,
    autoStart: false,
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
    history: [],
    days: {},
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
    ambientToggle: document.getElementById("ambient-toggle"),
    autostartToggle: document.getElementById("autostart-toggle"),
    themeToggle: document.getElementById("theme-toggle"),
    taskForm: document.getElementById("task-form"),
    taskInput: document.getElementById("task-input"),
    taskList: document.getElementById("task-list"),
    tasksProgress: document.getElementById("tasks-progress"),
    historyList: document.getElementById("history-list"),
    historyClear: document.getElementById("history-clear"),
    weekBars: document.getElementById("week-bars"),
    weekTotal: document.getElementById("week-total"),
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
els.historyClear.addEventListener("click", function () {
    state.history = [];
    renderHistory();
    queueSave();
});

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
            history: state.history.slice(0, 20),
            days: state.days,
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
        state.settings.ambient = saved.settings.ambient === true;
        state.settings.autoStart = saved.settings.autoStart === true;
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

    if (Array.isArray(saved.history)) {
        state.history = saved.history
            .filter(function (entry) {
                return entry && Number.isFinite(Number(entry.at)) && Number(entry.minutes) > 0;
            })
            .slice(0, 20)
            .map(function (entry) {
                return { at: Number(entry.at), minutes: Math.round(Number(entry.minutes)) };
            });
    }

    if (saved.days && typeof saved.days === "object") {
        Object.keys(saved.days).forEach(function (key) {
            const minutes = Number(saved.days[key]);
            if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(minutes) && minutes > 0) {
                state.days[key] = Math.round(minutes);
            }
        });
        pruneDays();
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

function formatWhen(timestamp) {
    const when = new Date(timestamp);
    const today = new Date();
    const time = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    if (when.toDateString() === today.toDateString()) {
        return time;
    }

    return when.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time;
}

function dayKey(timestamp) {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
}

function pruneDays() {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 29);
    const minKey = dayKey(cutoff.getTime());

    Object.keys(state.days).forEach(function (key) {
        if (key < minKey) delete state.days[key];
    });
}

function recordSession(focusedMinutes) {
    if (state.mode !== "work") return;
    const minutes = Math.round(Number(focusedMinutes) || 0);
    if (minutes < 1) return;
    state.history.unshift({ at: Date.now(), minutes: minutes });
    state.history = state.history.slice(0, 20);
    const key = dayKey(Date.now());
    state.days[key] = (Number(state.days[key]) || 0) + minutes;
    pruneDays();
}

function renderDays() {
    els.weekBars.textContent = "";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
        const date = new Date(today.getTime());
        date.setDate(today.getDate() - offset);
        const key = dayKey(date.getTime());
        days.push({
            date: date,
            minutes: Math.max(0, Math.round(Number(state.days[key]) || 0)),
            isToday: offset === 0
        });
    }

    const max = Math.max(25, days.reduce(function (top, day) {
        return Math.max(top, day.minutes);
    }, 0));
    let total = 0;

    days.forEach(function (day) {
        total += day.minutes;

        const col = document.createElement("div");
        col.className = "week-col";
        col.title = day.date.toLocaleDateString([], { weekday: "long" }) + ": " + day.minutes + " min";

        const bar = document.createElement("div");
        bar.className = "week-bar" + (day.isToday ? " today" : "");
        bar.style.height = Math.max(4, Math.round((day.minutes / max) * 100)) + "%";

        const label = document.createElement("span");
        label.className = "week-label";
        label.textContent = day.date.toLocaleDateString([], { weekday: "narrow" });

        col.appendChild(bar);
        col.appendChild(label);
        els.weekBars.appendChild(col);
    });

    const hours = Math.floor(total / 60);
    els.weekTotal.textContent = hours + "h " + (total % 60) + "m";
}

function renderHistory() {
    els.historyList.textContent = "";

    if (state.history.length === 0) {
        const empty = document.createElement("li");
        empty.className = "history-empty";
        empty.textContent = "Finished focus sessions will show up here.";
        els.historyList.appendChild(empty);
        renderDays();
        return;
    }

    state.history.forEach(function (entry) {
        const row = document.createElement("li");
        row.className = "history-row";

        const label = document.createElement("span");
        label.textContent = "Focus \u00b7 " + entry.minutes + " min";

        const when = document.createElement("span");
        when.className = "history-when";
        when.textContent = formatWhen(entry.at);

        row.appendChild(label);
        row.appendChild(when);
        els.historyList.appendChild(row);
    });

    renderDays();
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
    startAmbient();
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
    stopAmbient();
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
    stopAmbient();
    state.running = false;
    state.endsAt = null;
    state.remainingMs = modeDurationMs(state.mode);
    render();
}

function setMode(mode) {
    if (!MODES[mode]) return;
    stopTicker();
    stopAmbient();
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

function completeSession(focusedMinutes) {
    stopTicker();
    stopAmbient();
    state.running = false;
    state.endsAt = null;
    state.remainingMs = 0;

    const wasWork = state.mode === "work";

    if (wasWork) {
        state.sessionsCompleted += 1;
        state.workSessionsInRow += 1;
        recordSession(focusedMinutes === undefined ? state.settings.work : focusedMinutes);
    }

    playChime();
    notifySessionEnd(wasWork);
    render();
    renderHistory();

    const upcoming = nextMode();
    window.setTimeout(function () {
        setMode(upcoming);
        if (state.settings.autoStart) {
            startTimer();
        }
    }, 800);
}

function skipSession() {
    const wasWork = state.mode === "work";
    const elapsed = wasWork ? Math.max(0, modeDurationMs(state.mode) - state.remainingMs) : 0;

    if (wasWork) {
        state.totalFocusMs += elapsed;
    }

    stopTicker();
    state.running = false;
    state.endsAt = null;
    state.remainingMs = 0;
    completeSession(elapsed / 60000);
}

let ambient = null;

function startAmbient() {
    if (!state.settings.ambient || ambient) return;

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;

    try {
        const ctx = new AudioCtor();
        const seconds = 2;
        const frames = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let last = 0;

        for (let i = 0; i < frames; i += 1) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 900;

        const gain = ctx.createGain();
        gain.gain.value = 0.16;

        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start();

        ambient = { ctx: ctx, source: source };
    } catch (error) {
        console.warn("Background noise unavailable:", error);
    }
}

function stopAmbient() {
    if (!ambient) return;

    try {
        ambient.source.stop();
    } catch (error) {
        console.warn("Could not stop background noise:", error);
    }

    try {
        if (typeof ambient.ctx.close === "function") ambient.ctx.close();
    } catch (error) {
        console.warn("Could not close audio context:", error);
    }

    ambient = null;
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

els.ambientToggle.addEventListener("change", function () {
    state.settings.ambient = els.ambientToggle.checked;
    if (state.settings.ambient && state.running) {
        startAmbient();
    } else {
        stopAmbient();
    }
    queueSave();
});

els.autostartToggle.addEventListener("change", function () {
    state.settings.autoStart = els.autostartToggle.checked;
    queueSave();
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

window.addEventListener("beforeunload", function () {
    stopAmbient();
    saveState();
});

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
els.ambientToggle.checked = state.settings.ambient;
els.autostartToggle.checked = state.settings.autoStart;
els.notifyToggle.checked = state.settings.notify
    && typeof Notification !== "undefined"
    && Notification.permission === "granted";

if (state.running) {
    startTicker();
}

render();
renderTasks();
renderHistory();
