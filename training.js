const starter = [
  ['default-chest-triceps', 'Chest & Triceps', 'Chest · Triceps', [
    ['Bench Press', 3, 7, 10], ['Incline Dumbbell Press', 3, 7, 10],
    ['Pec Deck Fly', 3, 7, 10], ['Triceps Cable Pushdown', 4, 7, 10, 'Cable Pushdown'],
  ]],
  ['default-back-biceps', 'Back & Biceps', 'Back · Biceps', [
    ['Lat Pulldown', 4, 8, 12], ['Single-Arm Dumbbell Row', 3, 8, 12], ['Dumbbell Curl', 4, 8, 12],
  ]],
  ['default-shoulders', 'Shoulders', 'Front · Side · Rear delts', [
    ['Shoulder Press', 4, 8, 12], ['Lateral Raise', 3, 8, 12],
    ['Reverse Fly', 2, 8, 12], ['Face Pull', 2, 8, 12],
  ]],
];

const forearms = [
  ['default-wrist-curl', 'Wrist Curls', 2, 12, 20],
  ['default-reverse-wrist-curl', 'Reverse Wrist Curls', 2, 12, 20],
  ['default-wrist-rotation', 'Wrist Rotations', 1, 10, 15],
];

export const uid = () => globalThis.crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2);
export const dayKey = (date = new Date()) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(n => String(n).padStart(2, '0')).join('-');
export const fromDay = day => new Date(day + 'T12:00:00');
export const blankExercise = exerciseId => ({ exerciseId, sets:3, min:8, max:12, logs:[] });

export function hasDefaultSplit(state) {
  return starter.every(([id]) => state.routines.some(routine => routine.id === id));
}

export function addDefaultSplit(state) {
  for (const [id, name, focus, rows] of starter) {
    if (state.routines.some(routine => routine.id === id)) continue;
    const items = rows.map(([exerciseName, sets, min, max, legacyName]) => {
      const names = [exerciseName, legacyName].filter(Boolean).map(value => value.toLowerCase());
      let exercise = state.exercises.find(row => names.includes(row.name.toLowerCase()));
      if (!exercise) {
        exercise = { id:uid(), name:exerciseName, increment:2.5 };
        state.exercises.push(exercise);
      }
      return { exerciseId:exercise.id, sets, min, max };
    });
    state.routines.push({ id, name, focus, items });
    state.nextId ??= id;
  }
  addDefaultForearms(state);
}

export function addDefaultForearms(state) {
  const routine = state.routines.find(row => row.id === 'default-back-biceps');
  if (!routine || routine.forearmsAdded) return state;
  for (const [id, name, sets, min, max] of forearms) {
    let exercise = state.exercises.find(row => row.name.toLowerCase() === name.toLowerCase());
    if (!exercise) {
      let exerciseId = id;
      for (let suffix = 2; state.exercises.some(row => row.id === exerciseId); suffix++) {
        exerciseId = id + '-' + suffix;
      }
      exercise = { id:exerciseId, name, increment:0.5 };
      state.exercises.push(exercise);
    }
    const existing = routine.items.find(row => row.exerciseId === exercise.id);
    if (existing) existing.oncePerWeek = true;
    else routine.items.push({ exerciseId:exercise.id, sets, min, max, oncePerWeek:true });
  }
  routine.forearmsAdded = true;
  return state;
}

export function initialState() {
  const state = { version:1, exercises:[], routines:[], sessions:[], active:null, rest:90, nextId:null };
  addDefaultSplit(state);
  return state;
}

export function plannedItems(state, routine, day = dayKey()) {
  const cutoff = fromDay(day);
  cutoff.setDate(cutoff.getDate() - 6);
  const firstDay = dayKey(cutoff);
  return (routine?.items ?? []).filter(item => !item.oncePerWeek ||
    !state.sessions.some(session => session.day >= firstDay && session.day <= day &&
      session.items.some(previous => previous.exerciseId === item.exerciseId && previous.logs.length)));
}

export function estimateWorkoutMinutes(items, restSeconds) {
  const setsPerExercise = items.map(item => item.skipped ? item.logs.length : item.sets)
    .filter(sets => sets > 0);
  const totalSets = setsPerExercise.reduce((sum, sets) => sum + sets, 0);
  if (!totalSets) return 0;
  const lifting = totalSets * 45;
  const resting = (totalSets - 1) * restSeconds;
  const switching = (setsPerExercise.length - 1) * 60;
  return Math.ceil((lifting + resting + switching) / 60);
}

export function startWorkout(state, routine, day = dayKey(), now = Date.now()) {
  if (state.active) return state.active;
  return state.active = {
    id:uid(), routineId:routine?.id ?? null, name:routine?.name ?? 'Freestyle',
    day, started:now, items:plannedItems(state, routine, day).map(item => ({ ...item, logs:[] })),
    index:0, restUntil:0, undo:null,
  };
}

export function historyFor(state, id) {
  return state.sessions.flatMap(session => session.items.filter(item => item.exerciseId === id && item.logs.length)
    .map(item => ({ day:session.day, logs:item.logs })));
}

export function setDefaults(state, item) {
  const last = historyFor(state, item.exerciseId).at(-1)?.logs ?? [];
  const set = last[item.logs.length];
  const fallback = item.logs.at(-1) ?? last.at(-1);
  return { weight:set?.weight ?? fallback?.weight ?? 0, reps:set?.reps ?? item.min, last:set };
}

export function coach(state, item) {
  const logs = historyFor(state, item.exerciseId).at(-1)?.logs;
  if (!logs?.length) return '';
  const weight = logs[0].weight;
  const increment = state.exercises.find(exercise => exercise.id === item.exerciseId)?.increment ?? 0;
  if (weight > 0 && increment > 0 && logs.length >= item.sets &&
      logs.slice(0, item.sets).every(set => set.weight === weight && set.reps >= item.max)) {
    return 'You hit ' + item.max + ' across ' + item.sets + ' sets. Try ' + rounded(weight + increment) + ' kg today.';
  }
  return 'Aim for ' + item.min + '–' + item.max + ' reps. Match or beat your last session.';
}

export const rounded = value => Math.round(value * 100) / 100;
const hasSets = item => !item.skipped && item.logs.length < item.sets;

export function moveNext(workout) {
  const index = workout.items.findIndex((item, index) => index > workout.index && hasSets(item));
  const wrap = workout.items.findIndex(hasSets);
  workout.index = index >= 0 ? index : wrap >= 0 ? wrap : workout.items.length;
}

export function logSet(state, weight, reps, now = Date.now()) {
  const workout = state.active;
  const item = workout?.items[workout.index];
  if (!item || !hasSets(item) || !Number.isFinite(weight) || weight < 0 || weight > 9999 ||
      !Number.isInteger(reps) || reps < 1 || reps > 999) return null;
  weight = rounded(weight);
  const previous = historyFor(state, item.exerciseId).flatMap(row => row.logs)
    .concat(workout.items.filter(row => row.exerciseId === item.exerciseId).flatMap(row => row.logs));
  const record = previous.length > 0 && previous.every(set =>
    weight > set.weight || (weight === set.weight && reps > set.reps));
  const set = { weight, reps, record };
  workout.undo = { index:workout.index, restUntil:workout.restUntil };
  item.logs.push(set);
  workout.restUntil = now + state.rest * 1000;
  if (item.logs.length >= item.sets) moveNext(workout);
  return set;
}

export function undoSet(workout) {
  const undo = workout.undo;
  if (!undo) return;
  workout.items[undo.index].logs.pop();
  Object.assign(workout, { index:undo.index, restUntil:undo.restUntil, undo:null });
}

export const setCount = workout => workout.items.reduce((count, item) => count + item.logs.length, 0);
export const volume = workout => rounded(workout.items.reduce((sum, item) =>
  sum + item.logs.reduce((load, set) => load + set.weight * set.reps, 0), 0));

export function finishWorkout(state, now = Date.now()) {
  const workout = state.active;
  if (!workout || !setCount(workout)) return null;
  const { id, name, routineId, day, started, items } = workout;
  const session = { id, name, routineId, day, started, ended:Math.max(started, now), items:items.filter(item => item.logs.length) };
  state.sessions.push(session);
  const index = state.routines.findIndex(routine => routine.id === routineId);
  if (index >= 0) state.nextId = state.routines[(index + 1) % state.routines.length].id;
  state.active = null;
  return session;
}

export function validBackup(state) {
  const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);
  const string = (value, max = 100) => typeof value === 'string' && value.length > 0 && value.length <= max;
  const time = value => integer(value, 0, 8640000000000000);
  const list = (value, validate) => Array.isArray(value) && value.every(validate);
  const uniqueIds = rows => new Set(rows.map(row => row.id)).size === rows.length;
  if (state?.version !== 1 || !integer(state.rest, 0, 600) ||
      !list(state.exercises, exercise => exercise && string(exercise.id) && string(exercise.name) &&
        number(exercise.increment, 0, 100)) || !uniqueIds(state.exercises)) return false;
  const ids = new Set(state.exercises.map(exercise => exercise.id));
  const item = row => row && ids.has(row.exerciseId) && integer(row.sets, 1, 99) &&
    integer(row.min, 1, 999) && integer(row.max, row.min, 999) &&
    (row.oncePerWeek === undefined || typeof row.oncePerWeek === 'boolean');
  const logged = row => item(row) && (row.skipped === undefined || typeof row.skipped === 'boolean') &&
    list(row.logs, set => set && number(set.weight, 0, 9999) && integer(set.reps, 1, 999) &&
      typeof set.record === 'boolean') && row.logs.length <= row.sets;
  const session = row => row && string(row.id) && string(row.name) &&
    (row.routineId === null || string(row.routineId)) && typeof row.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.day) && Number.isFinite(+fromDay(row.day)) &&
    dayKey(fromDay(row.day)) === row.day && time(row.started) && list(row.items, logged);
  if (!list(state.routines, row => row && string(row.id) && string(row.name) &&
      typeof row.focus === 'string' && row.focus.length <= 100 && list(row.items, item) &&
      (row.forearmsAdded === undefined || typeof row.forearmsAdded === 'boolean')) ||
      !uniqueIds(state.routines) || !list(state.sessions, row => session(row) && time(row.ended) &&
        row.ended >= row.started && setCount(row) > 0) || !uniqueIds(state.sessions) ||
      (state.nextId !== null && !state.routines.some(row => row.id === state.nextId))) return false;
  const active = state.active;
  return active === null || (session(active) && !state.sessions.some(row => row.id === active.id) &&
    integer(active.index, 0, active.items.length) && time(active.restUntil) &&
    (active.undo === null || (active.undo && integer(active.undo.index, 0, active.items.length - 1) &&
      active.items[active.undo.index].logs.length > 0 && time(active.undo.restUntil))));
}
