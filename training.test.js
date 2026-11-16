import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, startWorkout, logSet, undoSet, finishWorkout, setDefaults, coach, validBackup, addDefaultForearms, plannedItems } from './training.js';

test('undo restores a just-completed exercise and its prior rest timer', () => {
  const state = initialState();
  const workout = startWorkout(state, state.routines[0], '2026-11-16', 1000);
  logSet(state, 60, 10, 2000);
  logSet(state, 60, 9, 3000);
  logSet(state, 60, 8, 4000);
  assert.equal(workout.index, 1);
  undoSet(workout);
  assert.equal(workout.index, 0);
  assert.equal(workout.restUntil, 93000);
  assert.deepEqual(workout.items[0].logs.map(set => set.reps), [10, 9]);
  assert.equal(validBackup(JSON.parse(JSON.stringify(state))), true);
});

test('matched sets keep different rep counts, and only a finished split day advances the rotation', () => {
  const state = initialState();
  startWorkout(state, state.routines[0], '2026-11-16', 1000);
  assert.equal(finishWorkout(state, 1001), null);
  assert.equal(state.nextId, state.routines[0].id);
  logSet(state, 60, 10, 2000);
  logSet(state, 60, 9, 3000);
  finishWorkout(state, 4000);
  assert.equal(state.nextId, state.routines[1].id);
  const workout = startWorkout(state, state.routines[0], '2026-11-17', 5000);
  assert.equal(setDefaults(state, workout.items[0]).reps, 10);
  assert.equal(logSet(state, 60, 10, 6000).record, false);
  assert.equal(setDefaults(state, workout.items[0]).reps, 9);
});

test('coaching applies the selected increment after all targets are met', () => {
  const state = initialState();
  const workout = startWorkout(state, state.routines[0], '2026-11-16', 1000);
  for (let i = 0; i < 3; i++) logSet(state, 60, 10, 2000 + i);
  assert.equal(logSet(state, NaN, 8, 3000), null);
  finishWorkout(state, 4000);
  assert.match(coach(state, workout.items[0]), /62\.5 kg/);
  state.exercises[0].increment = 5;
  assert.match(coach(state, workout.items[0]), /65 kg/);
});

test('backups reject invalid dates and dangling exercise references', () => {
  const state = initialState();
  startWorkout(state, state.routines[0], '2026-02-30', 1000);
  assert.equal(validBackup(state), false);
  state.active = null;
  assert.equal(validBackup(state), true);
  state.routines[0].items[0].exerciseId = 'missing';
  assert.equal(validBackup(state), false);
});

test('saved Back & Biceps routines get forearms once, and a logged lift returns after seven days', () => {
  const state = initialState();
  const routine = state.routines[1];
  const [curls, reverse, rotation] = routine.items.splice(3);
  delete routine.forearmsAdded;
  const exerciseCount = state.exercises.length;
  addDefaultForearms(state);
  addDefaultForearms(state);
  assert.deepEqual(routine.items.slice(3), [curls, reverse, rotation]);
  assert.equal(state.exercises.length, exerciseCount);
  assert.equal(validBackup(state), true);
  const workout = startWorkout(state, routine, '2026-11-16', 1000);
  workout.index = 3;
  logSet(state, 2, 14, 2000);
  finishWorkout(state, 3000);
  const includesCurls = day => plannedItems(state, routine, day).some(item => item.exerciseId === curls.exerciseId);
  assert.equal(includesCurls('2026-11-22'), false);
  assert.equal(includesCurls('2026-11-23'), true);
});
