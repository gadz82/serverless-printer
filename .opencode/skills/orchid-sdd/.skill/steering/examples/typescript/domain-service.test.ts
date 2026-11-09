// Placement (illustrative):
//   test/application/deactivate-user.test.ts   -> DeactivateUser test

import assert from "node:assert/strict";
import { test } from "node:test";
import { DeactivateUser } from "./domain-service";
import { InMemoryUserRepository } from "./hexagonal-port";

test("deactivates an active user through the port", async () => {
  const users = new InMemoryUserRepository();
  await users.save({ id: "u-1", email: "person@example.com", active: true });

  const result = await new DeactivateUser(users).execute("u-1");

  assert.equal(result.active, false);
  assert.equal((await users.findById("u-1"))?.active, false);
});

test("rejects an unknown user explicitly", async () => {
  const users = new InMemoryUserRepository();
  await assert.rejects(
    () => new DeactivateUser(users).execute("missing"),
    /user not found/,
  );
});
