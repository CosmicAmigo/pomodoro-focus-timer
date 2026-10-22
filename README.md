# Pomodoro Focus Timer

A small, dependency-free Pomodoro timer that you can just open in a browser. No build step, no accounts, works offline.

## Features

- **Accurate countdown.** The timer stores the moment it should end and derives the remaining time from that, so background tabs and paused JavaScript don't make it drift.
- **Focus, short break and long break** modes with customizable durations.
- **Picks up where you left off.** Settings, stats, the running timer, your task list and session history are all saved in `localStorage`, so a refresh (or a closed tab) doesn't wipe anything.
- **Session task list.** Write down what you are working on, check things off, remove them.
- **Recent sessions**, so you can see what you actually got done today.
- **Light and dark themes** with a toggle in the corner. The first load follows your system preference.
- **Chime and optional desktop notification** when a session ends.
- **Keyboard shortcuts:** `Space` start/pause, `R` reset, `S` skip.

## Running it

Open `index.html` in a browser. That's it.

If you would rather serve it: any static file server pointed at this folder works.

## Tech stack

Plain HTML, CSS and JavaScript. No frameworks, no dependencies, no analytics.

## Notes

- Notifications need permission, and browsers only grant that over `http(s)` (or `localhost`), so the toggle will politely turn itself back off when the page is opened as a `file://` URL.
- Data lives only in your browser. Clearing site data resets the app.
