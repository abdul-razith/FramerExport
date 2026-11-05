import assert from 'node:assert/strict';
import test from 'node:test';
import { decomposeTransform, describeMotion } from '../../src/convert/tasks/motion-values.js';
import type { AnimationEntry } from '../../src/convert/types.js';

test('rotation matrix', () => {
  assert.deepEqual(decomposeTransform('matrix(0.984808, -0.173648, 0.173648, 0.984808, 0, 0)'), {
    x: 0,
    y: 0,
    rotate: -10,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
  });
});

test('none is identity', () => {
  assert.deepEqual(decomposeTransform('none'), {
    x: 0,
    y: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
  });
  assert.deepEqual(decomposeTransform(' none '), {
    x: 0,
    y: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
  });
});

test('scale-to-zero matrix (0,0,0,0,0,0) decomposes to scale 0', () => {
  assert.deepEqual(decomposeTransform('matrix(0, 0, 0, 0, 0, 0)'), {
    x: 0,
    y: 0,
    rotate: 0,
    scaleX: 0,
    scaleY: 0,
    skewX: 0,
  });
});

test('translation matrix decomposes x and y with rounding', () => {
  assert.deepEqual(decomposeTransform('matrix(1, 0, 0, 1, 10.567, -25.892)'), {
    x: 10.57,
    y: -25.89,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
  });
});

test('scale and skew matrix decomposes correctly', () => {
  // skewX of 30deg: tan(30deg) = 0.57735, matrix(2, 0, 2*tan(30), 3, 5, 10) -> matrix(2, 0, 1.1547, 3, 5, 10)
  assert.deepEqual(decomposeTransform('matrix(2, 0, 1.1547, 3, 5, 10)'), {
    x: 5,
    y: 10,
    rotate: 0,
    scaleX: 2,
    scaleY: 3,
    skewX: 30,
  });
});

test('negative scale (reflection/flip) preserves sign in scaleY', () => {
  assert.deepEqual(decomposeTransform('matrix(1, 0, 0, -1, 0, 0)'), {
    x: 0,
    y: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: -1,
    skewX: 0,
  });
});

test('matrix format variations and whitespace', () => {
  assert.deepEqual(decomposeTransform('matrix(1 0 0 1 0 0)'), {
    x: 0,
    y: 0,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
  });
  assert.deepEqual(decomposeTransform('  matrix(  1 ,  0 , 0 , 1 ,  15 , -20 ) '), {
    x: 15,
    y: -20,
    rotate: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
  });
});

test('invalid transform returns null', () => {
  assert.equal(decomposeTransform(''), null);
  assert.equal(decomposeTransform('translate(10px)'), null);
  assert.equal(decomposeTransform('matrix(1, 2)'), null);
  assert.equal(decomposeTransform('matrix(a, b, c, d, e, f)'), null);
  assert.equal(decomposeTransform('rotate(45deg)'), null);
});

test('describeMotion lists only changed parts', () => {
  assert.equal(
    describeMotion({
      route: '/',
      selector: 's',
      trigger: 'scroll',
      durationMs: 1287,
      confidence: 'high',
      from: { opacity: '0', transform: 'matrix(0.8, 0, 0, 0.8, 0, 20)' },
      to: { opacity: '1', transform: 'none' },
    }),
    'scroll, 1.3 s: opacity 0→1, scale 0.8→1, y 20px→0'
  );
});

test('describeMotion appends low confidence suffix when confidence is low', () => {
  assert.equal(
    describeMotion({
      route: '/',
      selector: 's',
      trigger: 'scroll',
      durationMs: 1287,
      confidence: 'low',
      from: { opacity: '0', transform: 'matrix(0.8, 0, 0, 0.8, 0, 20)' },
      to: { opacity: '1', transform: 'none' },
    }),
    'scroll, 1.3 s: opacity 0→1, scale 0.8→1, y 20px→0, low confidence'
  );
});

test('describeMotion handles non-uniform scale, rotate, skew, and x', () => {
  const entry: AnimationEntry = {
    route: '/about',
    selector: '.box',
    trigger: 'hover',
    durationMs: 400,
    confidence: 'high',
    from: {
      transform: 'matrix(1, 0, 0, 1, 0, 0)',
    },
    to: {
      // scaleX 1.2, scaleY 1.5, rotate 45deg, x 10px
      // 45deg: c=s=0.7071. scaleX=1.2 => a=1.2*0.7071=0.8485, b=1.2*0.7071=0.8485
      // scaleY=1.5 => c=-1.5*0.7071=-1.0607, d=1.5*0.7071=1.0607
      // x=10, y=0
      transform: 'matrix(0.8485, 0.8485, -1.0607, 1.0607, 10, 0)',
    },
  };
  assert.equal(
    describeMotion(entry),
    'hover, 0.4 s: scaleX 1→1.2, scaleY 1→1.5, rotate 0→45deg, x 0→10px'
  );
});

test('describeMotion without durationMs (e.g. loop or omitted)', () => {
  assert.equal(
    describeMotion({
      route: '/',
      selector: '.spinner',
      trigger: 'loop',
      confidence: 'high',
      from: { transform: 'matrix(1, 0, 0, 1, 0, 0)' },
      to: { transform: 'matrix(-1, 0, 0, -1, 0, 0)' }, // 180 deg rotation
    }),
    'loop: rotate 0→180deg'
  );
});

test('describeMotion with opacity only and delayMs', () => {
  assert.equal(
    describeMotion({
      route: '/',
      selector: '.fade',
      trigger: 'appear',
      durationMs: 800,
      delayMs: 200,
      confidence: 'high',
      from: { opacity: '0' },
      to: { opacity: '1' },
    }),
    'appear, 0.8 s, delay 0.2 s: opacity 0→1'
  );
});

test('describeMotion with other CSS properties like filter', () => {
  assert.equal(
    describeMotion({
      route: '/',
      selector: '.blur',
      trigger: 'hover',
      durationMs: 300,
      confidence: 'high',
      from: { filter: 'blur(10px)' },
      to: { filter: 'blur(0px)' },
    }),
    'hover, 0.3 s: filter blur(10px)→blur(0px)'
  );
});

test('describeMotion when no components changed', () => {
  assert.equal(
    describeMotion({
      route: '/',
      selector: '.static',
      trigger: 'appear',
      durationMs: 500,
      confidence: 'high',
      from: { opacity: '1', transform: 'none' },
      to: { opacity: '1', transform: 'none' },
    }),
    'appear, 0.5 s: none'
  );
});
