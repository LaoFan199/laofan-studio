import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFractionalOrder, FRACTIONAL_EXECUTION_VERSION } from '../stock-ai/trading.js';

test('fractional order buys a dollar amount of an expensive stock', () => {
  const order = calculateFractionalOrder({ amount: 50, price: 500, cash: 800 });
  assert.equal(order.valid, true);
  assert.equal(order.amount, 50);
  assert.equal(order.quantity, 0.1);
  assert.equal(FRACTIONAL_EXECUTION_VERSION, 'fractional-v1');
});

test('fractional order enforces minimum cash in code', () => {
  const order = calculateFractionalOrder({ amount: 50, price: 100, cash: 225 });
  assert.equal(order.valid, false);
  assert.equal(order.maximumAllowed, 25);
});

test('fractional order enforces cumulative position limit in code', () => {
  const order = calculateFractionalOrder({ amount: 25, price: 500, cash: 800, currentPositionValue: 190 });
  assert.equal(order.valid, false);
  assert.equal(order.maximumAllowed, 10);
});

test('fractional order rejects amounts below ten dollars', () => {
  const order = calculateFractionalOrder({ amount: 9.99, price: 100, cash: 1000 });
  assert.equal(order.valid, false);
  assert.equal(order.minimumOrder, 10);
});
