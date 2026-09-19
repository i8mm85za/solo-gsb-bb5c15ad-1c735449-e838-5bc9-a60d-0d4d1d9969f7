"use strict";

/**
 * Sample contribution analyzer （样本贡献度）.
 *
 * Re-infers the schema for the full sample set and for every leave-one-out
 * subset, then compares the two rule sets. A sample is "critical" （关键）
 * when removing it changes the inferred contract, otherwise "redundant"
 * （冗余）. The affected schema JSON Pointers are reported per sample.
 *
 * Schemas are canonicalized before comparison so that array ordering
 * (type unions, required lists) and object key ordering (properties)
 * cannot manufacture false differences, and each rule is counted exactly
 * once (the rule set is keyed by schema JSON Pointer).
 *
 * A single analysis is capped at MAX_SAMPLES samples; shape violations
 * surface as 400s.
 */

const { inferSchema, escapePointer } = require("./infer");

const MAX_SAMPLES = 50;

const CLASSIFICATIONS = ["critical", "redundant"];

/**
 * Recursively canonicalize an inferred schema: object keys are sorted and
 * arrays are sorted by their canonical JSON. Every array this service
 * emits (`type` unions, `required` lists) is a set, so ordering carries
 * no meaning; normalizing it keeps leave-one-out comparisons free of
 * false differences caused by sample order.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Flatten a canonicalized schema into a rule set: schema JSON Pointer ->
 * canonical JSON of the LOCAL rule at that node (type union, required
 * list, property key set, items presence). Child rules live at their own
 * pointers, so each rule is represented exactly once.
 */
function flattenRules(schema) {
  const rules = new Map();
  const walk = (node, pointer) => {
    const rule = {};
    if (node.type !== undefined) rule.type = node.type;
    if (node.required !== undefined) rule.required = node.required;
    if (node.properties !== undefined) rule.properties = Object.keys(node.properties);
    if (node.items !== undefined) rule.items = true;
    rules.set(pointer, JSON.stringify(rule));
    if (node.properties) {
      for (const key of Object.keys(node.properties)) {
        walk(node.properties[key], `${pointer}/properties/${escapePointer(key)}`);
      }
    }
    if (node.items) walk(node.items, `${pointer}/items`);
  };
  walk(schema, "");
  return rules;
}

/** Sorted pointers whose rule differs between the full and leave-one-out rule sets. */
function diffRules(fullRules, reducedRules) {
  const affected = new Set();
  for (const [pointer, rule] of fullRules) {
    if (reducedRules.get(pointer) !== rule) affected.add(pointer);
  }
  for (const [pointer] of reducedRules) {
    if (!fullRules.has(pointer)) affected.add(pointer);
  }
  return [...affected].sort();
}

/**
 * Classify every sample as critical or redundant via leave-one-out
 * re-inference.
 *
 * @returns {{ total: number,
 *            summary: { critical: number, redundant: number },
 *            samples: Array<{ index: number, classification: string,
 *                             affectedPointers: string[] }> }}
 */
function analyzeContribution({ samples }) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw Object.assign(new Error("Request body must contain a non-empty 'samples' array."), {
      status: 400,
    });
  }
  if (samples.length > MAX_SAMPLES) {
    throw Object.assign(
      new Error(
        `Too many samples: got ${samples.length}, at most ${MAX_SAMPLES} allowed per analysis.`
      ),
      { status: 400 }
    );
  }

  const fullRules = flattenRules(canonicalize(inferSchema(samples).schema));

  const results = samples.map((_, index) => {
    if (samples.length === 1) {
      // The only sample: every inferred rule depends on it.
      return {
        index,
        classification: "critical",
        affectedPointers: [...fullRules.keys()].sort(),
      };
    }
    const reduced = samples.filter((_, i) => i !== index);
    const reducedRules = flattenRules(canonicalize(inferSchema(reduced).schema));
    const affectedPointers = diffRules(fullRules, reducedRules);
    return {
      index,
      classification: affectedPointers.length > 0 ? "critical" : "redundant",
      affectedPointers,
    };
  });

  const summary = { critical: 0, redundant: 0 };
  for (const result of results) summary[result.classification] += 1;
  return { total: samples.length, summary, samples: results };
}

module.exports = { analyzeContribution, MAX_SAMPLES, CLASSIFICATIONS };
