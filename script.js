const DURATIONS = {
    work: 25 * 60,
    short: 5 * 60,
    long: 15 * 60
};

const MODE_LABELS = {
    work: "Focus",
    short: "Short Break",
    long: "Long Break"
};

const CIRCUMFERENCE = 2 * Math.PI * 90;

let currentMode = "work";
let timeRemaining = DURATIONS.work;
let isRunning = false;
let intervalId = null;
let sessionsCompleted = 0;
let totalFocusSeconds = 0;
let workSessionsBeforeLong = 0;

const timeDisplay = document.getElementById("time");
const modeLabel = document.getElementById("mode-label");
const progressCircle = document.querySelector(".timer-progress");
const startPauseBtn = document.getElementById("start-pause");
const resetBtn = document.getElementById("reset");
const skipBtn = document.getElementById("skip");
const sessionCountEl = document.getElementById("session-count");
const totalFocusEl = document.getElementById("total-focus");
const soundToggle = document.getElementById("sound-toggle");
const modeTabs = document.querySelectorAll(".mode-tab");
const workInput = document.getElementById("work-duration");
const shortInput = document.getElementById("short-duration");
const longInput = document.getElementById("long-duration");

progressCircle.style.strokeDasharray = CIRCUMFERENCE;
progressCircle.style.strokeDashoffset = 0;

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function updateDisplay() {
    timeDisplay.textContent = formatTime(timeRemaining);
    const total = DURATIONS[currentMode];
    const elapsed = total - timeRemaining;
    progressCircle.style.strokeDashoffset = (elapsed / total) * CIRCUMFERENCE;
}

function playChime() {
    if (!soundToggle.checked) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 800;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1);
    } catch (e) {
        console.warn("Audio not available:", e);
    }
}

function setMode(mode, autoStart) {
    currentMode = mode;
    timeRemaining = DURATIONS[mode];
    stopTimer();
    modeLabel.textContent = MODE_LABELS[mode];
    document.body.classList.remove("mode-work", "mode-short", "mode-long");
    document.body.classList.add("mode-" + mode);
    modeTabs.forEach(function (tab) {
        tab.classList.toggle("active", tab.dataset.mode === mode);
    });
    updateDisplay();
    if (autoStart) startTimer();
}

function startTimer() {
    if (isRunning) return;
    isRunning = true;
    startPauseBtn.textContent = "Pause";
    intervalId = setInterval(function () {
        timeRemaining--;
        if (currentMode === "work") totalFocusSeconds++;
        updateDisplay();
        if (timeRemaining <= 0) {
            onTimerEnd();
        }
    }, 1000);
}

function stopTimer() {
    isRunning = false;
    startPauseBtn.textContent = "Start";
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

function onTimerEnd() {
    stopTimer();
    playChime();
    if (currentMode === "work") {
        sessionsCompleted++;
        workSessionsBeforeLong++;
        sessionCountEl.textContent = sessionsCompleted;
        totalFocusEl.textContent = Math.floor(totalFocusSeconds / 60) + "m";
        if (workSessionsBeforeLong % 4 === 0) {
            setMode("long", true);
        } else {
            setMode("short", true);
        }
    } else {
        setMode("work", true);
    }
}

startPauseBtn.addEventListener("click", function () {
    if (isRunning) {
        stopTimer();
    } else {
        startTimer();
    }
});

resetBtn.addEventListener("click", function () {
    setMode(currentMode, false);
});

skipBtn.addEventListener("click", function () {
    onTimerEnd();
});

modeTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
        setMode(tab.dataset.mode, false);
    });
});

function applySettings() {
    DURATIONS.work = parseInt(workInput.value, 10) * 60 || 25 * 60;
    DURATIONS.short = parseInt(shortInput.value, 10) * 60 || 5 * 60;
    DURATIONS.long = parseInt(longInput.value, 10) * 60 || 15 * 60;
    if (!isRunning) {
        timeRemaining = DURATIONS[currentMode];
        updateDisplay();
    }
}

[workInput, shortInput, longInput].forEach(function (input) {
    input.addEventListener("change", applySettings);
});

document.addEventListener("keydown", function (e) {
    if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        startPauseBtn.click();
    }
});

updateDisplay();
