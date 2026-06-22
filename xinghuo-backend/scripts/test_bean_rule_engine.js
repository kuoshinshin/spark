const assert = require('assert');
const {
  calcTail,
  groupPlayersByPriority,
  calcBeans,
  buildSettlement,
} = require('../services/beanRuleEngine');

function run() {
  assert.strictEqual(calcTail(123.4), 3);
  assert.strictEqual(calcTail(129.6), 10);
  assert.strictEqual(calcTail(0), 10);

  const players = [
    { userId: 1, tail: 3, seatNo: 1 },
    { userId: 2, tail: 3, seatNo: 2 },
    { userId: 3, tail: 8, seatNo: 3 },
    { userId: 4, tail: 9, seatNo: 4 },
  ];
  const grouped = groupPlayersByPriority(players, 1);
  assert.strictEqual(grouped.ok, true);
  assert.strictEqual(grouped.strategy, 'same');

  const bean = calcBeans(
    [{ userId: 1, kills: 8, winPlace: 1 }, { userId: 2, kills: 0, winPlace: 1 }],
    [{ userId: 3, kills: 3, winPlace: 2 }, { userId: 4, kills: 0, winPlace: 2 }]
  );
  assert.strictEqual(bean.beanBase, 5);
  assert.strictEqual(bean.multiplied, true);
  assert.strictEqual(bean.beanTotal, 10);

  const settled = buildSettlement([
    { userId: 1, seatNo: 1, damage: 101.6, kills: 6, winPlace: 1 },
    { userId: 2, seatNo: 2, damage: 201.4, kills: 2, winPlace: 1 },
    { userId: 3, seatNo: 3, damage: 115.2, kills: 2, winPlace: 2 },
    { userId: 4, seatNo: 4, damage: 225.4, kills: 1, winPlace: 2 },
  ]);
  assert.strictEqual(settled.ok, true);
  assert.strictEqual(settled.players.length, 4);
}

run();
console.log('[bean-rule-engine] tests passed');
