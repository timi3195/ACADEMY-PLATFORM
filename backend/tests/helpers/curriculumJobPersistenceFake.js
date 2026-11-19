const getValue = (record, path) => path.split(".").reduce((value, part) => value?.[part], record);

const setValue = (record, path, value) => {
  const parts = path.split(".");
  let target = record;
  for (const part of parts.slice(0, -1)) {
    if (!target[part]) target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
};

const comparable = (value) => value instanceof Date ? value.getTime() : value;

const bsonType = (value) => {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (value instanceof Date) return "date";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
  if (typeof value === "boolean") return "bool";
  if (Array.isArray(value)) return "array";
  return "object";
};

const evaluate = (expression, record, serverNow) => {
  if (typeof expression === "string") {
    if (expression === "$$NOW") return new Date(serverNow);
    if (expression.startsWith("$")) return getValue(record, expression.slice(1));
    return expression;
  }
  if (Array.isArray(expression)) {
    return expression.map((item) => evaluate(item, record, serverNow));
  }
  if (!expression || typeof expression !== "object" || expression instanceof Date) return expression;
  if (Object.prototype.hasOwnProperty.call(expression, "$literal")) return expression.$literal;
  if (Object.prototype.hasOwnProperty.call(expression, "$type")) {
    return bsonType(evaluate(expression.$type, record, serverNow));
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$convert")) {
    const value = evaluate(expression.$convert.input, record, serverNow);
    return value === null || value === undefined
      ? expression.$convert.onNull
      : String(value);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$regexMatch")) {
    const input = evaluate(expression.$regexMatch.input, record, serverNow);
    return typeof input === "string" &&
      new RegExp(expression.$regexMatch.regex).test(input);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$isNumber")) {
    return typeof evaluate(expression.$isNumber, record, serverNow) === "number";
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$in")) {
    const [value, values] = evaluate(expression.$in, record, serverNow);
    return values.includes(value);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$eq")) {
    const [left, right] = evaluate(expression.$eq, record, serverNow);
    return comparable(left) === comparable(right);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$ne")) {
    const [left, right] = evaluate(expression.$ne, record, serverNow);
    return comparable(left) !== comparable(right);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$gt")) {
    const [left, right] = evaluate(expression.$gt, record, serverNow);
    return comparable(left) > comparable(right);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$gte")) {
    const [left, right] = evaluate(expression.$gte, record, serverNow);
    return comparable(left) >= comparable(right);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$lt")) {
    const [left, right] = evaluate(expression.$lt, record, serverNow);
    return comparable(left) < comparable(right);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$lte")) {
    const [left, right] = evaluate(expression.$lte, record, serverNow);
    return comparable(left) <= comparable(right);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$add")) {
    return evaluate(expression.$add, record, serverNow).reduce((sum, value) => {
      if (sum instanceof Date) return new Date(sum.getTime() + value);
      if (value instanceof Date) return new Date(value.getTime() + sum);
      return sum + value;
    });
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$ifNull")) {
    const [value, fallback] = expression.$ifNull;
    const resolved = evaluate(value, record, serverNow);
    return resolved === null || resolved === undefined
      ? evaluate(fallback, record, serverNow)
      : resolved;
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$and")) {
    return expression.$and.every((item) => evaluate(item, record, serverNow));
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$or")) {
    return expression.$or.some((item) => evaluate(item, record, serverNow));
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$not")) {
    return !evaluate(expression.$not[0], record, serverNow);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$switch")) {
    for (const branch of expression.$switch.branches) {
      if (evaluate(branch.case, record, serverNow)) {
        return evaluate(branch.then, record, serverNow);
      }
    }
    return evaluate(expression.$switch.default, record, serverNow);
  }
  if (Object.prototype.hasOwnProperty.call(expression, "$mergeObjects")) {
    return Object.assign({}, ...evaluate(expression.$mergeObjects, record, serverNow));
  }
  return Object.fromEntries(Object.entries(expression).map(([key, value]) => [
    key,
    evaluate(value, record, serverNow)
  ]));
};

const matchesValue = (actual, condition, record, serverNow) => {
  if (condition && typeof condition === "object" &&
      !(condition instanceof Date) && !Array.isArray(condition)) {
    return Object.entries(condition).every(([operator, expected]) => {
      const left = comparable(actual);
      const right = comparable(expected);
      if (operator === "$in") return expected.some((value) => value === actual);
      if (operator === "$ne") {
        return expected === null
          ? actual !== null && actual !== undefined
          : actual !== expected;
      }
      if (operator === "$lt") return left < right;
      if (operator === "$lte") return left <= right;
      if (operator === "$gt") return left > right;
      if (operator === "$gte") return left >= right;
      return false;
    });
  }
  if (condition === null) return actual === null || actual === undefined;
  return actual === condition;
};

const matches = (record, filter, serverNow = new Date()) =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return condition.some((clause) => matches(record, clause, serverNow));
    if (key === "$and") return condition.every((clause) => matches(record, clause, serverNow));
    if (key === "$expr") return Boolean(evaluate(condition, record, serverNow));
    return matchesValue(getValue(record, key), condition, record, serverNow);
  });

const applyUpdate = (record, update, serverNow = new Date()) => {
  const stages = Array.isArray(update) ? update : [update];
  for (const stage of stages) {
    const snapshot = structuredClone(record);
    for (const [path, expression] of Object.entries(stage.$set || {})) {
      setValue(record, path, evaluate(expression, snapshot, serverNow));
    }
    for (const path of stage.$unset || []) {
      const parts = path.split(".");
      const field = parts.pop();
      const parent = parts.reduce((value, part) => value?.[part], record);
      if (parent) delete parent[field];
    }
    if (stage.$inc) {
      for (const [path, increment] of Object.entries(stage.$inc)) {
        setValue(record, path, (getValue(record, path) || 0) + increment);
      }
    }
  }
};

class CurriculumJobPersistenceFake {
  constructor(records = [], serverNow = new Date()) {
    this.records = records;
    this.serverNow = new Date(serverNow);
  }

  async findOneAndUpdate(filter, update) {
    const record = this.records.find((candidate) => matches(candidate, filter, this.serverNow));
    if (!record) return null;
    applyUpdate(record, update, this.serverNow);
    return record;
  }

  async updateMany(filter, update) {
    const matched = this.records.filter((candidate) => matches(candidate, filter, this.serverNow));
    for (const record of matched) applyUpdate(record, update, this.serverNow);
    return { modifiedCount: matched.length };
  }

  async updateOne(filter, update) {
    const record = this.records.find((candidate) => matches(candidate, filter, this.serverNow));
    if (!record) return { modifiedCount: 0 };
    applyUpdate(record, update, this.serverNow);
    return { modifiedCount: 1 };
  }
}

module.exports = {
  CurriculumJobPersistenceFake,
  applyUpdate,
  evaluate,
  matches
};
