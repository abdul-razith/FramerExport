import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseExistingDevServer } from '../../src/convert/verify/dev-server.js';

const NEXT_OUTPUT = `
 ⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
⨯ Another next dev server is already running.

- Local:        http://127.0.0.1:58482
- PID:          11584
- Dir:          D:/x/portfolio-next
- Log:          .next/dev/logs/next-development.log

You can access the existing server at http://127.0.0.1:58482,
or run taskkill /PID 11584 /F to stop it and start a new one.
`;

test('parseExistingDevServer reads the port and pid Next prints when another dev server owns the project', () => {
  assert.deepEqual(parseExistingDevServer(NEXT_OUTPUT), { port: 58482, pid: 11584 });
});

test('parseExistingDevServer returns null for any other output', () => {
  assert.equal(parseExistingDevServer('✓ Ready in 1299ms'), null);
  assert.equal(parseExistingDevServer(''), null);
  assert.equal(parseExistingDevServer('Another next dev server is already running.'), null);
});
