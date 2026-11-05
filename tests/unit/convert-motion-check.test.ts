import assert from 'node:assert/strict';
import test from 'node:test';
import { movedTowards } from '../../src/convert/verify/motion-check.js';
import type { AnimationEntry } from '../../src/convert/types.js';

test('opacity 0→1 recorded, before 0 / after 0.9 → true; after 0.1 → false', () => {
  const entry: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { opacity: '0' },
    to: { opacity: '1' }
  };

  assert.equal(
    movedTowards(entry, { opacity: '0' }, { opacity: '0.9' }),
    true,
    'after 0.9 is 90% closer, should pass (> 25%)'
  );

  assert.equal(
    movedTowards(entry, { opacity: '0' }, { opacity: '0.1' }),
    false,
    'after 0.1 is only 10% closer, should fail (< 25%)'
  );
});

test('rotation -10°→0° with before -10 / after -2 → true; after -9 → false', () => {
  // Test with transform matrix
  // -10 deg: matrix(0.984808, -0.173648, 0.173648, 0.984808, 0, 0)
  // -2 deg: matrix(0.999391, -0.034899, 0.034899, 0.999391, 0, 0)
  // -9 deg: matrix(0.987688, -0.156434, 0.156434, 0.987688, 0, 0)
  const matrixFrom = 'matrix(0.984808, -0.173648, 0.173648, 0.984808, 0, 0)';
  const matrixTo = 'none';

  const entry: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { transform: matrixFrom },
    to: { transform: matrixTo }
  };

  assert.equal(
    movedTowards(
      entry,
      { transform: matrixFrom },
      { transform: 'matrix(0.999391, -0.034899, 0.034899, 0.999391, 0, 0)' }
    ),
    true,
    'rotated -2 deg from -10 deg towards 0 deg is 80% closer (> 25%)'
  );

  assert.equal(
    movedTowards(
      entry,
      { transform: matrixFrom },
      { transform: 'matrix(0.987688, -0.156434, 0.156434, 0.987688, 0, 0)' }
    ),
    false,
    'rotated -9 deg from -10 deg towards 0 deg is only 10% closer (< 25%)'
  );

  // Also support direct rotate property in degrees
  const rotateEntry: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { rotate: '-10' },
    to: { rotate: '0' }
  };
  assert.equal(
    movedTowards(rotateEntry, { rotate: '-10' }, { rotate: '-2' }),
    true,
    'direct rotate property -10 -> -2 towards 0 should pass'
  );
  assert.equal(
    movedTowards(rotateEntry, { rotate: '-10deg' }, { rotate: '-9deg' }),
    false,
    'direct rotate property -10deg -> -9deg towards 0deg should fail'
  );
});

test('property with largest recorded change is selected', () => {
  // y change is 50 (|0 - 50| = 50), opacity change is 1 (|1 - 0| = 1)
  const entry: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { opacity: '0', transform: 'matrix(1, 0, 0, 1, 0, 50)' },
    to: { opacity: '1', transform: 'none' }
  };

  // y moved from 50 to 10 (80% closer) -> true
  assert.equal(
    movedTowards(
      entry,
      { opacity: '0', transform: 'matrix(1, 0, 0, 1, 0, 50)' },
      { opacity: '0.1', transform: 'matrix(1, 0, 0, 1, 0, 10)' }
    ),
    true
  );

  // y moved from 50 to 45 (10% closer), even though opacity moved 0.9 closer -> should fail because y is largest change
  assert.equal(
    movedTowards(
      entry,
      { opacity: '0', transform: 'matrix(1, 0, 0, 1, 0, 50)' },
      { opacity: '0.9', transform: 'matrix(1, 0, 0, 1, 0, 45)' }
    ),
    false
  );
});

test('scale components decompose and evaluate correctly', () => {
  // scale 0.8 -> 1.0 (delta = 0.2)
  const entry: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { transform: 'matrix(0.8, 0, 0, 0.8, 0, 0)' },
    to: { transform: 'none' }
  };

  // scale reached 0.96 (80% closer) -> true
  assert.equal(
    movedTowards(
      entry,
      { transform: 'matrix(0.8, 0, 0, 0.8, 0, 0)' },
      { transform: 'matrix(0.96, 0, 0, 0.96, 0, 0)' }
    ),
    true
  );

  // scale reached 0.82 (10% closer) -> false
  assert.equal(
    movedTowards(
      entry,
      { transform: 'matrix(0.8, 0, 0, 0.8, 0, 0)' },
      { transform: 'matrix(0.82, 0, 0, 0.82, 0, 0)' }
    ),
    false
  );
});

test('movement in the wrong direction returns false', () => {
  const entry: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { opacity: '0.5' },
    to: { opacity: '1' }
  };

  // before is 0.5, after is 0.2 (further from 1)
  assert.equal(
    movedTowards(entry, { opacity: '0.5' }, { opacity: '0.2' }),
    false
  );
});

test('identical from and to or missing property returns false', () => {
  const identical: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { opacity: '1' },
    to: { opacity: '1' }
  };
  assert.equal(
    movedTowards(identical, { opacity: '1' }, { opacity: '1' }),
    false
  );

  const missing: Pick<AnimationEntry, 'from' | 'to'> = {
    from: { opacity: '0' },
    to: { opacity: '1' }
  };
  assert.equal(
    movedTowards(missing, {}, {}),
    false
  );
});
