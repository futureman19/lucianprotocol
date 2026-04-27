import assert from 'node:assert/strict';
import test from 'node:test';

import type { Entity } from '../src/types';
import {
  computeCityLayout,
  getDistrictAtTile,
  getRoadTileKeys,
  isWaterTile,
  type CityLayout,
  type RoadSegment,
} from './city-layout';

function createFileEntity(
  id: string,
  x: number,
  y: number,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    type: 'file',
    x,
    y,
    z: 0,
    mass: 1,
    tick_updated: 0,
    name: `${id}.ts`,
    path: `src/${id}.ts`,
    extension: '.ts',
    ...overrides,
  };
}

test('computeCityLayout keeps roads on grid-aligned local runs', () => {
  const layout = computeCityLayout([
    createFileEntity('alpha', 1, 1),
    createFileEntity('beta', 3, 1),
    createFileEntity('gamma', 10, 1),
    createFileEntity('delta', 10, 4),
  ]);

  assert.ok(
    layout.roads.some((road) =>
      road.fromX === 1.5 &&
      road.toX === 3.5 &&
      road.fromY === 1.5 &&
      road.toY === 1.5),
  );

  assert.ok(
    layout.roads.some((road) =>
      road.fromX === 10.5 &&
      road.toX === 10.5 &&
      road.fromY === 1.5 &&
      road.toY === 4.5),
  );

  assert.ok(
    !layout.roads.some((road) =>
      road.fromY === 1.5 &&
      road.toY === 1.5 &&
      road.fromX === 1.5 &&
      road.toX === 10.5),
  );
});

test('computeCityLayout reserves harbor water on a truly empty edge', () => {
  const entities = [
    createFileEntity('alpha', 5, 5),
    createFileEntity('beta', 6, 5),
    createFileEntity('gamma', 7, 7),
  ];
  const layout = computeCityLayout(entities);

  assert.ok(layout.water);
  assert.equal(layout.water?.side, 'east');
  assert.equal(layout.water?.minX, 8);

  for (const entity of entities) {
    assert.equal(
      isWaterTile(layout, entity.x, entity.y),
      false,
      `structure tile ${entity.x},${entity.y} should stay on land`,
    );
  }
});

test('district priority and road tiles are deterministic on the grid', () => {
  const roadTiles = getRoadTileKeys([
    {
      fromX: 2.5,
      fromY: 1.5,
      toX: 4.5,
      toY: 1.5,
      name: 'Main Street',
      width: 0.5,
      trafficDensity: 0.6,
    } satisfies RoadSegment,
  ]);

  assert.deepEqual([...roadTiles].sort(), ['2,1', '3,1', '4,1']);

  const layout: CityLayout = {
    districts: [
      {
        type: 'suburb',
        x: 10.5,
        y: 10.5,
        radius: 8,
        name: 'Suburbs',
        color: 'rgba(60, 100, 60, 0.1)',
      },
      {
        type: 'park',
        x: 10.5,
        y: 10.5,
        radius: 3,
        name: 'Central Park',
        color: 'rgba(40, 100, 40, 0.15)',
      },
    ],
    roads: [],
    downtownCenter: { x: 10.5, y: 10.5 },
    water: null,
  };

  assert.equal(getDistrictAtTile(layout, 10, 10)?.type, 'park');
});
