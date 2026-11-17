import {
  uid, dayKey, fromDay, initialState, blankExercise, startWorkout, historyFor, setDefaults,
  coach, moveNext, logSet, undoSet, finishWorkout, setCount, volume, rounded, validBackup,
  initializeLibrary, searchExercises, plannedItems, estimateWorkoutMinutes, editSet,
  workoutTemplates, addWorkoutTemplate, displayWeight, inputWeightInKg, workoutExportText,
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
  share:'M12 15V3m-4 4 4-4 4 4M5 11v9h14v-9',
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
const action = (name, label, style = 'secondary', attrs = '') =>
  '<button type="button" class="button ' + style + '" data-action="' + name + '" ' + attrs + '>' + label + '</button>';
const pill = text => '<span class="pill">' + escape(text) + '</span>';
const exerciseOf = id => state.exercises.find(exercise => exercise.id === id);
const exerciseName = id => exerciseOf(id)?.name ?? 'Exercise';
const dateSort = (a, b) => b.day.localeCompare(a.day) || b.ended - a.ended;
const unit = () => state.unit ?? 'kg';
const shownWeight = weight => displayWeight(weight, unit());
const weightLabel = weight => format.format(shownWeight(weight)) + ' ' + unit();
const loadLabel = (weight, reps) => weightLabel(weight) + ' × ' + reps;
const weightStep = () => unit() === 'lb' ? 0.1 : 0.01;
function durationLabel(items) {
  const minutes = estimateWorkoutMinutes(items, state.rest);
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? '~' + hours + ' hr' + (remainder ? ' ' + remainder + ' min' : '') : '~' + minutes + ' min';
}
let state = initialState({ empty:true });
let storageProblem = false;
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (!validBackup(parsed)) throw new Error('Invalid training log');
    state = initializeLibrary(parsed);
  }
} catch {
  storageProblem = true;
}
let recap = null;
let savedRecapRoutine;
let selectedLift = '';
let draft = null;
let draftDefaultWeight;
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
      initializeLibrary(parsed);
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
    initializeLibrary(next);
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
  if (screen === 'progress') return 'history';
  if (screen === 'split') return 'routines';
  return ['today', 'workout', 'history', 'routines'].includes(screen) ? screen : 'today';
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
  const plan = active?.items ?? plannedItems(state, next);
  const estimate = durationLabel(plan);
  return '<header class="page-heading spread"><div><div class="eyebrow">' +
    escape(dateLabel(dayKey(), { weekday:'long', month:'long', day:'numeric' })) + '</div><h1>Today</h1></div>' +
    action('settings', icon('settings'), 'icon-button', 'aria-label="Settings and backup"') + '</header>' +
    '<div class="today-layout"><section class="hero"><div class="plate" aria-hidden="true"></div><div class="hero-content">' +
    (active || next ? '<div class="eyebrow">' + (active ? 'In progress' : 'Up next') + '</div>' : '') +
    '<h2>' + escape(active?.name ?? next?.name ?? 'Ready to train?') + '</h2>' +
    (active || next ? '<p>' + escape(active ? setCount(active) + ' sets logged' : plan.length + ' exercises') +
      (estimate ? ' · ' + estimate + ' total' : '') + '</p>' : '') +
    action(active ? 'resume' : 'start', (active ? 'Resume workout' : next ? 'Start workout' : 'Start empty workout') + icon('arrow'),
      'hero-button', next ? 'data-id="' + escape(next.id) + '"' : '') +
    '</div></section>' + (!active ? action(next ? 'choose' : 'templates', next ? 'Choose another workout' : 'Use a template', 'secondary') : '') +
    (state.sessions.length ? week() : '') + '</div>';
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
      weightLabel(difference) + ' volume</span></li>'] : [];
  });
  return '<div class="work-layout"><section class="hero recap"><div class="plate" aria-hidden="true"></div><div class="hero-content">' +
    '<div class="eyebrow">Workout saved</div><h1>' + escape(recap.name) + '</h1><p>' + escape(dateLabel(recap.day)) + '</p></div></section>' +
    '<section class="panel summary"><div><span>Sets</span><strong>' + setCount(recap) +
    '</strong></div><div><span>Exercises</span><strong>' + recap.items.length +
    '</strong></div><div><span>' + unit() + ' lifted</span><strong>' + format.format(shownWeight(volume(recap))) + '</strong></div></section>' +
    (records.length ? '<section class="panel"><h2>Personal bests</h2><ul class="logged-list">' + records.join('') + '</ul></section>' : '') +
    (improvements.length ? '<section class="panel"><h2>More volume than last time</h2><ul class="logged-list">' + improvements.join('') + '</ul></section>' : '') +
    (next ? '<section class="panel spread"><span class="meta">Next in your split</span><strong>' + escape(next.name) + '</strong></section>' : '') +
    (recap.routineId === null && savedRecapRoutine !== recap.id ? action('save-routine', 'Save as a routine') : '') +
    action('export-workout', icon('share') + ' Share workout', 'secondary', 'data-id="' + escape(recap.id) + '"') +
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
  const estimate = durationLabel(workout.items);
  const common = '<header class="spread workout-heading"><div><div class="eyebrow">' + escape(workout.name) +
    '</div>' + (estimate ? '<div class="meta">' + estimate + ' total</div>' : '') +
    '</div>' + action('finish', count ? 'Finish' : 'Discard', 'quiet') + '</header>';
  const queue = '<section class="panel workout-queue"><div class="spread"><h2>Exercises</h2>' +
    action('add-exercise', icon('plus') + ' Add exercise', 'quiet') + '</div>' +
    (workout.items.length ? '<ul class="exercise-list">' + workout.items.map((row, index) => '<li>' +
      action('jump', '<strong>' + escape(exerciseName(row.exerciseId)) + '</strong><span class="meta">' +
        (row.skipped ? 'Skipped' : row.logs.length + ' / ' + row.sets) + '</span>', 'quiet queue-row',
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
  const target = coach(state, item, weightLabel);
  const number = item.logs.length + 1;
  if (!draft) {
    draftDefaultWeight = prior.weight;
    draft = { weight:prior.weight, reps:prior.reps };
  }
  return '<div class="work-layout">' + common + '<section class="panel logger">' +
    '<div class="spread"><div class="eyebrow">Set ' + number + ' of ' + item.sets + '</div>' +
    '<details class="exercise-menu"><summary aria-label="Exercise options">⋯</summary><div>' +
    (workout.items.length > 1 ? action('defer', 'Next exercise', 'quiet') : '') +
    action('extra', 'Add a set', 'quiet') + action('swap', 'Swap exercise', 'quiet') +
    action('skip', 'Skip exercise', 'quiet') + '</div></details></div>' +
    '<h1>' + escape(exerciseName(item.exerciseId)) + '</h1><p class="meta">' +
    (prior.last ? 'Last time · ' + loadLabel(prior.last.weight, prior.last.reps) : 'Target · ' + item.min + '–' + item.max + ' reps') + '</p>' +
    (target && target.startsWith('You hit') ? '<p class="coach">' + escape(target) + '</p>' : '') +
    (item.oncePerWeek && exerciseName(item.exerciseId).toLowerCase() === 'wrist rotations'
      ? '<p class="meta">Reps in each direction, per arm.</p>' : '') +
    '<form id="set-form"><div class="steppers">' +
    numberField('weight', 'Weight · ' + unit(), shownWeight(draft.weight), 0, shownWeight(9999), weightStep()) +
    numberField('reps', 'Reps', draft.reps, 1, 999, 1) + '</div><div class="log-dock">' + feedback +
    '<button type="submit" class="button primary log-button" id="log-label">Log ' + loadLabel(draft.weight, draft.reps) + icon('check') + '</button></div></form>' +
    (item.logs.length ? loggedSetList(workout, workout.index) : '') +
    '</section>' + queue + '</div>';
}

function numberField(field, label, value, min, max, precision) {
  return '<div class="stepper"><label for="set-' + field + '">' + label + '</label><input type="number" inputmode="' +
    (field === 'weight' ? 'decimal' : 'numeric') + '" required id="set-' + field + '" name="' + field + '" min="' + min +
    '" max="' + max + '" step="' + precision + '" value="' + value + '"></div>';
}

function liftChart(rows) {
  const recent = rows.slice(-10);
  const points = recent.map(row => Math.max(...row.logs.map(set => set.weight)));
  const max = Math.max(1, ...points);
  return '<div class="chart" aria-label="Heaviest set per workout">' + recent.map((row, index) =>
    '<button type="button" class="chart-column" data-action="show-chart-sets" data-index="' + (rows.length - recent.length + index) +
    '" aria-label="' + escape(dateLabel(row.day)) + ', ' + weightLabel(points[index]) +
    ', view sets"><span>' + format.format(shownWeight(points[index])) + '</span><span class="chart-track">' +
    '<span class="chart-bar" style="height:' + Math.max(3, points[index] / max * 100) + '%"></span></span><small>' +
    escape(dateLabel(row.day)) + '</small></button>').join('') + '</div>';
}

function loggedSetList(workout, exerciseIndex) {
  const item = workout.items[exerciseIndex];
  const name = exerciseName(item.exerciseId);
  return '<ol class="logged-list">' + item.logs.map((set, setIndex) =>
    '<li>' + action('edit-set', '<span>Set ' + (setIndex + 1) + '</span><strong>' + loadLabel(set.weight, set.reps) +
    (set.record ? ' <span class="record-label">PR</span>' : '') + '</strong><span aria-hidden="true">Edit</span>', 'quiet set-row',
      'data-workout="' + escape(workout.id) + '" data-exercise="' + exerciseIndex + '" data-set="' + setIndex +
      '" aria-label="Edit ' + escape(name) + ' set ' + (setIndex + 1) + '"') + '</li>').join('') + '</ol>';
}

function loggedDetails(session) {
  return session.items.map((item, index) => '<section class="journal-exercise"><h3>' +
    escape(exerciseName(item.exerciseId)) + '</h3>' + loggedSetList(session, index) + '</section>').join('');
}

function historyScreen() {
  const trained = state.exercises.filter(exercise => historyFor(state, exercise.id).length);
  if (!trained.some(exercise => exercise.id === selectedLift)) selectedLift = trained[0]?.id ?? '';
  const history = historyFor(state, selectedLift);
  const sessions = [...state.sessions].sort(dateSort);
  const journal = '<section class="panel journal"><div class="spread"><h2>Workouts</h2>' +
    (sessions.length || (state.active && setCount(state.active)) || state.routines.length ?
      action('export-history', icon('share') + ' Export all', 'secondary', 'aria-label="Export all workout data"') : '') + '</div>' +
    (sessions.length ? '<div class="history-rows">' + sessions.map(session =>
      '<details data-session="' + escape(session.id) + '"><summary><div><strong>' + escape(session.name) + '</strong><span class="meta journal-date">' +
      escape(dateLabel(session.day, { month:'short', day:'numeric', year:'numeric' })) + '</span></div><span class="meta">' +
      setCount(session) + ' sets</span></summary>' + loggedDetails(session) +
      action('export-workout', icon('share') + ' Share workout', 'secondary', 'data-id="' + escape(session.id) + '"') +
      '</details>').join('') + '</div>' : '<p class="meta">Completed workouts will appear here.</p>') + '</section>';
  if (!trained.length) return '<header class="page-heading"><h1>History</h1></header><div class="history-layout">' + journal + '</div>';
  return '<header class="page-heading"><h1>History</h1></header><div class="history-layout">' + journal +
    '<section class="panel lifts"><div class="spread"><h2>Lift progress</h2>' + (trained.length ?
      '<select id="select-lift" aria-label="Choose lift">' + trained.map(exercise => '<option value="' + escape(exercise.id) + '"' +
      (exercise.id === selectedLift ? ' selected' : '') + '>' + escape(exercise.name) + '</option>').join('') + '</select>' : '') +
    '</div>' + (history.length ? '<p class="meta">Heaviest set · ' + unit() + ' · Last ' + Math.min(10, history.length) + ' entries</p>' +
      liftChart(history) + '<div class="history-rows">' + [...history].reverse().map(row =>
      '<details data-lift-entry><summary><span>' + escape(dateLabel(row.day, { month:'short', day:'numeric', year:'numeric' })) + '</span>' +
      '<span class="meta">' + row.logs.length + ' sets</span></summary><ol class="set-chips">' +
      row.logs.map(set => '<li>' + loadLabel(set.weight, set.reps) + (set.record ? ' · PR' : '') + '</li>').join('') +
      '</ol></details>').join('') + '</div>' : '') + '</section></div>';
}

function routinesScreen() {
  return '<header class="page-heading spread"><h1>Routines</h1>' +
    action('new-routine', icon('plus') + ' New routine', 'primary') + '</header><div class="split-grid">' +
    (state.routines.length ? state.routines.map((routine, index) => {
      const id = 'data-id="' + escape(routine.id) + '"';
      return '<section class="panel routine"><div class="spread"><span class="eyebrow">Day ' + (index + 1) +
        '</span>' + (routine.id === state.nextId ? pill('Up next') : action('set-next', 'Set as next', 'quiet', id)) +
        '</div><h2>' + escape(routine.name) + '</h2>' + (routine.focus ? '<p class="meta">' + escape(routine.focus) + '</p>' : '') +
        '<ul class="exercise-list">' + routine.items.map(item => '<li><strong>' + escape(exerciseName(item.exerciseId)) +
        (item.oncePerWeek ? '<br><span class="meta">Once every 7 days</span>' : '') +
        '</strong><span class="meta">' + item.sets + ' × ' + item.min + '–' + item.max + '</span></li>').join('') + '</ul>' +
        '<div class="spread routine-actions">' + action('edit-routine', 'Edit routine', 'secondary', id) + '<div class="inline">' +
        action('move-routine', '←', 'quiet', id + ' data-delta="-1" aria-label="Move earlier"' + (index === 0 ? ' disabled' : '')) +
        action('move-routine', '→', 'quiet', id + ' data-delta="1" aria-label="Move later"' + (index === state.routines.length - 1 ? ' disabled' : '')) +
        '</div></div></section>';
    }).join('') : '<div class="panel"><p class="meta">Add a routine to start your split.</p></div>') + '</div>' +
    '<div class="library">' + action('templates', 'Browse templates', 'secondary') + '</div>' +
    '<section class="panel library"><div class="spread"><h2>Exercise library</h2>' +
    action('exercise-editor', icon('plus') + ' New exercise', 'secondary') + '</div><p class="meta">' + state.exercises.length +
    ' exercises · Customize weight increments</p>' + action('library', 'Manage exercises', 'quiet') + '</section>';
}

function render() {
  const screen = route();
  nav.hidden = screen === 'workout';
  nav.innerHTML = [['today', 'Today', 'today'], ['history', 'History', 'progress'], ['routines', 'Routines', 'split']].map(([id, label, glyph]) =>
    '<a href="#' + id + '"' + (id === screen ? ' aria-current="page"' : '') + '>' + icon(glyph) + '<span>' + label + '</span></a>').join('');
  app.innerHTML = ({ today:todayScreen, workout:workoutScreen, history:historyScreen, routines:routinesScreen })[screen]();
  document.body.classList.toggle('logging', Boolean(app.querySelector('.log-dock')));
  tick();
}

function tick() {
  const node = document.querySelector('#rest');
  if (!node) return;
  const seconds = Math.ceil(((state.active?.restUntil ?? 0) - Date.now()) / 1000);
  const text = seconds > 0 ? 'Rest ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') :
    state.active?.restUntil && state.rest ? 'Rest complete' : '';
  if (node.textContent !== text) node.textContent = text;
}

function openDialog(title, body) {
  dialog.innerHTML = '<div class="spread dialog-heading"><h2>' + escape(title) + '</h2>' +
    action('close', '×', 'icon-button', 'aria-label="Close"') + '</div>' + body;
  dialog.querySelector('h2').id = 'dialog-title';
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  if (!dialog.open) dialog.showModal();
  (dialog.querySelector('[autofocus], input:not([type=file]), select') ?? dialog.querySelector('.primary, button'))?.focus();
}

function chooseWorkout() {
  openDialog('Choose workout', '<div class="dialog-list">' + state.routines.map(routine =>
    action('start', '<span>' + escape(routine.name) + '</span><span class="meta">' +
      durationLabel(plannedItems(state, routine)) + '</span>', 'secondary',
      'data-id="' + escape(routine.id) + '"')).join('') + action('start', 'Start empty workout ' + icon('plus'), 'primary') +
      action('templates', 'Browse templates', 'quiet') + '</div>');
}

function templates() {
  openDialog('Workout templates', '<div class="dialog-list">' + workoutTemplates.map(template => {
    const installed = template.routines.every(([id]) => state.routines.some(routine => routine.id === id));
    return action('use-template', '<span><strong>' + escape(template.name) + '</strong><small>' +
      escape(template.description) + '</small></span><span>' + (installed ? 'Added' : icon('plus')) + '</span>',
      'secondary template-choice', 'data-id="' + template.id + '"' + (installed ? ' disabled' : ''));
  }).join('') + '</div>');
}

const options = selected => searchExercises(state.exercises, '').map(exercise => '<option value="' + escape(exercise.id) + '"' +
  (exercise.id === selected ? ' selected' : '') + '>' + escape(exercise.name) + '</option>').join('');
const field = (label, name, value, attrs = '') =>
  '<label>' + label + '<input name="' + name + '" value="' + escape(value) + '" ' + attrs + '></label>';
const submit = label => '<button type="submit" class="button primary">' + label + '</button>';

function pickExercise(mode) {
  openDialog(mode === 'swap' ? 'Swap exercise' : 'Add exercise', '<form data-form="pick" data-mode="' + mode + '">' +
    '<label for="exercise-search">Exercise name</label><input id="exercise-search" type="search" name="query" ' +
    'maxlength="80" autocomplete="off" placeholder="Search or type a new lift">' +
    '<div id="exercise-results" class="dialog-list exercise-results" aria-label="Matching exercises"></div></form>');
  renderExerciseResults();
}

function renderExerciseResults() {
  const input = dialog.querySelector('#exercise-search');
  const query = input.value.trim();
  const normal = query.toLowerCase();
  const matches = searchExercises(state.exercises, query);
  const results = dialog.querySelector('#exercise-results');
  results.innerHTML = matches.map(exercise =>
    action('pick-lift', escape(exercise.name), 'secondary', 'data-id="' + escape(exercise.id) + '"')).join('') +
    (query && !matches.some(exercise => exercise.name.toLowerCase() === normal)
      ? submit('Create “' + escape(query) + '”') : '');
  results.scrollTop = 0;
}

function selectWorkoutExercise(name, id, mode) {
  if (!state.active || (!id && !name)) return;
  if (!update(next => {
    let exercise = id ? next.exercises.find(row => row.id === id) :
      next.exercises.find(row => row.name.toLowerCase() === name.toLowerCase());
    if (!exercise) {
      exercise = { id:uid(), name, increment:2.5 };
      next.exercises.push(exercise);
    }
    addToWorkout(next, exercise.id, mode);
  })) return;
  dialog.close();
  refreshWorkout();
  window.scrollTo(0, 0);
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
  openDialog('Exercise library', '<div class="dialog-list"><label>Search exercises' +
    '<input id="library-search" type="search" autocomplete="off" placeholder="e.g. dumbbell row"></label>' +
    action('exercise-editor', icon('plus') + ' New exercise', 'secondary') +
    '<div id="library-results" class="dialog-list exercise-results" aria-label="Matching exercises"></div></div>');
  renderLibraryResults();
}

function renderLibraryResults() {
  const query = dialog.querySelector('#library-search').value;
  const results = dialog.querySelector('#library-results');
  const matches = searchExercises(state.exercises, query);
  results.innerHTML = matches.length ? matches.map(exercise => action('exercise-editor',
      '<span>' + escape(exercise.name) + '</span><span class="meta">' + weightLabel(exercise.increment) + ' step</span>',
      'secondary', 'data-id="' + escape(exercise.id) + '"')).join('') :
    '<p class="meta" role="status">No matching exercises.</p>';
  results.scrollTop = 0;
}

function editExercise(id, mode) {
  const exercise = exerciseOf(id);
  openDialog(exercise ? 'Edit exercise' : 'New exercise', '<form data-form="exercise" data-id="' + escape(id) +
    '" data-mode="' + escape(mode) + '">' + field('Exercise name', 'name', exercise?.name ?? '', 'maxlength="80" required') +
    field('Weight increment · ' + unit(), 'increment', shownWeight(exercise?.increment ?? 2.5),
      'type="number" inputmode="decimal" min="0" max="' + shownWeight(100) + '" step="' + weightStep() + '" required') +
    '<p class="meta">Use 0 to turn off weight increase suggestions for this lift.</p><p class="form-error" role="alert"></p>' +
    submit(mode ? 'Create and add' : 'Save exercise') + '</form>');
}

function settings() {
  openDialog('Settings', '<form data-form="settings">' +
    '<label>Weight unit<select name="unit"><option value="kg">Kilograms (kg)</option><option value="lb"' +
    (unit() === 'lb' ? ' selected' : '') + '>Pounds (lb)</option></select></label>' +
    field('Rest timer · seconds', 'rest', state.rest, 'type="number" min="0" max="600" required') +
    submit('Save settings') + '</form><hr><div class="dialog-list"><h3>Export and backup</h3>' +
    '<p class="meta">Workouts are saved in this browser. Export a backup to keep a copy or move to another device.</p>' +
    action('export-history', 'Export all workout data', 'secondary') +
    action('export', 'Download restore backup (.json)', 'secondary') +
    '<label class="file-picker">Restore backup<input id="restore-file" type="file" accept=".json,application/json"></label>' +
    (installPrompt ? action('install', 'Install app', 'secondary') : '') + '</div>');
}

function exportBackup() {
  downloadExport('training-log-' + dayKey() + '.json', JSON.stringify(state, null, 2), 'application/json');
}

function downloadExport(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let shareExport;
function exportDialog(session) {
  const title = session ? 'Share workout' : 'Export all workout data';
  const filename = session ? 'workout-' + session.day + '.txt' : 'training-log-' + dayKey() + '.txt';
  const text = workoutExportText(state, session);
  shareExport = { title, filename, text, full:!session };
  openDialog(title, '<div class="dialog-list"><label for="export-preview">Export preview</label>' +
    '<textarea id="export-preview" rows="9" readonly></textarea>' +
    (typeof navigator.share === 'function' ? action('share-export', icon('share') + ' Share', 'primary') : '') +
    action('copy-export', 'Copy text', typeof navigator.share === 'function' ? 'secondary' : 'primary') +
    action('download-export', 'Download text file', 'secondary') +
    (session ? '' : action('export', 'Download restore backup (.json)', 'secondary')) +
    '<p class="meta" id="export-status" role="status"></p></div>');
  dialog.querySelector('#export-preview').value = text;
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

function updateDraft() {
  const form = document.querySelector('#set-form');
  if (!form) return;
  const { weight, reps } = form.elements;
  const valid = weight.validity.valid && reps.validity.valid;
  if (weight.validity.valid) draft.weight = inputWeightInKg(weight.valueAsNumber, unit(), draftDefaultWeight);
  if (reps.validity.valid) draft.reps = reps.valueAsNumber;
  form.querySelector('#log-label').innerHTML = (valid ? 'Log ' + loadLabel(draft.weight, draft.reps) : 'Log set') + icon('check');
}

const actions = {
  settings, library, templates, choose:chooseWorkout,
  'export-workout'({ dataset }) {
    const session = state.sessions.find(row => row.id === dataset.id);
    if (session) exportDialog(session);
  },
  'export-history':() => exportDialog(),
  async 'share-export'() {
    const { title, filename, text, full } = shareExport;
    const status = dialog.querySelector('#export-status');
    try {
      const files = full ? [new File([text], filename, { type:'text/plain' })] : [];
      await navigator.share(files.length && navigator.canShare?.({ files }) ? { title, files } : { title, text });
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Sharing is unavailable. Copy the text or download the file.';
    }
  },
  async 'copy-export'() {
    const preview = dialog.querySelector('#export-preview');
    const status = dialog.querySelector('#export-status');
    try {
      await navigator.clipboard.writeText(shareExport.text);
      status.textContent = 'Copied to clipboard.';
    } catch {
      preview.focus();
      preview.select();
      status.textContent = 'Text selected. Use your device’s Copy command or download the file.';
    }
  },
  'download-export'() {
    downloadExport(shareExport.filename, shareExport.text, 'text/plain;charset=utf-8');
  },
  'use-template'({ dataset }) {
    if (!update(next => addWorkoutTemplate(next, dataset.id))) return;
    dialog.close();
    render();
    notify('Template added to Routines');
  },
  'pick-lift'({ dataset }) {
    const exercise = exerciseOf(dataset.id);
    if (exercise) selectWorkoutExercise(exercise.name, exercise.id, dialog.querySelector('[data-form="pick"]').dataset.mode);
  },
  start({ dataset }) {
    const id = dataset.id;
    if (!update(next => startWorkout(next, next.routines.find(routine => routine.id === id)))) return;
    recap = null;
    draft = null;
    dialog.close();
    go('workout');
    if (!state.active.items.length) pickExercise('add');
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
  'edit-set'({ dataset }) {
    const { workout:workoutId, exercise, set } = dataset;
    const workout = state.active?.id === workoutId ? state.active : state.sessions.find(row => row.id === workoutId);
    const item = workout?.items[Number(exercise)];
    const logged = item?.logs[Number(set)];
    if (!logged) return;
    openDialog('Edit set ' + (Number(set) + 1), '<form data-form="edit-set" data-workout="' + escape(workoutId) +
      '" data-exercise="' + Number(exercise) + '" data-set="' + Number(set) + '"><p class="meta">' +
      escape(exerciseName(item.exerciseId)) + '</p>' +
      field('Weight · ' + unit(), 'weight', shownWeight(logged.weight),
        'type="number" inputmode="decimal" min="0" max="' + shownWeight(9999) + '" step="' + weightStep() + '" required') +
      field('Reps', 'reps', logged.reps, 'type="number" inputmode="numeric" min="1" max="999" step="1" required') +
      submit('Save changes') + '</form>');
  },
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
    if (item.logs.length >= item.sets || (item.skipped && item.logs.length)) {
      const indexAttr = 'data-index="' + index + '"';
      const nextAction = item.logs.length < item.sets
        ? action('resume-exercise', 'Resume exercise', 'primary', indexAttr)
        : item.sets < 99 ? action('complete-extra', 'Add another set', 'primary', indexAttr) : '';
      openDialog(exerciseName(item.exerciseId), loggedSetList(state.active, index) +
        nextAction);
      return;
    }
    actions['resume-exercise']({ dataset });
  },
  'resume-exercise'({ dataset }) {
    const index = Number(dataset.index);
    workoutChange(workout => {
      workout.index = index;
      workout.items[index].skipped = false;
    });
    dialog.close();
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
    if (!importState || !update(next => Object.assign(next, { unit:'kg' }, importState), true)) return;
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
  else if (event.target.id === 'exercise-search') renderExerciseResults();
  else if (event.target.id === 'library-search') renderLibraryResults();
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
  'edit-set'(form, data) {
    const { workout:workoutId, exercise, set } = form.dataset;
    let edited = false;
    if (!update(next => {
      const workout = next.active?.id === workoutId ? next.active : next.sessions.find(row => row.id === workoutId);
      const prior = workout?.items[Number(exercise)]?.logs[Number(set)]?.weight;
      edited = editSet(next, workoutId, Number(exercise), Number(set),
        inputWeightInKg(Number(data.get('weight')), unit(), prior), Number(data.get('reps')));
    }) || !edited) return;
    if (recap) recap = state.sessions.find(row => row.id === recap.id) ?? null;
    dialog.close();
    render();
    const journalEntry = [...app.querySelectorAll('[data-session]')].find(row => row.dataset.session === workoutId);
    if (journalEntry) journalEntry.open = true;
    const editButton = [...app.querySelectorAll('[data-action="edit-set"]')].find(button =>
      button.dataset.workout === workoutId && button.dataset.exercise === exercise && button.dataset.set === set);
    if (editButton) editButton.focus({ preventScroll:true });
    else if (state.active?.id === workoutId) {
      const exerciseButton = app.querySelector('[data-action="jump"][data-index="' + Number(exercise) + '"]');
      if (exerciseButton) actions.jump(exerciseButton);
    }
    notify('Set updated');
  },
  pick(form, data) {
    const name = data.get('query').trim();
    selectWorkoutExercise(name, null, form.dataset.mode);
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
      const index = next.routines.findIndex(routine => routine.id === id);
      const previous = next.routines[index];
      const items = rows.map(({ exerciseId, exerciseName, sets, min, max }) => {
        if (exerciseName) {
          let exercise = next.exercises.find(row => row.name.toLowerCase() === exerciseName.toLowerCase());
          if (!exercise) {
            exercise = { id:uid(), name:exerciseName, increment:2.5 };
            next.exercises.push(exercise);
          }
          exerciseId = exercise.id;
        }
        const oncePerWeek = previous?.items.some(item => item.exerciseId === exerciseId && item.oncePerWeek);
        return { exerciseId, sets, min, max, ...(oncePerWeek ? { oncePerWeek:true } : {}) };
      });
      const routine = { ...previous, id, name, focus, items };
      if (index >= 0) next.routines[index] = routine;
      else next.routines.push(routine);
      next.nextId ??= id;
    })) return;
    if (recap && route() === 'workout' && !form.dataset.id) savedRecapRoutine = recap.id;
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
      const index = next.exercises.findIndex(row => row.id === id);
      const prior = next.exercises[index]?.increment ?? 2.5;
      const increment = Math.min(100, inputWeightInKg(Number(data.get('increment')), unit(), prior));
      const exercise = { id, name, increment };
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
    if (!update(next => {
      next.rest = Number(data.get('rest'));
      next.unit = data.get('unit');
    })) return;
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
  if (!update(next => {
    saved = logSet(next, inputWeightInKg(Number(data.get('weight')), unit(), draftDefaultWeight), Number(data.get('reps')));
  }) || !saved) return;
  refreshWorkout();
  if (saved.record) {
    navigator.vibrate?.(35);
    notify('New personal best · ' + loadLabel(saved.weight, saved.reps));
  }
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
    state = initializeLibrary(next);
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
