import type { PNG } from 'pngjs';
import type { Box } from '../types.js';

const CELL_SIZE = 16;

function isRedPixel(data: Buffer | Uint8Array, idx: number): boolean {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const a = data[idx + 3];
  return a > 50 && r > 180 && g < 100 && b < 100;
}

interface ClusterComponent {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelCount: number;
}

/**
 * Returns bounding boxes of connected red-pixel regions on a 16px grid, largest first.
 *
 * @param diff - PNG diff image
 * @param max - Maximum number of clusters to return (default: 3)
 */
export function diffClusters(diff: PNG, max = 3): Box[] {
  if (diff.width <= 0 || diff.height <= 0 || max <= 0) {
    return [];
  }

  const cols = Math.ceil(diff.width / CELL_SIZE);
  const rows = Math.ceil(diff.height / CELL_SIZE);
  const cellRedCount = new Int32Array(cols * rows);

  for (let gy = 0; gy < rows; gy++) {
    const y0 = gy * CELL_SIZE;
    const y1 = Math.min(diff.height, (gy + 1) * CELL_SIZE);

    for (let gx = 0; gx < cols; gx++) {
      const x0 = gx * CELL_SIZE;
      const x1 = Math.min(diff.width, (gx + 1) * CELL_SIZE);
      let count = 0;

      for (let y = y0; y < y1; y++) {
        let idx = (diff.width * y + x0) << 2;
        for (let x = x0; x < x1; x++) {
          if (isRedPixel(diff.data, idx)) {
            count++;
          }
          idx += 4;
        }
      }

      cellRedCount[gy * cols + gx] = count;
    }
  }

  const visited = new Uint8Array(cols * rows);
  const clusters: ClusterComponent[] = [];

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const index = gy * cols + gx;
      if (visited[index] || cellRedCount[index] === 0) {
        continue;
      }

      // BFS for connected active cells (8-way connected)
      visited[index] = 1;
      const queue: Array<[number, number]> = [[gx, gy]];
      let minGx = gx;
      let maxGx = gx;
      let minGy = gy;
      let maxGy = gy;
      let pixelCount = 0;

      while (queue.length > 0) {
        const [currGx, currGy] = queue.shift()!;
        minGx = Math.min(minGx, currGx);
        maxGx = Math.max(maxGx, currGx);
        minGy = Math.min(minGy, currGy);
        maxGy = Math.max(maxGy, currGy);
        pixelCount += cellRedCount[currGy * cols + currGx];

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = currGx + dx;
            const ny = currGy + dy;
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
              const nIndex = ny * cols + nx;
              if (!visited[nIndex] && cellRedCount[nIndex] > 0) {
                visited[nIndex] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }
      }

      const x = minGx * CELL_SIZE;
      const y = minGy * CELL_SIZE;
      const width = Math.min(diff.width, (maxGx + 1) * CELL_SIZE) - x;
      const height = Math.min(diff.height, (maxGy + 1) * CELL_SIZE) - y;

      clusters.push({
        x,
        y,
        width,
        height,
        pixelCount
      });
    }
  }

  // Sort largest first (by area, then by pixel count)
  clusters.sort((a, b) => b.width * b.height - a.width * a.height || b.pixelCount - a.pixelCount);

  return clusters.slice(0, max).map(({ x, y, width, height }) => ({ x, y, width, height }));
}
