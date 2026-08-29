import assert from "node:assert/strict";
import test from "node:test";
import { add, multiply } from "../src/calculator.js";

test("calculator operations", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(multiply(4, 5), 20);
});
