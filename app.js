import {
  uid, dayKey, fromDay, initialState, blankExercise, startWorkout, historyFor, setDefaults,
  coach, moveNext, logSet, undoSet, finishWorkout, setCount, volume, rounded, validBackup,
} from './training.js';

const storageKey = 'training-log-v1';
const app = document.querySelector('#app');
const nav = document.querySelector('#nav');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const connection = document.querySelector('#connection');
const format = new Intl.NumberFormat(undefined, { maximumFractionDigits:2 });
const dateLabel = (day, opts = { month:'short', day:'numeric' }) =>
  fromDay(day).toLocaleDateString(undefined, opts);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const paths = {
  today:'M3 10l9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 21v-7h6v7',
  workout:'M6 5v14m12-14v14M3 8v8m18-8v8M6 12h12',
  progress:'M3 3v18h18M7 14l4-4 4 2 6-7',
  split:'M4 6h16M4 12h16M4 18h16',
  arrow:'M4 12h15m-6-6 6 6-6 6',
  plus:'M12 5v14M5 12h14',
  check:'m5 12 4 4L19 6',
  settings:'M4 7h16M4 17h16M8 4v6m8 4v6',
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
const action = (name, label, style = 'secondary', attrs = '') =>
  '<button type="button" class="button ' + style + '" data-action="' + name + '" ' + attrs + '>' + label + '</button>';
const pill = text => '<span class="pill">' + escape(text) + '</span>';
const exerciseOf = id => state.exercises.find(exercise => exercise.id === id);
const exerciseName = id => exerciseOf(id)?.name ?? 'Exercise';
const dateSort = (a, b) => b.day.localeCompare(a.day) || b.ended - a.ended;
const loadLabel = (weight, reps) => format.format(weight) + ' kg × ' + reps;
let state = initialState();
let storageProblem = false;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (!validBackup(parsed)) throw new Error('Invalid training log');
    state = parsed;
  }
} catch {
  storageProblem = true;
}
let recap = null;
let selectedLift = '';
let draft = null;
let toastTimeout;
let installPrompt;
let offlineReady = false;
let workerFailed = false;

function notify(message) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.hidden = false;
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 3500);
}

function status() {
  connection.textContent = storageProblem ? 'Storage unavailable' : !navigator.onLine ? 'Offline' :
    offlineReady ? 'Offline ready' : workerFailed ? 'Local log' : 'Preparing offline';
}

function update(change, replace = false) {
  try {
    const disk = localStorage.getItem(storageKey);
    if (disk !== null && !replace) {
      const parsed = JSON.parse(disk);
      if (!validBackup(parsed)) throw new Error('Invalid training log');
      if (JSON.stringify(parsed) !== JSON.stringify(state) && !storageProblem) {
        state = parsed;
        draft = null;
        recap = null;
        render();
        notify('Training log refreshed from another tab. Try again.');
        return false;
      }
    }
    const next = structuredClone(state);
    change(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    state = next;
    storageProblem = false;
    status();
    return true;
  } catch {
    storageProblem = true;
    status();
    notify('Could not save to this browser.');
    return false;
  }
}

function route() {
  const screen = location.hash.slice(1);
  return ['today', 'workout', 'progress', 'split'].includes(screen) ? screen : 'today';
}

function go(screen) {
  if (route() === screen) render();
  else location.hash = screen;
}

function refreshWorkout() {
  draft = null;
  render();
}

function week() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
  const days = Array.from({ length:7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return dayKey(date);
  });
  const trained = new Set(state.sessions.map(session => session.day));
  const count = days.filter(day => trained.has(day)).length;
  return '<section class="panel week"><div class="spread"><h2>This week</h2>' + pill(count + ' / 7 days trained') +
    '</div><div class="week-grid">' + days.map(day => {
      const current = day === dayKey();
      const done = trained.has(day);
      return '<div class="weekday" aria-label="' + escape(dateLabel(day, { weekday:'long', month:'short', day:'numeric' })) +
        (done ? ', trained' : '') + (current ? ', today' : '') + '">' +
        '<span aria-hidden="true">' + escape(dateLabel(day, { weekday:'short' })) + '</span><span aria-hidden="true" class="day-mark ' +
        (done ? 'trained ' : '') + (current ? 'current' : '') + '">' + (done ? icon('check') : fromDay(day).getDate()) + '</span></div>';
    }).join('') + '</div></section>';
}

function todayScreen() {
  const active = state.active;
  const next = state.routines.find(routine => routine.id === state.nextId) ?? state.routines[0];
  const plan = active?.items ?? next?.items ?? [];
  const recent = [...state.sessions].sort(dateSort)[0];
  return '<header class="page-heading spread"><div><div class="eyebrow">' +
    escape(dateLabel(dayKey(), { weekday:'long', month:'long', day:'numeric' })) + '</div><h1>Today</h1></div>' +
    action('settings', icon('settings'), 'icon-button', 'aria-label="Settings and backup"') + '</header>' +
    '<div class="dashboard"><section class="hero"><div class="plate" aria-hidden="true"></div><div class="hero-content">' +
    '<div class="eyebrow"><span class="signal"></span>' + (active ? 'Workout in progress' : next ? 'Next in your split' : 'Your next workout') +
    '</div><h2>' + escape(active?.name ?? next?.name ?? 'Freestyle') + '</h2><p>' +
    escape(active ? setCount(active) + ' sets logged' : (next?.focus || plan.length + ' exercises')) + '</p>' +
    action(active ? 'resume' : 'start', (active ? 'Resume workout' : 'Start workout') + icon('arrow'),
      'hero-button', next ? 'data-id="' + escape(next.id) + '"' : '') +
    '</div></section>' + week() +
    '<section class="panel plan"><div class="spread"><h2>On the plan</h2>' + pill(plan.length + ' exercises') + '</div>' +
    (plan.length ? '<ol class="exercise-list">' + plan.map((item, i) => '<li><span class="ordinal">' + String(i + 1).padStart(2, '0') +
      '</span><strong>' + escape(exerciseName(item.exerciseId)) + '</strong><span class="meta">' + item.sets + ' × ' + item.min + '–' + item.max + '</span></li>').join('') +
      '</ol>' : '<p class="meta">Add exercises as you train.</p>') +
    (!active ? action('choose', 'Choose workout', 'quiet') : '') + '</section>' +
    '<section class="panel recent"><h2>Last session</h2>' + (recent ?
      '<p><strong>' + escape(recent.name) + '</strong></p><p class="meta">' + escape(dateLabel(recent.day)) + ' · ' +
      setCount(recent) + ' sets · ' + format.format(volume(recent)) + ' kg lifted</p>' +
      '<a class="text-link" href="#progress">View training history ' + icon('arrow') + '</a>' :
      '<p class="meta">Your first completed workout will appear here.</p>') + '</section></div>';
}

function recapScreen() {
  const records = recap.items.flatMap(item => item.logs.filter(set => set.record).map(set =>
    '<li><strong>' + escape(exerciseName(item.exerciseId)) + '</strong><span>' + loadLabel(set.weight, set.reps) + '</span></li>'));
  const next = state.routines.find(routine => routine.id === state.nextId);
  const improvements = recap.items.flatMap(item => {
    const prior = historyFor({ sessions:state.sessions.filter(session => session.id !== recap.id) }, item.exerciseId).at(-1);
    if (!prior) return [];
    const currentLoad = item.logs.reduce((sum, set) => sum + set.weight * set.reps, 0);
    const previousLoad = prior.logs.reduce((sum, set) => sum + set.weight * set.reps, 0);
    const difference = rounded(currentLoad - previousLoad);
    return difference > 0 ? ['<li><strong>' + escape(exerciseName(item.exerciseId)) + '</strong><span>+' +
      format.format(difference) + ' kg volume</span></li>'] : [];
  });
  return '<div class="work-layout"><section class="hero recap"><div class="plate" aria-hidden="true"></div><div class="hero-content">' +
    '<div class="eyebrow">Workout saved</div><h1>' + escape(recap.name) + '</h1><p>' + escape(dateLabel(recap.day)) + '</p></div></section>' +
    '<section class="panel summary"><div><span>Sets</span><strong>' + setCount(recap) +
    '</strong></div><div><span>Exercises</span><strong>' + recap.items.length +
    '</strong></div><div><span>Kg lifted</span><strong>' + format.format(volume(recap)) + '</strong></div></section>' +
    (records.length ? '<section class="panel"><h2>Personal bests</h2><ul class="logged-list">' + records.join('') + '</ul></section>' : '') +
    (improvements.length ? '<section class="panel"><h2>More volume than last time</h2><ul class="logged-list">' + improvements.join('') + '</ul></section>' : '') +
    (next ? '<section class="panel spread"><span class="meta">Next in your split</span><strong>' + escape(next.name) + '</strong></section>' : '') +
    (recap.routineId === null ? action('save-routine', 'Save as a routine') : '') +
    action('back-today', 'Back to Today ' + icon('arrow'), 'primary') + '</div>';
}

function workoutScreen() {
  if (!state.active) {
    if (recap) return recapScreen();
    return '<section class="panel empty"><h1>Workout</h1><p class="meta">Start a routine or train freestyle.</p>' +
      action('choose', 'Choose workout ' + icon('arrow'), 'primary') + '</section>';
  }
  const workout = state.active;
  const item = workout.items[workout.index];
  const count = setCount(workout);
  const common = '<header class="spread workout-heading"><div class="eyebrow">' + escape(workout.name) +
    '</div>' + action('finish', count ? 'Finish' : 'Discard', 'quiet') + '</header>';
  const queue = '<section class="panel"><div class="spread"><h2>Workout plan</h2>' +
    action('add-exercise', icon('plus') + ' Add exercise', 'quiet') + '</div>' +
    (workout.items.length ? '<ul class="exercise-list">' + workout.items.map((row, index) => '<li><span class="ordinal">' +
      String(index + 1).padStart(2, '0') + '</span><strong>' + escape(exerciseName(row.exerciseId)) +
      '</strong>' + action('jump', row.skipped ? 'Skipped' : row.logs.length + ' / ' + row.sets, 'quiet',
        'data-index="' + index + '" aria-label="Open ' + escape(exerciseName(row.exerciseId)) + '"') + '</li>').join('') + '</ul>' :
      '<p class="meta">Add an exercise to log your first set.</p>') + '</section>';
  const feedback = '<div class="rest-row"><div id="rest" role="timer"></div>' +
    (workout.undo ? action('undo', 'Undo last set', 'quiet') : '') + '</div>';
  if (!item) return '<div class="work-layout">' + common + '<section class="panel empty"><h1>' +
    (count ? 'Sets complete' : 'Ready to train') + '</h1><p class="meta">' +
    (count ? count + ' sets logged' : 'Pick an exercise to get started.') + '</p>' + feedback +
    (count ? action('complete', 'Save workout ' + icon('arrow'), 'primary') :
      action('add-exercise', icon('plus') + ' Add exercise', 'primary')) + '</section>' + (workout.items.length ? queue : '') + '</div>';

  const prior = setDefaults(state, item);
  const target = coach(state, item);
  const number = item.logs.length + 1;
  if (!draft) draft = { weight:prior.weight, reps:prior.reps };
  const increment = exerciseOf(item.exerciseId).increment || 2.5;
  return '<div class="work-layout">' + common + '<section class="panel logger">' +
    '<div class="spread"><div class="eyebrow">Exercise ' + (workout.index + 1) + ' of ' + workout.items.length +
    '</div>' + pill('Set ' + number + ' of ' + item.sets) + '</div><div class="segments" aria-hidden="true">' +
    Array.from({ length:item.sets }, (_, i) => '<span class="' + (i < number ? 'filled' : '') + '"></span>').join('') + '</div>' +
    '<h1>' + escape(exerciseName(item.exerciseId)) + '</h1><div class="previous spread"><span>Same set last time</span><strong>' +
    (prior.last ? loadLabel(prior.last.weight, prior.last.reps) : 'First time for this set') + '</strong></div>' +
    (target ? '<p class="coach">' + escape(target) + '</p>' : '<p class="coach">Target · ' + item.min + '–' + item.max + ' reps</p>') +
    '<form id="set-form"><div class="steppers">' + stepper('weight', 'Weight · kg', increment, 0, 9999, 0.01) +
    stepper('reps', 'Reps', 1, 1, 999, 1) + '</div>' + feedback +
    '<button type="submit" class="button primary log-button" id="log-label">Log ' + loadLabel(draft.weight, draft.reps) + icon('check') + '</button></form>' +
    '<div class="work-actions">' + (workout.items.length > 1 ? action('defer', 'Next exercise', 'quiet') : '') +
    action('skip', 'Skip', 'quiet') + action('swap', 'Swap', 'quiet') + action('extra', '+ Set', 'quiet') + '</div>' +
    (item.logs.length ? '<ul class="logged-list">' + item.logs.map((set, index) => '<li><span>Set ' + (index + 1) +
      '</span><strong>' + loadLabel(set.weight, set.reps) + (set.record ? ' · PR' : '') + '</strong></li>').join('') + '</ul>' : '') +
    '</section>' + queue + '</div>';
}

function stepper(field, label, step, min, max, precision) {
  return '<div class="stepper"><label for="set-' + field + '">' + label + '</label><input type="number" inputmode="' +
    (field === 'weight' ? 'decimal' : 'numeric') + '" required id="set-' + field + '" name="' + field + '" min="' + min +
    '" max="' + max + '" step="' + precision + '" value="' + draft[field] + '"><div class="step-buttons">' +
    action('step', '−', 'step-button', 'aria-label="Decrease ' + field + '" data-field="' + field + '" data-delta="' + -step + '"') +
    action('step', '+', 'step-button', 'aria-label="Increase ' + field + '" data-field="' + field + '" data-delta="' + step + '"') + '</div></div>';
}

function liftChart(rows) {
  const recent = rows.slice(-10);
  const points = recent.map(row => Math.max(...row.logs.map(set => set.weight)));
  const max = Math.max(1, ...points);
  return '<div class="chart" aria-label="Heaviest set per workout">' + recent.map((row, index) =>
    '<button type="button" class="chart-column" data-action="show-chart-sets" data-index="' + (rows.length - recent.length + index) +
    '" aria-label="' + escape(dateLabel(row.day)) + ', ' + format.format(points[index]) +
    ' kg, view sets"><span>' + format.format(points[index]) + '</span><span class="chart-track">' +
    '<span class="chart-bar" style="height:' + Math.max(3, points[index] / max * 100) + '%"></span></span><small>' +
    escape(dateLabel(row.day)) + '</small></button>').join('') + '</div>';
}

function loggedDetails(item) {
  return '<li><div><strong>' + escape(exerciseName(item.exerciseId)) + '</strong><ol class="set-chips">' +
    item.logs.map(set => '<li>' + loadLabel(set.weight, set.reps) + (set.record ? ' · PR' : '') + '</li>').join('') + '</ol></div></li>';
}

function progressScreen() {
  const trained = state.exercises.filter(exercise => historyFor(state, exercise.id).length);
  if (!trained.some(exercise => exercise.id === selectedLift)) selectedLift = trained[0]?.id ?? '';
  const history = historyFor(state, selectedLift);
  const sessions = [...state.sessions].sort(dateSort);
  return '<header class="page-heading"><h1>Progress</h1></header><div class="dashboard">' + week() +
    '<section class="panel lifts"><div class="spread"><h2>Lift history</h2>' + (trained.length ?
      '<select id="select-lift" aria-label="Choose lift">' + trained.map(exercise => '<option value="' + escape(exercise.id) + '"' +
      (exercise.id === selectedLift ? ' selected' : '') + '>' + escape(exercise.name) + '</option>').join('') + '</select>' : '') +
    '</div>' + (history.length ? '<p class="meta">Heaviest set · kg · Last ' + Math.min(10, history.length) + ' entries</p>' +
      liftChart(history) + '<div class="history-rows">' + [...history].reverse().map(row =>
      '<details data-lift-entry><summary><span>' + escape(dateLabel(row.day, { month:'short', day:'numeric', year:'numeric' })) + '</span>' +
      '<span class="meta">' + row.logs.length + ' sets</span></summary><ol class="set-chips">' +
      row.logs.map(set => '<li>' + loadLabel(set.weight, set.reps) + (set.record ? ' · PR' : '') + '</li>').join('') +
      '</ol></details>').join('') + '</div>' : '<p class="meta">Log a workout to see your lifts here.</p>') + '</section>' +
    '<section class="panel journal"><div class="spread"><h2>Training journal</h2>' + pill(sessions.length + ' workouts') + '</div>' +
    (sessions.length ? '<div class="history-rows">' + sessions.map(session =>
      '<details><summary><div><strong>' + escape(session.name) + '</strong><span class="meta journal-date">' +
      escape(dateLabel(session.day, { month:'short', day:'numeric', year:'numeric' })) + '</span></div><span class="meta">' +
      setCount(session) + ' sets</span></summary><ul class="logged-list">' + session.items.map(loggedDetails).join('') +
      '</ul></details>').join('') + '</div>' : '<p class="meta">Completed sessions will appear here.</p>') + '</section></div>';
}

function splitScreen() {
  return '<header class="page-heading spread"><div><div class="eyebrow">Rolling schedule</div><h1>Your split</h1></div>' +
    action('new-routine', icon('plus') + ' New routine', 'primary') + '</header><div class="split-grid">' +
    (state.routines.length ? state.routines.map((routine, index) => {
      const id = 'data-id="' + escape(routine.id) + '"';
      return '<section class="panel routine"><div class="spread"><span class="eyebrow">Day ' + (index + 1) +
        '</span>' + (routine.id === state.nextId ? pill('Up next') : action('set-next', 'Set as next', 'quiet', id)) +
        '</div><h2>' + escape(routine.name) + '</h2>' + (routine.focus ? '<p class="meta">' + escape(routine.focus) + '</p>' : '') +
        '<ul class="exercise-list">' + routine.items.map(item => '<li><strong>' + escape(exerciseName(item.exerciseId)) +
        '</strong><span class="meta">' + item.sets + ' × ' + item.min + '–' + item.max + '</span></li>').join('') + '</ul>' +
        '<div class="spread routine-actions">' + action('edit-routine', 'Edit routine', 'secondary', id) + '<div class="inline">' +
        action('move-routine', '←', 'quiet', id + ' data-delta="-1" aria-label="Move earlier"' + (index === 0 ? ' disabled' : '')) +
        action('move-routine', '→', 'quiet', id + ' data-delta="1" aria-label="Move later"' + (index === state.routines.length - 1 ? ' disabled' : '')) +
        '</div></div></section>';
    }).join('') : '<div class="panel"><p class="meta">Add a routine to start your split.</p></div>') + '</div>' +
    '<section class="panel library"><div class="spread"><h2>Exercise library</h2>' +
    action('exercise-editor', icon('plus') + ' New exercise', 'secondary') + '</div><p class="meta">' + state.exercises.length +
    ' exercises · Customize weight increments</p>' + action('library', 'Manage exercises', 'quiet') + '</section>';
}

function render() {
  const screen = route();
  nav.innerHTML = [['today', 'Today'], ['workout', 'Workout'], ['progress', 'Progress'], ['split', 'Split']].map(([id, label]) =>
    '<a href="#' + id + '"' + (id === screen ? ' aria-current="page"' : '') + '>' + icon(id) + '<span>' + label + '</span></a>').join('');
  app.innerHTML = ({ today:todayScreen, workout:workoutScreen, progress:progressScreen, split:splitScreen })[screen]();
  tick();
}

function tick() {
  const node = document.querySelector('#rest');
  if (!node) return;
  const seconds = Math.ceil(((state.active?.restUntil ?? 0) - Date.now()) / 1000);
  const text = seconds > 0 ? 'Rest ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') :
    state.active?.restUntil && state.rest ? 'Rest complete' : 'Rest timer ready';
  if (node.textContent !== text) node.textContent = text;
}

function openDialog(title, body) {
  dialog.innerHTML = '<div class="spread dialog-heading"><h2>' + escape(title) + '</h2>' +
    action('close', '×', 'icon-button', 'aria-label="Close"') + '</div>' + body;
  dialog.querySelector('h2').id = 'dialog-title';
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('input, select, .primary, button')?.focus();
}

function chooseWorkout() {
  openDialog('Choose workout', '<div class="dialog-list">' + state.routines.map(routine =>
    action('start', '<span>' + escape(routine.name) + '</span>' + icon('arrow'), 'secondary',
      'data-id="' + escape(routine.id) + '"')).join('') + action('start', 'Freestyle ' + icon('plus'), 'primary') + '</div>');
}

const options = selected => state.exercises.map(exercise => '<option value="' + escape(exercise.id) + '"' +
  (exercise.id === selected ? ' selected' : '') + '>' + escape(exercise.name) + '</option>').join('');
const field = (label, name, value, attrs = '') =>
  '<label>' + label + '<input name="' + name + '" value="' + escape(value) + '" ' + attrs + '></label>';
const submit = label => '<button type="submit" class="button primary">' + label + '</button>';

function pickExercise(mode) {
  openDialog(mode === 'swap' ? 'Swap exercise' : 'Add exercise', '<form data-form="pick" data-mode="' + mode + '">' +
    (state.exercises.length ? '<label>Exercise<select name="exerciseId">' + options() + '</select></label>' +
    submit(mode === 'swap' ? 'Swap exercise' : 'Add to workout') : '') +
    action('exercise-editor', 'Create an exercise', 'secondary', 'data-mode="' + mode + '"') + '</form>');
}

function addToWorkout(next, exerciseId, mode) {
  const workout = next.active;
  const current = workout.items[workout.index];
  const item = blankExercise(exerciseId);
  if (mode === 'swap' && current) {
    if (current.logs.length) {
      current.skipped = true;
      workout.items.push(item);
      workout.index = workout.items.length - 1;
    } else {
      workout.items[workout.index] = item;
    }
  } else {
    workout.items.push(item);
    workout.index = workout.items.length - 1;
  }
  workout.undo = null;
}

function routineRow(item) {
  const exerciseField = item.exerciseId
    ? '<label>Exercise<select name="exerciseId">' + options(item.exerciseId) + '</select></label>'
    : field('Custom exercise name', 'exerciseName', '', 'maxlength="80" required placeholder="Incline Dumbbell Press"');
  return '<div class="routine-row"><div class="spread">' + exerciseField +
    action('remove-row', '×', 'icon-button', 'aria-label="Remove exercise"') + '</div><div class="three-fields">' +
    field('Sets', 'sets', item.sets, 'type="number" min="1" max="99" required') +
    field('Min reps', 'min', item.min, 'type="number" min="1" max="999" required') +
    field('Max reps', 'max', item.max, 'type="number" min="1" max="999" required') + '</div></div>';
}

function routineEditor(routine, fromRecap = false) {
  const items = fromRecap ? recap.items.map(item => ({ ...item, sets:item.logs.length })) : routine?.items ?? [];
  openDialog(routine ? 'Edit routine' : 'New routine', '<form data-form="routine" data-id="' + escape(routine?.id) + '">' +
    field('Routine name', 'name', routine?.name ?? '', 'maxlength="60" required placeholder="Upper Body"') +
    field('Muscle groups', 'focus', routine?.focus ?? '', 'maxlength="100" placeholder="Chest · Back · Shoulders"') +
    '<div id="routine-rows">' + items.map(routineRow).join('') + '</div>' +
    (state.exercises.length ? action('routine-row', icon('plus') + ' Add from library', 'secondary') : '') +
    action('custom-routine-row', icon('plus') + ' Add custom exercise', 'secondary') +
    '<p class="form-error" role="alert"></p>' + submit('Save routine') +
    (routine ? action('delete-routine', 'Delete routine', 'danger', 'data-id="' + escape(routine.id) + '"') : '') + '</form>');
}

function library() {
  openDialog('Exercise library', '<div class="dialog-list">' + action('exercise-editor', icon('plus') + ' New exercise', 'primary') +
    [...state.exercises].sort((a, b) => a.name.localeCompare(b.name)).map(exercise => action('exercise-editor',
      '<span>' + escape(exercise.name) + '</span><span class="meta">' + format.format(exercise.increment) + ' kg step</span>',
      'secondary', 'data-id="' + escape(exercise.id) + '"')).join('') + '</div>');
}

function editExercise(id, mode) {
  const exercise = exerciseOf(id);
  openDialog(exercise ? 'Edit exercise' : 'New exercise', '<form data-form="exercise" data-id="' + escape(id) +
    '" data-mode="' + escape(mode) + '">' + field('Exercise name', 'name', exercise?.name ?? '', 'maxlength="80" required') +
    field('Weight increment · kg', 'increment', exercise?.increment ?? 2.5, 'type="number" min="0" max="100" step="0.01" required') +
    '<p class="meta">Use 0 to turn off weight increase suggestions for this lift.</p><p class="form-error" role="alert"></p>' +
    submit(mode ? 'Create and add' : 'Save exercise') + '</form>');
}

function settings() {
  openDialog('Settings', '<form data-form="settings">' +
    field('Rest timer · seconds', 'rest', state.rest, 'type="number" min="0" max="600" required') +
    '<p class="meta">Use 0 to turn off the timer.</p>' + submit('Save settings') +
    '</form><hr><div class="dialog-list">' +
    action('export', 'Export backup', 'secondary') +
    '<label class="file-picker">Restore backup<input id="restore-file" type="file" accept=".json,application/json"></label>' +
    (installPrompt ? action('install', 'Install app', 'secondary') : '') + '</div>');
}

function exportBackup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type:'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'training-log-' + dayKey() + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let importState;
async function readBackup(file) {
  importState = null;
  try {
    if (!file || file.size > 15 * 1024 * 1024) throw new Error('Bad file');
    const parsed = JSON.parse(await file.text());
    if (!validBackup(parsed)) throw new Error('Bad data');
    importState = parsed;
    openDialog('Restore training log?', '<p>This replaces the log and settings on this device with ' +
      parsed.sessions.length + ' workouts and ' + parsed.routines.length + ' routines from the backup.</p>' +
      action('restore', 'Replace and restore', 'danger'));
  } catch {
    notify('Choose a valid Training Log backup under 15 MB.');
  }
}

function saveWorkout() {
  let saved;
  if (!update(next => { saved = finishWorkout(next); }) || !saved) return;
  recap = saved;
  draft = null;
  dialog.close();
  render();
  notify('Workout saved');
}

function workoutChange(change) {
  if (!state.active) return;
  if (update(next => change(next.active))) refreshWorkout();
}

function stepValue(button) {
  const field = button.dataset.field;
  const input = document.querySelector('#set-' + field);
  const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : Number(input.min);
  input.value = Math.max(Number(input.min), Math.min(Number(input.max), rounded(value + Number(button.dataset.delta))));
  updateDraft();
}

function updateDraft() {
  const form = document.querySelector('#set-form');
  if (!form) return;
  const { weight, reps } = form.elements;
  const valid = weight.validity.valid && reps.validity.valid;
  if (weight.validity.valid) draft.weight = weight.valueAsNumber;
  if (reps.validity.valid) draft.reps = reps.valueAsNumber;
  form.querySelector('#log-label').innerHTML = (valid ? 'Log ' + loadLabel(draft.weight, draft.reps) : 'Log set') + icon('check');
}

const actions = {
  settings, library, choose:chooseWorkout,
  start({ dataset }) {
    const id = dataset.id;
    if (!update(next => startWorkout(next, next.routines.find(routine => routine.id === id)))) return;
    recap = null;
    draft = null;
    dialog.close();
    go('workout');
  },
  resume:() => go('workout'),
  'back-today':() => go('today'),
  'show-chart-sets'({ dataset }) {
    const row = [...app.querySelectorAll('[data-lift-entry]')].reverse()[Number(dataset.index)];
    if (!row) return;
    row.open = true;
    row.scrollIntoView({ block:'nearest' });
    row.querySelector('summary').focus({ preventScroll:true });
  },
  close:() => dialog.close(),
  step:stepValue,
  undo:() => workoutChange(undoSet),
  defer:() => workoutChange(moveNext),
  skip:() => workoutChange(workout => {
    workout.items[workout.index].skipped = true;
    moveNext(workout);
  }),
  extra:() => workoutChange(workout => {
    const item = workout.items[workout.index];
    item.sets = Math.min(99, item.sets + 1);
  }),
  jump({ dataset }) {
    const index = Number(dataset.index);
    const item = state.active.items[index];
    if (!item) return;
    if (item.logs.length >= item.sets) {
      openDialog(exerciseName(item.exerciseId), '<ul class="logged-list">' +
        item.logs.map((set, i) => '<li><span>Set ' + (i + 1) + '</span><strong>' +
        loadLabel(set.weight, set.reps) + '</strong></li>').join('') + '</ul>' +
        (item.sets < 99 ? action('complete-extra', 'Add another set', 'primary', 'data-index="' + index + '"') : ''));
      return;
    }
    workoutChange(workout => {
      workout.index = index;
      workout.items[index].skipped = false;
    });
    document.querySelector('.logger')?.scrollIntoView({ block:'nearest' });
  },
  'complete-extra'({ dataset }) {
    workoutChange(workout => {
      workout.index = Number(dataset.index);
      const item = workout.items[workout.index];
      item.sets += 1;
      item.skipped = false;
    });
    dialog.close();
  },
  'add-exercise':() => pickExercise('add'),
  swap:() => pickExercise('swap'),
  finish() {
    const count = setCount(state.active);
    openDialog(count ? 'Finish workout?' : 'Discard this workout?',
      (count ? '<p>Save ' + count + ' logged sets to your training journal.</p>' : '<p>This session has no logged sets.</p>') +
      action(count ? 'complete' : 'discard', count ? 'Save workout' : 'Discard workout', count ? 'primary' : 'danger'));
  },
  complete:saveWorkout,
  discard() {
    if (!update(next => { next.active = null; })) return;
    dialog.close();
    draft = null;
    go('today');
  },
  'new-routine':() => routineEditor(),
  'save-routine':() => routineEditor(null, true),
  'edit-routine':({ dataset }) => routineEditor(state.routines.find(routine => routine.id === dataset.id)),
  'routine-row'() {
    if (!state.exercises.length) {
      notify('Add an exercise in the library first.');
      return;
    }
    const rows = dialog.querySelector('#routine-rows');
    rows.insertAdjacentHTML('beforeend', routineRow(blankExercise(state.exercises[0].id)));
    rows.lastElementChild.querySelector('select').focus();
  },
  'custom-routine-row'() {
    const rows = dialog.querySelector('#routine-rows');
    rows.insertAdjacentHTML('beforeend', routineRow(blankExercise(null)));
    rows.lastElementChild.querySelector('[name=exerciseName]').focus();
  },
  'remove-row':button => button.closest('.routine-row').remove(),
  'set-next'({ dataset }) {
    if (update(next => { next.nextId = dataset.id; })) render();
  },
  'move-routine'({ dataset }) {
    if (update(next => {
      const index = next.routines.findIndex(routine => routine.id === dataset.id);
      const [routine] = next.routines.splice(index, 1);
      next.routines.splice(index + Number(dataset.delta), 0, routine);
    })) render();
  },
  'delete-routine'({ dataset }) {
    openDialog('Delete routine?', '<p>Completed workouts stay in your training journal.</p>' +
      action('confirm-delete', 'Delete routine', 'danger', 'data-id="' + escape(dataset.id) + '"'));
  },
  'confirm-delete'({ dataset }) {
    if (!update(next => {
      next.routines = next.routines.filter(routine => routine.id !== dataset.id);
      if (next.nextId === dataset.id) next.nextId = next.routines[0]?.id ?? null;
    })) return;
    dialog.close();
    render();
    notify('Routine deleted');
  },
  'exercise-editor':({ dataset }) => editExercise(dataset.id, dataset.mode),
  export:exportBackup,
  restore() {
    if (!importState || !update(next => Object.assign(next, importState), true)) return;
    importState = null;
    recap = null;
    draft = null;
    dialog.close();
    go('today');
    notify('Backup restored');
  },
  async install() {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    settings();
  },
};

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button) actions[button.dataset.action]?.(button);
});

document.addEventListener('input', event => {
  if (event.target.closest('#set-form') && event.target.matches('input')) updateDraft();
});

document.addEventListener('change', event => {
  if (event.target.id === 'select-lift') {
    selectedLift = event.target.value;
    render();
    document.querySelector('#select-lift').focus();
  } else if (event.target.id === 'restore-file') {
    const [file] = event.target.files;
    if (file) readBackup(file);
  }
});

const forms = {
  pick(form, data) {
    if (!state.active || !exerciseOf(data.get('exerciseId'))) return;
    if (!update(next => addToWorkout(next, data.get('exerciseId'), form.dataset.mode))) return;
    dialog.close();
    refreshWorkout();
  },
  routine(form, data) {
    const name = data.get('name').trim();
    const focus = data.get('focus').trim();
    const id = form.dataset.id || uid();
    const rows = [...form.querySelectorAll('.routine-row')].map(row => ({
      exerciseId:row.querySelector('[name=exerciseId]')?.value,
      exerciseName:row.querySelector('[name=exerciseName]')?.value.trim(),
      sets:Number(row.querySelector('[name=sets]').value),
      min:Number(row.querySelector('[name=min]').value),
      max:Number(row.querySelector('[name=max]').value),
    }));
    const error = form.querySelector('.form-error');
    if (!name || !rows.length || rows.some(row => row.exerciseName === '' || row.min > row.max)) {
      error.textContent = !name ? 'Enter a routine name.' : !rows.length ? 'Add at least one exercise.' :
        rows.some(row => row.exerciseName === '') ? 'Enter a name for each custom exercise.' : 'Max reps must be at least min reps.';
      return;
    }
    if (!update(next => {
      const items = rows.map(({ exerciseId, exerciseName, sets, min, max }) => {
        if (exerciseName) {
          let exercise = next.exercises.find(row => row.name.toLowerCase() === exerciseName.toLowerCase());
          if (!exercise) {
            exercise = { id:uid(), name:exerciseName, increment:2.5 };
            next.exercises.push(exercise);
          }
          exerciseId = exercise.id;
        }
        return { exerciseId, sets, min, max };
      });
      const index = next.routines.findIndex(routine => routine.id === id);
      const routine = { id, name, focus, items };
      if (index >= 0) next.routines[index] = routine;
      else next.routines.push(routine);
      next.nextId ??= id;
    })) return;
    dialog.close();
    render();
    notify('Routine saved');
  },
  exercise(form, data) {
    const name = data.get('name').trim();
    const id = form.dataset.id || uid();
    const mode = form.dataset.mode;
    if (!name || state.exercises.some(exercise => exercise.id !== id && exercise.name.toLowerCase() === name.toLowerCase())) {
      form.querySelector('.form-error').textContent = name ? 'An exercise already has that name.' : 'Enter an exercise name.';
      return;
    }
    if (!update(next => {
      const exercise = { id, name, increment:Number(data.get('increment')) };
      const index = next.exercises.findIndex(row => row.id === id);
      if (index >= 0) next.exercises[index] = exercise;
      else next.exercises.push(exercise);
      if (mode && next.active) addToWorkout(next, id, mode);
    })) return;
    if (mode) dialog.close();
    else library();
    refreshWorkout();
    notify('Exercise saved');
  },
  settings(form, data) {
    if (!update(next => { next.rest = Number(data.get('rest')); })) return;
    dialog.close();
    render();
    notify('Settings saved');
  },
};

document.addEventListener('submit', event => {
  const form = event.target;
  const data = new FormData(form);
  event.preventDefault();
  if (form.id !== 'set-form') {
    forms[form.dataset.form]?.(form, data);
    return;
  }
  let saved;
  if (!update(next => { saved = logSet(next, Number(data.get('weight')), Number(data.get('reps'))); }) || !saved) return;
  refreshWorkout();
  if (saved.record) {
    navigator.vibrate?.(35);
    notify('New personal best · ' + loadLabel(saved.weight, saved.reps));
  } else notify('Set logged · ' + loadLabel(saved.weight, saved.reps));
  document.querySelector('#log-label')?.focus({ preventScroll:true });
});

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('online', status);
window.addEventListener('offline', status);
window.addEventListener('storage', event => {
  if (event.key !== storageKey || !event.newValue) return;
  try {
    const next = JSON.parse(event.newValue);
    if (!validBackup(next)) return;
    state = next;
    draft = null;
    recap = null;
    storageProblem = false;
    dialog.close();
    status();
    render();
  } catch {
    // Leave the current in-memory log available for export.
  }
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    offlineReady = true;
    status();
  }).catch(() => { workerFailed = true; status(); });
} else {
  workerFailed = true;
}
status();
render();
setInterval(tick, 250);
