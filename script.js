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
    tabs: document.querySelectorAll(".mode-tab"),
    inputs: {
        work: document.getElementById("work-duration"),
        short: document.getElementById("short-duration"),
        long: document.getElementById("long-duration")
    }
};

const STORAGE_KEY = "pomodoro-focus-timer/v1";
let saveHandle = null;

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
    }

    if (saved.stats) {
        state.sessionsCompleted = positiveInt(saved.stats.sessionsCompleted);
        state.totalFocusMs = positiveInt(saved.stats.totalFocusMs);
        state.workSessionsInRow = positiveInt(saved.stats.workSessionsInRow);
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

    if (state.mode === "work") {
        state.sessionsCompleted += 1;
        state.workSessionsInRow += 1;
    }

    playChime();
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

if (state.running) {
    startTicker();
}

render();
