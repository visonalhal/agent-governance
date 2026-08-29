import assert from "node:assert/strict";
import test from "node:test";
import { activeUsers } from "../src/active-users.js";

test("returns only active users", () => {
  const users = [
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: true },
  ];

  assert.deepEqual(activeUsers(users), [users[0], users[2]]);
});
