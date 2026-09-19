"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeContribution, MAX_SAMPLES, CLASSIFICATIONS } = require("../contribution");

test("unique evidence makes a sample critical, shared evidence redundant", () => {
  const { total, summary, samples } = analyzeContribution({
    samples: [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c", extra: true }, // only sample carrying `extra`
    ],
  });
  assert.equal(total, 3);
  assert.deepEqual(summary, { critical: 1, redundant: 2 });
  assert.deepEqual([...Object.keys(summary)].sort(), [...CLASSIFICATIONS].sort());
  assert.deepEqual(
    samples.map((s) => [s.index, s.classification]),
    [
      [0, "redundant"],
      [1, "redundant"],
      [2, "critical"],
    ]
  );
  assert.deepEqual(samples[0].affectedPointers, []);
  // Removing #2 drops the `extra` property and changes the root key set.
  assert.deepEqual(samples[2].affectedPointers, ["", "/properties/extra"]);
});

test("a sample is critical when it alone contributes a type to a union", () => {
  const { samples } = analyzeContribution({
    samples: [{ phone: null }, { phone: "x" }, { phone: "y" }],
  });
  assert.equal(samples[0].classification, "critical");
  assert.deepEqual(samples[0].affectedPointers, ["/properties/phone"]);
  assert.equal(samples[1].classification, "redundant");
  assert.equal(samples[2].classification, "redundant");
});

test("integer/number widening pins the only float sample as critical", () => {
  const { samples } = analyzeContribution({
    samples: [{ n: 1 }, { n: 2 }, { n: 1.5 }],
  });
  assert.deepEqual(
    samples.map((s) => s.classification),
    ["redundant", "redundant", "critical"]
  );
  assert.deepEqual(samples[2].affectedPointers, ["/properties/n"]);
});

test("object key order and required order do not create false differences", () => {
  // Without normalization the leave-one-out schema would list keys/required
  // as [b, a] instead of [a, b] and both samples would look critical.
  const { summary, samples } = analyzeContribution({
    samples: [
      { a: 1, b: 2 },
      { b: 3, a: 4 },
    ],
  });
  assert.deepEqual(summary, { critical: 0, redundant: 2 });
  for (const s of samples) assert.deepEqual(s.affectedPointers, []);
});

test("array element order does not create false differences", () => {
  const { summary } = analyzeContribution({
    samples: [{ tags: ["a", 1] }, { tags: [2, "b"] }],
  });
  assert.deepEqual(summary, { critical: 0, redundant: 2 });
});

test("nested rules report their own pointers, each exactly once", () => {
  const { samples } = analyzeContribution({
    samples: [{ user: { name: "a", age: 1 } }, { user: { name: "b" } }],
  });
  // Removing #0 deletes the optional `age` rule; the root rule is untouched.
  assert.deepEqual(samples[0].affectedPointers, [
    "/properties/user",
    "/properties/user/properties/age",
  ]);
  // Removing #1 makes `age` required: only the user node's rule changes.
  assert.deepEqual(samples[1].affectedPointers, ["/properties/user"]);
  for (const s of samples) {
    assert.equal(new Set(s.affectedPointers).size, s.affectedPointers.length);
  }
});

test("a single sample is trivially critical", () => {
  const { total, summary, samples } = analyzeContribution({ samples: [{ a: 1 }] });
  assert.equal(total, 1);
  assert.deepEqual(summary, { critical: 1, redundant: 0 });
  assert.deepEqual(samples[0].affectedPointers, ["", "/properties/a"]);
});

test("analyzeContribution rejects a non-array or empty sample set with status 400", () => {
  for (const samples of [undefined, null, "nope", { 0: 1 }, 42, []]) {
    assert.throws(
      () => analyzeContribution({ samples }),
      (err) => err.status === 400 && /'samples' array/.test(err.message)
    );
  }
});

test(`analyzeContribution rejects more than ${MAX_SAMPLES} samples with status 400`, () => {
  const samples = Array.from({ length: MAX_SAMPLES + 1 }, () => 1);
  assert.throws(
    () => analyzeContribution({ samples }),
    (err) => err.status === 400 && new RegExp(`${MAX_SAMPLES}`).test(err.message)
  );
  // Exactly at the limit is fine.
  const ok = analyzeContribution({
    samples: Array.from({ length: MAX_SAMPLES }, () => 1),
  });
  assert.equal(ok.total, MAX_SAMPLES);
  assert.equal(ok.summary.redundant, MAX_SAMPLES);
});
