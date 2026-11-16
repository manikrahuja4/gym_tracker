# Training Log

A dependency-free, offline-first workout log with a customizable rolling split. Training data stays in the browser on the device where you log it.

## Run locally

From this directory, run `npm start` with Node.js installed, then open [http://localhost:4173](http://localhost:4173). Wait for **Offline ready** before disconnecting. Run `npm test` for the training logic checks.

## Use on a phone

Serve the project files from an HTTPS static host. Open the HTTPS address on your phone once and use your browser’s **Install app** or **Add to Home Screen** command. The app’s service worker caches the interface, so you can log workouts and view history without a connection. A local address on your computer is only for testing on that computer.

Workouts are stored by browser and address. Use **Today → Settings and backup → Export backup** and **Restore backup** to move your log to another device or address.

## How progression works

Each set prefills from the matching set in the last completed session for that exercise. When every planned set from the previous session hits the rep ceiling at the same weight, the app suggests the exercise’s configured weight increment. A personal best means a higher weight for that exercise or more reps at its highest logged weight.
