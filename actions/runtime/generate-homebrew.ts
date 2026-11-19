#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};
var __require = import.meta.require;

function r(e) {
  return `\x1B[${e}m`;
}
function c(e) {
  let t = e.replace(`#`, ``);
  t.length === 3 && (t = t.replace(/[\da-f]/gi, `$&$&`));
  let n = parseInt(t, 16);
  return `${n >> 16 & 255};${n >> 8 & 255};${n & 255}`;
}
function f(e) {
  return (`` + e).replace(d, ``);
}
function ee(e, t, n = e, r = e.length < t.length ? e.length : t.length) {
  let i = r + t.length;
  return (a) => {
    let o = `` + a;
    if (o.length >= i) {
      let e = o.indexOf(t, r);
      if (~e) {
        let r = ``, i = 0;
        do
          r += o.substring(i, e) + n, i = e + t.length, e = o.indexOf(t, i);
        while (~e);
        o = r + o.substring(i);
      }
    }
    return e + o + t;
  };
}
function m(e, t) {
  let n = e[0] ?? ``;
  for (let r = 0;r < t.length; r++)
    n += String(t[r]) + (e[r + 1] ?? ``);
  return n;
}
function h(e) {
  return (t, ...n) => {
    if (typeof t == `object` && `raw` in t) {
      let r = m(t, n);
      return e(r, r);
    }
    let r = String(t);
    return e(r, n[0] === undefined ? r : String(n[0]));
  };
}
function _(i) {
  let a = r(0), o = r(4), s = r(24), c = i(r(90), e);
  return { reset: i(a, a), bold: i(r(1), n, n + r(1)), dim: i(r(2), n, n + r(2)), italic: i(r(3), r(23)), underline: i(o, s), blink: i(r(5), r(25)), inverse: i(r(7), r(27)), hidden: i(r(8), r(28)), strikethrough: i(r(9), r(29)), doubleUnderline: i(r(21), s, undefined, o.length), overline: i(r(53), r(55)), black: i(r(30), e), blue: i(r(34), e), cyan: i(r(36), e), gray: c, grey: c, green: i(r(32), e), magenta: i(r(35), e), red: i(r(31), e), white: i(r(37), e), yellow: i(r(33), e), bgBlack: i(r(40), t), bgBlue: i(r(44), t), bgCyan: i(r(46), t), bgGreen: i(r(42), t), bgMagenta: i(r(45), t), bgRed: i(r(41), t), bgWhite: i(r(47), t), bgYellow: i(r(43), t), blackBright: i(r(90), e), blueBright: i(r(94), e), cyanBright: i(r(96), e), greenBright: i(r(92), e), magentaBright: i(r(95), e), redBright: i(r(91), e), whiteBright: i(r(97), e), yellowBright: i(r(93), e), bgBlackBright: i(r(100), t), bgBlueBright: i(r(104), t), bgCyanBright: i(r(106), t), bgGreenBright: i(r(102), t), bgMagentaBright: i(r(105), t), bgRedBright: i(r(101), t), bgWhiteBright: i(r(107), t), bgYellowBright: i(r(103), t) };
}
function w(e, t) {
  if (!Number.isSafeInteger(t) || t < 0)
    throw RangeError(`count must be a non-negative safe integer`);
  return e.repeat(t);
}
function O(n = x(), r = n) {
  let c = n ? ee : () => D;
  return { ..._(c), isColorSupported: n, isHyperlinkSupported: r, link: h(r ? g : (e, t) => t), space: T, tab: E, fg256: (t) => c(i(t), e), bg256: (e) => c(a(e), t), rgb: (t, n, r) => c(o(t, n, r), e), bgRgb: (e, n, r) => c(s(e, n, r), t), hex: (t) => c(l(t), e), bgHex: (e) => c(u(e), t) };
}
var e = `\x1B[39m`, t = `\x1B[49m`, n = `\x1B[22m`, i = (e) => `\x1B[38;5;${e}m`, a = (e) => `\x1B[48;5;${e}m`, o = (e, t, n) => `\x1B[38;2;${e};${t};${n}m`, s = (e, t, n) => `\x1B[48;2;${e};${t};${n}m`, l = (e) => `\x1B[38;2;${c(e)}m`, u = (e) => `\x1B[48;2;${c(e)}m`, d, p = (e) => `` + e, g = (e, t) => `\x1B]8;;` + e + `\x1B\\` + t + `\x1B]8;;\x1B\\`, v, y, b = ({ argv: e, env: t, isTTY: n, platform: r }) => t.FORCE_COLOR || e.includes(`--color`) ? true : t.NO_COLOR || e.includes(`--no-color`) ? false : !!(r === `win32` || t.CI || n && t.TERM !== `dumb`), x = () => b(y), S = ({ argv: e, env: t, isTTY: n }) => e.includes(`--no-hyperlinks`) ? false : e.includes(`--hyperlinks`) ? true : !t.NO_HYPERLINKS && !!(t.FORCE_HYPERLINKS || n && t.TERM !== `dumb`), C = () => S(y), T = (e = 1) => w(` `, e), E = (e = 1) => w(`	`, e), D, k, A, j, M, N, P, F, I, L, R, z, B, V, H, U, W, G, K, q, J, Y, X, Z, te, Q, ne, re, ie, ae, oe, se, ce, le, ue, de, fe, pe, me, he, ge, _e, ve, ye, be, $, xe, Se, Ce, we, Te, Ee, De, Oe, ke, Ae;
var init_internal = __esm(() => {
  d = RegExp(`\x1B\\[[0-?]*[ -/]*m|\x1B\\][\\s\\S]*?(?:\\x07|\x1B\\\\)`, `g`);
  v = globalThis.process;
  y = { argv: v?.argv ?? [], env: ((e, t) => new Proxy({}, { get: (n, r) => {
    if (typeof r == `string` && t(r))
      try {
        return e[r];
      } catch {
        return;
      }
  } }))(v?.env ?? {}, (e) => {
    let t = Reflect.get(globalThis, `Deno`);
    if (typeof t != `object` || !t)
      return true;
    let n = Reflect.get(t, `permissions`);
    if (typeof n != `object` || !n)
      return true;
    let r = Reflect.get(n, `querySync`);
    if (typeof r != `function`)
      return true;
    let i = Reflect.apply(r, n, [{ name: `env`, variable: e }]);
    return typeof i == `object` && !!i && Reflect.get(i, `state`) === `granted`;
  }), get isTTY() {
    return v?.stdout?.isTTY === true;
  }, platform: v?.platform };
  D = p;
  k = O(x(), C());
  A = k.bg256;
  j = k.bgBlack;
  M = k.bgBlackBright;
  N = k.bgBlue;
  P = k.bgBlueBright;
  F = k.bgCyan;
  I = k.bgCyanBright;
  L = k.bgGreen;
  R = k.bgGreenBright;
  z = k.bgHex;
  B = k.bgMagenta;
  V = k.bgMagentaBright;
  H = k.bgRed;
  U = k.bgRedBright;
  W = k.bgRgb;
  G = k.bgWhite;
  K = k.bgWhiteBright;
  q = k.bgYellow;
  J = k.bgYellowBright;
  Y = k.black;
  X = k.blackBright;
  Z = k.blink;
  te = k.blue;
  Q = k.blueBright;
  ne = k.bold;
  re = k.cyan;
  ie = k.cyanBright;
  ae = k.dim;
  oe = k.doubleUnderline;
  se = k.fg256;
  ce = k.gray;
  le = k.grey;
  ue = k.green;
  de = k.greenBright;
  fe = k.hex;
  pe = k.hidden;
  me = k.inverse;
  he = k.isColorSupported;
  ge = k.isHyperlinkSupported;
  _e = k.italic;
  ve = k.link;
  ye = k.magenta;
  be = k.magentaBright;
  $ = k.overline;
  xe = k.red;
  Se = k.redBright;
  Ce = k.reset;
  we = k.rgb;
  Te = k.strikethrough;
  Ee = k.underline;
  De = k.white;
  Oe = k.whiteBright;
  ke = k.yellow;
  Ae = k.yellowBright;
});

var init_dist = __esm(() => {
  init_internal();
});

var __defProp2, __exportAll = (e, t) => {
  let n = Object.setPrototypeOf({}, null);
  for (var r in e)
    __defProp2(n, r, { get: e[r], enumerable: true });
  return t & 1 || __defProp2(n, Symbol.toStringTag, { value: `Module` }), t & 2 ? n : Object.preventExtensions(n);
};
var init_rolldown_runtime_DOYBPklu = __esm(() => {
  __defProp2 = Object.defineProperty;
});

function resolveOptions(e) {
  return { includeHidden: e?.includeHidden ?? true, includePrompts: e?.includePrompts ?? true, envPrefix: e?.envPrefix };
}
function generateSchema(e, t, n) {
  let r = resolveOptions(t), i = r.envPrefix ?? e.envPrefix, a = t?.groupOrder ?? e.helpConfig?.groupOrder, o = n ?? { name: e.name, version: e.version }, s = e.defaultCommand !== undefined && (r.includeHidden || !e.defaultCommand.hidden) ? serializeCommand(e.defaultCommand, r, o) : undefined;
  return { $schema: DEFINITION_SCHEMA_URL, schemaVersion: 1, name: e.name, ...e.version === undefined ? {} : { version: e.version }, ...e.description === undefined ? {} : { description: resolvePlainHelpDescription(e.description) }, ...i === undefined ? {} : { envPrefix: i }, ...a === undefined ? {} : { groupOrder: [...a] }, ...s === undefined ? {} : { defaultCommand: s }, commands: e.commands.filter((e) => r.includeHidden || !e.hidden).map((e) => serializeCommand(e, r, o)) };
}
function generateCommandSchema(e, t, n) {
  let r = n ?? { name: e.name, version: undefined }, i = resolveOptions(t);
  return { schemaVersion: 1, ...i.envPrefix === undefined ? {} : { envPrefix: i.envPrefix }, ...t?.groupOrder === undefined ? {} : { groupOrder: [...t.groupOrder] }, ...serializeCommand(e, i, r) };
}
function serializeCommand(e, t, n) {
  let r = {};
  for (let [n, i] of Object.entries(e.flags))
    r[n] = serializeFlag(i, t);
  return { name: e.name, ...e.description === undefined ? {} : { description: resolvePlainHelpDescription(e.description) }, ...e.details === undefined ? {} : { details: resolvePlainHelpDescription(e.details) }, ...e.aliases.length > 0 ? { aliases: [...e.aliases] } : {}, ...e.hidden ? { hidden: true } : {}, ...e.examples.length > 0 ? { examples: e.examples.map((e) => serializeExample(e, n)) } : {}, flags: r, ...e.flagDeclarationOrder === undefined ? {} : { flagDeclarationOrder: [...e.flagDeclarationOrder] }, args: e.args.map((e) => serializeArgEntry(e, t)), ...e.constraints?.length ? { constraints: e.constraints } : {}, commands: e.commands.filter((e) => t.includeHidden || !e.hidden).map((e) => serializeCommand(e, t, n)) };
}
function serializeFlag(e, t, n = false) {
  let r = getFlagAliasNames(e), { stringConstraints: i, pathChecks: a, negation: o } = e, s = n || e.sensitive;
  return { kind: e.kind, presence: e.presence, ...!s && isJsonSerializable(e.defaultValue) ? { defaultValue: e.defaultValue } : {}, ...e.defaultDescription === undefined ? {} : { defaultDescription: e.defaultDescription }, ...e.sensitive ? { sensitive: true } : {}, ...r.length > 0 ? { aliases: [...r] } : {}, ...e.stdin === undefined ? {} : { stdin: serializeStdin(e.stdin) }, ...e.envVar === undefined ? {} : { envVar: e.envVar }, ...e.envIndexed === undefined ? {} : { envIndexed: serializeEnvIndexed(e.envIndexed) }, ...e.envAbsolute ? { envAbsolute: true } : {}, ...e.configPath === undefined ? {} : { configPath: e.configPath }, ...e.description === undefined ? {} : { description: resolvePlainHelpDescription(e.description) }, ...e.group === undefined ? {} : { group: e.group }, ...e.advanced ? { advanced: true } : {}, ...e.enumValues === undefined ? {} : { enumValues: [...e.enumValues] }, ...e.numberConstraints === undefined ? {} : { numberConstraints: { ...e.numberConstraints } }, ...i === undefined ? {} : { stringConstraints: serializeStringConstraints(i) }, ...e.elementSchema === undefined ? {} : { elementSchema: serializeFlag(e.elementSchema, t, s) }, ...e.separator === undefined ? {} : { separator: e.separator }, ...e.split === undefined ? {} : { split: serializeSplit(e.split) }, ...e.duplicateKeys === `last` ? {} : { duplicateKeys: e.duplicateKeys }, ...e.unique ? { unique: true } : {}, ...a === undefined ? {} : { pathChecks: serializePathChecks(a) }, ...e.valueHint === undefined ? {} : { valueHint: e.valueHint }, ...t.includePrompts && e.prompt !== undefined ? { prompt: serializePrompt(e.prompt) } : {}, ...e.deprecated === undefined ? {} : { deprecated: e.deprecated }, ...e.propagate ? { propagate: true } : {}, ...o === undefined ? {} : { negation: { ...o.alias === undefined ? {} : { alias: o.alias }, ...o.hidden ? { hidden: true } : {} } }, ...e.duplicates === `last` ? {} : { duplicates: e.duplicates }, ...e.separateValue === true ? { separateValue: true } : {}, ...e.variadic === true ? { variadic: true } : {} };
}
function serializeStringConstraints(e) {
  let t = e.pattern;
  return { ...e.nonEmpty === undefined ? {} : { nonEmpty: e.nonEmpty }, ...e.minLength === undefined ? {} : { minLength: e.minLength }, ...e.maxLength === undefined ? {} : { maxLength: e.maxLength }, ...t === undefined ? {} : { pattern: { source: t.source, flags: t.flags } } };
}
function serializeEnvIndexed(e) {
  return e.fields === undefined ? { count: e.count, value: e.value } : { count: e.count, fields: { ...e.fields } };
}
function serializePathChecks(e) {
  return { mustExist: e.mustExist, ...e.type === undefined ? {} : { type: e.type }, ...e.create ? { create: true } : {} };
}
function serializeArgEntry(e, t) {
  return { name: e.name, ...serializeArgValue(e.schema, t) };
}
function serializeArgValue(e, t) {
  let { stringConstraints: n, pathChecks: r } = e;
  return { kind: e.kind, presence: e.presence, ...e.variadic ? { variadic: true } : {}, ...e.stdin === undefined ? {} : { stdin: serializeStdin(e.stdin) }, ...!e.sensitive && isJsonSerializable(e.defaultValue) ? { defaultValue: e.defaultValue } : {}, ...e.defaultDescription === undefined ? {} : { defaultDescription: e.defaultDescription }, ...e.sensitive ? { sensitive: true } : {}, ...e.description === undefined ? {} : { description: resolvePlainHelpDescription(e.description) }, ...e.group === undefined ? {} : { group: e.group }, ...e.envVar === undefined ? {} : { envVar: e.envVar }, ...e.envIndexed === undefined ? {} : { envIndexed: serializeEnvIndexed(e.envIndexed) }, ...e.envAbsolute ? { envAbsolute: true } : {}, ...e.configPath === undefined ? {} : { configPath: e.configPath }, ...e.enumValues === undefined ? {} : { enumValues: [...e.enumValues] }, ...e.elementSchema === undefined ? {} : { elementSchema: serializeArgElementValue(e.elementSchema) }, ...e.numberConstraints === undefined ? {} : { numberConstraints: { ...e.numberConstraints } }, ...n === undefined ? {} : { stringConstraints: serializeStringConstraints(n) }, ...r === undefined ? {} : { pathChecks: serializePathChecks(r) }, ...e.valueHint === undefined ? {} : { valueHint: e.valueHint }, ...e.separator === undefined ? {} : { separator: e.separator }, ...e.split === undefined ? {} : { split: serializeSplit(e.split) }, ...e.duplicateKeys === `last` ? {} : { duplicateKeys: e.duplicateKeys }, ...e.unique ? { unique: true } : {}, ...t.includePrompts && e.prompt !== undefined ? { prompt: serializePrompt(e.prompt) } : {}, ...e.deprecated === undefined ? {} : { deprecated: e.deprecated } };
}
function serializeArgElementValue(e) {
  if (e.kind === `keyValue`)
    throw TypeError(`Arg element schema kind 'keyValue' is not supported`);
  return { kind: e.kind, presence: `required`, ...e.enumValues === undefined ? {} : { enumValues: [...e.enumValues] }, ...e.numberConstraints === undefined ? {} : { numberConstraints: { ...e.numberConstraints } }, ...e.stringConstraints === undefined ? {} : { stringConstraints: serializeStringConstraints(e.stringConstraints) }, ...e.pathChecks === undefined ? {} : { pathChecks: serializePathChecks(e.pathChecks) }, ...e.valueHint === undefined ? {} : { valueHint: e.valueHint } };
}
function serializeSplit(e) {
  return { ...e.env === undefined ? {} : { env: { ...e.env } }, ...e.stdin === undefined ? {} : { stdin: { ...e.stdin } } };
}
function serializeStdin(e) {
  return { when: e.when, consume: e.consume, trim: e.trim, ...e.argv === false ? { argv: false } : {} };
}
function serializePrompt(e) {
  let t = { ...e.sensitive === true || e.kind === `password` ? { sensitive: true } : {} };
  switch (e.kind) {
    case `input`:
      return { kind: e.kind, message: e.message, ...t, ...e.empty === undefined ? {} : { empty: e.empty }, ...e.trim === undefined ? {} : { trim: e.trim }, ...e.placeholder === undefined ? {} : { placeholder: e.placeholder } };
    case `password`:
      return { kind: e.kind, message: e.message, ...t, ...e.empty === undefined ? {} : { empty: e.empty } };
    case `select`:
      return { kind: e.kind, message: e.message, ...t, ...e.choices === undefined ? {} : { choices: e.choices.map(serializeChoice) } };
    case `multiselect`:
      return { kind: e.kind, message: e.message, ...t, ...e.choices === undefined ? {} : { choices: e.choices.map(serializeChoice) }, ...e.min === undefined ? {} : { min: e.min }, ...e.max === undefined ? {} : { max: e.max } };
    case `confirm`:
      return { kind: e.kind, message: e.message, ...t };
  }
}
function serializeChoice(e) {
  return { value: e.value, ...e.label === undefined ? {} : { label: e.label }, ...e.description === undefined ? {} : { description: e.description } };
}
function serializeExample(e, t) {
  return { command: resolveExampleCommand(e.command, t), ...e.description === undefined ? {} : { description: e.description } };
}
function isJsonSerializable(e, t = /* @__PURE__ */ new WeakSet) {
  if (e === undefined)
    return false;
  if (e === null)
    return true;
  let n = typeof e;
  if (n === `string` || n === `boolean`)
    return true;
  if (n === `number`)
    return Number.isFinite(e);
  if (n === `function` || n === `symbol` || n === `bigint`)
    return false;
  if (Array.isArray(e)) {
    if (t.has(e))
      return false;
    t.add(e);
    try {
      return e.every((e) => isJsonSerializable(e, t));
    } finally {
      t.delete(e);
    }
  }
  if (n === `object`) {
    let n = e;
    if (!isPlainJsonObject(n) || t.has(n))
      return false;
    t.add(n);
    try {
      return Object.values(n).every((e) => isJsonSerializable(e, t));
    } finally {
      t.delete(n);
    }
  }
  return false;
}
function isPlainJsonObject(e) {
  let t = Object.getPrototypeOf(e);
  return t === Object.prototype || t === null;
}
function withDefinitionDescriptions(e, t) {
  let n = e.properties, r = typeof n == `object` && n && isPlainJsonObject(n) && t.properties !== undefined ? Object.fromEntries(Object.entries(n).map(([e, n]) => {
    let r = t.properties?.[e];
    return r === undefined || typeof n != `object` || !n || !isPlainJsonObject(n) ? [e, n] : [e, withDefinitionDescriptions(n, r)];
  })) : undefined;
  return { ...e, ...t.description === undefined ? {} : { description: t.description }, ...r === undefined ? {} : { properties: r } };
}
function withDefinitionMetaSchemaDescriptions(e, t) {
  let n = withDefinitionDescriptions(e, t.root), r = n.$defs;
  return typeof r != `object` || !r || !isPlainJsonObject(r) ? n : { ...n, $defs: Object.fromEntries(Object.entries(r).map(([e, n]) => {
    let r = t.defs[e];
    return r === undefined || typeof n != `object` || !n || !isPlainJsonObject(n) ? [e, n] : [e, withDefinitionDescriptions(n, r)];
  })) };
}
var definitionMetaSchemaDescriptions, json_schema_exports, JSON_SCHEMA_DRAFT = `https://json-schema.org/draft/2020-12/schema`, ENV_PREFIX_PROPERTY, GROUP_ORDER_PROPERTY, commandFragmentProperties, argValueFragmentProperties, argElementFragmentProperties, flagElementFragmentProperties, flagFragmentProperties, definitionMetaSchema;
var init_json_schema_DP4L_jL_ = __esm(() => {
  init_rolldown_runtime_DOYBPklu();
  init_core_uS8LDF4B();
  definitionMetaSchemaDescriptions = { root: { description: `Runtime descriptor for the CLI program.

Stores the program name, version, description, and registered command schemas.\\
Sealed by createCLISchema and rebuilt by each CLIBuilder step.`, properties: { name: { description: `Program name (used in help text, usage lines, and completion scripts).` }, version: { description: "Program version (shown by `--version`)." }, description: { description: `Program description (shown in root help).` }, envPrefix: { description: "CLI-wide environment namespace prepended to every relative env binding\n(`undefined` when none is set). `.env('TOKEN')` reads `<envPrefix>TOKEN`;\na binding declared with `{ absolute: true }` is read as written.\n\nSet via the .envPrefix() builder method\nor the `envPrefix` field of CLIDefinition. Fixed when declared, so\nneither manifest name inference nor an inherited invocation name changes it." }, groupOrder: { description: `Named help groups to display first, in order.` }, defaultCommand: { description: `Schema of the default command dispatched when no subcommand matches.

When set, the CLI root behaves like a hybrid command group: subcommands
dispatch by name as usual, but empty argv or flags-only argv falls
through to this command instead of showing root help.

Set via the .default() builder method
or the \`defaultCommand\` field of CLIDefinition.` }, commands: { description: `Schemas of the registered commands, in registration order.` } } }, defs: { command: { description: `Runtime descriptor produced by CommandBuilder.

Consumers (parser, help generator, CLI dispatcher) read this to
understand the command's shape \u2014 flags, args, aliases, subcommands,
and interactive resolver.`, properties: { name: { description: "The command name (used for dispatch, e.g. `'deploy'`)." }, description: { description: `Human-readable description for help text.` }, details: { description: `Longer explanation shown only in this command's help, with paragraphs wrapped to its width.` }, aliases: { description: `Alternative names for this command.` }, hidden: { description: `Whether this command is hidden from help listings.` }, examples: { description: `Usage examples for help text.` }, flags: { description: `Named flag schemas, keyed by flag name.` }, flagDeclarationOrder: { description: `Flag declaration order when it differs from the flag record's key order.` }, args: { description: `Ordered positional arg entries (name + schema).` }, constraints: { description: `Relationships checked after input resolution.` }, commands: { description: "Nested subcommand schemas (for help rendering and completion).\n\nPure data \u2014 no execution closures. Populated by `.command()` on\n`CommandBuilder`. Empty for leaf commands." } } }, commandDocument: { description: `A single-command definition document, version 1.

Produced by generateCommandSchema. Same shape as a
CommandDefinitionFragmentV1 plus the \`schemaVersion\` every standalone
document carries.`, properties: { schemaVersion: { description: "Version of the definition document format emitted by `generateSchema()`\nand `generateCommandSchema()` from `@kjanat/dreamcli/json-schema`." }, envPrefix: { description: "CLI-wide environment namespace prepended to every relative env binding\n(`undefined` when none is set). `.env('TOKEN')` reads `<envPrefix>TOKEN`;\na binding declared with `{ absolute: true }` is read as written.\n\nSet via the .envPrefix() builder method\nor the `envPrefix` field of CLIDefinition. Fixed when declared, so\nneither manifest name inference nor an inherited invocation name changes it." }, groupOrder: { description: `Named help groups to display first, in order.` }, name: { description: `The command name used for dispatch.` }, description: { description: `Human-readable description for help text.` }, details: { description: `Longer explanation shown only in this command's help.` }, aliases: { description: `Alternative names accepted for this command.` }, hidden: { description: `Whether the command is omitted from help listings.` }, examples: { description: `Usage examples attached to the command.` }, flags: { description: `Named flag definitions keyed by flag name.` }, flagDeclarationOrder: { description: `Flag declaration order when it differs from the flag record's key order.` }, args: { description: `Positional argument definitions in CLI order.` }, constraints: { description: `Declarative relationships between the command's inputs.` }, commands: { description: `Nested subcommand definitions.` } } }, flag: { description: `The runtime descriptor stored inside every FlagBuilder. Consumers (parser,
help generator, resolution chain) read this to understand the flag's shape
without touching generics.`, properties: { kind: { description: `What kind of value this flag accepts.` }, presence: { description: "Presence describes whether a flag value is guaranteed to exist when the\naction handler runs:\n\n- `'optional'`  \u2014 not required; unresolved value follows the kind-specific\n  optional fallback (`undefined` for most flags, `[]` for arrays)\n- `'required'`  \u2014 must be supplied; error if missing\n- `'defaulted'` \u2014 always present (falls back to default value)" }, defaultValue: { description: `Runtime default value (if any).` }, aliases: { description: "Short/long aliases (e.g. `[{ name: 'f', hidden: false }]` for `--force`)." }, stdin: { description: "Stdin binding set by `.stdin()` (`undefined` when the flag never reads\nstdin). See StdinBinding." }, envVar: { description: `Environment variable name for v0.2+ resolution.` }, envIndexed: { description: "Indexed environment family read as the env source, set by `.env()` with an\nIndexedEnvBinding (`undefined` otherwise). A flag declares at most\none env source, so this and FlagSchema.envVar are never both set." }, envAbsolute: { description: "Whether the env source is read exactly as written, outside the CLI-wide\nnamespace set by `CLIBuilder.envPrefix()` (set by `.env(\u2026, { absolute:\ntrue })`). Applies to FlagSchema.envVar and\nFlagSchema.envIndexed alike.\n\nDefault: `false`" }, configPath: { description: "Dotted config path for v0.2+ resolution (e.g. `'deploy.region'`)." }, description: { description: `Human-readable description for help text.` }, enumValues: { description: "Allowed literal values when `kind === 'enum'`." }, elementSchema: { description: "Element schema when `kind === 'array'` or `kind === 'keyValue'`." }, prompt: { description: `Interactive prompt configuration for v0.3+ resolution.` }, deprecated: { description: "Deprecation marker.\n\n- `undefined` \u2014 not deprecated (default)\n- `true` \u2014 deprecated with no migration message\n- `string` \u2014 deprecated with a reason/migration message\n\nWhen a deprecated flag is used, a warning is emitted to stderr.\nHelp text shows `[deprecated]` or `[deprecated: <reason>]`." }, propagate: { description: `Whether this flag propagates to subcommands in nested command trees.

When \`true\`, the flag is automatically available to all descendant
commands. A child command that defines a flag with the same name
shadows the propagated parent flag.

Default: \`false\`` }, negation: { description: "Negation settings when `kind === 'boolean'` and `.negatable()` was\ncalled (`undefined` otherwise). See FlagNegation." }, duplicates: { description: "How repeated CLI occurrences of a singleton flag combine.\n\n- `'last'`  \u2014 last occurrence wins (matches historic behavior)\n- `'first'` \u2014 first occurrence wins; later ones parse but are ignored\n- `'error'` \u2014 a second occurrence is a `ParseError` (`DUPLICATE_FLAG`)\n\nApplies to CLI token occurrences only \u2014 env/config/prompt/default\nresolution keeps its precedence semantics and never raises duplicates.\nOccurrences are counted per *logical* flag: aliases and the negated\nspelling all count toward the same flag.\n\nDefault: `'last'`" }, group: { description: `Named section in command help.` }, advanced: { description: `Whether the flag is shown only in full text help.` }, defaultDescription: { description: "Human-readable replacement for the default value in help, or `false` to\nomit the default annotation." }, sensitive: { description: `Whether values from this input must be kept out of user-facing projections.` } } }, flagElement: { description: "Element schema when `kind === 'array'` or `kind === 'keyValue'`.", properties: { kind: { description: `What kind of value this flag accepts.` }, presence: { description: "Presence describes whether a flag value is guaranteed to exist when the\naction handler runs:\n\n- `'optional'`  \u2014 not required; unresolved value follows the kind-specific\n  optional fallback (`undefined` for most flags, `[]` for arrays)\n- `'required'`  \u2014 must be supplied; error if missing\n- `'defaulted'` \u2014 always present (falls back to default value)" }, defaultValue: { description: `Runtime default value (if any).` }, aliases: { description: "Short/long aliases (e.g. `[{ name: 'f', hidden: false }]` for `--force`)." }, stdin: { description: "Stdin binding set by `.stdin()` (`undefined` when the flag never reads\nstdin). See StdinBinding." }, envVar: { description: `Environment variable name for v0.2+ resolution.` }, envIndexed: { description: "Indexed environment family read as the env source, set by `.env()` with an\nIndexedEnvBinding (`undefined` otherwise). A flag declares at most\none env source, so this and FlagSchema.envVar are never both set." }, envAbsolute: { description: "Whether the env source is read exactly as written, outside the CLI-wide\nnamespace set by `CLIBuilder.envPrefix()` (set by `.env(\u2026, { absolute:\ntrue })`). Applies to FlagSchema.envVar and\nFlagSchema.envIndexed alike.\n\nDefault: `false`" }, configPath: { description: "Dotted config path for v0.2+ resolution (e.g. `'deploy.region'`)." }, description: { description: `Human-readable description for help text.` }, enumValues: { description: "Allowed literal values when `kind === 'enum'`." }, elementSchema: { description: "Element schema when `kind === 'array'` or `kind === 'keyValue'`." }, prompt: { description: `Interactive prompt configuration for v0.3+ resolution.` }, deprecated: { description: "Deprecation marker.\n\n- `undefined` \u2014 not deprecated (default)\n- `true` \u2014 deprecated with no migration message\n- `string` \u2014 deprecated with a reason/migration message\n\nWhen a deprecated flag is used, a warning is emitted to stderr.\nHelp text shows `[deprecated]` or `[deprecated: <reason>]`." }, propagate: { description: `Whether this flag propagates to subcommands in nested command trees.

When \`true\`, the flag is automatically available to all descendant
commands. A child command that defines a flag with the same name
shadows the propagated parent flag.

Default: \`false\`` }, negation: { description: "Negation settings when `kind === 'boolean'` and `.negatable()` was\ncalled (`undefined` otherwise). See FlagNegation." }, duplicates: { description: "How repeated CLI occurrences of a singleton flag combine.\n\n- `'last'`  \u2014 last occurrence wins (matches historic behavior)\n- `'first'` \u2014 first occurrence wins; later ones parse but are ignored\n- `'error'` \u2014 a second occurrence is a `ParseError` (`DUPLICATE_FLAG`)\n\nApplies to CLI token occurrences only \u2014 env/config/prompt/default\nresolution keeps its precedence semantics and never raises duplicates.\nOccurrences are counted per *logical* flag: aliases and the negated\nspelling all count toward the same flag.\n\nDefault: `'last'`" } } }, stdin: { description: `The normalized stdin axis of a flag or an arg.`, properties: { when: { description: `When this input reads the stdin stream.` }, consume: { description: `Whether this input consumes the stream alone.` }, trim: { description: `Whether one trailing line terminator is dropped from a single value.` } } }, envIndexed: { description: `A numbered family of environment variables read as one input's env source.

Pass it to \`.env()\` in place of a variable name. The count variable decides
whether the env stage supplied a value at all, and how many entries it owns;
a declared entry with a missing member is an error, never a fallback to a
later source.`, properties: { count: { description: `Variable holding how many entries the family declares, as a canonical
non-negative integer. When it is unset the env source supplies nothing;
\`0\` supplies an explicit empty list.` }, value: { description: "Variable template for one entry, with `{index}` standing for the zero-based index." }, fields: { description: "One variable template per record field, each with `{index}` standing for\nthe zero-based index. Every field is required for every declared entry." } } }, negation: { description: `Negation settings for a boolean flag (set by \`.negatable()\`).

The negated spelling and the positive form are two spellings of ONE
logical flag: they share duplicate policy, and the last CLI occurrence
wins across both. The negated spelling is presence-only \u2014 \`--no-foo=x\`
is rejected.`, properties: { alias: { description: "Explicit negated spelling without the `--` prefix (e.g. `'no-sandbox'`).\n`undefined` synthesizes `no-<flagName>` wherever the flag name is known." }, hidden: { description: `Hide the negated spelling from help, completions, and suggestions.` } } }, arg: { description: `The runtime descriptor stored inside every ArgBuilder. Consumers (parser,
help generator) read this to understand the arg's shape without touching
generics.`, properties: { name: { description: `A named positional argument entry in the command schema.

Pairs a user-facing arg name with its ArgSchema descriptor.
The array ordering in CommandSchema.args determines CLI position.` }, kind: { description: `What kind of value this arg accepts.` }, presence: { description: "Presence describes whether a positional arg is guaranteed to exist when the\naction handler runs:\n\n- `'required'`  \u2014 must be supplied; error if missing (default)\n- `'optional'`  \u2014 may be `undefined` if not supplied\n- `'defaulted'` \u2014 always present (falls back to default value)" }, variadic: { description: `Whether this arg consumes all remaining positionals.` }, stdin: { description: "Stdin binding set by `.stdin()` (`undefined` when the arg never reads\nstdin). See StdinBinding." }, defaultValue: { description: `Runtime default value (if any).` }, defaultDescription: { description: "Human-readable replacement for the default value in help, or `false` to\nomit the default annotation." }, sensitive: { description: `Whether values from this input must be kept out of user-facing projections.` }, description: { description: `Human-readable description for help text.` }, group: { description: `Named section in command help.` }, envVar: { description: `Environment variable name for env resolution.

When set and the CLI value is absent, the resolver reads this env var
and coerces the string to the arg's declared kind.` }, envIndexed: { description: "Indexed environment family read as the env source, set by `.env()` with an\nIndexedEnvBinding (`undefined` otherwise). An arg declares at most\none env source, so this and ArgSchema.envVar are never both set." }, envAbsolute: { description: "Whether the env source is read exactly as written, outside the CLI-wide\nnamespace set by `CLIBuilder.envPrefix()` (set by `.env(\u2026, { absolute:\ntrue })`). Applies to ArgSchema.envVar and\nArgSchema.envIndexed alike.\n\nDefault: `false`" }, configPath: { description: "Dotted config path for config resolution (e.g. `'deploy.region'`)." }, prompt: { description: `Interactive prompt configuration.` }, enumValues: { description: "Allowed literal values when `kind === 'enum'`." }, elementSchema: { description: "Element schema when `kind === 'keyValue'`.\n\nDescribes the value of each entry, so `arg.keyValue(arg.number())` decodes\n`A=1` to the number `1`. `undefined` leaves entry values as strings." }, deprecated: { description: "Deprecation marker.\n\n- `undefined` \u2014 not deprecated (default)\n- `true` \u2014 deprecated with no migration message\n- `string` \u2014 deprecated with a reason/migration message\n\nWhen a deprecated arg is used, a warning is emitted to stderr.\nHelp text shows `[deprecated]` or `[deprecated: <reason>]`." } } }, argElement: { description: "Element schema when `kind === 'keyValue'`.\n\nDescribes the value of each entry, so `arg.keyValue(arg.number())` decodes\n`A=1` to the number `1`. `undefined` leaves entry values as strings.", properties: { kind: { description: `What kind of value this arg accepts.` }, presence: { description: `Entry values are required once their containing key-value argument is present.` }, enumValues: { description: "Allowed literal values when `kind === 'enum'`." } } }, prompt: { description: "Discriminated union of all prompt configurations.\n\nUse the `kind` field to narrow:\n```ts\nif (config.kind === 'select') {\n  config.choices // readonly SelectChoice[] | undefined\n}\n```", properties: { kind: { description: "The kind of interactive prompt to present.\n\n- `'confirm'`     \u2014 yes/no boolean question\n- `'input'`       \u2014 free-text string input\n- `'password'`    \u2014 hidden text input, preserving whitespace\n- `'select'`      \u2014 single selection from a list\n- `'multiselect'` \u2014 multiple selections from a list" }, message: { description: `The question displayed to the user.` }, placeholder: { description: `Placeholder text shown before user types (informational only).` }, choices: { description: "Available choices. When omitted for `enum` flags, the enum values\nfrom the flag schema are used automatically." }, min: { description: `Minimum number of selections required.

Default: \`0\`` }, max: { description: `Maximum number of selections allowed.

Default: \`Infinity\`` } } }, choice: { description: `A selectable option for SelectPromptConfig and MultiselectPromptConfig prompts.`, properties: { value: { description: `The value returned when this choice is selected.` }, label: { description: `Display label shown to the user.

Default: value` }, description: { description: `Optional description shown alongside the choice.` } } }, example: { description: `A single usage example shown in help text.`, properties: { command: { description: "The command invocation (e.g. `'deploy production --force'`)." }, description: { description: `Optional description of what this example does.` } } } } };
  json_schema_exports = /* @__PURE__ */ __exportAll({ generateCommandSchema: () => generateCommandSchema, generateSchema: () => generateSchema });
  ENV_PREFIX_PROPERTY = { type: `string`, minLength: 1, not: { pattern: `[={}]` } };
  GROUP_ORDER_PROPERTY = { type: `array`, items: { type: `string` } };
  commandFragmentProperties = { name: { type: `string` }, description: { type: `string` }, details: { type: `string` }, aliases: { type: `array`, items: { type: `string` } }, hidden: { const: true }, examples: { type: `array`, items: { $ref: `#/$defs/example` } }, flags: { type: `object`, additionalProperties: { $ref: `#/$defs/flag` } }, flagDeclarationOrder: { type: `array`, items: { type: `string` }, uniqueItems: true }, args: { type: `array`, items: { $ref: `#/$defs/arg` } }, constraints: { type: `array`, items: { type: `object`, additionalProperties: false, required: [`kind`, `inputs`], properties: { kind: { enum: CONSTRAINT_KINDS }, inputs: { type: `array`, minItems: 2, uniqueItems: true, items: { $ref: `#/$defs/constraintInput` } } }, anyOf: [{ properties: { kind: { enum: [`conflicts`, `requires`] }, inputs: { maxItems: 2 } } }, { properties: { kind: { enum: [`exactlyOne`, `atMostOne`, `allOrNone`] } } }] } }, commands: { type: `array`, items: { $ref: `#/$defs/command` } } };
  argValueFragmentProperties = { kind: { enum: [`string`, `number`, `boolean`, `enum`, `custom`, `keyValue`] }, presence: { enum: [`required`, `optional`, `defaulted`] }, variadic: { const: true }, stdin: { $ref: `#/$defs/stdin` }, defaultValue: {}, defaultDescription: { oneOf: [{ type: `string` }, { const: false }] }, sensitive: { const: true }, description: { type: `string` }, group: { type: `string` }, envVar: { type: `string` }, envIndexed: { $ref: `#/$defs/envIndexed` }, envAbsolute: { const: true }, configPath: { type: `string` }, enumValues: { type: `array`, items: { type: `string` } }, elementSchema: { $ref: `#/$defs/argElement` }, numberConstraints: { $ref: `#/$defs/numberConstraints` }, stringConstraints: { $ref: `#/$defs/stringConstraints` }, pathChecks: { $ref: `#/$defs/pathChecks` }, valueHint: { type: `string` }, separator: { type: `string`, minLength: 1 }, split: { $ref: `#/$defs/split` }, duplicateKeys: { enum: [...DUPLICATE_KEYS] }, unique: { const: true }, prompt: { $ref: `#/$defs/prompt` }, deprecated: { oneOf: [{ type: `string` }, { const: true }] } };
  argElementFragmentProperties = { kind: { enum: [`string`, `number`, `boolean`, `enum`, `custom`] }, presence: { const: `required` }, enumValues: { type: `array`, items: { type: `string` } }, numberConstraints: { $ref: `#/$defs/numberConstraints` }, stringConstraints: { $ref: `#/$defs/stringConstraints` }, pathChecks: { $ref: `#/$defs/pathChecks` }, valueHint: { type: `string` } };
  flagElementFragmentProperties = { kind: { enum: [`string`, `number`, `boolean`, `enum`, `array`, `custom`, `count`, `keyValue`] }, presence: { enum: [`optional`, `required`, `defaulted`] }, defaultValue: {}, aliases: { type: `array`, items: { type: `string` } }, stdin: { $ref: `#/$defs/stdin` }, envVar: { type: `string` }, envIndexed: { $ref: `#/$defs/envIndexed` }, envAbsolute: { const: true }, configPath: { type: `string` }, description: { type: `string` }, enumValues: { type: `array`, items: { type: `string` } }, numberConstraints: { $ref: `#/$defs/numberConstraints` }, stringConstraints: { $ref: `#/$defs/stringConstraints` }, elementSchema: { $ref: `#/$defs/flagElement` }, separator: { type: `string`, minLength: 1 }, split: { $ref: `#/$defs/split` }, duplicateKeys: { enum: [...DUPLICATE_KEYS] }, unique: { const: true }, pathChecks: { $ref: `#/$defs/pathChecks` }, valueHint: { type: `string` }, prompt: { $ref: `#/$defs/prompt` }, deprecated: { oneOf: [{ type: `string` }, { const: true }] }, propagate: { const: true }, negation: { $ref: `#/$defs/negation` }, separateValue: { const: true }, variadic: { const: true }, duplicates: { enum: [`last`, `first`, `error`] } };
  flagFragmentProperties = { ...flagElementFragmentProperties, defaultDescription: { oneOf: [{ type: `string` }, { const: false }] }, sensitive: { const: true }, group: { type: `string` }, advanced: { const: true } };
  definitionMetaSchema = withDefinitionMetaSchemaDescriptions({ $schema: JSON_SCHEMA_DRAFT, $id: DEFINITION_SCHEMA_URL, title: `@kjanat/dreamcli definition schema`, description: `Describes the structure of a CLI built with dreamcli \u2014 commands, flags, args, types, constraints, env bindings, and prompts.`, type: `object`, additionalProperties: false, properties: { $schema: { const: DEFINITION_SCHEMA_URL }, schemaVersion: { const: 1 }, name: { type: `string` }, version: { type: `string` }, description: { type: `string` }, envPrefix: ENV_PREFIX_PROPERTY, groupOrder: GROUP_ORDER_PROPERTY, defaultCommand: { $ref: `#/$defs/command` }, commands: { type: `array`, items: { $ref: `#/$defs/command` } } }, required: [`$schema`, `schemaVersion`, `name`, `commands`], $defs: { constraintInput: { type: `object`, additionalProperties: false, required: [`kind`, `name`], properties: { kind: { enum: [`flag`, `arg`] }, name: { type: `string` } } }, command: { type: `object`, additionalProperties: false, properties: commandFragmentProperties, required: [`name`, `flags`, `args`, `commands`] }, commandDocument: { type: `object`, additionalProperties: false, properties: { schemaVersion: { const: 1 }, envPrefix: ENV_PREFIX_PROPERTY, groupOrder: GROUP_ORDER_PROPERTY, ...commandFragmentProperties }, required: [`schemaVersion`, `name`, `flags`, `args`, `commands`] }, flag: { type: `object`, additionalProperties: false, properties: flagFragmentProperties, required: [`kind`, `presence`], not: { required: [`envVar`, `envIndexed`] }, dependentSchemas: { envAbsolute: { $ref: `#/$defs/envBound` } } }, flagElement: { type: `object`, additionalProperties: false, properties: flagElementFragmentProperties, required: [`kind`, `presence`] }, envBound: { anyOf: [{ required: [`envVar`] }, { required: [`envIndexed`] }] }, envIndexed: { type: `object`, additionalProperties: false, properties: { count: { type: `string`, minLength: 1, not: { pattern: `[{}=]` } }, value: { $ref: `#/$defs/envIndexedTemplate` }, fields: { type: `object`, minProperties: 1, propertyNames: { minLength: 1 }, additionalProperties: { $ref: `#/$defs/envIndexedTemplate` } } }, required: [`count`], oneOf: [{ required: [`value`], not: { required: [`fields`] } }, { required: [`fields`], not: { required: [`value`] } }] }, envIndexedTemplate: { type: `string`, pattern: `\\{index\\}`, not: { pattern: `=` } }, stdin: { type: `object`, additionalProperties: false, properties: { when: { enum: [`dash`, `missing`, `dash-or-missing`] }, consume: { enum: [`exclusive`, `broadcast`] }, trim: { type: `boolean` }, argv: { const: false } }, required: [`when`, `consume`] }, split: { type: `object`, additionalProperties: false, properties: { env: { $ref: `#/$defs/splitPolicy` }, stdin: { $ref: `#/$defs/splitPolicy` } } }, splitPolicy: { type: `object`, additionalProperties: false, properties: { format: { enum: [`whole`, `delimiter`, `lines`, `json`] }, delimiter: { type: `string`, minLength: 1 } }, required: [`format`], oneOf: [{ properties: { format: { const: `delimiter` } }, required: [`format`, `delimiter`] }, { properties: { format: { enum: [`whole`, `lines`, `json`] } }, not: { required: [`delimiter`] } }] }, negation: { type: `object`, additionalProperties: false, properties: { alias: { type: `string` }, hidden: { const: true } } }, numberConstraints: { type: `object`, additionalProperties: false, properties: { min: { type: `number` }, max: { type: `number` }, int: { type: `boolean` }, finite: { type: `boolean` } } }, stringConstraints: { type: `object`, additionalProperties: false, properties: { nonEmpty: { type: `boolean` }, minLength: { type: `integer`, minimum: 0 }, maxLength: { type: `integer`, minimum: 0 }, pattern: { type: `object`, additionalProperties: false, properties: { source: { type: `string` }, flags: { type: `string` } }, required: [`source`, `flags`] } } }, pathChecks: { type: `object`, additionalProperties: false, properties: { mustExist: { type: `boolean` }, type: { enum: [`file`, `directory`] }, create: { const: true } }, required: [`mustExist`] }, argElement: { type: `object`, additionalProperties: false, properties: argElementFragmentProperties, required: [`kind`, `presence`] }, arg: { type: `object`, additionalProperties: false, properties: { name: { type: `string` }, ...argValueFragmentProperties }, required: [`name`, `kind`, `presence`], anyOf: [{ not: { required: [`elementSchema`] } }, { properties: { kind: { const: `keyValue` } }, required: [`kind`] }], not: { required: [`envVar`, `envIndexed`] }, dependentSchemas: { envAbsolute: { $ref: `#/$defs/envBound` } } }, prompt: { type: `object`, additionalProperties: false, properties: { kind: { enum: [`confirm`, `input`, `password`, `select`, `multiselect`] }, message: { type: `string` }, placeholder: { type: `string` }, trim: { type: `boolean` }, empty: { enum: [`skip`, `accept`, `retry`] }, sensitive: { const: true }, choices: { type: `array`, items: { $ref: `#/$defs/choice` } }, min: { type: `integer` }, max: { type: `integer` } }, required: [`kind`, `message`] }, choice: { type: `object`, additionalProperties: false, properties: { value: { type: `string` }, label: { type: `string` }, description: { type: `string` } }, required: [`value`] }, example: { type: `object`, additionalProperties: false, properties: { command: { type: `string` }, description: { type: `string` } }, required: [`command`] } } }, definitionMetaSchemaDescriptions);
});

function createPromptSession(e) {
  let t = false;
  return { ask: async (n) => {
    if (t)
      throw new CLIError(`A prompt is already active in this session`, { code: `PROMPT_BUSY` });
    if (e.prompter === undefined)
      throw new CLIError(`Interactive input is unavailable`, { code: `PROMPT_UNAVAILABLE`, suggest: `Supply input through command arguments, environment, or config, or run in an interactive terminal` });
    t = true;
    try {
      let t = resolvePromptConfig(n, undefined), r = { ...t };
      (r.kind === `input` || r.kind === `password`) && (delete r.validate, r.empty = `accept`, r.kind === `input` && (r.trim = false, r.default !== undefined && (r.sensitive || (r.placeholder = [r.placeholder, `default: ${r.default}`].filter((e) => e !== undefined).join(`, `)), delete r.default)));
      for (let i = 0;i < 10; i++) {
        let i = await e.prompter.promptOne(r);
        if (!i.answered)
          throw i.reason === `invalid` ? new CLIError(`Too many invalid prompt answers`, { code: `PROMPT_INVALID`, exitCode: 2 }) : new PromptCancelledError;
        let a = i.value, o;
        if (n.kind === `input` || n.kind === `password`) {
          if (typeof a != `string`)
            o = `Please enter text.`;
          else {
            let e = await prepareTextAnswer(n, a);
            e.ok ? a = e.value : o = e.message;
          }
        } else if (n.kind === `confirm`)
          typeof a != `boolean` && (o = `Please answer yes or no.`);
        else {
          let e = t.kind === `select` || t.kind === `multiselect` ? t.choices : [];
          if (n.kind === `select`)
            e.some((e) => e.value === a) || (o = `Please select an available choice.`);
          else if (!Array.isArray(a) || !a.every((t) => e.some((e) => e.value === t)))
            o = `Please select available choices.`;
          else {
            let e = [...new Set(a)];
            a = e, n.min !== undefined && e.length < n.min && (o = `Please select at least ${n.min}.`), n.max !== undefined && e.length > n.max && (o = `Please select at most ${n.max}.`);
          }
        }
        if (o === undefined)
          return a;
        e.write?.(`${o}
`);
      }
      throw new CLIError(`Too many invalid prompt answers`, { code: `PROMPT_INVALID`, exitCode: 2 });
    } finally {
      t = false;
    }
  } };
}
var session_exports;
var init_session_Dqt1dpXp = __esm(() => {
  init_rolldown_runtime_DOYBPklu();
  init_core_uS8LDF4B();
  session_exports = /* @__PURE__ */ __exportAll({ createPromptSession: () => createPromptSession });
});

function createTestPrompter(e, t) {
  let n = 0;
  return { async promptOne(r) {
    for (let i = 0;i < 10; i++) {
      if (n >= e.length)
        return t?.onExhausted === `cancel` ? Promise.resolve({ answered: false }) : Promise.reject(/* @__PURE__ */ Error(`Test prompter exhausted: expected at most ${e.length} prompts, got prompt #${n + 1}`));
      let i = e[n];
      if (n += 1, i === PROMPT_CANCEL) {
        if (r.kind === `password`)
          throw new PromptCancelledError;
        return Promise.resolve({ answered: false });
      }
      if ((r.kind === `input` || r.kind === `password`) && typeof i == `string`) {
        let e = await prepareTextAnswer(r, i);
        if (!e.ok && (r.kind === `password` || e.reason === `empty`))
          continue;
        return e.ok ? { answered: true, value: e.value } : { answered: false };
      }
      return Promise.resolve({ answered: true, value: i });
    }
    if (r.kind !== `password`)
      return { answered: false, reason: `invalid` };
    throw new CLIError(`Too many invalid prompt answers`, { code: `PROMPT_INVALID`, exitCode: 2 });
  } };
}
var test_prompter_exports, PROMPT_CANCEL;
var init_test_prompter_CownSa7_ = __esm(() => {
  init_rolldown_runtime_DOYBPklu();
  init_core_uS8LDF4B();
  test_prompter_exports = /* @__PURE__ */ __exportAll({ createTestPrompter: () => createTestPrompter });
  PROMPT_CANCEL = Symbol.for(`dreamcli.prompt.cancel`);
});

function isPlainObject(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function parentDir(e) {
  let t = e.lastIndexOf(`/`), n = e.lastIndexOf(`\\`), r = Math.max(t, n), i = n > t ? `\\` : `/`;
  if (r < 0)
    return;
  if (r === 0)
    return e.length > 1 ? i : undefined;
  let a = e.slice(0, r);
  if (a.length === 2 && a[1] === `:`) {
    let t = `${a}${i}`;
    return t === e ? undefined : t;
  }
  return a;
}
function joinPath(e, t) {
  let n = e.includes(`\\`) ? `\\` : `/`;
  return e.endsWith(n) ? `${e}${t}` : `${e}${n}${t}`;
}
function manifestHasMetadata(e) {
  return e.name !== undefined || e.version !== undefined || e.description !== undefined || e.bin !== undefined || e.homepage !== undefined || e.repository !== undefined;
}
async function discoverManifest(e, t = {}) {
  let n = t.files ?? DEFAULT_MANIFEST_FILES, r = t.startDir ?? e.cwd;
  for (;r !== undefined; ) {
    for (let t of n) {
      let n = null;
      try {
        n = await e.readFile(joinPath(r, t));
      } catch {}
      if (n !== null) {
        let e = parsePackageJson(n);
        if (e !== null && manifestHasMetadata(e))
          return e;
      }
    }
    r = parentDir(r);
  }
  return null;
}
function isJsonWhitespace(e) {
  return e === ` ` || e === `	` || e === `
` || e === `\r`;
}
function stripJsonc(e) {
  let t = ``, n = false, r = false;
  for (let i = 0;i < e.length; i += 1) {
    let a = e[i] ?? ``;
    if (n)
      t += a, r ? r = false : a === `\\` ? r = true : a === `"` && (n = false);
    else if (a === `"`)
      n = true, t += a;
    else if (a === `/` && e[i + 1] === `/`) {
      for (i += 2;i < e.length && e[i] !== `
`; )
        i += 1;
      --i;
    } else if (a === `/` && e[i + 1] === `*`) {
      for (i += 2;i < e.length && (e[i] !== `*` || e[i + 1] !== `/`); )
        i += 1;
      i += 1;
    } else
      t += a;
  }
  let i = ``;
  n = false, r = false;
  for (let e = 0;e < t.length; e += 1) {
    let a = t[e] ?? ``;
    if (n)
      i += a, r ? r = false : a === `\\` ? r = true : a === `"` && (n = false);
    else if (a === `"`)
      n = true, i += a;
    else {
      if (a === `,`) {
        let n = e + 1;
        for (;n < t.length && isJsonWhitespace(t[n] ?? ``); )
          n += 1;
        let r = t[n];
        if (r === `}` || r === `]`)
          continue;
      }
      i += a;
    }
  }
  return i;
}
function parsePackageJson(e) {
  let t;
  try {
    t = JSON.parse(e);
  } catch {
    try {
      t = JSON.parse(stripJsonc(e));
    } catch {
      return null;
    }
  }
  try {
    if (!isPlainObject(t))
      return null;
    let e = typeof t.name == `string` ? t.name : undefined, n = typeof t.version == `string` ? t.version : undefined, r = typeof t.description == `string` ? t.description : undefined, i = parseBinField(t.bin), a = typeof t.homepage == `string` ? t.homepage : undefined, o = parseRepositoryField(t.repository);
    return { ...e === undefined ? {} : { name: e }, ...n === undefined ? {} : { version: n }, ...r === undefined ? {} : { description: r }, ...i === undefined ? {} : { bin: i }, ...a === undefined ? {} : { homepage: a }, ...o === undefined ? {} : { repository: o } };
  } catch {
    return null;
  }
}
function parseBinField(e) {
  if (typeof e == `string`)
    return e;
  if (!isPlainObject(e))
    return;
  let t = {};
  for (let [n, r] of Object.entries(e)) {
    if (typeof r != `string`)
      return;
    t[n] = r;
  }
  return t;
}
function parseRepositoryField(e) {
  if (typeof e == `string`)
    return e;
  if (!isPlainObject(e))
    return;
  let t = typeof e.type == `string` ? e.type : undefined, n = typeof e.url == `string` ? e.url : undefined, r = typeof e.directory == `string` ? e.directory : undefined;
  if (t !== undefined || n !== undefined || r !== undefined)
    return { ...t === undefined ? {} : { type: t }, ...n === undefined ? {} : { url: n }, ...r === undefined ? {} : { directory: r } };
}
function inferCliName(e, t = {}) {
  if (typeof e.bin == `object`) {
    let t = Object.keys(e.bin);
    if (t.length > 0 && t[0] !== undefined)
      return t[0];
  }
  if (e.name !== undefined) {
    if (t.stripScope === false)
      return e.name;
    let n = e.name.indexOf(`/`);
    return n >= 0 ? e.name.slice(n + 1) : e.name;
  }
}
var package_json_exports, DEFAULT_MANIFEST_FILES;
var init_package_json_hqUWeazy = __esm(() => {
  init_rolldown_runtime_DOYBPklu();
  package_json_exports = /* @__PURE__ */ __exportAll({ discoverManifest: () => discoverManifest, inferCliName: () => inferCliName });
  DEFAULT_MANIFEST_FILES = [`package.json`];
});

function isPlainObject2(e) {
  if (typeof e != `object` || !e || Array.isArray(e))
    return false;
  let t = Object.getPrototypeOf(e);
  return t === Object.prototype || t === null;
}
function joinPath2(e, ...t) {
  let n = e.includes(`\\`) ? `\\` : `/`;
  return [e.endsWith(n) ? e.slice(0, -1) : e, ...t].join(n);
}
function ancestorDirs(e) {
  let t = e.includes(`\\`) ? `\\` : `/`, n = e;
  for (;n.length > 1 && n.endsWith(t) && !n.endsWith(`:${t}`); )
    n = n.slice(0, -1);
  let r = [n];
  for (;; ) {
    let e = n.lastIndexOf(t);
    if (e < 0)
      break;
    let i = n.slice(0, e);
    if (i === `` ? i = t : /^[A-Za-z]:$/.test(i) && (i = `${i}${t}`), i === n)
      break;
    r.push(i), n = i;
  }
  return r;
}
function getExtension(e) {
  let t = e.lastIndexOf(`.`);
  return t <= Math.max(e.lastIndexOf(`/`), e.lastIndexOf(`\\`)) ? `` : e.slice(t + 1).toLowerCase();
}
function buildConfigSearchPaths(e, t) {
  let n = buildExtensionList(t.loaders), r = [];
  for (let i of ancestorDirs(t.baseDir)) {
    for (let t of n)
      r.push(joinPath2(i, `.${e}.${t}`));
    for (let t of n)
      r.push(joinPath2(i, `${e}.config.${t}`));
    for (let t of n)
      r.push(joinPath2(i, `.config`, `${e}.${t}`));
  }
  for (let i of t.userConfigDirs)
    for (let t of n)
      r.push(joinPath2(i, e, `config.${t}`));
  for (let i of t.systemConfigDirs ?? [])
    for (let t of n)
      r.push(joinPath2(i, e, `config.${t}`));
  return r;
}
function buildExtensionList(e) {
  let t = /* @__PURE__ */ new Set, n = [];
  for (let e of jsonLoader.extensions) {
    let r = e.toLowerCase();
    t.has(r) || (t.add(r), n.push(r));
  }
  if (e !== undefined)
    for (let r of e)
      for (let e of r.extensions) {
        let r = e.toLowerCase();
        t.has(r) || (t.add(r), n.push(r));
      }
  return n;
}
function buildLoaderMap(e) {
  let t = /* @__PURE__ */ new Map;
  for (let e of jsonLoader.extensions)
    t.set(e.toLowerCase(), jsonLoader);
  if (e !== undefined)
    for (let n of e)
      for (let e of n.extensions)
        t.set(e.toLowerCase(), n);
  return t;
}
async function discoverConfig(e, t, n) {
  let r = buildLoaderMap(n?.loaders), i = n?.configPath === undefined ? n?.searchPaths ?? buildConfigSearchPaths(e, { baseDir: n?.baseDir ?? t.cwd, userConfigDirs: t.userConfigDirs ?? [t.configDir], systemConfigDirs: t.systemConfigDirs ?? [], ...n?.loaders === undefined ? {} : { loaders: n.loaders } }) : [n.configPath];
  for (let e of i) {
    let i = await t.readFile(e);
    if (i === null) {
      if (n?.configPath !== undefined)
        throw new CLIError(`Config file not found: ${e}`, { code: `CONFIG_NOT_FOUND`, details: { path: e }, suggest: `Create the config file or remove the --config flag` });
      continue;
    }
    let a = getExtension(e), o = r.get(a);
    if (o === undefined)
      throw new CLIError(`No loader registered for config format: .${a}`, { code: `CONFIG_UNKNOWN_FORMAT`, details: { path: e, extension: a }, suggest: `Supported formats: ${[...r.keys()].join(`, `)}` });
    try {
      let n = `parse` in o ? o.parse(i) : await o.load(e, t);
      if (!isPlainObject2(n))
        throw Error(`Config loader must return a plain object`);
      return { found: true, path: e, data: n, format: a };
    } catch (t) {
      throw new CLIError(`Failed to parse config file: ${e}`, { code: `CONFIG_PARSE_ERROR`, cause: t, details: { path: e, format: a, message: t instanceof Error ? t.message : String(t) }, suggest: `parse` in o ? `Check the config file for syntax errors` : `Check that the config loader can load this file and returns a plain object` });
    }
  }
  return { found: false };
}
var config_exports, jsonLoader;
var init_config_4N4Lsyr8 = __esm(() => {
  init_rolldown_runtime_DOYBPklu();
  init_core_uS8LDF4B();
  config_exports = /* @__PURE__ */ __exportAll({ discoverConfig: () => discoverConfig });
  jsonLoader = { extensions: [`json`], parse: (e) => {
    let t = JSON.parse(e);
    if (typeof t != `object` || !t || Array.isArray(t))
      throw Error(`Config must be a JSON object`);
    return t;
  } };
});

function createTerminalPrompter(e, t, n) {
  return { promptOne(r) {
    switch (r.kind) {
      case `confirm`:
        return promptConfirm(r, e, t);
      case `input`:
        return promptInput(r, e, t);
      case `password`: {
        let e = n?.readSecret;
        return e === undefined ? Promise.reject(new CLIError(`Hidden password input is unavailable`, { code: `PROMPT_UNSUPPORTED`, suggest: `Use a runtime adapter or prompt engine with hidden-input support` })) : promptInput(r, async () => {
          try {
            let t = await e();
            if (t === null)
              throw new PromptCancelledError(`eof`);
            return t;
          } finally {
            t(`
`);
          }
        }, t);
      }
      case `select`:
        return promptSelect(r, e, t);
      case `multiselect`:
        return promptMultiselect(r, e, t);
    }
  } };
}
async function promptConfirm(e, t, n) {
  let r = e.default ?? true, i = 0;
  for (;i < 10; ) {
    let a = e.sensitive ? `(y/n)` : r ? `(Y/n)` : `(y/N)`;
    n(`${e.message} ${a} `);
    let o = await t();
    if (o === null)
      return { answered: false };
    let s = o.trim().toLowerCase();
    if (s === ``)
      return { answered: true, value: r };
    if (s === `y` || s === `yes`)
      return { answered: true, value: true };
    if (s === `n` || s === `no`)
      return { answered: true, value: false };
    n(`Please answer y or n.
`), i += 1;
  }
  return n(`Too many invalid attempts.
`), { answered: false, reason: `invalid` };
}
async function promptInput(e, t, n) {
  let r = 0, i = [];
  e.kind === `input` && e.placeholder !== undefined && i.push(e.placeholder), e.kind === `input` && e.default !== undefined && !e.sensitive && i.push(`default: ${e.default}`);
  let a = i.length > 0 ? ` (${i.join(`, `)})` : ``;
  for (;r < 10; ) {
    n(`${e.message}${a}: `);
    let i = await t();
    if (i === null)
      return { answered: false };
    let o = await prepareTextAnswer(e, i);
    if (o.ok)
      return { answered: true, value: o.value };
    n(`${o.message}
`), r += 1;
  }
  if (e.kind === `password`)
    throw new CLIError(`Too many invalid prompt answers`, { code: `PROMPT_INVALID`, exitCode: 2 });
  return n(`Too many invalid attempts.
`), { answered: false, reason: `invalid` };
}
async function promptSelect(e, t, n) {
  let r = 0;
  for (;r < 10; ) {
    n(`${e.message}
`);
    for (let t = 0;t < e.choices.length; t += 1) {
      let r = e.choices[t];
      if (r === undefined)
        continue;
      let i = r.label ?? r.value, a = r.description === undefined ? `` : ` - ${r.description}`;
      n(`  ${t + 1}) ${i}${a}
`);
    }
    n(`Enter number: `);
    let i = await t();
    if (i === null)
      return { answered: false };
    let a = Number(i.trim());
    if (Number.isNaN(a) || !Number.isInteger(a) || a < 1 || a > e.choices.length) {
      n(`Please enter a number between 1 and ${e.choices.length}.
`), r += 1;
      continue;
    }
    let o = e.choices[a - 1];
    if (o === undefined)
      r += 1;
    else
      return { answered: true, value: o.value };
  }
  return n(`Too many invalid attempts.
`), { answered: false, reason: `invalid` };
}
async function promptMultiselect(e, t, n) {
  let r = 0;
  for (;r < 10; ) {
    n(`${e.message}
`);
    for (let t = 0;t < e.choices.length; t += 1) {
      let r = e.choices[t];
      if (r === undefined)
        continue;
      let i = r.label ?? r.value, a = r.description === undefined ? `` : ` - ${r.description}`;
      n(`  ${t + 1}) ${i}${a}
`);
    }
    n(`Enter numbers separated by commas (e.g. 1,3${e.min === undefined ? `` : `, min: ${e.min}`}${e.max === undefined ? `` : `, max: ${e.max}`}): `);
    let i = await t();
    if (i === null)
      return { answered: false };
    let a = i.trim();
    if (a === ``) {
      if (e.min !== undefined && e.min > 0) {
        n(`Please select at least ${e.min}.
`), r += 1;
        continue;
      }
      return { answered: true, value: [] };
    }
    let o = a.split(`,`).map((e) => e.trim()), s = [], c = true;
    for (let t of o) {
      let r = Number(t);
      if (Number.isNaN(r) || !Number.isInteger(r) || r < 1 || r > e.choices.length) {
        n(`Invalid selection '${t}'. Use numbers between 1 and ${e.choices.length}.
`), c = false;
        break;
      }
      s.push(r);
    }
    if (!c) {
      r += 1;
      continue;
    }
    let l = [...new Set(s)];
    if (e.min !== undefined && l.length < e.min)
      n(`Please select at least ${e.min}.
`), r += 1;
    else if (e.max !== undefined && l.length > e.max)
      n(`Please select at most ${e.max}.
`), r += 1;
    else
      return { answered: true, value: l.map((t) => e.choices[t - 1]?.value ?? ``) };
  }
  return n(`Too many invalid attempts.
`), { answered: false, reason: `invalid` };
}
var terminal_exports;
var init_terminal_C8qksD05 = __esm(() => {
  init_rolldown_runtime_DOYBPklu();
  init_core_uS8LDF4B();
  terminal_exports = /* @__PURE__ */ __exportAll({ createTerminalPrompter: () => createTerminalPrompter });
});

var DREAMCLI_VERSION = `5.5.0`, DREAMCLI_REVISION = `8a59960`;
var init_version = () => {};

function versionTag() {
  let e = ` (${DREAMCLI_REVISION})`;
  return `@kjanat/dreamcli v${DREAMCLI_VERSION}${e}`;
}
function programTag(e) {
  return e.version === undefined ? e.name : `${e.name} v${e.version}`;
}
function resolveRootCompletionSurface(e, t = `subcommands`) {
  let n = resolveRootSurface(e), r = createRootFlags(builtinEnabled(e.builtins, `help`), e.version !== undefined, e.versionAlias), i = n.visibleDefaultCommand?.flags ?? {}, a = t === `surface` ? n.hasVisibleDefault : n.hasVisibleDefault && !n.hasVisibleSubcommands, o = n.visibleDefaultCommand, s = o !== undefined && n.visibleCommands.some((e) => e.name === o.name);
  return { visibleCommands: n.defaultRouted && o !== undefined && !s ? [o, ...n.visibleCommands] : n.defaultRouted ? n.visibleCommands : n.visibleSubcommands, visibleDefaultCommand: n.visibleDefaultCommand, rootFlags: r, defaultFlags: i, includeDefaultFlags: a };
}
function createRootFlags(e, t, n) {
  return { ...e ? { help: createSyntheticRootFlag(`Show help text`) } : {}, ...t ? { version: createFlagSchema(`boolean`, { description: `Show version`, aliases: n === undefined ? [] : [n] }) } : {} };
}
function createSyntheticRootFlag(e) {
  return createFlagSchema(`boolean`, { description: e });
}
function walkCommandTree(e, t = []) {
  let n = [];
  for (let r of e) {
    if (r.hidden)
      continue;
    let e = [...t, r], i = collectPropagatedFlags(e), a = { ...i, ...r.flags }, o = r.commands.filter((e) => !e.hidden);
    n.push({ path: e.map((e) => e.name), schema: r, propagatedFlags: i, mergedFlags: a, children: o }), o.length > 0 && n.push(...walkCommandTree(o, e));
  }
  return n;
}
function sanitizeShellIdentifier(e) {
  let t = e.replace(/[^a-zA-Z0-9_]/g, `_`);
  if (t === e)
    return t;
  let n = 2166136261;
  for (let t = 0;t < e.length; t += 1)
    n ^= e.charCodeAt(t), n = Math.imul(n, 16777619);
  return `${t}_${(n >>> 0).toString(16).padStart(8, `0`)}`;
}
function quoteShellArg(e) {
  return /^[a-zA-Z0-9_\-.]+$/.test(e) ? e : `'${e.replace(/'/g, `'\\''`)}'`;
}
function hasDynamicCompletion(e) {
  let t = (e) => e.constraints?.some(excludesOtherInputs) || Object.values(e.flags).some((e) => acceptsArgv(e) && e.completion !== undefined) || e.args.some((e) => acceptsArgv(e.schema) && e.schema.completion !== undefined) || e.commands.some(t);
  return e.commands.some(t) || e.defaultCommand !== undefined && t(e.defaultCommand);
}
function hasCompletionConflicts(e) {
  let t = (e) => (e.constraints?.some(excludesOtherInputs) ?? false) || e.commands.some(t);
  return e.commands.some(t) || e.defaultCommand !== undefined && t(e.defaultCommand);
}
function separateBooleanForms(e, t) {
  return [...buildFlagLookup(e, t)].flatMap(([e, t]) => !t.negated && t.schema.separateValue === true ? [`--${e}`] : []);
}
function generateBashCompletion(e, t) {
  let n = `_${sanitizeShellIdentifier(t?.functionPrefix ?? e.name)}_completions`, r = resolveRootCompletionSurface(e, t?.rootMode), i = r.visibleCommands, a = walkCommandTree(i), o = a.reduce((e, t) => Math.max(e, t.path.length), 0), s = [];
  if (s.push(`#!/usr/bin/env bash`), s.push(`# Bash completion for ${programTag(e)}`), s.push(`# Generated by ${versionTag()}`), s.push(`#`), s.push(`# Usage:  source <(${e.name} completions bash)`), s.push(`#`), s.push(`# Install permanently:`), s.push(`#   ${e.name} completions bash > /etc/bash_completion.d/${e.name}    # Linux`), s.push(`#   ${e.name} completions bash > $(brew --prefix)/etc/bash_completion.d/${e.name}  # macOS`), s.push(`#`), s.push(`# Requires: bash-completion (provides _init_completion)`), s.push(``), hasDynamicCompletion(e) && (s.push(`${n}_unquote() {`), s.push(`	local text="$1" char escaped=0 i`), s.push(`	unquoted="" quote=""`), s.push("\tfor ((i = 0; i < ${#text}; i++)); do"), s.push('\t\tchar="${text:i:1}"'), s.push(`		if ((escaped)); then`), s.push(`			[[ "$quote" == '"' && "$char" != [\\\\\\"\\$\\\`] ]] && unquoted+='\\'`), s.push(`			unquoted+="$char"; escaped=0`), s.push(`		elif [[ "$char" == '\\' && "$quote" != "'" ]]; then`), s.push(`			escaped=1`), s.push(`		elif [[ -n "$quote" ]]; then`), s.push(`			if [[ "$char" == "$quote" ]]; then quote=""; else unquoted+="$char"; fi`), s.push(`		elif [[ "$char" == "'" || "$char" == '"' ]]; then`), s.push(`			quote="$char"`), s.push(`		else`), s.push(`			unquoted+="$char"`), s.push(`		fi`), s.push(`	done`), s.push(`	((escaped)) && unquoted+='\\'`), s.push(`	return 0`), s.push(`}`), s.push(``)), s.push(`${n}() {`), s.push(`	local cur prev words cword`), s.push(hasDynamicCompletion(e) ? `	_init_completion -n =: || return` : `	_init_completion || return`), s.push(`	local readline_prefix=""`), s.push(`	if [[ $# -ge 2 && "$cur" == *"$2" ]]; then`), s.push('\t\treadline_prefix="${cur%"$2"}"'), s.push(`	fi`), hasDynamicCompletion(e) && (s.push(`	local dynamic candidate unquoted quote readline_quote word char i quoted`), s.push(`	${n}_unquote "$readline_prefix"`), s.push(`	readline_prefix="$unquoted" readline_quote="$quote"`), s.push(`	local -a dynamic_words=()`), s.push('\tfor word in "${words[@]:1:cword-1}" "$cur"; do'), s.push(`		${n}_unquote "$word"`), s.push(`		dynamic_words+=("$unquoted")`), s.push(`	done`), s.push(`	if dynamic=$(command ${quoteShellArg(e.name)} __complete -- "\${dynamic_words[@]}" 2>/dev/null); then`), s.push(`		compopt -o noquote 2>/dev/null`), s.push(`		COMPREPLY=()`), s.push(`		while IFS= read -r candidate; do`), s.push(`			[[ -n "$candidate" ]] || continue`), s.push('\t\t\tcandidate="${candidate#"$readline_prefix"}"'), s.push(`			if [[ -z "$readline_quote" ]]; then`), s.push(`				printf -v candidate %q "$candidate"`), s.push(`			else`), s.push(`				quoted="$readline_quote"`), s.push("\t\t\t\tfor ((i = 0; i < ${#candidate}; i++)); do"), s.push('\t\t\t\t\tchar="${candidate:i:1}"'), s.push(`					if [[ "$readline_quote" == '"' && "$char" == [\\\\\\"\\$\\\`] ]]; then quoted+='\\'; fi`), s.push(`					if [[ "$readline_quote" == "'" && "$char" == "'" ]]; then quoted+="'\\\\''"; else quoted+="$char"; fi`), s.push(`				done`), s.push(`				candidate="$quoted"`), s.push(`			fi`), s.push(`			COMPREPLY+=("$candidate")`), s.push(`		done <<< "$dynamic"`), s.push(`		return`), s.push(`	fi`)), s.push(``), i.length > 0) {
    let t = a.filter((e) => e.children.length > 0), n = collectValueFlagPattern(a, r), c = [...new Set([r.defaultFlags, ...a.map((e) => e.mergedFlags)].flatMap((t) => separateBooleanForms(t, e.flagSettings)))].map(escapeBashCasePatternValue).join(`|`);
    s.push(`	# Build subcommand path by scanning COMP_WORDS`), s.push(`	local subcmd_path=""`), s.push(`	local i`), s.push(`	for ((i = 1; i < cword; i++)); do`), s.push('\t\tcase "${words[i]}" in'), s.push(`			--) break ;;`), n.length > 0 && s.push(`			${n}) ((i++)); continue ;;`), c.length > 0 && (s.push(`			${c})`), s.push(`				if ((i + 1 < cword)); then`), s.push('\t\t\t\t\tcase "${words[i+1]}" in true|false|1|0) ((i++)) ;; esac'), s.push(`				fi; continue ;;`)), s.push(`			-*) continue ;;`), s.push(`		esac`), emitBashPathDetection(s, i, t, o), s.push(`	done`), s.push(``), s.push(`	# Complete flags and subcommands for the active path`), s.push(`	case "$subcmd_path" in`);
    for (let e of a) {
      let t = e.path.join(` `), n = e.mergedFlags, r = collectEnumCasesFromFlags(n), i = collectFlagWords(n), a = dedupeWords(e.children.flatMap((e) => [e.name, ...e.aliases])).map(escapeForSingleQuote).join(` `), o = i.split(` `).filter(Boolean).map(escapeForSingleQuote).join(` `), c = a.length > 0 ? `${a} ${o}` : o;
      if (s.push(`		${quoteShellCasePattern(t)})`), r.length > 0) {
        s.push(`			local enum_flag=""`), s.push(`			local enum_cur="$cur"`), s.push(`			local enum_prefix=""`), s.push(`			if [[ "$cur" == --*=* ]]; then`), s.push('\t\t\t\tenum_flag="${cur%%=*}"'), s.push('\t\t\t\tenum_cur="${cur#*=}"'), s.push('\t\t\t\tenum_prefix="${cur%%=*}="'), s.push(`			fi`), s.push('\t\t\tcase "${enum_flag:-$prev}" in');
        for (let e of r)
          s.push(`				${e.flags})`), s.push(formatBashEnumCompletion(e.values, `					`, `enum_cur`, `enum_prefix`)), s.push(`					return`), s.push(`					;;`);
        s.push(`				*)`), s.push(`					;;`), s.push(`			esac`);
      }
      s.push(`			COMPREPLY=($(compgen -W '${c.trim()}' -- "$cur"))`), s.push(`			return`), s.push(`			;;`);
    }
    s.push(`		*)`), s.push(`			;;`), s.push(`	esac`), s.push(``);
    let l = collectFlagWords(r.rootFlags).split(` `).filter(Boolean), u = r.includeDefaultFlags ? collectFlagWords(r.defaultFlags).split(` `).filter(Boolean) : [], d = dedupeWords([...i.flatMap((e) => [e.name, ...e.aliases]), ...l, ...u]).map(escapeForSingleQuote).join(` `);
    s.push(`	# Root-level completions: visible root surface`), s.push(`	COMPREPLY=($(compgen -W '${d}' -- "$cur"))`);
  } else {
    let e = collectFlagWords({ ...r.rootFlags, ...r.includeDefaultFlags ? r.defaultFlags : {} });
    s.push(`	COMPREPLY=($(compgen -W '${e}' -- "$cur"))`);
  }
  return s.push(`}`), s.push(``), s.push(`complete -F ${n} ${quoteShellArg(e.name)}`), s.push(``), s.join(`
`);
}
function emitBashPathDetection(e, t, n, r) {
  e.push(`		case "$subcmd_path" in`), e.push(`			'')`), e.push('\t\t\t\tcase "${words[i]}" in');
  for (let n of t) {
    let t = [n.name, ...n.aliases].map(escapeBashCasePatternValue);
    e.push(`					${t.join(`|`)})`), e.push(`						subcmd_path="${escapeBashDoubleQuotedValue(n.name)}"`), e.push(`						;;`);
  }
  if (e.push(`				esac`), e.push(`				;;`), r > 1)
    for (let t of n) {
      let n = t.path.join(` `);
      e.push(`			${quoteShellCasePattern(n)})`), e.push('\t\t\t\tcase "${words[i]}" in');
      for (let n of t.children) {
        let t = [n.name, ...n.aliases].map(escapeBashCasePatternValue);
        e.push(`					${t.join(`|`)})`), e.push(`						subcmd_path="$subcmd_path ${escapeBashDoubleQuotedValue(n.name)}"`), e.push(`						;;`);
      }
      e.push(`				esac`), e.push(`				;;`);
    }
  e.push(`		esac`);
}
function quoteShellCasePattern(e) {
  return e.includes(` `) ? `"${escapeBashDoubleQuotedValue(e)}"` : escapeBashCasePatternValue(e);
}
function escapeBashCasePatternValue(e) {
  return /^[a-zA-Z0-9_\-.]+$/.test(e) ? e : e.replace(/\\/g, `\\\\`).replace(/'/g, `\\'`).replace(/"/g, `\\"`).replace(/\|/g, `\\|`).replace(/\*/g, `\\*`).replace(/\?/g, `\\?`).replace(/\[/g, `\\[`).replace(/\]/g, `\\]`).replace(/\(/g, `\\(`).replace(/\)/g, `\\)`).replace(/\{/g, `\\{`).replace(/\}/g, `\\}`).replace(/\+/g, `\\+`).replace(/!/g, `\\!`).replace(/@/g, `\\@`).replace(/#/g, `\\#`).replace(/~/g, `\\~`).replace(/\s/g, (e) => e === ` ` ? `\\ ` : `\\${e}`);
}
function escapeBashDoubleQuotedValue(e) {
  return e.replace(/\\/g, `\\\\`).replace(/"/g, `\\"`).replace(/\$/g, `\\$`).replace(/`/g, "\\`");
}
function escapeForSingleQuote(e) {
  return /^[a-zA-Z0-9_\-.]+$/.test(e) ? e : e.replace(/'/g, `'\\''`);
}
function formatBashEnumCompletion(e, t, n = `cur`, r) {
  let i = [];
  if (e.some((e) => !/^[a-zA-Z0-9_\-.]+$/.test(e))) {
    let r = e.map(escapeBashDollarQuote).join(`\\n`);
    i.push(`${t}local IFS=$'\\n'`), i.push(`${t}COMPREPLY=($(compgen -W $'${r}' -- "$${n}"))`);
  } else
    i.push(`${t}COMPREPLY=($(compgen -W '${e.join(` `)}' -- "$${n}"))`);
  return r !== undefined && (i.push(`${t}if [[ -n "$${r}" && "\${#COMPREPLY[@]}" -gt 0 ]]; then`), i.push(`${t}	local i`), i.push(`${t}	for ((i = 0; i < \${#COMPREPLY[@]}; i++)); do`), i.push(`${t}		COMPREPLY[i]="$${r}\${COMPREPLY[i]}"`), i.push(`${t}	done`), i.push(`${t}fi`)), i.push(`${t}local reply`), i.push(`${t}for reply in "\${!COMPREPLY[@]}"; do`), i.push(`${t}	COMPREPLY[reply]="\${COMPREPLY[reply]#"$readline_prefix"}"`), i.push(`${t}done`), i.join(`
`);
}
function escapeBashDollarQuote(e) {
  return e.replace(/\\/g, `\\\\`).replace(/'/g, `\\'`).replace(/\n/g, `\\n`);
}
function collectFlagWords(e) {
  let t = [];
  for (let [n, r] of Object.entries(e)) {
    if (!acceptsArgv(r))
      continue;
    t.push(`--${n}`);
    for (let e of getFlagAliasNames(r))
      t.push(e.length === 1 ? `-${e}` : `--${e}`);
    let e = getVisibleNegatedName(n, r);
    e !== undefined && t.push(`--${e}`);
  }
  return t.join(` `);
}
function collectValueFlagPattern(e, t) {
  let n = /* @__PURE__ */ new Set, r = (e) => {
    for (let [t, r] of Object.entries(e))
      if (acceptsArgv(r) && flagExpectsValue(r)) {
        n.add(`--${t}`);
        for (let e of getFlagAliasNames(r, { includeHidden: true }))
          n.add(e.length === 1 ? `-${e}` : `--${e}`);
      }
  };
  for (let t of e)
    r(t.mergedFlags);
  return r(t.rootFlags), t.includeDefaultFlags && r(t.defaultFlags), [...n].map(escapeBashCasePatternValue).join(`|`);
}
function dedupeWords(e) {
  return [...new Set(e)];
}
function collectEnumCasesFromFlags(e) {
  let t = [];
  for (let [n, r] of Object.entries(e)) {
    if (!acceptsArgv(r))
      continue;
    let e = r.kind === `keyValue` ? undefined : valueEnumValues(flagValueSchema(r));
    if (e === undefined)
      continue;
    let i = [`--${n}`, ...getFlagAliasNames(r, { includeHidden: true }).map((e) => e.length === 1 ? `-${e}` : `--${e}`)].map(escapeBashCasePatternValue);
    t.push({ flags: i.join(`|`), values: e });
  }
  return t;
}
function generateFishCompletion(e, t) {
  let n = `__${sanitizeShellIdentifier(t?.functionPrefix ?? e.name)}_completions`, r = `${n}_path`, i = `${n}_path_is`, a = `${n}_allows_flag`, o = resolveRootCompletionSurface(e, t?.rootMode), s = o.visibleCommands, c = walkCommandTree(s), l = quoteShellArg(e.name), u = [];
  u.push(`# Fish completion for ${programTag(e)}`), u.push(`# Generated by ${versionTag()}`), u.push(`#`), u.push(`# Usage:  source (${e.name} completions fish | psub)`), u.push(`#`), u.push(`# Install permanently:`), u.push(`#   ${e.name} completions fish > ~/.config/fish/completions/${e.name}.fish`), u.push(``), u.push(`complete -c ${l} -f`), u.push(``), hasDynamicCompletion(e) && (u.push(`function ${n}_dynamic`), u.push(`	set -l words (commandline -xpc)`), u.push(`	set -l raw (commandline -ct)`), u.push(`	set -l prefix (commandline --input "$raw" --tokens-expanded)`), u.push(`	command ${l} __complete --value-only -- $words[2..-1] "$prefix" 2>/dev/null`), u.push(`end`), u.push(`complete -c ${l} -f -a '(${n}_dynamic)'`), u.push(``)), hasCompletionConflicts(e) && (u.push(`function ${a}`), u.push(`	set -l words (commandline -xpc)`), u.push(`	not contains -- "$argv[1]" (command ${l} __complete --blocked-flags -- $words[2..-1] 2>/dev/null)`), u.push(`end`), u.push(``)), emitFishPathHelpers(u, r, i, s, c, o, e.flagSettings), appendFishCommandCompletions(u, l, i, ``, s), appendFishFlagCompletions(u, l, i, ``, o.rootFlags, `${n}_dynamic`), o.includeDefaultFlags && appendFishFlagCompletions(u, l, i, ``, o.defaultFlags, `${n}_dynamic`, fishFlagGuard(a, o.visibleDefaultCommand));
  for (let e of c) {
    let t = e.path.join(` `);
    appendFishCommandCompletions(u, l, i, t, e.children), appendFishFlagCompletions(u, l, i, t, e.mergedFlags, `${n}_dynamic`, fishFlagGuard(a, e.schema));
  }
  return u.join(`
`);
}
function fishFlagGuard(e, t) {
  return { helper: e, names: new Set(t?.constraints?.filter(excludesOtherInputs).flatMap(({ inputs: e }) => e.filter(({ kind: e }) => e === `flag`).map(({ name: e }) => e))) };
}
function emitFishPathHelpers(e, t, n, r, i, a, o) {
  let s = collectFishValueFlagPatterns(i, a, o);
  e.push(`function ${t}`), e.push(`	set -l words (commandline -xpc)`), e.push(`	if test (count $words) -gt 0`), e.push(`		set -e words[1]`), e.push(`	end`), e.push(`	set -l subcmd_path ''`), e.push(`	set -l expect_value 0`), e.push(`	for word in $words`), e.push(`		if test $expect_value -eq 1`), e.push(`			set expect_value 0`), e.push(`			continue`), e.push(`		end`), s.separate.length > 0 && (e.push(`		if test $expect_value -eq 2`), e.push(`			set expect_value 0`), e.push(`			if contains -- "$word" true false 1 0`), e.push(`				continue`), e.push(`			end`), e.push(`		end`)), e.push(`		switch $word`), e.push(`			case '--'`), e.push(`				break`), s.exact.length > 0 && (e.push(`			case ${s.exact.map(quoteShellArg).join(` `)}`), e.push(`				set expect_value 1`), e.push(`				continue`)), s.separate.length > 0 && (e.push(`			case ${s.separate.map(quoteShellArg).join(` `)}`), e.push(`				set expect_value 2`), e.push(`				continue`)), s.prefix.length > 0 && (e.push(`			case ${s.prefix.map(quoteShellArg).join(` `)}`), e.push(`				continue`)), e.push(`			case '-*'`), e.push(`				continue`), e.push(`		end`), e.push(`		switch "$subcmd_path|$word"`);
  for (let t of r)
    for (let n of [t.name, ...t.aliases])
      e.push(`			case ${quoteShellArg(`|${n}`)}`), e.push(`				set subcmd_path ${quoteShellArg(t.name)}`);
  for (let t of i)
    for (let n of t.children)
      for (let r of [n.name, ...n.aliases])
        e.push(`			case ${quoteShellArg(`${t.path.join(` `)}|${r}`)}`), e.push(`				set subcmd_path ${quoteShellArg(`${t.path.join(` `)} ${n.name}`)}`);
  e.push(`			case '*'`), e.push(`				break`), e.push(`		end`), e.push(`	end`), e.push(`	printf '%s\\n' "$subcmd_path"`), e.push(`end`), e.push(``), e.push(`function ${n}`), e.push(`	set -l expected "$argv[1]"`), e.push(`	test (${t}) = "$expected"`), e.push(`end`), e.push(``);
}
function appendFishCommandCompletions(e, t, n, r, i) {
  let a = buildFishCondition(n, r);
  for (let n of i) {
    let r = quoteShellArg(resolvePlainHelpDescription(n.description ?? n.name));
    for (let i of [n.name, ...n.aliases])
      e.push(`complete -c ${t} -n "${a}" -a ${quoteShellArg(i)} -d ${r}`);
  }
  i.length > 0 && e.push(``);
}
function appendFishFlagCompletions(e, t, n, r, i, a, o) {
  let s = buildFishCondition(n, r);
  for (let [n, r] of Object.entries(i)) {
    if (!acceptsArgv(r))
      continue;
    let i = o?.names.has(n) === true, c = [`complete -c ${t}`, i ? `-n ${quoteShellArg(`${s}; and ${o.helper} ${quoteShellArg(n)}`)}` : `-n "${s}"`];
    for (let e of getFlagAliasNames(r, { kind: `short` }))
      c.push(`-s ${quoteShellArg(e)}`);
    c.push(`-l ${quoteShellArg(n)}`);
    for (let e of getFlagAliasNames(r, { kind: `long` }))
      c.push(`-l ${quoteShellArg(e)}`);
    let l = getVisibleNegatedName(n, r);
    if (l !== undefined && !i && c.push(`-l ${quoteShellArg(l)}`), c.push(`-d ${quoteShellArg(r.description === undefined ? n : resolvePlainHelpDescription(r.description))}`), l !== undefined && i) {
      let i = quoteShellArg(r.description === undefined ? n : resolvePlainHelpDescription(r.description));
      e.push(`complete -c ${t} -n "${s}" -l ${quoteShellArg(l)} -d ${i}`);
    }
    flagExpectsValue(r) && c.push(`-r`, `-f`), r.completion !== undefined && c.push(`-a '(${a})'`);
    let u = r.kind === `keyValue` ? undefined : valueEnumValues(flagValueSchema(r));
    if (u !== undefined && r.completion === undefined)
      for (let t of u)
        e.push([...c, `-a ${quoteShellArg(t)}`].join(` `));
    else
      e.push(c.join(` `));
  }
  Object.keys(i).length > 0 && e.push(``);
}
function collectFishValueFlagPatterns(e, t, n) {
  let r = /* @__PURE__ */ new Set, i = /* @__PURE__ */ new Set, a = [t.rootFlags, ...t.includeDefaultFlags ? [t.defaultFlags] : [], ...e.map((e) => e.mergedFlags)];
  for (let e of a)
    for (let [t, n] of Object.entries(e))
      if (acceptsArgv(n) && flagExpectsValue(n)) {
        r.add(`--${t}`), i.add(`--${t}=*`);
        for (let e of getFlagAliasNames(n, { kind: `short`, includeHidden: true }))
          r.add(`-${e}`), i.add(`-${e}*`);
        for (let e of getFlagAliasNames(n, { kind: `long`, includeHidden: true }))
          r.add(`--${e}`), i.add(`--${e}=*`);
      }
  return { exact: [...r], prefix: [...i], separate: [...new Set([t.defaultFlags, ...e.map((e) => e.mergedFlags)].flatMap((e) => separateBooleanForms(e, n)))] };
}
function buildFishCondition(e, t) {
  return `${e} ${quoteShellArg(t)}`;
}
function generatePowerShellCompletion(e, t) {
  let n = `__${sanitizeShellIdentifier(t?.functionPrefix ?? e.name)}_completions`, r = `${n}_paths`, i = resolveRootCompletionSurface(e, t?.rootMode), a = i.visibleCommands, o = walkCommandTree(a), s = hasCompletionConflicts(e), c = [];
  c.push(`# PowerShell completion for ${programTag(e)}`), c.push(`# Generated by ${versionTag()}`), c.push(`#`), c.push(`# Install for the current session:`), c.push(`#   ${e.name} completions powershell | Out-String | Invoke-Expression`), c.push(`#`), c.push(`# Install permanently:`), c.push(`#   ${e.name} completions powershell > $PROFILE.CurrentUserCurrentHost`), c.push(``), c.push(`using namespace System.Management.Automation`), c.push(`using namespace System.Management.Automation.Language`), c.push(``), emitPowerShellPathTable(c, r, i, o, s, e.flagSettings), c.push(``), emitPowerShellHelpers(c, n, r, s), c.push(``), c.push(`Register-ArgumentCompleter -Native -CommandName ${quotePowerShellString(e.name)} -ScriptBlock {`), c.push(`	param($wordToComplete, $commandAst, $cursorPosition)`), hasDynamicCompletion(e) && (c.push(`	$dynamicArgs = [System.Collections.Generic.List[string]]::new()`), c.push(`	$dynamicArgs.Add('__complete')`), s && c.push(`	$dynamicArgs.Add('--values')`), c.push(`	$dynamicArgs.Add('--')`), c.push(`	$currentText = $wordToComplete`), c.push(`	foreach ($element in $commandAst.CommandElements | Select-Object -Skip 1) {`), c.push(`		if ($element.Extent.StartOffset -gt $cursorPosition) { break }`), c.push(`		if ($element.Extent.EndOffset -ge $cursorPosition) {`), c.push(`			$currentText = $element.Extent.Text.Substring(0, $cursorPosition - $element.Extent.StartOffset)`), c.push(`			break`), c.push(`		}`), c.push(`		$dynamicArgs.Add((${n}_UnquoteToken $element.Extent.Text))`), c.push(`	}`), c.push(`	$dynamicArgs.Add((${n}_UnquoteToken $currentText))`), c.push(`	$dynamic = & ${quotePowerShellString(e.name)} @dynamicArgs 2>$null`), c.push(`	if ($LASTEXITCODE -eq 0) {`), c.push(`		foreach ($candidate in $dynamic) {`), c.push(`			$text = ${n}_FormatCompletionValue -Value $candidate`), c.push(`			[CompletionResult]::new($text, $candidate, [CompletionResultType]::ParameterValue, $candidate)`), c.push(`		}`), c.push(`		return`), c.push(`	}`)), c.push(`	$state = ${n}_GetState -CommandAst $commandAst -CursorPosition $cursorPosition`), c.push(`	if ($null -eq $state.PathData) {`), c.push(`		return`), c.push(`	}`), c.push(``), c.push(`	$results = [System.Collections.Generic.List[CompletionResult]]::new()`), c.push(`	if ($state.AfterSeparator) {`), c.push(`		return $results`), c.push(`	}`), c.push(``), c.push(`	$wordPrefix = if ([string]::IsNullOrEmpty($wordToComplete)) { '' } else { $wordToComplete }`), c.push(``), c.push(`	if ($state.ExpectingValue) {`), c.push(`		${n}_AddEnumResults -Results $results -Flag $state.ValueFlag -WordToComplete $wordPrefix`), c.push(`		return $results`), c.push(`	}`), c.push(``), c.push(`	$inlineValue = ${n}_ResolveInlineValueCompletion -PathData $state.PathData -WordToComplete $wordPrefix`), c.push(`	if ($null -ne $inlineValue) {`), c.push(`		${n}_AddInlineEnumResults -Results $results -InlineValue $inlineValue -WordToComplete $wordPrefix`), c.push(`		return $results`), c.push(`	}`), c.push(``), s && (c.push(`	$dynamicArgs.RemoveAt($dynamicArgs.Count - 1)`), c.push(`	$dynamicArgs[1] = '--blocked-flags'`), c.push(`	$blockedFlags = @(& ${quotePowerShellString(e.name)} @dynamicArgs 2>$null)`));
  let l = s ? ` -BlockedFlags $blockedFlags` : ``;
  return c.push(`	if ($wordPrefix.StartsWith('-')) {`), c.push(`		${n}_AddFlagResults -Results $results -PathData $state.PathData -WordToComplete $wordPrefix${l}`), c.push(`		return $results`), c.push(`	}`), c.push(``), c.push(`	${n}_AddCommandResults -Results $results -PathData $state.PathData -WordToComplete $wordPrefix`), c.push(`	${n}_AddFlagResults -Results $results -PathData $state.PathData -WordToComplete $wordPrefix${l}`), c.push(`	return $results`), c.push(`}`), c.join(`
`);
}
function emitPowerShellPathTable(e, t, n, r, i, a) {
  e.push(`$script:${t} = @{`), appendPowerShellPathEntry(e, ``, n.visibleCommands, { ...n.rootFlags, ...n.includeDefaultFlags ? n.defaultFlags : {} }, i, a, n.defaultFlags);
  for (let t of r)
    appendPowerShellPathEntry(e, t.path.join(` `), t.children, t.mergedFlags, i, a);
  e.push(`}`);
}
function appendPowerShellPathEntry(e, t, n, r, i, a, o = r) {
  e.push(`	${quotePowerShellString(t)} = @{`), e.push(`		SeparateBooleanForms = ${formatPowerShellArray(separateBooleanForms(o, a))}`), e.push(`		Commands = @(`);
  for (let t of n)
    e.push(`			@{`), e.push(`				CanonicalName = ${quotePowerShellString(t.name)}`), e.push(`				Names = ${formatPowerShellArray([t.name, ...t.aliases])}`), e.push(`				Description = ${quotePowerShellString(resolvePlainHelpDescription(t.description ?? t.name))}`), e.push(`			}`);
  e.push(`		)`), e.push(`		Flags = @(`);
  for (let [t, n] of Object.entries(r)) {
    if (!acceptsArgv(n))
      continue;
    let r = getVisibleNegatedName(t, n), a = getFlagNegatedName(t, n), o = dedupeValues([`--${t}`, ...getFlagAliasNames(n, { kind: `short` }).map((e) => `-${e}`), ...getFlagAliasNames(n, { kind: `long` }).map((e) => `--${e}`), ...r === undefined ? [] : [`--${r}`]]), s = dedupeValues([`--${t}`, ...getFlagAliasNames(n, { kind: `short`, includeHidden: true }).map((e) => `-${e}`), ...getFlagAliasNames(n, { kind: `long`, includeHidden: true }).map((e) => `--${e}`), ...a === undefined ? [] : [`--${a}`]]);
    if (e.push(`			@{`), e.push(`				CanonicalName = ${quotePowerShellString(t)}`), e.push(`				Forms = ${formatPowerShellArray(o)}`), i) {
      let t = r === undefined ? `$null` : quotePowerShellString(`--${r}`);
      e.push(`				NegatedForm = ${t}`);
    }
    e.push(`				ParseForms = ${formatPowerShellArray(s)}`), e.push(`				RequiresValue = ${flagExpectsValue(n) ? `$true` : `$false`}`), e.push(`				Description = ${quotePowerShellString(n.description === undefined ? t : resolvePlainHelpDescription(n.description))}`), e.push(`				EnumValues = ${formatPowerShellArray((n.kind === `keyValue` ? undefined : valueEnumValues(flagValueSchema(n))) ?? [])}`), e.push(`			}`);
  }
  e.push(`		)`), e.push(`	}`);
}
function emitPowerShellHelpers(e, t, n, r) {
  e.push(`function ${t}_UnquoteToken {`), e.push(`	param([string]$TokenText)`), e.push(...String.raw`
	$result = [System.Text.StringBuilder]::new()
	$quote = [char]0
	for ($i = 0; $i -lt $TokenText.Length; $i++) {
		$char = $TokenText[$i]
		if ($quote -eq "'") {
			if ($char -eq "'") {
				if ($i + 1 -lt $TokenText.Length -and $TokenText[$i + 1] -eq "'") {
					[void]$result.Append("'")
					$i++
				} else { $quote = [char]0 }
			} else { [void]$result.Append($char) }
		} elseif ($char -eq [char]96) {
			if ($i + 1 -lt $TokenText.Length) {
				$i++
				$escaped = $TokenText[$i]
				$decoded = switch -CaseSensitive ($escaped) {
					'0' { [char]0 }
					'a' { [char]7 }
					'b' { [char]8 }
					'e' { [char]27 }
					'f' { [char]12 }
					'n' { [char]10 }
					'r' { [char]13 }
					't' { [char]9 }
					'v' { [char]11 }
					'u' {
						$match = [regex]::Match($TokenText.Substring($i + 1), '^\{([0-9a-fA-F]{1,6})\}')
						if ($match.Success) {
							$codepoint = [Convert]::ToInt32($match.Groups[1].Value, 16)
							if ($codepoint -le 0x10ffff -and ($codepoint -lt 0xd800 -or $codepoint -gt 0xdfff)) {
								$i += $match.Length
								[char]::ConvertFromUtf32($codepoint)
							} else { $escaped }
						} else { $escaped }
					}
					default { $escaped }
				}
				[void]$result.Append($decoded)
			} else { [void]$result.Append($char) }
		} elseif ($quote -eq '"') {
			if ($char -eq '"') {
				if ($i + 1 -lt $TokenText.Length -and $TokenText[$i + 1] -eq '"') {
					[void]$result.Append('"')
					$i++
				} else { $quote = [char]0 }
			} else { [void]$result.Append($char) }
		} elseif ($char -eq "'" -or $char -eq '"') {
			$quote = $char
		} else { [void]$result.Append($char) }
	}
	return $result.ToString()
`.trimEnd().split(`
`).slice(1)), e.push(`}`), e.push(``), e.push(`function ${t}_FindCommand {`), e.push(`	param($PathData, [string]$Token)`), e.push(`	foreach ($command in $PathData.Commands) {`), e.push(`		foreach ($name in $command.Names) {`), e.push(`			if ($name -eq $Token) {`), e.push(`				return $command`), e.push(`			}`), e.push(`		}`), e.push(`	}`), e.push(`	return $null`), e.push(`}`), e.push(``), e.push(`function ${t}_ResolveFlagToken {`), e.push(`	param($PathData, [string]$Token)`), e.push(`	foreach ($flag in $PathData.Flags) {`), e.push(`		foreach ($form in $flag.ParseForms) {`), e.push(`			if ($Token -eq $form) {`), e.push(`				return @{ Flag = $flag; InlinePrefix = $null }`), e.push(`			}`), e.push(``), e.push(`			if (-not $flag.RequiresValue) {`), e.push(`				continue`), e.push(`			}`), e.push(``), e.push(`			if ($form.StartsWith('--') -and $Token.StartsWith("$form=")) {`), e.push(`				return @{ Flag = $flag; InlinePrefix = "$form=" }`), e.push(`			}`), e.push(``), e.push(`			if ($form.StartsWith('-') -and -not $form.StartsWith('--') -and $Token.StartsWith($form) -and $Token.Length -gt $form.Length) {`), e.push(`				return @{ Flag = $flag; InlinePrefix = $form }`), e.push(`			}`), e.push(`		}`), e.push(`	}`), e.push(`	return $null`), e.push(`}`), e.push(``), e.push(`function ${t}_GetState {`), e.push(`	param([CommandAst]$CommandAst, [int]$CursorPosition)`), e.push(`	$pathData = $script:${n}[${quotePowerShellString(``)}]`), e.push(`	$path = ""`), e.push(`	$afterSeparator = $false`), e.push(`	$expectingValue = $false`), e.push(`	$maybeBooleanValue = $false`), e.push(`	$valueFlag = $null`), e.push(`	$tokens = [System.Collections.Generic.List[string]]::new()`), e.push(``), e.push(`	foreach ($element in $CommandAst.CommandElements | Select-Object -Skip 1) {`), e.push(`		if ($element.Extent.EndOffset -ge $CursorPosition) {`), e.push(`			break`), e.push(`		}`), e.push(`		$tokenText = ${t}_UnquoteToken $element.Extent.Text`), e.push(`		[void]$tokens.Add($tokenText)`), e.push(`	}`), e.push(``), e.push(`	foreach ($token in $tokens) {`), e.push(`		if ($maybeBooleanValue) {`), e.push(`			$maybeBooleanValue = $false`), e.push(`			if (@('true', 'false', '1', '0') -ccontains $token) { continue }`), e.push(`		}`), e.push(`		if ($expectingValue) {`), e.push(`			$expectingValue = $false`), e.push(`			$valueFlag = $null`), e.push(`			continue`), e.push(`		}`), e.push(``), e.push(`		if ($token -eq '--') {`), e.push(`			$afterSeparator = $true`), e.push(`			break`), e.push(`		}`), e.push(``), e.push(`		if ($pathData.SeparateBooleanForms -ccontains $token) {`), e.push(`			$maybeBooleanValue = $true`), e.push(`			continue`), e.push(`		}`), e.push(`		$flagMatch = ${t}_ResolveFlagToken -PathData $pathData -Token $token`), e.push(`		if ($null -ne $flagMatch) {`), e.push(`			if ($flagMatch.InlinePrefix -eq $null -and $flagMatch.Flag.RequiresValue) {`), e.push(`				$expectingValue = $true`), e.push(`				$valueFlag = $flagMatch.Flag`), e.push(`			}`), e.push(`			continue`), e.push(`		}`), e.push(``), e.push(`		if ($token.StartsWith('-')) {`), e.push(`			continue`), e.push(`		}`), e.push(``), e.push(`		$command = ${t}_FindCommand -PathData $pathData -Token $token`), e.push(`		if ($null -eq $command) {`), e.push(`			break`), e.push(`		}`), e.push(``), e.push(`		$path = if ([string]::IsNullOrEmpty($path)) {`), e.push(`			$command.CanonicalName`), e.push(`		} else {`), e.push(`			"$path $($command.CanonicalName)"`), e.push(`		}`), e.push(`		$nextPathData = $script:${n}[$path]`), e.push(`		if ($null -eq $nextPathData) {`), e.push(`			break`), e.push(`		}`), e.push(`		$pathData = $nextPathData`), e.push(`	}`), e.push(``), e.push(`	return @{`), e.push(`		Path = $path`), e.push(`		PathData = $pathData`), e.push(`		AfterSeparator = $afterSeparator`), e.push(`		ExpectingValue = $expectingValue`), e.push(`		ValueFlag = $valueFlag`), e.push(`	}`), e.push(`}`), e.push(``), e.push(`function ${t}_ResolveInlineValueCompletion {`), e.push(`	param($PathData, [string]$WordToComplete)`), e.push(`	$flagMatch = ${t}_ResolveFlagToken -PathData $PathData -Token $WordToComplete`), e.push(`	if ($null -eq $flagMatch -or $flagMatch.InlinePrefix -eq $null) {`), e.push(`		return $null`), e.push(`	}`), e.push(`	return $flagMatch`), e.push(`}`), e.push(``), e.push(`function ${t}_FormatCompletionValue {`), e.push(`	param([string]$Value)`), e.push(`	if ($Value.Length -eq 0) {`), e.push(`		return "''"`), e.push(`	}`), e.push(``), e.push(`	if ($Value -match '^[a-zA-Z0-9_./:\\\\-]+$') {`), e.push(`		return $Value`), e.push(`	}`), e.push(``), e.push(`	return "'$([CodeGeneration]::EscapeSingleQuotedStringContent($Value))'"`), e.push(`}`), e.push(``), e.push(`function ${t}_MatchesCompletionPrefix {`), e.push(`	param([string]$WordToComplete, [string]$RawText, [string]$CompletionText)`), e.push(`	if ([string]::IsNullOrEmpty($WordToComplete)) {`), e.push(`		return $true`), e.push(`	}`), e.push(``), e.push(`	return $RawText.StartsWith($WordToComplete, [System.StringComparison]::OrdinalIgnoreCase) -or $CompletionText.StartsWith($WordToComplete, [System.StringComparison]::OrdinalIgnoreCase)`), e.push(`}`), e.push(``), e.push(`function ${t}_AddCommandResults {`), e.push(`	param($Results, $PathData, [string]$WordToComplete)`), e.push(`	foreach ($command in $PathData.Commands) {`), e.push(`		foreach ($name in $command.Names) {`), e.push(`			if (-not [string]::IsNullOrEmpty($WordToComplete) -and -not $name.StartsWith($WordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {`), e.push(`				continue`), e.push(`			}`), e.push(``), e.push(`			$Results.Add([CompletionResult]::new(`), e.push(`				$name,`), e.push(`				$name,`), e.push(`				[CompletionResultType]::Command,`), e.push(`				$command.Description`), e.push(`			))`), e.push(`		}`), e.push(`	}`), e.push(`}`), e.push(``), e.push(`function ${t}_AddFlagResults {`), e.push(r ? `	param($Results, $PathData, [string]$WordToComplete, [string[]]$BlockedFlags)` : `	param($Results, $PathData, [string]$WordToComplete)`), e.push(`	foreach ($flag in $PathData.Flags) {`), e.push(`		foreach ($form in $flag.Forms) {`), r && e.push(`			if ($BlockedFlags -ccontains $flag.CanonicalName -and $form -cne $flag.NegatedForm) { continue }`), e.push(`			if (-not [string]::IsNullOrEmpty($WordToComplete) -and -not $form.StartsWith($WordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {`), e.push(`				continue`), e.push(`			}`), e.push(``), e.push(`			$Results.Add([CompletionResult]::new(`), e.push(`				$form,`), e.push(`				$form,`), e.push(`				[CompletionResultType]::ParameterName,`), e.push(`				$flag.Description`), e.push(`			))`), e.push(`		}`), e.push(`	}`), e.push(`}`), e.push(``), e.push(`function ${t}_AddEnumResults {`), e.push(`	param($Results, $Flag, [string]$WordToComplete)`), e.push(`	foreach ($value in $Flag.EnumValues) {`), e.push(`		$completionText = ${t}_FormatCompletionValue -Value $value`), e.push(`		if (-not (${t}_MatchesCompletionPrefix -WordToComplete $WordToComplete -RawText $value -CompletionText $completionText)) {`), e.push(`			continue`), e.push(`		}`), e.push(``), e.push(`		$Results.Add([CompletionResult]::new(`), e.push(`			$completionText,`), e.push(`			$value,`), e.push(`			[CompletionResultType]::ParameterValue,`), e.push(`			$Flag.Description`), e.push(`		))`), e.push(`	}`), e.push(`}`), e.push(``), e.push(`function ${t}_AddInlineEnumResults {`), e.push(`	param($Results, $InlineValue, [string]$WordToComplete)`), e.push(`	foreach ($value in $InlineValue.Flag.EnumValues) {`), e.push(`		$rawCompletion = "$($InlineValue.InlinePrefix)$value"`), e.push(`		$formattedValue = ${t}_FormatCompletionValue -Value $value`), e.push(`		$completionText = "$($InlineValue.InlinePrefix)$formattedValue"`), e.push(`		if (-not (${t}_MatchesCompletionPrefix -WordToComplete $WordToComplete -RawText $rawCompletion -CompletionText $completionText)) {`), e.push(`			continue`), e.push(`		}`), e.push(``), e.push(`		$Results.Add([CompletionResult]::new(`), e.push(`			$completionText,`), e.push(`			$value,`), e.push(`			[CompletionResultType]::ParameterValue,`), e.push(`			$InlineValue.Flag.Description`), e.push(`		))`), e.push(`	}`), e.push(`}`);
}
function quotePowerShellString(e) {
  return `'${e.replace(/'/g, `''`)}'`;
}
function formatPowerShellArray(e) {
  return e.length === 0 ? `@()` : `@(${e.map(quotePowerShellString).join(`, `)})`;
}
function dedupeValues(e) {
  return [...new Set(e)];
}
function generateZshCompletion(e, t) {
  let n = `_${sanitizeShellIdentifier(t?.functionPrefix ?? e.name)}`, r = resolveRootCompletionSurface(e, t?.rootMode), i = r.visibleCommands, a = walkCommandTree(i), o = [];
  o.push(`#compdef ${quoteShellArg(e.name)}`), o.push(`# Zsh completion for ${programTag(e)}`), o.push(`# Generated by ${versionTag()}`), o.push(`#`), o.push(`# Usage:  source <(${e.name} completions zsh)`), o.push(`#`), o.push(`# Install permanently:`), o.push(`#   ${e.name} completions zsh > "\${fpath[1]}/_${e.name}"`), o.push(`#   # Then restart your shell`), o.push(``);
  let s = a.filter((e) => e.children.length > 0), c = a.filter((e) => e.children.length === 0);
  for (let e of c)
    e.path.length < 2 || emitZshLeafFunction(o, `${n}_${e.path.map(sanitizeShellIdentifier).join(`_`)}`, e);
  let l = [...s].sort((e, t) => t.path.length - e.path.length);
  for (let e of l)
    emitZshGroupFunction(o, `${n}_${e.path.map(sanitizeShellIdentifier).join(`_`)}`, n, e);
  if (o.push(`${n}() {`), hasDynamicCompletion(e) && (o.push(`	local dynamic word current_prefix=$PREFIX`), o.push(`	local -a dynamic_words=()`), o.push('\tfor word in "${words[@]:1:$((CURRENT-2))}"; do'), o.push('\t\tdynamic_words+=("${(Q)word}")'), o.push(`	done`), o.push(`	if [[ $compstate[quoting] = (single|double) ]]; then`), o.push(`		current_prefix="$compstate[quote]$PREFIX$compstate[quote]"`), o.push(`	fi`), o.push('\tdynamic_words+=("${(Q)current_prefix}")'), o.push(`	if dynamic=$(command ${quoteShellArg(e.name)} __complete -- "\${dynamic_words[@]}" 2>/dev/null); then`), o.push(`		local -a candidates`), o.push(`		if [[ -n "$dynamic" ]]; then`), o.push('\t\t\tcandidates=("${(@f)dynamic}")'), o.push(`			compadd -a candidates`), o.push(`		fi`), o.push(`		return`), o.push(`	fi`)), i.length > 0) {
    o.push(`	local -a subcmds`), o.push(`	local line state`), o.push(``);
    let e = buildZshFlagSpecsFromFlags({ ...r.rootFlags, ...r.includeDefaultFlags ? r.defaultFlags : {} });
    o.push(`	_arguments -C \\`);
    for (let t of e)
      o.push(`		${t} \\`);
    o.push(`		'1: :->subcmd' \\`), o.push(`		'*::arg:->args'`), o.push(``), o.push(`	case "$state" in`), o.push(`		subcmd)`), o.push(`			subcmds=(`), appendZshCommandCandidates(o, i, `				`), o.push(`			)`), o.push(`			_describe 'command' subcmds`), o.push(`			;;`), o.push(`		args)`), o.push(`			case "$line[1]" in`);
    for (let e of i) {
      let t = [e.name, ...e.aliases].map(escapeZshCasePatternValue), r = e.commands.filter((e) => !e.hidden);
      if (o.push(`				${t.join(`|`)})`), r.length > 0) {
        let t = `${n}_${sanitizeShellIdentifier(e.name)}`;
        o.push(`					${t}`);
      } else {
        let t = a.find((t) => t.path.length === 1 && t.schema.name === e.name);
        if (t === undefined)
          throw new CLIError(`Missing completion node for command '${e.name}'`, { code: `UNEXPECTED_ERROR` });
        let n = buildZshFlagSpecsFromFlags(t.mergedFlags);
        if (n.length > 0) {
          o.push(`					_arguments \\`);
          for (let e = 0;e < n.length; e++) {
            let t = e < n.length - 1 ? ` \\` : ``;
            o.push(`						${n[e]}${t}`);
          }
        }
      }
      o.push(`					;;`);
    }
    o.push(`			esac`), o.push(`			;;`), o.push(`	esac`);
  } else {
    let e = buildZshFlagSpecsFromFlags({ ...r.rootFlags, ...r.includeDefaultFlags ? r.defaultFlags : {} });
    o.push(`	_arguments \\`);
    for (let t = 0;t < e.length; t++) {
      let n = t < e.length - 1 ? ` \\` : ``;
      o.push(`		${e[t]}${n}`);
    }
  }
  return o.push(`}`), o.push(``), o.push(`compdef ${n} ${quoteShellArg(e.name)}`), o.push(``), o.join(`
`);
}
function emitZshGroupFunction(e, t, n, r) {
  e.push(`${t}() {`), e.push(`	local -a subcmds`), e.push(`	local line state`), e.push(``);
  let i = buildZshFlagSpecsFromFlags(r.mergedFlags);
  e.push(`	_arguments -C \\`);
  for (let t of i)
    e.push(`		${t} \\`);
  e.push(`		'1: :->subcmd' \\`), e.push(`		'*::arg:->args'`), e.push(``), e.push(`	case "$state" in`), e.push(`		subcmd)`), e.push(`			subcmds=(`), appendZshCommandCandidates(e, r.children, `				`), e.push(`			)`), e.push(`			_describe 'command' subcmds`), e.push(`			;;`), e.push(`		args)`), e.push(`			case "$line[1]" in`);
  for (let t of r.children) {
    let i = [t.name, ...t.aliases].map(escapeZshCasePatternValue), a = `${n}_${[...r.path, t.name].map(sanitizeShellIdentifier).join(`_`)}`;
    e.push(`				${i.join(`|`)})`), e.push(`					${a}`), e.push(`					;;`);
  }
  e.push(`			esac`), e.push(`			;;`), e.push(`	esac`), e.push(`}`), e.push(``);
}
function emitZshLeafFunction(e, t, n) {
  let r = buildZshFlagSpecsFromFlags(n.mergedFlags);
  if (e.push(`${t}() {`), r.length > 0) {
    e.push(`	_arguments \\`);
    for (let t = 0;t < r.length; t++) {
      let n = t < r.length - 1 ? ` \\` : ``;
      e.push(`		${r[t]}${n}`);
    }
  }
  e.push(`}`), e.push(``);
}
function appendZshCommandCandidates(e, t, n) {
  for (let r of t) {
    let t = resolvePlainHelpDescription(r.description ?? r.name);
    for (let i of [r.name, ...r.aliases])
      e.push(`${n}${quoteShellArg(`${i}:${t}`)}`);
  }
}
function escapeZshCasePatternValue(e) {
  return /^[a-zA-Z0-9_\-.]+$/.test(e) ? e : e.replace(/\\/g, `\\\\`).replace(/'/g, `\\'`).replace(/"/g, `\\"`).replace(/`/g, "\\`").replace(/\|/g, `\\|`).replace(/\*/g, `\\*`).replace(/\?/g, `\\?`).replace(/\[/g, `\\[`).replace(/\]/g, `\\]`).replace(/\(/g, `\\(`).replace(/\)/g, `\\)`).replace(/\{/g, `\\{`).replace(/\}/g, `\\}`).replace(/\+/g, `\\+`).replace(/!/g, `\\!`).replace(/@/g, `\\@`).replace(/#/g, `\\#`).replace(/~/g, `\\~`).replace(/\s/g, (e) => e === ` ` ? `\\ ` : `\\${e}`);
}
function escapeZshDescription(e) {
  return e.replace(/\\/g, `\\\\`).replace(/\]/g, `\\]`);
}
function buildZshFlagSpecsFromFlags(e) {
  let t = [];
  for (let [n, r] of Object.entries(e)) {
    if (!acceptsArgv(r))
      continue;
    let e = escapeZshDescription(r.description === undefined ? n : resolvePlainHelpDescription(r.description)), i = `--${n}`, a = getFlagAliasNames(r, { kind: `short` }).map((e) => `-${e}`), o = getFlagAliasNames(r, { kind: `long` }).map((e) => `--${e}`), s = getVisibleNegatedName(n, r), c = s === undefined ? [] : [`--${s}`], l = [...a, i, ...o, ...c], u = r.kind === `keyValue` ? undefined : valueEnumValues(flagValueSchema(r)), d = ``;
    if (flagExpectsValue(r) && (d = u === undefined ? `:value:` : `:value:(${u.map(escapeZshEnumValue).join(` `)})`), l.length > 1) {
      let n = l.map(escapeZshCasePatternValue).join(`,`);
      t.push(`${quoteShellArg(`(${l.join(` `)})`)}{${n}}${quoteShellArg(`[${e}]${d}`)}`);
    } else
      t.push(quoteShellArg(`${i}[${e}]${d}`));
  }
  return t;
}
function escapeZshEnumValue(e) {
  return /^[a-zA-Z0-9_\-.]+$/.test(e) ? e : e.replace(/\\/g, `\\\\`).replace(/ /g, `\\ `).replace(/\(/g, `\\(`).replace(/\)/g, `\\)`);
}
function generateCompletion(e, t, n) {
  switch (t) {
    case `bash`:
      return generateBashCompletion(e, n);
    case `zsh`:
      return generateZshCompletion(e, n);
    case `fish`:
      return generateFishCompletion(e, n);
    case `powershell`:
      return generatePowerShellCompletion(e, n);
  }
}
var completion_exports;
var init_completion_D_kRNOTC = __esm(() => {
  init_rolldown_runtime_DOYBPklu();
  init_core_uS8LDF4B();
  init_version();
  completion_exports = /* @__PURE__ */ __exportAll({ generateCompletion: () => generateCompletion });
});

function completionPosition(e, t, n, r) {
  let i = (e.configSettings === undefined ? undefined : extractConfigFlag(n, e.configSettings.noConfigFlag))?.filteredArgv ?? n, a = readRootOutputFlags(i, e.builtins).argv, o = resolveRootSurface(e).visibleDefaultCommand, s = e.defaultCommandRouted && t.defaultCommand !== undefined ? [...t.commands, t.defaultCommand] : t.commands, c = dispatch(a, buildRootCommandMap(s), [], buildFlagLookup(e.defaultCommand?.flags ?? {}, e.flagSettings), e.flagSettings);
  if (c.kind === `unknown` && (c.parentPath.length > 0 || o === undefined || t.defaultCommand === undefined || !canDelegateUnknownRootToDefault(t.defaultCommand, c.input) || c.input !== `` && findClosestCommand(c.input, c.candidates) !== undefined))
    return;
  let l = c.kind === `unknown` ? o : c.command.schema;
  if (l === undefined)
    return;
  let u = c.kind === `unknown` ? [] : c.commandPath, d = c.kind === `unknown` ? a : c.remainingArgv, f = { ...collectPropagatedFlags(u), ...l.flags }, p = l.args.filter((e) => acceptsArgv(e.schema)), m = 0, h = false, g, _ = buildFlagLookup(f, e.flagSettings), v = l.constraints?.some(excludesOtherInputs) ? /* @__PURE__ */ new Map : undefined, y = 0;
  for (let [t, n] of d.entries())
    if (y > 0)
      y--;
    else if (g !== undefined)
      g = undefined;
    else if (!h && n === `--`)
      h = true;
    else if (!h && n.startsWith(`-`) && n !== `-`) {
      if (BUILTIN_NAMES.some((t) => builtinEnabled(e.builtins, t) && (BUILTIN_SPECS[t].short.includes(n) || BUILTIN_SPECS[t].long.some((e) => n === e || n.startsWith(`${e}=`)))) || e.version !== undefined && (n === `--version` || n === `-${e.versionAlias ?? `V`}`))
        continue;
      let i = matchFlag(n, _);
      if (i === undefined || i.entry.negated && i.inline !== undefined)
        return;
      let a = adjacentArgvValue(d, t), o = i.inline === undefined && n.startsWith(`--`) && consumesSeparateBoolean(i.entry, a) ? a : undefined;
      if (v !== undefined) {
        if (!n.startsWith(`--`))
          for (let e of n.slice(1)) {
            let t = _.get(e);
            if (t === undefined || flagExpectsValue(t.schema))
              break;
            recordActiveFlag(v, t, undefined);
          }
        recordActiveFlag(v, i.entry, i.inline ?? o);
      }
      if (n.startsWith(`--`) && i.entry.schema.variadic === true) {
        if (y = variadicLongValueCount(d, t, _, i.inline !== undefined), t + y === d.length - 1 && r !== undefined && variadicLongValueCount(d, t, _, i.inline !== undefined, r) > y) {
          g = i.entry;
          break;
        }
      } else
        i.inline === undefined && (flagExpectsValue(i.entry.schema) || o !== undefined) && (g = i.entry);
    } else {
      if (p[m] === undefined && !p[p.length - 1]?.schema.variadic)
        return;
      m++;
    }
  return { command: l, path: u, result: c, flags: f, args: p, positional: m, afterSeparator: h, pending: g, lookup: _, activeFlags: v };
}
function recordActiveFlag(e, t, n) {
  let { name: r, schema: i, negated: a } = t;
  if (i.duplicates === `first` && e.has(r))
    return;
  let o = !a;
  if (i.kind === `boolean` && n !== undefined)
    try {
      o = coerceFlagValue(r, n, i) === true;
    } catch {
      return;
    }
  e.set(r, o);
}
function blockedFlagNames(e) {
  let t = /* @__PURE__ */ new Set;
  if (e.activeFlags === undefined || e.afterSeparator)
    return t;
  let n = new Set(e.args.slice(0, e.positional).map(({ name: e }) => e));
  for (let r of e.command.constraints ?? []) {
    if (!excludesOtherInputs(r))
      continue;
    let i = r.inputs.filter(({ kind: t, name: r }) => t === `flag` ? e.activeFlags?.get(r) === true : n.has(r));
    for (let e of r.inputs)
      e.kind === `flag` && i.some((t) => t !== e) && t.add(e.name);
  }
  return t;
}
function findCompletion(e, t, n) {
  let { args: r, path: i, result: a, positional: o, afterSeparator: s, pending: c, lookup: l } = e, u = t[t.length - 1] ?? ``, d = ``, f, p, m = [];
  if (c !== undefined)
    f = { kind: `flag`, name: c.name }, p = c.schema.completion;
  else if (!s && u.startsWith(`-`)) {
    let e = matchFlag(u, l);
    if (e?.inline === undefined || e.entry.negated)
      return;
    f = { kind: `flag`, name: e.entry.name }, p = e.entry.schema.completion, d = u.slice(0, u.length - e.inline.length), u = e.inline;
  } else {
    let e = r[o] ?? (r[r.length - 1]?.schema.variadic ? r[r.length - 1] : undefined);
    if (e === undefined)
      return;
    o === 0 && !s && (m = (a.kind === `unknown` ? a.candidates : [...new Set(a.command.subcommands.values())]).filter((e) => !e.schema.hidden).flatMap((e) => [e.schema.name, ...e.schema.aliases])), f = { kind: `arg`, name: e.name }, p = e.schema.completion;
  }
  if (p !== undefined)
    return { handler: p, tokenPrefix: d, commandCandidates: m, context: { prefix: u, commandPath: i.map((e) => e.name), input: f, argv: t, env: n } };
}
function matchFlag(e, t) {
  if (e.startsWith(`--`)) {
    let n = e.indexOf(`=`), r = t.get(e.slice(2, n < 0 ? undefined : n));
    return r === undefined ? undefined : { entry: r, inline: n < 0 ? undefined : e.slice(n + 1) };
  }
  for (let n = 1;n < e.length; n++) {
    let r = t.get(e[n] ?? ``);
    if (r === undefined)
      return;
    if (flagExpectsValue(r.schema) || n === e.length - 1)
      return { entry: r, inline: n === e.length - 1 ? undefined : e.slice(n + 1) };
  }
}
async function completeValues(e, t, n, r, i) {
  if (e.configSettings?.noConfigFlag === true && extractConfigFlag(n, true).error !== undefined)
    return { exitCode: 0, candidates: [] };
  let a = n.length === 0 ? undefined : completionPosition(e, t, n.slice(0, -1), n.at(-1));
  if (a === undefined)
    return { exitCode: 1, candidates: [] };
  let o = findCompletion(a, n, r);
  if (o === undefined) {
    let t = n[n.length - 1] ?? ``, r = blockedFlagNames(a);
    if (i !== `all` || r.size === 0 || a.pending !== undefined || t !== `` && !t.startsWith(`-`) || t.includes(`=`))
      return { exitCode: 1, candidates: [] };
    let o = Object.entries(a.flags).flatMap(([e, t]) => {
      if (!acceptsArgv(t))
        return [];
      let n = getVisibleNegatedName(e, t);
      return [...r.has(e) ? [] : [`--${e}`, ...getFlagAliasNames(t).map((e) => e.length === 1 ? `-${e}` : `--${e}`)], ...n === undefined ? [] : [`--${n}`]];
    }), s = a.result.kind === `unknown` ? a.result.candidates : [...new Set(a.result.command.subcommands.values())], c = a.positional === 0 ? s.filter((e) => !e.schema.hidden).flatMap(({ schema: e }) => [e.name, ...e.aliases]) : [], l = a.result.kind === `unknown` ? [...builtinEnabled(e.builtins, `help`) ? [`--help`] : [], ...e.version === undefined ? [] : [`--version`, ...e.versionAlias === undefined ? [] : [`-${e.versionAlias}`]]] : [];
    return { exitCode: 0, candidates: [.../* @__PURE__ */ new Set([...c, ...l, ...o])].filter((e) => !/\p{Cc}/u.test(e) && e.startsWith(t)) };
  }
  try {
    let e = await o.handler(o.context);
    return { exitCode: 0, candidates: [.../* @__PURE__ */ new Set([...o.commandCandidates, ...e])].filter((e) => typeof e == `string` && e.length > 0 && !/\p{Cc}/u.test(e) && e.startsWith(o.context.prefix)).map((e) => i === `value-only` ? e : o.tokenPrefix + e) };
  } catch {
    return { exitCode: 0, candidates: o.commandCandidates.filter((e) => e.startsWith(o.context.prefix)) };
  }
}
async function completeRequest(e, t, n, r) {
  if (n[0] === `--blocked-flags` && n[1] === `--`) {
    let r = completionPosition(e, t, n.slice(2));
    return { exitCode: 0, candidates: r === undefined ? [] : [...blockedFlagNames(r)] };
  }
  if (n[1] === `--`) {
    if (n[0] === `--value-only`)
      return completeValues(e, t, n.slice(2), r, `value-only`);
    if (n[0] === `--values`)
      return completeValues(e, t, n.slice(2), r, `values`);
  }
  return completeValues(e, t, n.slice(+(n[0] === `--`)), r, `all`);
}
var init_dynamic_DSu5__LH = __esm(() => {
  init_core_uS8LDF4B();
});

function normalizeShell(e) {
  let t = e.split(/[\\/]/), n = (t[t.length - 1] ?? e).replace(/\.(?:exe|cmd|bat)$/i, ``);
  return n === `pwsh` ? `powershell` : SHELLS.includes(n) ? n : undefined;
}
function detectShell(e) {
  let t = e.SHELL, n = t !== undefined && t !== `` ? normalizeShell(t) : undefined;
  if (n !== undefined)
    return n;
  if (e.PSModulePath !== undefined)
    return `powershell`;
}
function project(e, t) {
  switch (typeof e) {
    case `string`:
    case `number`:
    case `boolean`:
      return e;
    case `bigint`:
      return String(e);
    case `undefined`:
    case `function`:
    case `symbol`:
      return OMIT;
  }
  if (e === null)
    return null;
  if (t.has(e))
    return OMIT;
  try {
    let n = Reflect.get(e, `toJSON`);
    if (typeof n == `function`) {
      let r = Reflect.apply(n, e, []);
      return r === e ? projectStructure(e, t) : project(r, t);
    }
    return projectStructure(e, t);
  } catch {
    return OMIT;
  }
}
function projectStructure(e, t) {
  t.add(e);
  try {
    return Array.isArray(e) ? e.map((e) => {
      let n = project(e, t);
      return n === OMIT ? null : n;
    }) : projectRecord(e, t);
  } finally {
    t.delete(e);
  }
}
function projectRecord(e, t) {
  let n = {};
  for (let [r, i] of Object.entries(e)) {
    let e = project(i, t);
    e !== OMIT && (n[r] = e);
  }
  return n;
}
function toJsonSafeRecord(e) {
  return projectRecord(e, /* @__PURE__ */ new WeakSet);
}
function isValidationError(e) {
  return e instanceof ValidationError;
}
function builtinSpelling(e) {
  return BUILTIN_SPECS[e].long[0] ?? BUILTIN_SPECS[e].short[0] ?? e;
}
function builtinEnabled(e, t) {
  return (e?.[t] ?? `on`) === `on`;
}
function builtinFlagForms(e) {
  let t = BUILTIN_SPECS[e];
  return [...t.short, ...t.long].join(`, `);
}
function builtinTokens(e) {
  let t = BUILTIN_SPECS[e];
  return [...t.long, ...t.short].map((e) => e.replace(/^-+/, ``));
}
function readBuiltinMode(e, t) {
  let n = e[t];
  if (n === undefined || n === `on` || n === `off`)
    return n ?? `on`;
  throw new CLIError(`Built-in '${t}' must be 'on' or 'off'`, { code: `INVALID_SCHEMA`, details: { builtin: t, value: n }, suggest: `Pass { ${t}: 'off' } to release the flag, or omit the key to keep it on` });
}
function normalizeBuiltins(e) {
  return e === undefined ? DEFAULT_BUILTINS : { help: readBuiltinMode(e, `help`), json: readBuiltinMode(e, `json`), quiet: readBuiltinMode(e, `quiet`) };
}
function formatDisplayValue(e) {
  if (e == null)
    return ``;
  if (typeof e == `string` || typeof e == `number` || typeof e == `boolean` || typeof e == `bigint` || typeof e == `symbol`)
    return String(e);
  if (e instanceof Date)
    return Number.isNaN(e.getTime()) ? `Invalid Date` : e.toISOString();
  if (typeof e == `function`)
    return e.name.length > 0 ? `[Function: ${e.name}]` : `[Function]`;
  try {
    return JSON.stringify(e) ?? `[unserializable]`;
  } catch {
    return `[unserializable]`;
  }
}
function formatDiagnosticValue(e) {
  if (typeof e == `string`)
    return e;
  try {
    let t = JSON.stringify(e);
    if (t !== undefined)
      return t;
  } catch {}
  try {
    return String(e);
  } catch {
    return `<unprintable>`;
  }
}
function diagnosticValue(e, t) {
  return e ? { kind: `redacted`, text: `<redacted>` } : { kind: `visible`, value: t, text: formatDiagnosticValue(t) };
}
function validateNumberConstraints(e, t) {
  if (Number.isNaN(e) || (t?.finite ?? true) && !Number.isFinite(e))
    return { kind: `finite` };
  if (t?.int === true && !Number.isInteger(e))
    return { kind: `int` };
  if (t?.min !== undefined && e < t.min)
    return { kind: `min`, bound: t.min };
  if (t?.max !== undefined && e > t.max)
    return { kind: `max`, bound: t.max };
}
function describeNumberConstraintViolation(e) {
  switch (e.kind) {
    case `finite`:
      return `must be a finite number`;
    case `int`:
      return `must be an integer`;
    case `min`:
      return `must be >= ${e.bound}`;
    case `max`:
      return `must be <= ${e.bound}`;
  }
}
function assertNumberConstraints(e) {
  if (e.min !== undefined && !Number.isFinite(e.min))
    throw RangeError(`number constraint 'min' must be a finite number (got ${e.min}); omit it for no lower bound`);
  if (e.max !== undefined && !Number.isFinite(e.max))
    throw RangeError(`number constraint 'max' must be a finite number (got ${e.max}); omit it for no upper bound`);
  if (e.min !== undefined && e.max !== undefined && e.min > e.max)
    throw RangeError(`number constraint 'min' (${e.min}) must not exceed 'max' (${e.max})`);
}
function validateStringConstraints(e, t) {
  if (t !== undefined) {
    if (t.nonEmpty === true && e.length === 0)
      return { kind: `nonEmpty` };
    if (t.minLength !== undefined && e.length < t.minLength)
      return { kind: `minLength`, bound: t.minLength };
    if (t.maxLength !== undefined && e.length > t.maxLength)
      return { kind: `maxLength`, bound: t.maxLength };
    if (t.pattern !== undefined && (t.pattern.lastIndex = 0, !t.pattern.test(e)))
      return { kind: `pattern`, pattern: String(t.pattern) };
  }
}
function describeStringConstraintViolation(e) {
  switch (e.kind) {
    case `nonEmpty`:
      return `must not be empty`;
    case `minLength`:
      return `must be at least ${e.bound} characters`;
    case `maxLength`:
      return `must be at most ${e.bound} characters`;
    case `pattern`:
      return `must match ${e.pattern}`;
  }
}
function stringConstraintDetails(e) {
  return { constraint: e.kind, ...`bound` in e ? { bound: e.bound } : {}, ...`pattern` in e ? { pattern: e.pattern } : {} };
}
function assertStringConstraints(e) {
  for (let t of [`minLength`, `maxLength`]) {
    let n = e[t];
    if (n !== undefined && (!Number.isInteger(n) || n < 0))
      throw RangeError(`string constraint '${t}' must be a non-negative integer (got ${n}); omit it for no bound`);
  }
  if (e.minLength !== undefined && e.maxLength !== undefined && e.minLength > e.maxLength)
    throw RangeError(`string constraint 'minLength' (${e.minLength}) must not exceed 'maxLength' (${e.maxLength})`);
}
function parseDateValue(e, t) {
  if (e instanceof Date)
    return validateDateBounds(e, t);
  if (typeof e != `string`)
    throw Error(`Invalid date: expected an ISO-8601 string`);
  let n = ISO_DATE_PATTERN.exec(e);
  if (n === null)
    throw Error(`Invalid date: expected ISO-8601 (e.g. 2026-07-10 or 2026-07-10T14:30:00Z)`);
  let [, r, i, a, o, s, c] = n, l = Number(r), u = Number(i), d = Number(a);
  if (u < 1 || u > 12)
    throw Error(`Invalid date: month must be 01-12`);
  if (d < 1 || d > daysInMonth(l, u))
    throw Error(`Invalid date: not a real calendar date`);
  if (o !== undefined && Number(o) > 23)
    throw Error(`Invalid date: hours must be 00-23`);
  if (s !== undefined && Number(s) > 59)
    throw Error(`Invalid date: minutes must be 00-59`);
  if (c !== undefined && Number(c) > 59)
    throw Error(`Invalid date: seconds must be 00-59`);
  let f = n[4] !== undefined, p = n[8] !== undefined, m = new Date(f && !p ? `${e}Z` : e);
  if (Number.isNaN(m.getTime()))
    throw Error(`Invalid date`);
  return validateDateBounds(m, t);
}
function daysInMonth(e, t) {
  return new Date(Date.UTC(e, t, 0)).getUTCDate();
}
function validateDateBounds(e, t) {
  if (Number.isNaN(e.getTime()))
    throw Error(`Invalid date`);
  if (t?.min !== undefined && e.getTime() < t.min.getTime())
    throw Error(`Date is before the earliest allowed ${t.min.toISOString()}`);
  if (t?.max !== undefined && e.getTime() > t.max.getTime())
    throw Error(`Date is after the latest allowed ${t.max.toISOString()}`);
  return e;
}
function parseUrlValue(e, t) {
  if (typeof e != `string` && !(e instanceof URL))
    throw Error(`Invalid URL: expected a URL string`);
  let n;
  try {
    n = e instanceof URL ? e : new URL(e);
  } catch {
    throw Error(`Invalid URL`);
  }
  if (t?.protocols !== undefined) {
    let e = n.protocol.replace(/:$/, ``);
    if (!t.protocols.includes(e))
      throw Error(`URL protocol is not allowed. Allowed: ${t.protocols.join(`, `)}`);
  }
  return n;
}
function parseDurationValue(e) {
  if (typeof e == `number`) {
    if (!Number.isFinite(e) || e < 0)
      throw Error(`Invalid duration: must be a non-negative number`);
    return e;
  }
  if (typeof e != `string` || e.length === 0)
    throw Error(`Invalid duration: expected e.g. 30s, 5m, 1h30m, or 250ms`);
  if (/^\d+(?:\.\d+)?$/.test(e))
    return Number(e);
  let t = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/gy, n = 0, r = 0;
  for (let i of e.matchAll(t)) {
    let [e, t, a] = i, o = a === undefined ? undefined : DURATION_UNITS[a];
    if (t === undefined || o === undefined)
      break;
    n += Number(t) * o, r += e.length;
  }
  if (r !== e.length || r === 0)
    throw Error(`Invalid duration: expected e.g. 30s, 5m, 1h30m, or 250ms`);
  return n;
}
function parseBytesValue(e) {
  if (typeof e == `number`) {
    if (!Number.isFinite(e) || e < 0)
      throw Error(`Invalid size: must be a non-negative number`);
    return e;
  }
  if (typeof e != `string` || e.length === 0)
    throw Error(`Invalid size: expected e.g. 512mb, 1.5gb, or 64kb`);
  let t = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(e);
  if (t === null || t[1] === undefined)
    throw Error(`Invalid size: expected e.g. 512mb, 1.5gb, or 64kb`);
  let n = (t[2] ?? `b`).toLowerCase(), r = BYTE_UNITS[n];
  if (r === undefined)
    throw Error(`Invalid size: unknown unit`);
  return Math.round(Number(t[1]) * r);
}
function buildPathChecks(e) {
  if (!(e === undefined || e.mustExist !== true && e.type === undefined))
    return { mustExist: e.mustExist ?? true, type: e.type, create: e.type === `directory` && e.create === true };
}
function enumCodec(e) {
  return { name: `enum`, enumValues: e, decode(t) {
    return typeof t == `string` && e?.includes(t) === true ? { ok: true, value: t } : { ok: false, failure: { kind: `enum`, enumValues: e } };
  } };
}
function parsedCodec(e) {
  return { name: `custom`, parseFn: e, decode(t) {
    try {
      return { ok: true, value: e(t) };
    } catch (e) {
      return { ok: false, failure: { kind: `thrown`, error: e } };
    }
  } };
}
function stringParsedCodec(e) {
  return { name: `custom`, parseFn: e, decode(t) {
    try {
      return { ok: true, value: e(typeof t == `string` ? t : String(t)) };
    } catch (e) {
      return { ok: false, failure: { kind: `thrown`, error: e } };
    }
  } };
}
function decodeValue(e, t, n) {
  let r = e.codec.decode(stdinDecodeInput(e, t, n), n);
  if (!r.ok)
    return r;
  let i = checkValueConstraints(e.constraints, r.value);
  return i === undefined ? r : { ok: false, failure: i };
}
function stdinDecodeInput(e, t, n) {
  return n !== `stdin` || keepsStdinTerminator(e) || typeof t != `string` ? t : stripTerminator(t);
}
function stripTerminator(e) {
  return e.endsWith(`\r
`) ? e.slice(0, -2) : e.endsWith(`
`) || e.endsWith(`\r`) ? e.slice(0, -1) : e;
}
function keepsStdinTerminator(e) {
  return e.codec.name === `string`;
}
function validateDecodedValue(e, t) {
  return checkValueDomain(e.codec, t) ?? checkValueConstraints(e.constraints, t);
}
function checkValueDomain(e, t) {
  switch (e.name) {
    case `string`:
      return typeof t == `string` ? undefined : { kind: `type`, expected: `string` };
    case `number`:
      return typeof t == `number` ? undefined : { kind: `type`, expected: `number` };
    case `boolean`:
      return typeof t == `boolean` ? undefined : { kind: `type`, expected: `boolean` };
    case `enum`:
      return typeof t == `string` && e.enumValues?.includes(t) === true ? undefined : { kind: `enum`, enumValues: e.enumValues };
    case `custom`:
      return;
  }
}
function describeValueFailure(e) {
  switch (e.kind) {
    case `type`:
      return `expected a ${e.expected}`;
    case `enum`:
      return `expected one of: ${(e.enumValues ?? []).join(`, `)}`;
    case `string-constraint`:
      return describeStringConstraintViolation(e.violation);
    case `number-constraint`:
      return describeNumberConstraintViolation(e.violation);
    case `thrown`:
      return e.error instanceof Error ? e.error.message : String(e.error);
  }
}
function checkValueConstraints(e, t) {
  if (e === undefined)
    return;
  if (e.kind === `string`) {
    if (typeof t != `string`)
      return;
    let n = validateStringConstraints(t, e.stringConstraints);
    return n === undefined ? undefined : { kind: `string-constraint`, value: t, violation: n };
  }
  if (typeof t != `number`)
    return;
  let n = validateNumberConstraints(t, e.numberConstraints);
  return n === undefined ? undefined : { kind: `number-constraint`, value: t, violation: n };
}
function makeValue(e, t) {
  return { codec: e, constraints: t?.constraints, standard: t?.standard, pathChecks: t?.pathChecks, valueHint: t?.valueHint };
}
function stringValue(e) {
  return makeValue(stringCodec, { constraints: { kind: `string`, stringConstraints: e } });
}
function strictStringValue() {
  return makeValue(strictStringCodec, { constraints: { kind: `string`, stringConstraints: undefined } });
}
function numberValue(e) {
  return makeValue(numberCodec, { constraints: { kind: `number`, numberConstraints: e } });
}
function booleanValue() {
  return makeValue(booleanCodec);
}
function enumValue(e) {
  return makeValue(enumCodec(e));
}
function customValue(e) {
  return makeValue(parsedCodec(e));
}
function stringParsedValue(e) {
  return makeValue(stringParsedCodec(e));
}
function standardValue(e) {
  return makeValue(passthroughCodec, { standard: e });
}
function passthroughValue() {
  return makeValue(passthroughCodec);
}
function urlValue(e) {
  return makeValue(parsedCodec((t) => parseUrlValue(t, e)), { valueHint: `url` });
}
function pathValue(e) {
  let t = buildPathChecks(e);
  return makeValue(stringCodec, { constraints: { kind: `string`, stringConstraints: undefined }, valueHint: `path`, ...t === undefined ? {} : { pathChecks: t } });
}
function dateValue(e) {
  return makeValue(parsedCodec((t) => parseDateValue(t, e)), { valueHint: `date` });
}
function durationValue() {
  return makeValue(parsedCodec(parseDurationValue), { valueHint: `duration` });
}
function bytesValue() {
  return makeValue(parsedCodec(parseBytesValue), { valueHint: `size` });
}
function valueDefinitionFields(e) {
  let { constraints: t, codec: n } = e;
  return { ...t?.kind === `string` && t.stringConstraints !== undefined ? { stringConstraints: t.stringConstraints } : {}, ...t?.kind === `number` && t.numberConstraints !== undefined ? { numberConstraints: t.numberConstraints } : {}, ...n.name === `custom` && n.parseFn !== undefined ? { parseFn: n.parseFn } : {}, ...e.standard === undefined ? {} : { standard: e.standard }, ...e.pathChecks === undefined ? {} : { pathChecks: e.pathChecks }, ...e.valueHint === undefined ? {} : { valueHint: e.valueHint } };
}
function flagValueSchema(e) {
  switch (e.kind) {
    case `string`:
      return scalarValue(e, stringValue(e.stringConstraints));
    case `number`:
      return scalarValue(e, numberValue(e.numberConstraints));
    case `boolean`:
      return scalarValue(e, booleanValue());
    case `enum`:
      return scalarValue(e, enumValue(e.enumValues));
    case `custom`:
      return scalarValue(e, e.parseFn === undefined ? passthroughValue() : customValue(e.parseFn));
    case `array`:
      return elementValue(e, passthroughValue);
    case `keyValue`:
      return elementValue(e, strictStringValue);
    case `count`:
      return scalarValue(e, numberValue({ int: true, min: 0 }));
  }
}
function flagAggregateStandard(e) {
  return e.aggregateStandard;
}
function argValueSchema(e) {
  switch (e.kind) {
    case `string`:
      return scalarValue(e, stringValue(e.stringConstraints));
    case `number`:
      return scalarValue(e, numberValue(e.numberConstraints));
    case `boolean`:
      return scalarValue(e, booleanValue());
    case `enum`:
      return scalarValue(e, enumValue(e.enumValues));
    case `custom`:
      return scalarValue(e, e.parseFn === undefined ? passthroughValue() : stringParsedValue(e.parseFn));
    case `keyValue`:
      return argElementValue(e);
  }
}
function argElementValue(e) {
  let t = e.elementSchema === undefined ? strictStringValue() : argValueSchema(e.elementSchema);
  return t.standard === undefined && e.standard !== undefined ? { ...t, standard: e.standard } : t;
}
function argAggregateStandard(e) {
  return e.aggregateStandard;
}
function scalarValue(e, t) {
  return { ...t, standard: e.standard, pathChecks: e.pathChecks, valueHint: e.valueHint };
}
function elementValue(e, t) {
  let n = e.elementSchema === undefined ? t() : flagValueSchema(e.elementSchema);
  return n.standard === undefined && e.standard !== undefined ? { ...n, standard: e.standard } : n;
}
function valueEnumValues(e) {
  return e?.codec.name === `enum` ? e.codec.enumValues : undefined;
}
function splitPolicyFromString(e) {
  return Object.hasOwn(NAMED_SPLIT_POLICIES, e) ? NAMED_SPLIT_POLICIES[e] ?? WHOLE : { format: `delimiter`, delimiter: e };
}
function normalizeSplitPolicy(e, t) {
  if (typeof t == `string`)
    return normalizeSplitPolicyObject(e, splitPolicyFromString(t));
  if (typeof t != `object` || !t)
    throw new CLIError(`Split policy for ${e} must be a string or object`, { code: `INVALID_SCHEMA`, details: { source: e, received: t === null ? `null` : typeof t }, suggest: `Pass a format name, delimiter string, or split-policy object` });
  return normalizeSplitPolicyObject(e, t);
}
function normalizeSplitPolicyObject(e, t) {
  let n = t;
  if (typeof n.format != `string`)
    throw new CLIError(`Split policy for ${e} requires a string format`, { code: `INVALID_SCHEMA`, details: { source: e, field: `format`, received: typeof n.format }, suggest: `Pass a supported split format` });
  let r = ALLOWED_SPLIT_FORMATS[e];
  if (!r.includes(n.format))
    throw new CLIError(`Split format '${String(n.format)}' is not available for ${e}`, { code: `INVALID_SCHEMA`, details: { source: e, format: n.format, allowed: [...r] }, suggest: `Use one of: ${r.filter((e) => e !== `delimiter`).join(`, `)}, or a delimiter string` });
  if (n.format !== `delimiter`)
    return { format: n.format };
  if (typeof n.delimiter != `string`)
    throw new CLIError(`Split delimiter for ${e} must be a string`, { code: `INVALID_SCHEMA`, details: { source: e, format: n.format, received: typeof n.delimiter }, suggest: `Pass a delimiter string, for example ','` });
  if (n.delimiter.length === 0)
    throw new CLIError(`Split delimiter for ${e} must not be empty`, { code: `INVALID_SCHEMA`, details: { source: e, format: n.format }, suggest: `Pass a non-empty delimiter, for example ','` });
  return { format: `delimiter`, delimiter: n.delimiter };
}
function normalizeSplitOptions(e, t) {
  let n = e.cli === undefined ? undefined : normalizeSplitPolicy(`cli`, e.cli), r = e.env === undefined ? t?.env : normalizeSplitPolicy(`env`, e.env), i = e.stdin === undefined ? t?.stdin : normalizeSplitPolicy(`stdin`, e.stdin);
  return { separator: n !== undefined && n.format === `delimiter` ? n.delimiter : undefined, setsSeparator: n !== undefined, split: r === undefined && i === undefined ? undefined : { env: r, stdin: i } };
}
function splitBindingOf(e, t) {
  return { cli: e === undefined ? WHOLE : { format: `delimiter`, delimiter: e }, env: t?.env ?? ENV_DEFAULT, stdin: t?.stdin ?? LINES };
}
function flagCardinality(e) {
  switch (e.kind) {
    case `array`:
      return { kind: `many`, unique: e.unique, cliSplit: splitBindingOf(e.separator, e.split).cli };
    case `keyValue`:
      return { kind: `entries`, duplicateKeys: e.duplicateKeys, cliSplit: splitBindingOf(e.separator, e.split).cli };
    case `count`:
      return COUNT;
    case `string`:
    case `number`:
    case `boolean`:
    case `enum`:
    case `custom`:
      return ONE;
  }
}
function argCardinality(e) {
  return e.kind === `keyValue` ? { kind: `entries`, duplicateKeys: e.duplicateKeys, cliSplit: splitBindingOf(e.separator, e.split).cli } : e.variadic ? { kind: `many`, unique: e.unique, cliSplit: splitBindingOf(e.separator, e.split).cli } : ONE;
}
function isCollection(e) {
  return e.kind === `many` || e.kind === `entries`;
}
function splitManyText(e, t) {
  switch (e.format) {
    case `whole`:
      return { ok: true, parts: t.length === 0 ? [] : [t] };
    case `delimiter`:
      return { ok: true, parts: splitDelimited(t, e.delimiter) };
    case `lines`:
      return { ok: true, parts: splitLines(t) };
    case `json`: {
      let e = parseJson(t);
      return e.ok ? Array.isArray(e.value) ? { ok: true, parts: e.value } : { ok: false, failure: { kind: `json-shape`, expected: `array` } } : e;
    }
  }
}
function splitEntriesText(e, t) {
  if (e.format === `json`) {
    let e = parseJson(t);
    if (!e.ok)
      return e;
    let n = e.value;
    return typeof n != `object` || !n || Array.isArray(n) ? { ok: false, failure: { kind: `json-shape`, expected: `object` } } : { ok: true, parts: Object.entries(n) };
  }
  let n = e.format === `whole` ? t.length === 0 ? [] : [t] : e.format === `lines` ? splitLines(t) : splitDelimited(t, e.delimiter), r = [];
  for (let e of n) {
    let t = splitEntryPair(e);
    if (t === undefined)
      return { ok: false, failure: { kind: `pair`, raw: e } };
    r.push(t);
  }
  return { ok: true, parts: r };
}
function splitEntryPair(e) {
  let t = e.indexOf(`=`);
  if (!(t <= 0))
    return [e.slice(0, t), e.slice(t + 1)];
}
function splitDelimited(e, t) {
  return e.split(t).filter((e) => e.length > 0);
}
function splitLines(e) {
  if (e.length === 0)
    return [];
  let t = e.split(/\r\n|\n|\r/);
  return t.length > 1 && t[t.length - 1] === `` && t.pop(), t;
}
function parseJson(e) {
  try {
    return { ok: true, value: JSON.parse(e) };
  } catch (e) {
    return { ok: false, failure: { kind: `json`, error: e } };
  }
}
function dedupe(e) {
  return [...new Set(e)];
}
function foldEntries(e, t) {
  let n = /* @__PURE__ */ new Map;
  for (let [r, [i, a]] of e.entries()) {
    if (n.has(i)) {
      if (t === `error`)
        return { ok: false, duplicateKey: i, at: r };
      if (t === `first`)
        continue;
    }
    n.set(i, a);
  }
  return { ok: true, value: Object.fromEntries(n) };
}
function validateDefault(e, t, n, r) {
  switch (t.kind) {
    case `one`:
      return validateDefaultElement(e, undefined, r);
    case `count`:
      return typeof r == `number` && Number.isInteger(r) && r >= 0 ? undefined : { kind: `shape`, expected: `count` };
    case `many`:
      if (!Array.isArray(r))
        return { kind: `shape`, expected: `array` };
      for (let [t, n] of r.entries()) {
        let r = validateDefaultElement(e, { kind: `index`, index: t }, n);
        if (r !== undefined)
          return r;
      }
      return validateDefaultStandard(n, undefined, r);
    case `entries`:
      if (typeof r != `object` || !r || Array.isArray(r))
        return { kind: `shape`, expected: `object` };
      for (let [t, n] of Object.entries(r)) {
        let r = validateDefaultElement(e, { kind: `key`, key: t }, n);
        if (r !== undefined)
          return r;
      }
      return validateDefaultStandard(n, undefined, r);
  }
}
function validateDefaultElement(e, t, n) {
  let r = validateDecodedValue(e, n);
  return r === undefined ? validateDefaultStandard(e.standard, t, n) : { kind: `element`, at: t, value: n, failure: r };
}
function validateDefaultStandard(e, t, n) {
  if (e === undefined)
    return;
  let r = e[`~standard`].validate(n);
  if (!(r instanceof Promise) && r.issues !== undefined)
    return { kind: `standard`, at: t, value: n, issues: r.issues.map((e) => e.message) };
}
function indefiniteArticle(e) {
  return VOWEL_INITIAL.test(e) ? `an` : `a`;
}
function reportableDefaultLocation(e, t) {
  if (`at` in e && e.at !== undefined)
    return e.at.kind === `index` ? String(e.at.index) : t ? undefined : e.at.key;
}
function defaultViolationError(e, t, n, r) {
  let i = reportableDefaultLocation(n, r), a = describeDefaultViolation(n);
  return new CLIError(`Default value for ${e}${i === undefined ? `` : ` at ${i}`} is invalid: ${a}`, { code: `INVALID_DEFAULT`, details: { ...t, ...i === undefined ? {} : { at: i }, reason: a }, suggest: `Change the default so it satisfies what ${e} accepts` });
}
function describeDefaultViolation(e) {
  switch (e.kind) {
    case `shape`:
      return e.expected === `count` ? `expected a non-negative integer` : `expected an ${e.expected}`;
    case `element`:
      return describeValueFailure(e.failure);
    case `standard`:
      return e.issues.join(`; `);
  }
}
function envNameFault(e, t) {
  if (typeof e != `string` || e.length === 0)
    return `must be a non-empty string`;
  if (e.includes(`=`) || e.includes(`\x00`))
    return `must not contain '=' or NUL`;
  let n = e.split(ENV_INDEX_PLACEHOLDER), r = n.length - 1;
  if (n.some((e) => e.includes(`{`) || e.includes(`}`)))
    return `must not contain braces other than the ${ENV_INDEX_PLACEHOLDER} placeholder`;
  if (t && r === 0)
    return `must contain the ${ENV_INDEX_PLACEHOLDER} placeholder`;
  if (!t && r > 0)
    return `must not contain the ${ENV_INDEX_PLACEHOLDER} placeholder`;
}
function invalidBindingError(e, t, n) {
  return new CLIError(`Indexed env binding '${e}' ${t}`, { code: `INVALID_SCHEMA`, details: { field: `envIndexed`, part: e }, suggest: n });
}
function normalizeIndexedEnvBinding(e) {
  if (typeof e != `object` || !e)
    throw new CLIError(`Indexed env binding must be an object`, { code: `INVALID_SCHEMA`, details: { field: `envIndexed` }, suggest: `Pass { count, value } or { count, fields } to '.env()'` });
  let t = envNameFault(e.count, false);
  if (t !== undefined)
    throw invalidBindingError(`count`, t, `Name the variable that holds the number of entries, such as ITEM_COUNT`);
  let n = Object.hasOwn(e, `value`) && e.value !== undefined;
  if (n === (Object.hasOwn(e, `fields`) && e.fields !== undefined))
    throw new CLIError(`Indexed env binding needs exactly one of 'value' and 'fields'`, { code: `INVALID_SCHEMA`, details: { field: `envIndexed` }, suggest: `Use 'value' for a list of values or 'fields' for a list of records` });
  if (n) {
    let t = envNameFault(e.value, true);
    if (t !== undefined)
      throw invalidBindingError(`value`, t, `Use a template such as ITEM_${ENV_INDEX_PLACEHOLDER}`);
    return Object.freeze({ count: e.count, value: e.value });
  }
  let r = e.fields;
  if (typeof r != `object` || !r || Array.isArray(r))
    throw invalidBindingError(`fields`, `must be an object mapping field names to templates`, `Use { key: 'KEY_${ENV_INDEX_PLACEHOLDER}', value: 'VALUE_${ENV_INDEX_PLACEHOLDER}' }`);
  let i = Object.entries(r);
  if (i.length === 0)
    throw invalidBindingError(`fields`, `must declare at least one field`, `Declare a field per variable, or use 'value' for a list of values`);
  let a = /* @__PURE__ */ new Map;
  for (let [e, t] of i) {
    if (e.length === 0)
      throw invalidBindingError(`fields`, `must not use an empty field name`, `Name every field`);
    let n = envNameFault(t, true);
    if (n !== undefined)
      throw invalidBindingError(`fields.${e}`, n, `Use a template such as ${e.toUpperCase()}_${ENV_INDEX_PLACEHOLDER}`);
    let r = a.get(t);
    if (r !== undefined)
      throw invalidBindingError(`fields.${e}`, `reuses the template of field '${r}'`, `Give every field its own variable template`);
    a.set(t, e);
  }
  return Object.freeze({ count: e.count, fields: Object.freeze(Object.fromEntries(i)) });
}
function envIdentifier(e) {
  return e.replace(/([a-z0-9])([A-Z])/g, `$1_$2`).replace(/([A-Z]+)([A-Z][a-z])/g, `$1_$2`).toUpperCase().replace(/[^A-Z0-9]+/g, `_`).replace(/^_+|_+$/g, ``);
}
function deriveEnvPrefix(e) {
  let t = envIdentifier(e);
  if (t === ``)
    throw new CLIError(`Cannot derive an env prefix from the CLI name '${e}'`, { code: `INVALID_SCHEMA`, details: { field: `envPrefix`, name: e }, suggest: `Pass the prefix explicitly, such as .envPrefix('ACME_')` });
  return `${t}_`;
}
function isIndexedEnvBinding(e) {
  return typeof e == `object` && !!e && (Object.hasOwn(e, `count`) || Object.hasOwn(e, `value`) || Object.hasOwn(e, `fields`));
}
function deriveEnvName(e) {
  let t = envIdentifier(e);
  if (t === ``)
    throw new CLIError(`Cannot derive an env variable name from the input name '${e}'`, { code: `INVALID_SCHEMA`, details: { field: `envFromName`, name: e }, suggest: `Name the variable explicitly, such as .env('TOKEN')` });
  return t;
}
function normalizeEnvPrefix(e) {
  let t = typeof e != `string` || e.length === 0 ? `must be a non-empty string` : /[={}\0]/.test(e) ? `must not contain '=', braces, or NUL` : undefined;
  if (t !== undefined)
    throw new CLIError(`Env prefix ${t}`, { code: `INVALID_SCHEMA`, details: { field: `envPrefix` }, suggest: `Use a prefix such as 'ACME_', or call .envPrefix() to derive one from the CLI name` });
  return e;
}
function effectiveEnvName(e, t, n) {
  return n || t === undefined ? e : `${t}${e}`;
}
function effectiveIndexedEnvBinding(e, t, n) {
  if (n || t === undefined)
    return e;
  let r = `${t}${e.count}`;
  return e.fields === undefined ? { count: r, value: `${t}${e.value}` } : { count: r, fields: Object.fromEntries(Object.entries(e.fields).map(([e, n]) => [e, `${t}${n}`])) };
}
function expandEnvTemplate(e, t) {
  return e.replaceAll(ENV_INDEX_PLACEHOLDER, String(t));
}
function indexedEnvMembers(e) {
  return e.fields === undefined ? [[undefined, e.value]] : Object.entries(e.fields);
}
function formatIndexedEnvBinding(e) {
  return `${indexedEnvMembers(e).map(([, e]) => e).join(` + `)}, count: ${e.count}`;
}
function isStandardSchemaV1(e) {
  if (e === null || typeof e != `object` && typeof e != `function` || !(`~standard` in e))
    return false;
  let t = e[`~standard`];
  return typeof t == `object` && !!t && `version` in t && t.version === 1 && `validate` in t && typeof t.validate == `function`;
}
function assertStdinOptions(e) {
  if (e.argv !== undefined && typeof e.argv != `boolean`)
    throw new CLIError(`Stdin argv must be a boolean`, { code: `INVALID_SCHEMA`, suggest: `Pass argv: true or argv: false` });
  if (e.argv === false && e.when === `dash`)
    throw new CLIError(`Stdin mode 'dash' requires a command-line form`, { code: `INVALID_SCHEMA`, suggest: `Use when: 'missing' or omit when with argv: false` });
  if (e.when !== undefined && !STDIN_WHENS.includes(e.when))
    throw new CLIError(`Unknown stdin mode '${String(e.when)}'`, { code: `INVALID_SCHEMA`, details: { when: e.when, allowed: [...STDIN_WHENS] }, suggest: `Use one of: ${STDIN_WHENS.join(`, `)}` });
  if (e.consume !== undefined && !STDIN_CONSUMES.includes(e.consume))
    throw new CLIError(`Unknown stdin consumption mode '${String(e.consume)}'`, { code: `INVALID_SCHEMA`, details: { consume: e.consume, allowed: [...STDIN_CONSUMES] }, suggest: `Use one of: ${STDIN_CONSUMES.join(`, `)}` });
  if (e.trim !== undefined && typeof e.trim != `boolean`)
    throw new CLIError(`Stdin trim must be a boolean, received '${String(e.trim)}'`, { code: `INVALID_SCHEMA`, details: { trim: e.trim }, suggest: `Pass trim: true or trim: false` });
}
function normalizeStdinBinding(e) {
  return e === undefined ? DEFAULT_STDIN_BINDING : (assertStdinOptions(e), { ...e.argv === false ? { argv: false } : {}, when: e.when ?? DEFAULT_STDIN_BINDING.when, consume: e.consume ?? DEFAULT_STDIN_BINDING.consume, trim: e.trim ?? DEFAULT_STDIN_BINDING.trim });
}
function stdinReadsOnDash(e) {
  return e.when === `dash` || e.when === `dash-or-missing`;
}
function stdinReadsWhenMissing(e) {
  return e.when === `missing` || e.when === `dash-or-missing`;
}
function acceptsArgv(e) {
  return e.stdin?.argv !== false;
}
function normalizeFlagAlias(e) {
  return typeof e == `string` ? { name: e, hidden: false } : { name: e.name, hidden: e.hidden };
}
function normalizeFlagAliases(e) {
  return e.map(normalizeFlagAlias);
}
function getFlagAliasNames(e, t) {
  let n = t?.includeHidden ?? false, r = t?.kind ?? `all`;
  return e.aliases.filter((e) => n || !e.hidden).filter((e) => r === `short` ? e.name.length === 1 : r !== `long` || e.name.length > 1).map((e) => e.name);
}
function getFlagNegatedName(e, t) {
  if (t.negation !== undefined)
    return t.negation.alias ?? `no-${e}`;
}
function getVisibleNegatedName(e, t) {
  return t.negation?.hidden ? undefined : getFlagNegatedName(e, t);
}
function isNormalizedFlagSchema(e) {
  return NORMALIZED_FLAG_SCHEMA_KEYS.every((t) => (t in e));
}
function assertEligibleFlagElementBuilder(e) {
  if (COLLECTION_FLAG_KINDS.includes(e.kind) || e.kind === `count`)
    throw new CLIError(`Flag element schema kind '${e.kind}' is not supported`, { code: `INVALID_SCHEMA`, details: { kind: e.kind, field: `kind` }, suggest: `Use a scalar value kind for the collection element` });
  let t = [[`sensitive`, false], [`defaultDescription`, undefined], [`presence`, e.kind === `boolean` ? `defaulted` : `optional`], [`defaultValue`, e.kind !== `boolean` && undefined], [`stdin`, undefined], [`envVar`, undefined], [`envIndexed`, undefined], [`envAbsolute`, false], [`envFromName`, false], [`configPath`, undefined], [`description`, undefined], [`group`, undefined], [`advanced`, undefined], [`elementSchema`, undefined], [`separator`, undefined], [`split`, undefined], [`duplicateKeys`, `last`], [`unique`, false], [`prompt`, undefined], [`completion`, undefined], [`aggregateStandard`, undefined], [`deprecated`, undefined], [`propagate`, false], [`negation`, undefined], [`separateValue`, undefined], [`duplicates`, `last`]];
  for (let [n, r] of t)
    if (e[n] !== r)
      throw new CLIError(`Flag element schema field '${String(n)}' is not supported`, { code: `INVALID_SCHEMA`, details: { kind: e.kind, field: n }, suggest: `Drop '${String(n)}' from the collection element` });
  if (e.aliases.length !== 0)
    throw new CLIError(`Flag element schema field 'aliases' is not supported`, { code: `INVALID_SCHEMA`, details: { kind: e.kind, field: `aliases` }, suggest: `Drop 'aliases' from the collection element` });
}
function assertValidFlagElementSchema(e) {
  let t = e.advanced === undefined ? e.group === undefined ? e.completion === undefined ? e.sensitive ? `sensitive` : e.defaultDescription === undefined ? undefined : `defaultDescription` : `completion` : `group` : `advanced`;
  if (t !== undefined)
    throw new CLIError(`Flag element schema field '${t}' is not supported`, { code: `INVALID_SCHEMA`, details: { kind: e.kind, field: t }, suggest: `Drop '${t}' from the collection element` });
}
function normalizeFlagElementSchema(e) {
  if (isNormalizedFlagSchema(e))
    return assertValidFlagDefinition(e.kind, e), assertValidFlagElementSchema(e), e;
  let { kind: t, ...n } = e;
  assertValidFlagDefinition(t, n);
  let r = buildFlagSchema(t, normalizeFlagDefinitionFields(n));
  return assertValidFlagElementSchema(r), r;
}
function normalizeFlagDefinitionFields(e) {
  let { elementSchema: t, ...n } = e;
  return t === undefined ? n : { ...n, elementSchema: normalizeFlagElementSchema(t) };
}
function assertValidFlagDefinition(e, t) {
  assertKnownFlagKind(e);
  for (let [n, r] of KIND_SPECIFIC_FLAG_FIELDS)
    if (!r.includes(e) && t[n] !== undefined)
      throw invalidFlagFieldError(e, n, r);
  if (e !== `array` && t.unique === true)
    throw invalidFlagFieldError(e, `unique`, [`array`]);
  if (e !== `keyValue` && t.duplicateKeys !== undefined && t.duplicateKeys !== `last`)
    throw invalidFlagFieldError(e, `duplicateKeys`, [`keyValue`]);
  if (t.duplicateKeys !== undefined && !DUPLICATE_KEYS.includes(t.duplicateKeys))
    throw new CLIError(`Unknown duplicate-key policy '${String(t.duplicateKeys)}'`, { code: `INVALID_SCHEMA`, details: { duplicateKeys: t.duplicateKeys, allowed: [...DUPLICATE_KEYS] }, suggest: `Use one of: ${DUPLICATE_KEYS.join(`, `)}` });
  if (e === `enum` && t.enumValues === undefined)
    throw new CLIError(`Flag schema kind 'enum' requires field 'enumValues'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `enumValues` }, suggest: `Pass the allowed values in 'enumValues'` });
  if ((e === `array` || e === `count` || e === `keyValue`) && t.duplicates !== undefined && t.duplicates !== `last`)
    throw new CLIError(`Flag schema field 'duplicates' is not supported on kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `duplicates` }, suggest: `Drop 'duplicates'; kind '${e}' accumulates every occurrence` });
  if ((e === `count` || e === `keyValue`) && t.prompt !== undefined)
    throw new CLIError(`Flag schema field 'prompt' is not available on kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `prompt` }, suggest: `Drop 'prompt' from the ${e} flag` });
  if (t.stdin !== undefined && assertStdinCapableKind(e), t.envIndexed !== undefined && assertIndexedEnvFlag(e, t), t.envFromName === true && (t.envVar !== undefined || t.envIndexed !== undefined))
    throw new CLIError(`Flag schema field 'envFromName' is mutually exclusive with 'envVar' and 'envIndexed'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envFromName` }, suggest: `Declare one env source: a derived name, a variable name, or an indexed family` });
  if (t.envAbsolute === true && t.envVar === undefined && t.envIndexed === undefined && t.envFromName !== true)
    throw new CLIError(`Flag schema field 'envAbsolute' requires an env source`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envAbsolute` }, suggest: `Bind an env source, or drop 'envAbsolute'` });
}
function assertIndexedEnvFlag(e, t) {
  let n = t.envIndexed;
  if (n === undefined)
    return;
  if (normalizeIndexedEnvBinding(n), t.envVar !== undefined)
    throw new CLIError(`Flag schema fields 'envVar' and 'envIndexed' are mutually exclusive`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envIndexed` }, suggest: `Declare one env source: a variable name or an indexed family` });
  if (e === `custom`)
    return;
  if (e !== `array`)
    throw new CLIError(`Flag schema field 'envIndexed' requires kind 'array' or 'custom', received kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envIndexed`, requiredKinds: [`array`, `custom`] }, suggest: `Read an indexed family into flag.array(...) or flag.custom(...), or bind a single variable` });
  let r = t.elementSchema;
  if (n.fields !== undefined && r !== undefined && r.kind !== `custom`)
    throw new CLIError(`Indexed env records need a custom element, received element kind '${r.kind}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envIndexed`, elementKind: r.kind }, suggest: `Use flag.array(flag.custom(recordSchema)) to decode each record` });
}
function assertKnownFlagKind(e) {
  if (!FLAG_KINDS.includes(e))
    throw new CLIError(`Unknown flag kind '${String(e)}'`, { code: `INVALID_SCHEMA`, details: { kind: e, allowed: [...FLAG_KINDS] }, suggest: `Use one of: ${FLAG_KINDS.join(`, `)}` });
}
function assertStdinCapableKind(e) {
  if (!STDIN_CAPABLE_FLAG_KINDS.some((t) => t === e))
    throw new CLIError(`Flag schema field 'stdin' is not available on kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `stdin`, allowedKinds: [...STDIN_CAPABLE_FLAG_KINDS] }, suggest: `Drop 'stdin' or declare the flag as one of: ${STDIN_CAPABLE_FLAG_KINDS.join(`, `)}` });
}
function invalidFlagFieldError(e, t, n) {
  let r = n.map((e) => `'${e}'`).join(` or `);
  return new CLIError(`Flag schema field '${t}' requires kind ${r}, received kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: t, requiredKinds: [...n] }, suggest: `Drop '${t}' or declare the flag as kind ${r}` });
}
function buildFlagSchema(e, t) {
  let n = assembleFlagSchema(e, t);
  return assertValidFlagDefault(undefined, n), n;
}
function assembleFlagSchema(e, t) {
  let n = t?.aliases === undefined ? [] : normalizeFlagAliases(t.aliases), { aliases: r, presence: i, stdin: a, unique: o, envAbsolute: s, envFromName: c, sensitive: l, propagate: u, duplicates: d, duplicateKeys: f, ...p } = t ?? {};
  return { kind: e, presence: i ?? `optional`, defaultValue: undefined, defaultDescription: undefined, sensitive: l === true || p.prompt?.kind === `password` || p.prompt?.sensitive === true, stdin: a === undefined ? undefined : normalizeStdinBinding(a), envVar: undefined, configPath: undefined, description: undefined, group: undefined, enumValues: undefined, numberConstraints: undefined, stringConstraints: undefined, elementSchema: undefined, separator: undefined, split: undefined, duplicateKeys: f ?? `last`, unique: o ?? false, envAbsolute: s ?? false, envFromName: c ?? false, pathChecks: undefined, valueHint: undefined, prompt: undefined, parseFn: undefined, standard: undefined, aggregateStandard: undefined, deprecated: undefined, propagate: u ?? false, negation: undefined, separateValue: undefined, variadic: undefined, duplicates: d ?? `last`, ...p, envIndexed: p.envIndexed === undefined ? undefined : normalizeIndexedEnvBinding(p.envIndexed), aliases: n };
}
function assertValidFlagDefault(e, t) {
  if (t.defaultValue === undefined)
    return;
  let n = validateDefault(flagValueSchema(t), flagCardinality(t), flagAggregateStandard(t), t.defaultValue);
  if (n !== undefined)
    throw defaultViolationError(e === undefined ? `${indefiniteArticle(t.kind)} ${t.kind} flag` : `flag --${e}`, { kind: t.kind, ...e === undefined ? {} : { flag: e } }, n, t.sensitive);
}
function createFlagSchema(e, t) {
  if (typeof e == `string`) {
    let n = t ?? {};
    return assertValidFlagDefinition(e, n), buildFlagSchema(e, normalizeFlagDefinitionFields(n));
  }
  let { kind: n, ...r } = e;
  return assertValidFlagDefinition(n, r), buildFlagSchema(n, normalizeFlagDefinitionFields(r));
}
function nextFlag(e) {
  return assertValidFlagDefinition(e.kind, e), assertValidFlagDefault(undefined, e), new FlagBuilder(e);
}
function assertFlagElementBuilder(e, t) {
  if (t instanceof FlagBuilder)
    assertEligibleFlagElementBuilder(t.schema);
  else
    throw new CLIError(`flag.${e}() requires an element builder`, { code: `INVALID_SCHEMA`, details: { factory: e, field: `element`, received: typeof t }, suggest: `Pass an element builder, as in flag.${e}(flag.string())` });
}
function isNormalizedArgSchema(e) {
  return NORMALIZED_ARG_SCHEMA_KEYS.every((t) => Object.hasOwn(e, t));
}
function assertValidArgElementSchema(e) {
  if (e.kind === `keyValue`)
    throw new CLIError(`Arg element schema kind 'keyValue' is not supported`, { code: `INVALID_SCHEMA`, details: { kind: e.kind, field: `kind` }, suggest: `Use a scalar value kind for the key-value element` });
  for (let [t, n] of [[`sensitive`, false], [`defaultDescription`, undefined], [`presence`, `required`], [`variadic`, false], [`stdin`, undefined], [`defaultValue`, undefined], [`description`, undefined], [`group`, undefined], [`envVar`, undefined], [`envIndexed`, undefined], [`envAbsolute`, false], [`envFromName`, false], [`configPath`, undefined], [`prompt`, undefined], [`completion`, undefined], [`elementSchema`, undefined], [`separator`, undefined], [`split`, undefined], [`duplicateKeys`, `last`], [`unique`, false], [`aggregateStandard`, undefined], [`deprecated`, undefined]])
    if (e[t] !== n)
      throw new CLIError(`Arg element schema field '${String(t)}' is not supported`, { code: `INVALID_SCHEMA`, details: { kind: e.kind, field: t }, suggest: `Drop '${String(t)}' from the key-value element` });
}
function normalizeArgElementSchema(e) {
  if (isNormalizedArgSchema(e))
    return assertValidArgDefinition(e.kind, e), assertValidArgElementSchema(e), e;
  let { kind: t, ...n } = e;
  assertValidArgDefinition(t, n);
  let r = buildArgSchema(t, normalizeArgDefinitionFields(n));
  return assertValidArgElementSchema(r), r;
}
function normalizeArgDefinitionFields(e) {
  let { elementSchema: t, ...n } = e;
  return t === undefined ? n : { ...n, elementSchema: normalizeArgElementSchema(t) };
}
function assertValidArgDefinition(e, t) {
  assertKnownArgKind(e);
  for (let [n, r] of KIND_SPECIFIC_ARG_FIELDS)
    if (e !== r && t[n] !== undefined && (n !== `duplicateKeys` || t[n] !== `last`))
      throw new CLIError(`Arg schema field '${n}' requires kind '${r}', received kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: n, requiredKind: r }, suggest: `Drop '${n}' or declare the arg as kind '${r}'` });
  if (e === `enum` && t.enumValues === undefined)
    throw new CLIError(`Arg schema kind 'enum' requires field 'enumValues'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `enumValues` }, suggest: `Pass the allowed values in 'enumValues'` });
  if (t.duplicateKeys !== undefined && !DUPLICATE_KEYS.includes(t.duplicateKeys))
    throw new CLIError(`Unknown duplicate-key policy '${String(t.duplicateKeys)}'`, { code: `INVALID_SCHEMA`, details: { duplicateKeys: t.duplicateKeys, allowed: [...DUPLICATE_KEYS] }, suggest: `Use one of: ${DUPLICATE_KEYS.join(`, `)}` });
  let n = e === `keyValue` || t.variadic === true;
  if (t.aggregateStandard !== undefined && !n)
    throw new CLIError(`Arg schema field 'aggregateStandard' requires a collection, received a non-variadic '${e}' arg`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `aggregateStandard` }, suggest: `Add 'variadic: true', declare the arg as kind 'keyValue', or use 'standard'` });
  if (e === `keyValue` && t.prompt !== undefined)
    throw new CLIError(`Arg schema field 'prompt' is not available on kind 'keyValue'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `prompt` }, suggest: `Drop 'prompt' from the keyValue argument` });
  for (let r of COLLECTION_ARG_FIELDS)
    if (!(t[r] === undefined || n))
      throw new CLIError(`Arg schema field '${r}' requires a collection, received a non-variadic '${e}' arg`, { code: `INVALID_SCHEMA`, details: { kind: e, field: r }, suggest: `Add 'variadic: true', declare the arg as kind 'keyValue', or drop '${r}'` });
  if (t.unique === true && (e === `keyValue` || t.variadic !== true))
    throw new CLIError(`Arg schema field 'unique' requires a variadic arg of a list kind`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `unique` }, suggest: `Add 'variadic: true' on a list kind, or drop 'unique'` });
  if (t.envIndexed !== undefined && assertIndexedEnvArg(e, t), t.envFromName === true && (t.envVar !== undefined || t.envIndexed !== undefined))
    throw new CLIError(`Arg schema field 'envFromName' is mutually exclusive with 'envVar' and 'envIndexed'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envFromName` }, suggest: `Declare one env source: a derived name, a variable name, or an indexed family` });
  if (t.envAbsolute === true && t.envVar === undefined && t.envIndexed === undefined && t.envFromName !== true)
    throw new CLIError(`Arg schema field 'envAbsolute' requires an env source`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envAbsolute` }, suggest: `Bind an env source, or drop 'envAbsolute'` });
}
function assertIndexedEnvArg(e, t) {
  let n = t.envIndexed;
  if (n === undefined)
    return;
  if (normalizeIndexedEnvBinding(n), t.envVar !== undefined)
    throw new CLIError(`Arg schema fields 'envVar' and 'envIndexed' are mutually exclusive`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envIndexed` }, suggest: `Declare one env source: a variable name or an indexed family` });
  let r = e === `custom` && t.parseFn === undefined, i = t.variadic === true && e !== `keyValue`;
  if (!r && !(i && n.fields === undefined))
    throw i ? new CLIError(`Indexed env records need a custom arg without a parse function, received kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envIndexed` }, suggest: `Use arg.custom(recordSchema).variadic() with a Standard Schema validator` }) : new CLIError(`Arg schema field 'envIndexed' requires a variadic arg or a custom arg without a parse function, received ${t.variadic === true ? `variadic ` : ``}kind '${e}'`, { code: `INVALID_SCHEMA`, details: { kind: e, field: `envIndexed` }, suggest: `Call .variadic() before .env(), use arg.custom(schema) with a Standard Schema validator, or bind a single variable` });
}
function assertKnownArgKind(e) {
  if (!ARG_KINDS.includes(e))
    throw new CLIError(`Unknown arg kind '${String(e)}'`, { code: `INVALID_SCHEMA`, details: { kind: e, allowed: [...ARG_KINDS] }, suggest: `Use one of: ${ARG_KINDS.join(`, `)}` });
}
function buildArgSchema(e, t) {
  let n = assembleArgSchema(e, t);
  return assertValidArgDefault(undefined, n), n;
}
function assembleArgSchema(e, t) {
  let { presence: n, variadic: r, stdin: i, unique: a, sensitive: o, duplicateKeys: s, envAbsolute: c, envFromName: l, ...u } = t ?? {};
  return { kind: e, presence: n ?? `required`, variadic: r ?? false, stdin: i === undefined ? undefined : normalizeStdinBinding(i), defaultValue: undefined, defaultDescription: undefined, sensitive: o === true || u.prompt?.kind === `password` || u.prompt?.sensitive === true, description: undefined, group: undefined, envVar: undefined, configPath: undefined, prompt: undefined, enumValues: undefined, elementSchema: undefined, numberConstraints: undefined, stringConstraints: undefined, pathChecks: undefined, valueHint: undefined, parseFn: undefined, separator: undefined, split: undefined, duplicateKeys: s ?? `last`, unique: a ?? false, envAbsolute: c ?? false, envFromName: l ?? false, standard: undefined, aggregateStandard: undefined, deprecated: undefined, ...u, envIndexed: u.envIndexed === undefined ? undefined : normalizeIndexedEnvBinding(u.envIndexed) };
}
function assertValidArgDefault(e, t) {
  if (t.defaultValue === undefined)
    return;
  let n = validateDefault(argValueSchema(t), argCardinality(t), argAggregateStandard(t), t.defaultValue);
  if (n !== undefined)
    throw defaultViolationError(e === undefined ? `${indefiniteArticle(t.kind)} ${t.kind} argument` : `argument <${e}>`, { kind: t.kind, ...e === undefined ? {} : { arg: e } }, n, t.sensitive);
}
function createArgSchema(e, t) {
  if (typeof e == `string`)
    return assertValidArgDefinition(e, t ?? {}), buildArgSchema(e, normalizeArgDefinitionFields(t ?? {}));
  let { kind: n, ...r } = e;
  return assertValidArgDefinition(n, r), buildArgSchema(n, normalizeArgDefinitionFields(r));
}
function nextArg(e) {
  return assertValidArgDefinition(e.kind, e), assertValidArgDefault(undefined, e), new ArgBuilder(e);
}
function assertArgElementBuilder(e, t) {
  if (!(t instanceof ArgBuilder))
    throw new CLIError(`arg.${e}() requires an element builder`, { code: `INVALID_SCHEMA`, details: { factory: e, field: `element`, received: typeof t }, suggest: `Pass an element builder, as in arg.${e}(arg.string())` });
}
function excludesOtherInputs(e) {
  return e.kind === `conflicts` || e.kind === `atMostOne` || e.kind === `exactlyOne`;
}
function constraintBuilder(e) {
  let t = (t) => typeof t == `string` ? { kind: Object.hasOwn(e.flags, t) ? `flag` : `arg`, name: t } : t;
  return { flag: (e) => ({ kind: `flag`, name: e }), arg: (e) => ({ kind: `arg`, name: e }), conflicts: (e, n) => ({ kind: `conflicts`, inputs: [t(e), t(n)] }), requires: (e, n) => ({ kind: `requires`, inputs: [t(e), t(n)] }), exactlyOne: (e, n, ...r) => ({ kind: `exactlyOne`, inputs: [t(e), t(n), ...r.map(t)] }), atMostOne: (e, n, ...r) => ({ kind: `atMostOne`, inputs: [t(e), t(n), ...r.map(t)] }), allOrNone: (e, n, ...r) => ({ kind: `allOrNone`, inputs: [t(e), t(n), ...r.map(t)] }) };
}
function constraintInputLabel(e) {
  return e.kind === `flag` ? `--${e.name}` : `<${e.name}>`;
}
function describeConstraint(e) {
  let [t, n, ...r] = e.inputs.map(constraintInputLabel), i = [t, n, ...r].join(`, `);
  switch (e.kind) {
    case `conflicts`:
      return `${t} conflicts with ${n}`;
    case `requires`:
      return `${t} requires ${n}`;
    case `exactlyOne`:
      return `Supply exactly one of ${i}`;
    case `atMostOne`:
      return `Supply at most one of ${i}`;
    case `allOrNone`:
      return `Supply all or none of ${i}`;
  }
}
function checkCommandConstraints(e) {
  for (let t of e.constraints ?? []) {
    let { kind: n, inputs: r } = t;
    if (!CONSTRAINT_KINDS.includes(n) || !Array.isArray(r) || r.some((e) => typeof e != `object` || !e || typeof e.name != `string` || e.kind !== `flag` && e.kind !== `arg`))
      throw new CLIError(`Invalid command constraint`, { code: `INVALID_SCHEMA`, details: { command: e.name } });
    if (r.length < 2 || (n === `conflicts` || n === `requires`) && r.length !== 2 || new Set(r.map(constraintInputLabel)).size !== r.length)
      throw new CLIError(`A command constraint needs distinct inputs`, { code: `INVALID_SCHEMA`, details: { command: e.name, kind: n } });
    for (let t of r)
      if (!(t.kind === `flag` ? Object.hasOwn(e.flags, t.name) : e.args.some((e) => e.name === t.name)))
        throw new CLIError(`Constraint references undeclared input ${constraintInputLabel(t)}`, { code: `INVALID_SCHEMA`, details: { command: e.name, kind: n, input: t } });
  }
}
function stageRank(e) {
  return RESOLUTION_ORDER.indexOf(e);
}
function sourceBindings(e, t) {
  let n = splitBindingOf(e.separator, e.split), r = acceptsArgv(e) ? [{ stage: `cli`, split: n.cli }] : [], i = e.stdin;
  return i !== undefined && r.push({ stage: `stdin`, when: i.when, consume: i.consume, trim: i.trim, split: n.stdin }), e.envVar === undefined ? e.envIndexed !== undefined && r.push({ stage: `env`, indexed: effectiveIndexedEnvBinding(e.envIndexed, t, e.envAbsolute) }) : r.push({ stage: `env`, envVar: effectiveEnvName(e.envVar, t, e.envAbsolute), split: n.env }), e.configPath !== undefined && r.push({ stage: `config`, configPath: e.configPath, split: n.env }), e.prompt !== undefined && r.push({ stage: `prompt`, prompt: e.prompt, split: n.env }), e.defaultValue !== undefined && r.push({ stage: `default`, defaultValue: e.defaultValue }), r;
}
function stdinBindingOf(e) {
  for (let t of e)
    if (t.stage === `stdin`)
      return t;
}
function envBindingOf(e) {
  for (let t of e)
    if (t.stage === `env`)
      return t;
}
function bindingsBeforePrompt(e) {
  return e.filter((e) => stageRank(e.stage) < PROMPT_RANK);
}
function bindingsFromPrompt(e) {
  return e.filter((e) => stageRank(e.stage) >= PROMPT_RANK);
}
function withPromptBinding(e, t, n) {
  let r = t.filter((e) => e.stage !== `prompt`);
  if (n === undefined)
    return r;
  let i = r.findIndex((e) => stageRank(e.stage) > PROMPT_RANK), a = i === -1 ? r.length : i, o = splitBindingOf(e.separator, e.split).env;
  return [...r.slice(0, a), { stage: `prompt`, prompt: n, split: o }, ...r.slice(a)];
}
function stdinConsumers(e, t) {
  let n = [];
  for (let [t, r] of Object.entries(e))
    r.stdin !== undefined && n.push({ kind: `flag`, name: t, stdin: r.stdin });
  for (let { name: e, schema: r } of t)
    r.stdin !== undefined && n.push({ kind: `arg`, name: e, stdin: r.stdin });
  return n;
}
function stdinConsumerReference(e) {
  return e.kind === `flag` ? `--${e.name}` : `<${e.name}>`;
}
function invocationSelectsStdin(e, t, n) {
  for (let [t, r] of Object.entries(e)) {
    let e = acceptsArgv(r) && Object.hasOwn(n.flags, t);
    if (inputSelectsStdin(r.stdin, e, e ? n.flags[t] : undefined))
      return true;
  }
  for (let { name: e, schema: r } of t) {
    let t = acceptsArgv(r) && Object.hasOwn(n.args, e), i = t ? n.args[e] : undefined;
    if (inputSelectsStdin(r.stdin, t && !argCollectedNothing(r, i), i))
      return true;
  }
  return false;
}
function argCollectedNothing(e, t) {
  return e.variadic && Array.isArray(t) && t.length === 0;
}
function inputSelectsStdin(e, t, n) {
  return e === undefined ? false : !t || n === undefined ? stdinReadsWhenMissing(e) : stdinReadsOnDash(e) ? Array.isArray(n) ? n.includes(`-`) : n === `-` : false;
}
function resolveExampleCommand(e, t) {
  return typeof e == `function` ? e(t) : e;
}
function assertUsableFlagKey(e, t) {
  if (t === `__proto__`)
    throw new CLIError(`Flag name '__proto__' is not usable as a flag`, { code: `INVALID_SCHEMA`, details: { command: e, flag: `__proto__` }, suggest: `Rename the flag, for example to "proto"` });
}
function assertUsableFlagRecord(e, t) {
  if (Object.getOwnPropertySymbols(t).length > 0)
    throw new CLIError(`Command '${e}' flag names must be strings`, { code: `INVALID_SCHEMA`, details: { command: e } });
  let n = Object.getPrototypeOf(t);
  if (n !== Object.prototype && n !== null)
    throw new CLIError(`Command '${e}' flag record has a replaced prototype. A '__proto__' key sets the prototype instead of adding a flag, and an inherited flag is never read`, { code: `INVALID_SCHEMA`, details: { command: e }, suggest: `Pass a plain object with no '__proto__' key, or a record built with Object.create(null)` });
}
function declaredFlagNames(e) {
  return e.flagDeclarationOrder ?? Object.keys(e.flags);
}
function flagOrderOverride(e, t) {
  return Object.keys(e).some((e, n) => e !== t[n]) ? t : undefined;
}
function withCommandFlag(e, t, n) {
  if (assertUsableFlagKey(e.name, t), Object.hasOwn(e.flags, t))
    throw new CLIError(`Command '${e.name}' already defines flag --${t}`, { code: `FLAG_NAME_COLLISION`, details: { command: e.name, flag: t, surface: t, surfaceKind: `canonical` } });
  let r = withEnvFromName(t, n);
  validateFlagStdinEntry(e.name, t, r, e.flags, e.args);
  let i = { ...e.flags, [t]: r }, a = flagOrderOverride(i, [...declaredFlagNames(e), t]), o = { ...e, flags: i, ...a === undefined ? {} : { flagDeclarationOrder: a }, hasAction: false };
  return validateCommandFlagTree(o), o;
}
function assertUsableArgKey(e, t) {
  if (t === `__proto__`)
    throw new CLIError(`Argument name '${t}' is not usable as an argument`, { code: `INVALID_SCHEMA`, details: { command: e, arg: t }, suggest: `Rename the argument, for example to "proto"` });
}
function checkHelpTopic(e, t) {
  if (typeof e != `string` || e === `all` || !/^[a-z][a-z0-9-]*$/u.test(e))
    throw new CLIError(`Invalid help topic name '${e}'`, { code: `INVALID_SCHEMA`, suggest: `Use a lowercase name such as "runners". "all" is reserved for full help.` });
  if (typeof t != `string` || t.trim() === ``)
    throw new CLIError(`Help topic '${e}' requires a flag group name`, { code: `INVALID_SCHEMA` });
}
function buildCommandSchema(e) {
  if (e.name === `` || /\s/u.test(e.name))
    throw new CLIError(`Command schema requires a non-empty name without whitespace`, { code: `INVALID_SCHEMA`, details: { name: e.name }, suggest: `Pass a dispatch name such as { name: "deploy" }` });
  let t = e.flags ?? {};
  assertUsableFlagRecord(e.name, t);
  let n = {};
  for (let [r, i] of Object.entries(t)) {
    assertUsableFlagKey(e.name, r);
    let t = withEnvFromName(r, createFlagSchema(i));
    validateFlagStdinEntry(e.name, r, t, n, []), n[r] = t;
  }
  let r = [];
  for (let t of e.args ?? []) {
    let i = withEnvFromName(t.name, createArgSchema(t.schema));
    validateArgEntry(e.name, t.name, i, n, r), r.push({ name: t.name, schema: i });
  }
  let i = e.flagDeclarationOrder === undefined ? undefined : flagOrderOverride(n, [.../* @__PURE__ */ new Set([...e.flagDeclarationOrder.filter((e) => Object.hasOwn(n, e)), ...Object.keys(n)])]), a = Object.entries(e.helpTopics ?? {});
  for (let [e, t] of a)
    checkHelpTopic(e, t);
  let o = { name: e.name, description: e.description, details: e.details, aliases: e.aliases ?? [], hidden: e.hidden ?? false, examples: e.examples ?? [], flags: n, ...i === undefined ? {} : { flagDeclarationOrder: i }, ...a.length > 0 ? { helpTopics: Object.fromEntries(a) } : {}, args: r, ...e.constraints?.length ? { constraints: e.constraints } : {}, ...e.validators?.length ? { validators: e.validators } : {}, hasAction: e.hasAction ?? false, interactive: e.interactive, commands: (e.commands ?? []).map((e) => buildCommandSchema(e)) };
  return checkCommandConstraints(o), o;
}
function withEnvFromName(e, t) {
  return t.envFromName ? { ...t, envVar: deriveEnvName(e), envFromName: false } : t;
}
function createCommandSchema(e) {
  let t = buildCommandSchema(e);
  return validateCommandFlagTree(t), t;
}
function validateArgEntry(e, t, n, r, i) {
  assertUsableArgKey(e, t), acceptsArgv(n) && assertVariadicIsLast(e, t, i), assertStdinExclusivity(e, { kind: `arg`, name: t, stdin: n.stdin }, r, i);
}
function assertVariadicIsLast(e, t, n) {
  let r = n.find((e) => acceptsArgv(e.schema) && e.schema.variadic);
  if (r !== undefined)
    throw new CLIError(`Argument <${t}> comes after variadic argument <${r.name}>, which consumes every remaining positional`, { code: `INVALID_BUILDER_STATE`, details: { command: e, arg: t, variadicArg: r.name }, suggest: `Declare <${t}> before <${r.name}>, or drop .variadic() from <${r.name}>` });
}
function assertStdinExclusivity(e, t, n, r) {
  let i = t.stdin;
  if (i !== undefined) {
    for (let a of stdinConsumers(n, r))
      if ((a.kind !== t.kind || a.name !== t.name) && (i.consume !== `broadcast` || a.stdin.consume !== `broadcast`))
        throw new CLIError(`Only one input may consume stdin exclusively; ${stdinConsumerReference(a)} already consumes stdin`, { code: `DUPLICATE_STDIN_INPUT`, details: { command: e, ...t.kind === `flag` ? { flag: t.name } : { arg: t.name }, ...a.kind === `flag` ? { existingFlag: a.name } : { existingArg: a.name } }, suggest: `Keep .stdin() on a single input per command, or declare every stdin input with { consume: 'broadcast' }` });
  }
}
function validateFlagStdinEntry(e, t, n, r, i) {
  assertStdinExclusivity(e, { kind: `flag`, name: t, stdin: n.stdin }, r, i);
}
function formatFlagToken(e, t) {
  return t === `alias` && e.length === 1 ? `-${e}` : `--${e}`;
}
function describeFlagForm(e) {
  if (e.kind === `canonical`)
    return `canonical flag ${formatFlagToken(e.name, e.kind)}`;
  if (e.kind === `negation`)
    return `${e.hidden ? `hidden ` : ``}negated spelling ${formatFlagToken(e.name, e.kind)}`;
  let t = e.name.length === 1 ? `short alias` : `long alias`;
  return `${e.hidden ? `hidden ` : ``}${t} ${formatFlagToken(e.name, e.kind)}`;
}
function listFlagForms(e, t) {
  if (!acceptsArgv(t))
    return [];
  let n = getFlagNegatedName(e, t);
  return [{ owner: e, name: e, kind: `canonical`, hidden: false }, ...t.aliases.map((t) => ({ owner: e, name: t.name, kind: `alias`, hidden: t.hidden })), ...n !== undefined && t.negation !== undefined ? [{ owner: e, name: n, kind: `negation`, hidden: t.negation.hidden }] : []];
}
function throwFlagCollisionError(e, t, n, r) {
  let i = r?.inherited ?? false, a = `flag ${formatFlagToken(n.owner, `canonical`)}`, o = `Command '${e}' ${a}`;
  throw new CLIError(i ? `${o} propagates ${describeFlagForm(n)}, which collides with ${describeFlagForm(t)} on flag ${formatFlagToken(t.owner, `canonical`)}` : `Command '${e}' flag ${formatFlagToken(t.owner, `canonical`)} ${describeFlagForm(t)} collides with ${describeFlagForm(n)} on ${a}`, { code: i ? `PROPAGATED_FLAG_COLLISION` : `FLAG_NAME_COLLISION`, details: { command: e, flag: t.owner, surface: t.name, surfaceKind: t.kind, hidden: t.hidden, existingFlag: n.owner, existingSurface: n.name, existingSurfaceKind: n.kind, existingHidden: n.hidden, inherited: i } });
}
function validateLocalFlagCollisions(e, t) {
  let n = /* @__PURE__ */ new Map;
  for (let [r, i] of Object.entries(t))
    for (let t of listFlagForms(r, i)) {
      let r = n.get(t.name);
      r !== undefined && throwFlagCollisionError(e, t, r), n.set(t.name, t);
    }
}
function validateInheritedFlagCollisions(e, t, n) {
  let r = /* @__PURE__ */ new Map;
  for (let [e, n] of Object.entries(t))
    for (let t of listFlagForms(e, n))
      r.set(t.name, t);
  for (let [t, i] of Object.entries(n))
    for (let n of listFlagForms(t, i)) {
      let t = r.get(n.name);
      t !== undefined && throwFlagCollisionError(e, n, t, { inherited: true });
    }
}
function buildInheritedFlagsForChildren(e, t) {
  let n = { ...e };
  for (let e of Object.keys(t))
    delete n[e];
  for (let [e, r] of Object.entries(t))
    r.propagate && (n[e] = r);
  return n;
}
function validateCommandFlagTree(e, t = {}) {
  validateLocalFlagCollisions(e.name, e.flags);
  let n = { ...t };
  for (let t of Object.keys(e.flags))
    delete n[t];
  validateInheritedFlagCollisions(e.name, n, e.flags);
  let r = { ...n, ...e.flags };
  for (let [t, n] of Object.entries(r))
    validateFlagStdinEntry(e.name, t, n, r, e.args);
  let i = buildInheritedFlagsForChildren(t, e.flags);
  for (let t of e.commands)
    validateCommandFlagTree(t, i);
}
function eraseBuilder(e) {
  return e;
}
function command(e) {
  return new CommandBuilder(createCommandSchema({ name: e }));
}
function wasExplicit(e) {
  return e !== undefined && e.stage !== "default";
}
function markArgvBoundaries(e, t) {
  t.size > 0 && boundaries.set(e, t);
}
function hasArgvBoundary(e, t) {
  return boundaries.get(e)?.has(t) === true;
}
function adjacentArgvValue(e, t) {
  return hasArgvBoundary(e, t + 1) ? undefined : e[t + 1];
}
function sliceArgvHead(e, t) {
  let n = e.slice(0, t), r = boundaries.get(e);
  return r !== undefined && markArgvBoundaries(n, r), n;
}
function removeArgvToken(e, t) {
  let n = [...e.slice(0, t), ...e.slice(t + 1)], r = /* @__PURE__ */ new Set([t]);
  for (let n of boundaries.get(e) ?? [])
    r.add(n > t ? n - 1 : n);
  return markArgvBoundaries(n, r), n;
}
function occurrenceValue(e) {
  switch (e.kind) {
    case `value`:
      return e.value;
    case `entry`:
      return [e.key, e.value];
    case `stdin`:
      return `-`;
    case `negated`:
      return false;
    case `increment`:
      return 1;
    case `aggregated`:
      return e.value;
  }
}
function projectOccurrences(e, t) {
  if (e.kind === `count`)
    return projectCount(t);
  if (e.kind === `one`) {
    let e = t[t.length - 1];
    return e === undefined ? undefined : occurrenceValue(e);
  }
  return t.map(occurrenceValue);
}
function projectCount(e) {
  let t;
  for (let n of e)
    t = n.kind === `increment` ? (typeof t == `number` ? t : 0) + 1 : occurrenceValue(n);
  return t;
}
function liftOccurrences(e, t, n) {
  return Array.isArray(t) ? t.map((t) => liftElement(e, t, n)) : [{ kind: `aggregated`, value: t }];
}
function liftElement(e, t, n) {
  if (n && t === `-`)
    return STDIN_OCCURRENCE;
  if (e.kind === `entries`) {
    let e = entryPairOf(t);
    if (e !== undefined)
      return { kind: `entry`, key: e[0], value: e[1] };
  }
  return { kind: `value`, value: t };
}
function entryPairOf(e) {
  if (!Array.isArray(e) || e.length !== 2)
    return;
  let t = e[0], n = e[1];
  return typeof t == `string` ? [t, n] : undefined;
}
function readAggregated(e) {
  let t = e.length === 1 ? e[0] : undefined;
  return t?.kind === `aggregated` ? { value: t.value } : undefined;
}
function entryPairsOf(e) {
  let t = [];
  for (let n of e)
    n.kind === `entry` && t.push([n.key, n.value]);
  return t;
}
function tokenize(e) {
  let t = [], n = false;
  for (let r of e)
    if (n)
      t.push({ kind: `positional`, value: r });
    else if (r === `--`)
      t.push({ kind: `separator` }), n = true;
    else if (r.startsWith(`--`)) {
      let e = r.indexOf(`=`);
      e === -1 ? t.push({ kind: `long-flag`, name: r.slice(2), value: undefined }) : t.push({ kind: `long-flag`, name: r.slice(2, e), value: r.slice(e + 1) });
    } else
      r.startsWith(`-`) && r.length > 1 ? t.push({ kind: `short-flags`, chars: r.slice(1) }) : t.push({ kind: `positional`, value: r });
  return t;
}
function includesBeforeSeparator(e, t) {
  for (let n of e) {
    if (n === `--`)
      return false;
    if (n === t)
      return true;
  }
  return false;
}
function helpFlagMode(e) {
  if (e === `--help=all`)
    return `all`;
  if (e === `--help` || e === `-h`)
    return `short`;
}
function requestedHelpMode(e, t) {
  for (let n of e) {
    if (n === `--`)
      break;
    let e = helpFlagMode(n);
    if (e !== undefined)
      return e;
    if (t !== undefined && n.startsWith(`--help=`)) {
      let e = n.slice(7), r = Object.hasOwn(t, e) ? t[e] : undefined;
      if (r !== undefined)
        return { name: e, group: r };
    }
  }
}
function requestsHelp(e, t) {
  return requestedHelpMode(e, t) !== undefined;
}
function pendingFlagReads(e) {
  return deferredCustomFlags.get(e);
}
function pendingFlagErrors(e) {
  return deferredFlagDiagnostics.get(e);
}
function redactFlagParseError(e) {
  return sensitiveFlagDiagnostics.get(e)?.() ?? e;
}
function flagDiagnostic(e, t) {
  let n = e(t);
  return sensitiveFlagDiagnostics.set(n, () => e(true)), n;
}
function retainFlagError(e, t, n) {
  let r = deferredFlagDiagnostics.get(e);
  if (!(n instanceof ParseError) || !sensitiveFlagDiagnostics.has(n) || r === undefined)
    throw n;
  r.has(t) || r.set(t, n);
}
function kebabToCamel(e) {
  return e.replace(/-+([a-z0-9])/g, (e, t) => t.toUpperCase());
}
function camelToKebab(e) {
  return e.replace(/([a-z0-9])([A-Z])/g, `$1-$2`).toLowerCase();
}
function counterpartSpelling(e) {
  if (e.length < 2)
    return;
  if (e.includes(`-`)) {
    let t = kebabToCamel(e);
    return t === e ? undefined : t;
  }
  let t = camelToKebab(e);
  return t === e ? undefined : t;
}
function negationCounterpart(e) {
  if (!e.negated || e.schema.negation?.alias !== undefined)
    return;
  let t = counterpartSpelling(e.name);
  return t === undefined ? undefined : `no-${t}`;
}
function buildFlagLookup(e, t) {
  let n = /* @__PURE__ */ new Map;
  for (let [t, r] of Object.entries(e)) {
    if (!acceptsArgv(r))
      continue;
    n.set(t, { name: t, schema: r, negated: false, parity: false });
    for (let e of getFlagAliasNames(r, { includeHidden: true }))
      n.set(e, { name: t, schema: r, negated: false, parity: false });
    let e = getFlagNegatedName(t, r);
    e !== undefined && n.set(e, { name: t, schema: r, negated: true, parity: false });
  }
  if (t?.caseParity !== false) {
    let e = [...n];
    for (let [t, r] of e) {
      let e = counterpartSpelling(t);
      e !== undefined && !n.has(e) && n.set(e, { ...r, parity: true });
    }
    for (let [, t] of e) {
      let e = negationCounterpart(t);
      e !== undefined && !n.has(e) && n.set(e, { ...t, parity: true });
    }
  }
  return n;
}
function occurrencesOf(e, t, n) {
  let r = e.get(t);
  if (r !== undefined)
    return r;
  let i = { schema: n, occurrences: [], counted: 0 };
  return e.set(t, i), i;
}
function recordFlagOccurrence(e, t, n, r, i, a) {
  let o = deferredCustomFlags.get(e);
  if (o !== undefined && deferredFlagDiagnostics.get(e)?.size && flagValueSchema(n).codec.name === `custom`) {
    let s = o.get(t);
    o.set(t, (o = true) => {
      if (s?.(false), recordFlagValue(e, t, n, r, i, a), o) {
        let r = occurrencesOf(e, t, n);
        return projectOccurrences(flagCardinality(n), r.occurrences.flatMap((e) => e.items));
      }
    });
  } else
    try {
      recordFlagValue(e, t, n, r, i, a);
    } catch (n) {
      retainFlagError(e, t, n);
    }
}
function recordFlagValue(e, t, n, r, i, a) {
  let o = occurrencesOf(e, t, n);
  if (o.counted += 1, o.counted > 1 && n.duplicates === `error`) {
    let e = o.counted, a = [...o.occurrences.filter((e) => e.policed).map((e) => e.reported), r];
    throw flagDiagnostic((n) => {
      let r = diagnosticValue(n, a);
      return new ParseError(`Flag --${t} may only be specified once`, { code: `DUPLICATE_FLAG`, details: { flag: t, input: i, count: e, ...r.kind === `visible` ? { values: r.value } : {} } });
    }, n.sensitive);
  }
  o.counted > 1 && n.duplicates === `first` || o.occurrences.push({ policed: true, reported: r, items: a() });
}
function recordCountIncrement(e, t, n) {
  occurrencesOf(e, t, n).occurrences.push({ policed: false, reported: undefined, items: [INCREMENT_OCCURRENCE] });
}
function projectFlags(e) {
  let t = {};
  for (let [n, r] of e)
    t[n] = projectOccurrences(flagCardinality(r.schema), r.occurrences.flatMap((e) => e.items));
  return t;
}
function flagExpectsValue(e) {
  return e.kind !== `boolean` && e.kind !== `count`;
}
function consumesSeparateBoolean(e, t) {
  return !e.negated && e.schema.separateValue === true && (t === `true` || t === `false` || t === `1` || t === `0`);
}
function isPositionalValue(e) {
  return e === `-` || !e.startsWith(`-`);
}
function variadicLongValueCount(e, t, n, r, i) {
  let a = 0;
  for (let o = t + 1;!hasArgvBoundary(e, o); o++) {
    let t = o === e.length ? i : e[o];
    if (t === undefined || t === `--`)
      break;
    if (!isPositionalValue(t)) {
      if (r || a > 0 || helpFlagMode(t) !== undefined)
        break;
      let e = t.startsWith(`--`) ? t.slice(2).split(`=`, 1)[0] : t.charAt(1);
      if (e !== undefined && n.has(e))
        break;
    }
    a++;
  }
  return a;
}
function isStdinSentinel(e, t) {
  return e === `-` && t !== undefined && stdinReadsOnDash(t);
}
function coerceFlagValue(e, t, n, r = `--${e}`) {
  return occurrenceValue(flagTokenOccurrence(e, t, n, r));
}
function flagTokenOccurrence(e, t, n, r) {
  if (isStdinSentinel(t, n.stdin))
    return STDIN_OCCURRENCE;
  let i = flagCardinality(n);
  if (i.kind === `count`)
    return { kind: `value`, value: coerceCountToken(e, t, r, n.sensitive) };
  if (i.kind === `entries`) {
    let [i, a] = coerceEntryToken(e, t, n, r);
    return { kind: `entry`, key: i, value: a };
  }
  return { kind: `value`, value: coerceElementToken(e, t, n, r) };
}
function coerceElementToken(e, t, n, r) {
  let i = decodeValue(flagValueSchema(n), t, `token`);
  if (i.ok)
    return i.value;
  throw flagValueError(e, r, t, i.failure, n.sensitive);
}
function coerceCountToken(e, t, n, r) {
  let i = t.trim() === `` ? NaN : Number(t);
  if (!Number.isInteger(i) || i < 0)
    throw flagDiagnostic((r) => {
      let i = diagnosticValue(r, t);
      return new ParseError(`Invalid count value '${i.text}' for flag ${n}. Use a non-negative integer`, { code: `INVALID_VALUE`, details: { flag: e, input: n, ...i.kind === `visible` ? { value: i.value } : {}, expected: `count` } });
    }, r);
  return i;
}
function coerceEntryToken(e, t, n, r) {
  let i = splitEntryPair(t);
  if (i === undefined)
    throw flagDiagnostic((n) => {
      let i = diagnosticValue(n, t);
      return new ParseError(`Invalid value '${i.text}' for flag ${r}. Use KEY=VALUE`, { code: `INVALID_VALUE`, details: { flag: e, input: r, ...i.kind === `visible` ? { value: i.value } : {}, expected: `key=value` } });
    }, n.sensitive);
  return [i[0], coerceElementToken(e, i[1], n, r)];
}
function valueParseError(e, t, n) {
  let r = diagnosticValue(e.sensitive, t), i = { ...e.details, ...r.kind === `visible` ? { value: r.value } : {} };
  switch (n.kind) {
    case `type`:
      return n.expected === `number` ? new ParseError(`Invalid number value '${r.text}' for ${e.label}`, { code: `INVALID_VALUE`, details: { ...i, expected: `number` } }) : n.expected === `boolean` ? new ParseError(`Invalid boolean value '${r.text}' for ${e.label}. Use true/false or 1/0`, { code: `INVALID_VALUE`, details: { ...i, expected: `boolean` } }) : new ParseError(`Invalid value '${r.text}' for ${e.label}`, { code: `INVALID_VALUE`, details: { ...i, expected: `string` } });
    case `enum`: {
      let t = n.enumValues;
      return t === undefined ? new ParseError(`${e.enumLabel} is misconfigured: no allowed values declared`, { code: `INVALID_SCHEMA`, details: e.enumDetails }) : new ParseError(`Invalid value '${r.text}' for ${e.label}. Allowed: ${t.join(`, `)}`, { code: `INVALID_VALUE`, details: { ...i, allowed: t } });
    }
    case `string-constraint`:
      return new ParseError(`Invalid value '${r.text}' for ${e.label}: ${describeStringConstraintViolation(n.violation)}`, { code: `INVALID_VALUE`, details: { ...i, expected: `string`, ...stringConstraintDetails(n.violation) } });
    case `number-constraint`:
      return new ParseError(`Invalid number value '${r.text}' for ${e.label}: ${describeNumberConstraintViolation(n.violation)}`, { code: `INVALID_VALUE`, details: { ...i, expected: `number`, constraint: n.violation.kind, ...`bound` in n.violation ? { bound: n.violation.bound } : {} } });
    case `thrown`: {
      if (n.error instanceof ParseError)
        return e.sensitive ? new ParseError(n.error.message, { code: n.error.code, exitCode: n.error.exitCode, details: e.details, ...n.error.suggest === undefined ? {} : { suggest: n.error.suggest } }) : n.error;
      let t = n.error instanceof Error ? n.error.message : String(n.error);
      return new ParseError(`Failed to parse ${e.label} value '${r.text}': ${t}`, { code: `INVALID_VALUE`, details: i, ...r.kind === `visible` ? { cause: n.error } : {} });
    }
  }
}
function flagValueError(e, t, n, r, i) {
  return flagDiagnostic((i) => valueParseError({ details: { flag: e, input: t }, label: `flag ${t}`, enumDetails: { flag: e, kind: `enum`, missing: `enumValues` }, enumLabel: `Enum flag --${e}`, sensitive: i }, n, r), i);
}
function argTokenOccurrence(e, t, n) {
  if (isStdinSentinel(t, n.stdin))
    return STDIN_OCCURRENCE;
  if (argCardinality(n).kind === `entries`) {
    let r = splitEntryPair(t);
    if (r === undefined) {
      let r = diagnosticValue(n.sensitive, t);
      throw new ParseError(`Invalid value '${r.text}' for argument <${e}>. Use KEY=VALUE`, { code: `INVALID_VALUE`, details: { arg: e, ...r.kind === `visible` ? { value: r.value } : {}, expected: `key=value` } });
    }
    return { kind: `entry`, key: r[0], value: decodeArgToken(e, r[1], n) };
  }
  return { kind: `value`, value: decodeArgToken(e, t, n) };
}
function decodeArgToken(e, t, n) {
  let r = decodeValue(argValueSchema(n), t, `token`);
  if (r.ok)
    return r.value;
  throw argValueError(e, t, r.failure, n.sensitive);
}
function argValueError(e, t, n, r) {
  return valueParseError({ details: { arg: e }, label: `argument <${e}>`, enumDetails: { arg: e, kind: `enum`, missing: `enumValues` }, enumLabel: `Enum argument <${e}>`, sensitive: r }, t, n);
}
function parse(e, t, n) {
  return parseCommand(e, t, n, /* @__PURE__ */ new Map);
}
function parseForResolution(e, t, n) {
  let r = /* @__PURE__ */ new Map;
  return deferredFlagDiagnostics.set(r, /* @__PURE__ */ new Map), deferredCustomFlags.set(r, /* @__PURE__ */ new Map), parseCommand(e, t, n, r);
}
function parseCommand(e, t, n, r) {
  let i = tokenize(t), a = buildFlagLookup(e.flags, n), o = [], s = 0;
  for (;s < i.length; ) {
    let e = i[s];
    if (e === undefined)
      break;
    if (e.kind === `separator`)
      s++;
    else if (e.kind === `positional`)
      o.push(e.value), s++;
    else
      try {
        s = e.kind === `long-flag` ? parseLongFlag(e, t, s, a, r) : parseShortFlags(e, i, s, a, r);
      } catch (e) {
        if (!(e instanceof ParseError) || !deferredFlagDiagnostics.get(r)?.size)
          throw e;
        s++;
      }
  }
  let c = deferredFlagDiagnostics.get(r), l = c?.size ? {} : mapPositionals(e.args.filter((e) => acceptsArgv(e.schema)), o), u = projectFlags(r);
  c !== undefined && deferredFlagDiagnostics.set(u, c);
  let d = deferredCustomFlags.get(r);
  return d?.size && deferredCustomFlags.set(u, d), { flags: u, args: l };
}
function parseLongFlag(e, t, n, r, i) {
  let a = r.get(e.name);
  if (!a) {
    let t = suggestFlag(e.name, r);
    throw new ParseError(`Unknown flag --${e.name}${t ? `. Did you mean --${t}?` : ``}`, { code: `UNKNOWN_FLAG`, details: { flag: e.name, ...t ? { suggestion: t } : {} }, ...t ? { suggest: `--${t}` } : {} });
  }
  let { name: o, schema: s, negated: c } = a, l = `--${e.name}`;
  if (c)
    return e.value === undefined ? (recordFlagOccurrence(i, o, s, false, l, () => [NEGATED_OCCURRENCE]), n + 1) : (retainFlagError(i, o, flagDiagnostic((t) => {
      let n = diagnosticValue(t, e.value);
      return new ParseError(`Flag ${l} does not take a value`, { code: `INVALID_VALUE`, details: { flag: o, input: e.name, ...n.kind === `visible` ? { value: n.value } : {} } });
    }, s.sensitive)), n + 1);
  if (!flagExpectsValue(s)) {
    let r = adjacentArgvValue(t, n), c = e.value === undefined && consumesSeparateBoolean(a, r) ? r : undefined, u = e.value ?? c;
    if (u !== undefined)
      try {
        let e = flagTokenOccurrence(o, u, s, l);
        recordFlagOccurrence(i, o, s, occurrenceValue(e), l, () => [e]);
      } catch (e) {
        retainFlagError(i, o, e);
      }
    else
      s.kind === `count` ? recordCountIncrement(i, o, s) : recordFlagOccurrence(i, o, s, true, l, () => [{ kind: `value`, value: true }]);
    return n + (c === undefined ? 1 : 2);
  }
  if (s.variadic === true) {
    let a = variadicLongValueCount(t, n, r, e.value !== undefined), c = t.slice(n + 1, n + a + 1), u = e.value === undefined ? c : [e.value, ...c];
    if (u.length === 0)
      throw missingValue(o, e.name, s.kind);
    return recordFlagOccurrence(i, o, s, u, l, () => u.flatMap((e) => flagTokenOccurrences(o, s, e, l))), n + 1 + a;
  }
  if (e.value !== undefined) {
    let t = e.value;
    return recordFlagOccurrence(i, o, s, t, l, () => flagTokenOccurrences(o, s, t, l)), n + 1;
  }
  let u = t[n + 1];
  if (u === undefined || !isPositionalValue(u))
    throw missingValue(o, e.name, s.kind);
  return recordFlagOccurrence(i, o, s, u, l, () => flagTokenOccurrences(o, s, u, l)), n + 2;
}
function missingValue(e, t, n) {
  return new ParseError(`Flag --${t} requires a value`, { code: `MISSING_VALUE`, details: { flag: e, input: t, kind: n } });
}
function parseShortFlags(e, t, n, r, i) {
  let { chars: a } = e, o = n + 1;
  for (let e = 0;e < a.length; e++) {
    let n = a.charAt(e), s = r.get(n);
    if (!s)
      throw new ParseError(`Unknown flag -${n}`, { code: `UNKNOWN_FLAG`, details: { flag: n } });
    let { name: c, schema: l } = s, u = `-${n}`;
    if (!flagExpectsValue(l)) {
      l.kind === `count` ? recordCountIncrement(i, c, l) : recordFlagOccurrence(i, c, l, true, u, () => [{ kind: `value`, value: true }]);
      continue;
    }
    if (e < a.length - 1) {
      let t = a.slice(e + 1);
      recordFlagOccurrence(i, c, l, t, u, () => flagTokenOccurrences(c, l, t, u));
      break;
    }
    let d = t[o];
    if (d?.kind !== `positional`)
      throw new ParseError(`Flag -${n} requires a value`, { code: `MISSING_VALUE`, details: { flag: c, input: n, kind: l.kind } });
    recordFlagOccurrence(i, c, l, d.value, u, () => flagTokenOccurrences(c, l, d.value, u)), o++;
  }
  return o;
}
function flagTokenOccurrences(e, t, n, r = `--${e}`) {
  let i = flagCardinality(t);
  return isCollection(i) ? splitCliToken(i.cliSplit, n, t).map((n) => flagTokenOccurrence(e, n, t, r)) : [flagTokenOccurrence(e, n, t, r)];
}
function splitCliToken(e, t, n) {
  return isStdinSentinel(t, n.stdin) ? [t] : e.format === `delimiter` ? t.split(e.delimiter).filter((e) => e.length > 0) : [t];
}
function cliSplitOf(e) {
  return e.kind === `many` || e.kind === `entries` ? e.cliSplit : WHOLE_TOKEN;
}
function mapPositionals(e, t) {
  let n = {}, r = 0;
  for (let i of e) {
    let e = argCardinality(i.schema), a = cliSplitOf(e);
    if (i.schema.variadic) {
      let o = t.slice(r).flatMap((e) => splitCliToken(a, e, { stdin: i.schema.stdin }).map((e) => argTokenOccurrence(i.name, e, i.schema)));
      n[i.name] = projectOccurrences(e, o), r = t.length;
      break;
    }
    let o = t[r];
    if (o !== undefined) {
      let t = splitCliToken(a, o, { stdin: i.schema.stdin }).map((e) => argTokenOccurrence(i.name, e, i.schema));
      n[i.name] = projectOccurrences(e, t), r++;
    }
  }
  if (r < t.length) {
    let n = t.slice(r);
    throw new ParseError(`Unexpected positional argument${n.length > 1 ? `s` : ``}: ${n.join(`, `)}`, { code: `UNEXPECTED_POSITIONAL`, details: { excess: n, expected: e.length } });
  }
  return n;
}
function suggestFlag(e, t) {
  let n, r = 1 / 0, i = Math.max(2, Math.floor(e.length / 2));
  for (let [a, o] of t) {
    if (a.length < 2 || o.parity || o.negated && o.schema.negation?.hidden === true)
      continue;
    let t = o.schema.aliases.find((e) => e.name === a);
    if (a !== o.name && !o.negated && t?.hidden)
      continue;
    let s = levenshtein$1(e, a);
    s < r && s <= i && (r = s, n = a);
  }
  return n;
}
function levenshtein$1(e, t) {
  if (e === t)
    return 0;
  if (e.length === 0)
    return t.length;
  if (t.length === 0)
    return e.length;
  let n = e.length <= t.length ? e : t, r = e.length <= t.length ? t : e, i = n.length, a = r.length, o = Array.from({ length: i + 1 }, (e, t) => t);
  for (let e = 1;e <= a; e++) {
    let t = o[0] ?? 0;
    o[0] = e;
    for (let a = 1;a <= i; a++) {
      let i = n.charAt(a - 1) === r.charAt(e - 1) ? 0 : 1, s = Math.min((o[a] ?? 0) + 1, (o[a - 1] ?? 0) + 1, t + i);
      t = o[a] ?? 0, o[a] = s;
    }
  }
  return o[i] ?? 0;
}
function stripAnsi(e) {
  return f(e).replace(CSI, ``);
}
function visibleWidth(e) {
  return stripAnsi(e).length;
}
function osc8(e, t) {
  return emitLink(e, t);
}
function padEnd(e, t) {
  let n = visibleWidth(e);
  return n >= t ? e : e + ` `.repeat(t - n);
}
function splitWord(e, t) {
  let n = [], r = ``, i = 0;
  for (let [a] of e.matchAll(ESCAPE_OR_CHARACTER)) {
    let e = a.startsWith(`\x1B`) && a.length > 1 ? 0 : a.length;
    i > 0 && i + e > t && (n.push(r), r = ``, i = 0), r += a, i += e;
  }
  return n.push(r), n;
}
function wrapText(e, t, n, r = false) {
  if (visibleWidth(e) + n <= t)
    return e;
  let i = t - n;
  if (i <= 0)
    return e;
  let a = e.split(` `), o = r ? a.flatMap((e) => visibleWidth(e) > i ? splitWord(e, i) : [e]) : a, s = [], c = ``, l = 0;
  for (let e of o) {
    let t = visibleWidth(e);
    c.length === 0 ? (c = e, l = t) : l + 1 + t <= i ? (c += ` ${e}`, l += 1 + t) : (s.push(c), c = e, l = t);
  }
  c.length > 0 && s.push(c);
  let u = ` `.repeat(n);
  return s.map((e, t) => t === 0 ? e : `${u}${e}`).join(`
`);
}
function formatProgramHeader(e, t, n) {
  let r = t ? e.helpLinks : undefined, i = n.headerName(e.name), a = r?.name === undefined ? i : osc8(r.name, i);
  if (e.version === undefined)
    return a;
  let o = n.headerVersion(`v${e.version}`);
  return `${a} ${r?.version === undefined ? o : osc8(r.version, o)}`;
}
function defaultHelpTheme(e) {
  return { sectionTitle: (t) => e.bold(e.underline(t)), usageBin: e.bold, flag: e.cyan, placeholder: e.dim, command: e.cyan, arg: e.cyan, defaultValue: e.dim, annotation: e.dim, deprecated: e.yellow, headerName: e.bold, headerVersion: e.dim, examplePrompt: e.dim };
}
function resolveHelpTheme(e, t) {
  let n = e ?? O(false);
  return n.bold(`x`) === `x` || t === undefined ? defaultHelpTheme(n) : { ...defaultHelpTheme(n), ...t(n) };
}
function extendHelpTheme(e, t, n) {
  let r = t ?? O(false);
  return r.bold(`x`) !== `x` && n !== undefined ? { ...e, ...n(r) } : e;
}
function resolveHelpDescription(e, t) {
  return typeof e == `function` ? e(t) : e;
}
function resolvePlainHelpDescription(e) {
  return stripAnsi(resolveHelpDescription(e, defaultHelpTheme(O(false))));
}
function resolveOptions$1(e) {
  let t = resolveHelpTheme(e?.colors, e?.theme);
  return { width: e?.width ?? 80, binName: e?.binName, version: e?.version, flagOrder: e?.flagOrder ?? `alphabetical`, sortFlags: e?.sortFlags, groupOrder: e?.groupOrder ?? [], showAdvanced: e?.showAdvanced ?? false, flagSpelling: e?.flagSpelling ?? `declared`, caseParity: e?.caseParity ?? true, isDefaultHelp: e?.isDefaultHelp ?? false, envPrefix: e?.envPrefix, theme: t, descriptionTheme: extendHelpTheme(t, e?.colors, e?.descriptionTheme) };
}
function formatDeprecated(e) {
  return typeof e == `string` ? `[deprecated: ${e}]` : `[deprecated]`;
}
function formatHelpDefaultValue(e) {
  return e === undefined ? `undefined` : e === null ? `null` : formatDisplayValue(e);
}
function formatDefaultAnnotation(e, t, n) {
  if (e.defaultDescription !== false) {
    if (typeof e.defaultDescription == `string`)
      return t.defaultValue(`(default: ${e.defaultDescription})`);
    if (!(e.sensitive || n) && (e.presence === `defaulted` || e.defaultValue !== undefined))
      return t.defaultValue(`(default: ${formatHelpDefaultValue(e.defaultValue)})`);
  }
}
function spellingCheck(e, t) {
  if (t.flagSpelling === `declared`)
    return;
  let n = buildFlagLookup(e, { caseParity: t.caseParity });
  return (e, t, r) => {
    let i = n.get(e);
    return i?.name === t && i.negated === r;
  };
}
function kebabSpelling(e) {
  if (e.includes(`-`))
    return;
  let t = camelToKebab(e);
  return t.includes(`-`) ? t : undefined;
}
function formatFlagLeft(e, t, n, r) {
  let { theme: i } = n, a = getFlagAliasNames(t, { kind: `short` }), o = getFlagAliasNames(t, { kind: `long` }), s = (t, n) => {
    let i = r === undefined ? undefined : kebabSpelling(t);
    return i !== undefined && r?.(i, e, n) === true ? i : t;
  }, c = t.negation !== undefined && !t.negation.hidden ? t.negation : undefined, l = c !== undefined && c.alias === undefined, u = s(e, false), d = l && u !== e && r?.(`no-${u}`, e, true) !== true ? e : u, f = [...a.map((e) => `-${e}`), l ? `--[no-]${d}` : `--${d}`, ...o.map((e) => `--${s(e, false)}`), ...c?.alias === undefined ? [] : [`--${s(c.alias, true)}`]], p = i.flag(f.join(`, `));
  if (t.kind === `boolean` && t.separateValue !== true || t.kind === `count`)
    return { left: p };
  let m = formatValueHint(t), h = `${p} ${i.placeholder(m)}`, g = t.kind === `array` ? t.elementSchema : t, _ = g?.kind === `enum` && g.valueHint === undefined ? g.enumValues : undefined;
  if (t.valueHint !== undefined || _ === undefined || visibleWidth(h) + 2 <= n.width * 2 / 3)
    return { left: h };
  let v = t.kind === `array` ? `<value>...` : `<value>`;
  return { left: `${p} ${i.placeholder(v)}`, choices: _.map((e) => i.arg(e)) };
}
function formatValueHint(e) {
  if (e.valueHint !== undefined)
    return `<${e.valueHint}>`;
  switch (e.kind) {
    case `string`:
      return `<string>`;
    case `number`:
      return `<number>`;
    case `enum`:
      return `<${(e.enumValues ?? []).join(`|`)}>`;
    case `array`:
      return `<${e.elementSchema === undefined ? `value` : formatValueHint(e.elementSchema).slice(1, -1)}>...`;
    case `boolean`:
      return e.separateValue === true ? `[boolean]` : ``;
    case `count`:
      return ``;
    case `custom`:
      return `<value>`;
    case `keyValue`:
      return `<key=value>`;
  }
}
function formatStdinAnnotation(e) {
  switch (e.when) {
    case `dash`:
      return `[stdin: '-']`;
    case `missing`:
      return `[stdin: when omitted]`;
    case `dash-or-missing`:
      return `[stdin]`;
  }
}
function formatEnvAnnotation(e, t) {
  if (e.envVar !== undefined)
    return `[env: ${effectiveEnvName(e.envVar, t, e.envAbsolute)}]`;
  if (e.envIndexed !== undefined)
    return `[env: ${formatIndexedEnvBinding(effectiveIndexedEnvBinding(e.envIndexed, t, e.envAbsolute))}]`;
}
function formatFlagDescription(e, t, n, r) {
  let i = [];
  e.description !== undefined && i.push(resolveHelpDescription(e.description, n).replace(/[^\S\r\n]*\r?\n\s*/gu, ` `)), e.deprecated !== undefined && i.push(t.deprecated(formatDeprecated(e.deprecated))), e.stdin !== undefined && i.push(t.annotation(formatStdinAnnotation(e.stdin)));
  let a = formatEnvAnnotation(e, r);
  if (a !== undefined && i.push(t.annotation(a)), e.configPath !== undefined && i.push(t.annotation(`[config: ${e.configPath}]`)), e.prompt !== undefined && i.push(t.annotation(`[prompt]`)), e.presence === `required` && e.defaultValue === undefined)
    i.push(t.annotation(`[required]`));
  else {
    let n = formatDefaultAnnotation(e, t, e.kind === `boolean` || e.kind === `count`);
    n !== undefined && i.push(n);
  }
  return i.join(` `);
}
function defaultFlagOrder(e, t, n) {
  let r = n[e], i = n[t];
  if (r === undefined || i === undefined)
    return 0;
  let a = getFlagAliasNames(r, { kind: `short` }).length > 0, o = getFlagAliasNames(i, { kind: `short` }).length > 0;
  return a && !o ? -1 : !a && o ? 1 : e.localeCompare(t);
}
function orderFlagNames(e, t, n) {
  return n.sortFlags === undefined ? n.flagOrder === `declaration` ? e : [...e].sort((e, n) => defaultFlagOrder(e, n, t)) : [...e].sort(n.sortFlags);
}
function showsFlag(e, t) {
  return acceptsArgv(e) && (t.showAdvanced || !e.advanced);
}
function buildFlagEntries(e, t, n, r) {
  let i = [];
  for (let a of orderFlagNames(e, t, n)) {
    let e = t[a];
    e !== undefined && showsFlag(e, n) && i.push({ ...formatFlagLeft(a, e, n, r), description: formatFlagDescription(e, n.theme, n.descriptionTheme, n.envPrefix) });
  }
  return i;
}
function groupEntries(e, t, n) {
  let r = /* @__PURE__ */ new Map;
  for (let n of e) {
    let e = t(n), i = r.get(e);
    i === undefined ? r.set(e, [n]) : i.push(n);
  }
  let i = /* @__PURE__ */ new Map;
  for (let e of [...n, ...r.keys()]) {
    if (e === undefined)
      continue;
    let t = r.get(e);
    t !== undefined && i.set(e, t);
  }
  let a = r.get(undefined);
  return a !== undefined && i.set(undefined, a), i;
}
function formatArgUsage(e, t = 1 / 0) {
  let { name: n, schema: r } = e, i = r.kind === `enum` && r.enumValues !== undefined ? r.enumValues.join(`|`) : n, a = r.variadic ? `...` : ``;
  return visibleWidth(i) + 2 + a.length > t && (i = n), r.presence === `required` && r.defaultValue === undefined ? `<${i}>${a}` : `[${i}]${a}`;
}
function formatArgDescription(e, t, n, r) {
  let i = [];
  e.description !== undefined && i.push(resolveHelpDescription(e.description, n)), e.deprecated !== undefined && i.push(t.deprecated(formatDeprecated(e.deprecated))), e.stdin !== undefined && i.push(t.annotation(formatStdinAnnotation(e.stdin)));
  let a = formatEnvAnnotation(e, r);
  a !== undefined && i.push(t.annotation(a)), e.configPath !== undefined && i.push(t.annotation(`[config: ${e.configPath}]`)), e.prompt !== undefined && i.push(t.annotation(`[prompt]`));
  let o = formatDefaultAnnotation(e, t, false);
  return o !== undefined && i.push(o), i.join(` `);
}
function formatHelpSections(e, t) {
  let n = resolveOptions$1(t), r = [];
  if (t?.programHeader !== undefined && t.isDefaultHelp !== true && r.push(formatProgramHeader(t.programHeader, t.hyperlinks === true, n.theme)), r.push(formatUsageLine(e, n)), e.description !== undefined && r.push(e.description), e.details !== undefined) {
    let t = resolveHelpDescription(e.details, n.descriptionTheme);
    r.push(t.split(/\r?\n/).map((e) => wrapText(e, n.width, 0)).join(`
`));
  }
  let i = e.commands.filter((e) => !e.hidden);
  i.length > 0 && r.push(formatCommandsSection(i, n));
  let a = e.args.filter((e) => acceptsArgv(e.schema));
  for (let [e, t] of groupEntries(a, (e) => e.schema.group, n.groupOrder)) {
    let i = e === undefined ? `Arguments:` : `${e} arguments:`;
    r.push(formatArgsSection(i, t, n));
  }
  r.push(...formatFlagSections(e, n));
  let o = e.constraints?.filter((t) => t.inputs.every((t) => t.kind === `arg` || n.showAdvanced || !e.flags[t.name]?.advanced));
  if (o?.length && r.push([n.theme.sectionTitle(`Constraints:`), ...o.map((e) => `  ${wrapText(describeConstraint(e), n.width, 2)}`)].join(`
`)), e.examples.length > 0) {
    let t = { name: n.binName ?? e.name, version: n.version };
    r.push(formatExamplesSection(e.examples, n.theme, t));
  }
  return r;
}
function formatHelp(e, t) {
  return `${formatHelpSections(e, t).join(`

`)}
`;
}
function formatHelpTopic(e, t, n) {
  let r = resolveOptions$1({ ...n, showAdvanced: true }), [i] = formatFlagSections(e, r, t);
  return i === undefined || n?.programHeader === undefined ? i : `${formatProgramHeader(n.programHeader, n.hyperlinks === true, r.theme)}

${i}`;
}
function formatUsageLine(e, t) {
  let { theme: n } = t, r = [n.sectionTitle(`Usage:`)], i = t.binName === undefined ? e.name : t.isDefaultHelp ? t.binName : `${t.binName} ${e.name}`;
  r.push(n.usageBin(i)), e.commands.length > 0 && r.push(n.placeholder(`<command>`)), Object.values(e.flags).some((e) => showsFlag(e, t)) && r.push(n.placeholder(`[flags]`));
  for (let i of e.args)
    acceptsArgv(i.schema) && r.push(n.arg(formatArgUsage(i, t.width - 7)));
  return `${r[0]} ${wrapText(r.slice(1).join(` `), t.width, 7)}`;
}
function formatArgsSection(e, t, n) {
  let { theme: r } = n, i = [r.sectionTitle(e)], a = 0, o = [];
  for (let e of t) {
    let t = formatArgUsage(e, Math.floor(n.width / 2) - 4), i = `  ${r.arg(t)}`, s = formatArgDescription(e.schema, r, n.descriptionTheme, n.envPrefix);
    o.push({ left: i, desc: s, ...t !== formatArgUsage(e) && e.schema.enumValues !== undefined ? { choices: e.schema.enumValues } : {} });
    let c = visibleWidth(i);
    c > a && (a = c);
  }
  let s = a + 2;
  for (let { left: e, desc: t, choices: a } of o) {
    if (t.length === 0)
      i.push(e);
    else if (s >= n.width / 2 || t.split(` `).some((e) => visibleWidth(e) > n.width - s))
      i.push(e, `    ${wrapText(t, n.width, 4)}`);
    else {
      let r = padEnd(e, s), a = wrapText(t, n.width, s);
      i.push(`${r}${a}`);
    }
    a !== undefined && i.push(`    ${wrapText(`Choices: ${a.map((e) => r.arg(e)).join(`, `)}`, n.width, 4)}`);
  }
  return i.join(`
`);
}
function formatFlagSections(e, t, n) {
  let { flags: r } = e, i = declaredFlagNames(e).filter((e) => {
    let i = r[e];
    return i !== undefined && showsFlag(i, t) && (n === undefined || i.group === n);
  });
  if (i.length === 0)
    return [];
  let a = spellingCheck(r, t), o = groupEntries(i, (e) => r[e]?.group, t.groupOrder);
  return Array.from(o, ([e, n]) => formatFlagEntriesBlock(t.theme.sectionTitle(e === undefined ? `Flags:` : `${e} options:`), buildFlagEntries(n, r, t, a), t.width));
}
function formatFlagEntriesBlock(e, t, n) {
  if (t.length === 0)
    return ``;
  let r = [e], i = 0;
  for (let e of t) {
    let t = visibleWidth(e.left) + 2;
    t + 2 < n / 2 && t > i && (i = t);
  }
  let a = i + 2;
  for (let e of t) {
    let t = `  ${wrapText(e.left, n, 2, true)}`;
    if (e.description.length === 0)
      r.push(t);
    else if (visibleWidth(t) > i || e.description.split(` `).some((e) => visibleWidth(e) > n - a))
      r.push(t, `    ${wrapText(e.description, n, 4, true)}`);
    else {
      let i = padEnd(t, a), o = wrapText(e.description, n, a, true);
      r.push(`${i}${o}`);
    }
    e.choices !== undefined && r.push(`    ${wrapText(`Choices: ${e.choices.join(`, `)}`, n, 4, true)}`);
  }
  return r.join(`
`);
}
function formatCommandsSection(e, t) {
  let { theme: n } = t, r = [n.sectionTitle(`Commands:`)], i = 0;
  for (let t of e)
    t.name.length > i && (i = t.name.length);
  let a = 2 + i + 2;
  for (let i of e) {
    let e = `  ${n.command(i.name)}`, o = i.description ?? ``;
    if (o.length === 0)
      r.push(e);
    else {
      let n = padEnd(e, a), i = wrapText(o, t.width, a);
      r.push(`${n}${i}`);
    }
  }
  return r.join(`
`);
}
function highlightExampleCommand(e, t) {
  let n = 0;
  return e.replace(EXAMPLE_TOKEN, (e) => {
    let r = n === 0 ? t.usageBin(e) : e.startsWith(`-`) ? t.flag(e) : e;
    return n += 1, r;
  });
}
function formatExamplesSection(e, t, n) {
  let r = [t.sectionTitle(`Examples:`)], i = t.examplePrompt(`$`);
  for (let a of e) {
    let e = highlightExampleCommand(resolveExampleCommand(a.command, n), t);
    a.description === undefined ? r.push(`  ${i} ${e}`) : (r.push(`  ${a.description}:`), r.push(`    ${i} ${e}`));
  }
  return r.join(`
`);
}
function bindMethods(e) {
  let t = e, n = /* @__PURE__ */ new Set, r = Object.getPrototypeOf(e);
  for (;r !== null && r !== Object.prototype; ) {
    for (let i of Object.getOwnPropertyNames(r)) {
      if (i === `constructor` || n.has(i))
        continue;
      n.add(i);
      let a = Object.getOwnPropertyDescriptor(r, i);
      a !== undefined && typeof a.value == `function` && Object.defineProperty(t, i, { value: a.value.bind(e), writable: true, enumerable: false, configurable: true });
    }
    r = Object.getPrototypeOf(r);
  }
}
function writeLine(e, t) {
  e(`${t}
`);
}
function resolveOutputPolicy(e) {
  return { jsonMode: e.jsonMode, isTTY: e.isTTY, verbosity: e.verbosity };
}
function resolveTextStream(e) {
  return e.jsonMode ? `stderr` : `stdout`;
}
function shouldEmitInfo(e) {
  return e.verbosity !== `quiet`;
}
function resolveTableFormat(e, t) {
  switch (t?.format) {
    case `json`:
      return `json`;
    case `text`:
      return `text`;
    case `auto`:
    case undefined:
      return e.jsonMode ? `json` : `text`;
  }
}
function resolveTableTextStream(e, t) {
  return t?.format === `text` && `stream` in t && t.stream !== undefined ? t.stream : resolveTextStream(e);
}
function resolveActivityRenderMode(e, t) {
  return e.jsonMode || e.verbosity === `quiet` ? `noop` : e.isTTY ? `tty` : t === `static` ? `static` : `noop`;
}
function resolveSpinnerPolicy(e, t) {
  let n = resolveActivityRenderMode(e, t);
  return { mode: n, stream: `stderr`, cleanup: n === `noop` ? `none` : `stop` };
}
function resolveProgressPolicy(e, t) {
  let n = resolveActivityRenderMode(e, t);
  return { mode: n, stream: `stderr`, cleanup: n === `noop` ? `none` : `done` };
}
function colorJson(e, t) {
  let n = [], r = 0, i = 0;
  for (;i < e.length; ) {
    let a = i, o = e.charAt(i), s;
    if (o === `"`) {
      for (i++;i < e.length && e[i] !== `"`; )
        i += e[i] === `\\` ? 2 : 1;
      if (i >= e.length)
        break;
      i++;
      let n = i;
      for (;e.charCodeAt(n) <= 32; )
        n++;
      s = e[n] === `:` ? t.cyan : t.green;
    } else if (o === `-` || o >= `0` && o <= `9`) {
      for (i++;i < e.length && `0123456789.eE+-`.includes(e.charAt(i)); )
        i++;
      s = t.yellow;
    } else if (o === `t` || o === `f` || o === `n`)
      i += o === `f` ? 5 : 4, s = t.magenta;
    else {
      i++;
      continue;
    }
    n.push(e.slice(r, a), s(e.slice(a, i))), r = i;
  }
  return n.push(e.slice(r)), n.join(``);
}
function resolveWriterForStream(e, t) {
  return t === `stderr` ? e.stderr : e.stdout;
}
function createSpinnerHandleFromPolicy(e, t, n, r, i) {
  if (e.mode === `noop`)
    return { handle: noopSpinnerHandle, cleanup: undefined };
  if (e.mode === `tty`) {
    let e = new TTYSpinnerHandle(t, n, r, i);
    return { handle: e, cleanup: () => e.stop() };
  }
  let a = new StaticSpinnerHandle(t, n, r);
  return { handle: a, cleanup: () => a.stop() };
}
function createProgressHandleFromPolicy(e, t, n, r, i) {
  if (e.mode === `noop`)
    return { handle: noopProgressHandle, cleanup: undefined };
  if (e.mode === `tty`) {
    let e = new TTYProgressHandle(t, n, r, i);
    return { handle: e, cleanup: () => e.done() };
  }
  let a = new StaticProgressHandle(t.label, n, r);
  return { handle: a, cleanup: () => a.done() };
}
function validateExitCode(e) {
  if (!Number.isInteger(e) || e < 0 || e > 255)
    throw RangeError(`Exit code must be an integer from 0 to 255`);
  return e;
}
function setRequestedExitCode(e, t) {
  requestedExitCodes.set(e, validateExitCode(t));
}
function getRequestedExitCode(e) {
  return requestedExitCodes.get(e);
}
function clearRequestedExitCode(e) {
  requestedExitCodes.delete(e);
}
function resolveHyperlinkOverride(e, t) {
  let n = t.indexOf(`--`), r = n === -1 ? t : t.slice(0, n);
  if (r.includes(`--no-hyperlinks`))
    return false;
  if (r.includes(`--hyperlinks`))
    return true;
  if (e.NO_HYPERLINKS)
    return false;
  if (e.FORCE_HYPERLINKS)
    return true;
}
function resolveOptions2(e) {
  let t = e?.isTTY ?? false, n = e?.jsonMode ?? false, r = e?.terminalSize === undefined ? undefined : { ...e.terminalSize };
  return { ...e?.getTerminalSize === undefined ? {} : { getTerminalSize: e.getTerminalSize }, ...r === undefined ? {} : { terminalSize: r }, stdout: e?.stdout ?? noopWrite$1, stderr: e?.stderr ?? noopWrite$1, isTTY: t, verbosity: e?.verbosity ?? `normal`, jsonMode: n, color: e?.color ?? (t && !n && he), isHyperlinkSupported: e?.hyperlinks ?? t };
}
function inferColumns(e) {
  let t = e[0];
  return t === undefined ? [] : Object.keys(t).map((e) => ({ key: e }));
}
function isTableColumns(e) {
  return Array.isArray(e);
}
function resolveTableArgs(e, t) {
  return t === undefined ? isTableColumns(e) ? { columns: e, options: t } : { columns: undefined, options: e } : { columns: isTableColumns(e) ? e : undefined, options: t };
}
function cellKeyHolder(e, t) {
  for (let n = e;n !== null; n = Object.getPrototypeOf(n))
    if (Object.hasOwn(n, t))
      return n;
  return null;
}
function cellValue(e, t) {
  let n = cellKeyHolder(e, t);
  return n === null || n === Object.prototype ? undefined : e[t];
}
function projectTableRows(e, t) {
  return e.map((e) => Object.fromEntries(t.map((t) => [t.key, cellValue(e, t.key)])));
}
function resolveTextTableWriter(e, t, n, r) {
  return n === `json` ? e.stdout : resolveWriterForStream(e, resolveTableTextStream(t, r));
}
function cellToString(e) {
  return formatDisplayValue(e);
}
function formatTable(e, t) {
  if (e.length === 0 || t.length === 0)
    return ``;
  let n = t.map((e) => e.header ?? e.key), r = e.map((e) => t.map((t) => cellToString(cellValue(e, t.key)))), i = n.map((e, t) => {
    let n = visibleWidth(e);
    for (let e of r) {
      let r = e[t];
      r !== undefined && (n = Math.max(n, visibleWidth(r)));
    }
    return n;
  });
  return [n.map((e, t) => padEnd(e, i[t] ?? 0)).join(`  `), i.map((e) => `-`.repeat(e)).join(`  `), ...r.map((e) => e.map((e, t) => padEnd(e, i[t] ?? 0)).join(`  `))].join(`
`);
}
function createOutput(e) {
  return new OutputChannel(resolveOptions2(e));
}
function createCaptureOutput(e) {
  let t = { stdout: [], stderr: [], activity: [] };
  return [new CaptureOutputChannel(resolveOptions2({ ...e, stdout: (e) => t.stdout.push(e), stderr: (e) => t.stderr.push(e) }), t.activity), t];
}
function resolvePromptConfig(e, t) {
  if (e.kind === `confirm` || e.kind === `input` || e.kind === `password`)
    return e;
  let n = e.choices ?? t?.map((e) => ({ value: e })) ?? [];
  if (n.length === 0)
    throw Error(`Prompt config (${e.kind}) requires choices but none were provided and no enum values are available`);
  let r = n;
  return e.kind === `select` ? { ...e, choices: r } : { ...e, choices: r, ...e.min === undefined ? {} : { min: e.min }, ...e.max === undefined ? {} : { max: e.max } };
}
function sensitivityError(e, t) {
  let n = t(e);
  return e || sensitiveDiagnostics.set(n, () => t(true)), n;
}
function redactCoercionError(e) {
  return sensitiveDiagnostics.get(e)?.() ?? e;
}
function sourceLabel(e) {
  switch (e.kind) {
    case `stdin`:
      return `from stdin`;
    case `env`:
      return `from env ${e.envVar}`;
    case `env-indexed`:
      return e.index === undefined ? `from env entries counted by ${e.count}` : `from env entry ${e.index} (${e.envVars.join(`, `)})`;
    case `config`:
      return `from config ${e.configPath}`;
    case `prompt`:
      return `from prompt`;
  }
}
function indexedEnvSubject(e) {
  return e.index === undefined ? `the entries counted by ${e.count}` : e.envVars.join(` and `);
}
function sourceDetails(e) {
  switch (e.kind) {
    case `stdin`:
      return { source: `stdin` };
    case `env`:
      return { source: `env`, envVar: e.envVar };
    case `env-indexed`:
      return { source: `env`, countVar: e.count, ...e.index === undefined ? {} : { index: e.index }, envVars: [...e.envVars] };
    case `config`:
      return { source: `config`, configPath: e.configPath };
    case `prompt`:
      return { source: `prompt` };
  }
}
function suggestBySource(e, t) {
  switch (e.kind) {
    case `stdin`:
      return t.stdin;
    case `env`:
      return t.env(e.envVar);
    case `env-indexed`:
      return t.env(indexedEnvSubject(e));
    case `config`:
      return t.config(e.configPath);
    case `prompt`:
      return t.prompt;
  }
}
function coercionError(e, t, n, r, i, a, o, s) {
  return new ValidationError(`${a(i.text)} ${sourceLabel(t)} for flag --${e}`, { code: n, details: { flag: e, ...sourceDetails(t), ...i.kind === `visible` ? { value: i.value } : {}, expected: r, ...s }, suggest: o });
}
function diagnosticSourceOf(e) {
  switch (e.stage) {
    case `stdin`:
      return { kind: `stdin` };
    case `env`:
      return { kind: `env`, envVar: e.envVar };
    case `config`:
      return { kind: `config`, configPath: e.configPath };
    case `prompt`:
      return { kind: `prompt` };
  }
}
function coerceValue(e, t, n, r) {
  let i = diagnosticSourceOf(t), a = flagCardinality(r);
  if (a.kind === `count`)
    return coerceCount(e, i, n, r.sensitive);
  if (a.kind === `one`) {
    let a = flagValueSchema(r);
    return coerceValueSchema(e, i, trimmedStdinValue(t, n, a), a, r.sensitive);
  }
  return coerceCollection(a, i, t.split, n, (t) => coerceValueSchema(e, i, t, flagValueSchema(r), r.sensitive), (t) => sensitivityError(r.sensitive, (n) => flagCollectionErrors(e, i, n)(t)), (t, n) => sensitivityError(r.sensitive, (r) => flagAggregationErrors(e, r)(t, n)));
}
function trimmedStdinValue(e, t, n) {
  return e.stage !== `stdin` || !e.trim || typeof t != `string` ? t : keepsStdinTerminator(n) ? stripTerminator(t) : t;
}
function coerceCount(e, t, n, r) {
  let i = typeof n == `string` ? n.trim() === `` ? NaN : Number(n) : n;
  return typeof i == `number` && Number.isInteger(i) && i >= 0 ? { ok: true, value: i } : { ok: false, error: sensitivityError(r, (r) => coercionError(e, t, `TYPE_MISMATCH`, `count`, diagnosticValue(r, n), (e) => `Invalid count value '${e}'`, suggestBySource(t, { stdin: `Pipe a non-negative integer to stdin for --${e}`, env: (e) => `Set ${e} to a non-negative integer`, config: (e) => `Set ${e} to a non-negative integer in your config`, prompt: `Enter a non-negative integer for --${e}` }))) };
}
function sourceClause(e) {
  return e.kind === `cli` ? `` : `${sourceLabel(e)} `;
}
function aggregationSourceDetails(e) {
  return e.kind === `cli` ? {} : sourceDetails(e);
}
function duplicateKeyReport(e, t) {
  let n = diagnosticValue(e, t);
  return n.kind === `visible` ? { quoted: `'${n.text}'`, details: { key: n.value }, subject: `'${n.text}'` } : { quoted: `'${n.text}'`, details: {}, subject: `the repeated key` };
}
function coerceCollection(e, t, n, r, i, a, o) {
  if (e.kind === `many`) {
    let e = readManyParts(t, r, n);
    if (!e.ok)
      return { ok: false, error: a(e.fault) };
    let o = [];
    for (let t of e.parts) {
      let e = i(t);
      if (!e.ok)
        return e;
      o.push(e.value);
    }
    return { ok: true, value: o };
  }
  let s = readEntryPairs(r, n);
  if (!s.ok)
    return { ok: false, error: a(s.fault) };
  let c = [];
  for (let [e, t] of s.pairs) {
    let n = i(t);
    if (!n.ok)
      return n;
    c.push([e, n.value]);
  }
  let l = foldEntries(c, e.duplicateKeys);
  return l.ok ? { ok: true, value: l.value } : { ok: false, error: o({ kind: `duplicate-key`, key: l.duplicateKey }, t) };
}
function splitFault(e, t) {
  switch (e.kind) {
    case `json`:
      return { kind: `json`, error: e.error, raw: t };
    case `json-shape`:
      return { kind: `json-shape`, expected: e.expected, raw: t };
    case `pair`:
      return { kind: `pair`, segment: e.raw };
  }
}
function readManyParts(e, t, n) {
  if (Array.isArray(t))
    return { ok: true, parts: t };
  if (typeof t != `string`)
    return { ok: false, fault: { kind: `shape`, expected: `array`, raw: t } };
  let r = splitManyText(n, t);
  return r.ok ? { ok: true, parts: e.kind === `prompt` ? r.parts.map(trimStringPart) : r.parts } : { ok: false, fault: splitFault(r.failure, t) };
}
function readEntryPairs(e, t) {
  if (isPairList(e))
    return { ok: true, pairs: e };
  if (typeof e == `object` && e && !Array.isArray(e))
    return { ok: true, pairs: Object.entries(e) };
  if (typeof e != `string`)
    return { ok: false, fault: { kind: `shape`, expected: `object`, raw: e } };
  let n = splitEntriesText(t, e);
  return n.ok ? { ok: true, pairs: n.parts } : { ok: false, fault: splitFault(n.failure, e) };
}
function isPairList(e) {
  return Array.isArray(e) && e.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] == `string`);
}
function trimStringPart(e) {
  return typeof e == `string` ? e.trim() : e;
}
function thrownMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function flagCollectionErrors(e, t, n) {
  return (r) => {
    switch (r.kind) {
      case `shape`: {
        let i = r.expected === `array` ? `values` : `KEY=VALUE pairs`, a = diagnosticValue(n, r.raw);
        return coercionError(e, t, `TYPE_MISMATCH`, r.expected, a, (e) => `Invalid ${r.expected} value '${e}'`, suggestBySource(t, { stdin: `Pipe ${i} to stdin for --${e}`, env: (e) => `Set ${e} to comma-separated ${i}`, config: (e) => `Set ${e} to an ${r.expected} in your config`, prompt: `Provide valid ${i} for --${e}` }));
      }
      case `pair`: {
        let i = diagnosticValue(n, r.segment);
        return new ValidationError(`Invalid key-value pair '${i.text}' ${sourceLabel(t)} for flag --${e}`, { code: `TYPE_MISMATCH`, details: { flag: e, ...sourceDetails(t), ...i.kind === `visible` ? { segment: i.value } : {}, expected: `key=value` }, suggest: suggestBySource(t, { stdin: `Pipe KEY=VALUE pairs to stdin for --${e}`, env: (e) => `Set ${e} to comma-separated KEY=VALUE pairs`, config: (e) => `Set ${e} to an object with string values`, prompt: `Use KEY=VALUE for --${e}` }) });
      }
      case `json`: {
        let i = diagnosticValue(n, r.raw), a = i.kind === `visible` ? thrownMessage(r.error) : undefined;
        return new ValidationError(`Invalid JSON value '${i.text}' ${sourceLabel(t)} for flag --${e}${a === undefined ? `` : `: ${a}`}`, { code: `TYPE_MISMATCH`, details: { flag: e, ...sourceDetails(t), ...i.kind === `visible` ? { value: i.value, cause: thrownMessage(r.error) } : {}, expected: `json` }, suggest: `Provide valid JSON for --${e}` });
      }
      case `json-shape`: {
        let i = diagnosticValue(n, r.raw);
        return new ValidationError(`Invalid JSON value '${i.text}' ${sourceLabel(t)} for flag --${e}, expected an ${r.expected}`, { code: `TYPE_MISMATCH`, details: { flag: e, ...sourceDetails(t), ...i.kind === `visible` ? { value: i.value } : {}, expected: r.expected }, suggest: `Provide a JSON ${r.expected} for --${e}` });
      }
    }
  };
}
function flagAggregationErrors(e, t) {
  return (n, r) => {
    if (n.kind === `dash-without-stdin`)
      return new ValidationError(`No piped stdin for the '-' occurrence of flag --${e}`, { code: `MISSING_STDIN`, details: { flag: e, source: `stdin` }, suggest: `Pipe a value to stdin, or drop the '-' occurrence of --${e}` });
    if (n.kind === `shape`) {
      let i = n.expected === `array` ? `values` : `KEY=VALUE pairs`, a = diagnosticValue(t, n.raw);
      return new ValidationError(`Invalid ${n.expected} value '${a.text}' ${sourceClause(r)}for flag --${e}`, { code: `TYPE_MISMATCH`, details: { flag: e, ...aggregationSourceDetails(r), ...a.kind === `visible` ? { value: a.value } : {}, expected: n.expected }, suggest: `Provide ${i} for --${e}` });
    }
    let i = duplicateKeyReport(t, n.key);
    return new ValidationError(`Duplicate key ${i.quoted} ${sourceClause(r)}for flag --${e}`, { code: `CONSTRAINT_VIOLATED`, details: { flag: e, ...aggregationSourceDetails(r), ...i.details }, suggest: `Set ${i.subject} once for --${e}` });
  };
}
function argCollectionErrors(e, t, n) {
  return (r) => {
    switch (r.kind) {
      case `shape`: {
        let i = diagnosticValue(n, r.raw);
        return new ValidationError(`Invalid ${r.expected} value '${i.text}' ${argSourceLabel(t)} for argument <${e}>`, { code: `TYPE_MISMATCH`, details: { arg: e, ...argSourceDetails(t), ...i.kind === `visible` ? { value: i.value } : {}, expected: r.expected }, suggest: r.expected === `object` ? `Use KEY=VALUE for <${e}>` : `Provide values for <${e}>` });
      }
      case `pair`: {
        let i = diagnosticValue(n, r.segment);
        return new ValidationError(`Invalid key-value pair '${i.text}' ${argSourceLabel(t)} for argument <${e}>`, { code: `TYPE_MISMATCH`, details: { arg: e, ...argSourceDetails(t), ...i.kind === `visible` ? { segment: i.value } : {}, expected: `key=value` }, suggest: `Use KEY=VALUE for <${e}>` });
      }
      case `json`: {
        let i = diagnosticValue(n, r.raw), a = i.kind === `visible` ? thrownMessage(r.error) : undefined;
        return new ValidationError(`Invalid JSON value '${i.text}' ${argSourceLabel(t)} for argument <${e}>${a === undefined ? `` : `: ${a}`}`, { code: `TYPE_MISMATCH`, details: { arg: e, ...argSourceDetails(t), ...i.kind === `visible` ? { value: i.value, cause: thrownMessage(r.error) } : {}, expected: `json` }, suggest: `Provide valid JSON for <${e}>` });
      }
      case `json-shape`: {
        let i = diagnosticValue(n, r.raw);
        return new ValidationError(`Invalid JSON value '${i.text}' ${argSourceLabel(t)} for argument <${e}>, expected an ${r.expected}`, { code: `TYPE_MISMATCH`, details: { arg: e, ...argSourceDetails(t), ...i.kind === `visible` ? { value: i.value } : {}, expected: r.expected }, suggest: `Provide a JSON ${r.expected} for <${e}>` });
      }
    }
  };
}
function argAggregationErrors(e, t) {
  return (n, r) => {
    if (n.kind === `dash-without-stdin`)
      return new ValidationError(`No piped stdin for the '-' occurrence of argument <${e}>`, { code: `MISSING_STDIN`, details: { arg: e, source: `stdin` }, suggest: `Pipe a value to stdin, or drop the '-' from <${e}>` });
    if (n.kind === `shape`) {
      let i = diagnosticValue(t, n.raw);
      return new ValidationError(`Invalid ${n.expected} value '${i.text}' ${sourceClause(r)}for argument <${e}>`, { code: `TYPE_MISMATCH`, details: { arg: e, ...aggregationSourceDetails(r), ...i.kind === `visible` ? { value: i.value } : {}, expected: n.expected }, suggest: `Provide KEY=VALUE pairs for <${e}>` });
    }
    let i = duplicateKeyReport(t, n.key);
    return new ValidationError(`Duplicate key ${i.quoted} ${sourceClause(r)}for argument <${e}>`, { code: `CONSTRAINT_VIOLATED`, details: { arg: e, ...aggregationSourceDetails(r), ...i.details }, suggest: `Set ${i.subject} once for <${e}>` });
  };
}
function coerceValueSchema(e, t, n, r, i) {
  let a = decodeValue(r, n, valueInputOf(t));
  return a.ok ? { ok: true, value: a.value } : { ok: false, error: sensitivityError(i, (r) => valueCoercionError(e, t, n, a.failure, r)) };
}
function valueInputOf(e) {
  return e.kind === `env-indexed` ? `env` : e.kind;
}
function valueCoercionError(e, t, n, r, i) {
  let a = diagnosticValue(i, n);
  switch (r.kind) {
    case `type`:
      return typeCoercionError(e, t, r.expected, a);
    case `enum`: {
      let n = r.enumValues ?? [];
      return new ValidationError(`Invalid value '${a.text}' ${sourceLabel(t)} for flag --${e}. Allowed: ${n.join(`, `)}`, { code: `INVALID_ENUM`, details: { flag: e, ...sourceDetails(t), ...a.kind === `visible` ? { value: a.value } : {}, allowed: n }, suggest: suggestBySource(t, { stdin: `Pipe one of: ${n.join(`, `)}`, env: (e) => `Set ${e} to one of: ${n.join(`, `)}`, config: (e) => `Set ${e} to one of: ${n.join(`, `)}`, prompt: `Select one of: ${n.join(`, `)}` }) });
    }
    case `string-constraint`:
      return new ValidationError(`Invalid value '${a.text}' ${sourceLabel(t)} for flag --${e}: ${describeStringConstraintViolation(r.violation)}`, { code: `CONSTRAINT_VIOLATED`, details: { flag: e, ...sourceDetails(t), ...a.kind === `visible` ? { value: a.value } : {}, expected: `string`, ...stringConstraintDetails(r.violation) }, suggest: suggestBySource(t, { stdin: `Pipe a valid string to stdin for --${e}`, env: (e) => `Set ${e} to a valid string`, config: (e) => `Set ${e} to a valid string in your config`, prompt: `Enter a valid value for --${e}` }) });
    case `number-constraint`:
      return new ValidationError(`Invalid number value '${a.text}' ${sourceLabel(t)} for flag --${e}: ${describeNumberConstraintViolation(r.violation)}`, { code: `CONSTRAINT_VIOLATED`, details: { flag: e, ...sourceDetails(t), ...a.kind === `visible` ? { value: a.value } : {}, expected: `number`, constraint: r.violation.kind, ...`bound` in r.violation ? { bound: r.violation.bound } : {} }, suggest: suggestBySource(t, { stdin: `Pipe a valid number to stdin for --${e}`, env: (e) => `Set ${e} to a valid number`, config: (e) => `Set ${e} to a valid number in your config`, prompt: `Enter a valid number for --${e}` }) });
    case `thrown`: {
      let n = thrownMessage(r.error);
      return new ValidationError(`Failed to parse ${suggestBySource(t, { stdin: `stdin`, env: (e) => `env ${e}`, config: (e) => `config ${e}`, prompt: `prompt` })} for flag --${e} value '${a.text}': ${n}`, { code: `TYPE_MISMATCH`, details: { flag: e, ...sourceDetails(t), ...a.kind === `visible` ? { value: a.value } : {}, expected: `custom` }, suggest: suggestBySource(t, { stdin: `Pipe a valid value to stdin for --${e}`, env: (t) => `Set ${t} to a valid value for --${e}`, config: (t) => `Set ${t} to a valid value for --${e} in your config`, prompt: `Enter a valid value for --${e}` }) });
    }
  }
}
function typeCoercionError(e, t, n, r) {
  return n === `string` ? coercionError(e, t, `TYPE_MISMATCH`, `string`, r, (e) => `Invalid string value '${e}'`, suggestBySource(t, { stdin: `Pipe a valid string to stdin for --${e}`, env: (e) => `Set ${e} to a valid string`, config: (e) => `Set ${e} to a string in your config`, prompt: `Enter a valid string for --${e}` })) : n === `number` ? coercionError(e, t, `TYPE_MISMATCH`, `number`, r, (e) => `Invalid number value '${e}'`, suggestBySource(t, { stdin: `Pipe a valid number to stdin for --${e}`, env: (e) => `Set ${e} to a valid number`, config: (e) => `Set ${e} to a valid number in your config`, prompt: `Enter a valid number for --${e}` })) : coercionError(e, t, `TYPE_MISMATCH`, `boolean`, r, (e) => `Invalid boolean value '${e}'`, suggestBySource(t, { stdin: `Pipe true/false, 1/0, or yes/no to stdin for --${e}`, env: (e) => `Set ${e} to true/false, 1/0, or yes/no`, config: (e) => `Set ${e} to true or false in your config`, prompt: `Answer yes or no for --${e}` }));
}
function argSourceLabel(e) {
  return sourceLabel(e);
}
function argSourceDetails(e) {
  return sourceDetails(e);
}
function buildArgCoercionSuggest(e, t, n) {
  let r = n === `custom` ? `value` : n;
  return suggestBySource(t, { stdin: `Pipe a valid ${r} to stdin for <${e}>`, env: (t) => n === `custom` ? `Set ${t} to a valid value for <${e}>` : `Set ${t} to a valid ${n}`, config: (t) => `Set ${t} to a valid ${r} for <${e}>`, prompt: `Enter a valid ${r} for <${e}>` });
}
function argBooleanSuggest(e, t) {
  return suggestBySource(t, { stdin: `Pipe true/false, 1/0, or yes/no to stdin for <${e}>`, env: (e) => `Set ${e} to true/false, 1/0, or yes/no`, config: (e) => `Set ${e} to true or false in your config`, prompt: `Answer yes or no for <${e}>` });
}
function argValueCoercionError(e, t, n, r, i) {
  let a = `${argSourceLabel(t)} for argument <${e}>`, o = diagnosticValue(i, n);
  switch (r.kind) {
    case `type`:
      return argTypeCoercionError(e, t, r.expected, o);
    case `enum`: {
      let n = r.enumValues ?? [], i = n.join(`, `);
      return new ValidationError(`Invalid value '${o.text}' ${a}. Allowed: ${i}`, { code: `INVALID_ENUM`, details: { arg: e, ...argSourceDetails(t), ...o.kind === `visible` ? { value: o.value } : {}, allowed: n }, suggest: suggestBySource(t, { stdin: `Provide one of: ${i}`, env: (e) => `Set ${e} to one of: ${i}`, config: (e) => `Set ${e} to one of: ${i}`, prompt: `Provide one of: ${i}` }) });
    }
    case `string-constraint`:
      return new ValidationError(`Invalid value '${o.text}' ${a}: ${describeStringConstraintViolation(r.violation)}`, { code: `CONSTRAINT_VIOLATED`, details: { arg: e, ...argSourceDetails(t), ...o.kind === `visible` ? { value: o.value } : {}, expected: `string`, ...stringConstraintDetails(r.violation) }, suggest: buildArgCoercionSuggest(e, t, `string`) });
    case `number-constraint`:
      return new ValidationError(`Invalid number value '${o.text}' ${a}: ${describeNumberConstraintViolation(r.violation)}`, { code: `CONSTRAINT_VIOLATED`, details: { arg: e, ...argSourceDetails(t), ...o.kind === `visible` ? { value: o.value } : {}, expected: `number`, constraint: r.violation.kind, ...`bound` in r.violation ? { bound: r.violation.bound } : {} }, suggest: buildArgCoercionSuggest(e, t, `number`) });
    case `thrown`: {
      let n = thrownMessage(r.error);
      return new ValidationError(`Failed to parse ${suggestBySource(t, { stdin: `stdin`, env: (e) => `env ${e}`, config: (e) => `config ${e}`, prompt: `prompt` })} for argument <${e}> value '${o.text}': ${n}`, { code: `TYPE_MISMATCH`, details: { arg: e, ...argSourceDetails(t), ...o.kind === `visible` ? { value: o.value } : {}, expected: `custom` }, suggest: buildArgCoercionSuggest(e, t, `custom`) });
    }
  }
}
function argTypeCoercionError(e, t, n, r) {
  let i = `${argSourceLabel(t)} for argument <${e}>`, a = { arg: e, ...argSourceDetails(t), ...r.kind === `visible` ? { value: r.value } : {}, expected: n };
  return n === `string` ? new ValidationError(`Invalid string value '${r.text}' ${i}`, { code: `TYPE_MISMATCH`, details: a, suggest: buildArgCoercionSuggest(e, t, `string`) }) : n === `number` ? new ValidationError(`Invalid number value '${r.text}' ${i}`, { code: `TYPE_MISMATCH`, details: a, suggest: buildArgCoercionSuggest(e, t, `number`) }) : new ValidationError(`Invalid boolean value '${r.text}' ${i}`, { code: `TYPE_MISMATCH`, details: a, suggest: argBooleanSuggest(e, t) });
}
function coerceArgValue(e, t, n, r) {
  let i = diagnosticSourceOf(t), a = argCardinality(r);
  return isCollection(a) ? coerceCollection(a, i, t.split, n, (t) => coerceArgElement(e, i, t, r), argCollectionErrors(e, i, r.sensitive), argAggregationErrors(e, r.sensitive)) : coerceArgElement(e, i, trimmedStdinValue(t, n, argValueSchema(r)), r);
}
function coerceArgElement(e, t, n, r) {
  let i = decodeValue(argValueSchema(r), n, valueInputOf(t));
  return i.ok ? { ok: true, value: i.value } : { ok: false, error: argValueCoercionError(e, t, n, i.failure, r.sensitive) };
}
function indexedEnvFaultError(e, t, n) {
  let r = e.kind === `flag` ? `flag --${e.name}` : `argument <${e.name}>`, i = e.kind === `flag` ? { flag: e.name } : { arg: e.name };
  switch (t.kind) {
    case `count`: {
      let e = diagnosticValue(n, t.raw);
      return new ValidationError(`Invalid indexed env count '${e.text}' from env ${t.countVar} for ${r}`, { code: `TYPE_MISMATCH`, details: { ...i, source: `env`, envVar: t.countVar, ...e.kind === `visible` ? { value: e.value } : {}, expected: `count` }, suggest: `Set ${t.countVar} to a non-negative integer without a sign or leading zeros` });
    }
    case `limit`: {
      let e = diagnosticValue(n, t.raw);
      return new ValidationError(`Indexed env count '${e.text}' from env ${t.countVar} for ${r} exceeds the limit of ${t.max}`, { code: `CONSTRAINT_VIOLATED`, details: { ...i, source: `env`, envVar: t.countVar, ...e.kind === `visible` ? { value: e.value } : {}, constraint: `maxCount`, max: t.max }, suggest: `Set ${t.countVar} to at most ${t.max}` });
    }
    case `member`: {
      let e = t.count === 1 ? `entry` : `entries`;
      return new ValidationError(`Env ${t.countVar} declares ${t.count} ${e} for ${r}, but ${t.envVar} is not set`, { code: `CONSTRAINT_VIOLATED`, details: { ...i, source: `env`, envVar: t.envVar, countVar: t.countVar, count: t.count, index: t.index, ...t.field === undefined ? {} : { field: t.field }, constraint: `indexedMember` }, suggest: `Set ${t.envVar}, or set ${t.countVar} to ${t.index}` });
    }
  }
}
function coerceIndexedEntries(e, t, n, r) {
  if (!e)
    return r({ kind: `env-indexed`, count: t.count, index: undefined, envVars: n.entries.flatMap((e) => e.envVars) }, n.entries.map((e) => e.raw));
  let i = [];
  for (let e of n.entries) {
    let n = r(t.fields === undefined ? { kind: `env`, envVar: e.envVars[0] ?? t.count } : { kind: `env-indexed`, count: t.count, index: e.index, envVars: e.envVars }, e.raw);
    if (!n.ok)
      return n;
    i.push(n.value);
  }
  return { ok: true, value: i };
}
function coerceIndexedFlagValue(e, t, n, r) {
  if (n.kind === `fault`)
    return { ok: false, error: sensitivityError(r.sensitive, (t) => indexedEnvFaultError({ kind: `flag`, name: e }, n.fault, t)) };
  let i = flagValueSchema(r);
  return coerceIndexedEntries(flagCardinality(r).kind === `many`, t.indexed, n, (t, n) => coerceValueSchema(e, t, n, i, r.sensitive));
}
function coerceIndexedArgValue(e, t, n, r) {
  return n.kind === `fault` ? { ok: false, error: indexedEnvFaultError({ kind: `arg`, name: e }, n.fault, r.sensitive) } : coerceIndexedEntries(argCardinality(r).kind === `many`, t.indexed, n, (t, n) => coerceArgElement(e, t, n, r));
}
function finishCliFlagValue(e, t, n, r, i) {
  let a = flagCardinality(t);
  return isCollection(a) ? spliceCliCollection(a, n, r, i, (n) => coerceValueSchema(e, { kind: `stdin` }, n, flagValueSchema(t), t.sensitive), (n) => sensitivityError(t.sensitive, (t) => flagCollectionErrors(e, { kind: `stdin` }, t)(n)), (n, r) => sensitivityError(t.sensitive, (t) => flagAggregationErrors(e, t)(n, r))) : { kind: `value`, value: n, viaStdin: false };
}
function finishCliArgValue(e, t, n, r, i) {
  let a = argCardinality(t);
  return isCollection(a) ? spliceCliCollection(a, n, r, i, (n) => coerceArgElement(e, { kind: `stdin` }, n, t), argCollectionErrors(e, { kind: `stdin` }, t.sensitive), argAggregationErrors(e, t.sensitive)) : { kind: `value`, value: n, viaStdin: false };
}
function spliceCliCollection(e, t, n, r, i, a, o) {
  let s = liftOccurrences(e, t, r !== undefined && stdinReadsOnDash(r)), c = readAggregated(s);
  if (c !== undefined)
    return { kind: `value`, value: c.value, viaStdin: false };
  let l = [], u = 0, d = false;
  for (let t of s) {
    if (t.kind !== `stdin`) {
      l.push({ occurrence: t, source: CLI_SOURCE });
      continue;
    }
    if (u += 1, r === undefined || typeof n != `string`)
      continue;
    let o = readStdinOccurrence(e, r.split, n, i, a);
    if (o.kind !== `value`)
      return o;
    d = true;
    for (let e of o.occurrences)
      l.push({ occurrence: e, source: STDIN_SOURCE });
  }
  if (u > 0 && typeof n != `string`)
    return u === s.length ? { kind: `absent` } : { kind: `error`, error: o({ kind: `dash-without-stdin` }, CLI_SOURCE) };
  if (e.kind === `many`)
    return { kind: `value`, value: l.map((e) => occurrenceValue(e.occurrence)), viaStdin: d };
  let f = [];
  for (let e of l) {
    if (e.occurrence.kind !== `entry`)
      return { kind: `error`, error: o({ kind: `shape`, expected: `object`, raw: occurrenceValue(e.occurrence) }, e.source) };
    f.push(e);
  }
  let p = foldEntries(entryPairsOf(f.map((e) => e.occurrence)), e.duplicateKeys);
  return p.ok ? { kind: `value`, value: p.value, viaStdin: d } : { kind: `error`, error: o({ kind: `duplicate-key`, key: p.duplicateKey }, f[p.at]?.source ?? CLI_SOURCE) };
}
function readStdinOccurrence(e, t, n, r, i) {
  let a = { kind: `stdin` };
  if (e.kind === `many`) {
    let e = readManyParts(a, n, t);
    if (!e.ok)
      return { kind: `error`, error: i(e.fault) };
    let o = [];
    for (let t of e.parts) {
      let e = r(t);
      if (!e.ok)
        return { kind: `error`, error: e.error };
      o.push({ kind: `value`, value: e.value });
    }
    return { kind: `value`, occurrences: o };
  }
  let o = readEntryPairs(n, t);
  if (!o.ok)
    return { kind: `error`, error: i(o.fault) };
  let s = [];
  for (let [e, t] of o.pairs) {
    let n = r(t);
    if (!n.ok)
      return { kind: `error`, error: n.error };
    s.push({ kind: `entry`, key: e, value: n.value });
  }
  return { kind: `value`, occurrences: s };
}
function envAccessHint(e, t) {
  let n = Reflect.get(e, ENV_ACCESS_HINT);
  if (typeof n != `function`)
    return;
  let r = n(t);
  return typeof r == `string` ? r : undefined;
}
function isRecord(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function readStringProperty(e, t) {
  let n = Reflect.get(e, t);
  return typeof n == `string` ? n : undefined;
}
function describeIssueSource(e) {
  switch (readStringProperty(e, `source`)) {
    case `stdin`:
      return { kind: `stdin`, label: `stdin` };
    case `prompt`:
      return { kind: `prompt`, label: `prompt` };
    case `env`: {
      let t = readStringProperty(e, `envVar`);
      if (t !== undefined)
        return { kind: `env`, label: `env ${t}` };
      let n = readStringProperty(e, `countVar`);
      if (n === undefined)
        return;
      let r = Reflect.get(e, `index`);
      return { kind: `env`, label: typeof r == `number` ? `env ${n}[${r}]` : `env ${n}` };
    }
    case `config`: {
      let t = readStringProperty(e, `configPath`);
      return t === undefined ? undefined : { kind: `config`, label: `config ${t}` };
    }
    default:
      return;
  }
}
function summarizeValidationError(e) {
  let t = e.details;
  if (!isRecord(t))
    return { code: e.code, inputKind: `input`, label: `input`, message: e.message };
  let n = readStringProperty(t, `flag`);
  if (n !== undefined) {
    let r = describeIssueSource(t);
    return { code: e.code, inputKind: `flag`, name: n, label: `flag --${n}`, message: e.message, ...r === undefined ? {} : { sourceKind: r.kind, sourceLabel: r.label } };
  }
  let r = readStringProperty(t, `arg`);
  if (r !== undefined) {
    let n = describeIssueSource(t);
    return { code: e.code, inputKind: `arg`, name: r, label: `argument <${r}>`, message: e.message, ...n === undefined ? {} : { sourceKind: n.kind, sourceLabel: n.label } };
  }
  return { code: e.code, inputKind: `input`, label: `input`, message: e.message };
}
function formatAggregateHeadline(e) {
  let t = e.filter((e) => e.inputKind === `flag`).length, n = e.filter((e) => e.inputKind === `arg`).length, r = e.length - t - n, i = [];
  return t > 0 && i.push(`${t} flag${t === 1 ? `` : `s`}`), n > 0 && i.push(`${n} arg${n === 1 ? `` : `s`}`), r > 0 && i.push(`${r} input${r === 1 ? `` : `s`}`), i.length === 0 ? `Multiple validation errors (${e.length})` : `Multiple validation errors (${i.join(`, `)})`;
}
function formatAggregateLine(e) {
  let t = e.sourceLabel === undefined ? `` : ` [${e.sourceLabel}]`;
  return `${e.label}${t}: ${e.message}`;
}
function requiredEnvSuggestion(e, t) {
  let n = `envVar` in e ? e.envVar : e.indexed.count, r = `envVar` in e ? `set ${n}` : `set ${n} and its entries`, i = envAccessHint(t, n);
  return i === undefined ? r : `${r} (${i})`;
}
function isNonEmpty(e) {
  return e.length > 0;
}
function isValidationErrorJson(e) {
  return !(typeof e != `object` || !e || !(`code` in e) || !(`message` in e) || !(`exitCode` in e) || typeof e.code != `string` || typeof e.message != `string` || typeof e.exitCode != `number` || (`suggest` in e) && e.suggest !== undefined && typeof e.suggest != `string` || (`details` in e) && e.details !== undefined && (e.details === null || typeof e.details != `object`));
}
function collectValidationErrors(e) {
  let t = e.details?.errors;
  if (!Array.isArray(t))
    return [e];
  let n = [];
  for (let r of t) {
    if (!isValidationErrorJson(r))
      return [e];
    n.push(new ValidationError(r.message, { code: r.code, exitCode: r.exitCode, ...r.suggest === undefined ? {} : { suggest: r.suggest }, ...r.details === undefined ? {} : { details: r.details } }));
  }
  return n;
}
function throwAggregatedErrors(e) {
  if (e.length === 1)
    throw e[0];
  let t = e.map(summarizeValidationError), n = t.map(formatAggregateLine);
  throw new ValidationError(`${formatAggregateHeadline(t)}:
  - ${n.join(`
  - `)}`, { code: e[0].code, details: { errors: e.map((e) => e.toJSON()), count: e.length, issues: t }, suggest: `Fix the listed validation errors and retry` });
}
function subjectLabel(e) {
  return e.kind === `flag` ? `flag --${e.name}` : `argument <${e.name}>`;
}
function subjectReference(e) {
  return e.kind === `flag` ? `--${e.name}` : `<${e.name}>`;
}
function subjectDetails(e) {
  return e.kind === `flag` ? { flag: e.name } : { arg: e.name };
}
async function validatePathChecks(e, t, n, r, i, a) {
  let o = subjectLabel(e), s = subjectReference(e), c = subjectDetails(e), l = diagnosticValue(a, t), u = { violation: undefined, createSkipped: false }, d = (e, t = false) => ({ violation: e, createSkipped: t }), f;
  try {
    f = await r(t);
  } catch (e) {
    if (l.kind === `redacted`)
      return d(new ValidationError(`Failed to inspect path '${l.text}' for ${o}`, { code: `CONSTRAINT_VIOLATED`, details: { ...c, constraint: `stat` }, suggest: `Provide an accessible path for ${s}` }));
    let t = e instanceof Error ? e.message : String(e);
    return d(new ValidationError(`Failed to inspect path '${l.text}' for ${o}: ${t}`, { code: `CONSTRAINT_VIOLATED`, details: { ...c, value: l.value, constraint: `stat`, cause: t }, suggest: `Provide an accessible path for ${s}`, cause: e }));
  }
  if (f === null) {
    if (n.create && i !== undefined)
      try {
        return await i(t), u;
      } catch (e) {
        if (l.kind === `redacted`)
          return d(new ValidationError(`Failed to create directory '${l.text}' for ${o}`, { code: `CONSTRAINT_VIOLATED`, details: { ...c, constraint: `create` }, suggest: `Provide a creatable or existing directory path for ${s}` }));
        let t = e instanceof Error ? e.message : String(e);
        return d(new ValidationError(`Failed to create directory '${l.text}' for ${o}: ${t}`, { code: `CONSTRAINT_VIOLATED`, details: { ...c, value: l.value, constraint: `create`, cause: t }, suggest: `Provide a creatable or existing directory path for ${s}`, cause: e }));
      }
    let e = n.create;
    return n.mustExist ? d(new ValidationError(`Path '${l.text}' for ${o} does not exist`, { code: `CONSTRAINT_VIOLATED`, details: { ...c, ...l.kind === `visible` ? { value: l.value } : {}, constraint: `mustExist` }, suggest: `Provide an existing path for ${s}` }), e) : { violation: undefined, createSkipped: e };
  }
  return n.type !== undefined && f !== n.type ? d(new ValidationError(`Path '${l.text}' for ${o} is a ${f}, expected a ${n.type}`, { code: `CONSTRAINT_VIOLATED`, details: { ...c, ...l.kind === `visible` ? { value: l.value } : {}, constraint: `pathType`, expected: n.type }, suggest: `Provide a ${n.type} path for ${s}` })) : u;
}
async function checkResolvedPath(e, t, n, r, i, a) {
  let o = pathValuesOf(t);
  if (o.length === 0)
    return;
  if (i.stat === undefined) {
    a.skipped.push({ kind: e.kind, name: e.name, checks: n, missing: `stat` });
    return;
  }
  let s = false;
  for (let t of o) {
    let o = await validatePathChecks(e, t, n, i.stat, i.mkdir, r);
    o.violation !== undefined && a.errors.push(o.violation), s ||= o.createSkipped;
  }
  s && a.skipped.push({ kind: e.kind, name: e.name, checks: n, missing: `mkdir` });
}
function describeSkippedPathCheck(e) {
  let t = subjectLabel(e);
  return e.missing === `stat` ? `${t}: no stat probe was supplied` : `${t}: no mkdir was supplied for create`;
}
function pathChecksSkippedError(e) {
  let t = `Pass stat (and mkdir for create) in run options to exercise the checks, or drop pathChecks: 'strict'`, n = { skipped: e.map((e) => ({ kind: e.kind, name: e.name, missing: e.missing, checks: { mustExist: e.checks.mustExist, ...e.checks.type === undefined ? {} : { type: e.checks.type }, create: e.checks.create } })) };
  if (e.length === 1)
    return new CLIError(`Filesystem checks were skipped for ${describeSkippedPathCheck(e[0])}`, { code: `PATH_CHECK_SKIPPED`, details: n, suggest: t });
  let r = e.map((e) => `  - ${describeSkippedPathCheck(e)}`);
  return new CLIError(`Filesystem checks were skipped for ${e.length} inputs:
${r.join(`
`)}`, { code: `PATH_CHECK_SKIPPED`, details: n, suggest: t });
}
function pathValuesOf(e) {
  return typeof e == `string` ? [e] : Array.isArray(e) ? e.filter((e) => typeof e == `string`) : typeof e == `object` && e ? Object.values(e).filter((e) => typeof e == `string`) : [];
}
function resolveConfigPath(e, t) {
  let n = t.split(`.`), r = e;
  for (let e of n) {
    if (typeof r != `object` || !r || !Object.hasOwn(r, e))
      return;
    r = r[e];
  }
  return r;
}
function readEnv(e, t) {
  return Object.hasOwn(e, t) ? e[t] : undefined;
}
function readIndexedEnv(e, t) {
  let n = e.count, r = readEnv(t, n);
  if (r === undefined)
    return { kind: `absent` };
  if (!CANONICAL_COUNT.test(r))
    return { kind: `fault`, fault: { kind: `count`, countVar: n, raw: r } };
  let i = Number(r);
  if (i > 1e4)
    return { kind: `fault`, fault: { kind: `limit`, countVar: n, raw: r, max: 1e4 } };
  let a = indexedEnvMembers(e), o = [];
  for (let r = 0;r < i; r++) {
    let s = [], c = [];
    for (let [e, o] of a) {
      let a = expandEnvTemplate(o, r), l = readEnv(t, a);
      if (l === undefined)
        return { kind: `fault`, fault: { kind: `member`, countVar: n, count: i, index: r, field: e, envVar: a } };
      s.push(a), c.push([e, l]);
    }
    let l = e.fields === undefined ? c[0]?.[1] ?? `` : Object.fromEntries(c);
    o.push({ index: r, raw: l, envVars: s });
  }
  return { kind: `entries`, countVar: n, entries: o };
}
async function runStages(e, t, n) {
  let r = stdinBindingOf(e);
  for (let i of e) {
    let e = await (i.stage === `prompt` ? promptStage(i, t, n) : runNonPromptStage(i, r, t, n));
    if (e.kind !== `absent`)
      return e;
  }
  return ABSENT;
}
function runEarlyStages(e, t, n) {
  let r = stdinBindingOf(e);
  for (let i of e) {
    if (i.stage === `prompt` || i.stage === "default")
      break;
    let e = runNonPromptStage(i, r, t, n);
    if (e.kind !== `absent`)
      return e;
  }
  return ABSENT;
}
function runNonPromptStage(e, t, n, r) {
  switch (e.stage) {
    case `cli`:
      return cliStage(t, n, r);
    case `stdin`:
      return stdinStage(e, n, r);
    case `env`:
      return envStage(e, n, r);
    case `config`:
      return configStage(e, n, r);
    case `default`:
      return { kind: `value`, value: e.defaultValue, provenance: { stage: `default` } };
  }
}
function cliStage(e, t, n) {
  if (t.cli.kind === `dash`) {
    let r = n.stdinData;
    return e === undefined || typeof r != `string` ? ABSENT : coerced(t, e, r, { stage: `cli`, via: `stdin`, trigger: `dash` });
  }
  if (t.cli.kind === `value`) {
    let r = t.finishCli(t.cli.value, n.stdinData, e);
    return r.kind === `absent` ? ABSENT : r.kind === `error` ? { kind: `error`, error: r.error } : { kind: `value`, value: r.value, provenance: cliProvenance(r.viaStdin) };
  }
  return ABSENT;
}
function cliProvenance(e) {
  return e ? { stage: `cli`, via: `stdin`, trigger: `dash` } : { stage: `cli` };
}
function stdinStage(e, t, n) {
  if (!stdinReadsWhenMissing(e) || t.cli.kind !== `absent`)
    return ABSENT;
  let r = n.stdinData;
  return typeof r == `string` ? coerced(t, e, r, { stage: `stdin`, via: `stdin`, trigger: `fallback` }) : ABSENT;
}
function envStage(e, t, n) {
  if (`indexed` in e) {
    let r = readIndexedEnv(e.indexed, n.env);
    if (r.kind === `absent`)
      return ABSENT;
    let i = t.coerceIndexed(e, r);
    if (!i.ok)
      return { kind: `error`, error: i.error };
    let a = r.kind === `entries` ? r.entries : [];
    return { kind: `value`, value: i.value, provenance: { stage: `env`, via: `indexed`, count: e.indexed.count, envVars: a.flatMap((e) => e.envVars) } };
  }
  let r = e.envVar, i = Object.hasOwn(n.env, r) ? n.env[r] : undefined;
  return i === undefined ? ABSENT : coerced(t, e, i, { stage: `env`, envVar: r });
}
function configStage(e, t, n) {
  let r = e.configPath, i = resolveConfigPath(n.config, r);
  return i === undefined ? ABSENT : coerced(t, e, i, { stage: `config`, configPath: r });
}
async function promptStage(e, t, n) {
  if (!n.canPrompt)
    return ABSENT;
  let r = await t.runPrompt(e);
  return r.ok ? { kind: `value`, value: r.value, provenance: { stage: `prompt` } } : r.error === undefined ? ABSENT : { kind: `error`, error: r.error };
}
function coerced(e, t, n, r) {
  let i = e.coerce(t, n);
  return i.ok ? { kind: `value`, value: i.value, provenance: r } : { kind: `error`, error: i.error };
}
function readCliValue(e, t, n) {
  if (!e || t === undefined || !n.some((e) => e.stage === `cli`))
    return { kind: `absent` };
  let r = stdinBindingOf(n);
  return t === `-` && r !== undefined && stdinReadsOnDash(r) ? { kind: `dash` } : { kind: `value`, value: t };
}
async function resolveFlags(e, t, n) {
  let r = {}, i = [], a = /* @__PURE__ */ new Set, o = /* @__PURE__ */ new Map, s = /* @__PURE__ */ new Map, c = pendingFlagErrors(t), l = pendingFlagReads(t), u = /* @__PURE__ */ new Map, d = false, f = { env: n.env, config: n.config, stdinData: n.stdinData, canPrompt: n.prompter !== undefined };
  for (let [o, p] of Object.entries(e)) {
    if (c?.has(o))
      continue;
    let e = sourceBindings(p, n.envPrefix);
    if (c?.size && flagValueSchema(p).codec.name === `custom`) {
      let i = false, a;
      Object.defineProperty(r, o, { enumerable: true, configurable: true, get: () => {
        if (!i) {
          i = true;
          try {
            let i = l?.get(o), s = i === undefined ? t : { [o]: i() }, c = runEarlyStages(bindingsBeforePrompt(e), stageInput$1(o, p, s, e, n.prompter), f);
            c.kind === `value` && (a = c.value), c.kind === `absent` && delete r[o], c.kind === `error` && (d = true);
          } catch {
            d = true;
          }
        }
        return a;
      } }), u.set(o, () => r[o]);
      continue;
    }
    let m = await runStages(bindingsBeforePrompt(e), stageInput$1(o, p, t, e, n.prompter), f);
    m.kind === `error` && s.set(o, i.length), record(o, p, m, r, i, a, n);
  }
  let p;
  try {
    let e = u.size ? new Proxy(r, { ownKeys: (e) => {
      for (let e of u.values())
        e();
      return Reflect.ownKeys(e);
    }, has: (e, t) => (u.get(t)?.(), Reflect.has(e, t)), getOwnPropertyDescriptor: (e, t) => (u.get(t)?.(), Reflect.getOwnPropertyDescriptor(e, t)) }) : r;
    p = n.interactive?.({ flags: e });
  } catch (e) {
    if (!c?.size)
      throw e;
    d = true;
  }
  if (c !== undefined)
    for (let [t, n] of c) {
      let r = e[t];
      if (r === undefined)
        throw n;
      let i = effectivePromptConfig(t, r, p);
      throw d || r.sensitive || i?.kind === `password` || i?.sensitive === true ? redactFlagParseError(n) : n;
    }
  for (let [c, l] of Object.entries(e)) {
    let e = effectivePromptConfig(c, l, p), u = l.sensitive || e?.kind === `password` || e?.sensitive === true, d = u ? { ...l, sensitive: true } : l;
    u && n.sensitiveInputs?.add(c), o.set(c, d);
    let m = s.get(c), h = m === undefined ? undefined : i[m];
    if (u && m !== undefined && h !== undefined && (i[m] = redactCoercionError(h)), Object.hasOwn(r, c) || a.has(c))
      continue;
    let g = withPromptBinding(d, sourceBindings(d, n.envPrefix), e);
    if (record(c, d, await runStages(bindingsFromPrompt(g), stageInput$1(c, d, t, g, n.prompter), f), r, i, a, n), !(Object.hasOwn(r, c) || a.has(c))) {
      if (d.kind === `array` && d.presence !== `required`)
        r[c] = [], n.provenance[c] = { stage: `default` };
      else if (d.kind === `keyValue` && d.presence !== `required`)
        r[c] = {}, n.provenance[c] = { stage: `default` };
      else if (d.presence === `required`) {
        let e = { flag: c, kind: d.kind }, t = envBindingOf(sourceBindings(d, n.envPrefix));
        t !== undefined && `envVar` in t && (e.envVar = t.envVar), t !== undefined && `indexed` in t && (e.envIndexed = t.indexed), d.configPath !== undefined && (e.configPath = d.configPath), i.push(new ValidationError(`Missing required flag --${c}`, { code: `REQUIRED_FLAG`, details: e, suggest: buildRequiredFlagSuggest(c, d, t, n.env) }));
      } else
        r[c] = undefined;
    }
  }
  for (let [t, a] of Object.entries(e)) {
    let e = o.get(t) ?? a, s = Object.hasOwn(r, t) ? r[t] : undefined, c = flagValueSchema(e).pathChecks;
    e.kind === `array` && e.unique && Array.isArray(s) && (r[t] = [...dedupe(s)]), c !== undefined && await checkResolvedPath({ kind: `flag`, name: t }, Object.hasOwn(r, t) ? r[t] : undefined, c, e.sensitive, { stat: n.stat, mkdir: n.mkdir }, { errors: i, skipped: n.skippedPathChecks });
  }
  return isNonEmpty(i) && throwAggregatedErrors(i), r;
}
function stageInput$1(e, t, n, r, i) {
  let a = Object.hasOwn(n, e);
  return { cli: readCliValue(a, a ? n[e] : undefined, r), coerce: (n, r) => coerceValue(e, n, r, t), coerceIndexed: (n, r) => coerceIndexedFlagValue(e, n, r, t), finishCli: (n, r, i) => finishCliFlagValue(e, t, n, r, i), runPrompt: async (n) => i === undefined ? { ok: false, error: undefined } : resolvePromptValueWithConfig(e, t, n, i) };
}
function record(e, t, n, r, i, a, o) {
  n.kind === `error` ? (i.push(n.error), a.add(e)) : n.kind !== `absent` && (t.deprecated !== undefined && n.provenance.stage !== "default" && o.deprecations.push({ kind: `flag`, name: e, message: t.deprecated }), r[e] = n.value, o.provenance[e] = n.provenance);
}
function effectivePromptConfig(e, t, n) {
  let r = n !== undefined && Object.hasOwn(n, e) ? n[e] : undefined;
  if (r !== false)
    return r == null || r === 0 || r === `` ? t.prompt : r;
}
function promptCompatibilityError(e, t, n, r) {
  let i = { ...e.details, promptKind: n, allowed: r }, a = `Prompt kind '${n}' is not compatible with ${t} ${e.singular} ${e.reference}.`, o = r[0];
  return o === undefined ? new ValidationError(`${a} ${t} ${e.plural} are not promptable`, { code: `CONSTRAINT_VIOLATED`, details: i, suggest: `Remove the prompt config for ${e.reference}` }) : new ValidationError(`${a} Use '${o}' instead`, { code: `CONSTRAINT_VIOLATED`, details: i, suggest: `Change the prompt to { kind: '${o}' } for ${e.reference}` });
}
function validatePromptFlagCompatibility(e, t, n) {
  let r = COMPATIBLE_PROMPT_KINDS[t];
  if (!r.includes(n))
    return promptCompatibilityError({ reference: `--${e}`, singular: `flag`, plural: `flags`, details: { flag: e, flagKind: t } }, t, n, r);
}
async function resolvePromptValueWithConfig(e, t, n, r) {
  let i = { ...n.prompt, sensitive: t.sensitive || n.prompt.sensitive === true || n.prompt.kind === `password` }, a = validatePromptFlagCompatibility(e, t.kind, i.kind);
  if (a !== undefined)
    return { ok: false, error: a };
  let o = resolvePromptConfig(i, valueEnumValues(flagValueSchema(t))), s = await r.promptOne(o);
  if (!s.answered) {
    if (i.kind === `password` && s.reason === `invalid`)
      throw new CLIError(`Too many invalid prompt answers`, { code: `PROMPT_INVALID`, exitCode: 2 });
    if (i.kind === `password`)
      throw new PromptCancelledError;
    return { ok: false, error: undefined };
  }
  return i.kind === `input` && i.default === undefined && (i.empty ?? `skip`) === `skip` && typeof s.value == `string` && (i.trim === false ? s.value : s.value.trim()) === `` ? { ok: false, error: undefined } : coerceValue(e, n, s.value, i.sensitive ? { ...t, sensitive: true } : t);
}
function buildRequiredFlagSuggest(e, t, n, r) {
  let i = [], a = t.kind !== `boolean` && t.kind !== `count`;
  acceptsArgv(t) && i.push(`Provide --${e}${a ? ` <value>` : ``}`);
  let o = t.stdin;
  if (o !== undefined && i.push(acceptsArgv(t) ? o.when === `dash` ? `pass --${e} - to read stdin` : o.when === `missing` ? `pipe a value to stdin` : `pipe a value to stdin or pass --${e} -` : `Pipe a value to stdin`), n !== undefined && i.push(requiredEnvSuggestion(n, r)), t.configPath !== undefined && i.push(`add ${t.configPath} to config`), i.length <= 1)
    return i.join(``);
  let s = i.slice(0, -1), c = i.slice(-1).join(``);
  return i.length === 2 ? `${s.join(``)} or ${c}` : `${s.join(`, `)}, or ${c}`;
}
async function resolveArgs(e, t, n) {
  let r = {}, i = [], a = { env: n.env, config: n.config, stdinData: n.stdinData, canPrompt: n.prompter !== undefined };
  for (let { name: o, schema: s } of e) {
    let e = sourceBindings(s, n.envPrefix), c = envBindingOf(e), l = await runStages(e, stageInput(o, s, t, e, n.prompter), a);
    if (l.kind === `error`) {
      i.push(l.error);
      continue;
    }
    if (l.kind === `value`) {
      s.deprecated !== undefined && l.provenance.stage !== "default" && n.deprecations.push({ kind: `arg`, name: o, message: s.deprecated }), r[o] = l.value, n.provenance[o] = l.provenance;
      continue;
    }
    let u = argCardinality(s);
    if (u.kind === `many` || u.kind === `entries`) {
      if (s.presence === `required`) {
        i.push(new ValidationError(`Missing required argument <${o}>`, { code: `REQUIRED_ARG`, details: { arg: o, ...s.variadic ? { variadic: true } : {} }, suggest: buildRequiredArgSuggest(o, s, c, n.env, s.variadic) }));
        continue;
      }
      r[o] = u.kind === `many` ? [] : {}, n.provenance[o] = { stage: `default` };
    } else
      s.presence === `required` ? i.push(new ValidationError(`Missing required argument <${o}>`, { code: `REQUIRED_ARG`, details: { arg: o }, suggest: buildRequiredArgSuggest(o, s, c, n.env) })) : r[o] = undefined;
  }
  for (let { name: t, schema: n } of e) {
    if (!n.unique)
      continue;
    let e = Object.hasOwn(r, t) ? r[t] : undefined;
    Array.isArray(e) && (r[t] = [...dedupe(e)]);
  }
  for (let { name: t, schema: a } of e) {
    let e = argValueSchema(a).pathChecks;
    e !== undefined && await checkResolvedPath({ kind: `arg`, name: t }, Object.hasOwn(r, t) ? r[t] : undefined, e, a.sensitive, { stat: n.stat, mkdir: n.mkdir }, { errors: i, skipped: n.skippedPathChecks });
  }
  return isNonEmpty(i) && throwAggregatedErrors(i), r;
}
function stageInput(e, t, n, r, i) {
  let a = Object.hasOwn(n, e), o = a ? n[e] : undefined;
  return { cli: argCollectedNothing(t, o) ? { kind: `absent` } : readCliValue(a, o, r), coerce: (n, r) => coerceArgValue(e, n, r, t), coerceIndexed: (n, r) => coerceIndexedArgValue(e, n, r, t), finishCli: (n, r, i) => finishCliArgValue(e, t, n, r, i), runPrompt: async (n) => i === undefined ? { ok: false, error: undefined } : resolveArgPromptValue(e, t, n, i) };
}
function argPromptCompatibility(e) {
  return argCardinality(e).kind === `many` ? { allowed: COMPATIBLE_PROMPT_KINDS.array, kindWord: `variadic ${e.kind}` } : { allowed: COMPATIBLE_PROMPT_KINDS[e.kind], kindWord: e.kind };
}
async function resolveArgPromptValue(e, t, n, r) {
  let i = { ...n.prompt, sensitive: t.sensitive || n.prompt.sensitive === true || n.prompt.kind === `password` }, { allowed: a, kindWord: o } = argPromptCompatibility(t);
  if (!a.includes(i.kind))
    return { ok: false, error: promptCompatibilityError({ reference: `<${e}>`, singular: `argument`, plural: `arguments`, details: { arg: e, argKind: t.kind } }, o, i.kind, a) };
  let s = resolvePromptConfig(i, valueEnumValues(argValueSchema(t))), c = await r.promptOne(s);
  if (!c.answered) {
    if (i.kind === `password` && c.reason === `invalid`)
      throw new CLIError(`Too many invalid prompt answers`, { code: `PROMPT_INVALID`, exitCode: 2 });
    if (i.kind === `password`)
      throw new PromptCancelledError;
    return { ok: false, error: undefined };
  }
  return i.kind === `input` && i.default === undefined && (i.empty ?? `skip`) === `skip` && typeof c.value == `string` && (i.trim === false ? c.value : c.value.trim()) === `` ? { ok: false, error: undefined } : coerceArgValue(e, n, c.value, i.sensitive ? { ...t, sensitive: true } : t);
}
function buildRequiredArgSuggest(e, t, n, r, i) {
  let a = acceptsArgv(t) ? [i ? `Provide at least one value for <${e}>` : `Provide a value for <${e}>`] : [], o = t.stdin;
  return o !== undefined && a.push(acceptsArgv(t) ? o.when === `dash` ? `pass '-' to read stdin` : o.when === `missing` ? `pipe a value to stdin` : `pipe a value to stdin or pass '-'` : `Pipe a value to stdin`), n !== undefined && a.push(requiredEnvSuggestion(n, r)), t.configPath !== undefined && a.push(`add ${t.configPath} to config`), a.length === 1 ? a.join(``) : a.length === 2 ? `${a[0]} or ${a[1]}` : `${a.slice(0, -1).join(`, `)}, or ${a[a.length - 1]}`;
}
function formatIssuePath(e, t) {
  if (!(t || e === undefined || e.length === 0))
    return e.map((e) => {
      let t = typeof e == `object` ? e.key : e;
      return typeof t == `number` ? String(t) : diagnosticValue(false, t).text;
    }).join(`.`);
}
function issuesMessage(e, t, n) {
  return `${e} failed validation: ${t.map((e) => {
    let t = formatIssuePath(e.path, n);
    return t === undefined ? e.message : `${t}: ${e.message}`;
  }).join(`; `)}`;
}
async function validateValue(e, t, n, r) {
  let i;
  try {
    i = await n[`~standard`].validate(t);
  } catch (n) {
    let i = n instanceof Error ? n.message : String(n), a = diagnosticValue(r, t);
    return { ok: false, error: new ValidationError(`${e} validator threw: ${i}`, { code: `CONSTRAINT_VIOLATED`, ...a.kind === `visible` ? { details: { value: a.value, cause: i } } : {}, suggest: `Fix the validator for ${e}, or provide a value it can process` }) };
  }
  if (i.issues !== undefined) {
    let n = diagnosticValue(r, t);
    return { ok: false, error: new ValidationError(issuesMessage(e, i.issues, r), { code: `CONSTRAINT_VIOLATED`, details: { ...n.kind === `visible` ? { value: n.value } : {}, issues: i.issues.map((e) => e.message) }, suggest: `Provide a value for ${e} that satisfies its validator` }) };
  }
  return { ok: true, value: i.value };
}
function resolvedValue(e, t) {
  return Object.hasOwn(e, t) ? e[t] : undefined;
}
async function applyStandardValidators(e, t, n, r) {
  let i = [], a = { ...t };
  for (let [n, o] of Object.entries(e.flags)) {
    let e = resolvedValue(t, n);
    if (e === undefined)
      continue;
    let s = await validateInput(`--${n}`, e, isCollection(flagCardinality(o)), flagValueSchema(o).standard, flagAggregateStandard(o), i, o.sensitive || r?.has(n) === true);
    s.changed && (a[n] = s.value);
  }
  let o = { ...n };
  for (let t of e.args) {
    let e = resolvedValue(n, t.name);
    if (e === undefined)
      continue;
    let r = await validateInput(`<${t.name}>`, e, isCollection(argCardinality(t.schema)), argValueSchema(t.schema).standard, argAggregateStandard(t.schema), i, t.schema.sensitive);
    r.changed && (o[t.name] = r.value);
  }
  return { flags: a, args: o, errors: i };
}
async function validateInput(e, t, n, r, i, a, o) {
  let s = t, c = false, l = a.length;
  if (r !== undefined) {
    let t = n ? await validateElements(e, s, r, a, o) : await validateOne(e, s, r, a, o);
    s = t.value, c ||= t.changed;
  }
  if (i !== undefined && a.length === l) {
    let t = await validateValue(e, s, i, o);
    t.ok ? (s = t.value, c = true) : a.push(t.error);
  }
  return { changed: c, value: s };
}
async function validateElements(e, t, n, r, i) {
  if (Array.isArray(t)) {
    let a = [];
    for (let [o, s] of t.entries()) {
      let t = await validateValue(`${e}[${o}]`, s, n, i);
      t.ok ? a.push(t.value) : (a.push(s), r.push(t.error));
    }
    return { changed: true, value: a };
  }
  if (isPlainRecord(t)) {
    let a = /* @__PURE__ */ new Map;
    for (let [o, s] of Object.entries(t)) {
      let t = await validateValue(i ? e : `${e}.${diagnosticValue(false, o).text}`, s, n, i);
      a.set(o, t.ok ? t.value : s), t.ok || r.push(t.error);
    }
    return { changed: true, value: Object.fromEntries(a) };
  }
  return validateOne(e, t, n, r, i);
}
async function validateOne(e, t, n, r, i) {
  let a = await validateValue(e, t, n, i);
  return a.ok ? { changed: true, value: a.value } : (r.push(a.error), { changed: false, value: t });
}
function isPlainRecord(e) {
  if (typeof e != `object` || !e || Array.isArray(e))
    return false;
  let t = Object.getPrototypeOf(e);
  return t === Object.prototype || t === null;
}
function resolvedSensitiveFlags(e) {
  return sensitiveFlagsByResult.get(e);
}
async function resolve(e, t, n) {
  let r = [], i = [], a = provenanceRecord(), o = provenanceRecord(), s = /* @__PURE__ */ new Set, c = { env: n?.env ?? {}, config: n?.config ?? {}, stdinData: n?.stdinData, prompter: n?.prompter, deprecations: r, stat: n?.stat, mkdir: n?.mkdir, envPrefix: n?.envPrefix === undefined ? undefined : normalizeEnvPrefix(n.envPrefix), skippedPathChecks: i }, l = {}, u = {}, d = [];
  try {
    l = await resolveFlags(e.flags, t.flags, { ...c, interactive: e.interactive, provenance: a, sensitiveInputs: s });
  } catch (e) {
    if (!isValidationError(e))
      throw e;
    d.push(...collectValidationErrors(e));
  }
  try {
    u = await resolveArgs(e.args, t.args, { ...c, provenance: o });
  } catch (e) {
    if (!isValidationError(e))
      throw e;
    d.push(...collectValidationErrors(e));
  }
  let f = await applyStandardValidators(e, l, u, s);
  if (l = f.flags, u = f.args, d.push(...f.errors), n?.pathChecks === `strict` && isNonEmpty(i))
    throw pathChecksSkippedError(i);
  isNonEmpty(d) && throwAggregatedErrors(d);
  let p = { flags: l, args: u, deprecations: r, skippedPathChecks: i, provenance: { flags: a, args: o } };
  return s.size > 0 && sensitiveFlagsByResult.set(p, s), p;
}
function provenanceRecord() {
  return Object.create(null);
}
function isSupplied(e, t, n) {
  let r = e.kind === `flag` ? `flags` : `args`, i = n.provenance[r];
  return !Object.hasOwn(i, e.name) || !wasExplicit(i[e.name]) ? false : e.kind !== `flag` || t.flags[e.name]?.kind !== `boolean` || n.flags[e.name] === true;
}
function constraintError(e, t) {
  let n = e.inputs.filter(t), r = (t) => new CLIError(describeConstraint(e), { code: t, details: { constraint: e, supplied: n } });
  switch (e.kind) {
    case `conflicts`:
      return n.length === 2 ? r(`CONFLICTING_FLAGS`) : undefined;
    case `requires`:
      return n[0] === e.inputs[0] && n.length === 1 ? r(`MISSING_DEPENDENT_FLAG`) : undefined;
    case `exactlyOne`:
      return n.length === 1 ? undefined : r(`EXACTLY_ONE_REQUIRED`);
    case `atMostOne`:
      return n.length > 1 ? r(`CONFLICTING_FLAGS`) : undefined;
    case `allOrNone`:
      return n.length !== 0 && n.length !== e.inputs.length ? r(`INCOMPLETE_INPUT_GROUP`) : undefined;
  }
}
function validationIssue(e, t, n, r) {
  let i = (e.path ?? []).map((e) => String(typeof e == `object` ? e.key : e)), a = t && i[0] === `sources` ? 1 : 0, o = t ? i[a] : `flags`, s = t ? a + 1 : 0, c = i[s];
  if (c === undefined || o !== `flags` && o !== `args`)
    return { message: e.message, path: i };
  let l = o === `flags` ? r?.has(c) || n.flags[c]?.sensitive : n.args.find((e) => e.name === c)?.schema.sensitive;
  return { message: e.message, path: l ? i.slice(0, s + 1) : i, label: o === `flags` ? `--${c}` : `<${c}>` };
}
async function validateCommandInputs(e, t) {
  for (let n of e.constraints ?? []) {
    let r = constraintError(n, (n) => isSupplied(n, e, t));
    if (r !== undefined)
      throw r;
  }
  for (let n of e.validators ?? []) {
    let r = n.input === `resolved`, i = { ...t.flags }, a = r ? { flags: i, args: { ...t.args }, sources: t.provenance } : i, o;
    try {
      o = (await n.schema[`~standard`].validate(a)).issues;
    } catch (e) {
      throw new CLIError(`Command validator threw`, { code: `COMMAND_VALIDATION_FAILED`, cause: e });
    }
    if (o === undefined)
      continue;
    let s = resolvedSensitiveFlags(t), c = o.map((t) => validationIssue(t, r, e, s));
    throw new CLIError(c.map(({ message: e, label: t }) => t === undefined ? e : `${t}: ${e}`).join(`
`) || `Command inputs failed validation`, { code: `COMMAND_VALIDATION_FAILED`, details: { issues: c } });
  }
}
async function executeCommand(e) {
  let { argv: t, command: n, meta: r, options: i, out: a, schema: o } = e;
  clearRequestedExitCode(a);
  let s = [];
  try {
    let e = builtinEnabled(i?.builtins, `help`) ? requestedHelpMode(t, o.helpTopics) : undefined;
    if (e !== undefined) {
      if (a.jsonMode || i?.jsonMode === true) {
        let { generateCommandSchema: e } = await Promise.resolve().then(() => (init_json_schema_DP4L_jL_(), {})).then((e) => json_schema_exports);
        return a.json(e(o, { envPrefix: i?.envPrefix, groupOrder: i?.help?.groupOrder }, { name: i?.help?.binName ?? o.name, version: i?.help?.version })), { exitCode: 0, error: undefined };
      }
      let t = i?.flags?.caseParity ?? i?.help?.caseParity, n = i?.help?.width ?? a.terminalSize?.columns, r = { ...i?.help, ...n === undefined ? {} : { width: n }, ...e === `all` ? { showAdvanced: true } : {}, ...i?.envPrefix !== undefined && i.help?.envPrefix === undefined ? { envPrefix: i.envPrefix } : {}, ...t === undefined ? {} : { caseParity: t } }, s = r.colors === undefined ? { ...r, colors: a.color } : r;
      if (typeof e == `object`) {
        let t = formatHelpTopic(o, e.group, s);
        if (t === undefined)
          throw new CLIError(`Help topic '${e.name}' has no flags in group '${e.group}'`, { code: `INVALID_SCHEMA`, details: { command: o.name, topic: e.name, group: e.group } });
        a.log(t);
      } else
        a.log(formatHelp(o, s));
      return { exitCode: 0, error: undefined };
    }
    let c = n.handler;
    if (c === undefined) {
      let e = new CLIError(`Command '${o.name}' has no action handler`, { code: `NO_ACTION`, suggest: `Add an .action() handler to the '${o.name}' command` });
      return a.error(e.message), { exitCode: 1, error: e };
    }
    await runBeforeParseHooks(i?.plugins, { argv: t, command: o, meta: r, out: a });
    let l = (o.interactive === undefined ? parse : parseForResolution)(o, t, i?.flags), u = i?.prompter ?? await scriptedPrompter(i?.answers), d = await resolve(o, l, { ...i?.stdinData === undefined ? {} : { stdinData: i.stdinData }, ...i?.env === undefined ? {} : { env: i.env }, ...i?.config === undefined ? {} : { config: i.config }, ...u === undefined ? {} : { prompter: u }, ...i?.stat === undefined ? {} : { stat: i.stat }, ...i?.mkdir === undefined ? {} : { mkdir: i.mkdir }, ...i?.pathChecks === undefined ? {} : { pathChecks: i.pathChecks }, ...i?.envPrefix === undefined ? {} : { envPrefix: i.envPrefix } });
    s = d.skippedPathChecks;
    let f = { args: d.args, flags: d.flags, deprecations: d.deprecations, skippedPathChecks: s, command: o, meta: r, out: a };
    await runResolvedHooks(i?.plugins, `afterResolve`, f), (o.constraints !== undefined || o.validators !== undefined) && await validateCommandInputs(o, d);
    for (let e of d.deprecations)
      a.warn(formatDeprecation(e));
    await runResolvedHooks(i?.plugins, `beforeAction`, f);
    let p;
    return await executeWithExecutionSteps(n, c, d, a, r, async (e) => (a.stopActive(), p ??= Promise.resolve().then(() => (init_session_Dqt1dpXp(), {})).then((e) => session_exports).then(({ createPromptSession: e }) => e({ ...u === undefined ? {} : { prompter: u }, write: (e) => a.error(e.replace(/\n$/, ``)) })), (await p).ask(e))), await runResolvedHooks(i?.plugins, `afterAction`, f), { exitCode: getRequestedExitCode(a) ?? 0, error: undefined, skippedPathChecks: s };
  } catch (e) {
    if (e instanceof CLIError)
      return i?.jsonMode === true ? a.json({ error: e.toJSON() }) : (a.error(e.message), e.suggest !== undefined && a.error(`Suggestion: ${e.suggest}`)), { exitCode: e.exitCode, error: e, skippedPathChecks: s };
    let t = new CLIError(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`, { code: `UNEXPECTED_ERROR`, cause: e });
    return i?.jsonMode === true ? a.json({ error: t.toJSON() }) : a.error(t.message), { exitCode: 1, error: t, skippedPathChecks: s };
  } finally {
    a.stopActive(), clearRequestedExitCode(a);
  }
}
async function scriptedPrompter(e) {
  if (e === undefined)
    return;
  let { createTestPrompter: t } = await Promise.resolve().then(() => (init_test_prompter_CownSa7_(), {})).then((e) => test_prompter_exports);
  return t(e);
}
async function runBeforeParseHooks(e, t) {
  if (e !== undefined)
    for (let n of e) {
      let e = n.hooks.beforeParse;
      e !== undefined && await e(t);
    }
}
async function runResolvedHooks(e, t, n) {
  if (e !== undefined)
    for (let r of e) {
      let e = r.hooks[t];
      e !== undefined && await e(n);
    }
}
async function executeWithExecutionSteps(e, t, n, r, i, a) {
  let o = e.steps, { args: s, flags: c } = n, l = n.provenance, u = async (e) => {
    await t({ flags: c, args: s, sources: l, ctx: e, out: r, meta: i, ask: a });
  };
  for (let e = o.length - 1;e >= 0; e--) {
    let t = o[e];
    if (t === undefined)
      continue;
    let n = u;
    switch (t.kind) {
      case `derive`:
        u = async (e) => {
          let o = await t.handler({ args: s, flags: c, sources: l, ctx: e, out: r, meta: i, ask: a });
          if (o === undefined)
            await n(e);
          else {
            if (typeof o != `object` || !o || Array.isArray(o))
              throw new CLIError(`derive() must return an object or undefined`, { code: `INVALID_BUILDER_STATE`, suggest: `Return an object to add context, or return nothing for validation-only derive handlers` });
            await n({ ...e, ...o });
          }
        };
        break;
      case `middleware`:
        u = async (e) => {
          await t.handler({ args: s, flags: c, sources: l, ctx: e, out: r, meta: i, ask: a, next: async (t) => {
            await n({ ...e, ...t });
          } });
        };
    }
  }
  await u({});
}
function buildRunResult(e, t) {
  return { exitCode: e.exitCode, stdout: t.stdout, stderr: t.stderr, activity: t.activity, error: e.error, skippedPathChecks: e.skippedPathChecks ?? [] };
}
function formatDeprecation(e) {
  let t = e.kind === `flag` ? `flag --${e.name}` : `argument <${e.name}>`;
  return typeof e.message == `string` ? `Warning: ${t} is deprecated: ${e.message}` : `Warning: ${t} is deprecated`;
}
function resolveExecutionColor(e) {
  if (e.color !== undefined)
    return e.color;
  if (e.jsonMode)
    return false;
  let t = e.env ?? {};
  return t.NO_COLOR ? false : t.FORCE_COLOR === undefined ? e.isTTY ?? false : t.FORCE_COLOR !== `0`;
}
async function exitAfterFlush(e, t) {
  let n = t;
  try {
    await e.flush?.();
  } catch {
    n = t === 0 ? 1 : t;
  }
  return e.exit(n);
}
async function importConfigModule(e) {
  let { pathToFileURL: t } = await import("url");
  return (await import(t(e).href)).default;
}
function createInputReader(e, t) {
  let n = ``, r = false, i = false, a = false, o = false, s = async (t) => {
    for (;n === `` && !i; ) {
      let a = await e();
      a === null ? i = true : (n = a, r = t);
    }
    return o && n !== `` && (n.startsWith(`
`) && (n = n.slice(1)), o = false, n === `` && !i) ? s(t) : n !== ``;
  }, c = async (e) => {
    if (a)
      throw new CLIError(`An input read is already active`, { code: `PROMPT_BUSY` });
    a = true;
    let i;
    try {
      e && (i = t?.(), r || (n = ``, o = false));
      let a = ``;
      for (;; ) {
        if (!await s(e))
          return e || a === `` ? null : a;
        if (!e) {
          let e = n.indexOf(`
`);
          if (e !== -1) {
            let t = a + n.slice(0, e);
            return n = n.slice(e + 1), t.replace(/\r$/, ``);
          }
          a += n, n = ``;
          continue;
        }
        let t = String.fromCodePoint(n.codePointAt(0) ?? 0);
        switch (n = n.slice(t.length), t) {
          case `\r`:
            return o = true, a;
          case `
`:
            return a;
          case `\x03`:
            throw new PromptCancelledError(`interrupt`);
          case `\x1B`:
            throw new PromptCancelledError(`escape`);
          case `\x04`:
          case `\x1A`:
            return null;
          case `\x7F`:
          case `\b`:
            a = Array.from(a).slice(0, -1).join(``);
            break;
          case `\x15`:
            a = ``;
            break;
          case `\x17`:
            a = a.replace(/\s*\S+\s*$/, ``);
            break;
          default:
            (t >= ` ` || t === `	`) && (a += t);
        }
      }
    } finally {
      try {
        i?.();
      } finally {
        a = false;
      }
    }
  };
  return { readLine: () => c(false), ...t === undefined ? {} : { readSecret: () => c(true) } };
}
function stripTrailing(e, t) {
  let n = e.length;
  for (;n > 0 && t.includes(e.charCodeAt(n - 1)); )
    --n;
  return n === e.length ? e : e.slice(0, n);
}
function resolveHomeDirectory(e, t) {
  return t ? e.USERPROFILE ? e.USERPROFILE : e.HOMEDRIVE && e.HOMEPATH ? e.HOMEDRIVE + e.HOMEPATH : e.HOME || `C:\\` : e.HOME || `/`;
}
function resolveConfigDirectory(e, t, n) {
  if (t)
    return e.APPDATA !== undefined && e.APPDATA !== `` ? e.APPDATA : `${stripTrailing(n, [47, 92]) || n}\\AppData\\Roaming`;
  let r = stripTrailing(n, [47]);
  return e.XDG_CONFIG_HOME !== undefined && e.XDG_CONFIG_HOME !== `` ? e.XDG_CONFIG_HOME : r.length === 0 ? `/.config` : `${r}/.config`;
}
function isDenoErrorNamed(e, t) {
  if (typeof e != `object` || !e || !(`name` in e))
    return false;
  let n = e;
  return typeof n.name == `string` && n.name === t;
}
function isDenoPermissionError(e) {
  return isDenoErrorNamed(e, `NotCapable`) || isDenoErrorNamed(e, `PermissionDenied`);
}
function envGranted(e, t) {
  let n = e.permissions?.querySync;
  if (n === undefined)
    return;
  let r = t === undefined ? { name: `env` } : { name: `env`, variable: t };
  return n.call(e.permissions, r).state === `granted`;
}
function readGrantedEnv(e, t) {
  if (envGranted(e, t) !== false)
    try {
      return e.env.get(t);
    } catch (e) {
      if (isDenoPermissionError(e))
        return;
      throw e;
    }
}
function scopedDenoEnv(e) {
  let t = /* @__PURE__ */ new Map, n = (n) => (t.has(n) || t.set(n, readGrantedEnv(e, n)), t.get(n)), r = (t) => envGranted(e, t) === false ? `Deno has not granted access to ${t}; run with --allow-env=${t}` : undefined;
  return new Proxy(Object.create(null), { get: (e, t) => typeof t == `string` ? n(t) : t === ENV_ACCESS_HINT ? r : undefined, has: (e, t) => typeof t == `string` && n(t) !== undefined, getOwnPropertyDescriptor: (e, t) => {
    if (typeof t != `string`)
      return;
    let r = n(t);
    return r === undefined ? undefined : { value: r, writable: false, enumerable: true, configurable: true };
  }, ownKeys: () => [], set: () => false, defineProperty: () => false, deleteProperty: () => false });
}
function readDenoEnv(e) {
  if (envGranted(e) !== false)
    try {
      return e.env.toObject();
    } catch (e) {
      if (!isDenoPermissionError(e))
        throw e;
    }
  return scopedDenoEnv(e);
}
function safeCwd(e) {
  try {
    return e.cwd();
  } catch (e) {
    if (isDenoPermissionError(e))
      return `/`;
    throw e;
  }
}
function createDenoAdapter(e) {
  let t = e ?? getDenoNamespace(), n = new TextEncoder, r = [`deno`, `run`, ...t.args], i = readDenoEnv(t), a = safeCwd(t), o = (e) => {
    t.stdout.writeSync(n.encode(e));
  }, s = (e) => {
    t.stderr.writeSync(n.encode(e));
  }, c = createDenoInput(t), l = async (e) => {
    try {
      return await t.readTextFile(e);
    } catch (e) {
      if (isDenoErrorNamed(e, `NotFound`) || isDenoPermissionError(e))
        return null;
      throw e;
    }
  }, u = async (e) => {
    try {
      return (await t.stat(e)).isDirectory ? `directory` : `file`;
    } catch (e) {
      if (isDenoErrorNamed(e, `NotFound`))
        return null;
      throw e;
    }
  }, d = resolveDenoHomedir(i, t.build.os === `windows`), f = resolveDenoConfigDir(i, d, t.build.os === `windows`), p = t.stdin.isTerminal();
  return { argv: r, env: i, cwd: a, stdout: o, stderr: s, stdin: c.readLine, ...c.readSecret === undefined ? {} : { readSecret: c.readSecret }, readStdin: () => readDenoStdinAll(t, p), isTTY: t.stdout.isTerminal(), stdinIsTTY: p, getTerminalSize: () => readDenoTerminalSize(t), onTerminalResize: (e) => onDenoTerminalResize(t, e), exit: (e) => t.exit(e), readFile: l, importConfigModule, stat: u, mkdir: (e) => t.mkdir(e, { recursive: true }), homedir: d, configDir: f, userConfigDirs: t.build.os === `darwin` ? [f, `${d}/Library/Application Support`] : [f], systemConfigDirs: t.build.os === `windows` ? [] : [`/etc`] };
}
function normalizeTerminalSize$1(e, t) {
  if (e !== undefined && t !== undefined && Number.isFinite(e) && Number.isFinite(t) && !(e <= 0 || t <= 0))
    return { columns: e, rows: t };
}
function readDenoTerminalSize(e) {
  if (e.stdout.isTerminal() && e.consoleSize !== undefined)
    try {
      let t = e.consoleSize();
      return normalizeTerminalSize$1(t.columns, t.rows);
    } catch {
      return;
    }
}
function onDenoTerminalResize(e, t) {
  if (e.stdout.isTerminal() && e.build.os !== `windows` && e.addSignalListener !== undefined && e.removeSignalListener !== undefined) {
    try {
      e.addSignalListener(`SIGWINCH`, t);
    } catch {
      return;
    }
    return () => {
      e.removeSignalListener?.(`SIGWINCH`, t);
    };
  }
}
function getDenoNamespace() {
  return globalThis.Deno;
}
async function readDenoStdinAll(e, t) {
  if (t)
    return null;
  let n = e.stdin.readable.getReader(), r = new TextDecoder, i = [];
  try {
    for (;; ) {
      let { value: e, done: t } = await n.read();
      if (t) {
        i.push(r.decode());
        break;
      }
      i.push(r.decode(e, { stream: true }));
    }
  } finally {
    n.releaseLock();
  }
  return i.join(``);
}
function createDenoInput(e) {
  let t = new TextDecoder, n = false;
  return createInputReader(async () => {
    if (n)
      return null;
    let r = e.stdin.readable.getReader();
    try {
      let e = await r.read();
      return e.done ? (n = true, t.decode() || null) : t.decode(e.value, { stream: true });
    } finally {
      r.releaseLock();
    }
  }, e.stdin.isTerminal() && e.stdin.setRaw !== undefined ? () => (e.stdin.setRaw?.(true), () => {
    e.stdin.setRaw?.(false);
  }) : undefined);
}
function resolveDenoHomedir(e, t) {
  return resolveHomeDirectory(e, t);
}
function resolveDenoConfigDir(e, t, n) {
  return resolveConfigDirectory(e, n, t);
}
function detectRuntime(e) {
  let t = e ?? globalThis;
  return typeof t.Bun?.version == `string` ? `bun` : typeof t.Deno?.version?.deno == `string` ? `deno` : typeof t.process?.versions?.node == `string` ? `node` : `unknown`;
}
function getNodeProcess() {
  return globalThis.process;
}
function isNodeSystemError(e) {
  return typeof e != `object` || !e || !(`code` in e) ? false : typeof e.code == `string`;
}
function resolveHomedir(e, t) {
  return resolveHomeDirectory(e, t === `win32`);
}
function resolveConfigDir(e, t, n) {
  return resolveConfigDirectory(e, t === `win32`, n);
}
function createNodeAdapter(e) {
  let t = e ?? getNodeProcess(), n = 0, r = [], i = () => {
    if (n !== 0)
      return;
    let e = r;
    r = [];
    let i = outputFailure(t);
    for (let t of e)
      i === undefined ? t.resolve() : t.reject(i.error);
  }, a = (e) => (t) => {
    n += 1;
    let r = false, a = (t) => {
      r || (r = true, t != null && recordStreamError(e, t), --n, i());
    };
    try {
      e.write(t, a);
    } catch (e) {
      throw a(), e;
    }
  };
  watchStreamErrors(t.stdout), watchStreamErrors(t.stderr);
  let o = a(t.stdout), s = a(t.stderr), c = () => new Promise((e, t) => {
    r.push({ resolve: e, reject: t }), i();
  }), l = createNodeInput(t), u = async (e) => {
    let t = await import("fs/promises");
    try {
      return await t.readFile(e, `utf8`);
    } catch (e) {
      if (isNodeSystemError(e) && e.code === `ENOENT`)
        return null;
      throw e;
    }
  }, d = async (e) => {
    let t = await import("fs/promises");
    try {
      return (await t.stat(e)).isDirectory() ? `directory` : `file`;
    } catch (e) {
      if (isNodeSystemError(e) && (e.code === `ENOENT` || e.code === `ENOTDIR`))
        return null;
      throw e;
    }
  }, f = async (e) => {
    await (await import("fs/promises")).mkdir(e, { recursive: true });
  }, p = resolveHomedir(t.env, t.platform), m = resolveConfigDir(t.env, t.platform, p), h = t.platform === `darwin` ? [m, `${p}/Library/Application Support`] : [m], g = t.platform === `win32` ? [] : [`/etc`], _ = t.stdin.isTTY === true;
  return { argv: t.argv, env: t.env, cwd: t.cwd(), stdout: o, stderr: s, flush: c, stdin: l.readLine, ...l.readSecret === undefined ? {} : { readSecret: l.readSecret }, readStdin: () => readNodeStdinAll(t, _), isTTY: t.stdout.isTTY === true, stdinIsTTY: _, getTerminalSize: () => readNodeTerminalSize(t), onTerminalResize: (e) => onNodeTerminalResize(t, e), exit: (e) => t.exit(e), readFile: u, importConfigModule, stat: d, mkdir: f, homedir: p, configDir: m, userConfigDirs: h, systemConfigDirs: g };
}
function recordStreamError(e, t) {
  streamStates.get(e) === undefined && streamStates.set(e, isNodeSystemError(t) && t.code === `EPIPE` ? { kind: `closed` } : { kind: `failed`, error: t });
}
function watchStreamErrors(e) {
  streamStates.has(e) || (streamStates.set(e, undefined), e.on?.(`error`, (t) => recordStreamError(e, t)));
}
function outputFailure(e) {
  for (let t of [e.stdout, e.stderr]) {
    let e = streamStates.get(t);
    if (e?.kind === `failed`)
      return e;
  }
}
function normalizeTerminalSize(e, t) {
  if (e !== undefined && t !== undefined && Number.isFinite(e) && Number.isFinite(t) && !(e <= 0 || t <= 0))
    return { columns: e, rows: t };
}
function readNodeTerminalSize(e) {
  if (e.stdout.isTTY === true) {
    try {
      let t = e.stdout.getWindowSize?.();
      if (t !== undefined) {
        let [e, n] = t, r = normalizeTerminalSize(e, n);
        if (r !== undefined)
          return r;
      }
    } catch {}
    return normalizeTerminalSize(e.stdout.columns, e.stdout.rows);
  }
}
function onNodeTerminalResize(e, t) {
  if (e.stdout.isTTY === true && e.stdout.on !== undefined) {
    if (e.stdout.off !== undefined)
      return e.stdout.on(`resize`, t), () => {
        e.stdout.off?.(`resize`, t);
      };
    if (e.stdout.removeListener !== undefined)
      return e.stdout.on(`resize`, t), () => {
        e.stdout.removeListener?.(`resize`, t);
      };
  }
}
async function readNodeStdinAll(e, t) {
  if (t)
    return null;
  let n = [], r = new TextDecoder;
  for await (let t of e.stdin)
    n.push(r.decode(t, { stream: true }));
  return n.push(r.decode()), n.join(``);
}
function createNodeInput(e) {
  let t, n = new TextDecoder, r = false;
  return createInputReader(async () => {
    if (r)
      return null;
    t ??= e.stdin[Symbol.asyncIterator]();
    let i = await t.next();
    return i.done ? (r = true, n.decode() || null) : n.decode(i.value, { stream: true });
  }, e.stdin.isTTY === true && e.stdin.setRawMode !== undefined ? () => {
    let t = e.stdin.isRaw === true;
    return e.stdin.setRawMode?.(true), () => {
      e.stdin.setRawMode?.(t);
    };
  } : undefined);
}
function isDenoNamespace(e) {
  if (typeof e != `object` || !e)
    return false;
  let t = e;
  return Array.isArray(t.args) && typeof t.cwd == `function` && typeof t.exit == `function` && typeof t.readTextFile == `function` && typeof t.env?.get == `function` && typeof t.env.toObject == `function` && typeof t.stdout?.writeSync == `function` && typeof t.stdout.isTerminal == `function` && typeof t.stderr?.writeSync == `function` && typeof t.stdin?.isTerminal == `function` && typeof t.stdin?.readable?.getReader == `function`;
}
function getInjectedDenoNamespace(e) {
  let t = e.Deno;
  return isDenoNamespace(t) ? t : undefined;
}
function createAdapter(e) {
  let t = e ?? globalThis, n = detectRuntime(t);
  switch (n) {
    case `deno`:
      return createDenoAdapter(getInjectedDenoNamespace(t));
    case `bun`:
    case `node`:
    case `unknown`:
      return createNodeAdapter();
    default:
      return n;
  }
}
function commandRoutes(e) {
  return [e.name, ...e.aliases];
}
function assertNoSiblingRouteConflict(e, t, n, r) {
  let i = t.get(n);
  if (i !== undefined) {
    let t = i === r;
    throw new CLIError(t ? `Command '${r}' reuses route '${n}' under '${e}'` : `Duplicate command route '${n}' under '${e}' (${i} and ${r})`, { code: `DUPLICATE_COMMAND`, suggest: t ? `Remove route '${n}' from the aliases of '${r}'` : `Ensure sibling command names and aliases are unique` });
  }
  t.set(n, r);
}
function compileCommand(e) {
  let t = /* @__PURE__ */ new Map, n = /* @__PURE__ */ new Map;
  for (let r of e._subcommands) {
    let i = commandRoutes(r.schema);
    for (let t of i)
      assertNoSiblingRouteConflict(e.schema.name, n, t, r.schema.name);
    let a = compileCommand(r);
    for (let e of i)
      t.set(e, a);
  }
  return { schema: e.schema, handler: e.handler, steps: e._executionSteps, subcommands: t };
}
function stripGitSuffix(e) {
  return e.endsWith(`.git`) ? e.slice(0, -4) : e;
}
function packageRepositoryUrl(e, t) {
  let n = resolveRepositoryUrl(e);
  if (n === undefined && t?.require === true)
    throw new CLIError(e.repository === undefined ? `manifest has no 'repository' field` : `manifest 'repository' is not a recognisable locator: ${JSON.stringify(e.repository)}`, { code: `INVALID_REPOSITORY`, suggest: `Set 'repository' to a supported locator (e.g. 'github:user/repo' or 'git+https://github.com/user/repo.git'), or drop { require: true } and handle undefined` });
  return n;
}
function resolveRepositoryUrl(e) {
  let t = typeof e.repository == `string` ? e.repository : e.repository?.url;
  if (t === undefined)
    return;
  let n = t.trim();
  if (n.length === 0)
    return;
  let r = /^(github|gitlab|bitbucket):([^/]+\/[^/]+)$/.exec(n);
  if (r !== null && r[1] !== undefined && r[2] !== undefined) {
    let e = SHORTHAND_HOSTS[r[1]];
    if (e !== undefined)
      return `${e}/${stripGitSuffix(r[2])}`;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(n))
    return `https://github.com/${stripGitSuffix(n)}`;
  n.startsWith(`git+`) && (n = n.slice(4));
  let i = /^git@([^:/]+):(.+)$/.exec(n);
  if (i !== null && i[1] !== undefined && i[2] !== undefined)
    return `https://${i[1]}/${stripGitSuffix(stripTrailing(i[2], [47]))}`;
  if (/^(?:https?|git|ssh):\/\//.test(n))
    try {
      let e = new URL(n), t = stripGitSuffix(stripTrailing(e.pathname, [47]));
      return `https://${e.hostname}${t}`;
    } catch {
      return;
    }
}
function releaseTagUrl(e, t) {
  let n;
  try {
    n = new URL(e).hostname;
  } catch {
    return;
  }
  if (n === `github.com`)
    return `${e}/releases/tag/v${t}`;
  if (n === `gitlab.com`)
    return `${e}/-/releases/v${t}`;
}
function deriveHelpLinks(e, t, n) {
  if (e === undefined)
    return;
  if (t === undefined || e.name !== undefined && e.version !== undefined)
    return e;
  let r = packageRepositoryUrl(t);
  return { name: e.name ?? r ?? t.homepage, version: e.version ?? (r !== undefined && n !== undefined ? releaseTagUrl(r, n) : undefined) };
}
function collectPropagatedFlags(e) {
  return Object.fromEntries(collectPropagatedFlagEntries(e));
}
function collectPropagatedFlagEntries(e) {
  let t = /* @__PURE__ */ new Map;
  for (let n = 0;n < e.length - 1; n++) {
    let r = e[n];
    if (r !== undefined)
      for (let i of declaredFlagNames(r)) {
        let a = r.flags[i];
        if (a?.propagate) {
          let r = false;
          for (let t = n + 1;t < e.length - 1; t++) {
            let n = e[t];
            if (n !== undefined && Object.hasOwn(n.flags, i)) {
              r = true;
              break;
            }
          }
          r || t.set(i, a);
        }
      }
  }
  let n = e[e.length - 1];
  if (n !== undefined)
    for (let e of Object.keys(n.flags))
      t.delete(e);
  return t;
}
function dispatch(e, t, n = [], r = /* @__PURE__ */ new Map, i) {
  let a = -1;
  for (let t = 0;t < e.length; t++) {
    let n = e[t];
    if (n !== undefined) {
      if (n === `--`) {
        t + 1 < e.length && (a = t + 1);
        break;
      }
      if (n.startsWith(`-`)) {
        let i = n.indexOf(`=`), a = n.slice(2, i < 0 ? undefined : i);
        n.startsWith(`--`) && r.get(a)?.schema.variadic === true ? t += variadicLongValueCount(e, t, r, i >= 0) : consumesFollowingToken(n, r, adjacentArgvValue(e, t)) && t++;
      } else {
        a = t;
        break;
      }
    }
  }
  if (a === -1)
    return { kind: `unknown`, input: ``, candidates: uniqueCommands(t), parentPath: n };
  let o = e[a];
  if (o === undefined)
    return { kind: `unknown`, input: ``, candidates: uniqueCommands(t), parentPath: n };
  let s = t.get(o);
  if (s === undefined)
    return { kind: `unknown`, input: o, candidates: uniqueCommands(t), parentPath: n };
  let c = removeArgvToken(e, a), l = [...n, s.schema];
  if (s.subcommands.size > 0) {
    let e = collectPropagatedFlagEntries(l), t = e.size === 0 ? s.schema.flags : { ...Object.fromEntries(e), ...s.schema.flags }, n = dispatch(c, s.subcommands, l, buildFlagLookup(t, i), i);
    switch (n.kind) {
      case `match`:
        return n;
      case `unknown`:
        return n.input === `` ? s.schema.hasAction ? { kind: `match`, command: s, commandPath: l, remainingArgv: c } : { kind: `needs-subcommand`, command: s, commandPath: l, remainingArgv: c } : s.schema.hasAction ? { kind: `match`, command: s, commandPath: l, remainingArgv: c } : n;
      case `needs-subcommand`:
        return n;
      default:
        return n;
    }
  }
  return { kind: `match`, command: s, commandPath: l, remainingArgv: c };
}
function consumesFollowingToken(e, t, n) {
  if (e.startsWith(`--`)) {
    if (e.includes(`=`))
      return false;
    let r = t.get(e.slice(2));
    return r !== undefined && (flagExpectsValue(r.schema) || consumesSeparateBoolean(r, n));
  }
  let r = e.slice(1);
  for (let e = 0;e < r.length; e++) {
    let n = t.get(r.charAt(e));
    if (n === undefined)
      return false;
    if (flagExpectsValue(n.schema))
      return e === r.length - 1;
  }
  return false;
}
function levenshtein(e, t) {
  let n = e.length, r = t.length, i = r + 1, a = new Uint16Array(i), o = new Uint16Array(i);
  for (let e = 0;e <= r; e++)
    a[e] = e;
  for (let i = 1;i <= n; i++) {
    o[0] = i;
    for (let n = 1;n <= r; n++) {
      let r = e.charAt(i - 1) === t.charAt(n - 1) ? 0 : 1, s = a[n] ?? 0, c = o[n - 1] ?? 0, l = a[n - 1] ?? 0;
      o[n] = Math.min(s + 1, c + 1, l + r);
    }
    [a, o] = [o, a];
  }
  return a[r] ?? Math.max(n, r);
}
function findClosestCommand(e, t) {
  let n, r = 4;
  for (let i of t) {
    let t = levenshtein(e, i.schema.name);
    t < r && (r = t, n = i.schema.name);
    for (let t of i.schema.aliases) {
      let a = levenshtein(e, t);
      a < r && (r = a, n = i.schema.name);
    }
  }
  return r <= 3 ? n : undefined;
}
function uniqueCommands(e) {
  let t = /* @__PURE__ */ new Set, n = [];
  for (let r of e.values())
    t.has(r) || (t.add(r), n.push(r));
  return n;
}
function readHelpOutputFlags(e, t) {
  let n = [], r = [], i, a, o = false;
  for (let s = 0;s < e.length; s += 1) {
    let c = e[s];
    if (c === undefined)
      continue;
    if (c === `--`) {
      n.push(...e.slice(s)), r.push(...e.slice(s));
      break;
    }
    let l = c.indexOf(`=`), u = c.startsWith(`--`) ? c.slice(2, l < 0 ? undefined : l) : ``, d = l < 0 ? e[s + 1] : c.slice(l + 1);
    u.length === 0 || u !== t.color && u !== t.hyperlinks || d !== `always` && d !== `never` && d !== `auto` ? (n.push(c), r.push(c)) : (u === t.color && (i = d), u === t.hyperlinks && (a = d), n.push(`--${u}=${d}`), l < 0 && (s += 1, o = true));
  }
  return { argv: o ? n : e, fallbackArgv: r, color: i, hyperlinks: a };
}
function spellingIndex(e) {
  let t = /* @__PURE__ */ new Map;
  for (let n of ROOT_OUTPUT_NAMES)
    for (let r of BUILTIN_SPECS[n][e])
      t.set(r, n);
  return t;
}
function coerceRootValue(e, t, n) {
  try {
    return { kind: `flag`, name: e, selection: coerceFlagValue(e, n, rootBooleanSchema, t) === true ? `on` : `off` };
  } catch (t) {
    if (t instanceof ParseError)
      return { kind: `invalid`, name: e, error: t };
    throw t;
  }
}
function ownedName(e, t, n) {
  let r = e.get(t);
  if (r !== undefined && builtinEnabled(n, r))
    return r;
}
function matchRootToken(e, t) {
  let n = ownedName(ROOT_SHORT_SPELLINGS, e, t);
  if (n !== undefined)
    return { kind: `flag`, name: n, selection: `on` };
  let r = ownedName(ROOT_LONG_SPELLINGS, e, t);
  if (r !== undefined)
    return { kind: `flag`, name: r, selection: `on` };
  let i = e.indexOf(`=`);
  if (i === -1)
    return { kind: `unrelated` };
  let a = e.slice(0, i), o = ownedName(ROOT_LONG_SPELLINGS, a, t);
  return o === undefined ? { kind: `unrelated` } : coerceRootValue(o, a, e.slice(i + 1));
}
function readRootOutputFlags(e, t) {
  let n = e.indexOf(`--`), r = n === -1 ? e : e.slice(0, n), i = { json: `absent`, quiet: `absent` }, a = [], o = /* @__PURE__ */ new Set, s = /* @__PURE__ */ new Map, c = false;
  for (let [n, l] of r.entries()) {
    hasArgvBoundary(e, n) && o.add(a.length);
    let r = matchRootToken(l, t);
    r.kind === `unrelated` ? a.push(l) : (c = true, o.add(a.length), r.kind === `invalid` ? (s.delete(r.name), s.set(r.name, r.error)) : (i[r.name] = r.selection, s.delete(r.name)));
  }
  hasArgvBoundary(e, r.length) && o.add(a.length);
  let l = c ? n === -1 ? a : [...a, ...e.slice(n)] : e, u = { json: i.json, quiet: i.quiet, argv: l };
  c && markArgvBoundaries(l, o);
  let d = s.values().next().value;
  return d === undefined ? { kind: `ok`, ...u } : { kind: `failed`, ...u, error: d };
}
function resolveRootJsonMode(e, t) {
  return e.json === `absent` ? t === true : e.json === `on`;
}
function resolveRootVerbosity(e, t) {
  return e.quiet === `on` ? `quiet` : e.quiet === `off` ? `normal` : t;
}
function buildMeta(e, t, n) {
  return { name: e.name, bin: t.binName ?? e.name, version: e.version, command: n };
}
function buildRootCommandMap(e) {
  let t = /* @__PURE__ */ new Map, n = (e, n) => {
    let r = t.get(e);
    if (r !== undefined)
      throw new CLIError(`Duplicate root command route '${e}' (${r.schema.name} and ${n.schema.name})`, { code: `DUPLICATE_COMMAND`, suggest: `Ensure root command names and aliases are unique` });
    t.set(e, n);
  };
  for (let t of e) {
    n(t.schema.name, t);
    for (let e of t.schema.aliases)
      n(e, t);
  }
  return t;
}
function mergeCommandSchema(e, t) {
  let n = collectPropagatedFlagEntries(t);
  if (n.size === 0)
    return e.schema;
  let r = { ...Object.fromEntries(n), ...e.schema.flags };
  return { ...e.schema, flags: r, flagDeclarationOrder: flagOrderOverride(r, [...n.keys(), ...declaredFlagNames(e.schema)]) };
}
function buildCommandExecutionPlan(e) {
  return { command: e.command, mergedSchema: mergeCommandSchema(e.command, e.commandPath), argv: e.argv, meta: e.meta, plugins: e.plugins, output: e.output, help: e.help };
}
function scopeHelpToCommandPath(e, t) {
  let n = t.slice(0, -1).map((e) => e.name);
  return n.length === 0 ? e.help : { ...e.help, binName: [e.help.binName ?? e.schema.name, ...n].join(` `) };
}
function buildPlannerMatchOutcome(e, t, n, r) {
  return { kind: `match`, plan: buildCommandExecutionPlan({ command: t, commandPath: n, argv: r, meta: buildMeta(e.schema, e.help, t.schema.name), plugins: e.compiled.plugins, output: e.output, help: scopeHelpToCommandPath(e, n) }) };
}
function canDelegateUnknownRootToDefault(e, t) {
  return t === `` || e.schema.args.some((e) => acceptsArgv(e.schema));
}
function findUnknownFlagBeforePositional(e, t, n) {
  let r = buildFlagLookup(t, n);
  for (let t = 0;t < e.length; t++) {
    let n = e[t];
    if (n === undefined || n === `--` || n === `-` || !n.startsWith(`-`))
      return;
    if (n.startsWith(`--`)) {
      let i = n.indexOf(`=`), a = n.slice(2, i === -1 ? undefined : i), o = r.get(a);
      if (o === undefined)
        return i === -1 ? n : `--${a}`;
      o.schema.variadic === true ? t += variadicLongValueCount(e, t, r, i !== -1) : i === -1 && (flagExpectsValue(o.schema) || consumesSeparateBoolean(o, adjacentArgvValue(e, t))) && t++;
      continue;
    }
    let i = n.slice(1);
    for (let e = 0;e < i.length; e++) {
      let n = i.charAt(e), a = r.get(n);
      if (a === undefined)
        return `-${n}`;
      if (flagExpectsValue(a.schema)) {
        e === i.length - 1 && t++;
        break;
      }
    }
  }
}
function scanRootHead(e, t, n) {
  for (let r = 0;r < e.length; r++) {
    let i = e[r];
    if (i === undefined)
      continue;
    let a = n ? helpFlagMode(i) : undefined;
    if (a !== undefined)
      return { helpBeforeCommand: a, firstCommandToken: undefined, commandTokenIndex: -1 };
    if (i === `-` || !i.startsWith(`-`))
      return { helpBeforeCommand: undefined, firstCommandToken: i, commandTokenIndex: r };
    if (i.startsWith(`--`)) {
      let n = i.indexOf(`=`), a = i.slice(2, n === -1 ? undefined : n), o = t?.get(a);
      o?.schema.variadic === true && t !== undefined ? r += variadicLongValueCount(e, r, t, n !== -1) : o !== undefined && n === -1 && (flagExpectsValue(o.schema) || consumesSeparateBoolean(o, adjacentArgvValue(e, r))) && r++;
      continue;
    }
    let o = i.slice(1);
    for (let e = 0;e < o.length; e++) {
      let n = t?.get(o.charAt(e));
      if (n !== undefined && flagExpectsValue(n.schema)) {
        e === o.length - 1 && r++;
        break;
      }
    }
  }
  return { helpBeforeCommand: undefined, firstCommandToken: undefined, commandTokenIndex: -1 };
}
function helpHint(e, t) {
  return t ? { suggest: `Run '${e} --help' for available commands` } : {};
}
function planCompletionsFlag(e, t) {
  let n = e.indexOf(`--`), r = n === -1 ? e.length : n;
  for (let n = 0;n < r; n++) {
    let i = e[n];
    if (i === undefined)
      continue;
    let a;
    if (i === `--completions`) {
      let t = n + 1 < r ? e[n + 1] : undefined;
      a = t !== undefined && !t.startsWith(`-`) ? t : undefined;
    } else if (i.startsWith(`--completions=`))
      a = i.slice(14);
    else
      continue;
    if (a === undefined || a === ``)
      return { kind: `root-completions`, shell: undefined, options: t.options };
    let o = normalizeShell(a);
    return o === undefined || !t.shells.includes(o) ? { kind: `dispatch-error`, error: new ParseError(`Unknown shell '${a}'`, { code: `INVALID_VALUE`, suggest: `Valid shells: ${t.shells.join(`, `)}` }) } : { kind: `root-completions`, shell: o, options: t.options };
  }
}
function planInvocation(e) {
  let t = builtinEnabled(e.schema.builtins, `help`), n = readRootOutputFlags(e.argv, e.schema.builtins), r = n.argv, i = r.indexOf(`--`), a = i === -1 ? r : sliceArgvHead(r, i), o = e.compiled.defaultCommand, s = o === undefined ? undefined : buildFlagLookup(o.schema.flags, e.schema.flagSettings);
  if (e.schema.version !== undefined && (includesBeforeSeparator(e.argv, `--version`) || includesBeforeSeparator(e.argv, `-${e.schema.versionAlias ?? `V`}`)))
    return { kind: `root-version`, version: e.schema.version };
  if (e.schema.completionsFlag !== undefined) {
    let t = planCompletionsFlag(e.argv, e.schema.completionsFlag);
    if (t !== undefined)
      return t;
  }
  let c = scanRootHead(a, s, t);
  if (c.helpBeforeCommand !== undefined)
    return { kind: `root-help`, help: c.helpBeforeCommand === `all` ? { ...e.help, showAdvanced: true } : e.help };
  if (t && c.firstCommandToken === `help` && !e.compiled.commands.some((e) => e.schema.name === `help` || e.schema.aliases.includes(`help`))) {
    let t = r.slice(c.commandTokenIndex + 1);
    return t.length === 0 ? { kind: `root-help`, help: e.help } : planInvocation({ ...e, argv: [...t, `--help`] });
  }
  let l = dispatch(r, buildRootCommandMap(o !== undefined && e.schema.defaultCommandRouted ? [...e.compiled.commands, o] : e.compiled.commands), [], s, e.schema.flagSettings), u;
  if (l.kind === `unknown` && o !== undefined && l.parentPath.length === 0) {
    let e = l.input === `.` || l.input === `..` || l.input.includes(`/`) || l.input.includes(`\\`);
    (l.input !== `` && !e ? findClosestCommand(l.input, l.candidates) : undefined) === undefined && canDelegateUnknownRootToDefault(o, l.input) && (u = o);
  }
  let d = (l.kind === `unknown` ? u : l.command)?.schema.helpTopics;
  if (n.kind === `failed` && !(t && requestsHelp(r, d)))
    return { kind: `dispatch-error`, error: n.error };
  if (u !== undefined)
    return buildPlannerMatchOutcome(e, u, [u.schema], r);
  if (e.compiled.commands.length === 0 && o === undefined)
    return { kind: `dispatch-error`, error: new CLIError(`No commands registered`, { code: `NO_ACTION`, suggest: `Add commands via .command() or .default() before calling .run()` }) };
  if (r.length === 0 && o === undefined)
    return { kind: `root-help`, help: e.help };
  switch (l.kind) {
    case `unknown`: {
      if (o !== undefined && l.parentPath.length === 0) {
        let n = findUnknownFlagBeforePositional(r, o.schema.flags, e.schema.flagSettings);
        if (n !== undefined)
          return { kind: `dispatch-error`, error: new ParseError(`Unknown flag ${n}`, { code: `UNKNOWN_FLAG`, ...helpHint(e.schema.name, t) }) };
      }
      if (l.input === ``) {
        let n = r.find((e) => e.startsWith(`-`));
        return n === undefined ? { kind: `root-help`, help: e.help } : { kind: `dispatch-error`, error: new ParseError(`Unknown flag ${n}`, { code: `UNKNOWN_FLAG`, ...helpHint(e.schema.name, t) }) };
      }
      let n = findClosestCommand(l.input, l.candidates), i = l.parentPath.length > 0 ? `${e.schema.name} ${l.parentPath.map((e) => e.name).join(` `)}` : e.schema.name;
      return { kind: `dispatch-error`, error: new ParseError(`Unknown command: ${l.input}`, { code: `UNKNOWN_COMMAND`, ...n === undefined ? helpHint(i, t) : { suggest: `Did you mean '${n}'?` } }) };
    }
    case `needs-subcommand`: {
      let n = t ? requestedHelpMode(l.remainingArgv, l.command.schema.helpTopics) : undefined;
      return typeof n == `object` && !e.output.jsonMode ? buildPlannerMatchOutcome(e, l.command, l.commandPath, l.remainingArgv) : { kind: `needs-subcommand`, command: l.command, commandPath: l.commandPath, help: { ...scopeHelpToCommandPath(e, l.commandPath), ...n === `all` ? { showAdvanced: true } : {} } };
    }
    case `match`:
      return buildPlannerMatchOutcome(e, l.command, l.commandPath, l.remainingArgv);
  }
}
function isPlannedHelp(e, t) {
  return e.kind === `root-help` || e.kind === `needs-subcommand` || e.kind === `match` && builtinEnabled(t, `help`) && requestsHelp(e.plan.argv, e.plan.mergedSchema.helpTopics);
}
function planInvocationWithHelpOutput(e, t) {
  let { argv: n, schema: r } = e, i = t !== undefined && builtinEnabled(r.builtins, `help`) ? readHelpOutputFlags(n, t) : undefined, a = i !== undefined && i.argv !== n && n.some((e) => e === `-h` || e === `help` || e === `--help` || e.startsWith(`--help=`)) ? i.argv : n, o = planInvocation({ ...e, argv: a });
  return { plan: a !== n && !isPlannedHelp(o, r.builtins) ? planInvocation(e) : o, helpOutput: i };
}
function releaseRemedy(e, ...t) {
  return [RENAME, ...t, `release the built-in with .builtins({ ${e}: 'off' }) before registering the command`].join(`, or `);
}
function reservedTokens(e, t, n, r) {
  let i = /* @__PURE__ */ new Map;
  for (let e of BUILTIN_NAMES) {
    if (!builtinEnabled(t, e))
      continue;
    let n = { rootSpelling: builtinSpelling(e), effect: BUILTIN_EFFECTS[e], remedy: BUILTIN_REMEDIES[e] };
    for (let t of builtinTokens(e))
      i.set(t, n);
  }
  if (e !== undefined) {
    if (!/^[a-z]$/iu.test(r))
      throw new CLIError(`Version alias must be one ASCII letter`, { code: `INVALID_SCHEMA` });
    if (i.has(r))
      throw new CLIError(`Version alias -${r} conflicts with a built-in flag`, { code: `RESERVED_FLAG` });
    i.set(`version`, VERSION_RESERVED), i.set(r, VERSION_RESERVED);
  }
  return n && i.set(`no-config`, { rootSpelling: `--no-config`, effect: STRIPPED, remedy: RENAME }), i;
}
function spellingOf(e) {
  return e.length === 1 ? `-${e}` : `--${e}`;
}
function flagSpellings(e, t) {
  let n = [[e, `name`]];
  for (let e of getFlagAliasNames(t, { includeHidden: true }))
    n.push([e, `alias`]);
  let r = getFlagNegatedName(e, t);
  return r !== undefined && n.push([r, `negation`]), n;
}
function findReservedCollision(e, t, n) {
  for (let [n, r] of Object.entries(e.flags))
    if (acceptsArgv(r))
      for (let [i, a] of flagSpellings(n, r)) {
        let r = t.get(i);
        if (r !== undefined)
          return { commandName: e.name, flagName: n, spelling: spellingOf(i), origin: a, reserved: r };
      }
  let r = t.get(`no-config`);
  if (r !== undefined && n?.caseParity !== false) {
    let t = buildFlagLookup(e.flags, n).get(`no-config`);
    if (t?.parity === true)
      return { commandName: e.name, flagName: t.name, spelling: `--no-config`, origin: `parity`, reserved: r };
  }
  for (let r of e.commands) {
    let e = findReservedCollision(r, t, n);
    if (e !== undefined)
      return e;
  }
}
function subjectOf(e) {
  switch (e.origin) {
    case `name`:
      return `defines a '${e.spelling}' flag`;
    case `alias`:
      return `defines a '${e.spelling}' alias on flag '${e.flagName}'`;
    case `negation`:
      return `defines a '${e.spelling}' negated spelling on flag '${e.flagName}'`;
    case `parity`:
      return `accepts '${e.spelling}' as a case-parity spelling of flag '${e.flagName}'`;
  }
}
function reservedFlagError(e) {
  return new CLIError(`Command '${e.commandName}' ${subjectOf(e)}, which is reserved by the root '${e.reserved.rootSpelling}' flag. ${e.reserved.effect}, so the command can never receive it`, { code: `RESERVED_FLAG`, details: { command: e.commandName, flag: e.flagName }, suggest: e.reserved.remedy });
}
function assertNoReservedFlagCollisions(e, t, n, r = false, i, a = `V`) {
  let o = reservedTokens(e, n, r, a);
  for (let e of t) {
    if (e === undefined)
      continue;
    let t = findReservedCollision(e, o, i);
    if (t !== undefined)
      throw reservedFlagError(t);
  }
}
function resolveRootSurface(e) {
  let t = e.commands.filter((e) => !e.hidden), n = e.defaultCommand, r = n !== undefined && !n.hidden ? n : undefined, i = r === undefined ? t : t.filter((e) => e.name !== r.name);
  return { visibleCommands: t, visibleSubcommands: i, visibleDefaultCommand: r, hasVisibleDefault: r !== undefined, hasVisibleSubcommands: i.length > 0, defaultRouted: r !== undefined && e.defaultCommandRouted === true };
}
function formatRootHelp(e, t) {
  let n = t?.width ?? 80, r = t?.binName ?? e.name, i = t?.hyperlinks === true, a = t?.inlineDefault ?? true, o = t?.showDefaultInCommands ?? false, s = resolveHelpTheme(t?.colors, t?.theme), c = resolveRootSurface(e), l = c.visibleDefaultCommand, u = !c.hasVisibleSubcommands && e.completionsFlag === undefined, d = a || u || t?.showAdvanced === true ? l : undefined, f = resolveSurfaceCommand(e, d), p = f !== undefined, m = [formatProgramHeader(e, i, s)];
  e.description !== undefined && m.push(e.description);
  let h = c.hasVisibleSubcommands ? l === undefined ? `<command>` : `[command]` : ``, g = s.sectionTitle(`Usage:`), _ = h.length > 0 ? `${g} ${s.usageBin(r)} ${s.placeholder(h)} ${s.placeholder(`[options]`)}` : `${g} ${s.usageBin(r)} ${s.placeholder(`[options]`)}`, v = [];
  p && f !== undefined && (v = [...formatHelpSections(f, { ...t, binName: r, isDefaultHelp: true })]);
  let y = v.shift();
  p && y !== undefined && d !== undefined ? m.push(c.hasVisibleSubcommands ? mergeUsageSections(_, y, g) : y) : m.push(_);
  let b = l !== undefined && (c.defaultRouted || o), x = b ? [...c.visibleSubcommands, l] : c.visibleSubcommands;
  x.length > 0 && m.push(formatRootCommandsSection(x, b ? l?.name : undefined, n, s)), p && f !== undefined && (f.description !== undefined && f.description === e.description && v[0] === f.description && v.shift(), m.push(...v));
  let S = formatGlobalOptionsSection(e, n, s);
  if (S.length > 0 && m.push(S), builtinEnabled(e.builtins, `help`) && (t?.footer ?? c.hasVisibleSubcommands)) {
    let e = c.hasVisibleSubcommands ? l === undefined ? ` <command>` : ` [command]` : ``;
    m.push(`Run '${r}${e} --help' for more information.`);
  }
  return `${m.join(`

`)}
`;
}
function resolveSurfaceCommand(e, t) {
  if (e.completionsFlag === undefined)
    return t;
  let n = t ?? command(e.name).schema, r = { completions: completionsFlagSchema(e.completionsFlag.shells), ...n.flags };
  return { ...n, flags: r, flagDeclarationOrder: flagOrderOverride(r, [`completions`, ...declaredFlagNames(n)]) };
}
function completionsFlagSchema(e) {
  return createFlagSchema(`enum`, { description: `Print a shell completion script and exit`, enumValues: e });
}
function formatRootCommandsSection(e, t, n, r) {
  let i = [r.sectionTitle(`Commands:`)], a = 0;
  for (let n of e) {
    let e = n.name === t ? 10 : 0, r = n.name.length + e;
    r > a && (a = r);
  }
  let o = 2 + a + 2;
  for (let a of e) {
    let e = padEnd(`  ${a.name === t ? `${r.command(a.name)}${r.annotation(` (default)`)}` : r.command(a.name)}`, o), s = a.description ?? ``;
    s.length === 0 ? i.push(e.trimEnd()) : i.push(`${e}${wrapText(s, n, o)}`);
  }
  return i.join(`
`);
}
function formatGlobalOptionsSection(e, t, n) {
  let r = [], i = (t) => {
    builtinEnabled(e.builtins, t) && r.push({ left: n.flag(builtinFlagForms(t)), description: BUILTIN_SPECS[t].description });
  };
  for (let t of BUILTIN_NAMES)
    i(t), t === `help` && e.version !== undefined && r.push({ left: n.flag(`-${e.versionAlias ?? `V`}, --version`), description: `Print the version number and exit` });
  return e.configSettings !== undefined && r.push({ left: `${n.flag(`--config`)} ${n.placeholder(`<path>`)}`, description: `Load configuration from the given file` }), e.configSettings?.noConfigFlag === true && r.push({ left: n.flag(`--no-config`), description: `Skip configuration file discovery` }), r.length === 0 ? `` : formatFlagEntriesBlock(n.sectionTitle(`Global options:`), r, t);
}
function mergeUsageSections(e, t, n) {
  let r = `${n} `, i = t.startsWith(r) ? t.slice(r.length) : t;
  return `${e}
${` `.repeat(7)}${i}`;
}
function extractConfigFlag(e, t = false) {
  let n = [], r = /* @__PURE__ */ new Set, i, a = false;
  for (let o = 0;o < e.length; o += 1) {
    hasArgvBoundary(e, o) && r.add(n.length);
    let s = e[o];
    if (s !== undefined) {
      if (s === `--`) {
        n.push(...e.slice(o));
        break;
      }
      if (t && s === `--no-config`)
        r.add(n.length), a = true;
      else if (i === undefined && s.startsWith(`--config=`)) {
        let e = s.slice(9);
        if (e.length > 0) {
          i = e, r.add(n.length);
          continue;
        }
        n.push(s);
      } else if (i === undefined && s === `--config`) {
        let t = e[o + 1];
        if (t !== undefined && !t.startsWith(`-`) && t !== `--`) {
          i = t, r.add(n.length), o += 1;
          continue;
        }
        n.push(s);
      } else
        n.push(s);
    }
  }
  return hasArgvBoundary(e, e.length) && r.add(n.length), markArgvBoundaries(n, r), { configPath: i, filteredArgv: n, ...a ? { skipDiscovery: true } : {}, ...a && i !== undefined ? { error: new ParseError(`Cannot use --config with --no-config`, { code: `INVALID_VALUE` }) } : {} };
}
function commandInvocationNeedsStdin(e, t, n, r) {
  if (builtinEnabled(r, `help`) && requestsHelp(t, e.helpTopics))
    return false;
  try {
    let r = parse(e, t, n);
    return invocationSelectsStdin(e.flags, e.args, r);
  } catch (e) {
    if (e instanceof ParseError)
      return false;
    throw e;
  }
}
function invocationNeedsStdin(e, t, n) {
  let r = planInvocation({ schema: e, compiled: t, argv: n, help: { binName: e.name }, output: PRECHECK_OUTPUT });
  switch (r.kind) {
    case `match`:
      return commandInvocationNeedsStdin(r.plan.mergedSchema, r.plan.argv, e.flagSettings, e.builtins);
    case `dispatch-error`:
    case `needs-subcommand`:
    case `root-help`:
    case `root-version`:
    case `root-completions`:
      return false;
  }
}
function isCompletionsInvocation(e, t, n) {
  if (!e.hasBuiltInCompletions)
    return false;
  let r = planInvocation({ schema: e, compiled: t, argv: n, help: { binName: e.name }, output: PRECHECK_OUTPUT });
  return r.kind === `root-completions` || r.kind === `match` && r.plan.command.schema.name === `completions`;
}
async function discoverManifestData(e, t) {
  let { discoverManifest: n } = await Promise.resolve().then(() => (init_package_json_hqUWeazy(), {})).then((e) => package_json_exports);
  return n(e, { ...t.from === undefined ? {} : { startDir: t.from }, files: t.files });
}
async function inferManifestCliName(e, t) {
  let { inferCliName: n } = await Promise.resolve().then(() => (init_package_json_hqUWeazy(), {})).then((e) => package_json_exports);
  return n(e, { stripScope: t });
}
async function applyPackageJsonDiscovery(e, t, n, r) {
  let i = e.packageJsonSettings, a = i !== undefined && !r ? await (async () => {
    let n = i.data ?? await discoverManifestData(t, i);
    if (n === null)
      return e;
    let r = i.inferName ? await inferManifestCliName(n, i.stripScope) : undefined;
    return { ...e, ...e.version === undefined && n.version !== undefined ? { version: n.version } : {}, ...e.description === undefined && n.description !== undefined ? { description: n.description } : {}, ...r === undefined ? {} : { name: r }, helpLinks: deriveHelpLinks(e.helpLinks, n, e.version ?? n.version) };
  })() : e;
  return n === undefined ? a : { ...a, name: n };
}
function runtimeReservedFlagCollision(e, t, n, r) {
  let i = e.configSettings?.noConfigFlag === true, a = i && t.flagSettings?.caseParity === false && r?.caseParity !== false;
  if (e.version !== t.version || a)
    try {
      assertNoReservedFlagCollisions(e.version, [n.defaultCommand?.schema, ...n.commands.map((e) => e.schema)], e.builtins, i, r, e.versionAlias);
      return;
    } catch (e) {
      if (e instanceof CLIError)
        return e;
      throw e;
    }
}
async function loadRuntimeConfig(e, t, n, r, i) {
  if (e.configSettings === undefined || r || i !== undefined)
    return i;
  try {
    let { discoverConfig: r } = await Promise.resolve().then(() => (init_config_4N4Lsyr8(), {})).then((e) => config_exports), i = await r(e.configSettings.appName, t, { ...n === undefined ? {} : { configPath: n }, ...e.configSettings.loaders === undefined ? {} : { loaders: e.configSettings.loaders } });
    return i.found ? i.data : undefined;
  } catch (e) {
    if (e instanceof CLIError)
      return e;
    throw e;
  }
}
function createLazyTerminalPrompter(e) {
  let t;
  return { async promptOne(n) {
    return t ??= Promise.resolve().then(() => (init_terminal_C8qksD05(), {})).then((e) => terminal_exports).then(({ createTerminalPrompter: t }) => t(e.stdin, e.stderr, e.readSecret === undefined ? {} : { readSecret: e.readSecret })), (await t).promptOne(n);
  } };
}
async function prepareRuntimePreflight(e) {
  let t = e.adapter.argv.slice(2), { configPath: n, filteredArgv: r, skipDiscovery: i, error: a } = e.schema.configSettings === undefined ? { configPath: undefined, filteredArgv: t, skipDiscovery: undefined, error: undefined } : extractConfigFlag(t, e.schema.configSettings.noConfigFlag), o = readRootOutputFlags(r, e.schema.builtins), s = resolveRootJsonMode(o, e.options?.jsonMode);
  if (a !== undefined)
    return { kind: `startup-error`, error: a, jsonMode: s };
  let c = resolveRootVerbosity(o, e.options?.verbosity) ?? `normal`, l = isCompletionsInvocation(e.schema, e.compiled, r), u = await applyPackageJsonDiscovery(e.schema, e.adapter, e.inheritedName, l), d = runtimeReservedFlagCollision(u, e.schema, e.compiled, e.options?.flags ?? e.schema.flagSettings);
  if (d !== undefined)
    return { kind: `startup-error`, error: d, jsonMode: s };
  let f = u.configSettings !== undefined && isPlannedHelp(planInvocationWithHelpOutput({ schema: { ...u, flagSettings: e.options?.flags ?? u.flagSettings }, compiled: e.compiled, argv: r, help: { binName: u.name }, output: PRECHECK_OUTPUT }, u.helpConfig?.outputFlags).plan, u.builtins), p = i || f ? e.options?.config : await loadRuntimeConfig(u, e.adapter, n, l, e.options?.config);
  if (p instanceof CLIError)
    return { kind: `startup-error`, error: p, jsonMode: s };
  let m = e.options?.prompter === undefined && e.options?.answers === undefined && e.adapter.stdinIsTTY ? createLazyTerminalPrompter(e.adapter) : undefined, h = e.options?.stdinData === undefined && invocationNeedsStdin(u, e.compiled, r) ? await e.adapter.readStdin() : e.options?.stdinData;
  return { kind: `ready`, schema: u, filteredArgv: r, inputs: { env: e.options?.env ?? e.adapter.env, isTTY: e.options?.isTTY ?? e.adapter.isTTY, jsonMode: s, verbosity: c, stat: e.options?.stat ?? e.adapter.stat, mkdir: e.options?.mkdir ?? e.adapter.mkdir, ...h === undefined ? {} : { stdinData: h }, ...e.options?.prompter === undefined ? m === undefined ? {} : { prompter: m } : { prompter: e.options.prompter }, ...p === undefined ? {} : { config: p } } };
}
function commandReservesCompletionsFlag(e) {
  for (let [t, n] of Object.entries(e.flags))
    if (acceptsArgv(n) && (t === COMPLETIONS_FLAG_NAME || getFlagAliasNames(n, { kind: `long`, includeHidden: true }).includes(COMPLETIONS_FLAG_NAME) || getFlagNegatedName(t, n) === COMPLETIONS_FLAG_NAME))
      return true;
  return e.commands.some(commandReservesCompletionsFlag);
}
function assertNoCompletionsFlagCollision(e) {
  if (commandReservesCompletionsFlag(e))
    throw new CLIError(`Command '${e.name}' defines a '--${COMPLETIONS_FLAG_NAME}' flag, which is reserved by .completions({ as: 'flag' })`, { code: `RESERVED_FLAG`, suggest: `Rename the flag, or register completions as a subcommand with .completions() instead of { as: 'flag' }` });
}
function assertNoTopLevelRouteConflict(e, t, n) {
  if (commandRoutes(t).includes(`__complete`))
    throw new CLIError(`Command route '__complete' is reserved for value completion`, { code: `INVALID_SCHEMA` });
  let r = /* @__PURE__ */ new Map, i = n === undefined ? e : [...e, n];
  for (let e of i)
    for (let t of commandRoutes(e))
      assertNoSiblingRouteConflict(`root`, r, t, e.name);
  for (let e of commandRoutes(t)) {
    let n = r.get(e);
    if (n !== undefined)
      throw new CLIError(`Command route '${e}' is already registered by '${n}'`, { code: `DUPLICATE_COMMAND`, suggest: n === t.name ? `Ensure command '${t.name}' does not reuse route '${e}'` : `Rename '${t.name}' or remove route '${e}' from '${n}'` });
    r.set(e, t.name);
  }
}
function compiledStateOf(e) {
  let t = compiledStates.get(e);
  if (t === undefined)
    throw new CLIError(`CLI builder carries no compiled command graph`, { code: `INVALID_BUILDER_STATE`, suggest: `Create CLI builders with cli()` });
  return t;
}
function rebuild(e, t) {
  return CLIBuilder._from(t, compiledStateOf(e));
}
function completionGeneratorOptions(e) {
  if (e !== undefined)
    return { ...e.functionPrefix === undefined ? {} : { functionPrefix: e.functionPrefix }, ...e.rootMode === undefined ? {} : { rootMode: e.rootMode } };
}
function isConfigLoaderList(e) {
  return Array.isArray(e);
}
function sealCLISchema(e) {
  return e;
}
function buildCLISchema(e) {
  let t = e.configSettings;
  return sealCLISchema({ name: e.name, inheritName: e.inheritName ?? false, version: e.version, versionAlias: e.versionAlias, description: e.description, commands: (e.commands ?? []).map((e) => createCommandSchema(e)), defaultCommand: e.defaultCommand === undefined ? undefined : createCommandSchema(e.defaultCommand), defaultCommandRouted: e.defaultCommandRouted ?? false, configSettings: t === undefined ? undefined : { appName: t.appName, loaders: t.loaders, ...t.noConfigFlag === true ? { noConfigFlag: true } : {} }, packageJsonSettings: e.packageJsonSettings, helpLinks: e.helpLinks, hasBuiltInCompletions: e.hasBuiltInCompletions ?? false, completionsFlag: e.completionsFlag, helpConfig: e.helpConfig, flagSettings: e.flagSettings, builtins: normalizeBuiltins(e.builtins), envPrefix: e.envPrefix === undefined ? undefined : normalizeEnvPrefix(e.envPrefix) });
}
function createCLISchema(e) {
  if (e.name === ``)
    throw new CLIError(`CLI schema requires a non-empty name`, { code: `INVALID_SCHEMA`, details: { name: e.name }, suggest: `Pass a program name such as { name: "mycli" }` });
  let t = buildCLISchema(e), n = [];
  for (let e of t.commands)
    assertNoTopLevelRouteConflict(n, e), n.push(e);
  let r = e.defaultCommand !== undefined && e.commands?.includes(e.defaultCommand) === true;
  t.defaultCommand !== undefined && !r && assertNoTopLevelRouteConflict(n, t.defaultCommand);
  let i = [t.defaultCommand, ...t.commands];
  if (assertNoReservedFlagCollisions(t.version, i, t.builtins, t.configSettings?.noConfigFlag, t.flagSettings, t.versionAlias), t.completionsFlag !== undefined)
    for (let e of i)
      e !== undefined && assertNoCompletionsFlagCollision(e);
  return t;
}
function hyperlinksOption(e) {
  return e === undefined ? {} : { hyperlinks: e };
}
function resolveEffectiveHyperlinkOverride(e, t, n, r) {
  return e?.hyperlinks ?? t?.hyperlinks ?? resolveHyperlinkOverride(n, r);
}
function buildCommandRunOptions(e, t, n) {
  return { help: t, ...n === undefined ? {} : { meta: n }, ...e?.plugins === undefined ? {} : { plugins: e.plugins }, ...e?.builtins === undefined ? {} : { builtins: e.builtins }, ...e?.env === undefined ? {} : { env: e.env }, ...e?.config === undefined ? {} : { config: e.config }, ...e?.stdinData === undefined ? {} : { stdinData: e.stdinData }, ...e?.prompter === undefined ? {} : { prompter: e.prompter }, ...e?.answers === undefined ? {} : { answers: e.answers }, ...e?.stat === undefined ? {} : { stat: e.stat }, ...e?.mkdir === undefined ? {} : { mkdir: e.mkdir }, ...e?.pathChecks === undefined ? {} : { pathChecks: e.pathChecks }, ...e?.envPrefix === undefined ? {} : { envPrefix: e.envPrefix }, ...e?.verbosity === undefined ? {} : { verbosity: e.verbosity }, ...e?.jsonMode === undefined ? {} : { jsonMode: e.jsonMode }, ...e?.isTTY === undefined ? {} : { isTTY: e.isTTY }, ...e?.color === undefined ? {} : { color: e.color }, ...e?.out === undefined ? {} : { out: e.out }, ...e?.captured === undefined ? {} : { captured: e.captured }, ...e?.flags === undefined ? {} : { flags: e.flags } };
}
async function executeCLI(e, t, n) {
  if (t[0] === `__complete`) {
    await Promise.resolve().then(() => init_dynamic_DSu5__LH());
    let i = await completeRequest(n?.flags === undefined ? e.schema : { ...e.schema, flagSettings: n.flags }, compiledStateOf(e), t.slice(1), n?.env ?? {}), a = n?.captured ?? { stdout: [], stderr: [], activity: [] };
    for (let e of i.candidates)
      n?.out === undefined ? a.stdout.push(`${e}
`) : n.out.log(e);
    return buildRunResult({ exitCode: i.exitCode, error: undefined }, a);
  }
  let r = readRootOutputFlags(t, e.schema.builtins), i = resolveRootJsonMode(r, n?.jsonMode), a = resolveRootVerbosity(r, n?.verbosity), o = resolveEffectiveHyperlinkOverride(n?.help, e.schema.helpConfig, n?.env ?? {}, t), s = { color: resolveExecutionColor({ ...n, jsonMode: i }), ...a === undefined ? {} : { verbosity: a }, ...i ? { jsonMode: i } : {}, ...n?.isTTY === undefined ? {} : { isTTY: n.isTTY }, ...n?.terminalSize === undefined ? {} : { terminalSize: n.terminalSize }, ...hyperlinksOption(o) }, c, l;
  n?.out === undefined ? [c, l] = createCaptureOutput(Object.keys(s).length > 0 ? s : undefined) : (c = n.out, l = n.captured ?? { stdout: [], stderr: [], activity: [] }), clearRequestedExitCode(c);
  let u = n?.help?.version ?? e.schema.version, d = n?.envPrefix ?? e.schema.envPrefix, f = n?.flags ?? e.schema.flagSettings, p = n?.help?.width ?? e.schema.helpConfig?.width ?? c.terminalSize?.columns, m = { ...e.schema.helpConfig, ...n?.help, ...p === undefined ? {} : { width: p }, ...d === undefined ? {} : { envPrefix: d }, ...f?.caseParity === undefined ? {} : { caseParity: f.caseParity }, binName: n?.help?.binName ?? e.schema.name, hyperlinks: c.isHyperlinkSupported, colors: n?.help?.colors ?? c.color, ...u === undefined ? {} : { version: u } }, h = compiledStateOf(e), g = { ...n, ...d === undefined ? {} : { envPrefix: d }, plugins: h.plugins, builtins: e.schema.builtins, ...i ? { jsonMode: i } : {}, ...a === undefined ? {} : { verbosity: a }, ...f === undefined ? {} : { flags: f } }, _ = { jsonMode: i, isTTY: c.isTTY, verbosity: a ?? `normal` }, v = n?.flags === undefined ? e.schema : { ...e.schema, flagSettings: f }, y = e.schema.helpConfig, { plan: b, helpOutput: x } = planInvocationWithHelpOutput({ schema: v, compiled: h, argv: t, help: m, output: _ }, y?.outputFlags), S = (r, i = false) => {
    let a = x?.color, o = x?.hyperlinks, s = o === `auto` ? resolveEffectiveHyperlinkOverride(n?.help, y, n?.env ?? {}, x?.fallbackArgv ?? t) ?? c.isTTY : o === undefined ? r.hyperlinks === true : o === `always`;
    return { ...r, ...a === `always` || a === `never` ? { colors: O(a === `always`) } : {}, hyperlinks: s, ...i && y?.commandHeader === true ? { programHeader: resolveHelpLinksSchema(e.schema) } : {} };
  };
  switch (b.kind) {
    case `root-version`:
      return c.log(b.version), buildRunResult({ exitCode: 0, error: undefined }, l);
    case `root-completions`: {
      let t = b.shell ?? detectShell(n?.env ?? {});
      if (t === undefined) {
        let e = new CLIError(`Could not detect shell`, { code: `MISSING_VALUE`, suggest: `Pass one explicitly, e.g. '${m.binName} --completions zsh'` });
        return i ? c.json({ error: e.toJSON() }) : (c.error(e.message), c.error(`Suggestion: ${e.suggest}`)), buildRunResult({ exitCode: e.exitCode, error: e }, l);
      }
      let r = m.binName === undefined || m.binName === e.schema.name ? e.schema : { ...e.schema, name: m.binName }, { generateCompletion: a } = await Promise.resolve().then(() => (init_completion_D_kRNOTC(), {})).then((e) => completion_exports), o = a(r, t, b.options);
      return i ? c.json({ shell: t, script: o }) : c.log(o), buildRunResult({ exitCode: 0, error: undefined }, l);
    }
    case `root-help`:
      if (i) {
        let { generateSchema: t } = await Promise.resolve().then(() => (init_json_schema_DP4L_jL_(), {})).then((e) => json_schema_exports);
        c.json(t(e.schema, { envPrefix: d, groupOrder: b.help.groupOrder }, { name: b.help.binName ?? e.schema.name, version: b.help.version ?? e.schema.version }));
      } else {
        let t = formatRootHelp(resolveHelpLinksSchema(e.schema), S(b.help));
        c.log(t);
      }
      return buildRunResult({ exitCode: 0, error: undefined }, l);
    case `dispatch-error`:
      return i ? c.json({ error: b.error.toJSON() }) : (c.error(b.error.message), b.error.suggest !== undefined && b.error.code !== `NO_ACTION` && c.error(`Suggestion: ${b.error.suggest}`)), buildRunResult({ exitCode: b.error.exitCode, error: b.error }, l);
    case `needs-subcommand`:
      if (i) {
        let { generateCommandSchema: e } = await Promise.resolve().then(() => (init_json_schema_DP4L_jL_(), {})).then((e) => json_schema_exports);
        c.json(e(b.command.schema, { envPrefix: d, groupOrder: b.help.groupOrder }, { name: b.help.binName ?? b.command.schema.name, version: b.help.version }));
      } else {
        let e = formatHelp(b.command.schema, S(b.help, true));
        c.log(e);
      }
      return buildRunResult({ exitCode: 0, error: undefined }, l);
    case `match`: {
      completionCommands.has(b.plan.command.schema) && completionSchemas.set(b.plan.meta, e.schema);
      let t = b.plan.help ?? m, n = buildCommandRunOptions(g, !i && !c.jsonMode && isPlannedHelp(b, v.builtins) ? S(t, true) : t, b.plan.meta);
      return buildRunResult(await executeCommand({ command: { handler: b.plan.command.handler, steps: b.plan.command.steps }, argv: b.plan.argv, out: c, schema: b.plan.mergedSchema, meta: b.plan.meta, options: n }), l);
    }
  }
}
function basename(e) {
  let t = stripTrailing(e, [47, 92]);
  if (t.length === 0)
    return;
  let n = Math.max(t.lastIndexOf(`/`), t.lastIndexOf(`\\`)), r = n >= 0 ? t.slice(n + 1) : t;
  return r.length > 0 ? r : undefined;
}
function isRuntimeBinaryName(e) {
  let t = e.toLowerCase().replace(/\.exe$/i, ``);
  return RUNTIME_BINARIES.has(t);
}
function inferInvocationName(e) {
  let t = e[0], n = e[1], r = t === undefined ? undefined : basename(t);
  if (r !== undefined && isRuntimeBinaryName(r)) {
    if (r === `bun` && n === `run`) {
      let t = e[2];
      return t === undefined || t.startsWith(`-`) ? undefined : basename(t);
    }
    return r === `deno` && n === `run` || n === undefined || n.startsWith(`-`) ? undefined : basename(n);
  }
  return t === undefined ? undefined : basename(t);
}
function toUrlString(e) {
  if (e !== undefined)
    return e instanceof URL ? e.href : e;
}
function resolveHelpLinksSchema(e) {
  return e.helpLinks === undefined ? e : { ...e, helpLinks: deriveHelpLinks(e.helpLinks, e.packageJsonSettings?.data, e.version) };
}
function normalizeInferName(e) {
  return e === undefined || e === false ? { inferName: false, stripScope: true } : e === true ? { inferName: true, stripScope: true } : { inferName: true, stripScope: e.scope !== `keep` };
}
function buildManifestSchema(e, t, n) {
  if (isPackageJsonData(t))
    return { ...e, ...e.version === undefined && t.version !== undefined ? { version: t.version } : {}, ...e.description === undefined && t.description !== undefined ? { description: t.description } : {}, packageJsonSettings: { inferName: false, stripScope: true, from: undefined, files: n, data: t } };
  let { inferName: r, stripScope: i } = normalizeInferName(t?.inferName), a = t?.files ?? n;
  return { ...e, packageJsonSettings: { inferName: r, stripScope: i, from: normalizeFromSetting(t?.from), files: a, data: undefined } };
}
function normalizeFromSetting(e) {
  if (e === undefined)
    return;
  let t = typeof e == `object` && !(e instanceof URL) ? e.url : e;
  if (t instanceof URL) {
    if (t.protocol !== `file:`)
      return t.href;
  } else if (!t.startsWith(`file:`))
    return t;
  let n = decodeURIComponent(new URL(t).pathname);
  return /^\/[A-Za-z]:/.test(n) ? n.slice(1).replace(/\//g, `\\`) : n;
}
function isPackageJsonData(e) {
  return typeof e != `object` || !e || Array.isArray(e) ? false : (`name` in e) || (`version` in e) || (`description` in e) || (`bin` in e) || (`homepage` in e) || (`repository` in e);
}
function cli(e, t) {
  let n = typeof e == `string` ? { name: e, ...t } : e, r = n.name ?? `cli`, i = n.inherit ?? false;
  return CLIBuilder._from(createCLISchema({ name: r, inheritName: i, flagSettings: n.flags }), { commands: [], defaultCommand: undefined, plugins: [] });
}
async function prepareTextAnswer(e, t) {
  let n = e.kind === `input` && e.trim !== false ? t.trim() : t;
  if (n === ``) {
    if (e.kind === `input` && e.default !== undefined)
      return { ok: true, value: e.default };
    if ((e.empty ?? (e.kind === `password` ? `retry` : `skip`)) === `retry`)
      return { ok: false, message: `Please enter a value.`, reason: `empty` };
    if (e.kind === `input` && (e.empty ?? `skip`) === `skip`)
      return { ok: true, value: n };
  }
  let r = await e.validate?.(n);
  return r === undefined || r === true ? { ok: true, value: n } : { ok: false, message: r, reason: `validation` };
}
var SHELLS, OMIT, CLIError, ParseError, ValidationError, BUILTIN_SPECS, BUILTIN_NAMES, DEFAULT_BUILTINS, ISO_DATE_PATTERN, DURATION_UNITS, BYTE_UNITS, STRING_TYPE_FAILURE, NUMBER_TYPE_FAILURE, BOOLEAN_TYPE_FAILURE, stringCodec, strictStringCodec, numberCodec, booleanCodec, passthroughCodec, WHOLE, LINES, ENV_DEFAULT, NAMED_SPLIT_POLICIES, ALLOWED_SPLIT_FORMATS, DUPLICATE_KEYS, ONE, COUNT, VOWEL_INITIAL, ENV_INDEX_PLACEHOLDER = `{index}`, STDIN_WHENS, STDIN_CONSUMES, DEFAULT_STDIN_BINDING, FLAG_KINDS, NORMALIZED_FLAG_SCHEMA_KEYS, STDIN_CAPABLE_FLAG_KINDS, COLLECTION_FLAG_KINDS, KIND_SPECIFIC_FLAG_FIELDS, FlagBuilder = class e {
  schema;
  constructor(e) {
    this.schema = e;
  }
  complete(t) {
    return new e({ ...this.schema, completion: t });
  }
  default(t, n) {
    let r = { ...this.schema, presence: `defaulted`, defaultValue: t, defaultDescription: n?.description };
    return assertValidFlagDefault(undefined, r), new e(r);
  }
  required() {
    return new e({ ...this.schema, presence: `required` });
  }
  sensitive(t = true) {
    return new e({ ...this.schema, sensitive: t || this.schema.prompt?.kind === `password` || this.schema.prompt?.sensitive === true });
  }
  alias(t, n) {
    return new e({ ...this.schema, aliases: [...this.schema.aliases, { name: t, hidden: n?.hidden ?? false }] });
  }
  env(t, n) {
    return typeof t == `string` ? new e({ ...this.schema, envVar: t, envIndexed: undefined, envFromName: false, envAbsolute: n?.absolute === true }) : isIndexedEnvBinding(t) ? nextFlag({ ...this.schema, envVar: undefined, envIndexed: normalizeIndexedEnvBinding(t), envFromName: false, envAbsolute: n?.absolute === true }) : new e({ ...this.schema, envVar: undefined, envIndexed: undefined, envFromName: true, envAbsolute: t?.absolute === true });
  }
  stdin(t) {
    return assertStdinCapableKind(this.schema.kind), new e({ ...this.schema, stdin: normalizeStdinBinding(t) });
  }
  config(t) {
    return new e({ ...this.schema, configPath: t });
  }
  describe(t) {
    return new e({ ...this.schema, description: t });
  }
  group(t) {
    return new e({ ...this.schema, group: t });
  }
  advanced() {
    return new e({ ...this.schema, advanced: true });
  }
  prompt(t) {
    return new e({ ...this.schema, prompt: t, sensitive: this.schema.sensitive || t.kind === `password` || t.sensitive === true });
  }
  deprecated(t) {
    return new e({ ...this.schema, deprecated: t ?? true });
  }
  propagate() {
    return new e({ ...this.schema, propagate: true });
  }
  int(e = true) {
    return nextFlag({ ...this.schema, numberConstraints: { ...this.schema.numberConstraints, int: e } });
  }
  min(e) {
    let t = { ...this.schema.numberConstraints, min: e };
    return assertNumberConstraints(t), nextFlag({ ...this.schema, numberConstraints: t });
  }
  max(e) {
    let t = { ...this.schema.numberConstraints, max: e };
    return assertNumberConstraints(t), nextFlag({ ...this.schema, numberConstraints: t });
  }
  finite(e = true) {
    return nextFlag({ ...this.schema, numberConstraints: { ...this.schema.numberConstraints, finite: e } });
  }
  nonEmpty(e = true) {
    return nextFlag({ ...this.schema, stringConstraints: { ...this.schema.stringConstraints, nonEmpty: e } });
  }
  minLength(e) {
    let t = { ...this.schema.stringConstraints, minLength: e };
    return assertStringConstraints(t), nextFlag({ ...this.schema, stringConstraints: t });
  }
  maxLength(e) {
    let t = { ...this.schema.stringConstraints, maxLength: e };
    return assertStringConstraints(t), nextFlag({ ...this.schema, stringConstraints: t });
  }
  pattern(e) {
    return nextFlag({ ...this.schema, stringConstraints: { ...this.schema.stringConstraints, pattern: e } });
  }
  separator(e) {
    return normalizeSplitPolicy(`cli`, e), nextFlag({ ...this.schema, separator: e });
  }
  split(e) {
    let t = normalizeSplitOptions(e, this.schema.split);
    return nextFlag({ ...this.schema, ...t.setsSeparator ? { separator: t.separator } : {}, split: t.split });
  }
  duplicateKeys(e) {
    return nextFlag({ ...this.schema, duplicateKeys: e });
  }
  standard(e) {
    let t = isCollection(flagCardinality(this.schema));
    return nextFlag({ ...this.schema, ...t ? { aggregateStandard: e } : { standard: e } });
  }
  unique(e = true) {
    return nextFlag({ ...this.schema, unique: e });
  }
  negatable(e) {
    return nextFlag({ ...this.schema, negation: { alias: e?.alias, hidden: e?.hidden ?? false } });
  }
  duplicates(e) {
    return nextFlag({ ...this.schema, duplicates: e });
  }
}, flag, ARG_KINDS, COLLECTION_ARG_FIELDS, KIND_SPECIFIC_ARG_FIELDS, NORMALIZED_ARG_SCHEMA_KEYS, ArgBuilder = class e {
  schema;
  constructor(e) {
    this.schema = e;
  }
  complete(t) {
    return new e({ ...this.schema, completion: t });
  }
  required() {
    return new e({ ...this.schema, presence: `required` });
  }
  optional() {
    return new e({ ...this.schema, presence: `optional` });
  }
  default(t, n) {
    let r = { ...this.schema, presence: `defaulted`, defaultValue: t, defaultDescription: n?.description };
    return assertValidArgDefault(undefined, r), new e(r);
  }
  variadic() {
    return nextArg({ ...this.schema, variadic: true });
  }
  separator(e) {
    return normalizeSplitPolicy(`cli`, e), nextArg({ ...this.schema, separator: e });
  }
  split(e) {
    let t = normalizeSplitOptions(e, this.schema.split);
    return nextArg({ ...this.schema, ...t.setsSeparator ? { separator: t.separator } : {}, split: t.split });
  }
  unique(e = true) {
    return (this.schema.kind === `keyValue` || this.schema.variadic !== true) && assertValidArgDefinition(this.schema.kind, { ...this.schema, unique: true }), nextArg({ ...this.schema, unique: e });
  }
  duplicateKeys(e) {
    return nextArg({ ...this.schema, duplicateKeys: e });
  }
  standard(e) {
    let t = isCollection(argCardinality(this.schema));
    return nextArg({ ...this.schema, ...t ? { aggregateStandard: e } : { standard: e } });
  }
  stdin(t) {
    return new e({ ...this.schema, stdin: normalizeStdinBinding(t) });
  }
  env(t, n) {
    return typeof t == `string` ? new e({ ...this.schema, envVar: t, envIndexed: undefined, envFromName: false, envAbsolute: n?.absolute === true }) : isIndexedEnvBinding(t) ? nextArg({ ...this.schema, envVar: undefined, envIndexed: normalizeIndexedEnvBinding(t), envFromName: false, envAbsolute: n?.absolute === true }) : new e({ ...this.schema, envVar: undefined, envIndexed: undefined, envFromName: true, envAbsolute: t?.absolute === true });
  }
  config(t) {
    return new e({ ...this.schema, configPath: t });
  }
  prompt(t) {
    return new e({ ...this.schema, prompt: t, sensitive: this.schema.sensitive || t.kind === `password` || t.sensitive === true });
  }
  sensitive(t = true) {
    return new e({ ...this.schema, sensitive: t || this.schema.prompt?.kind === `password` || this.schema.prompt?.sensitive === true });
  }
  describe(t) {
    return new e({ ...this.schema, description: t });
  }
  group(t) {
    return new e({ ...this.schema, group: t });
  }
  deprecated(t) {
    return new e({ ...this.schema, deprecated: t ?? true });
  }
  int(e = true) {
    return nextArg({ ...this.schema, numberConstraints: { ...this.schema.numberConstraints, int: e } });
  }
  min(e) {
    let t = { ...this.schema.numberConstraints, min: e };
    return assertNumberConstraints(t), nextArg({ ...this.schema, numberConstraints: t });
  }
  max(e) {
    let t = { ...this.schema.numberConstraints, max: e };
    return assertNumberConstraints(t), nextArg({ ...this.schema, numberConstraints: t });
  }
  finite(e = true) {
    return nextArg({ ...this.schema, numberConstraints: { ...this.schema.numberConstraints, finite: e } });
  }
  nonEmpty(e = true) {
    return nextArg({ ...this.schema, stringConstraints: { ...this.schema.stringConstraints, nonEmpty: e } });
  }
  minLength(e) {
    let t = { ...this.schema.stringConstraints, minLength: e };
    return assertStringConstraints(t), nextArg({ ...this.schema, stringConstraints: t });
  }
  maxLength(e) {
    let t = { ...this.schema.stringConstraints, maxLength: e };
    return assertStringConstraints(t), nextArg({ ...this.schema, stringConstraints: t });
  }
  pattern(e) {
    return nextArg({ ...this.schema, stringConstraints: { ...this.schema.stringConstraints, pattern: e } });
  }
}, arg, CONSTRAINT_KINDS, RESOLUTION_ORDER, PROMPT_RANK, CommandBuilder = class e {
  schema;
  handler;
  _subcommands;
  _executionSteps;
  constructor(e, t, n, r) {
    this.schema = e, this.handler = t, this._subcommands = n ?? [], this._executionSteps = r ?? [];
  }
  helpTopic(t, n) {
    return checkHelpTopic(t, n), new e({ ...this.schema, helpTopics: { ...this.schema.helpTopics, [t]: n } }, this.handler, this._subcommands, this._executionSteps);
  }
  constrain(t) {
    let n = [...this.schema.constraints ?? [], ...t(constraintBuilder(this.schema))];
    if (n.length === 0)
      return this;
    let r = { ...this.schema, constraints: n };
    return checkCommandConstraints(r), new e(r, this.handler, this._subcommands, this._executionSteps);
  }
  validate(t, n) {
    if (!isStandardSchemaV1(t))
      throw new CLIError(`Command validation requires a Standard Schema v1 validator`, { code: `INVALID_SCHEMA`, details: { command: this.schema.name } });
    let r = [...this.schema.validators ?? [], { schema: t, input: n?.input ?? `flags` }];
    return new e({ ...this.schema, validators: r }, this.handler, this._subcommands, this._executionSteps);
  }
  interactive(t) {
    let n = t;
    return new e({ ...this.schema, interactive: n }, this.handler, this._subcommands, this._executionSteps);
  }
  derive(t) {
    let n = t;
    return new e({ ...this.schema, hasAction: false }, undefined, this._subcommands, [...this._executionSteps, { kind: `derive`, handler: n }]);
  }
  middleware(t) {
    return new e({ ...this.schema, hasAction: false }, undefined, this._subcommands, [...this._executionSteps, { kind: `middleware`, handler: t._handler }]);
  }
  description(t) {
    return new e({ ...this.schema, description: t }, this.handler, this._subcommands, this._executionSteps);
  }
  details(t) {
    return new e({ ...this.schema, details: t }, this.handler, this._subcommands, this._executionSteps);
  }
  alias(t) {
    return new e({ ...this.schema, aliases: [...this.schema.aliases, t] }, this.handler, this._subcommands, this._executionSteps);
  }
  hidden() {
    return new e({ ...this.schema, hidden: true }, this.handler, this._subcommands, this._executionSteps);
  }
  example(t, n) {
    let r = n === undefined ? { command: t } : { command: t, description: n };
    return new e({ ...this.schema, examples: [...this.schema.examples, r] }, this.handler, this._subcommands, this._executionSteps);
  }
  flag(t, n) {
    let r = withCommandFlag(this.schema, t, n.schema);
    return new e(r, undefined, this._subcommands, this._executionSteps);
  }
  flags(t) {
    assertUsableFlagRecord(this.schema.name, t);
    let n = this.schema, r = t;
    for (let e of Object.getOwnPropertyNames(r)) {
      let t = r[e];
      if (t === undefined)
        throw new CLIError(`Command '${n.name}' flag --${e} requires a flag builder`, { code: `INVALID_SCHEMA`, details: { command: n.name, flag: e } });
      n = withCommandFlag(n, e, t.schema);
    }
    return new e({ ...n, hasAction: false }, undefined, this._subcommands, this._executionSteps);
  }
  arg(t, n) {
    let r = withEnvFromName(t, n.schema);
    validateArgEntry(this.schema.name, t, r, this.schema.flags, this.schema.args);
    let i = { name: t, schema: r }, a = [...this.schema.args, i];
    return new e({ ...this.schema, args: a, hasAction: false }, undefined, this._subcommands, this._executionSteps);
  }
  command(t) {
    let n = { ...this.schema, commands: [...this.schema.commands, t.schema] };
    return validateCommandFlagTree(n), new e(n, this.handler, [...this._subcommands, eraseBuilder(t)], this._executionSteps);
  }
  action(t) {
    return new e({ ...this.schema, hasAction: true }, t, this._subcommands, this._executionSteps);
  }
}, boundaries, STDIN_OCCURRENCE, NEGATED_OCCURRENCE, INCREMENT_OCCURRENCE, sensitiveFlagDiagnostics, deferredFlagDiagnostics, deferredCustomFlags, WHOLE_TOKEN, CSI, emitLink, ESCAPE_OR_CHARACTER, EXAMPLE_TOKEN, noopSpinnerHandle, noopProgressHandle, StaticSpinnerHandle = class {
  write;
  onStop;
  stopped = false;
  constructor(e, t, n) {
    this.write = t, this.onStop = n, writeLine(t, e), bindMethods(this);
  }
  update(e) {}
  succeed(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), e !== undefined && writeLine(this.write, e));
  }
  fail(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), e !== undefined && writeLine(this.write, e));
  }
  stop() {
    this.stopped || (this.stopped = true, this.onStop?.());
  }
  async wrap(e, t) {
    try {
      let n = await e;
      return this.succeed(typeof t?.succeed == `function` ? t.succeed(n) : t?.succeed), n;
    } catch (e) {
      let n;
      try {
        n = typeof t?.fail == `function` ? t.fail(e) : t?.fail;
      } finally {
        this.fail(n);
      }
      throw e;
    }
  }
}, StaticProgressHandle = class {
  write;
  onStop;
  stopped = false;
  constructor(e, t, n) {
    this.write = t, this.onStop = n, e !== undefined && writeLine(t, e), bindMethods(this);
  }
  increment(e) {}
  update(e) {}
  done(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), e !== undefined && writeLine(this.write, e));
  }
  fail(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), e !== undefined && writeLine(this.write, e));
  }
}, HIDE_CURSOR = `\x1B[?25l`, SHOW_CURSOR = `\x1B[?25h`, ERASE_LINE = `\x1B[2K`, SPINNER_FRAMES, TTYSpinnerHandle = class {
  write;
  onStop;
  line;
  stopped = false;
  timer;
  frameIndex = 0;
  text;
  constructor(e, t, n, r) {
    this.write = t, this.onStop = n, this.line = r, this.text = e, r === undefined && t(HIDE_CURSOR), this.render(), r?.animated !== false && (this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length, this.render(), this.line?.animated === false && this.cleanup();
    }, 80)), bindMethods(this);
  }
  render() {
    let e = `${SPINNER_FRAMES[this.frameIndex] ?? SPINNER_FRAMES[0]} ${this.text}`;
    this.line === undefined ? this.write(`\r${ERASE_LINE}${e}`) : this.line.update(e);
  }
  cleanup() {
    this.timer !== undefined && (clearInterval(this.timer), this.timer = undefined), this.line === undefined && this.write(`\r${ERASE_LINE}${SHOW_CURSOR}`);
  }
  update(e) {
    this.stopped || (this.text = e, this.render());
  }
  succeed(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.cleanup(), this.line === undefined ? e !== undefined && writeLine(this.write, `\u2713 ${e}`) : this.line.finish(e === undefined ? undefined : `\u2713 ${e}`));
  }
  fail(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.cleanup(), this.line === undefined ? e !== undefined && writeLine(this.write, `\u2717 ${e}`) : this.line.finish(e === undefined ? undefined : `\u2717 ${e}`));
  }
  stop() {
    this.stopped || (this.stopped = true, this.onStop?.(), this.cleanup(), this.line?.finish());
  }
  async wrap(e, t) {
    try {
      let n = await e;
      return this.succeed(typeof t?.succeed == `function` ? t.succeed(n) : t?.succeed), n;
    } catch (e) {
      let n;
      try {
        n = typeof t?.fail == `function` ? t.fail(e) : t?.fail;
      } finally {
        this.fail(n);
      }
      throw e;
    }
  }
}, TTYProgressHandle = class {
  write;
  onStop;
  line;
  stopped = false;
  timer;
  current = 0;
  total;
  label;
  pulsePos = 0;
  pulseDir = 1;
  constructor(e, t, n, r) {
    this.write = t, this.onStop = n, this.line = r, this.total = e.total, this.label = e.label ?? ``, r === undefined && t(HIDE_CURSOR), this.render(), this.total === undefined && r?.animated !== false && (this.timer = setInterval(() => {
      this.advancePulse(), this.render(), this.line?.animated === false && this.cleanup();
    }, 80)), bindMethods(this);
  }
  advancePulse() {
    this.pulsePos += this.pulseDir, this.pulsePos + 3 > 20 ? (this.pulseDir = -1, this.pulsePos = 17) : this.pulsePos < 0 && (this.pulseDir = 1, this.pulsePos = 0);
  }
  render() {
    let e = `${this.total === undefined ? this.renderIndeterminate() : this.renderDeterminate(this.total)}${this.label.length > 0 ? ` ${this.label}` : ``}`;
    this.line === undefined ? this.write(`\r${ERASE_LINE}${e}`) : this.line.update(e);
  }
  renderDeterminate(e) {
    let t = e > 0 ? Math.max(0, Math.min(this.current / e, 1)) : 0, n = Math.round(t * 20), r = 20 - n, i = Math.round(t * 100);
    return `[${`\u2588`.repeat(n)}${`\u2591`.repeat(r)}] ${String(i)}%`;
  }
  renderIndeterminate() {
    let e = ``;
    for (let t = 0;t < 20; t++)
      e += t >= this.pulsePos && t < this.pulsePos + 3 ? `\u2588` : `\u2591`;
    return `[${e}]`;
  }
  cleanup() {
    this.timer !== undefined && (clearInterval(this.timer), this.timer = undefined), this.line === undefined && this.write(`\r${ERASE_LINE}${SHOW_CURSOR}`);
  }
  increment(e) {
    this.stopped || (this.current += e ?? 1, this.render());
  }
  update(e) {
    this.stopped || (this.current = e, this.render());
  }
  done(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.cleanup(), this.line === undefined ? e !== undefined && writeLine(this.write, `\u2713 ${e}`) : this.line.finish(e === undefined ? undefined : `\u2713 ${e}`));
  }
  fail(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.cleanup(), this.line === undefined ? e !== undefined && writeLine(this.write, `\u2717 ${e}`) : this.line.finish(e === undefined ? undefined : `\u2717 ${e}`));
  }
}, CaptureSpinnerHandle = class {
  events;
  onStop;
  stopped = false;
  constructor(e, t, n) {
    this.events = t, this.onStop = n, t.push({ type: `spinner:start`, text: e }), bindMethods(this);
  }
  update(e) {
    this.stopped || this.events.push({ type: `spinner:update`, text: e });
  }
  succeed(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.events.push({ type: `spinner:succeed`, text: e ?? `` }));
  }
  fail(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.events.push({ type: `spinner:fail`, text: e ?? `` }));
  }
  stop() {
    this.stopped || (this.stopped = true, this.onStop?.(), this.events.push({ type: `spinner:stop` }));
  }
  async wrap(e, t) {
    try {
      let n = await e;
      return this.succeed(typeof t?.succeed == `function` ? t.succeed(n) : t?.succeed), n;
    } catch (e) {
      let n;
      try {
        n = typeof t?.fail == `function` ? t.fail(e) : t?.fail;
      } finally {
        this.fail(n);
      }
      throw e;
    }
  }
}, CaptureProgressHandle = class {
  events;
  onStop;
  stopped = false;
  constructor(e, t, n) {
    this.events = t, this.onStop = n, t.push({ type: `progress:start`, label: e.label ?? ``, total: e.total }), bindMethods(this);
  }
  increment(e) {
    this.stopped || this.events.push({ type: `progress:increment`, delta: e ?? 1 });
  }
  update(e) {
    this.stopped || this.events.push({ type: `progress:update`, value: e });
  }
  done(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.events.push({ type: `progress:done`, text: e }));
  }
  fail(e) {
    this.stopped || (this.stopped = true, this.onStop?.(), this.events.push({ type: `progress:fail`, text: e }));
  }
}, ActivityBlock = class {
  write;
  getTerminalSize;
  lines = /* @__PURE__ */ new Set;
  renderedLines = 0;
  cursorHidden = false;
  staticFallback = false;
  frame;
  constructor(e, t) {
    this.write = e, this.getTerminalSize = t;
  }
  line(e) {
    let t = { text: undefined, label: e };
    this.lines.add(t);
    let n = this;
    return { get animated() {
      return !n.staticFallback;
    }, update: (e) => {
      if (!this.lines.has(t))
        return;
      let n = t.text === undefined;
      t.text = e.replace(/[\r\n]+/g, ` `), this.render(undefined, n ? t : undefined);
    }, finish: (e) => {
      this.lines.delete(t) && (this.render(e?.replace(/[\r\n]+/g, ` `)), this.lines.size === 0 && (this.staticFallback = false));
    } };
  }
  writeMessage(e, t) {
    this.clear(this.readSize()), e(t), this.render();
  }
  readSize() {
    if (!this.staticFallback)
      try {
        let e = this.getTerminalSize?.();
        if (e !== undefined && Number.isInteger(e.rows) && e.rows > 1 && Number.isInteger(e.columns) && e.columns > 0)
          return e;
      } catch {}
  }
  showCursor() {
    this.cursorHidden &&= (this.write(`\x1B[?25h`), false);
  }
  clear(e) {
    if (this.frame = undefined, this.renderedLines !== 0) {
      if (e === undefined)
        this.write(`\r
`), this.staticFallback = true;
      else {
        let t = Math.min(this.renderedLines, e.rows - 1);
        this.write(`\x1B[${t}A\r\x1B[J`);
      }
      this.renderedLines = 0;
    }
  }
  render(e, t) {
    let n = this.readSize();
    if (n === undefined) {
      this.clear(n), this.showCursor(), this.lines.size > 0 && (this.staticFallback = true);
      let r = e ?? t?.label;
      r !== undefined && this.write(`${r}
`);
      return;
    }
    let r = [...this.lines].flatMap((e) => e.text === undefined ? [] : [e.text]), i = n.rows - 1, a = r.length <= i ? r : [...r.slice(0, i - 1), `${r.length - i + 1} more activities`], o = a.map((e) => `\r${e}
`).join(``);
    e === undefined && this.cursorHidden && this.renderedLines === a.length && this.frame?.text === o && this.frame.columns === n.columns && this.frame.rows === n.rows || (this.clear(n), e !== undefined && this.write(`${e}
`), a.length === 0 ? this.showCursor() : (this.cursorHidden ||= (this.write(`\x1B[?25l`), true), this.write(`\x1B[?7l${o}\r\x1B[?7h`), this.renderedLines = a.length, this.frame = { text: o, columns: n.columns, rows: n.rows }));
  }
}, noopWrite$1 = () => {}, requestedExitCodes, OutputChannel = class {
  options;
  policy;
  jsonMode;
  verbosity;
  isTTY;
  terminalSize;
  color;
  isHyperlinkSupported;
  activityWrite;
  constructor(e) {
    this.activityWrite = e.stderr, this.options = { ...e, stdout: (t) => this.writeMessage(e.stdout, t), stderr: (t) => this.writeMessage(e.stderr, t) }, this.policy = resolveOutputPolicy(e), this.jsonMode = e.jsonMode, this.verbosity = this.policy.verbosity, this.isTTY = e.isTTY, this.terminalSize = e.terminalSize, this.color = O(e.color), this.isHyperlinkSupported = e.isHyperlinkSupported, bindMethods(this);
  }
  log(e) {
    writeLine(resolveWriterForStream(this.options, resolveTextStream(this.policy)), e);
  }
  info(e) {
    shouldEmitInfo(this.policy) && writeLine(resolveWriterForStream(this.options, resolveTextStream(this.policy)), e);
  }
  status(e) {
    shouldEmitInfo(this.policy) && writeLine(this.options.stderr, e);
  }
  warn(e) {
    writeLine(this.options.stderr, e);
  }
  error(e) {
    writeLine(this.options.stderr, e);
  }
  setExitCode(e) {
    setRequestedExitCode(this, e);
  }
  json(e) {
    let t = this.isTTY && !this.jsonMode, n = JSON.stringify(e, null, t ? 2 : undefined);
    writeLine(this.options.stdout, t && n !== undefined ? colorJson(n, this.color) : n);
  }
  table(e, t, n) {
    let { columns: r, options: i } = resolveTableArgs(t, n), a = resolveTableFormat(this.policy, i), o = r ?? inferColumns(e);
    if (a === `json`) {
      writeLine(this.options.stdout, JSON.stringify(projectTableRows(e, o)));
      return;
    }
    let s = formatTable(e, o);
    s.length !== 0 && writeLine(resolveTextTableWriter(this.options, this.policy, a, i), s);
  }
  activeCleanups = /* @__PURE__ */ new Map;
  concurrent = false;
  activityBlock;
  writeMessage(e, t) {
    this.activityBlock === undefined ? e(t) : this.activityBlock.writeMessage(e, t);
  }
  stopActive() {
    for (let e of [...this.activeCleanups.values()])
      e();
    this.activeCleanups.clear();
  }
  startActivity(e, t) {
    this.activeCleanups.size > 0 && (!e || !this.concurrent) && this.stopActive(), this.concurrent = e;
    let n = {}, r = t(() => this.activeCleanups.delete(n));
    return r.cleanup !== undefined && this.activeCleanups.set(n, r.cleanup), r.handle;
  }
  concurrentLine(e) {
    return this.activityBlock ??= new ActivityBlock(this.activityWrite, this.options.getTerminalSize), this.activityBlock.line(e);
  }
  spinner(e, t) {
    let n = resolveSpinnerPolicy(this.policy, t?.fallback ?? `silent`);
    return n.mode === `noop` ? createSpinnerHandleFromPolicy(n, e, this.activityWrite).handle : this.startActivity(t?.concurrent ?? false, (r) => createSpinnerHandleFromPolicy(n, e, this.activityWrite, r, t?.concurrent && n.mode === `tty` ? this.concurrentLine(e) : undefined));
  }
  progress(e) {
    let t = resolveProgressPolicy(this.policy, e.fallback ?? `silent`);
    return t.mode === `noop` ? createProgressHandleFromPolicy(t, e, this.activityWrite).handle : this.startActivity(e.concurrent ?? false, (n) => createProgressHandleFromPolicy(t, e, this.activityWrite, n, e.concurrent && t.mode === `tty` ? this.concurrentLine(e.label) : undefined));
  }
}, CaptureOutputChannel, PromptCancelledError, sensitiveDiagnostics, CLI_SOURCE, STDIN_SOURCE, ENV_ACCESS_HINT, CANONICAL_COUNT, ABSENT, COMPATIBLE_PROMPT_KINDS, sensitiveFlagsByResult, streamStates, SHORTHAND_HOSTS, rootBooleanSchema, ROOT_OUTPUT_NAMES, ROOT_LONG_SPELLINGS, ROOT_SHORT_SPELLINGS, RENAME = `Rename the flag`, STRIPPED = `The root strips that token before dispatch`, BUILTIN_EFFECTS, BUILTIN_REMEDIES, VERSION_RESERVED, PRECHECK_OUTPUT, COMPLETIONS_FLAG_NAME = `completions`, compiledStates, completionCommands, completionSchemas, CLIBuilder = class e {
  schema;
  constructor(e) {
    this.schema = e;
  }
  static _from(t, n) {
    let r = new e(t);
    return compiledStates.set(r, n), r;
  }
  version(e, t) {
    let n = t?.alias;
    return assertNoReservedFlagCollisions(e, [this.schema.defaultCommand, ...this.schema.commands], this.schema.builtins, false, undefined, n), rebuild(this, { ...this.schema, version: e, versionAlias: n });
  }
  envPrefix(e) {
    return rebuild(this, { ...this.schema, envPrefix: e === undefined ? deriveEnvPrefix(this.schema.name) : normalizeEnvPrefix(e) });
  }
  builtins(e) {
    let t = { ...e.help === undefined ? {} : { help: e.help }, ...e.json === undefined ? {} : { json: e.json }, ...e.quiet === undefined ? {} : { quiet: e.quiet } }, n = normalizeBuiltins({ ...this.schema.builtins, ...t });
    return assertNoReservedFlagCollisions(this.schema.version, [this.schema.defaultCommand, ...this.schema.commands], n, false, undefined, this.schema.versionAlias), rebuild(this, sealCLISchema({ ...this.schema, builtins: n }));
  }
  description(e) {
    return rebuild(this, { ...this.schema, description: e });
  }
  links(e) {
    return rebuild(this, { ...this.schema, helpLinks: { name: toUrlString(e?.name), version: toUrlString(e?.version) } });
  }
  help(e) {
    return rebuild(this, { ...this.schema, helpConfig: { ...this.schema.helpConfig, ...e } });
  }
  config(e, t = {}) {
    let n = isConfigLoaderList(t) ? { loaders: t } : t;
    return n.noConfigFlag === true && assertNoReservedFlagCollisions(this.schema.version, [this.schema.defaultCommand, ...this.schema.commands], this.schema.builtins, true, this.schema.flagSettings, this.schema.versionAlias), rebuild(this, sealCLISchema({ ...this.schema, configSettings: { appName: e, loaders: n.loaders, ...n.noConfigFlag === true ? { noConfigFlag: true } : {} } }));
  }
  configLoader(e) {
    if (this.schema.configSettings === undefined)
      throw new CLIError(`.configLoader() requires .config() to be called first`, { code: `INVALID_BUILDER_STATE`, suggest: `Call .config(appName) before .configLoader()` });
    let t = this.schema.configSettings.loaders ?? [];
    return rebuild(this, sealCLISchema({ ...this.schema, configSettings: { ...this.schema.configSettings, loaders: [...t, e] } }));
  }
  manifest(e) {
    let t = buildManifestSchema(this.schema, e, DEFAULT_MANIFEST_FILES2);
    return assertNoReservedFlagCollisions(t.version, [t.defaultCommand, ...t.commands], t.builtins, false, undefined, t.versionAlias), rebuild(this, t);
  }
  command(t) {
    assertNoTopLevelRouteConflict(this.schema.commands, t.schema, this.schema.defaultCommand), assertNoReservedFlagCollisions(this.schema.version, [t.schema], this.schema.builtins, this.schema.configSettings?.noConfigFlag, this.schema.flagSettings, this.schema.versionAlias), this.schema.completionsFlag !== undefined && assertNoCompletionsFlagCollision(t.schema);
    let n = compiledStateOf(this);
    return e._from({ ...this.schema, commands: [...this.schema.commands, t.schema] }, { ...n, commands: [...n.commands, compileCommand(t)] });
  }
  default(t, n) {
    if (this.schema.defaultCommand !== undefined)
      throw new CLIError(`Only one default command is allowed`, { code: `DUPLICATE_DEFAULT`, suggest: `Call .default() only once when building the CLI` });
    assertNoTopLevelRouteConflict(this.schema.commands, t.schema), assertNoReservedFlagCollisions(this.schema.version, [t.schema], this.schema.builtins, this.schema.configSettings?.noConfigFlag, this.schema.flagSettings, this.schema.versionAlias), this.schema.completionsFlag !== undefined && assertNoCompletionsFlagCollision(t.schema);
    let r = compiledStateOf(this);
    return e._from({ ...this.schema, defaultCommand: t.schema, defaultCommandRouted: n?.route ?? false }, { ...r, defaultCommand: compileCommand(t) });
  }
  plugin(t) {
    let n = compiledStateOf(this);
    return e._from(this.schema, { ...n, plugins: [...n.plugins, t] });
  }
  completions(e) {
    if (this.schema.hasBuiltInCompletions)
      throw new CLIError(`.completions() has already been called`, { code: `DUPLICATE_COMMAND`, suggest: `Call .completions() only once when building the CLI` });
    if (e?.as === `flag`) {
      this.schema.defaultCommand !== undefined && assertNoCompletionsFlagCollision(this.schema.defaultCommand);
      for (let e of this.schema.commands)
        assertNoCompletionsFlagCollision(e);
      return rebuild(this, { ...this.schema, hasBuiltInCompletions: true, completionsFlag: { shells: SHELLS, options: completionGeneratorOptions(e) } });
    }
    let t = completionGeneratorOptions(e), n = command(`completions`).alias(`completion`).description(`Generate shell completion script`).arg(`shell`, arg.custom((e) => {
      let t = normalizeShell(e);
      if (t === undefined)
        throw Error(`Unknown shell '${e}'. Valid shells: ${SHELLS.join(`, `)}`);
      return t;
    }).env(`SHELL`, { absolute: true }).describe(`Target shell (${SHELLS.join(`, `)})`)).action(async ({ args: e, meta: n, out: r }) => {
      let i = completionSchemas.get(n);
      if (i === undefined)
        throw new CLIError(`Missing completion schema`, { code: `INVALID_BUILDER_STATE` });
      let a = { ...i, name: n.bin, commands: i.commands.filter((e) => !completionCommands.has(e)) }, { generateCompletion: o } = await Promise.resolve().then(() => (init_completion_D_kRNOTC(), {})).then((e) => completion_exports), s = o(a, e.shell, t);
      r.jsonMode ? r.json({ shell: e.shell, script: s }) : r.log(s);
    });
    completionCommands.add(n.schema);
    let r = this.command(n);
    return rebuild(r, { ...r.schema, hasBuiltInCompletions: true });
  }
  async execute(e, t) {
    return executeCLI(this, e, t);
  }
  async run(e) {
    let t = e?.adapter ?? createAdapter();
    if (t.argv[2] === `__complete`) {
      await Promise.resolve().then(() => init_dynamic_DSu5__LH());
      let r = await completeRequest(e?.flags === undefined ? this.schema : { ...this.schema, flagSettings: e.flags }, compiledStateOf(this), t.argv.slice(3), e?.env ?? t.env);
      for (let e of r.candidates)
        t.stdout(`${e}
`);
      return exitAfterFlush(t, r.exitCode);
    }
    let n = this.schema.inheritName ? inferInvocationName(t.argv) : undefined, r = compiledStateOf(this), i = await prepareRuntimePreflight({ schema: this.schema, compiled: r, adapter: t, options: e, inheritedName: n });
    if (i.kind === `startup-error`)
      return i.jsonMode ? t.stdout(`${JSON.stringify({ error: i.error.toJSON() })}
`) : (t.stderr(`Error: ${i.error.message}
`), i.error.suggest !== undefined && t.stderr(`Suggestion: ${i.error.suggest}
`)), exitAfterFlush(t, i.error.exitCode);
    let a = i.schema === this.schema ? this : rebuild(this, sealCLISchema({ ...this.schema, ...i.schema })), o = e?.terminalSize ?? t.getTerminalSize(), s = resolveEffectiveHyperlinkOverride(e?.help, a.schema.helpConfig, t.env, t.argv), c = { ...e, ...i.inputs, out: createOutput({ stdout: t.stdout, stderr: t.stderr, ...o === undefined ? {} : { terminalSize: o }, getTerminalSize: () => t.getTerminalSize(), jsonMode: i.inputs.jsonMode, isTTY: i.inputs.isTTY, color: resolveExecutionColor({ ...e, ...i.inputs }), ...i.inputs.verbosity === `normal` ? {} : { verbosity: i.inputs.verbosity }, ...hyperlinksOption(s) }) }, l = await executeCLI(a, i.filteredArgv, c);
    for (let e of l.stdout)
      t.stdout(e);
    for (let e of l.stderr)
      t.stderr(e);
    return exitAfterFlush(t, l.exitCode);
  }
}, RUNTIME_BINARIES, DEFAULT_MANIFEST_FILES2, DEFINITION_SCHEMA_URL = `https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json`;
var init_core_uS8LDF4B = __esm(() => {
  init_dist();
  SHELLS = Object.freeze([`bash`, `zsh`, `fish`, `powershell`]);
  OMIT = Symbol(`omit`);
  CLIError = class extends Error {
    name = `CLIError`;
    code;
    exitCode;
    suggest;
    details;
    constructor(e, t) {
      super(e, t.cause === undefined ? undefined : { cause: t.cause }), this.code = t.code, this.exitCode = t.exitCode ?? 1, this.suggest = t.suggest, this.details = t.details;
    }
    toJSON() {
      return { name: this.name, code: this.code, message: this.message, exitCode: this.exitCode, ...this.suggest !== undefined && { suggest: this.suggest }, ...this.details !== undefined && { details: toJsonSafeRecord(this.details) } };
    }
  };
  ParseError = class extends CLIError {
    name = `ParseError`;
    constructor(e, t) {
      super(e, { ...t, exitCode: t.exitCode ?? 2 });
    }
  };
  ValidationError = class extends CLIError {
    name = `ValidationError`;
    constructor(e, t) {
      super(e, { ...t, exitCode: t.exitCode ?? 2 });
    }
  };
  BUILTIN_SPECS = { help: { long: [`--help`], short: [`-h`], description: `Show this help message and exit` }, json: { long: [`--json`], short: [], description: `Emit machine-readable JSON output` }, quiet: { long: [`--quiet`], short: [`-q`], description: `Suppress informational output` } };
  BUILTIN_NAMES = [`help`, `json`, `quiet`];
  DEFAULT_BUILTINS = { help: `on`, json: `on`, quiet: `on` };
  ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;
  DURATION_UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  BYTE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  STRING_TYPE_FAILURE = { ok: false, failure: { kind: `type`, expected: `string` } };
  NUMBER_TYPE_FAILURE = { ok: false, failure: { kind: `type`, expected: `number` } };
  BOOLEAN_TYPE_FAILURE = { ok: false, failure: { kind: `type`, expected: `boolean` } };
  stringCodec = { name: `string`, decode(e, t) {
    return typeof e == `string` ? { ok: true, value: e } : t === `prompt` || t === `config` && (typeof e == `number` || typeof e == `boolean`) ? { ok: true, value: String(e) } : STRING_TYPE_FAILURE;
  } };
  strictStringCodec = { name: `string`, decode(e) {
    return typeof e == `string` ? { ok: true, value: e } : STRING_TYPE_FAILURE;
  } };
  numberCodec = { name: `number`, decode(e) {
    if (typeof e == `number`)
      return Number.isNaN(e) ? NUMBER_TYPE_FAILURE : { ok: true, value: e };
    if (typeof e == `string` && e.trim() !== ``) {
      let t = Number(e);
      if (!Number.isNaN(t))
        return { ok: true, value: t };
    }
    return NUMBER_TYPE_FAILURE;
  } };
  booleanCodec = { name: `boolean`, decode(e, t) {
    if (t === `token`)
      return e === `true` || e === `1` ? { ok: true, value: true } : e === `false` || e === `0` ? { ok: true, value: false } : BOOLEAN_TYPE_FAILURE;
    if (typeof e == `boolean`)
      return { ok: true, value: e };
    if (typeof e == `string`) {
      let n = e.toLowerCase();
      if (n === `true` || n === `1` || n === `yes` || t === `prompt` && n === `y`)
        return { ok: true, value: true };
      if (n === `false` || n === `0` || n === `no` || n === `` || t === `prompt` && n === `n`)
        return { ok: true, value: false };
    }
    return BOOLEAN_TYPE_FAILURE;
  } };
  passthroughCodec = { name: `custom`, parseFn: undefined, decode(e) {
    return { ok: true, value: e };
  } };
  WHOLE = { format: `whole` };
  LINES = { format: `lines` };
  ENV_DEFAULT = { format: `delimiter`, delimiter: `,` };
  NAMED_SPLIT_POLICIES = { whole: WHOLE, lines: LINES, json: { format: `json` } };
  ALLOWED_SPLIT_FORMATS = { cli: [`whole`, `delimiter`], env: [`whole`, `delimiter`, `json`], stdin: [`whole`, `delimiter`, `lines`, `json`] };
  DUPLICATE_KEYS = [`first`, `last`, `error`];
  ONE = { kind: `one` };
  COUNT = { kind: `count` };
  VOWEL_INITIAL = /^[aeiou]/i;
  STDIN_WHENS = [`dash`, `missing`, `dash-or-missing`];
  STDIN_CONSUMES = [`exclusive`, `broadcast`];
  DEFAULT_STDIN_BINDING = { when: `dash-or-missing`, consume: `exclusive`, trim: false };
  FLAG_KINDS = [`string`, `number`, `boolean`, `enum`, `array`, `custom`, `count`, `keyValue`];
  NORMALIZED_FLAG_SCHEMA_KEYS = /* @__PURE__ */ `kind.presence.defaultValue.defaultDescription.sensitive.aliases.stdin.envVar.envIndexed.envAbsolute.envFromName.configPath.description.group.enumValues.numberConstraints.stringConstraints.elementSchema.separator.split.duplicateKeys.unique.pathChecks.valueHint.prompt.parseFn.standard.aggregateStandard.deprecated.propagate.negation.separateValue.variadic.duplicates`.split(`.`);
  STDIN_CAPABLE_FLAG_KINDS = [`string`, `number`, `boolean`, `enum`, `custom`, `array`, `keyValue`];
  COLLECTION_FLAG_KINDS = [`array`, `keyValue`];
  KIND_SPECIFIC_FLAG_FIELDS = [[`enumValues`, [`enum`]], [`numberConstraints`, [`number`]], [`stringConstraints`, [`string`]], [`pathChecks`, [`string`]], [`elementSchema`, COLLECTION_FLAG_KINDS], [`separator`, COLLECTION_FLAG_KINDS], [`split`, COLLECTION_FLAG_KINDS], [`aggregateStandard`, COLLECTION_FLAG_KINDS], [`parseFn`, [`custom`]], [`negation`, [`boolean`]], [`separateValue`, [`boolean`]], [`variadic`, [`array`]]];
  flag = { string(e) {
    return e !== undefined && assertStringConstraints(e), new FlagBuilder(createFlagSchema(`string`, valueDefinitionFields(stringValue(e))));
  }, number(e) {
    return e !== undefined && assertNumberConstraints(e), new FlagBuilder(createFlagSchema(`number`, valueDefinitionFields(numberValue(e))));
  }, boolean(e) {
    return new FlagBuilder(createFlagSchema(`boolean`, { presence: `defaulted`, defaultValue: false, ...e?.separateValue ? { separateValue: true } : {} }));
  }, enum(e) {
    return new FlagBuilder(createFlagSchema(`enum`, { enumValues: e }));
  }, array(e, t) {
    return assertFlagElementBuilder(`array`, e), new FlagBuilder(createFlagSchema(`array`, { elementSchema: e.schema, ...t?.variadic ? { variadic: true } : {} }));
  }, custom(e) {
    return isStandardSchemaV1(e) ? new FlagBuilder(createFlagSchema(`custom`, valueDefinitionFields(standardValue(e)))) : new FlagBuilder(createFlagSchema(`custom`, valueDefinitionFields(customValue(e))));
  }, url(e) {
    return new FlagBuilder(createFlagSchema(`custom`, valueDefinitionFields(urlValue(e))));
  }, path(e) {
    return new FlagBuilder(createFlagSchema(`string`, valueDefinitionFields(pathValue(e))));
  }, date(e) {
    return new FlagBuilder(createFlagSchema(`custom`, valueDefinitionFields(dateValue(e))));
  }, duration() {
    return new FlagBuilder(createFlagSchema(`custom`, valueDefinitionFields(durationValue())));
  }, bytes() {
    return new FlagBuilder(createFlagSchema(`custom`, valueDefinitionFields(bytesValue())));
  }, count() {
    return new FlagBuilder(createFlagSchema(`count`, { presence: `defaulted`, defaultValue: 0 }));
  }, keyValue(e) {
    return e !== undefined && assertFlagElementBuilder(`keyValue`, e), new FlagBuilder(createFlagSchema(`keyValue`, { valueHint: `key=value`, ...e === undefined ? {} : { elementSchema: e.schema } }));
  } };
  ARG_KINDS = [`string`, `number`, `boolean`, `enum`, `custom`, `keyValue`];
  COLLECTION_ARG_FIELDS = [`separator`, `split`];
  KIND_SPECIFIC_ARG_FIELDS = [[`enumValues`, `enum`], [`numberConstraints`, `number`], [`stringConstraints`, `string`], [`pathChecks`, `string`], [`parseFn`, `custom`], [`duplicateKeys`, `keyValue`], [`elementSchema`, `keyValue`]];
  NORMALIZED_ARG_SCHEMA_KEYS = /* @__PURE__ */ `kind.presence.variadic.stdin.defaultValue.defaultDescription.sensitive.description.group.envVar.envIndexed.envAbsolute.envFromName.configPath.prompt.enumValues.elementSchema.numberConstraints.stringConstraints.pathChecks.valueHint.parseFn.separator.split.duplicateKeys.unique.standard.aggregateStandard.deprecated`.split(`.`);
  arg = { string(e) {
    return e !== undefined && assertStringConstraints(e), new ArgBuilder(createArgSchema(`string`, valueDefinitionFields(stringValue(e))));
  }, number(e) {
    return e !== undefined && assertNumberConstraints(e), new ArgBuilder(createArgSchema(`number`, valueDefinitionFields(numberValue(e))));
  }, boolean() {
    return new ArgBuilder(createArgSchema(`boolean`, valueDefinitionFields(booleanValue())));
  }, keyValue(e) {
    return e !== undefined && assertArgElementBuilder(`keyValue`, e), new ArgBuilder(createArgSchema(`keyValue`, { valueHint: `key=value`, ...e === undefined ? {} : { elementSchema: e.schema } }));
  }, enum(e) {
    return new ArgBuilder(createArgSchema(`enum`, { enumValues: e }));
  }, custom(e) {
    return isStandardSchemaV1(e) ? new ArgBuilder(createArgSchema(`custom`, valueDefinitionFields(standardValue(e)))) : new ArgBuilder(createArgSchema(`custom`, valueDefinitionFields(stringParsedValue(e))));
  }, url(e) {
    return new ArgBuilder(createArgSchema(`custom`, valueDefinitionFields(urlValue(e))));
  }, path(e) {
    return new ArgBuilder(createArgSchema(`string`, valueDefinitionFields(pathValue(e))));
  }, date(e) {
    return new ArgBuilder(createArgSchema(`custom`, valueDefinitionFields(dateValue(e))));
  }, duration() {
    return new ArgBuilder(createArgSchema(`custom`, valueDefinitionFields(durationValue())));
  }, bytes() {
    return new ArgBuilder(createArgSchema(`custom`, valueDefinitionFields(bytesValue())));
  } };
  CONSTRAINT_KINDS = [`conflicts`, `requires`, `exactlyOne`, `atMostOne`, `allOrNone`];
  RESOLUTION_ORDER = [`cli`, `stdin`, `env`, `config`, `prompt`, `default`];
  PROMPT_RANK = RESOLUTION_ORDER.indexOf(`prompt`);
  boundaries = /* @__PURE__ */ new WeakMap;
  STDIN_OCCURRENCE = { kind: `stdin` };
  NEGATED_OCCURRENCE = { kind: `negated` };
  INCREMENT_OCCURRENCE = { kind: `increment` };
  sensitiveFlagDiagnostics = /* @__PURE__ */ new WeakMap;
  deferredFlagDiagnostics = /* @__PURE__ */ new WeakMap;
  deferredCustomFlags = /* @__PURE__ */ new WeakMap;
  WHOLE_TOKEN = { format: `whole` };
  CSI = /\x1b\[[0-?]*[ -/]*[@-~]/gu;
  emitLink = O(false, true).link;
  ESCAPE_OR_CHARACTER = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))|./gsu;
  EXAMPLE_TOKEN = /(?:'[^']*'|"[^"]*"|\S)+/g;
  noopSpinnerHandle = { update() {}, succeed() {}, fail() {}, stop() {}, wrap(e) {
    return e;
  } };
  noopProgressHandle = { increment() {}, update() {}, done() {}, fail() {} };
  SPINNER_FRAMES = [`\u280B`, `\u2819`, `\u2839`, `\u2838`, `\u283C`, `\u2834`, `\u2826`, `\u2827`, `\u2807`, `\u280F`];
  requestedExitCodes = /* @__PURE__ */ new WeakMap;
  CaptureOutputChannel = class extends OutputChannel {
    activity;
    constructor(e, t) {
      super(e), this.activity = t;
    }
    spinner(e, t) {
      return this.startActivity(t?.concurrent ?? false, (t) => {
        let n = new CaptureSpinnerHandle(e, this.activity, t);
        return { handle: n, cleanup: n.stop };
      });
    }
    progress(e) {
      return this.startActivity(e.concurrent ?? false, (t) => {
        let n = new CaptureProgressHandle(e, this.activity, t);
        return { handle: n, cleanup: n.done };
      });
    }
  };
  PromptCancelledError = class extends CLIError {
    name = `PromptCancelledError`;
    reason;
    constructor(e = `cancel`) {
      super(`Prompt cancelled`, { code: `PROMPT_CANCELLED`, exitCode: 130, details: { reason: e } }), this.reason = e;
    }
  };
  sensitiveDiagnostics = /* @__PURE__ */ new WeakMap;
  CLI_SOURCE = { kind: `cli` };
  STDIN_SOURCE = { kind: `stdin` };
  ENV_ACCESS_HINT = Symbol.for(`@kjanat/dreamcli/env-access-hint`);
  CANONICAL_COUNT = /^(?:0|[1-9][0-9]*)$/;
  ABSENT = { kind: `absent` };
  COMPATIBLE_PROMPT_KINDS = { boolean: [`confirm`], string: [`input`, `password`, `select`], number: [`input`], enum: [`select`, `input`], array: [`multiselect`], custom: [`input`, `password`, `select`, `confirm`, `multiselect`], count: [], keyValue: [] };
  sensitiveFlagsByResult = /* @__PURE__ */ new WeakMap;
  streamStates = /* @__PURE__ */ new WeakMap;
  SHORTHAND_HOSTS = { github: `https://github.com`, gitlab: `https://gitlab.com`, bitbucket: `https://bitbucket.org` };
  rootBooleanSchema = flag.boolean().schema;
  ROOT_OUTPUT_NAMES = [`json`, `quiet`];
  ROOT_LONG_SPELLINGS = spellingIndex(`long`);
  ROOT_SHORT_SPELLINGS = spellingIndex(`short`);
  BUILTIN_EFFECTS = { help: `A help request renders before flags are parsed`, json: STRIPPED, quiet: STRIPPED };
  BUILTIN_REMEDIES = { help: releaseRemedy(`help`), json: releaseRemedy(`json`), quiet: releaseRemedy(`quiet`, `use out.status() for output that root --quiet suppresses`) };
  VERSION_RESERVED = { rootSpelling: `--version`, effect: `The root intercepts that token before dispatch`, remedy: RENAME };
  PRECHECK_OUTPUT = { jsonMode: false, isTTY: false, verbosity: `normal` };
  compiledStates = /* @__PURE__ */ new WeakMap;
  completionCommands = /* @__PURE__ */ new WeakSet;
  completionSchemas = /* @__PURE__ */ new WeakMap;
  RUNTIME_BINARIES = /* @__PURE__ */ new Set([`bun`, `deno`, `node`, `tsx`]);
  DEFAULT_MANIFEST_FILES2 = [`package.json`];
});

init_core_uS8LDF4B();

var pipeArguments = (self, args) => {
  switch (args.length) {
    case 0:
      return self;
    case 1:
      return args[0](self);
    case 2:
      return args[1](args[0](self));
    case 3:
      return args[2](args[1](args[0](self)));
    case 4:
      return args[3](args[2](args[1](args[0](self))));
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))));
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
    case 8:
      return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
    case 9:
      return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args.length;i < len; i++) {
        ret = args[i](ret);
      }
      return ret;
    }
  }
};
var Prototype = {
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var Class = /* @__PURE__ */ function() {
  function PipeableBase() {}
  PipeableBase.prototype = Prototype;
  return PipeableBase;
}();

var dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args = arguments;
        return function(self) {
          return body(self, ...args);
        };
      };
  }
};
var identity = (a) => a;
var constant = (value) => () => value;
var constTrue = /* @__PURE__ */ constant(true);
var constFalse = /* @__PURE__ */ constant(false);
var constUndefined = /* @__PURE__ */ constant(undefined);
var constVoid = constUndefined;
function memoize(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    return result;
  };
}
function memoizeIdempotent(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    if (result !== a) {
      cache.set(result, result);
    }
    return result;
  };
}

var errorSiteKeys = ["line", "column", "sourceURL", "originalLine", "originalColumn"];
var getAllObjectKeys = (obj) => {
  const keys = new Set(Reflect.ownKeys(obj));
  if (obj.constructor === Object)
    return keys;
  if (obj instanceof Error) {
    keys.delete("stack");
    for (const key of errorSiteKeys) {
      if (!Object.prototype.propertyIsEnumerable.call(obj, key))
        keys.delete(key);
    }
  }
  const proto = Object.getPrototypeOf(obj);
  let current = proto;
  while (current !== null && current !== Object.prototype) {
    const ownKeys = Reflect.ownKeys(current);
    for (let i = 0;i < ownKeys.length; i++) {
      keys.add(ownKeys[i]);
    }
    current = Object.getPrototypeOf(current);
  }
  if (keys.has("constructor") && typeof obj.constructor === "function" && proto === obj.constructor.prototype) {
    keys.delete("constructor");
  }
  return keys;
};
var byReferenceInstances = /* @__PURE__ */ new WeakSet;
var viewBytes = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
var isArrayBufferLike = (u) => u instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && u instanceof SharedArrayBuffer;
var bufferBytes = (buffer) => {
  try {
    return new Uint8Array(buffer);
  } catch {
    return;
  }
};

var backEdges = 0;
var addBackEdge = () => {
  backEdges++;
};

function isString(input) {
  return typeof input === "string";
}
function isNumber(input) {
  return typeof input === "number";
}
function isBoolean(input) {
  return typeof input === "boolean";
}
function isSymbol(input) {
  return typeof input === "symbol";
}
function isPropertyKey(u) {
  return isString(u) || isNumber(u) || isSymbol(u);
}
function isFunction(input) {
  return typeof input === "function";
}
function isNotUndefined(input) {
  return input !== undefined;
}
function isNotNullish(input) {
  return input != null;
}
function isUnknown(_) {
  return true;
}
function isObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
function isObjectKeyword(input) {
  return typeof input === "object" && input !== null || isFunction(input);
}
var hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObjectKeyword(self) && (property in self));

var symbol = "~effect/Hash";
var hash = (self) => {
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "string":
      return string(self);
    case "function":
    case "object": {
      if (self === null) {
        break;
      } else if (self instanceof Date) {
        if (Number.isNaN(self.getTime())) {
          return string("Invalid Date");
        }
        return string(self.toISOString());
      } else if (self instanceof RegExp) {
        return string(self.toString());
      } else {
        if (byReferenceInstances.has(self)) {
          return random(self);
        }
        const cached = hashCache.get(self);
        if (cached !== undefined) {
          return cached;
        }
        if (visitedObjects.has(self)) {
          addBackEdge();
          return string("[Circular]");
        }
        visitedObjects.add(self);
        const seen = backEdges;
        let h;
        try {
          if (isHash(self)) {
            h = self[symbol]();
          } else if (typeof self === "function") {
            h = random(self);
          } else if (isArrayBufferLike(self)) {
            const bytes = bufferBytes(self);
            h = bytes === undefined ? random(self) : array(bytes);
          } else if (self instanceof DataView) {
            h = array(viewBytes(self));
          } else if (Array.isArray(self) || ArrayBuffer.isView(self)) {
            h = array(self);
          } else if (self instanceof Map) {
            h = hashMap(self);
          } else if (self instanceof Set) {
            h = hashSet(self);
          } else {
            h = structure(self);
          }
        } finally {
          visitedObjects.delete(self);
        }
        if (seen === backEdges) {
          hashCache.set(self, h);
        }
        return h;
      }
    }
  }
  return optimize(mix(string(String(self))));
};
var random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, optimize(Math.random() * 4294967296 | 0));
  }
  return randomHashCache.get(self);
};
var mix = (h) => {
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  return h ^ h >>> 16;
};
var combine = /* @__PURE__ */ dual(2, (self, b) => mix(Math.imul(self, 2654435761) + Math.imul(b, 2246822507)));
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
var isHash = (u) => hasProperty(u, symbol) && typeof u[symbol] === "function";
var float64 = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
var number = (n) => {
  const h = n | 0;
  if (h === n) {
    return optimize(h);
  }
  float64.setFloat64(0, n !== n ? NaN : n);
  return optimize(combine(float64.getInt32(0), float64.getInt32(4)));
};
var string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
};
var structureKeys = (o, keys) => {
  let h = 12289;
  for (const key of keys) {
    h ^= combine(hash(key), hash(o[key]));
  }
  return optimize(h);
};
var structure = (o) => structureKeys(o, getAllObjectKeys(o));
var unordered = (seed, f) => (iter) => {
  let h = seed;
  for (const element of iter) {
    h ^= f(element);
  }
  return optimize(h);
};
var array = (arr) => {
  let h = 6151;
  for (const element of arr) {
    h = combine(h, hash(element));
  }
  return optimize(h);
};
var hashMap = /* @__PURE__ */ unordered(/* @__PURE__ */ string("Map"), ([k, v]) => combine(hash(k), hash(v)));
var setSeed = /* @__PURE__ */ string("Set");
var hashSet = /* @__PURE__ */ unordered(setSeed, (element) => combine(setSeed, hash(element)));
var randomHashCache = /* @__PURE__ */ new WeakMap;
var hashCache = /* @__PURE__ */ new WeakMap;
var visitedObjects = /* @__PURE__ */ new WeakSet;

var symbol2 = "~effect/Equal";
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that)
    return true;
  if (self == null || that == null)
    return false;
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "number" && self !== self && that !== that) {
    return true;
  }
  if (selfType !== "object" && selfType !== "function") {
    return false;
  }
  if (byReferenceInstances.has(self) || byReferenceInstances.has(that)) {
    return false;
  }
  return compareObjects(self, that);
}
function compareObjects(self, that) {
  const depth = pathLeft.length;
  for (let i = depth;i-- > 0; ) {
    if (pathLeft[i] === self && pathRight[i] === that)
      return true;
  }
  if (depth)
    return compareOnPath(self, that);
  let known = results.get(self);
  if (!known)
    results.set(self, known = new WeakMap);
  let result = known.get(that);
  if (result === undefined)
    known.set(that, result = compareOnPath(self, that));
  return result;
}
function compareOnPath(self, that) {
  pathLeft.push(self);
  pathRight.push(that);
  try {
    return compareStructure(self, that);
  } finally {
    pathLeft.pop();
    pathRight.pop();
  }
}
var pathLeft = [];
var pathRight = [];
var results = /* @__PURE__ */ new WeakMap;
function compareStructure(self, that) {
  if (hash(self) !== hash(that)) {
    return false;
  } else if (self instanceof Date) {
    if (!(that instanceof Date))
      return false;
    const selfTime = self.getTime();
    const thatTime = that.getTime();
    return selfTime === thatTime || Number.isNaN(selfTime) && Number.isNaN(thatTime);
  } else if (self instanceof RegExp) {
    return that instanceof RegExp && self.toString() === that.toString();
  }
  const bothEquals = isEqual(self);
  if (bothEquals !== isEqual(that) || typeof self === "function" && !bothEquals) {
    return false;
  } else if (bothEquals) {
    return self[symbol2](that);
  } else if (Array.isArray(self)) {
    if (!Array.isArray(that) || self.length !== that.length) {
      return false;
    }
    return compareArrays(self, that);
  } else if (isArrayBufferLike(self)) {
    if (!isArrayBufferLike(that) || self instanceof ArrayBuffer !== that instanceof ArrayBuffer) {
      return false;
    }
    const selfBytes = bufferBytes(self);
    const thatBytes = bufferBytes(that);
    return selfBytes !== undefined && thatBytes !== undefined && compareTypedArrays(selfBytes, thatBytes);
  } else if (ArrayBuffer.isView(self)) {
    const selfIsDataView = self instanceof DataView;
    if (!ArrayBuffer.isView(that) || self.byteLength !== that.byteLength || selfIsDataView !== that instanceof DataView) {
      return false;
    }
    if (selfIsDataView) {
      return compareTypedArrays(viewBytes(self), viewBytes(that));
    }
    return compareTypedArrays(self, that);
  } else if (self instanceof Map) {
    if (!(that instanceof Map) || self.size !== that.size) {
      return false;
    }
    return compareHashed(self, that, entryHash, equalEntries);
  } else if (self instanceof Set) {
    if (!(that instanceof Set) || self.size !== that.size) {
      return false;
    }
    return compareHashed(self, that, hash, compareBoth);
  }
  return compareRecords(self, that);
}
function compareArrays(self, that) {
  for (let i = 0;i < self.length; i++) {
    if (!compareBoth(self[i], that[i])) {
      return false;
    }
  }
  return true;
}
function compareTypedArrays(self, that) {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    if (self[i] !== that[i]) {
      return false;
    }
  }
  return true;
}
function compareRecords(self, that) {
  const selfKeys = getAllObjectKeys(self);
  const thatKeys = getAllObjectKeys(that);
  if (selfKeys.size !== thatKeys.size) {
    return false;
  }
  for (const key of selfKeys) {
    if (!thatKeys.has(key) || !compareBoth(self[key], that[key])) {
      return false;
    }
  }
  return true;
}
function compareHashed(self, that, hashOf, equivalent) {
  const groups = new Map;
  let remaining = 0;
  for (const item of that) {
    const h = hashOf(item);
    const group = groups.get(h);
    if (group)
      group.push(item);
    else
      groups.set(h, [item]);
    remaining++;
  }
  outer:
    for (const item of self) {
      const group = groups.get(hashOf(item));
      if (group) {
        for (let i = 0;i < group.length; i++) {
          if (equivalent(item, group[i])) {
            group[i] = group[group.length - 1];
            group.pop();
            remaining--;
            continue outer;
          }
        }
      }
      return false;
    }
  return remaining === 0;
}
var entryHash = (entry) => hash(entry[0]);
var equalEntries = (self, that) => compareBoth(self[0], that[0]) && compareBoth(self[1], that[1]);
var isEqual = (u) => hasProperty(u, symbol2) && typeof u[symbol2] === "function";

var symbolRedactable = /* @__PURE__ */ Symbol.for("~effect/Redactable");
var isRedactable = (u) => hasProperty(u, symbolRedactable);
function redact(u) {
  if (isRedactable(u))
    return getRedacted(u);
  return u;
}
function getRedacted(redactable) {
  return redactable[symbolRedactable](globalThis[currentFiberTypeId]?.context ?? emptyContext);
}
var currentFiberTypeId = "~effect/Fiber/currentFiber";
var emptyMap = /* @__PURE__ */ new Map;
var emptyContext = {
  "~effect/Context": {},
  base: emptyMap,
  depth: 0,
  mapUnsafe: emptyMap,
  pipe() {
    return pipeArguments(this, arguments);
  }
};

function format(input, options) {
  const space = options?.space ?? 0;
  const ancestors = new WeakSet;
  const gap = !space ? "" : typeof space === "number" ? " ".repeat(space) : space;
  const ind = (d) => gap.repeat(d);
  const wrap = (v, body) => {
    const ctor = v?.constructor;
    return ctor && ctor !== Object.prototype.constructor && ctor.name ? `${ctor.name}(${body})` : body;
  };
  const ownKeys = (o) => {
    try {
      return Reflect.ownKeys(o);
    } catch {
      return ["[ownKeys threw]"];
    }
  };
  function recur(v, d = 0) {
    try {
      return recurUnsafe(v, d);
    } catch {
      if (typeof v === "object" && v !== null || typeof v === "function")
        ancestors.delete(v);
      return "[inspection threw]";
    }
  }
  function recurUnsafe(v, d = 0) {
    if (typeof v === "string")
      return JSON.stringify(v);
    if (typeof v === "number" || v == null || typeof v === "boolean" || typeof v === "symbol")
      return String(v);
    if (typeof v === "bigint")
      return String(v) + "n";
    if (typeof v === "object" || typeof v === "function") {
      if (ancestors.has(v))
        return CIRCULAR;
      ancestors.add(v);
      let output;
      if (symbolRedactable in v) {
        output = recur(getRedacted(v), d);
      } else if (Array.isArray(v)) {
        output = !gap || v.length <= 1 ? `[${v.map((x) => recur(x, d)).join(",")}]` : `[
${ind(d + 1)}${v.map((x) => recur(x, d + 1)).join(`,
` + ind(d + 1))}
${ind(d)}]`;
      } else if (v instanceof Date) {
        output = formatDate(v);
      } else if (!options?.ignoreToString && hasProperty(v, "toString") && typeof v["toString"] === "function" && v["toString"] !== Object.prototype.toString && v["toString"] !== Array.prototype.toString) {
        const s = safeToString(v);
        output = v instanceof Error && v.cause !== undefined ? `${s} (cause: ${recur(v.cause, d)})` : s;
      } else if (Symbol.iterator in v) {
        output = `${v.constructor.name}(${recur(Array.from(v), d)})`;
      } else {
        const keys = ownKeys(v);
        if (!gap || keys.length <= 1) {
          const body = `{${keys.map((k) => `${formatPropertyKey(k)}:${recur(safeGet(v, k), d)}`).join(",")}}`;
          output = wrap(v, body);
        } else {
          const body = `{
${keys.map((k) => `${ind(d + 1)}${formatPropertyKey(k)}: ${recur(safeGet(v, k), d + 1)}`).join(`,
`)}
${ind(d)}}`;
          output = wrap(v, body);
        }
      }
      ancestors.delete(v);
      return output;
    }
    return String(v);
  }
  return recur(input, 0);
}
var CIRCULAR = "[Circular]";
function formatPropertyKey(name) {
  return typeof name === "string" ? JSON.stringify(name) : String(name);
}
function formatPath(path) {
  return path.map((key) => `[${formatPropertyKey(key)}]`).join("");
}
function formatDate(date) {
  try {
    return date.toISOString();
  } catch {
    return "Invalid Date";
  }
}
function safeToString(input) {
  try {
    const s = input.toString();
    return typeof s === "string" ? s : String(s);
  } catch {
    return "[toString threw]";
  }
}
function safeGet(input, key) {
  try {
    return input[key];
  } catch {
    return "[property access threw]";
  }
}
function formatJson(input, options) {
  const ancestors = [];
  const sources = new WeakMap;
  return JSON.stringify(input, function(key, value) {
    const original = Object.getOwnPropertyDescriptor(sources.get(this) ?? this, key)?.value;
    const redacted = hasProperty(original, symbolRedactable) ? redact(original) : redact(value);
    if (typeof redacted === "bigint") {
      return format(redacted);
    }
    if (typeof redacted !== "object" || redacted === null) {
      return redacted;
    }
    const current = redacted instanceof Error && !hasProperty(redacted, "toJSON") ? {
      ...redacted,
      name: redacted.name,
      message: redacted.message
    } : redacted;
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(redacted)) {
      return;
    }
    ancestors.push(redacted);
    if (current !== redacted) {
      ancestors.push(current);
    }
    if (!hasGetter(current) || isJsonPrimitiveWrapper(current)) {
      return current;
    }
    const view = redactingView(current);
    sources.set(view, current);
    ancestors.push(view);
    return view;
  }, options?.space) ?? "null";
}
function hasGetter(object) {
  for (const key of Object.getOwnPropertyNames(object)) {
    if (Object.getOwnPropertyDescriptor(object, key)?.get !== undefined) {
      return true;
    }
  }
  return false;
}
function redactingView(object) {
  const view = Array.isArray(object) ? [] : {};
  const keys = Array.isArray(object) ? Array.from({
    length: object.length
  }, (_, i) => String(i)) : Object.keys(object);
  for (const key of keys) {
    Object.defineProperty(view, key, {
      enumerable: true,
      get: () => {
        const value = Reflect.get(object, key);
        return Object.getOwnPropertyDescriptor(object, key)?.get !== undefined ? redact(value) : value;
      }
    });
  }
  return view;
}
function isJsonPrimitiveWrapper(object) {
  for (const valueOf of [Number.prototype.valueOf, Boolean.prototype.valueOf, String.prototype.valueOf]) {
    try {
      Reflect.apply(valueOf, object, []);
      return true;
    } catch {}
  }
  return false;
}

var NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var toJson = (input) => {
  try {
    input = redact(input);
    if (hasProperty(input, "toJSON") && isFunction(input["toJSON"]) && input["toJSON"].length === 0) {
      return input.toJSON();
    } else if (Array.isArray(input)) {
      return input.map(toJson);
    }
    return input;
  } catch {
    return "[toJSON threw]";
  }
};
var toStringUnknown = (u, whitespace = 2) => {
  if (typeof u === "string") {
    return u;
  }
  try {
    return typeof u === "object" ? formatJson(u, {
      space: whitespace
    }) : format(u, {
      space: whitespace
    });
  } catch {
    return String(u);
  }
};
var BaseProto = {
  toJSON() {
    return toJson(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};

var isStackTraceLimitWritable = () => {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) {
    return Object.isExtensible(Error);
  }
  return Object.hasOwn(desc, "writable") ? desc.writable === true : desc.set !== undefined;
};
var canWriteStackTraceLimit = /* @__PURE__ */ isStackTraceLimitWritable();
var getStackTraceLimit = () => Error.stackTraceLimit;
var setStackTraceLimit = (value) => {
  if (canWriteStackTraceLimit) {
    Error.stackTraceLimit = value;
  }
};

class SingleShotGen {
  constructor(self) {
    this.value = self;
    this.done = false;
  }
  next(a) {
    if (this.done) {
      this.value = a;
      return this;
    }
    this.done = true;
    return {
      value: this.value,
      done: false
    };
  }
}
var pickInternalCall = () => {
  const InternalTypeId = "~effect/Utils/internal";
  const standard = {
    [InternalTypeId]: (body) => {
      return body();
    }
  };
  const forced = {
    [InternalTypeId]: (body) => {
      try {
        return body();
      } finally {}
    }
  };
  const limit = getStackTraceLimit();
  if (limit === 0)
    return forced[InternalTypeId];
  setStackTraceLimit(2);
  const error = standard[InternalTypeId](() => new Error);
  setStackTraceLimit(limit);
  return error.stack?.includes(InternalTypeId) === true ? standard[InternalTypeId] : forced[InternalTypeId];
};
var internalCall = /* @__PURE__ */ pickInternalCall();

function assignProperty(self, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(self, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    self[key] = value;
  }
}
function assignProperties(self, source) {
  if (!Object.hasOwn(source, "__proto__")) {
    Object.assign(self, source);
    return;
  }
  for (const key of Reflect.ownKeys(source)) {
    if (Object.prototype.propertyIsEnumerable.call(source, key)) {
      assignProperty(self, key, source[key]);
    }
  }
}

var EffectTypeId = `~effect/Effect`;
var ExitTypeId = `~effect/Exit`;
var effectVariance = {
  _A: identity,
  _E: identity,
  _R: identity
};
var identifier = `${EffectTypeId}/identifier`;
var args = `${EffectTypeId}/args`;
var evaluate = `${EffectTypeId}/evaluate`;
var contA = `${EffectTypeId}/successCont`;
var contE = `${EffectTypeId}/failureCont`;
var contAll = `${EffectTypeId}/ensureCont`;
var Yield = /* @__PURE__ */ Symbol.for("effect/Effect/Yield");
var PipeInspectableProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  toJSON() {
    return {
      ...this
    };
  },
  toString() {
    return format(this.toJSON(), {
      ignoreToString: true,
      space: 2
    });
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var StructuralProto = {
  [symbol]() {
    return structureKeys(this, Object.keys(this));
  },
  [symbol2](that) {
    const selfKeys = Object.keys(this);
    if (selfKeys.length !== Object.keys(that).length)
      return false;
    for (const key of selfKeys) {
      if (!Object.prototype.propertyIsEnumerable.call(that, key) || !equals(this[key], that[key])) {
        return false;
      }
    }
    return true;
  }
};
var EffectProto = {
  [EffectTypeId]: effectVariance,
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  },
  toJSON() {
    return {
      _id: "Effect",
      op: this[identifier],
      ...args in this ? {
        args: this[args]
      } : undefined
    };
  }
};
var isEffect = (u) => hasProperty(u, EffectTypeId);
var isExit = (u) => hasProperty(u, ExitTypeId);
var CauseTypeId = "~effect/Cause";
var CauseReasonTypeId = "~effect/Cause/Reason";
var isCause = (self) => hasProperty(self, CauseTypeId);
class CauseImpl {
  constructor(failures) {
    this[CauseTypeId] = CauseTypeId;
    this.reasons = failures;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Cause",
      reasons: this.reasons.map((f) => f.toJSON())
    };
  }
  toString() {
    return `Cause(${format(this.reasons)})`;
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [symbol2](that) {
    return isCause(that) && this.reasons.length === that.reasons.length && this.reasons.every((e, i) => equals(e, that.reasons[i]));
  }
  [symbol]() {
    return array(this.reasons);
  }
}
var annotationsMap = /* @__PURE__ */ new WeakMap;

class ReasonBase {
  [CauseReasonTypeId];
  annotations;
  _tag;
  constructor(_tag, annotations, originalError) {
    this[CauseReasonTypeId] = CauseReasonTypeId;
    this._tag = _tag;
    if (annotations !== constEmptyAnnotations && typeof originalError === "object" && originalError !== null && annotations.size > 0) {
      const prevAnnotations = annotationsMap.get(originalError);
      if (prevAnnotations) {
        annotations = new Map([...prevAnnotations, ...annotations]);
      }
      annotationsMap.set(originalError, annotations);
    }
    this.annotations = annotations;
  }
  annotate(annotations, options) {
    if (annotations.mapUnsafe.size === 0)
      return this;
    const newAnnotations = new Map(this.annotations);
    annotations.mapUnsafe.forEach((value, key) => {
      if (options?.overwrite !== true && newAnnotations.has(key))
        return;
      newAnnotations.set(key, value);
    });
    if (options?.overwrite !== true && newAnnotations.size === this.annotations.size)
      return this;
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.annotations = newAnnotations;
    return self;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toString() {
    return format(this);
  }
  [NodeInspectSymbol]() {
    return this.toString();
  }
}
var constEmptyAnnotations = /* @__PURE__ */ new Map;

class Fail extends ReasonBase {
  constructor(error, annotations = constEmptyAnnotations) {
    super("Fail", annotations, error);
    this.error = error;
  }
  toString() {
    return `Fail(${format(this.error)})`;
  }
  toJSON() {
    return {
      _tag: "Fail",
      error: this.error
    };
  }
  [symbol2](that) {
    return isFailReason(that) && equals(this.error, that.error) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.error))(hash(this.annotations)));
  }
}
var causeFromReasons = (reasons) => new CauseImpl(reasons);
var dedupeReasons = (self, that) => {
  const buckets = new Map;
  const out = [];
  for (const reason of self.concat(that)) {
    const hash2 = hash(reason);
    const bucket = buckets.get(hash2);
    if (bucket === undefined) {
      buckets.set(hash2, [reason]);
    } else if (bucket.some((previous) => equals(previous, reason))) {
      continue;
    } else {
      bucket.push(reason);
    }
    out.push(reason);
  }
  return out;
};
var causeCombine = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.reasons.length === 0) {
    return that;
  } else if (that.reasons.length === 0) {
    return self;
  }
  const newCause = new CauseImpl(dedupeReasons(self.reasons, that.reasons));
  return equals(self, newCause) ? self : newCause;
});
var causeAddInterrupts = (self, interrupts) => {
  const reasons = self.reasons.slice();
  for (const reason of interrupts.reasons) {
    if (isInterruptReason(reason) && !reasons.some((r) => isInterruptReason(r) && r.fiberId === reason.fiberId && r.annotations === reason.annotations)) {
      reasons.push(reason);
    }
  }
  return reasons.length === self.reasons.length ? self : new CauseImpl(reasons);
};
var causeEmpty = /* @__PURE__ */ new CauseImpl([]);
var causeFail = (error) => new CauseImpl([new Fail(error)]);

class Die extends ReasonBase {
  constructor(defect, annotations = constEmptyAnnotations) {
    super("Die", annotations, defect);
    this.defect = defect;
  }
  toString() {
    return `Die(${format(this.defect)})`;
  }
  toJSON() {
    return {
      _tag: "Die",
      defect: this.defect
    };
  }
  [symbol2](that) {
    return isDieReason(that) && equals(this.defect, that.defect) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.defect))(hash(this.annotations)));
  }
}
var causeDie = (defect) => new CauseImpl([new Die(defect)]);
var causeAnnotate = /* @__PURE__ */ dual((args) => isCause(args[0]), (self, annotations, options) => {
  if (annotations.mapUnsafe.size === 0)
    return self;
  return new CauseImpl(self.reasons.map((f) => f.annotate(annotations, options)));
});
var isFailReason = (self) => self._tag === "Fail";
var isDieReason = (self) => self._tag === "Die";
var isInterruptReason = (self) => self._tag === "Interrupt";
function defaultEvaluate(_fiber) {
  return exitDie(`Effect.evaluate: Not implemented`);
}
var makePrimitiveProto = (options) => ({
  ...EffectProto,
  [identifier]: options.op,
  [evaluate]: options[evaluate] ?? defaultEvaluate,
  [contA]: options[contA],
  [contE]: options[contE],
  [contAll]: options[contAll]
});
var makePrimitive = (options) => {
  const Proto = makePrimitiveProto(options);
  const PrimitiveImpl = function(value) {
    this[args] = value;
  };
  PrimitiveImpl.prototype = Proto;
  return function(value) {
    return new PrimitiveImpl(value);
  };
};
var makeExit = (options) => {
  const Proto = {
    [ExitTypeId]: ExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    ...makePrimitiveProto(options),
    toString() {
      return `${options.op}(${format(this[args])})`;
    },
    toJSON() {
      return {
        _id: "Exit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isExit(that) && that._tag === this._tag && equals(this[args], that[args]);
    },
    [symbol]() {
      return combine(string(options.op), hash(this[args]));
    }
  };
  const ExitPrimitive = function(value) {
    this[args] = value;
  };
  ExitPrimitive.prototype = Proto;
  return function(value) {
    return new ExitPrimitive(value);
  };
};
var exitSucceed = /* @__PURE__ */ makeExit({
  op: "Success",
  prop: "value",
  [evaluate](fiber) {
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](this[args], fiber, this) : fiber.yieldWith(this);
  }
});
var StackTraceKey = {
  key: "effect/Cause/StackTrace"
};
var InterruptorStackTrace = {
  key: "effect/Cause/InterruptorStackTrace"
};
var exitFailCause = /* @__PURE__ */ makeExit({
  op: "Failure",
  prop: "cause",
  [evaluate](fiber) {
    let cause = this[args];
    let annotated = false;
    if (fiber.cache.stackFrame) {
      cause = causeAnnotate(cause, {
        mapUnsafe: new Map([[StackTraceKey.key, fiber.cache.stackFrame]])
      });
      annotated = true;
    }
    let cont = fiber.getCont(contE);
    const interruptedCause = fiber._interruptedCause;
    if (interruptedCause && fiber.interruptible) {
      let skippedHandler = false;
      while (cont && fiber.interruptible) {
        skippedHandler ||= identifier in cont;
        cont = fiber.getCont(contE);
      }
      if (skippedHandler) {
        cause = causeFromReasons(cause.reasons.filter((reason) => reason._tag !== "Fail"));
      }
      cause = causeAddInterrupts(cause, interruptedCause);
      annotated = true;
    }
    return cont ? cont[contE](cause, fiber, annotated ? undefined : this) : fiber.yieldWith(annotated ? exitFailCause(cause) : this);
  }
});
var exitFail = (e) => exitFailCause(causeFail(e));
var exitDie = (defect) => exitFailCause(causeDie(defect));
var withFiber = /* @__PURE__ */ makePrimitive({
  op: "WithFiber",
  [evaluate](fiber) {
    return this[args](fiber);
  }
});
var withFiberSucceed = /* @__PURE__ */ makePrimitive({
  op: "WithFiberSucceed",
  [evaluate](fiber) {
    const value = this[args](fiber);
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var YieldableError = /* @__PURE__ */ function() {

  class YieldableError extends globalThis.Error {
  }
  const proto = /* @__PURE__ */ makePrimitiveProto({
    op: "YieldableError",
    [evaluate]() {
      return exitFail(this);
    }
  });
  delete proto.toString;
  Object.assign(YieldableError.prototype, proto);
  return YieldableError;
}();
var Error2 = /* @__PURE__ */ function() {
  const plainArgsSymbol = /* @__PURE__ */ Symbol.for("effect/Data/Error/plainArgs");
  return class Base extends YieldableError {
    constructor(args) {
      super(args?.message, args?.cause ? {
        cause: args.cause
      } : undefined);
      if (args) {
        assignProperties(this, args);
        Object.defineProperty(this, plainArgsSymbol, {
          value: args,
          enumerable: false
        });
      }
    }
    toJSON() {
      return {
        ...this[plainArgsSymbol],
        ...this
      };
    }
  };
}();
var TaggedError = (tag) => {

  class Base extends Error2 {
    _tag = tag;
  }
  Base.prototype.name = tag;
  return Base;
};
var NoSuchElementErrorTypeId = "~effect/Cause/NoSuchElementError";
class NoSuchElementError extends (/* @__PURE__ */ TaggedError("NoSuchElementError")) {
  [NoSuchElementErrorTypeId] = NoSuchElementErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
}
var DoneTypeId = "~effect/Cause/Done";
var isDone = (u) => hasProperty(u, DoneTypeId);
var DoneVoid = {
  [DoneTypeId]: DoneTypeId,
  _tag: "Done",
  value: undefined
};
var Done = (value) => {
  if (value === undefined)
    return DoneVoid;
  return {
    [DoneTypeId]: DoneTypeId,
    _tag: "Done",
    value
  };
};
var doneVoid = /* @__PURE__ */ exitFail(DoneVoid);
var done = (value) => {
  if (value === undefined)
    return doneVoid;
  return exitFail(Done(value));
};

var Prototype2 = (options) => makePrimitiveProto({
  op: options.label,
  [evaluate]: options.evaluate
});

var TypeId = "~effect/Option";
var CommonProto = {
  [TypeId]: {
    _A: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SomeProto = /* @__PURE__ */ Object.defineProperty(/* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "Some",
  _op: "Some",
  [symbol2](that) {
    return isOption(that) && isSome(that) && equals(this.value, that.value);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.value));
  },
  toString() {
    return `some(${format(this.value)})`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag,
      value: toJson(this.value)
    };
  }
}), "valueOrUndefined", {
  get() {
    return this.value;
  }
});
var NoneHash = /* @__PURE__ */ hash("None");
var NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "None",
  _op: "None",
  valueOrUndefined: undefined,
  [symbol2](that) {
    return isOption(that) && isNone(that);
  },
  [symbol]() {
    return NoneHash;
  },
  toString() {
    return `none()`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag
    };
  }
});
var isOption = (input) => hasProperty(input, TypeId);
var isNone = (fa) => fa._tag === "None";
var isSome = (fa) => fa._tag === "Some";
var none = /* @__PURE__ */ Object.create(NoneProto);
var SomeImpl = function(value) {
  this.value = value;
};
SomeImpl.prototype = SomeProto;
var some = (value) => new SomeImpl(value);

var TypeId2 = "~effect/Result";
var CommonProto2 = {
  [TypeId2]: {
    _A: (_) => _,
    _E: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SuccessProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Success",
  _op: "Success",
  [symbol2](that) {
    return isResult(that) && isSuccess(that) && equals(this.success, that.success);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.success));
  },
  toString() {
    return `success(${format(this.success)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      value: toJson(this.success)
    };
  }
});
var FailureProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Failure",
  _op: "Failure",
  [symbol2](that) {
    return isResult(that) && isFailure(that) && equals(this.failure, that.failure);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.failure));
  },
  toString() {
    return `failure(${format(this.failure)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      failure: toJson(this.failure)
    };
  }
});
var isResult = (input) => hasProperty(input, TypeId2);
var isFailure = (result) => result._tag === "Failure";
var isSuccess = (result) => result._tag === "Success";
var FailureImpl = function(failure) {
  this.failure = failure;
};
FailureImpl.prototype = FailureProto;
var fail = (failure) => new FailureImpl(failure);
var SuccessImpl = function(success) {
  this.success = success;
};
SuccessImpl.prototype = SuccessProto;
var succeed = (success) => new SuccessImpl(success);

function make(compare) {
  return (self, that) => self === that ? 0 : compare(self, that);
}
var Number2 = /* @__PURE__ */ make((self, that) => {
  if (globalThis.Number.isNaN(self) && globalThis.Number.isNaN(that))
    return 0;
  if (globalThis.Number.isNaN(self))
    return -1;
  if (globalThis.Number.isNaN(that))
    return 1;
  return self < that ? -1 : 1;
});
var mapInput = /* @__PURE__ */ dual(2, (self, f) => make((b1, b2) => self(f(b1), f(b2))));
var isGreaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var isLessThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== 1);
var isGreaterThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== -1);

var none2 = () => none;
var some2 = some;
var isNone2 = isNone;
var isSome2 = isSome;
var filter = /* @__PURE__ */ dual(2, (self, predicate) => isNone2(self) ? none2() : predicate(self.value) ? some2(self.value) : none2());

var ServiceTypeId = "~effect/Context/Service";
var Service = function() {
  function KeyClass() {}
  const self = KeyClass;
  Object.setPrototypeOf(self, ServiceProto);
  const init = (key, options) => {
    self.key = key;
    if (options?.defaultValue) {
      self[ReferenceTypeId] = ReferenceTypeId;
      self.defaultValue = options.defaultValue;
    }
    if (options?.make) {
      self.make = options.make;
    }
    if (options?.fiberCached) {
      cacheKeys.add(key);
    }
    return self;
  };
  return arguments.length > 0 ? init(arguments[0], arguments[1]) : init;
};
var ServiceProto = {
  [ServiceTypeId]: ServiceTypeId,
  .../* @__PURE__ */ Prototype2({
    label: "Service",
    evaluate(fiber) {
      return exitSucceed(get(fiber.context, this));
    }
  }),
  toJSON() {
    return {
      _id: "Service",
      key: this.key
    };
  },
  of(self) {
    return self;
  },
  context(self) {
    return make2(this, self);
  },
  use(f) {
    return withFiber((fiber) => f(get(fiber.context, this)));
  },
  useSync(f) {
    return withFiber((fiber) => exitSucceed(f(get(fiber.context, this))));
  }
};
var cacheKeys = /* @__PURE__ */ new Set;
var ReferenceTypeId = "~effect/Context/Reference";
var TypeId3 = "~effect/Context";
var FlattenAfterBaseHits = 8;
var makeImpl = (cacheRoot, base, overlay, depth, maxDepth) => {
  const self = Object.create(Proto);
  self.cacheRoot = cacheRoot ?? self;
  self.base = base;
  self.overlay = overlay;
  self.depth = depth;
  self._flat = undefined;
  self.baseHits = 0;
  self.maxDepth = maxDepth;
  return self;
};
var applyOverlays = (map, overlay) => {
  if (!overlay)
    return;
  applyOverlays(map, overlay.parent);
  map.set(overlay.key, overlay.value);
};
var flatten = (self) => {
  if (self._flat)
    return self._flat;
  if (!self.overlay)
    return self._flat = self.base;
  const map = new Map(self.base);
  applyOverlays(map, self.overlay);
  return self._flat = map;
};
var withFlat = (self, f) => {
  const map = new Map(self.mapUnsafe);
  f(map);
  return makeImpl(undefined, map, undefined, 0, self.maxDepth);
};
var notFound = /* @__PURE__ */ Symbol();
var lookup = (self, key) => {
  const impl = self;
  for (let overlay = impl.overlay;overlay; overlay = overlay.parent) {
    if (overlay.key === key)
      return overlay.value;
  }
  const value = impl.base.get(key);
  if (value === undefined && !impl.base.has(key))
    return notFound;
  if (impl.overlay && ++impl.baseHits >= impl.base.size && impl.baseHits >= FlattenAfterBaseHits) {
    impl.base = flatten(impl);
    impl.overlay = undefined;
    impl.depth = 0;
  }
  return value;
};
var makeUnsafe = (mapUnsafe, options) => {
  const maxDepth = options?.maxDepth;
  return makeImpl(undefined, mapUnsafe, undefined, 0, Number.isInteger(maxDepth) && maxDepth >= 0 ? maxDepth : 8);
};
var Proto = {
  get mapUnsafe() {
    return flatten(this);
  },
  ...PipeInspectableProto,
  [TypeId3]: {
    _Services: (_) => _
  },
  toJSON() {
    return {
      _id: "Context",
      services: Array.from(this.mapUnsafe).map(([key, value]) => ({
        key,
        value
      }))
    };
  },
  [symbol2](that) {
    if (!isContext(that))
      return false;
    const self = this.mapUnsafe;
    const other = that.mapUnsafe;
    if (self.size !== other.size)
      return false;
    for (const [key, value] of self) {
      if (!other.has(key) || !equals(value, other.get(key)))
        return false;
    }
    return true;
  },
  [symbol]() {
    return number(this.mapUnsafe.size);
  }
};
var hasSameCache = (self, that) => self.cacheRoot === that.cacheRoot;
var isContext = (u) => hasProperty(u, TypeId3);
var isReference = (u) => !!u[ReferenceTypeId];
var empty = () => emptyContext2;
var emptyContext2 = /* @__PURE__ */ makeUnsafe(/* @__PURE__ */ new Map);
var make2 = (key, service) => makeUnsafe(new Map([[key.key, service]]));
var add = /* @__PURE__ */ dual(3, (self, key, service) => addUnsafe(self, key.key, service));
var addUnsafe = (self, key, service) => {
  const impl = self;
  const cacheRoot = cacheKeys.has(key) ? undefined : impl.cacheRoot;
  if (impl.depth >= impl.maxDepth) {
    const map = new Map(impl._flat ?? impl.base);
    if (!impl._flat)
      applyOverlays(map, impl.overlay);
    map.set(key, service);
    return makeImpl(cacheRoot, map, undefined, 0, impl.maxDepth);
  }
  return makeImpl(cacheRoot, impl.base, {
    key,
    value: service,
    parent: impl.overlay
  }, impl.depth + 1, impl.maxDepth);
};
var getOrUndefinedUnsafe = (self, key) => {
  const value = lookup(self, key);
  return value === notFound ? undefined : value;
};
var getUnsafe = /* @__PURE__ */ dual(2, (self, service) => {
  const value = lookup(self, service.key);
  if (value === notFound) {
    if (isReference(service))
      return getDefaultValue(service);
    throw serviceNotFoundError(service);
  }
  return value;
});
var get = getUnsafe;
var defaultValueCacheKey = "~effect/Context/defaultValue";
var getDefaultValue = (ref) => {
  if (defaultValueCacheKey in ref) {
    return ref[defaultValueCacheKey];
  }
  return ref[defaultValueCacheKey] = ref.defaultValue();
};
var serviceNotFoundError = (service) => {
  const error = new Error(`Service not found${service.key ? `: ${String(service.key)}` : ""}`);
  if (error.stack) {
    const lines = error.stack.split(`
`);
    lines.splice(1, 3);
    error.stack = lines.join(`
`);
  }
  return error;
};
var merge = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.mapUnsafe.size === 0)
    return that;
  if (that.mapUnsafe.size === 0)
    return self;
  return withFlat(self, (map) => that.mapUnsafe.forEach((value, key) => map.set(key, value)));
});
var Reference = Service;

var isArrayNonEmpty = (self) => self.length > 0;

var succeed2 = succeed;
var fail2 = fail;
var try_ = (evaluate) => {
  if (isFunction(evaluate)) {
    try {
      return succeed2(evaluate());
    } catch (e) {
      return fail2(e);
    }
  } else {
    try {
      return succeed2(evaluate.try());
    } catch (e) {
      return fail2(evaluate.catch(e));
    }
  }
};
var isFailure2 = isFailure;
var mapError = /* @__PURE__ */ dual(2, (self, f) => isFailure2(self) ? fail2(f(self.failure)) : self);
var match = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => isFailure2(self) ? onFailure(self.failure) : onSuccess(self.success));
var getOrElse = /* @__PURE__ */ dual(2, (self, onFailure) => isFailure2(self) ? onFailure(self.failure) : self.success);
var getOrUndefined = /* @__PURE__ */ getOrElse(constUndefined);
var flatMap = /* @__PURE__ */ dual(2, (self, f) => isFailure2(self) ? fail2(self.failure) : f(self.success));
var all = (input) => {
  if (Symbol.iterator in input) {
    const out = [];
    for (const e of input) {
      if (isFailure2(e)) {
        return e;
      }
      out.push(e.success);
    }
    return succeed2(out);
  }
  const out = {};
  for (const key of Object.keys(input)) {
    const e = input[key];
    if (isFailure2(e)) {
      return e;
    }
    assignProperty(out, key, e.success);
  }
  return succeed2(out);
};
var gen = (...args) => {
  const f = args.length === 1 ? args[0] : args[1].bind(args[0]);
  const iterator = f();
  let state = iterator.next();
  while (!state.done) {
    const current = state.value;
    if (isFailure2(current)) {
      return current;
    }
    state = iterator.next(current.success);
  }
  return succeed2(state.value);
};

var Array2 = globalThis.Array;
var fromIterable = (collection) => Array2.isArray(collection) ? collection : Array2.from(collection);
var append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
var isArray = Array2.isArray;
var isArrayNonEmpty2 = isArrayNonEmpty;
var isReadonlyArrayNonEmpty = isArrayNonEmpty;
var empty2 = () => [];
var map = /* @__PURE__ */ dual(2, (self, f) => self.map(f));

var TypeId4 = "~effect/Duration";
var bigint0 = /* @__PURE__ */ BigInt(0);
var bigint1 = /* @__PURE__ */ BigInt(1);
var bigint2 = /* @__PURE__ */ BigInt(2);
var bigint10 = /* @__PURE__ */ BigInt(10);
var bigint24 = /* @__PURE__ */ BigInt(24);
var bigint60 = /* @__PURE__ */ BigInt(60);
var bigint1e3 = /* @__PURE__ */ BigInt(1000);
var bigint1e6 = /* @__PURE__ */ BigInt(1e6);
var bigint1e9 = /* @__PURE__ */ BigInt(1e9);
var bigintNanosPerMinute = /* @__PURE__ */ BigInt(60000000000);
var bigintNanosPerHour = /* @__PURE__ */ BigInt(3600000000000);
var bigintNanosPerDay = /* @__PURE__ */ BigInt(86400000000000);
var bigintNanosPerWeek = /* @__PURE__ */ BigInt(604800000000000);
var roundTiesAwayFromZero = (input) => BigInt(Math.sign(input) * Math.round(Math.abs(input)));
var roundMillisToNanos = (millis) => Number.isInteger(millis) ? BigInt(millis) * bigint1e6 : roundTiesAwayFromZero(millis * 1e6);
var fromNanosNumber = (nanos) => make3(Number.isFinite(nanos) ? roundTiesAwayFromZero(nanos) : nanos);
var nanosToUnit = (nanos, divisor) => {
  const value = Number(nanos);
  if (Number.isFinite(value))
    return value / divisor;
  const scale = BigInt(divisor);
  return Number(nanos / scale) + Number(nanos % scale) / divisor;
};
var parseNanos = (input, scale) => {
  const decimalIndex = input.indexOf(".");
  if (decimalIndex === -1)
    return BigInt(input) * scale;
  const isNegative = input[0] === "-";
  const fractional = input.slice(decimalIndex + 1);
  const fractionalScale = bigint10 ** BigInt(fractional.length);
  const scaled = (BigInt(input.slice(isNegative ? 1 : 0, decimalIndex)) * fractionalScale + BigInt(fractional)) * scale;
  return divideTiesAwayFromZero(isNegative ? -scaled : scaled, fractionalScale);
};
var divideTiesAwayFromZero = (numerator, denominator) => {
  const absolute = numerator < bigint0 ? -numerator : numerator;
  const rounded = absolute / denominator + (absolute % denominator * bigint2 >= denominator ? bigint1 : bigint0);
  return numerator < bigint0 ? -rounded : rounded;
};
var fromMillisString = (input, scale) => {
  const millis = Number(input) * scale;
  if (!Number.isFinite(millis))
    return make3(millis);
  const nanos = parseNanos(input, BigInt(scale) * bigint1e6);
  return make3(Number.isInteger(millis) && BigInt(millis) * bigint1e6 === nanos ? millis : nanos);
};
var DURATION_REGEXP = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
var fromInputUnsafe = (input) => {
  switch (typeof input) {
    case "number":
      return millis(input);
    case "bigint":
      return nanos(input);
    case "string": {
      if (input === "Infinity") {
        return infinity;
      }
      if (input === "-Infinity") {
        return negativeInfinity;
      }
      const match = DURATION_REGEXP.exec(input);
      if (!match)
        break;
      const [_, valueStr, unit] = match;
      if (unit === "nano" || unit === "nanos") {
        return nanos(parseNanos(valueStr, bigint1));
      }
      if (unit === "micro" || unit === "micros") {
        return nanos(parseNanos(valueStr, bigint1e3));
      }
      switch (unit) {
        case "milli":
        case "millis":
          return fromMillisString(valueStr, 1);
        case "second":
        case "seconds":
          return fromMillisString(valueStr, 1000);
        case "minute":
        case "minutes":
          return fromMillisString(valueStr, 60000);
        case "hour":
        case "hours":
          return fromMillisString(valueStr, 3600000);
        case "day":
        case "days":
          return fromMillisString(valueStr, 86400000);
        case "week":
        case "weeks":
          return fromMillisString(valueStr, 604800000);
      }
      break;
    }
    case "object": {
      if (input === null)
        break;
      if (TypeId4 in input)
        return input;
      if (Array.isArray(input)) {
        if (input.length !== 2 || !input.every(isNumber)) {
          return invalid(input);
        }
        if (Number.isNaN(input[0]) || Number.isNaN(input[1])) {
          return zero;
        }
        if (input[0] === -Infinity || input[1] === -Infinity) {
          return negativeInfinity;
        }
        if (input[0] === Infinity || input[1] === Infinity) {
          return infinity;
        }
        const nanos = input[0] * 1e9 + input[1];
        return Number.isFinite(nanos) && Number.isInteger(input[0]) && Number.isInteger(input[1]) ? make3(BigInt(input[0]) * bigint1e9 + BigInt(input[1])) : fromNanosNumber(nanos);
      }
      const obj = input;
      let millis = 0;
      if (obj.weeks)
        millis += obj.weeks * 604800000;
      if (obj.days)
        millis += obj.days * 86400000;
      if (obj.hours)
        millis += obj.hours * 3600000;
      if (obj.minutes)
        millis += obj.minutes * 60000;
      if (obj.seconds)
        millis += obj.seconds * 1000;
      if (obj.milliseconds)
        millis += obj.milliseconds;
      if (!obj.microseconds && !obj.nanoseconds) {
        if (!Number.isFinite(millis))
          return make3(millis);
        const exact = sumObjectNanos(obj);
        return exact === undefined || BigInt(millis) * bigint1e6 === exact ? make3(millis) : make3(exact);
      }
      const nanos = millis * 1e6 + (obj.microseconds ?? 0) * 1000 + (obj.nanoseconds ?? 0);
      const exact = Number.isFinite(nanos) ? sumObjectNanos(obj) : undefined;
      return exact === undefined ? fromNanosNumber(nanos) : make3(exact);
    }
  }
  return invalid(input);
};
var isIntegerOrUnset = (n) => !n || Number.isInteger(n);
var sumObjectNanos = (obj) => {
  if (!isIntegerOrUnset(obj.weeks) || !isIntegerOrUnset(obj.days) || !isIntegerOrUnset(obj.hours) || !isIntegerOrUnset(obj.minutes) || !isIntegerOrUnset(obj.seconds) || !isIntegerOrUnset(obj.milliseconds) || !isIntegerOrUnset(obj.microseconds) || !isIntegerOrUnset(obj.nanoseconds))
    return;
  let nanos = bigint0;
  if (obj.weeks)
    nanos += BigInt(obj.weeks) * bigintNanosPerWeek;
  if (obj.days)
    nanos += BigInt(obj.days) * bigintNanosPerDay;
  if (obj.hours)
    nanos += BigInt(obj.hours) * bigintNanosPerHour;
  if (obj.minutes)
    nanos += BigInt(obj.minutes) * bigintNanosPerMinute;
  if (obj.seconds)
    nanos += BigInt(obj.seconds) * bigint1e9;
  if (obj.milliseconds)
    nanos += BigInt(obj.milliseconds) * bigint1e6;
  if (obj.microseconds)
    nanos += BigInt(obj.microseconds) * bigint1e3;
  if (obj.nanoseconds)
    nanos += BigInt(obj.nanoseconds);
  return nanos;
};
var invalid = (input) => {
  throw new Error(`Invalid Input: ${input}`);
};
var zeroDurationValue = {
  _tag: "Millis",
  millis: 0
};
var infinityDurationValue = {
  _tag: "Infinity"
};
var negativeInfinityDurationValue = {
  _tag: "NegativeInfinity"
};
var DurationProto = {
  [TypeId4]: TypeId4,
  [symbol]() {
    switch (this.value._tag) {
      case "Millis":
        return hash(roundMillisToNanos(this.value.millis));
      case "Nanos":
        return hash(this.value.nanos);
      default:
        return structure(this.value);
    }
  },
  [symbol2](that) {
    return isDuration(that) && equals2(this, that);
  },
  toString() {
    switch (this.value._tag) {
      case "Infinity":
        return "Infinity";
      case "NegativeInfinity":
        return "-Infinity";
      case "Nanos":
        return `${this.value.nanos} nanos`;
      case "Millis":
        return `${this.value.millis} millis`;
    }
  },
  toJSON() {
    switch (this.value._tag) {
      case "Millis":
        return {
          _id: "Duration",
          _tag: "Millis",
          millis: this.value.millis
        };
      case "Nanos":
        return {
          _id: "Duration",
          _tag: "Nanos",
          nanos: String(this.value.nanos)
        };
      case "Infinity":
        return {
          _id: "Duration",
          _tag: "Infinity"
        };
      case "NegativeInfinity":
        return {
          _id: "Duration",
          _tag: "NegativeInfinity"
        };
    }
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make3 = (input) => {
  const duration = Object.create(DurationProto);
  if (typeof input === "number") {
    if (isNaN(input) || input === 0 || Object.is(input, -0)) {
      duration.value = zeroDurationValue;
    } else if (!Number.isFinite(input)) {
      duration.value = input > 0 ? infinityDurationValue : negativeInfinityDurationValue;
    } else if (!Number.isInteger(input)) {
      duration.value = {
        _tag: "Nanos",
        nanos: roundMillisToNanos(input)
      };
    } else {
      duration.value = {
        _tag: "Millis",
        millis: input
      };
    }
  } else if (input === bigint0) {
    duration.value = zeroDurationValue;
  } else {
    duration.value = {
      _tag: "Nanos",
      nanos: input
    };
  }
  return duration;
};
var isDuration = (u) => hasProperty(u, TypeId4);
var isZero = (self) => {
  switch (self.value._tag) {
    case "Millis":
      return self.value.millis === 0;
    case "Nanos":
      return self.value.nanos === bigint0;
    case "Infinity":
    case "NegativeInfinity":
      return false;
  }
};
var isNegative = (self) => {
  switch (self.value._tag) {
    case "Millis":
      return self.value.millis < 0;
    case "Nanos":
      return self.value.nanos < bigint0;
    case "NegativeInfinity":
      return true;
    case "Infinity":
      return false;
  }
};
var abs = (self) => {
  switch (self.value._tag) {
    case "Infinity":
    case "NegativeInfinity":
      return infinity;
    case "Millis":
      return self.value.millis < 0 ? make3(-self.value.millis) : self;
    case "Nanos":
      return self.value.nanos < bigint0 ? make3(-self.value.nanos) : self;
  }
};
var zero = /* @__PURE__ */ make3(0);
var infinity = /* @__PURE__ */ make3(Infinity);
var negativeInfinity = /* @__PURE__ */ make3(-Infinity);
var nanos = (nanos) => make3(nanos);
var millis = (millis) => make3(millis);
var toMillis = (self) => match2(fromInputUnsafe(self), {
  onMillis: identity,
  onNanos: (nanos) => nanosToUnit(nanos, 1e6),
  onInfinity: () => Infinity,
  onNegativeInfinity: () => -Infinity
});
var toNanosUnsafe = (input) => {
  const self = fromInputUnsafe(input);
  switch (self.value._tag) {
    case "Infinity":
    case "NegativeInfinity":
      throw new Error("Cannot convert infinite duration to nanos");
    case "Nanos":
      return self.value.nanos;
    case "Millis":
      return roundMillisToNanos(self.value.millis);
  }
};
var match2 = /* @__PURE__ */ dual(2, (self, options) => {
  switch (self.value._tag) {
    case "Millis":
      return options.onMillis(self.value.millis);
    case "Nanos":
      return options.onNanos(self.value.nanos);
    case "Infinity":
      return options.onInfinity();
    case "NegativeInfinity":
      return (options.onNegativeInfinity ?? options.onInfinity)();
  }
});
var matchPair = /* @__PURE__ */ dual(3, (self, that, options) => {
  if (self.value._tag === "Infinity" || self.value._tag === "NegativeInfinity" || that.value._tag === "Infinity" || that.value._tag === "NegativeInfinity")
    return options.onInfinity(self, that);
  if (self.value._tag === "Millis") {
    return that.value._tag === "Millis" ? options.onMillis(self.value.millis, that.value.millis) : options.onNanos(toNanosUnsafe(self), that.value.nanos);
  } else {
    return options.onNanos(self.value.nanos, toNanosUnsafe(that));
  }
});
var Equivalence = (self, that) => matchPair(self, that, {
  onMillis: (self, that) => self === that,
  onNanos: (self, that) => self === that,
  onInfinity: (self, that) => self.value._tag === that.value._tag
});
var equals2 = /* @__PURE__ */ dual(2, (self, that) => Equivalence(self, that));
var parts = (self) => {
  if (self.value._tag === "Infinity") {
    return {
      days: Infinity,
      hours: Infinity,
      minutes: Infinity,
      seconds: Infinity,
      millis: Infinity,
      nanos: Infinity
    };
  }
  if (self.value._tag === "NegativeInfinity") {
    return {
      days: -Infinity,
      hours: -Infinity,
      minutes: -Infinity,
      seconds: -Infinity,
      millis: -Infinity,
      nanos: -Infinity
    };
  }
  const n = toNanosUnsafe(self);
  const neg = n < bigint0;
  const a = neg ? -n : n;
  const ms = a / bigint1e6;
  const sec = ms / bigint1e3;
  const min = sec / bigint60;
  const hr = min / bigint60;
  const d = hr / bigint24;
  const sign = neg ? -1 : 1;
  return {
    days: sign * Number(d),
    hours: sign * Number(hr % bigint24),
    minutes: sign * Number(min % bigint60),
    seconds: sign * Number(sec % bigint60),
    millis: sign * Number(ms % bigint1e3),
    nanos: sign * Number(a % bigint1e6)
  };
};
var format2 = (self) => {
  if (self.value._tag === "Infinity") {
    return "Infinity";
  }
  if (self.value._tag === "NegativeInfinity") {
    return "-Infinity";
  }
  if (isZero(self)) {
    return "0";
  }
  if (isNegative(self)) {
    return "-" + format2(abs(self));
  }
  const fragments = parts(self);
  const pieces = [];
  if (fragments.days !== 0) {
    pieces.push(`${fragments.days}d`);
  }
  if (fragments.hours !== 0) {
    pieces.push(`${fragments.hours}h`);
  }
  if (fragments.minutes !== 0) {
    pieces.push(`${fragments.minutes}m`);
  }
  if (fragments.seconds !== 0) {
    pieces.push(`${fragments.seconds}s`);
  }
  if (fragments.millis !== 0) {
    pieces.push(`${fragments.millis}ms`);
  }
  if (fragments.nanos !== 0) {
    pieces.push(`${fragments.nanos}ns`);
  }
  return pieces.join(" ");
};

var Scheduler = /* @__PURE__ */ Reference("effect/Scheduler", {
  fiberCached: true,
  defaultValue: () => new MixedScheduler
});
var setMicrotask = (f) => {
  let cancelled = false;
  Promise.resolve().then(() => {
    if (!cancelled)
      f();
  });
  return () => {
    cancelled = true;
  };
};
var setTimer = "setImmediate" in globalThis ? (f) => {
  const timer = globalThis.setImmediate(f);
  return () => globalThis.clearImmediate(timer);
} : (f) => {
  const timer = setTimeout(f, 0);
  return () => clearTimeout(timer);
};
var setImmediate = (f) => {
  try {
    return setTimer(f);
  } catch {
    return setMicrotask(f);
  }
};

class PriorityBuckets {
  buckets = [];
  scheduleTask(task, priority) {
    const buckets = this.buckets;
    const len = buckets.length;
    let bucket;
    let index = 0;
    for (;index < len; index++) {
      if (buckets[index][0] > priority)
        break;
      bucket = buckets[index];
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === len) {
      buckets.push([priority, [task]]);
    } else {
      buckets.splice(index, 0, [priority, [task]]);
    }
  }
  drain() {
    const buckets = this.buckets;
    this.buckets = [];
    return buckets;
  }
}

class MixedScheduler {
  executionMode;
  setImmediate;
  constructor(executionMode = "async", setImmediateFn) {
    this.executionMode = executionMode;
    this.setImmediate = setImmediateFn ?? (executionMode === "sync" ? setMicrotask : setImmediate);
  }
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.cache.maxOpsBeforeYield;
  }
  makeDispatcher() {
    return new MixedSchedulerDispatcher(this.setImmediate);
  }
}

class MixedSchedulerDispatcher {
  tasks = /* @__PURE__ */ new PriorityBuckets;
  running = undefined;
  setImmediate;
  constructor(setImmediateFn = setImmediate) {
    this.setImmediate = setImmediateFn;
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (this.running === undefined) {
      this.running = this.setImmediate(this.afterScheduled);
    }
  }
  afterScheduled = () => {
    this.running = undefined;
    this.runTasks();
  };
  runTasks() {
    const buckets = this.tasks.drain();
    for (let i = 0;i < buckets.length; i++) {
      const toRun = buckets[i][1];
      for (let j = 0;j < toRun.length; j++) {
        toRun[j]();
      }
    }
  }
  flush() {
    while (this.tasks.buckets.length > 0) {
      if (this.running !== undefined) {
        this.running();
        this.running = undefined;
      }
      this.runTasks();
    }
  }
}
var MaxOpsBeforeYield = /* @__PURE__ */ Reference("effect/Scheduler/MaxOpsBeforeYield", {
  fiberCached: true,
  defaultValue: () => 2048
});
var PreventSchedulerYield = /* @__PURE__ */ Reference("effect/Scheduler/PreventSchedulerYield", {
  fiberCached: true,
  defaultValue: () => false
});

var TaggedError2 = TaggedError;

var EncodingErrorTypeId = "~effect/encoding/EncodingError";

class EncodingError extends (/* @__PURE__ */ TaggedError2("EncodingError")) {
  [EncodingErrorTypeId] = EncodingErrorTypeId;
}

var ParentSpanKey = "effect/Tracer/ParentSpan";
var TracerKey = "effect/Tracer";

var FiberRuntimeMetricsKey = "effect/Metric/FiberRuntimeMetrics";

var CurrentStackFrame = /* @__PURE__ */ Reference("effect/References/CurrentStackFrame", {
  fiberCached: true,
  defaultValue: constUndefined
});
var TracerEnabled = /* @__PURE__ */ Reference("effect/References/TracerEnabled", {
  fiberCached: true,
  defaultValue: constTrue
});
var CurrentLogAnnotations = /* @__PURE__ */ Reference("effect/References/CurrentLogAnnotations", {
  defaultValue: () => ({})
});
var CurrentLogLevel = /* @__PURE__ */ Reference("effect/References/CurrentLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var MinimumLogLevel = /* @__PURE__ */ Reference("effect/References/MinimumLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var UnhandledLogLevel = /* @__PURE__ */ Reference("effect/References/UnhandledLogLevel", {
  defaultValue: () => "Error"
});
var CurrentLogSpans = /* @__PURE__ */ Reference("effect/References/CurrentLogSpans", {
  defaultValue: () => []
});

class Interrupt extends ReasonBase {
  constructor(fiberId, annotations = constEmptyAnnotations) {
    super("Interrupt", annotations, "Interrupted");
    this.fiberId = fiberId;
  }
  toString() {
    return `Interrupt(${this.fiberId})`;
  }
  toJSON() {
    return {
      _tag: "Interrupt",
      fiberId: this.fiberId
    };
  }
  [symbol2](that) {
    return isInterruptReason(that) && this.fiberId === that.fiberId && this.annotations === that.annotations;
  }
  [symbol]() {
    return string(`${this._tag}:${this.fiberId}`);
  }
}
var causeInterrupt = (fiberId) => new CauseImpl([new Interrupt(fiberId)]);
var hasFails = (self) => self.reasons.some(isFailReason);
var findError = (self) => {
  for (let i = 0;i < self.reasons.length; i++) {
    const reason = self.reasons[i];
    if (reason._tag === "Fail") {
      return succeed2(reason.error);
    }
  }
  return fail2(self);
};
var hasDies = (self) => self.reasons.some(isDieReason);
var causeElectDefects = (self) => hasDies(self) && hasFails(self) ? causeFromReasons(self.reasons.map((reason) => reason._tag === "Fail" && !isDone(reason.error) ? new Die(reason.error, reason.annotations) : reason)) : self;
var findRecoverableError = (self) => hasDies(self) ? fail2(causeElectDefects(self)) : findError(self);
var hasInterrupts = (self) => self.reasons.some(isInterruptReason);
var causeMap = /* @__PURE__ */ dual(2, (self, f) => {
  let hasFail = false;
  const failures = self.reasons.map((failure) => {
    if (isFailReason(failure)) {
      hasFail = true;
      return new Fail(f(failure.error), failure.annotations);
    }
    return failure;
  });
  return hasFail ? causeFromReasons(failures) : self;
});
var causeSquash = (self) => {
  let die;
  for (const reason of self.reasons) {
    if (reason._tag === "Fail")
      return reason.error;
    if (reason._tag === "Die")
      die ??= reason;
  }
  if (die !== undefined)
    return die.defect;
  if (self.reasons.length > 0)
    return new globalThis.Error("All fibers interrupted without error");
  return new globalThis.Error("Empty cause");
};
var causePrettyErrors = (self, options) => {
  const errors = [];
  const interrupts = [];
  if (self.reasons.length === 0)
    return errors;
  const prevStackLimit = getStackTraceLimit();
  if (prevStackLimit !== 0)
    setStackTraceLimit(1);
  try {
    for (const failure of self.reasons) {
      if (failure._tag === "Interrupt") {
        interrupts.push(failure);
        continue;
      }
      errors.push(causePrettyError(failure._tag === "Die" ? failure.defect : failure.error, failure.annotations, options));
    }
    if (errors.length === 0) {
      const cause = new Error("The fiber was interrupted by:");
      cause.name = "InterruptCause";
      cause.stack = interruptCauseStack(cause, interrupts);
      const error = new globalThis.Error("All fibers interrupted without error", {
        cause
      });
      error.name = "InterruptError";
      error.stack = `${error.name}: ${error.message}`;
      errors.push(causePrettyError(error, interrupts[0].annotations, options));
    }
  } finally {
    if (prevStackLimit !== 0)
      setStackTraceLimit(prevStackLimit);
  }
  return errors;
};
var causePrettyError = (original, annotations, options, seen = new Set) => {
  const kind = typeof original;
  let error;
  if (original && kind === "object") {
    seen.add(original);
    const cause = original.cause;
    error = new globalThis.Error(causePrettyMessage(original), {
      cause: cause !== undefined && !seen.has(cause) ? causePrettyError(cause, undefined, undefined, seen) : undefined
    });
    if (typeof original.name === "string") {
      error.name = original.name;
    }
    if (typeof original.stack === "string") {
      error.stack = cleanErrorStack(original.stack, error, annotations);
    } else {
      const stack = `${error.name}: ${error.message}`;
      error.stack = annotations ? addStackAnnotations(stack, annotations) : stack;
    }
    if (options?.includeCauseInStack) {
      error.stack = renderPrettyError(error);
    }
    for (const key of Object.keys(original)) {
      if (!(key in error)) {
        error[key] = original[key];
      }
    }
  } else {
    error = new globalThis.Error(!original ? `Unknown error: ${original}` : kind === "string" ? original : formatJson(original));
    const stack = `${error.name}: ${error.message}`;
    error.stack = annotations ? addStackAnnotations(stack, annotations) : stack;
  }
  return error;
};
var causePrettyMessage = (u) => {
  if (typeof u.message === "string") {
    return u.message;
  } else if (typeof u.toString === "function" && u.toString !== Object.prototype.toString && u.toString !== Array.prototype.toString) {
    try {
      return u.toString();
    } catch {}
  }
  return formatJson(u);
};
var locationRegExp = /\((.*)\)/g;
var cleanErrorStack = (stack, error, annotations) => {
  const message = `${error.name}: ${error.message}`;
  const lines = (stack.startsWith(message) ? stack.slice(message.length) : stack).split(`
`);
  const out = [message];
  for (let i = 1;i < lines.length; i++) {
    if (/Generator\.next|~effect\/(?:Effect|Utils)/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return annotations ? addStackAnnotations(out.join(`
`), annotations) : out.join(`
`);
};
var addStackAnnotations = (stack, annotations) => {
  const frame = annotations?.get(StackTraceKey.key);
  if (frame) {
    stack = `${stack}
${currentStackTrace(frame)}`;
  }
  return stack;
};
var interruptCauseStack = (error, interrupts) => {
  const out = [`${error.name}: ${error.message}`];
  for (const current of interrupts) {
    const fiberId = current.fiberId !== undefined ? `#${current.fiberId}` : "unknown";
    const frame = current.annotations.get(InterruptorStackTrace.key);
    out.push(`    at fiber (${fiberId})`);
    if (frame)
      out.push(currentStackTrace(frame));
  }
  return out.join(`
`);
};
var currentStackTrace = (frame) => {
  const out = [];
  let current = frame;
  let i = 0;
  while (current && i < 10) {
    const stack = current.stack();
    if (stack) {
      const locationMatchAll = stack.matchAll(locationRegExp);
      let match = false;
      for (const [, location] of locationMatchAll) {
        match = true;
        out.push(`    at ${current.name} (${location})`);
      }
      if (!match) {
        out.push(`    at ${current.name} (${stack.replace(/^at /, "")})`);
      }
    } else {
      out.push(`    at ${current.name}`);
    }
    current = current.parent;
    i++;
  }
  return out.join(`
`);
};
var causePretty = (cause) => causePrettyErrors(cause).map(renderPrettyError).join(`
`);
var renderPrettyError = (e) => e.cause ? `${e.stack} {
${renderErrorCause(e.cause, "  ")}
}` : e.stack;
var renderErrorCause = (cause, prefix) => {
  const lines = cause.stack.split(`
`);
  let stack = `${prefix}[cause]: ${lines[0]}`;
  for (let i = 1, len = lines.length;i < len; i++) {
    stack += `
${prefix}${lines[i]}`;
  }
  if (cause.cause) {
    stack += ` {
${renderErrorCause(cause.cause, `${prefix}  `)}
${prefix}}`;
  }
  return stack;
};
var FiberTypeId = "~effect/Fiber";
var fiberVariance = {
  _A: identity,
  _E: identity
};
var fiberIdStore = {
  id: 0
};
var AsyncResource = /* @__PURE__ */ (() => {
  try {
    return globalThis.process?.getBuiltinModule?.("node:async_hooks")?.AsyncResource;
  } catch {
    return;
  }
})();
var captureAsyncContext = () => AsyncResource === undefined ? undefined : new AsyncResource("effect/Fiber");
var getCurrentFiber = () => globalThis[currentFiberTypeId];

class FiberImpl {
  constructor(context, interruptible = true) {
    this.setContext(context);
    this.id = ++fiberIdStore.id;
    this.currentOpCount = 0;
    this.interruptible = interruptible;
    this._stack = [];
    this._observers = undefined;
    this._exit = undefined;
    this._children = undefined;
    this._interruptedCause = undefined;
    this._yielded = undefined;
    this._autoYielded = false;
    this._running = false;
    this._deferredInterrupt = false;
    this._parent = undefined;
    this._asyncContext = undefined;
    this.cache.runtimeMetrics?.recordFiberStart(this.context);
  }
  get [FiberTypeId]() {
    return fiberVariance;
  }
  get currentDispatcher() {
    return this._dispatcher ??= this.cache.scheduler.makeDispatcher();
  }
  getRef(ref) {
    return get(this.context, ref);
  }
  addObserver(cb) {
    if (this._exit) {
      cb(this._exit);
      return constVoid;
    }
    if (this._observers === undefined) {
      this._observers = [cb];
    } else {
      this._observers.push(cb);
    }
    return () => this.removeObserver(cb);
  }
  removeObserver(cb) {
    if (this._exit || this._observers === undefined)
      return;
    const index = this._observers.indexOf(cb);
    if (index >= 0) {
      this._observers.splice(index, 1);
    }
  }
  interruptUnsafe(fiberId, annotations) {
    if (this._exit) {
      return;
    }
    let cause = causeInterrupt(fiberId);
    if (this.cache.stackFrame) {
      cause = causeAnnotate(cause, make2(StackTraceKey, this.cache.stackFrame));
    }
    if (annotations) {
      cause = causeAnnotate(cause, annotations);
    }
    this._interruptedCause = this._interruptedCause ? causeAddInterrupts(this._interruptedCause, cause) : cause;
    if (this.interruptible) {
      if (this._running) {
        this._deferredInterrupt = true;
      } else {
        this.evaluate(failCause(this._interruptedCause));
      }
    }
  }
  pollUnsafe() {
    return this._exit;
  }
  evaluate(effect) {
    if (this._exit) {
      return;
    } else if (this._asyncContext !== undefined) {
      const asyncContext = this._asyncContext;
      this._asyncContext = undefined;
      try {
        return asyncContext.runInAsyncScope(this.evaluate, this, effect);
      } finally {
        asyncContext.emitDestroy();
      }
    } else if (this._yielded !== undefined) {
      const yielded = this._yielded;
      this._yielded = undefined;
      yielded();
    }
    const exit = this.runLoop(effect);
    if (exit === Yield) {
      this._asyncContext = captureAsyncContext();
      return;
    }
    const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
    if (interruptChildren !== undefined) {
      return this.evaluate(flatMap2(interruptChildren, () => exit));
    }
    this._exit = exit;
    this.cache.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
    if (this._parent) {
      this._parent._children?.delete(this);
      this._parent = undefined;
    }
    if (this._observers !== undefined) {
      const observers = this._observers;
      this._observers = undefined;
      for (let i = 0;i < observers.length; i++) {
        observers[i](exit);
      }
    }
    this._stack.length = 0;
    this._children = undefined;
    this.context = empty();
    const cache = this.cache;
    if (cache.span !== undefined || cache.stackFrame !== undefined) {
      this.cache = {
        ...cache,
        span: undefined,
        stackFrame: undefined
      };
    }
  }
  runLoop(effect) {
    const prevFiber = globalThis[currentFiberTypeId];
    globalThis[currentFiberTypeId] = this;
    const prevRunning = this._running;
    this._running = true;
    let yielding = false;
    let resuming = this._autoYielded;
    this._autoYielded = false;
    let current = effect;
    this.currentOpCount = resuming ? 1 : 0;
    try {
      while (true) {
        try {
          if (this._deferredInterrupt) {
            this._deferredInterrupt = false;
            current = failCause(this._interruptedCause);
          }
          this.currentOpCount++;
          const cache = this.cache;
          if (!resuming && !yielding && !cache.preventYield && cache.scheduler.shouldYield(this)) {
            yielding = true;
            current = this.yieldNow(current, 0, true);
          } else {
            resuming = false;
            current = cache.tracerContext ? cache.tracerContext(current, this) : current[evaluate](this);
          }
          if (current === Yield) {
            const yielded = this._yielded;
            if (ExitTypeId in yielded) {
              this._deferredInterrupt = false;
              this._yielded = undefined;
              return yielded;
            } else if (this._deferredInterrupt) {
              this._yielded = undefined;
              yielded();
              continue;
            }
            return Yield;
          }
        } catch (error) {
          if (!hasProperty(current, evaluate)) {
            return exitDie(`Fiber.runLoop: Not a valid effect: ${String(current)}`);
          }
          current = exitDie(error);
        }
      }
    } finally {
      this._running = prevRunning;
      globalThis[currentFiberTypeId] = prevFiber;
    }
  }
  getCont(symbol) {
    if (this._deferredInterrupt) {
      this._deferredInterrupt = false;
      return deferredInterruptCont;
    }
    while (true) {
      const op = this._stack.pop();
      if (!op)
        return;
      const all = op[contAll];
      if (all !== undefined) {
        const cont = all.call(op, this);
        if (cont) {
          cont[symbol] = cont;
          return cont;
        }
      }
      if (op[symbol])
        return op;
    }
  }
  succeedWith(value) {
    if ((++this.currentOpCount & maxInlineSteps - 1) === 0) {
      return exitSucceed(value);
    }
    const cont = this.getCont(contA);
    return cont ? cont[contA](value, this) : this.yieldWith(exitSucceed(value));
  }
  yieldWith(value) {
    this._yielded = value;
    return Yield;
  }
  yieldNow(effect, priority = 0, automatic = false) {
    let resumed = false;
    this.currentDispatcher.scheduleTask(() => {
      if (resumed)
        return;
      this._autoYielded = automatic;
      this.evaluate(effect);
    }, priority);
    return this.yieldWith(() => {
      resumed = true;
    });
  }
  children() {
    return this._children ??= new Set;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  setContext(context) {
    const previous = this.context;
    this.context = context;
    if (previous !== undefined && hasSameCache(previous, context))
      return;
    const root = context.cacheRoot;
    const cache = root._fiberCache ??= makeFiberContextCache(context);
    if (this.cache?.scheduler !== cache.scheduler) {
      this._dispatcher = undefined;
    }
    this.cache = cache;
  }
  get currentSpanLocal() {
    const span = this.cache.span;
    return span?._tag === "Span" ? span : undefined;
  }
}
var makeFiberContextCache = (context) => {
  const currentTracer = getOrUndefinedUnsafe(context, TracerKey);
  return {
    scheduler: get(context, Scheduler),
    tracer: currentTracer,
    tracerContext: currentTracer ? currentTracer["context"] : undefined,
    tracerEnabled: get(context, TracerEnabled),
    span: getOrUndefinedUnsafe(context, ParentSpanKey),
    logLevel: get(context, CurrentLogLevel),
    minimumLogLevel: get(context, MinimumLogLevel),
    stackFrame: get(context, CurrentStackFrame),
    runtimeMetrics: getOrUndefinedUnsafe(context, FiberRuntimeMetricsKey),
    maxOpsBeforeYield: get(context, MaxOpsBeforeYield),
    preventYield: get(context, PreventSchedulerYield)
  };
};
var deferredInterruptCont = {
  [contA](_value, fiber) {
    return failCause(fiber._interruptedCause);
  },
  [contE](_cause, fiber) {
    return failCause(fiber._interruptedCause);
  }
};
var maxInlineSteps = 32;
var fiberMiddleware = {
  interruptChildren: undefined
};
var fiberStackAnnotations = (fiber) => {
  if (!fiber.cache.stackFrame)
    return;
  const annotations = new Map;
  annotations.set(InterruptorStackTrace.key, fiber.cache.stackFrame);
  return makeUnsafe(annotations);
};
var fiberAwaitAll = (self) => callback((resume) => {
  const iter = self[Symbol.iterator]();
  const exits = [];
  let cancel = undefined;
  function loop() {
    let result = iter.next();
    while (!result.done) {
      if (result.value._exit) {
        exits.push(result.value._exit);
        result = iter.next();
        continue;
      }
      cancel = result.value.addObserver((exit) => {
        exits.push(exit);
        loop();
      });
      return;
    }
    resume(succeed3(exits));
  }
  loop();
  return sync(() => cancel?.());
});
var fiberInterruptAll = (fibers) => withFiber((parent) => {
  const annotations = fiberStackAnnotations(parent);
  let fiberArr = empty2();
  for (const fiber of fibers) {
    fiber.interruptUnsafe(parent.id, annotations);
    fiberArr.push(fiber);
  }
  return asVoid(fiberAwaitAll(fiberArr));
});
var succeed3 = exitSucceed;
var failCause = exitFailCause;
var fail3 = exitFail;
var sync = /* @__PURE__ */ makePrimitive({
  op: "Sync",
  [evaluate](fiber) {
    const thunk = this[args];
    const value = thunk();
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var suspend = /* @__PURE__ */ makePrimitive({
  op: "Suspend",
  [evaluate](_fiber) {
    const thunk = this[args];
    return thunk();
  }
});
var fromResult = /* @__PURE__ */ match({
  onFailure: fail3,
  onSuccess: succeed3
});
var yieldNowWith = /* @__PURE__ */ makePrimitive({
  op: "Yield",
  [evaluate](fiber) {
    return fiber.yieldNow(exitVoid, this[args] ?? 0);
  }
});
var yieldNow = /* @__PURE__ */ yieldNowWith(0);
var succeedSome = (a) => succeed3(some2(a));
var failCauseSync = (evaluate) => suspend(() => failCause(evaluate()));
var die = (defect) => exitDie(defect);
var void_ = /* @__PURE__ */ succeed3(undefined);
var try_2 = (options) => {
  const evaluate = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.try") : options.catch;
  return suspend(() => {
    try {
      return succeed3(evaluate());
    } catch (err) {
      return fail3(catcher(err));
    }
  });
};
var promise = (evaluate) => callbackOptions(function(resume, signal) {
  evaluate(signal).then((a) => resume(succeed3(a)), (e) => resume(die(e)));
}, evaluate.length !== 0);
var tryPromise = (options) => {
  const f = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.tryPromise") : options.catch;
  return callbackOptions(function(resume, signal) {
    const failWithCatch = (cause) => suspend(() => {
      try {
        return fail3(internalCall(() => catcher(cause)));
      } catch (err) {
        return die(err);
      }
    });
    try {
      f(signal).then((a) => resume(succeed3(a)), (e) => resume(failWithCatch(e)));
    } catch (err) {
      resume(failWithCatch(err));
    }
  }, f.length !== 0);
};
var callbackOptions = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Async",
    [evaluate](fiber) {
      let resumed = false;
      let yielded = false;
      const controller = this.withSignal ? new AbortController : undefined;
      const onCancel = this.register.call(fiber.cache.scheduler, (effect) => {
        if (resumed)
          return;
        resumed = true;
        if (yielded) {
          fiber.evaluate(effect);
        } else {
          yielded = effect;
        }
      }, controller?.signal);
      if (yielded !== false)
        return yielded;
      yielded = true;
      fiber.yieldWith(() => {
        resumed = true;
      });
      if (controller === undefined && onCancel === undefined) {
        return Yield;
      }
      fiber._stack.push(asyncFinalizer(() => {
        resumed = true;
        controller?.abort();
        return onCancel ?? exitVoid;
      }));
      return Yield;
    }
  });
  const AsyncImpl = function(register, withSignal) {
    this.register = register;
    this.withSignal = withSignal;
  };
  AsyncImpl.prototype = Proto;
  return function(register, withSignal) {
    return new AsyncImpl(register, withSignal);
  };
}();
var asyncFinalizer = /* @__PURE__ */ makePrimitive({
  op: "AsyncFinalizer",
  [contAll](fiber) {
    if (fiber.interruptible) {
      fiber.interruptible = false;
      fiber._stack.push(setInterruptibleTrue);
    }
  },
  [contE](cause, _fiber) {
    return hasInterrupts(cause) ? flatMap2(combineFinalizerCause(exitFailCause(cause), this[args]()), () => failCause(cause)) : failCause(cause);
  }
});
var callback = (register) => callbackOptions(register, register.length >= 2);
var never = /* @__PURE__ */ callback(constVoid);
var gen2 = (...args) => {
  if (args.length === 1) {
    const body = args[0];
    return suspend(() => fromIteratorUnsafe(body()));
  }
  const [options, body] = args;
  return suspend(() => fromIteratorUnsafe(body.call(options.self)));
};
var fnBody = (bodyOrOptions, pipeables) => typeof bodyOrOptions === "function" ? bodyOrOptions : pipeables.shift().bind(bodyOrOptions.self);
var fnUntraced = (bodyOrOptions, ...pipeables) => {
  const body = fnBody(bodyOrOptions, pipeables);
  const fn = pipeables.length === 0 ? function() {
    return suspend(() => fromIteratorUnsafe(body.apply(this, arguments)));
  } : function() {
    let effect = suspend(() => fromIteratorUnsafe(body.apply(this, arguments)));
    for (let i = 0;i < pipeables.length; i++) {
      effect = pipeables[i](effect, ...arguments);
    }
    return effect;
  };
  return defineFunctionLength(body.length, fn);
};
var defineFunctionLength = (length, fn) => Object.defineProperty(fn, "length", {
  value: length,
  configurable: true
});
var fnUntracedEager = (bodyOrOptions, ...pipeables) => {
  const body = fnBody(bodyOrOptions, pipeables);
  return defineFunctionLength(body.length, pipeables.length === 0 ? function() {
    return fromIteratorEagerUnsafe(() => body.apply(this, arguments));
  } : function() {
    let effect = fromIteratorEagerUnsafe(() => body.apply(this, arguments));
    for (const pipeable of pipeables) {
      effect = pipeable(effect, ...arguments);
    }
    return effect;
  });
};
var fromIteratorEagerUnsafe = (evaluate) => {
  try {
    const iterator = evaluate();
    let value = undefined;
    while (true) {
      const state = iterator.next(value);
      if (state.done) {
        return succeed3(state.value);
      }
      const primitive = state.value;
      if (primitive && primitive._tag === "Success") {
        value = primitive.value;
        continue;
      } else if (primitive && primitive._tag === "Failure") {
        return state.value;
      } else {
        let isFirstExecution = true;
        return suspend(() => {
          if (isFirstExecution) {
            isFirstExecution = false;
            return flatMap2(state.value, (value) => fromIteratorUnsafe(iterator, value));
          } else {
            return suspend(() => fromIteratorUnsafe(evaluate()));
          }
        });
      }
    }
  } catch (error) {
    return die(error);
  }
};
var fromIteratorUnsafe = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Iterator",
    [contA](value, fiber) {
      const iter = this.iterator;
      while (true) {
        const state = iter.next(value);
        if (state.done)
          return succeed3(state.value);
        if (!effectIsExit(state.value)) {
          fiber._stack.push(this);
          return state.value;
        } else if (state.value._tag === "Failure") {
          return state.value;
        }
        value = state.value.value;
      }
    },
    [evaluate](fiber) {
      return this[contA](this.initial, fiber);
    }
  });
  const IteratorImpl = function(iterator, initial) {
    this.iterator = iterator;
    this.initial = initial;
  };
  IteratorImpl.prototype = Proto;
  return function(iterator, initial) {
    return new IteratorImpl(iterator, initial);
  };
}();
var as = /* @__PURE__ */ dual(2, (self, value) => new ContImpl(self, returnPayload, succeed3(value)));
var evaluateCont = function(fiber) {
  fiber._stack.push(this);
  return this[args];
};
var OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccess",
  [evaluate]: evaluateCont
});
var ContImpl = function(self, cont, payload) {
  this[args] = self;
  this[contA] = cont;
  this.payload = payload;
};
ContImpl.prototype = OnSuccessProto;
var returnPayload = function() {
  return this.payload;
};
var succeedPayload = function(_value, fiber) {
  return fiber.succeedWith(this.payload);
};
var continuationMarksStack = /* @__PURE__ */ (() => {
  const limit = /* @__PURE__ */ getStackTraceLimit();
  if (limit === 0)
    return false;
  const marker = "~effect/Effect/stackProbe";
  const probe = {
    [marker]: function stackProbe() {
      return new Error;
    }
  };
  setStackTraceLimit(1);
  const error = /* @__PURE__ */ probe[marker]();
  setStackTraceLimit(limit);
  return error.stack?.includes("[as " + marker + "]") === true;
})();
var mapCont = function(value, fiber) {
  const f = this.payload;
  return fiber.succeedWith(continuationMarksStack ? f(value) : internalCall(() => f(value)));
};
var andThenCont = function(value) {
  const f = this.payload;
  return f(value);
};
var tapCont = function(value) {
  const f = this.payload;
  return new ContImpl(f(value), succeedPayload, value);
};
var tapEffectCont = function(value) {
  return new ContImpl(this.payload, succeedPayload, value);
};
var asSome = (self) => map2(self, some2);
var andThen = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, isEffect(f) ? returnPayload : andThenCont, f));
var tap = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, isEffect(f) ? tapEffectCont : tapCont, f));
var asVoid = (self) => new ContImpl(self, returnPayload, exitVoid);
var raceAllFirst = (all, options) => withFiber((parent) => {
  const fibers = new Set;
  onExitUnsafe(parent, () => fibers.size === 0 ? undefined : fiberInterruptAll(fibers));
  return callback((resume) => {
    let done = false;
    let i = 0;
    for (const effect of all) {
      if (done)
        break;
      const index = i++;
      const fiber = forkUnsafe(parent, effect, true, true, false);
      fibers.add(fiber);
      fiber.addObserver((exit) => {
        fibers.delete(fiber);
        const isWinner = !done;
        done = true;
        resume(exit);
        if (isWinner) {
          interruptRaceLosers(fibers, parent);
          options?.onWinner?.({
            fiber,
            index,
            parentFiber: parent
          });
        }
      });
    }
  });
});
var interruptRaceLosers = (fibers, parent) => {
  const annotations = fiberStackAnnotations(parent);
  for (const fiber of fibers) {
    fiber.interruptUnsafe(parent.id, annotations);
  }
};
var raceFirst = /* @__PURE__ */ dual((args) => isEffect(args[1]), (self, that, options) => raceAllFirst([self, that], options));
var flatMap2 = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, andThenCont, f));
var effectIsExit = (effect) => effect[ExitTypeId] !== undefined;
var flatMapEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    return self._tag === "Success" ? f(self.value) : self;
  }
  return flatMap2(self, f);
});
var map2 = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, mapCont, f));
var mapEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMap(self, f) : map2(self, f));
var mapErrorEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMapError(self, f) : mapError2(self, f));
var catchEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    if (self._tag === "Success")
      return self;
    const error = findRecoverableError(self.cause);
    if (isFailure2(error))
      return exitFailCause(error.failure);
    return f(error.success);
  }
  return catch_(self, f);
});
var exitIsSuccess = (self) => self._tag === "Success";
var exitVoid = /* @__PURE__ */ exitSucceed(undefined);
var exitMap = /* @__PURE__ */ dual(2, (self, f) => self._tag === "Success" ? exitSucceed(f(self.value)) : self);
var exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
  if (self._tag === "Success")
    return self;
  return exitFailCause(causeMap(self.cause, f));
});
var exitAsVoidAll = (exits) => {
  const failures = [];
  for (const exit of exits) {
    if (exit._tag === "Failure") {
      failures.push(...exit.cause.reasons);
    }
  }
  return failures.length === 0 ? exitVoid : exitFailCause(causeFromReasons(failures));
};
var updateContext = /* @__PURE__ */ dual(2, (self, f) => withFiber((fiber) => {
  const prevContext = fiber.context;
  const nextContext = f(prevContext);
  if (prevContext === nextContext)
    return self;
  fiber.setContext(nextContext);
  onExitUnsafe(fiber, () => {
    fiber.setContext(prevContext);
    return;
  });
  return self;
}));
var contextWith = (f) => withFiber((fiber) => f(fiber.context));
var provideContext = /* @__PURE__ */ dual(2, (self, context) => {
  if (effectIsExit(self))
    return self;
  return updateContext(self, merge(context));
});
var provideService = function() {
  if (arguments.length === 1) {
    return dual(2, (self, impl) => provideServiceImpl(self, arguments[0], impl));
  }
  return dual(3, (self, service, impl) => provideServiceImpl(self, service, impl)).apply(this, arguments);
};
var provideServiceImpl = (self, service, implementation) => updateContext(self, add(service, implementation));
var filterOrFail = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, predicate, orFailWith) => filterOrElse(self, predicate, orFailWith ? (a) => fail3(orFailWith(a)) : () => fail3(new NoSuchElementError)));
var catchCause = /* @__PURE__ */ dual(2, (self, f) => new OnFailureImpl(self, f.length !== 1 ? (cause) => f(cause) : f));
var OnFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnFailure",
  [evaluate]: evaluateCont
});
var OnFailureImpl = function(self, f) {
  this[args] = self;
  this[contE] = f;
};
OnFailureImpl.prototype = OnFailureProto;
var catchCauseFilter = /* @__PURE__ */ dual(3, (self, filter, f) => catchCause(self, (cause) => {
  const eb = filter(cause);
  return isFailure2(eb) ? failCause(eb.failure) : f(eb.success, cause);
}));
var catch_ = /* @__PURE__ */ dual(2, (self, f) => catchCauseFilter(self, findRecoverableError, (e) => f(e)));
var mapError2 = /* @__PURE__ */ dual(2, (self, f) => catchCause(self, (cause) => failCause(causeMap(cause, f))));
var orElseSucceed = /* @__PURE__ */ dual(2, (self, f) => catch_(self, (error) => sync(() => f(error))));
var ignoreCauseLogger = (log) => log === "Unhandled" ? (...message) => withFiber((fiber) => {
  const level = fiber.getRef(UnhandledLogLevel);
  return level === undefined ? void_ : logWithLevel(level)(...message);
}) : logWithLevel(log === true ? undefined : log);
var ignore = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, options) => {
  if (!options?.log) {
    return matchEffect(self, {
      onFailure: (_) => void_,
      onSuccess: (_) => void_
    });
  }
  const logEffect = ignoreCauseLogger(options.log);
  return matchCauseEffect(self, {
    onFailure(cause) {
      const error = findRecoverableError(cause);
      return isFailure2(error) ? failCause(error.failure) : options.message === undefined ? logEffect(cause) : logEffect(options.message, cause);
    },
    onSuccess: (_) => void_
  });
});
var result = (self) => matchEager(self, {
  onFailure: fail2,
  onSuccess: succeed2
});
var matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => new OnSuccessAndFailureImpl(self, options.onSuccess.length !== 1 ? (a) => options.onSuccess(a) : options.onSuccess, options.onFailure.length !== 1 ? (cause) => options.onFailure(cause) : options.onFailure));
var OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccessAndFailure",
  [evaluate]: evaluateCont
});
var OnSuccessAndFailureImpl = function(self, onSuccess, onFailure) {
  this[args] = self;
  this[contA] = onSuccess;
  this[contE] = onFailure;
};
OnSuccessAndFailureImpl.prototype = OnSuccessAndFailureProto;
var matchSuccess = function(value, fiber) {
  const handlers = this.payload;
  return fiber.succeedWith(continuationMarksStack ? handlers.onSuccess(value) : internalCall(() => handlers.onSuccess(value)));
};
var makeMatch = (op, onFailure) => {
  const Proto = makePrimitiveProto({
    op,
    [evaluate]: evaluateCont,
    [contA]: matchSuccess,
    [contE]: onFailure
  });
  const MatchImpl = function(self, handlers) {
    this[args] = self;
    this.payload = handlers;
  };
  MatchImpl.prototype = Proto;
  return MatchImpl;
};
var MatchImpl = /* @__PURE__ */ makeMatch("Match", function(cause, fiber) {
  const error = findRecoverableError(cause);
  if (isFailure2(error))
    return failCause(error.failure);
  const handlers = this.payload;
  return fiber.succeedWith(continuationMarksStack ? handlers.onFailure(error.success) : internalCall(() => handlers.onFailure(error.success)));
});
var matchEffect = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onFailure: (cause) => {
    const error = findRecoverableError(cause);
    return isFailure2(error) ? failCause(error.failure) : options.onFailure(error.success);
  },
  onSuccess: options.onSuccess
}));
var match3 = /* @__PURE__ */ dual(2, (self, options) => new MatchImpl(self, options));
var matchEager = /* @__PURE__ */ dual(2, (self, options) => {
  if (effectIsExit(self)) {
    if (self._tag === "Success")
      return exitSucceed(options.onSuccess(self.value));
    const error = findRecoverableError(self.cause);
    if (isFailure2(error))
      return exitFailCause(error.failure);
    return exitSucceed(options.onFailure(error.success));
  }
  return match3(self, options);
});
var exit = (self) => effectIsExit(self) ? exitSucceed(self) : exitPrimitive(self);
var exitPrimitive = /* @__PURE__ */ makePrimitive({
  op: "Exit",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  },
  [contA](value, fiber, exit) {
    return fiber.succeedWith(exit ?? exitSucceed(value));
  },
  [contE](cause, fiber, exit) {
    return fiber.succeedWith(exit ?? exitFailCause(cause));
  }
});
var timeoutOrElse = /* @__PURE__ */ dual(2, (self, options) => flatMap2(timeoutOption(self, options.duration), (option) => isNone2(option) ? options.orElse() : succeed3(option.value)));
var timeoutErrorFromDuration = (duration) => new TimeoutError(`Operation timed out after '${format2(duration)}'`);
var timeout = /* @__PURE__ */ dual(2, (self, duration) => {
  const decoded = fromInputUnsafe(duration);
  return timeoutOrElse(self, {
    duration: decoded,
    orElse: () => fail3(timeoutErrorFromDuration(decoded))
  });
});
var timeoutOption = /* @__PURE__ */ dual(2, (self, duration) => raceFirst(asSome(self), as(sleep(duration), none2())));
var ScopeTypeId = "~effect/Scope";
var ScopeCloseableTypeId = "~effect/Scope/Closeable";
var scopeTag = /* @__PURE__ */ Service("effect/Scope");
var scopeCloseUnsafe = (self, exit_) => {
  const state = self.state;
  if (state._tag === "Closed")
    return;
  self.state = {
    _tag: "Closed",
    exit: exit_
  };
  if (self.parent !== undefined) {
    scopeRemoveFinalizerUnsafe(self.parent, self);
  }
  if (state._tag === "Empty")
    return;
  if (state.finalizer !== undefined) {
    return runFinalizer(state.finalizer, exit_);
  }
  const finalizers = state.finalizers;
  if (finalizers.size === 1) {
    return runFinalizer(finalizers.values().next().value, exit_);
  }
  return scopeCloseFinalizers(self, finalizers, exit_);
};
var runFinalizer = (finalizer, exit_) => {
  try {
    return finalizer(exit_);
  } catch (defect) {
    return exitDie(defect);
  }
};
var combineFinalizerCause = (exit_, finalizer) => exitIsSuccess(exit_) ? finalizer : catchCause(finalizer, (cause) => failCause(causeElectDefects(causeCombine(exit_.cause, cause))));
var scopeCloseFinalizers = /* @__PURE__ */ fnUntraced(function* (self, finalizers, exit_) {
  let exits = [];
  const fibers = [];
  const arr = Array.from(finalizers);
  const parent = getCurrentFiber();
  for (let i = arr.length - 1;i >= 0; i--) {
    const [key, finalizer] = arr[i];
    if (self.strategy === "sequential") {
      exits.push(yield* exit(runFinalizer(finalizer, exit_)));
    } else if (key !== parent) {
      fibers.push(forkUnsafe(parent, runFinalizer(finalizer, exit_), true, true, "inherit"));
    }
  }
  if (fibers.length > 0) {
    exits = yield* fiberAwaitAll(fibers);
  }
  return yield* exitAsVoidAll(exits);
});
var scopeAddFinalizerExit = (scope, finalizer) => {
  return suspend(() => {
    if (scope.state._tag === "Closed") {
      return finalizer(scope.state.exit);
    }
    scopeAddFinalizerUnsafe(scope, {}, finalizer);
    return void_;
  });
};
var scopeAddFinalizerUnsafe = (scope, key, finalizer) => {
  if (scope.state._tag === "Empty") {
    scope.state = {
      _tag: "Open",
      finalizerKey: key,
      finalizer,
      finalizers: undefined
    };
  } else if (scope.state._tag === "Open") {
    const state = scope.state;
    if (state.finalizer !== undefined) {
      state.finalizers = new Map([[state.finalizerKey, state.finalizer]]);
      state.finalizerKey = undefined;
      state.finalizer = undefined;
      state.finalizers.set(key, finalizer);
    } else {
      state.finalizers.set(key, finalizer);
    }
  }
};
var scopeRemoveFinalizerUnsafe = (scope, key) => {
  if (scope.state._tag !== "Open")
    return;
  const state = scope.state;
  if (state.finalizerKey === key) {
    scope.state = constScopeEmpty;
  } else if (state.finalizers !== undefined) {
    state.finalizers.delete(key);
    if (state.finalizers.size === 0) {
      scope.state = constScopeEmpty;
    }
  }
};
var scopeMakeUnsafe = (finalizerStrategy) => makeScope(finalizerStrategy, undefined);
var makeScope = (finalizerStrategy = "sequential", parent) => ({
  [ScopeCloseableTypeId]: ScopeCloseableTypeId,
  [ScopeTypeId]: ScopeTypeId,
  strategy: finalizerStrategy,
  parent,
  state: constScopeEmpty
});
var constScopeEmpty = {
  _tag: "Empty"
};
var scope = scopeTag;
var scoped = (self) => withFiber((fiber) => {
  const prev = fiber.context;
  const scope = scopeMakeUnsafe();
  fiber.setContext(add(fiber.context, scopeTag, scope));
  onExitUnsafe(fiber, (exit) => {
    fiber.setContext(prev);
    return scopeCloseUnsafe(scope, exit);
  });
  return self;
});
var acquireRelease = (acquire, release, options) => contextWith((context) => uninterruptibleMask((restore) => flatMap2(scope, (scope) => tap(options?.interruptible ? restore(acquire) : acquire, (a) => scopeAddFinalizerExit(scope, (exit) => provideContext(release(a, exit), context))))));
var OnExitImpl = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "OnExit",
    [evaluate](fiber) {
      fiber._stack.push(this);
      return this.effect;
    },
    [contAll](fiber) {
      if (fiber.interruptible && this.interruptible !== true) {
        fiber._stack.push(setInterruptibleTrue);
        fiber.interruptible = false;
      }
    },
    [contA](value, _, exit) {
      exit ??= exitSucceed(value);
      let eff;
      try {
        eff = this.onExit(exit);
      } catch (defect) {
        eff = exitDie(defect);
      }
      return eff ? flatMap2(eff, (_) => exit) : exit;
    },
    [contE](cause, _, exit) {
      exit ??= exitFailCause(cause);
      let eff;
      try {
        eff = this.onExit(exit);
      } catch (defect) {
        eff = exitDie(defect);
      }
      return eff ? flatMap2(combineFinalizerCause(exit, eff), (_) => exit) : exit;
    }
  });
  const OnExitImpl = function(effect, onExit, interruptible) {
    this.effect = effect;
    this.onExit = onExit;
    this.interruptible = interruptible;
  };
  OnExitImpl.prototype = Proto;
  return OnExitImpl;
}();
var onExitPrimitive = (effect, onExit, interruptible) => new OnExitImpl(effect, onExit, interruptible);
var onExitUnsafe = (fiber, f) => {
  fiber._stack.push(new OnExitImpl(undefined, f, undefined));
};
var onExit = /* @__PURE__ */ dual(2, onExitPrimitive);
var ensuring = /* @__PURE__ */ dual(2, (self, finalizer) => onExit(self, (_) => finalizer));
var acquireUseRelease = (acquire, use, release) => uninterruptibleMask((restore) => flatMap2(acquire, (a) => onExitPrimitive(suspend(() => restore(use(a))), (exit) => release(a, exit), true)));
var uninterruptible = (self) => withFiber((fiber) => {
  if (!fiber.interruptible)
    return self;
  fiber.interruptible = false;
  fiber._stack.push(setInterruptibleTrue);
  return self;
});
var setInterruptible = /* @__PURE__ */ makePrimitive({
  op: "SetInterruptible",
  [contAll](fiber) {
    fiber.interruptible = this[args];
    if (fiber._interruptedCause && fiber.interruptible) {
      return () => failCause(fiber._interruptedCause);
    }
  }
});
var setInterruptibleTrue = /* @__PURE__ */ setInterruptible(true);
var setInterruptibleFalse = /* @__PURE__ */ setInterruptible(false);
var setFiberInterruptible = (fiber) => {
  fiber.interruptible = true;
  fiber._stack.push(setInterruptibleFalse);
  if (fiber._interruptedCause)
    return failCause(fiber._interruptedCause);
};
var interruptible = (self) => withFiber((fiber) => {
  if (fiber.interruptible)
    return self;
  return setFiberInterruptible(fiber) ?? self;
});
var uninterruptibleMask = (f) => withFiber((fiber) => {
  if (!fiber.interruptible)
    return f(identity);
  fiber.interruptible = false;
  fiber._stack.push(setInterruptibleTrue);
  return f(interruptible);
});
var whileLoop = /* @__PURE__ */ makePrimitive({
  op: "While",
  [contA](value, fiber) {
    this[args].step(value);
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  },
  [evaluate](fiber) {
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  }
});
var forEach = /* @__PURE__ */ dual((args) => typeof args[1] === "function", (iterable, f, options) => suspend(() => {
  const concurrency = resolveConcurrency(options?.concurrency);
  if (concurrency === 1) {
    return forEachSequential(iterable, f, options);
  }
  const items = fromIterable(iterable);
  let length = items.length;
  if (length === 0) {
    return options?.discard ? void_ : succeed3([]);
  }
  const out = options?.discard ? undefined : new Array(length);
  const eff = forEachConcurrent({
    f,
    out
  }, items, {
    concurrency
  });
  return eff ? as(eff, out) : succeed3(out);
}));
var forEachSequential = (iterable, f, options) => suspend(() => {
  const out = options?.discard ? undefined : [];
  const iterator = iterable[Symbol.iterator]();
  let state = iterator.next();
  let index = 0;
  return as(whileLoop({
    while: () => !state.done,
    body: () => f(state.value, index++),
    step: (b) => {
      if (out)
        out.push(b);
      state = iterator.next();
    }
  }), out);
});
var resolveConcurrency = (concurrency) => concurrency === "unbounded" ? Number.POSITIVE_INFINITY : Math.max(1, concurrency ?? 1);
var iterateEager = () => (options) => {
  const onItem = options.onItem;
  const step = options.step;
  const resumeSequential = (state, items, index, end, effect) => flatMap2(exit(effect), (itemExit) => step(state, items[index], itemExit, index) ?? runSequential(state, items, index + 1, end) ?? void_);
  const runSequential = (state, items, index = 0, end = items.length) => {
    for (;index < end; index++) {
      const item = items[index];
      const effect = onItem(state, item, index);
      if (!effectIsExit(effect)) {
        return resumeSequential(state, items, index, end, effect);
      }
      const terminal = step(state, item, effect, index);
      if (terminal)
        return terminal._tag === "Failure" ? terminal : undefined;
    }
  };
  return runSequential;
};
var iterateConcurrentImpl = (options) => {
  const onItem = options.onItem;
  const step = options.step;
  return (state, items, opts) => {
    let index = 0;
    const end = opts.end ?? items.length;
    const concurrency = opts.concurrency;
    let done = false;
    let parentFiber;
    let fibers;
    let resume;
    let terminal;
    let effect;
    const failDefect = (error) => {
      const defect = exitDie(error);
      terminal = defect;
      done = true;
      return fibers && fibers.size > 0 ? flatMap2(uninterruptible(fiberInterruptAll(Array.from(fibers))), () => terminal ?? defect) : defect;
    };
    const go = () => {
      let paused = false;
      for (;!terminal && index < end; index++) {
        const item = items[index];
        const eff = effect ?? onItem(state, item, index);
        if (effectIsExit(eff)) {
          terminal = step(state, item, eff, index);
          if (terminal)
            break;
        } else if (!parentFiber) {
          return callback((cb) => {
            parentFiber = getCurrentFiber();
            fibers = new Set;
            effect = eff;
            resume = cb;
            let result;
            try {
              result = go();
            } catch (error) {
              return cb(failDefect(error));
            }
            if (result)
              return cb(result);
            return suspend(() => {
              terminal ??= exitVoid;
              return flatMap2(fibers ? fiberInterruptAll(fibers) : void_, () => terminal?._tag === "Failure" ? terminal : void_);
            });
          });
        } else {
          effect = undefined;
          const fiber = forkUnsafe(parentFiber, eff, true, true, "inherit");
          if (fiber._exit) {
            terminal = step(state, item, fiber._exit, index);
            if (terminal)
              break;
            continue;
          }
          fibers.add(fiber);
          const currentIndex = index;
          fiber.addObserver((exit) => {
            fibers.delete(fiber);
            try {
              if (terminal) {
                if (exit._tag === "Failure") {
                  const reasons = exit.cause.reasons.filter((reason) => reason._tag !== "Interrupt");
                  if (reasons.length > 0) {
                    const cause = causeFromReasons(reasons);
                    terminal = exitFailCause(terminal._tag === "Failure" ? causeElectDefects(causeCombine(terminal.cause, cause)) : cause);
                  }
                }
              } else {
                const result = step(state, item, exit, currentIndex);
                if (result) {
                  terminal = result;
                  go();
                }
              }
              if (paused) {
                const eff = go();
                if (eff)
                  resume(eff);
              } else if (done && fibers.size === 0) {
                resume(terminal ?? void_);
              }
            } catch (error) {
              resume(failDefect(error));
            }
          });
          if (fibers.size < concurrency)
            continue;
          paused = true;
          index++;
          return;
        }
      }
      done = true;
      if (terminal) {
        if (fibers && fibers.size > 0) {
          const annotations = fiberStackAnnotations(parentFiber);
          fibers.forEach((f) => f.interruptUnsafe(parentFiber.id, annotations));
          return;
        }
        if (resume || terminal._tag === "Failure") {
          return terminal;
        }
      } else if (resume) {
        if (!fibers) {
          return exitVoid;
        } else if (fibers.size === 0) {
          resume(void_);
        }
      }
    };
    return go();
  };
};
var iterateConcurrent = () => (options) => iterateConcurrentImpl(options);
var forEachConcurrent = /* @__PURE__ */ iterateConcurrentImpl({
  onItem(state, item, index) {
    return state.f(item, index);
  },
  step(state, _, exit, index) {
    if (exit._tag === "Failure")
      return exit;
    else if (state.out) {
      state.out[index] = exit.value;
    }
  }
});
var filterOrElse = /* @__PURE__ */ dual(3, (self, predicate, orElse) => flatMap2(self, (a) => predicate(a) ? succeed3(a) : orElse(a)));
var forkUnsafe = (parent, effect, immediate = false, daemon = false, uninterruptible = false) => {
  const parentRuntime = parent;
  const interruptible = uninterruptible === "inherit" ? parentRuntime.interruptible : !uninterruptible;
  const child = new FiberImpl(parentRuntime.context, interruptible);
  if (!daemon) {
    parentRuntime.children().add(child);
    child._parent = parentRuntime;
  }
  if (immediate) {
    child.evaluate(effect);
  } else {
    child._asyncContext = captureAsyncContext();
    parentRuntime.currentDispatcher.scheduleTask(() => child.evaluate(effect), 0);
  }
  return child;
};
var runForkWith = (context) => (effect, options) => {
  const fiber = new FiberImpl(options?.scheduler ? add(context, Scheduler, options.scheduler) : context, options?.uninterruptible !== true);
  fiber.evaluate(effect);
  if (fiber._exit)
    return fiber;
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.interruptUnsafe();
    } else {
      const abort = () => fiber.interruptUnsafe();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  if (options?.onFiberStart) {
    options.onFiberStart(fiber);
  }
  return fiber;
};
var runPromiseExitWith = (context) => {
  const runFork = runForkWith(context);
  return (effect, options) => {
    const fiber = runFork(effect, options);
    return new Promise((resolve) => {
      fiber.addObserver((exit) => resolve(exit));
    });
  };
};
var runPromiseWith = (context) => {
  const runPromiseExit = runPromiseExitWith(context);
  return (effect, options) => runPromiseExit(effect, options).then((exit) => {
    if (exit._tag === "Failure") {
      throw causeSquash(exit.cause);
    }
    return exit.value;
  });
};
var runPromise = /* @__PURE__ */ runPromiseWith(/* @__PURE__ */ empty());
var runSyncExitWith = (context) => {
  const runFork = runForkWith(context);
  return (effect) => {
    if (effectIsExit(effect))
      return effect;
    const scheduler = new MixedScheduler("sync");
    const fiber = runFork(effect, {
      scheduler
    });
    fiber._dispatcher?.flush();
    return fiber._exit ?? exitDie(new AsyncFiberError(fiber));
  };
};
var runSyncExit = /* @__PURE__ */ runSyncExitWith(/* @__PURE__ */ empty());
var ClockRef = /* @__PURE__ */ Reference("effect/Clock", {
  defaultValue: () => new ClockImpl
});
var MAX_TIMER_MILLIS = 2 ** 31 - 1;

class ClockImpl {
  currentTimeMillisUnsafe() {
    return Date.now();
  }
  currentTimeMillis = /* @__PURE__ */ sync(() => this.currentTimeMillisUnsafe());
  currentTimeNanosUnsafe() {
    return wallTimeNanos();
  }
  currentTimeNanos = /* @__PURE__ */ sync(() => this.currentTimeNanosUnsafe());
  monotonicTimeNanosUnsafe() {
    return monotonicNowNanos();
  }
  monotonicTimeNanos = /* @__PURE__ */ sync(() => this.monotonicTimeNanosUnsafe());
  sleep(duration) {
    return this.sleepMillis(toMillis(duration));
  }
  sleepMillis(millis) {
    if (millis <= 0)
      return yieldNow;
    else if (!Number.isFinite(millis))
      return never;
    return callback((resume) => {
      const continuation = millis > MAX_TIMER_MILLIS ? this.sleepMillis(millis - MAX_TIMER_MILLIS) : void_;
      const handle = setTimeout(() => resume(continuation), Math.min(millis, MAX_TIMER_MILLIS));
      return sync(() => clearTimeout(handle));
    });
  }
}
var nanosPerMilli = /* @__PURE__ */ BigInt(1e6);
var monotonicNowNanos = /* @__PURE__ */ function() {
  const processHrtime = globalThis.process?.hrtime;
  if (typeof processHrtime?.bigint === "function") {
    return () => processHrtime.bigint();
  }
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => BigInt(Math.round(performance.now() * 1e6));
  }
  let previous = /* @__PURE__ */ BigInt(0);
  return () => {
    const current = BigInt(Date.now()) * nanosPerMilli;
    if (current > previous) {
      previous = current;
    }
    return previous;
  };
}();
var wallTimeNanos = /* @__PURE__ */ function() {
  const reanchorThresholdNanos = /* @__PURE__ */ BigInt(1e9);
  let origin;
  return () => {
    const monotonic = monotonicNowNanos();
    const wall = BigInt(Date.now()) * nanosPerMilli;
    if (origin === undefined) {
      origin = wall - monotonic;
    } else {
      const projected = origin + monotonic;
      const skew = wall > projected ? wall - projected : projected - wall;
      if (skew > reanchorThresholdNanos) {
        origin = wall - monotonic;
      }
    }
    return origin + monotonic;
  };
}();
var clockWith = (f) => withFiber((fiber) => f(fiber.getRef(ClockRef)));
var sleep = (duration) => clockWith((clock) => clock.sleep(fromInputUnsafe(duration)));
var currentTimeMillis = /* @__PURE__ */ clockWith((clock) => clock.currentTimeMillis);
var TimeoutErrorTypeId = "~effect/Cause/TimeoutError";
class TimeoutError extends (/* @__PURE__ */ TaggedError("TimeoutError")) {
  [TimeoutErrorTypeId] = TimeoutErrorTypeId;
  constructor(message) {
    super({
      message
    });
  }
}
var AsyncFiberErrorTypeId = "~effect/Cause/AsyncFiberError";
class AsyncFiberError extends (/* @__PURE__ */ TaggedError("AsyncFiberError")) {
  [AsyncFiberErrorTypeId] = AsyncFiberErrorTypeId;
  constructor(fiber) {
    super({
      message: "An asynchronous Effect was executed with Effect.runSync",
      fiber
    });
  }
}
var UnknownErrorTypeId = "~effect/Cause/UnknownError";
class UnknownError extends (/* @__PURE__ */ TaggedError("UnknownError")) {
  [UnknownErrorTypeId] = UnknownErrorTypeId;
  constructor(cause, message) {
    super({
      message,
      cause
    });
  }
}
var ConsoleRef = /* @__PURE__ */ Reference("effect/Console", {
  defaultValue: () => globalThis.console
});
var logLevelToOrder = (level) => {
  switch (level) {
    case "All":
      return Number.MIN_SAFE_INTEGER;
    case "Fatal":
      return 50000;
    case "Error":
      return 40000;
    case "Warn":
      return 30000;
    case "Info":
      return 20000;
    case "Debug":
      return 1e4;
    case "Trace":
      return 0;
    case "None":
      return Number.MAX_SAFE_INTEGER;
  }
};
var LogLevelOrder = /* @__PURE__ */ mapInput(Number2, logLevelToOrder);
var isLogLevelGreaterThan = /* @__PURE__ */ isGreaterThan(LogLevelOrder);
var CurrentLoggers = /* @__PURE__ */ Reference("effect/Logger/CurrentLoggers", {
  defaultValue: () => new Set([defaultLogger, tracerLogger])
});
var LogToStderr = /* @__PURE__ */ Reference("effect/Logger/LogToStderr", {
  defaultValue: constFalse
});
var LoggerTypeId = "~effect/Logger";
var LoggerProto = {
  [LoggerTypeId]: {
    _Message: identity,
    _Output: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var loggerMake = (log) => {
  const self = Object.create(LoggerProto);
  self.log = log;
  return self;
};
var formatLabel = (key) => key.replace(/[\s="]/g, "_");
var formatLogSpan = (self, now) => {
  const label = formatLabel(self[0]);
  return `${label}=${now - self[1]}ms`;
};
var logWithLevel = (level) => (...message) => {
  let cause = undefined;
  for (let i = 0, len = message.length;i < len; i++) {
    const msg = message[i];
    if (isCause(msg)) {
      if (cause) {
        message.splice(i, 1);
      } else {
        message = message.slice(0, i).concat(message.slice(i + 1));
      }
      cause = cause ? causeFromReasons(cause.reasons.concat(msg.reasons)) : msg;
      i--;
    }
  }
  if (cause === undefined) {
    cause = causeEmpty;
  }
  return withFiber((fiber) => {
    const logLevel = level ?? fiber.cache.logLevel;
    if (isLogLevelGreaterThan(fiber.cache.minimumLogLevel, logLevel)) {
      return void_;
    }
    const clock = fiber.getRef(ClockRef);
    const loggers = fiber.getRef(CurrentLoggers);
    if (loggers.size > 0) {
      const date = new Date(clock.currentTimeMillisUnsafe());
      for (const logger of loggers) {
        logger.log({
          cause,
          fiber,
          date,
          logLevel,
          message
        });
      }
    }
    return void_;
  });
};
var colors = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
  white: "37",
  gray: "90",
  black: "30",
  bgBrightRed: "101"
};
var logLevelColors = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black]
};
var defaultDateFormat = (date) => `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
var defaultLogger = /* @__PURE__ */ loggerMake(({
  cause,
  date,
  fiber,
  logLevel,
  message
}) => {
  const message_ = Array.isArray(message) ? message.slice() : [message];
  if (cause.reasons.length > 0) {
    message_.push(causePretty(cause));
  }
  const now = date.getTime();
  const spans = fiber.getRef(CurrentLogSpans);
  let spanString = "";
  for (const span of spans) {
    spanString += ` ${formatLogSpan(span, now)}`;
  }
  const annotations = fiber.getRef(CurrentLogAnnotations);
  if (Object.keys(annotations).length > 0) {
    message_.push(annotations);
  }
  const console = fiber.getRef(ConsoleRef);
  const log = fiber.getRef(LogToStderr) ? console.error : console.log;
  log(`[${defaultDateFormat(date)}] ${logLevel.toUpperCase()} (#${fiber.id})${spanString}:`, ...message_);
});
var tracerLogger = /* @__PURE__ */ loggerMake(({
  cause,
  fiber,
  logLevel,
  message
}) => {
  const clock = fiber.getRef(ClockRef);
  const annotations = fiber.getRef(CurrentLogAnnotations);
  const span = fiber.cache.span;
  if (span === undefined || span._tag === "ExternalSpan" || span.status._tag === "Ended")
    return;
  const attributes = {};
  for (const [key, value] of Object.entries(annotations)) {
    assignProperty(attributes, key, value);
  }
  attributes["effect.fiberId"] = fiber.id;
  attributes["effect.logLevel"] = logLevel.toUpperCase();
  if (cause.reasons.length > 0) {
    attributes["effect.cause"] = causePretty(cause);
  }
  span.event(toStringUnknown(Array.isArray(message) && message.length === 1 ? message[0] : message), clock.currentTimeNanosUnsafe(), attributes);
});

var isFailReason2 = isFailReason;
var fromReasons = causeFromReasons;
var die2 = causeDie;
var map3 = causeMap;
var isDone2 = isDone;
var done2 = done;

var succeed4 = exitSucceed;
var failCause2 = exitFailCause;
var fail4 = exitFail;
var void_2 = exitVoid;
var isSuccess3 = exitIsSuccess;

var catchDone = /* @__PURE__ */ dual(2, (effect, f) => catchCauseFilter(effect, filterDoneLeftover, (l) => f(l)));
var isDoneFailure = (failure) => failure._tag === "Fail" && isDone2(failure.error);
var filterDone = (cause) => {
  let done;
  let hasFailure = false;
  for (const reason of cause.reasons) {
    if (isDoneFailure(reason)) {
      done ??= reason.error;
    } else if (reason._tag !== "Interrupt") {
      hasFailure = true;
    }
  }
  if (done === undefined)
    return fail2(cause);
  return hasFailure ? fail2(fromReasons(cause.reasons.filter((reason) => !isDoneFailure(reason)))) : succeed2(done);
};
var filterDoneLeftover = (cause) => {
  const done = filterDone(cause);
  return isFailure2(done) ? done : succeed2(done.success.value);
};
var matchEffect2 = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onSuccess: options.onSuccess,
  onFailure: (cause) => {
    const halt = filterDone(cause);
    return !isFailure2(halt) ? options.onDone(halt.success.value) : options.onFailure(halt.failure);
  }
}));

var TypeId5 = "~effect/Schedule";
var CurrentMetadata = /* @__PURE__ */ Reference("effect/Schedule/CurrentMetadata", {
  defaultValue: /* @__PURE__ */ constant({
    input: undefined,
    output: undefined,
    duration: zero,
    attempt: 0,
    start: 0,
    now: 0,
    elapsed: 0,
    elapsedSincePrevious: 0
  })
});
var ScheduleProto = {
  [TypeId5]: {
    _Out: identity,
    _In: identity,
    _Env: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var isSchedule = (u) => hasProperty(u, TypeId5);
var fromStep = (step) => {
  const self = Object.create(ScheduleProto);
  self.step = step;
  return self;
};
var metadataFn = () => {
  let n = 0;
  let previous;
  let start;
  return (now, input) => {
    if (start === undefined)
      start = now;
    const elapsed = now - start;
    const elapsedSincePrevious = previous === undefined ? 0 : now - previous;
    previous = now;
    return {
      input,
      attempt: ++n,
      start,
      now,
      elapsed,
      elapsedSincePrevious
    };
  };
};
var fromStepWithMetadata = (step) => fromStep(map2(step, (f) => {
  const meta = metadataFn();
  return (now, input) => f(meta(now, input));
}));
var toStep = (schedule) => catchCause(schedule.step, (cause) => succeed3(() => failCause(cause)));
var toStepWithMetadata = (schedule) => clockWith((clock) => map2(toStep(schedule), (step) => {
  const metaFn = metadataFn();
  return (input) => suspend(() => {
    const now = clock.currentTimeMillisUnsafe();
    return flatMap2(step(now, input), ([output, duration]) => {
      const meta = metaFn(now, input);
      meta.output = output;
      meta.duration = duration;
      return as(sleep(duration), meta);
    });
  });
}));
var exponential = (base, factor = 2) => {
  const baseMillis = toMillis(fromInputUnsafe(base));
  return fromStepWithMetadata(succeed3((meta) => {
    const duration = millis(baseMillis * Math.pow(factor, meta.attempt - 1));
    return succeed3([duration, duration]);
  }));
};
var passthrough = (self) => fromStep(map2(toStep(self), (step) => (now, input) => matchEffect2(step(now, input), {
  onSuccess: (result) => succeed3([input, result[1]]),
  onFailure: failCause,
  onDone: () => done2(input)
})));
var spaced = (duration) => {
  const decoded = fromInputUnsafe(duration);
  return fromStepWithMetadata(succeed3((meta) => succeed3([meta.attempt - 1, decoded])));
};
var while_ = /* @__PURE__ */ dual(2, (self, predicate) => fromStep(map2(toStep(self), (step) => {
  const meta = metadataFn();
  return (now, input) => flatMap2(step(now, input), (result) => {
    const [output, duration] = result;
    const eff = predicate({
      ...meta(now, input),
      output,
      duration
    });
    return flatMap2(isEffect(eff) ? eff : succeed3(eff), (check) => check ? succeed3(result) : done2(output));
  });
})));
var forever = /* @__PURE__ */ spaced(zero);

var retryOrElse = /* @__PURE__ */ dual(3, (self, policy, orElse) => flatMap2(toStepWithMetadata(policy), (step) => {
  let meta = CurrentMetadata.defaultValue();
  let lastError;
  const loop = catchCauseFilter(suspend(() => provideService(self, CurrentMetadata, meta)), findRecoverableError, (error) => {
    lastError = error;
    return flatMap2(step(error), (meta_) => {
      meta = meta_;
      return loop;
    });
  });
  return catchDone(loop, (out) => internalCall(() => orElse(lastError, out)));
}));
var retry = /* @__PURE__ */ dual(2, (self, options) => {
  const schedule = typeof options === "function" ? options(identity) : isSchedule(options) ? options : buildFromOptions(options);
  return retryOrElse(self, schedule, fail3);
});
var passthroughForever = /* @__PURE__ */ passthrough(forever);
var buildFromOptions = (options) => {
  let schedule = options.schedule ? passthrough(options.schedule) : passthroughForever;
  if (options.while) {
    schedule = while_(schedule, ({
      input
    }) => {
      const applied = options.while(input);
      return isEffect(applied) ? applied : succeed3(applied);
    });
  }
  if (options.until) {
    schedule = while_(schedule, ({
      input
    }) => {
      const applied = options.until(input);
      return isEffect(applied) ? map2(applied, (b) => !b) : succeed3(!applied);
    });
  }
  if (options.times !== undefined) {
    schedule = while_(schedule, ({
      attempt
    }) => succeed3(attempt <= options.times));
  }
  return schedule;
};

var forEach2 = forEach;
var promise2 = promise;
var tryPromise2 = tryPromise;
var succeed5 = succeed3;
var succeedSome2 = succeedSome;
var suspend2 = suspend;
var sync2 = sync;
var void_3 = void_;
var gen3 = gen2;
var fail5 = fail3;
var failCauseSync2 = failCauseSync;
var die3 = die;
var try_3 = try_2;
var fromResult2 = fromResult;
var flatMap3 = flatMap2;
var andThen2 = andThen;
var result2 = result;
var exit2 = exit;
var map4 = map2;
var as2 = as;
var catchCause2 = catchCause;
var mapError3 = mapError2;
var retry2 = retry;
var ignore2 = ignore;
var orElseSucceed2 = orElseSucceed;
var timeout2 = timeout;
var sleep2 = sleep;
var filterOrFail2 = filterOrFail;
var scoped2 = scoped;
var acquireRelease2 = acquireRelease;
var acquireUseRelease2 = acquireUseRelease;
var ensuring2 = ensuring;
var interruptible2 = interruptible;
var runPromise2 = runPromise;
var runSyncExit2 = runSyncExit;
var mapEager2 = mapEager;
var mapErrorEager2 = mapErrorEager;
var flatMapEager2 = flatMapEager;
var catchEager2 = catchEager;
var fnUntracedEager2 = fnUntracedEager;

var decodeNative = (str, decodedLength, options) => {
  if (str.length < 128)
    return;
  const NativeUint8Array = Uint8Array;
  if (typeof NativeUint8Array.fromBase64 !== "function")
    return;
  try {
    const bytes = NativeUint8Array.fromBase64(str, options);
    return bytes.length === decodedLength ? bytes : null;
  } catch {
    return null;
  }
};
var stripCrlf = (str) => str.indexOf(`
`) === -1 && str.indexOf("\r") === -1 ? str : str.replace(/[\n\r]/g, "");

var encode = (input) => encodeBytes(typeof input === "string" ? encoder.encode(input) : input);
var decode = (str) => {
  const stripped = stripCrlf(str);
  const length = stripped.length;
  if (length % 4 !== 0) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Length must be a multiple of 4, but is ${length}`
    }));
  }
  const index = stripped.indexOf("=");
  if (index !== -1 && (index < length - 2 || index === length - 2 && stripped[length - 1] !== "=")) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: "Found a '=' character, but it is not at the end"
    }));
  }
  const missingOctets = stripped.endsWith("==") ? 2 : stripped.endsWith("=") ? 1 : 0;
  const decodedLength = 3 * (length / 4) - missingOctets;
  const native = decodeNative(stripped, decodedLength, undefined);
  if (native)
    return succeed2(native);
  if (native === null) {
    const invalid = invalidCharacter.exec(stripped);
    if (invalid !== null) {
      return fail2(new EncodingError({
        kind: "Decode",
        module: "Base64",
        input: stripped,
        message: `Invalid character ${invalid[0]}`
      }));
    }
  }
  try {
    const result = new Uint8Array(decodedLength);
    for (let i = 0, j = 0;i < length; i += 4, j += 3) {
      const buffer = getCode(stripped.charCodeAt(i)) << 18 | getCode(stripped.charCodeAt(i + 1)) << 12 | getCode(stripped.charCodeAt(i + 2)) << 6 | getCode(stripped.charCodeAt(i + 3));
      result[j] = buffer >> 16;
      result[j + 1] = buffer >> 8 & 255;
      result[j + 2] = buffer & 255;
    }
    return succeed2(result);
  } catch (cause) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: cause instanceof Error ? cause.message : "Invalid input"
    }));
  }
};
var encodeBytes = (bytes) => {
  const length = bytes.length;
  const toBase64 = Uint8Array.prototype.toBase64;
  if (length >= 32 && typeof toBase64 === "function")
    return toBase64.call(bytes);
  return length < 128 ? encodeShort(bytes) : encodeLong(bytes);
};
var encodeShort = (bytes) => {
  const length = bytes.length;
  let result = "";
  let i;
  for (i = 2;i < length; i += 3) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += alphabet[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result += alphabet[bytes[i] & 63];
  }
  if (i === length + 1) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4];
    result += "==";
  }
  if (i === length) {
    result += alphabet[bytes[i - 2] >> 2];
    result += alphabet[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += alphabet[(bytes[i - 1] & 15) << 2];
    result += "=";
  }
  return result;
};
var encodeLong = (bytes) => {
  const length = bytes.length;
  const result = new Uint8Array(Math.ceil(length / 3) * 4);
  let i;
  let j = 0;
  for (i = 2;i < length; i += 3, j += 4) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result[j + 2] = alphabetCodes[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result[j + 3] = alphabetCodes[bytes[i] & 63];
  }
  if (i === length + 1) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4];
    result[j + 2] = paddingCode;
    result[j + 3] = paddingCode;
  }
  if (i === length) {
    result[j] = alphabetCodes[bytes[i - 2] >> 2];
    result[j + 1] = alphabetCodes[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result[j + 2] = alphabetCodes[(bytes[i - 1] & 15) << 2];
    result[j + 3] = paddingCode;
  }
  return decoder.decode(result);
};
var encoder = /* @__PURE__ */ new TextEncoder;
var decoder = /* @__PURE__ */ new TextDecoder("utf-8", {
  ignoreBOM: true
});
var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var alphabetCodes = /* @__PURE__ */ encoder.encode(alphabet);
var paddingCode = 61;
var invalidCharacter = /[^A-Za-z0-9+/=]/;
var codes = /* @__PURE__ */ new Uint8Array(123).fill(255);
for (let i = 0;i < alphabet.length; i++)
  codes[/* @__PURE__ */ alphabet.charCodeAt(i)] = i;
codes[61] = 0;
var getCode = (charCode) => {
  if (charCode >= codes.length || codes[charCode] === 255) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  return codes[charCode];
};

function resolve2(ast) {
  return ast.checks ? ast.checks[ast.checks.length - 1].annotations : ast.annotations;
}
function resolveAt(key) {
  return (ast) => resolve2(ast)?.[key];
}
var STRUCTURAL_ANNOTATION_KEY = "~structural";
var IDENTIFIER_FALLBACK_KEY = "~identifier";
var SENTINELS_ANNOTATION_KEY = "~sentinels";
var CONSTRUCTOR_ANNOTATION_KEY = "~constructor";
var jsonSchemaAnnotationKeys = ["title", "description", "default", "examples", "readOnly", "writeOnly", "format", "contentEncoding", "contentMediaType", "contentSchema"];
var resolveIdentifier = /* @__PURE__ */ resolveAt("identifier");
var resolveIdentifierFallback = /* @__PURE__ */ resolveAt(IDENTIFIER_FALLBACK_KEY);
var getExpected = /* @__PURE__ */ memoize((ast) => {
  const identifier = resolve2(ast)?.identifier;
  if (typeof identifier === "string")
    return identifier;
  return ast.getExpected(getExpected);
});
var annotationExcludedKeys = /* @__PURE__ */ new Set([SENTINELS_ANNOTATION_KEY, STRUCTURAL_ANNOTATION_KEY, "representation", "arbitraryConstraint", "toJsonSchema", "toCode", "toEquivalence", "toFormatter", "toCodec", "toCodecJson", "toCodecStringTree", "toCodecIso", "toCodecArbitrary"]);

var missing = /* @__PURE__ */ Symbol.for("effect/schema/parser/missing");
var succeed6 = succeed4;
var missingExit = /* @__PURE__ */ succeed6(missing);
var sameExit = /* @__PURE__ */ Object.assign(/* @__PURE__ */ succeed6(missing), {
  [missing]: true
});
var isSameExit = (result) => result[missing] === true;
var toOption = (value) => value === missing ? none2() : some2(value);
var fromOptionExit = (option) => option._tag === "None" ? missingExit : succeed6(option.value);

var TypeId6 = "~effect/SchemaIssue/Issue";
function isIssue(u) {
  return hasProperty(u, TypeId6) && u[TypeId6] === TypeId6;
}
function hasInput(issue) {
  return Object.hasOwn(issue, "input");
}

class IssueNodeImpl {
  [TypeId6] = TypeId6;
  constructor(input, options) {
    if (options?.reportInput === true && input !== missing) {
      this.input = input;
    }
  }
}
var Filter = class extends IssueNodeImpl {
  _tag = "Filter";
  filter;
  issue;
  constructor(filter, issue, input, options) {
    super(input, options);
    this.filter = filter;
    this.issue = issue;
  }
};
var Encoding = class extends IssueNodeImpl {
  _tag = "Encoding";
  ast;
  issue;
  constructor(ast, issue, input, options) {
    super(input, options);
    this.ast = ast;
    this.issue = issue;
  }
};
var Pointer = class extends IssueNodeImpl {
  _tag = "Pointer";
  path;
  issue;
  constructor(path, issue) {
    super();
    this.path = path;
    this.issue = issue;
  }
};
var MissingKey = class extends IssueNodeImpl {
  _tag = "MissingKey";
  annotations;
  constructor(annotations) {
    super();
    this.annotations = annotations;
  }
};
var UnexpectedKey = class extends IssueNodeImpl {
  _tag = "UnexpectedKey";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var Composite = class extends IssueNodeImpl {
  _tag = "Composite";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var InvalidType = class extends IssueNodeImpl {
  _tag = "InvalidType";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var InvalidValue = class extends IssueNodeImpl {
  _tag = "InvalidValue";
  annotations;
  constructor(annotations, input, options) {
    super(input, options);
    this.annotations = annotations;
  }
};
var AnyOf = class extends IssueNodeImpl {
  _tag = "AnyOf";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var OneOf = class extends IssueNodeImpl {
  _tag = "OneOf";
  ast;
  successes;
  constructor(ast, successes, input, options) {
    super(input, options);
    this.ast = ast;
    this.successes = successes;
  }
};
function makeFilterIssue(entry, input, options) {
  if (isIssue(entry)) {
    return entry;
  }
  if (typeof entry === "string") {
    return new InvalidValue({
      message: entry
    }, input, options);
  }
  const inner = typeof entry.issue === "string" ? new InvalidValue({
    message: entry.issue
  }, input, options) : entry.issue;
  return new Pointer(entry.path, inner);
}
function makeSingle(out, input, options) {
  if (out === undefined) {
    return;
  }
  if (typeof out === "boolean") {
    return out ? undefined : new InvalidValue(undefined, input, options);
  }
  return makeFilterIssue(out, input, options);
}
function normalizeFilterOutput(ast, out, input, options) {
  if (Array.isArray(out)) {
    if (!isReadonlyArrayNonEmpty(out)) {
      return;
    }
    return out.length === 1 ? makeFilterIssue(out[0], input, options) : new Composite(ast, map(out, (entry) => makeFilterIssue(entry, input, options)), input, options);
  }
  return makeSingle(out, input, options);
}
var defaultLeafHook = (issue) => {
  const message = findMessage(issue);
  if (message !== undefined)
    return message;
  switch (issue._tag) {
    case "InvalidType":
      return getExpectedMessage(getExpected(issue.ast), issue);
    case "InvalidValue": {
      const expected = findExpected(issue);
      if (expected !== undefined)
        return getExpectedMessage(expected, issue);
      const input = formatInput(issue);
      return input === undefined ? "Expected a valid value" : `Invalid data ${input}`;
    }
    case "MissingKey":
      return "Missing key";
    case "UnexpectedKey": {
      const input = formatInput(issue);
      return input === undefined ? "Expected no excess property" : `Unexpected key with value ${input}`;
    }
    case "Forbidden":
      return "Forbidden operation";
    case "OneOf": {
      const input = formatInput(issue);
      return input === undefined ? "Expected exactly one member to match" : `Expected exactly one member to match the input ${input}`;
    }
  }
};
var defaultCheckHook = (issue) => findMessage(issue) ?? findMessage(issue.issue);
function formatInput(issue) {
  return hasInput(issue) ? format(issue.input) : undefined;
}
function findExpected(issue) {
  const expected = issue.annotations?.expected;
  return typeof expected === "string" ? expected : undefined;
}
function getExpectedMessage(expected, issue) {
  const input = formatInput(issue);
  return input === undefined ? `Expected ${expected}` : `Expected ${expected}, got ${input}`;
}
function getFilterMessage(issue, checkHook) {
  const message = checkHook(issue);
  if (message !== undefined || issue.issue._tag !== "InvalidValue")
    return message;
  const expected = findExpected(issue.issue);
  return expected === undefined ? getExpectedMessage(formatCheck(issue.filter), issue) : getExpectedMessage(expected, issue.issue);
}
function formatCheck(check) {
  const expected = check.annotations?.expected;
  if (typeof expected === "string")
    return expected;
  switch (check._tag) {
    case "Filter":
      return "<filter>";
    case "FilterGroup":
      return check.checks.map((check) => formatCheck(check)).join(" & ");
  }
}
function makeFormatterDefault() {
  return (issue) => formatIssue(issue, "");
}
var defaultFormatter = /* @__PURE__ */ makeFormatterDefault();
function formatIssue(issue, path, messageOverride) {
  let message;
  switch (issue._tag) {
    case "Filter":
      return formatIssue(issue.issue, path, messageOverride ?? getFilterMessage(issue, defaultCheckHook));
    case "Encoding":
      return formatIssue(issue.issue, path, messageOverride);
    case "Pointer":
      return formatIssue(issue.issue, path + formatPath(issue.path), messageOverride);
    case "Composite":
    case "AnyOf": {
      if (issue._tag === "Composite" || issue.issues.length > 0) {
        return issue.issues.map((issue) => formatIssue(issue, path, messageOverride)).join(`
`);
      }
      message = messageOverride ?? findMessage(issue) ?? getExpectedMessage(getExpected(issue.ast), issue);
      break;
    }
    default:
      message = messageOverride ?? defaultLeafHook(issue);
      break;
  }
  return path ? `${message}
  at ${path}` : message;
}
function findMessage(issue) {
  if (issue._tag === "Pointer" || issue._tag === "Composite")
    return;
  if (issue._tag === "Encoding")
    return findMessage(issue.issue);
  const annotations = issue._tag === "Filter" ? issue.filter.annotations : ("annotations" in issue) ? issue.annotations : issue.ast.annotations;
  const message = annotations?.[issue._tag === "MissingKey" ? "messageMissingKey" : issue._tag === "UnexpectedKey" ? "messageUnexpectedKey" : "message"];
  if (typeof message === "string")
    return message;
}

function getSchemaIssue(cause) {
  let issue;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isIssue(reason.error)) {
      return;
    }
    issue ??= reason.error;
  }
  return issue;
}
function getSchemaIssueOrThrow(cause, message) {
  const issue = getSchemaIssue(cause);
  if (issue === undefined) {
    throw new Error(message, {
      cause
    });
  }
  return issue;
}

var makeGetter = (fields) => Object.assign(Object.create(Prototype), fields);
var passthrough_ = /* @__PURE__ */ makeGetter({
  _tag: "Passthrough"
});
function passthrough2() {
  return passthrough_;
}
function transform(f) {
  return makeGetter({
    _tag: "Transform",
    transform: f
  });
}
function transformEffect(f) {
  return makeGetter({
    _tag: "TransformEffect",
    transform: f
  });
}
function transformOptional(f) {
  return makeGetter({
    _tag: "TransformOptional",
    transform: f
  });
}
function transformOptionalEffect(f) {
  return makeGetter({
    _tag: "TransformOptionalEffect",
    transform: f
  });
}
function omit() {
  return transformOptional(() => none2());
}
function withDefault(defaultValue) {
  return transformOptionalEffect((o) => {
    const filtered = filter(o, isNotUndefined);
    return isSome2(filtered) ? succeed5(filtered) : mapEager2(defaultValue, some2);
  });
}
function String2() {
  return transform(globalThis.String);
}
function Number3() {
  return transform(globalThis.Number);
}
function encodeBase64() {
  return transform(encode);
}
function decodeBase64() {
  return transformEffect((input, options) => mapErrorEager2(fromResult2(decode(input)), () => new InvalidValue({
    expected: "a valid Base64 string"
  }, input, options)));
}

var ContentTypeId = /* @__PURE__ */ Symbol.for("~effect/Schema/content");
function getContent(operation) {
  return operation[ContentTypeId];
}

var Middleware = class extends Class {
  _tag = "Middleware";
  decode;
  encode;
  constructor(decode, encode) {
    super();
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Middleware(this.encode, this.decode);
  }
};
var TypeId7 = "~effect/SchemaTransformation/Transformation";
var Transformation = class extends Class {
  [TypeId7] = TypeId7;
  _tag = "Transformation";
  decode;
  encode;
  constructor(decode, encode) {
    super();
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Transformation(this.encode, this.decode);
  }
};
function isTransformation(u) {
  return hasProperty(u, TypeId7) && u[TypeId7] === TypeId7;
}
var makeTransformation = (options) => {
  if (isTransformation(options)) {
    return options;
  }
  return new Transformation(options.decode, options.encode);
};
function transformEffect2(options) {
  return new Transformation(transformEffect(options.decode), transformEffect(options.encode));
}
function transform2(options) {
  return new Transformation(transform(options.decode), transform(options.encode));
}
var passthrough_2 = /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough2(), /* @__PURE__ */ passthrough2());
function passthrough3() {
  return passthrough_2;
}
var numberFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ String2());
var urlFromString = /* @__PURE__ */ transformEffect2({
  decode: (s, options) => URL.canParse(s) ? succeed5(new URL(s)) : fail5(new InvalidValue({
    expected: "a valid URL string"
  }, s, options)),
  encode: (url) => succeed5(url.href)
});
var uint8ArrayFromBase64String = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase64(), /* @__PURE__ */ encodeBase64());

function makeGuard(tag) {
  return (ast) => ast._tag === tag;
}
var isDeclaration = /* @__PURE__ */ makeGuard("Declaration");
var isNever2 = /* @__PURE__ */ makeGuard("Never");
var isLiteral = /* @__PURE__ */ makeGuard("Literal");
var isUniqueSymbol = /* @__PURE__ */ makeGuard("UniqueSymbol");
var isArrays = /* @__PURE__ */ makeGuard("Arrays");
var isObjects = /* @__PURE__ */ makeGuard("Objects");
var isSuspend = /* @__PURE__ */ makeGuard("Suspend");
var Link = class {
  to;
  transformation;
  constructor(to, transformation) {
    this.to = to;
    this.transformation = transformation;
  }
};
var defaultParseOptions = {};
var Context = class {
  isOptional;
  isMutable;
  constructorDefault;
  annotations;
  constructor(isOptional, isMutable, constructorDefault = undefined, annotations = undefined) {
    this.isOptional = isOptional;
    this.isMutable = isMutable;
    this.constructorDefault = constructorDefault;
    this.annotations = annotations;
  }
};
var TypeId8 = "~effect/Schema";

class ASTNodeImpl {
  [TypeId8] = TypeId8;
  annotations;
  checks;
  encoding;
  context;
  constructor(annotations = undefined, checks = undefined, encoding = undefined, context = undefined) {
    this.annotations = annotations;
    this.checks = checks;
    this.encoding = encoding;
    this.context = context;
  }
  toString() {
    return `<${this._tag}>`;
  }
}
var Declaration = class extends ASTNodeImpl {
  _tag = "Declaration";
  typeParameters;
  run;
  encodingChecks;
  encodingRun;
  constructor(typeParameters, run, annotations, checks, encoding, context, encodingChecks, encodingRun) {
    super(annotations, checks, encoding, context);
    this.typeParameters = typeParameters;
    this.run = run;
    this.encodingChecks = encodingChecks;
    this.encodingRun = encodingRun;
  }
  getParser() {
    let run;
    return (input, options) => {
      if (input === missing)
        return missingExit;
      run ??= this.run(this.typeParameters);
      try {
        return run(input, this, options);
      } catch (error) {
        return die3(error);
      }
    };
  }
  _rebuild(recur, checks, encodingChecks, run, encodingRun) {
    const tps = mapOrSame(this.typeParameters, recur);
    return tps === this.typeParameters && checks === this.checks && encodingChecks === this.encodingChecks && run === this.run && encodingRun === this.encodingRun ? this : new Declaration(tps, run, this.annotations, checks, undefined, this.context, encodingChecks, encodingRun);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks, this.run, this.encodingRun);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks, this.encodingRun ?? this.run, this.run);
  }
  getExpected() {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    return "<Declaration>";
  }
};
var Null = class extends ASTNodeImpl {
  _tag = "Null";
  getParser() {
    return fromConst(this, null);
  }
  getExpected() {
    return "null";
  }
};
var null_ = /* @__PURE__ */ new Null;
var Undefined = class extends ASTNodeImpl {
  _tag = "Undefined";
  getParser() {
    return fromConst(this, undefined);
  }
  toCodecJson() {
    return replaceEncoding(this, [undefinedToNull]);
  }
  getExpected() {
    return "undefined";
  }
};
var undefinedToNull = /* @__PURE__ */ new Link(null_, /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform(() => {
  return;
}), /* @__PURE__ */ transform(() => null)));
var undefined_2 = /* @__PURE__ */ new Undefined;
var Unknown = class extends ASTNodeImpl {
  _tag = "Unknown";
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  getExpected() {
    return "unknown";
  }
};
var unknown = /* @__PURE__ */ new Unknown;
var Literal = class extends ASTNodeImpl {
  _tag = "Literal";
  literal;
  constructor(literal, annotations, checks, encoding, context) {
    super(annotations, checks, encoding, context);
    if (typeof literal === "number" && !globalThis.Number.isFinite(literal)) {
      throw new Error(`A numeric literal must be finite, got ${format(literal)}`);
    }
    this.literal = literal;
  }
  getParser() {
    return fromConst(this, this.literal);
  }
  matchPart(s, _options) {
    return s === globalThis.String(this.literal) ? this.literal : undefined;
  }
  toCodecJson() {
    return typeof this.literal === "bigint" ? literalToString(this) : this;
  }
  toCodecStringTree() {
    return typeof this.literal === "string" ? this : literalToString(this);
  }
  getExpected() {
    return typeof this.literal === "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
  }
};
function literalToString(ast) {
  const literalAsString = globalThis.String(ast.literal);
  return replaceEncoding(ast, [new Link(new Literal(literalAsString), new Transformation(transform(() => ast.literal), transform(() => literalAsString)))]);
}
var String3 = class extends ASTNodeImpl {
  _tag = "String";
  getParser() {
    return fromRefinement(this, isString);
  }
  matchPart(s, options) {
    const checks = this.checks;
    return checks && !options.disableChecks && collectIssues(checks, s, undefined, this, options) ? undefined : s;
  }
  getExpected() {
    return "string";
  }
};
var string2 = /* @__PURE__ */ new String3;
var Number4 = class extends ASTNodeImpl {
  _tag = "Number";
  getParser() {
    return fromRefinement(this, isNumber);
  }
  matchKey(s, options) {
    return this._match(isStringNumberRegExp, s, options);
  }
  matchPart(s, options) {
    return this._match(isStringFiniteRegExp, s, options);
  }
  _match(regexp, s, options) {
    if (!regexp.test(s))
      return;
    const value = globalThis.Number(s);
    if (options.disableChecks || !this.checks)
      return value;
    return collectIssues(this.checks, value, undefined, this, options) ? undefined : value;
  }
  toCodecJson() {
    if (this.checks && (hasCheck(this.checks, "effect/schema/isFinite") || hasCheck(this.checks, "effect/schema/isInt"))) {
      return this;
    }
    return replaceEncoding(this, [numberToJson]);
  }
  toCodecStringTree() {
    if (this.toCodecJson() === this) {
      return replaceEncoding(this, [finiteToString]);
    }
    return replaceEncoding(this, [numberToString]);
  }
  getExpected() {
    return "number";
  }
};
function hasCheck(checks, id) {
  return checks.some((check) => check.annotations?.representation?.id === id || check._tag === "FilterGroup" && hasCheck(check.checks, id));
}
var number2 = /* @__PURE__ */ new Number4;
var Boolean2 = class extends ASTNodeImpl {
  _tag = "Boolean";
  getParser() {
    return fromRefinement(this, isBoolean);
  }
  getExpected() {
    return "boolean";
  }
};
var boolean = /* @__PURE__ */ new Boolean2;
var Arrays = class extends ASTNodeImpl {
  _tag = "Arrays";
  isMutable;
  elements;
  rest;
  encodingChecks;
  constructor(isMutable, elements, rest, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.isMutable = isMutable;
    this.elements = elements;
    this.rest = rest;
    this.encodingChecks = encodingChecks;
    let hasOptional = false;
    for (let i = 0;i < elements.length; i++) {
      if (isOptional(elements[i])) {
        hasOptional = true;
      } else if (hasOptional) {
        throw new Error("A required element cannot follow an optional element. ts(1257)");
      }
    }
    if (hasOptional && rest.length > 1) {
      throw new Error("A required element cannot follow an optional element. ts(1257)");
    }
    for (let i = 1;i < rest.length; i++) {
      if (isOptional(rest[i])) {
        throw new Error("An optional element cannot follow a rest element. ts(1266)");
      }
    }
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    let elements;
    let rest;
    const elementLen = ast.elements.length;
    const tailLen = Math.max(0, ast.rest.length - 1);
    function getParser(tailThreshold, index) {
      if (index < elementLen) {
        return elements[index];
      } else if (index >= tailThreshold) {
        return rest[index - tailThreshold + 1];
      }
      return rest[0];
    }
    const finish = (state) => {
      const {
        input,
        len,
        options
      } = state;
      if (ast.rest.length === 0 && len > elementLen) {
        for (let i = elementLen;i < len; i++) {
          const unexpected = new UnexpectedKey(ast, input[i], options);
          const issue = new Pointer([i], unexpected);
          if (options.errors === "all") {
            if (state.issues)
              state.issues.push(issue);
            else
              state.issues = [issue];
          } else {
            return fail5(new Composite(ast, [issue], input, options));
          }
        }
      }
      if (state.issues) {
        return fail5(new Composite(ast, state.issues, input, options));
      }
      return succeed6(state.output);
    };
    const parse = (input, options) => {
      const len = input.length;
      const state = {
        ast,
        getParser,
        input,
        len,
        tailThreshold: Math.max(elementLen, len - tailLen),
        output: [],
        issues: undefined,
        options
      };
      const end = ast.rest.length === 0 ? elementLen : Math.max(len, elementLen + tailLen);
      const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
      const eff = concurrency === 1 ? parseArray(state, input, 0, end) : parseArrayConcurrent(state, input, {
        concurrency,
        end
      });
      if (!eff)
        return finish(state);
      if (effectIsExit(eff))
        return flatMapEager2(eff, () => finish(state));
      let first = true;
      return suspend2(() => {
        if (!first)
          return parse(input, options);
        first = false;
        return flatMap3(eff, () => finish(state));
      });
    };
    return (input, options) => {
      if (input === missing)
        return missingExit;
      try {
        if (!Array.isArray(input)) {
          return fail5(new InvalidType(ast, input, options));
        }
        if (!elements) {
          elements = ast.elements.map((ast) => ({
            ast,
            parser: compileField(ast)
          }));
          rest = ast.rest.map((ast) => ({
            ast,
            parser: compileField(ast)
          }));
        }
        return parse(input, options);
      } catch (error) {
        return die3(error);
      }
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const elements = mapOrSame(this.elements, recur);
    const rest = mapOrSame(this.rest, recur);
    return elements === this.elements && rest === this.rest && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Arrays(this.isMutable, elements, rest, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  getExpected() {
    return "array";
  }
};
function stepArray(s, item, exit, i) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, i, exit);
  }
  const value = isSameExit(exit) ? item : exit[args];
  if (value !== missing) {
    s.output[i] = value;
  } else {
    const p = s.getParser(s.tailThreshold, i);
    if (isOptional(p.ast))
      return;
    const issue = new Pointer([i], new MissingKey(p.ast.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      return fail4(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parseArrayOptions = {
  onItem(s, item, i) {
    const value = i < s.len ? item : missing;
    return s.getParser(s.tailThreshold, i).parser(value, s.options);
  },
  step: stepArray
};
var parseArray = /* @__PURE__ */ iterateEager()(parseArrayOptions);
var parseArrayConcurrent = /* @__PURE__ */ iterateConcurrent()(parseArrayOptions);
var wrapPropertyKeyIssue = (s, ast, key, exit) => {
  if (exit.cause.reasons.length === 0) {
    return exit;
  }
  const issue = getSchemaIssue(exit.cause);
  if (issue === undefined) {
    return failCause2(map3(exit.cause, (issue) => new Composite(ast, [new Pointer([key], issue)], s.input, s.options)));
  }
  const pointer = new Pointer([key], issue);
  if (s.options.errors === "all") {
    if (s.issues)
      s.issues.push(pointer);
    else
      s.issues = [pointer];
  } else {
    return fail4(new Composite(ast, [pointer], s.input, s.options));
  }
};
var FINITE_PATTERN = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[Ee][+-]?\\d+)?";
function getIndexSignatureKeys(input, parameter, options = defaultParseOptions) {
  let stringKeys;
  let symbolKeys;
  function go(parameter) {
    switch (parameter._tag) {
      case "String":
      case "TemplateLiteral":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchPart(k, options) !== undefined);
      case "Number":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchKey(k, options) !== undefined);
      case "Symbol":
        return (symbolKeys ??= Object.getOwnPropertySymbols(input)).filter((k) => Object.prototype.propertyIsEnumerable.call(input, k) && parameter.matchKey(k, options) !== undefined);
      case "Union":
        return [...new Set(parameter.types.flatMap(go))];
      default:
        return [];
    }
  }
  return go(parameterFromPropertyKey(toEncoded(parameter)));
}
var PropertySignature = class {
  name;
  type;
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
};
function isIndexSignatureParameterSide(ast) {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return ast.types.every(isIndexSignatureParameterSide);
    default:
      return false;
  }
}
function isIndexSignatureParameterEncodedSide(ast) {
  const encoded = getLastEncoding(ast);
  switch (encoded._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return encoded.types.every(isIndexSignatureParameterEncodedSide);
    default:
      return false;
  }
}
function isIndexSignatureParameter(ast) {
  return isIndexSignatureParameterSide(ast) && isIndexSignatureParameterEncodedSide(ast);
}
var IndexSignature = class {
  parameter;
  type;
  constructor(parameter, type) {
    if (!isIndexSignatureParameter(parameter)) {
      throw new Error(`Invalid index signature parameter ${parameter._tag}`);
    }
    this.parameter = parameter;
    this.type = type;
    if (isOptional(type) || type.encoding !== undefined && isOptional(toEncoded(type))) {
      throw new Error("Cannot use `Schema.optionalKey` or `Schema.optional` with index signatures. Index signatures already allow keys to be absent; use `Schema.UndefinedOr` to allow `undefined` values.");
    }
  }
};
var Objects = class extends ASTNodeImpl {
  _tag = "Objects";
  propertySignatures;
  indexSignatures;
  encodingChecks;
  constructor(propertySignatures, indexSignatures, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.propertySignatures = propertySignatures;
    this.indexSignatures = indexSignatures;
    this.encodingChecks = encodingChecks;
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    const hasProperties = ast.propertySignatures.length;
    const indexCount = ast.indexSignatures.length;
    if (!hasProperties && !indexCount) {
      return fromRefinement(ast, isNotNullish);
    }
    let properties;
    let indexes;
    const compileMembers = () => {
      if (!properties) {
        properties = ast.propertySignatures.map((ps) => ({
          parser: compileField(ps.type),
          name: ps.name,
          type: ps.type,
          ownOnly: requiresOwnProperty(ps.name)
        }));
        indexes = indexCount ? ast.indexSignatures.map((is) => ({
          is,
          parserKey: compile(parameterFromPropertyKey(is.parameter)),
          parserValue: compileField(is.type)
        })) : undefined;
      }
      return properties;
    };
    const makeFallback = () => {
      const expectedKeys = new Set(ast.propertySignatures.map((ps) => typeof ps.name === "number" ? globalThis.String(ps.name) : ps.name));
      const finishIndex = (s, key, k2, inputValue, exitValue) => {
        if (exitValue._tag === "Failure") {
          return wrapPropertyKeyIssue(s, ast, key, exitValue) ?? void_2;
        }
        const value = isSameExit(exitValue) ? inputValue : exitValue[args];
        if (k2 !== missing && value !== missing) {
          if (hasProperties && (expectedKeys.has(key) || expectedKeys.has(typeof k2 === "number" ? globalThis.String(k2) : k2)))
            return void_2;
          assignProperty(s.out, k2, value);
        }
        return void_2;
      };
      const parseIndex = (s, key, index, exitKey) => {
        if (!exitKey) {
          const eff = index.parserKey(key, s.options);
          if (!effectIsExit(eff)) {
            return flatMap3(exit2(eff), (exit) => parseIndex(s, key, index, exit));
          }
          exitKey = eff;
        }
        if (exitKey._tag === "Failure") {
          return wrapPropertyKeyIssue(s, ast, key, exitKey) ?? void_2;
        }
        const k2 = isSameExit(exitKey) ? key : exitKey[args];
        const inputValue = s.input[key];
        const result = index.parserValue(inputValue, s.options);
        return effectIsExit(result) ? finishIndex(s, key, k2, inputValue, result) : flatMap3(exit2(result), (exit) => finishIndex(s, key, k2, inputValue, exit));
      };
      const parseStringIndex = (s, key, index) => {
        const inputValue = s.input[key];
        const result = index.parserValue(inputValue, s.options);
        return effectIsExit(result) ? finishIndex(s, key, key, inputValue, result) : flatMap3(exit2(result), (exit) => finishIndex(s, key, key, inputValue, exit));
      };
      const parseIndexes = indexCount ? iterateConcurrent()({
        onItem: (s, [key, index]) => index.is.parameter === string2 ? parseStringIndex(s, key, index) : parseIndex(s, key, index),
        step: (_s, _item, exit) => exit._tag === "Failure" ? exit : undefined
      }) : undefined;
      return fnUntracedEager2(function* (input, options) {
        if (input === missing) {
          return missing;
        }
        if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
          return yield* fail5(new InvalidType(ast, input, options));
        }
        compileMembers();
        const record = input;
        const out = {};
        const state = {
          ast,
          input: record,
          out,
          issues: undefined,
          options
        };
        const errorsAllOption = options.errors === "all";
        const onExcessPropertyError = options.onExcessProperty === "error";
        const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
        const indexKeys = indexCount && onExcessPropertyError ? ast.indexSignatures.map((index) => getIndexSignatureKeys(record, index.parameter, options)) : undefined;
        if (onExcessPropertyError) {
          const coveredKeys = indexKeys ? new Set(expectedKeys) : expectedKeys;
          if (indexKeys) {
            for (const keys of indexKeys) {
              for (const key of keys)
                coveredKeys.add(key);
            }
          }
          const inputKeys = Reflect.ownKeys(record);
          for (let i = 0;i < inputKeys.length; i++) {
            const key = inputKeys[i];
            if (!coveredKeys.has(key) && Object.prototype.propertyIsEnumerable.call(record, key)) {
              const unexpected = new UnexpectedKey(ast, record[key], options);
              const issue = new Pointer([key], unexpected);
              if (errorsAllOption) {
                if (state.issues) {
                  state.issues.push(issue);
                } else {
                  state.issues = [issue];
                }
                continue;
              } else {
                return yield* fail5(new Composite(ast, [issue], input, options));
              }
            }
          }
        }
        if (hasProperties) {
          const eff = concurrency === 1 ? parseProperties(state, properties) : parsePropertiesConcurrent(state, properties, {
            concurrency
          });
          if (eff)
            yield* eff;
        }
        if (indexCount && concurrency === 1) {
          for (let i = 0;i < indexCount; i++) {
            const index = indexes[i];
            const parse = index.is.parameter === string2 ? parseStringIndex : parseIndex;
            const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
            for (let j = 0;j < keys.length; j++) {
              const eff = parse(state, keys[j], index);
              if (!effectIsExit(eff))
                yield* eff;
              else if (eff._tag === "Failure")
                return yield* eff;
            }
          }
        } else if (parseIndexes) {
          const keyPairs = empty2();
          for (let i = 0;i < indexCount; i++) {
            const index = indexes[i];
            const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
            for (let j = 0;j < keys.length; j++) {
              keyPairs.push([keys[j], index]);
            }
          }
          const eff = parseIndexes(state, keyPairs, {
            concurrency
          });
          if (eff)
            yield* eff;
        }
        if (state.issues) {
          return yield* fail5(new Composite(ast, state.issues, input, options));
        }
        return out;
      });
    };
    if (indexCount)
      return makeFallback();
    let fallback;
    const resume = (snapshot, index, pending) => {
      const property = properties[index];
      return flatMap3(exit2(pending), (exit) => {
        const state = {
          ...snapshot,
          out: {
            ...snapshot.out
          }
        };
        const terminal = stepProperty(state, property, exit);
        if (terminal)
          return terminal;
        const done = () => succeed6(state.out);
        const eff = parseProperties(state, properties.slice(index + 1));
        return eff ? flatMapEager2(eff, done) : done();
      });
    };
    return (input, options) => {
      if (input === missing)
        return missingExit;
      if (options.errors === "all" || options.onExcessProperty !== undefined || options.concurrency !== undefined && resolveConcurrency(options.concurrency) !== 1) {
        return (fallback ??= makeFallback())(input, options);
      }
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return fail5(new InvalidType(ast, input, options));
      }
      const props = compileMembers();
      const record = input;
      const out = {};
      const state = {
        ast,
        input: record,
        out,
        issues: undefined,
        options
      };
      try {
        for (let index = 0;index < props.length; index++) {
          const property = props[index];
          const name = property.name;
          const hasKey = property.ownOnly ? Object.hasOwn(record, name) : (name in record);
          const value = hasKey ? record[name] : missing;
          const exit = property.parser(value, options);
          if (!effectIsExit(exit)) {
            return resume(state, index, exit);
          }
          if (isSameExit(exit)) {
            if (hasKey)
              assignProperty(out, name, value);
            continue;
          }
          const terminal = stepProperty(state, property, exit);
          if (terminal)
            return terminal;
        }
      } catch (error) {
        return die3(error);
      }
      return succeed6(out);
    };
  }
  _rebuild(recur, recurParameter, checks, encodingChecks) {
    const props = mapOrSame(this.propertySignatures, (ps) => {
      const t = recur(ps.type);
      return t === ps.type ? ps : new PropertySignature(ps.name, t);
    });
    const indexes = mapOrSame(this.indexSignatures, (is) => {
      const p = recurParameter(is.parameter);
      const t = recur(is.type);
      return p === is.parameter && t === is.type ? is : new IndexSignature(p, t);
    });
    return props === this.propertySignatures && indexes === this.indexSignatures && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Objects(props, indexes, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, recur, this.encodingChecks, this.checks);
  }
  recur(recur, recurParameter = recur) {
    return this._rebuild(recur, recurParameter, this.checks, this.encodingChecks);
  }
  getExpected() {
    if (this.propertySignatures.length === 0 && this.indexSignatures.length === 0)
      return "object | array";
    return "object";
  }
};
function stepProperty(s, p, exit) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, p.name, exit);
  }
  if (isSameExit(exit))
    return;
  const value = exit[args];
  if (value !== missing) {
    assignProperty(s.out, p.name, value);
    return;
  }
  delete s.out[p.name];
  if (!isOptional(p.type)) {
    const issue = new Pointer([p.name], new MissingKey(p.type.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
      return;
    } else {
      return fail4(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parsePropertiesOptions = {
  onItem(s, p) {
    if (!(p.ownOnly ? Object.hasOwn(s.input, p.name) : (p.name in s.input))) {
      return p.parser(missing, s.options);
    }
    const value = s.input[p.name];
    assignProperty(s.out, p.name, value);
    return p.parser(value, s.options);
  },
  step: stepProperty
};
var parseProperties = /* @__PURE__ */ iterateEager()(parsePropertiesOptions);
var parsePropertiesConcurrent = /* @__PURE__ */ iterateConcurrent()(parsePropertiesOptions);
function combineChecks(a, b) {
  if (!a)
    return b;
  if (!b)
    return a;
  return [...a, ...b];
}
function struct(fields, checks, annotations) {
  return new Objects(Reflect.ownKeys(fields).map((key) => {
    return new PropertySignature(key, fields[key].ast);
  }), [], annotations, checks);
}
function getAST(self) {
  return self.ast;
}
function tuple(elements, checks = undefined) {
  return new Arrays(false, elements.map((e) => e.ast), [], undefined, checks);
}
function union(members, options, checks) {
  return new Union(members.map(getAST), options, undefined, checks);
}
function structWithRest(ast, records) {
  if (ast.encoding || records.some((r) => r.encoding)) {
    throw new Error("StructWithRest does not support encodings");
  }
  let propertySignatures = ast.propertySignatures;
  let indexSignatures = ast.indexSignatures;
  let checks = ast.checks;
  for (const record of records) {
    for (const propertySignature of record.propertySignatures) {
      if (propertySignatures.some((ps) => ps.name === propertySignature.name)) {
        throw new Error(`Duplicate identifier: ${JSON.stringify(propertySignature.name)}. ts(2300)`);
      }
    }
    propertySignatures = propertySignatures.concat(record.propertySignatures);
    indexSignatures = indexSignatures.concat(record.indexSignatures);
    checks = combineChecks(checks, record.checks);
  }
  return new Objects(propertySignatures, indexSignatures, undefined, checks);
}
function tupleWithRest(ast, rest) {
  if (ast.encoding) {
    throw new Error("TupleWithRest does not support encodings");
  }
  return new Arrays(ast.isMutable, ast.elements, rest, undefined, ast.checks);
}
function mutable(ast) {
  if (ast.encoding) {
    throw new Error("mutable does not support encodings");
  }
  return new Arrays(true, ast.elements, ast.rest, ast.annotations, ast.checks, undefined, ast.context, ast.encodingChecks);
}
var toCandidate = /* @__PURE__ */ memoizeIdempotent((ast) => {
  while (true) {
    if (isSuspend(ast))
      return unknown;
    const encoding = ast.encoding;
    if (!encoding) {
      return ast.recur?.(toCandidate, identity) ?? ast;
    }
    if (encoding.some((link) => link.transformation._tag === "Middleware" && link.transformation.decode !== identity))
      return unknown;
    ast = encoding[encoding.length - 1].to;
  }
});
function getCandidateTypes(ast) {
  switch (ast._tag) {
    case "Null":
      return ["null"];
    case "Undefined":
      return ["undefined"];
    case "String":
    case "TemplateLiteral":
      return ["string"];
    case "Number":
      return ["number"];
    case "Boolean":
      return ["boolean"];
    case "Symbol":
    case "UniqueSymbol":
      return ["symbol"];
    case "BigInt":
      return ["bigint"];
    case "Arrays":
      return ["array"];
    case "ObjectKeyword":
      return ["object", "array", "function"];
    case "Objects":
      return ast.propertySignatures.length || ast.indexSignatures.length ? ["object"] : ["string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
    case "Enum":
      return Array.from(new Set(ast.enums.map(([, v]) => typeof v)));
    case "Literal":
      return [typeof ast.literal];
    case "Union":
      return Array.from(new Set(ast.types.flatMap(getCandidateTypes)));
    default:
      return ["null", "undefined", "string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
  }
}
function collectSentinels(ast) {
  switch (ast._tag) {
    default:
      return [];
    case "Declaration": {
      const s = ast.annotations?.[SENTINELS_ANNOTATION_KEY];
      return Array.isArray(s) ? s : [];
    }
    case "Objects":
      return ast.propertySignatures.flatMap((ps) => {
        const type = ps.type;
        if (!isOptional(type)) {
          if (isLiteral(type)) {
            return [{
              key: ps.name,
              literal: type.literal
            }];
          }
          if (isUniqueSymbol(type)) {
            return [{
              key: ps.name,
              literal: type.symbol
            }];
          }
        }
        return [];
      });
    case "Arrays":
      return ast.elements.flatMap((e, i) => {
        if (!isOptional(e)) {
          if (isLiteral(e)) {
            return [{
              key: i,
              literal: e.literal
            }];
          }
          if (isUniqueSymbol(e)) {
            return [{
              key: i,
              literal: e.symbol
            }];
          }
        }
        return [];
      });
    case "Union": {
      if (ast.types.length === 0)
        return [];
      const members = ast.types.map((type) => collectSentinels(toCandidate(type)));
      return members[0].filter((s) => members.every((sentinels) => sentinels.some((o) => o.key === s.key && o.literal === s.literal)));
    }
    case "Suspend":
      return collectSentinels(ast.thunk());
  }
}
var candidateIndexCache = /* @__PURE__ */ new WeakMap;
var emptyCandidates = /* @__PURE__ */ Object.freeze([]);
var getRuntimeType = (input) => input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
var objectPrototypeKeys = /* @__PURE__ */ new Set(Reflect.ownKeys(Object.prototype)).add("__proto__");
var requiresOwnProperty = (key) => objectPrototypeKeys.has(typeof key === "number" ? globalThis.String(key) : key);
var hasPropertySignature = (input, key) => Object.hasOwn(input, key) || (key in input) && !requiresOwnProperty(key);
function getCandidateIndex(types) {
  let index = candidateIndexCache.get(types);
  if (index)
    return index;
  let bySentinel;
  let sentinelCandidateCount = 0;
  let otherwise;
  let literalCandidates;
  let onlyLiterals = true;
  const literalOf = [];
  for (let i = 0;i < types.length; i++) {
    const a = types[i];
    const encoded = toCandidate(a);
    if (isNever2(encoded))
      continue;
    if (isLiteral(encoded) || isUniqueSymbol(encoded)) {
      literalCandidates ??= new Map;
      const literal = isLiteral(encoded) ? encoded.literal : encoded.symbol;
      literalOf[i] = literal;
      let arr = literalCandidates.get(literal);
      if (!arr)
        literalCandidates.set(literal, arr = []);
      arr.push(i);
    } else {
      onlyLiterals = false;
    }
    const sentinels = collectSentinels(encoded);
    if (sentinels.length) {
      bySentinel ??= new Map;
      sentinelCandidateCount++;
      for (const {
        key,
        literal
      } of sentinels) {
        let entry = bySentinel.get(key);
        if (!entry)
          bySentinel.set(key, entry = [new Map, new Set]);
        entry[1].add(i);
        let indexes = entry[0].get(literal);
        if (!indexes)
          entry[0].set(literal, indexes = new Set);
        indexes.add(i);
      }
    } else {
      otherwise ??= {};
      const candidateTypes = getCandidateTypes(encoded);
      for (const t of candidateTypes)
        (otherwise[t] ??= []).push(i);
    }
  }
  const fallbacks = {};
  const getFallback = (type) => fallbacks[type] ??= Object.freeze(otherwise?.[type] ?? emptyCandidates);
  if (onlyLiterals && literalCandidates) {
    literalCandidates.forEach(Object.freeze);
    index = (input) => literalCandidates.get(input) ?? emptyCandidates;
  } else if (bySentinel?.size === 1 && !otherwise) {
    const [key, [byValue]] = bySentinel.entries().next().value;
    const candidates = new Map;
    for (const [literal, indexes] of byValue) {
      candidates.set(literal, Object.freeze(Array.from(indexes)));
    }
    const all = Object.freeze(types.map((_, i) => i));
    index = (input, isConstructor) => {
      if (isObjectKeyword(input)) {
        const value = hasPropertySignature(input, key) ? input[key] : undefined;
        if (value !== undefined)
          return candidates.get(value) ?? emptyCandidates;
        if (isConstructor)
          return all;
      }
      return emptyCandidates;
    };
  } else if (bySentinel) {
    let commonSentinel;
    for (const entry of bySentinel) {
      if ((!commonSentinel || entry[1][0].size > commonSentinel[1][0].size) && entry[1][1].size === sentinelCandidateCount) {
        commonSentinel = entry;
      }
    }
    index = (input, isConstructor) => {
      const runtimeType = getRuntimeType(input);
      if (!isObjectKeyword(input))
        return getFallback(runtimeType);
      const selected = new Set(otherwise?.[runtimeType]);
      let directKey;
      if (commonSentinel) {
        const [key, [byValue]] = commonSentinel;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          if (!match)
            return getFallback(runtimeType);
          for (const i of match)
            selected.add(i);
          directKey = key;
        }
      }
      if (directKey === undefined) {
        for (const [key, [byValue, all]] of bySentinel) {
          const hasKey = hasPropertySignature(input, key);
          const value = hasKey ? input[key] : undefined;
          if (hasKey && (!isConstructor || value !== undefined)) {
            const match = byValue.get(value);
            if (match) {
              for (const i of match)
                selected.add(i);
            }
          } else if (isConstructor) {
            for (const i of all)
              selected.add(i);
          }
        }
      }
      for (const [key, [byValue, all]] of bySentinel) {
        if (key === directKey)
          continue;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          for (const i of selected) {
            if (all.has(i) && !match?.has(i))
              selected.delete(i);
          }
        }
      }
      return Array.from(selected).sort((a, b) => a - b);
    };
  } else {
    index = (input) => {
      const fallback = getFallback(getRuntimeType(input));
      return literalCandidates ? fallback.filter((i) => literalOf[i] === undefined || literalOf[i] === input) : fallback;
    };
  }
  candidateIndexCache.set(types, index);
  return index;
}
var Union = class extends ASTNodeImpl {
  _tag = "Union";
  types;
  options;
  encodingChecks;
  constructor(types, options, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.types = types;
    this.options = options;
    this.encodingChecks = encodingChecks;
  }
  getParser(compile, compileField) {
    const ast = this;
    const isConstructor = compileField !== undefined;
    const parsers = [];
    const parser = (i) => parsers[i] ??= compile(ast.types[i]);
    let index;
    return (input, options) => {
      if (input === missing) {
        return missingExit;
      }
      const candidates = (index ??= getCandidateIndex(ast.types))(input, isConstructor);
      if (candidates.length === 0) {
        return fail5(new AnyOf(ast, [], input, options));
      }
      if (candidates.length === 1) {
        const result = parser(candidates[0])(input, options);
        if (result._tag === "Success")
          return result;
        return effectIsExit(result) ? failSingleUnionCandidate(ast, result.cause, input, options) : catchSingleUnionCandidate(ast, result, input, options);
      }
      return parseUnionCandidates(ast, parser, candidates, input, options);
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const types = mapOrSame(this.types, recur);
    return types === this.types && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Union(types, this.options, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  matchPart(s, options) {
    for (const type of this.types) {
      const out = type.matchPart(s, options);
      if (out !== undefined)
        return out;
    }
    return;
  }
  getExpected(getExpected) {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    if (this.types.length === 0)
      return "never";
    const types = this.types.map((type) => {
      const encoded = toEncoded(type);
      switch (encoded._tag) {
        case "Arrays": {
          const literals = encoded.elements.filter(isLiteral);
          if (literals.length > 0) {
            return `${formatIsMutable(encoded.isMutable)}[ ${literals.map((e) => getExpected(e) + formatIsOptional(e.context?.isOptional)).join(", ")}, ... ]`;
          }
          break;
        }
        case "Objects": {
          const literals = encoded.propertySignatures.filter((ps) => isLiteral(ps.type));
          if (literals.length > 0) {
            return `{ ${literals.map((ps) => `${formatIsMutable(ps.type.context?.isMutable)}${formatPropertyKey(ps.name)}${formatIsOptional(ps.type.context?.isOptional)}: ${getExpected(ps.type)}`).join(", ")}, ... }`;
          }
          break;
        }
      }
      return getExpected(encoded);
    });
    return Array.from(new Set(types)).join(" | ");
  }
};
function failSingleUnionCandidate(ast, cause, input, options) {
  const issue = getSchemaIssue(cause);
  if (!issue)
    return failCause2(cause);
  return fail4(new AnyOf(ast, [issue], input, options));
}
function catchSingleUnionCandidate(ast, result, input, options) {
  return catchCause2(result, (cause) => failSingleUnionCandidate(ast, cause, input, options));
}
function parseUnionCandidates(ast, parser, candidates, input, options) {
  const state = {
    ast,
    parser,
    input,
    out: undefined,
    successes: ast.options?.mode === "oneOf" ? [] : undefined,
    issues: undefined,
    options
  };
  const eff = parseUnion(state, candidates);
  if (!eff) {
    if (state.out)
      return state.out;
    return fail5(new AnyOf(ast, state.issues ?? [], input, options));
  }
  if (effectIsExit(eff))
    return resumeUnion(eff, state);
  let first = true;
  return suspend2(() => {
    if (!first)
      return parseUnionCandidates(ast, parser, candidates, input, options);
    first = false;
    return resumeUnion(eff, state);
  });
}
function resumeUnion(eff, state) {
  return flatMapEager2(eff, (_) => {
    if (state.out)
      return isSameExit(state.out) ? succeed5(state.input) : state.out;
    return fail5(new AnyOf(state.ast, state.issues ?? [], state.input, state.options));
  });
}
var parseUnion = /* @__PURE__ */ iterateEager()({
  onItem(s, i) {
    return s.parser(i)(s.input, s.options);
  },
  step(s, i, exit) {
    if (exit._tag === "Failure") {
      const issue = getSchemaIssue(exit.cause);
      if (issue === undefined) {
        return exit;
      }
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      if (s.out && s.successes) {
        s.successes.push(s.ast.types[i]);
        return fail4(new OneOf(s.ast, s.successes, s.input, s.options));
      }
      s.out = exit;
      if (s.successes) {
        s.successes.push(s.ast.types[i]);
      } else {
        return void_2;
      }
    }
  }
});
var nonFiniteLiterals = /* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("Infinity"), /* @__PURE__ */ new Literal("-Infinity"), /* @__PURE__ */ new Literal("NaN")]);
function formatIsMutable(isMutable) {
  return isMutable ? "" : "readonly ";
}
function formatIsOptional(isOptional) {
  return isOptional ? "?" : "";
}
var Filter2 = class extends Class {
  _tag = "Filter";
  run;
  annotations;
  aborted;
  constructor(run, annotations = undefined, aborted = false) {
    super();
    this.run = run;
    this.annotations = annotations;
    this.aborted = aborted;
  }
  annotate(annotations) {
    return new Filter2(this.run, {
      ...this.annotations,
      ...annotations
    }, this.aborted);
  }
  abort() {
    return new Filter2(this.run, this.annotations, true);
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
var FilterGroup = class extends Class {
  _tag = "FilterGroup";
  checks;
  annotations;
  constructor(checks, annotations = undefined) {
    super();
    this.checks = checks;
    this.annotations = annotations;
  }
  annotate(annotations) {
    return new FilterGroup(this.checks, {
      ...this.annotations,
      ...annotations
    });
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
function makeFilter(filter, annotations, aborted = false) {
  return new Filter2((input, ast, options) => normalizeFilterOutput(ast, filter(input, ast, options), input, options), annotations, aborted);
}
function isFinite(annotations) {
  return makeFilter((n) => globalThis.Number.isFinite(n), {
    expected: "a finite number",
    representation: {
      id: "effect/schema/isFinite",
      payload: null
    },
    toJsonSchema: () => ({
      type: "number"
    }),
    toCode: () => ({
      runtime: "Schema.isFinite()"
    }),
    arbitraryConstraint: {
      number: "finite"
    },
    ...annotations
  });
}
var finite = /* @__PURE__ */ appendChecks(number2, [/* @__PURE__ */ isFinite()]);
var numberToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finite, nonFiniteLiterals]), /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ transform((n) => globalThis.Number.isFinite(n) ? n : globalThis.String(n))));
function isPattern(regExp, annotations) {
  const copy = new globalThis.RegExp(regExp);
  const payload = {
    source: copy.source,
    flags: copy.flags
  };
  return makeFilter((s) => {
    copy.lastIndex = 0;
    return copy.test(s);
  }, {
    expected: `a string matching the RegExp ${payload.source}`,
    representation: {
      id: "effect/schema/isPattern",
      payload
    },
    toJsonSchema: () => [{}, true],
    arbitraryConstraint: {
      patterns: [payload]
    },
    ...annotations
  });
}
var bodyOwners = /* @__PURE__ */ new WeakMap;
function copy(ast, changes) {
  const out = Object.assign(Object.create(Object.getPrototypeOf(ast)), ast, changes);
  if (Reflect.ownKeys(changes).every((key) => key === "context" || key === "encoding")) {
    bodyOwners.set(out, getContextOwner(ast));
  }
  return out;
}
function getContextOwner(ast) {
  const existing = bodyOwners.get(ast);
  if (existing !== undefined)
    return existing;
  if (ast.encoding === undefined)
    return ast;
  const owner = Object.assign(Object.create(Object.getPrototypeOf(ast)), ast, {
    encoding: undefined
  });
  bodyOwners.set(ast, owner);
  return owner;
}
function replaceEncoding(ast, encoding) {
  return ast.encoding === encoding ? ast : copy(ast, {
    encoding
  });
}
function replaceContext(ast, context) {
  if (ast.context === context) {
    return ast;
  }
  const owner = getContextOwner(ast);
  if (owner.context === context && owner.encoding === ast.encoding) {
    return owner;
  }
  return copy(ast, {
    context
  });
}
function getLastEncoding(ast) {
  return ast.encoding ? getLastEncoding(ast.encoding[ast.encoding.length - 1].to) : ast;
}
function annotate(ast, annotations) {
  if (ast.checks) {
    const last = ast.checks[ast.checks.length - 1];
    return replaceChecks(ast, append(ast.checks.slice(0, -1), last.annotate(annotations)));
  }
  return copy(ast, {
    annotations: {
      ...ast.annotations,
      ...annotations
    }
  });
}
function replaceChecks(ast, checks) {
  if (ast._tag === "Suspend" && checks) {
    throw new Error("Cannot add checks to Suspend");
  }
  if (ast.checks === checks) {
    return ast;
  }
  return copy(ast, {
    checks
  });
}
function appendChecks(ast, checks) {
  return replaceChecks(ast, combineChecks(ast.checks, checks));
}
function mapLink(link, f) {
  const to = f(link.to);
  return to === link.to ? link : new Link(to, link.transformation);
}
function updateLastLink(encoding, f) {
  const links = encoding;
  const last = links[links.length - 1];
  const out = mapLink(last, f);
  return out === last ? encoding : append(encoding.slice(0, encoding.length - 1), out);
}
function applyToLastLink(f) {
  return (ast) => ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, f)) : ast;
}
function replaceContextLastLink(ast, context) {
  return applyToLastLink((ast) => replaceContext(ast, context))(ast);
}
function applyToSelfOrLastLinkEncodingIdempotent(f, options) {
  function out(ast) {
    if (ast.encoding) {
      const last = ast.encoding[ast.encoding.length - 1];
      return options?.stopAt?.(last) ? ast : replaceEncoding(ast, updateLastLink(ast.encoding, out));
    }
    return f(ast);
  }
  return memoizeIdempotent(out);
}
function middlewareDecoding(ast, middleware) {
  return appendTransformation(ast, middleware, toType(ast));
}
function appendTransformation(from, transformation, to) {
  const link = new Link(from, transformation);
  return replaceEncoding(to, to.encoding ? [...to.encoding, link] : [link]);
}
function mapOrSame(as, f) {
  let out;
  for (let i = 0;i < as.length; i++) {
    const a = as[i];
    const fa = f(a);
    if (out) {
      out[i] = fa;
    } else if (fa !== a) {
      out = new Array(as.length);
      for (let j = 0;j < i; j++) {
        out[j] = as[j];
      }
      out[i] = fa;
    }
  }
  return out ?? as;
}
function annotateKey(ast, annotations) {
  const context = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, ast.context.constructorDefault, {
    ...ast.context.annotations,
    ...annotations
  }) : new Context(false, false, undefined, annotations);
  return replaceContext(ast, context);
}
var optionalKey = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const context = ast.context ? ast.context.isOptional === false ? new Context(true, ast.context.isMutable, ast.context.constructorDefault, ast.context.annotations) : ast.context : new Context(true, false);
  return optionalKeyLastLink(replaceContext(ast, context));
});
var optionalKeyLastLink = /* @__PURE__ */ applyToLastLink(optionalKey);
var optional = /* @__PURE__ */ memoize((ast) => optionalKey(new Union([ast, undefined_2])));
var mutableKey = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const context = ast.context ? ast.context.isMutable === false ? new Context(ast.context.isOptional, true, ast.context.constructorDefault, ast.context.annotations) : ast.context : new Context(false, true);
  return mutableKeyLastLink(replaceContext(ast, context));
});
var mutableKeyLastLink = /* @__PURE__ */ applyToLastLink(mutableKey);
function withConstructorDefault(ast, defaultValue) {
  const context = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, defaultValue, ast.context.annotations) : new Context(false, false, defaultValue);
  return replaceContext(ast, context);
}
function decodeTo(from, to, transformation) {
  return appendTransformation(from, transformation, to);
}
function parseParameter(ast) {
  const literals = [];
  const parameters = [];
  function addLiteral(literal) {
    if (!literals.includes(literal)) {
      literals.push(literal);
    }
  }
  function go(ast) {
    switch (ast._tag) {
      case "Literal":
        if (isPropertyKey(ast.literal)) {
          addLiteral(ast.literal);
        }
        return;
      case "UniqueSymbol":
        addLiteral(ast.symbol);
        return;
      case "Enum":
        for (const [, value] of ast.enums) {
          addLiteral(value);
        }
        return;
      case "Never":
        return;
      case "Union":
        for (let i = 0;i < ast.types.length; i++) {
          go(ast.types[i]);
        }
        return;
      default:
        parameters.push(ast);
    }
  }
  go(ast);
  return {
    literals,
    parameters
  };
}
function record2(key, value) {
  const {
    literals,
    parameters: indexSignatures
  } = parseParameter(key);
  return new Objects(literals.map((literal) => new PropertySignature(literal, value)), indexSignatures.map((parameter) => new IndexSignature(parameter, value)));
}
function isOptional(ast) {
  return ast.context?.isOptional ?? false;
}
function isMutable(ast) {
  return ast.context?.isMutable ?? false;
}
function isStructuralCheck(check) {
  return check.annotations?.[STRUCTURAL_ANNOTATION_KEY] === true || check._tag === "FilterGroup" && check.checks.every(isStructuralCheck);
}
function extractStructuralChecks(checks) {
  function extract(check) {
    if (isStructuralCheck(check))
      return [check];
    return check._tag === "FilterGroup" ? check.checks.flatMap(extract) : [];
  }
  const out = checks.flatMap(extract);
  return isArrayNonEmpty2(out) ? out : undefined;
}
function canPreserveEncodingChecks(ast) {
  let preserve = true;
  function visit(child) {
    preserve = preserve && !child.encoding && !isSuspend(child);
    if (preserve && "recur" in child)
      child.recur(visit);
    return child;
  }
  if ("recur" in ast)
    ast.recur(visit);
  return preserve;
}
var toType = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const owner = getContextOwner(ast);
  if (owner !== ast) {
    const type = toType(owner);
    return type === owner && ast.encoding === undefined ? ast : replaceContext(type, ast.context);
  }
  const type = "recur" in ast ? ast.recur(toType) : ast;
  if ("encodingChecks" in type && type.encodingChecks) {
    const checks = canPreserveEncodingChecks(ast) ? type.encodingChecks : isArrays(type) || isObjects(type) || isDeclaration(type) && type.typeParameters.length > 0 ? extractStructuralChecks(type.encodingChecks) : undefined;
    return copy(type, {
      encodingChecks: undefined,
      checks: combineChecks(checks, type.checks)
    });
  }
  return type;
});
var toEncoded = /* @__PURE__ */ memoizeIdempotent((ast) => {
  return toType(flip2(ast));
});
function flipEncoding(ast, encoding) {
  const links = encoding;
  const len = links.length;
  const last = links[len - 1];
  const ls = [new Link(flip2(replaceEncoding(ast, undefined)), links[0].transformation.flip())];
  for (let i = 1;i < len; i++) {
    ls.unshift(new Link(flip2(links[i - 1].to), links[i].transformation.flip()));
  }
  const to = flip2(last.to);
  if (to.encoding) {
    return replaceEncoding(to, [...to.encoding, ...ls]);
  } else {
    return replaceEncoding(to, ls);
  }
}
var flip2 = /* @__PURE__ */ memoize((ast) => {
  if (ast.encoding) {
    return flipEncoding(ast, ast.encoding);
  }
  const owner = getContextOwner(ast);
  if (owner !== ast) {
    const flipped = flip2(owner);
    return flipped === owner ? ast : replaceContext(flipped, ast.context);
  }
  return "flip" in ast ? ast.flip(flip2) : ("recur" in ast) ? ast.recur(flip2) : ast;
});
function fromConst(ast, value) {
  const succeed = value === 0 ? sameExit : succeed6(value);
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (input === value)
      return succeed;
    return fail5(new InvalidType(ast, input, options));
  };
}
function fromRefinement(ast, refinement) {
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (refinement(input))
      return sameExit;
    return fail5(new InvalidType(ast, input, options));
  };
}
var parameterFromPropertyKey = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromPropertyKey);
  }
});
var parameterFromString = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Symbol":
    case "UniqueSymbol":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromString);
  }
});
var STRING_PATTERN = "[\\s\\S]*?";
var isStringFiniteRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${FINITE_PATTERN}$`);
var isStringNumberRegExp = /* @__PURE__ */ new globalThis.RegExp(`^(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)$`);
function isStringFinite(annotations) {
  return isPattern(isStringFiniteRegExp, {
    expected: "a string representing a finite number",
    representation: {
      id: "effect/schema/isStringFinite",
      payload: null
    },
    toJsonSchema: () => ({
      pattern: isStringFiniteRegExp.source
    }),
    ...annotations
  });
}
var finiteString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringFinite()]);
var finiteToString = /* @__PURE__ */ new Link(finiteString, numberFromString);
var numberToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finiteString, nonFiniteLiterals]), numberFromString);
var BIGINT_PATTERN = "-?\\d+";
var isStringBigIntRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${BIGINT_PATTERN}$`);
var REGEXP_PATTERN = "Symbol\\(([\\s\\S]*)\\)";
var isStringSymbolRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${REGEXP_PATTERN}$`);
function collectIssues(checks, value, issues, ast, options) {
  for (let i = 0;i < checks.length; i++) {
    const check = checks[i];
    if (check._tag === "FilterGroup") {
      issues = collectIssues(check.checks, value, issues, ast, options);
      if (issues && (options.errors !== "all" || issues[issues.length - 1].filter.aborted)) {
        return issues;
      }
    } else {
      const issue = check.run(value, ast, options);
      if (issue) {
        const filter = new Filter(check, issue, value, options);
        if (issues)
          issues.push(filter);
        else
          issues = [filter];
        if (options.errors !== "all" || check.aborted) {
          return issues;
        }
      }
    }
  }
  return issues;
}
function getConstructorDescriptor(ast) {
  if (!isDeclaration(ast))
    return;
  const getDescriptor = ast.annotations?.[CONSTRUCTOR_ANNOTATION_KEY];
  return isFunction(getDescriptor) ? getDescriptor(ast.typeParameters) : undefined;
}
function isJsonLeaf(u) {
  return u === null || typeof u === "string" || typeof u === "boolean" || typeof u === "number" && globalThis.Number.isFinite(u);
}
function isStringTreeLeaf(u) {
  return u === undefined || typeof u === "string";
}
function isTree(u, isLeaf) {
  const cache = new WeakMap;
  const stack = [];
  outer:
    while (true) {
      if (typeof u !== "object" || u === null) {
        if (!isLeaf(u)) {
          return false;
        }
      } else {
        const value = u;
        const cached = cache.get(value);
        if (cached === false) {
          return false;
        }
        if (cached === undefined) {
          const isArray = Array.isArray(value);
          if (!isArray) {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== null && prototype !== Object.prototype && Object.getPrototypeOf(prototype) !== null) {
              return false;
            }
          }
          cache.set(value, false);
          stack.push({
            value,
            keys: isArray ? value.length : Object.keys(value),
            index: 0
          });
        }
      }
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const keys = frame.keys;
        if (typeof keys === "number") {
          if (frame.index < keys) {
            u = frame.value[frame.index++];
            continue outer;
          }
        } else if (frame.index < keys.length) {
          u = frame.value[keys[frame.index++]];
          continue outer;
        }
        cache.set(frame.value, true);
        stack.pop();
      }
      return true;
    }
}
function isJson(u) {
  return isTree(u, isJsonLeaf);
}
var Json = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isJson(input) ? sameExit : fail5(new InvalidType(ast, input, options)), {
  representation: {
    id: "effect/schema/Json",
    payload: null
  },
  expected: "JSON value",
  toCodecJson: () => {
    return;
  },
  toCodecStringTree: () => unknownToStringTree
});
var unknownToJson = /* @__PURE__ */ new Link(Json, /* @__PURE__ */ passthrough3());
var objectKeywordToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([/* @__PURE__ */ new Arrays(false, [], [Json]), /* @__PURE__ */ new Objects([], [/* @__PURE__ */ new IndexSignature(string2, Json)])]), /* @__PURE__ */ passthrough3());
function isStringTree(u) {
  return isTree(u, isStringTreeLeaf);
}
var StringTree = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isStringTree(input) ? sameExit : fail5(new InvalidType(ast, input, options)), {
  expected: "StringTree",
  toCodecStringTree: () => {
    return;
  }
});
var unknownToStringTree = /* @__PURE__ */ new Link(StringTree, /* @__PURE__ */ passthrough3());

var flatMapTransformation = (result, current, f) => isSameExit(result) ? f(current) : flatMapEager2(result, f);
function compileTransformation(transformation) {
  const apply = compileTransformationUnsafe(transformation);
  return (result, current, options) => {
    try {
      return apply(result, current, options);
    } catch (error) {
      return die3(error);
    }
  };
}
function compileTransformationUnsafe(transformation) {
  if (transformation._tag === "Middleware") {
    return (result, current, options) => {
      const transformed = isSameExit(result) ? transformation.decode(succeed6(toOption(current)), options) : transformation.decode(mapEager2(result, toOption), options);
      return fromOptionalEffect(transformed);
    };
  }
  const getter = transformation.decode;
  switch (getter._tag) {
    case "Passthrough":
      return (result, current) => isSameExit(result) ? succeed6(current) : result;
    case "Transform": {
      const transform = (value) => value === missing ? missingExit : succeed6(getter.transform(value));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformOptional": {
      const transform = (value) => fromOptionExit(getter.transform(toOption(value)));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => value === missing ? missingExit : getter.transform(value, options));
    case "TransformOptionalEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => fromOptionalEffect(getter.transform(toOption(value), options)));
  }
}
var fromOptionalEffect = (effect) => flatMapEager2(effect, fromOptionExit);
var wrapEncoding = (ast, input, options, effect) => catchCause2(effect, (cause) => failCauseSync2(() => map3(cause, (issue) => new Encoding(ast, issue, input, options))));
function makeConstructorParser(descriptor, compile) {
  const transform = compileTransformation(descriptor.link.transformation);
  let sourceParser;
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (descriptor.isConstructed(input))
      return sameExit;
    const result = (sourceParser ??= compile(descriptor.link.to))(input, options);
    return transform(result, input, options);
  };
}
function withDefault2(ast, parser) {
  const defaultValue = ast.context.constructorDefault;
  return (input, options) => {
    if (input !== missing && input !== undefined)
      return parser(input, options);
    const result = defaultValue;
    if (effectIsExit(result) && result._tag === "Success") {
      const local = parser(result[args], options);
      return isSameExit(local) ? result : local;
    }
    return flatMapEager2(wrapEncoding(ast, input, options, result), (value) => {
      const local = parser(value, options);
      return isSameExit(local) ? succeed6(value) : local;
    });
  };
}
function compileField(ast, compile) {
  const parser = compile(ast);
  return ast.context?.constructorDefault === undefined ? parser : withDefault2(ast, parser);
}
function compile(ast, compile, compileField, base, specialize) {
  if (ast._tag === "Declaration") {
    for (const parameter of ast.typeParameters)
      compile(parameter);
  }
  const descriptor = compileField ? getConstructorDescriptor(ast) : undefined;
  const parser = descriptor ? makeConstructorParser(descriptor, compile) : base ?? ast.getParser(compile, compileField);
  const checks = ast.checks;
  const links = ast.encoding;
  const transformations = links?.map((link) => compileTransformation(link.transformation));
  const encodingChecks = ast.encodingChecks;
  if (!links && !checks && !encodingChecks) {
    return parser;
  }
  let encodingParsers;
  const parseChecks = (input, options) => {
    let result = parser(input, options);
    try {
      if (encodingChecks && !options.disableChecks) {
        if (effectIsExit(result)) {
          if (result._tag === "Success") {
            const output = isSameExit(result) ? input : result[args];
            if (input !== missing && output !== missing) {
              const issues = collectIssues(encodingChecks, input, undefined, ast, options);
              if (issues) {
                result = fail5(new Composite(ast, issues, input, options));
              }
            }
          }
        } else {
          result = flatMap3(result, (value) => {
            if (input !== missing && value !== missing) {
              const issues = collectIssues(encodingChecks, input, undefined, ast, options);
              if (issues) {
                return fail5(new Composite(ast, issues, input, options));
              }
            }
            return succeed5(value);
          });
        }
      }
      if (checks && !options.disableChecks) {
        if (effectIsExit(result)) {
          if (result._tag === "Success") {
            const value = isSameExit(result) ? input : result[args];
            if (value === missing)
              return result;
            const issues = collectIssues(checks, value, undefined, ast, options);
            if (issues) {
              result = fail5(new Composite(ast, issues, value, options));
            }
          }
        } else {
          result = flatMap3(result, (value) => {
            if (value !== missing) {
              const issues = collectIssues(checks, value, undefined, ast, options);
              if (issues) {
                return fail5(new Composite(ast, issues, value, options));
              }
            }
            return succeed5(value);
          });
        }
      }
      return result;
    } catch (error) {
      return die3(error);
    }
  };
  const parseLocal = specialize === undefined ? parseChecks : specialize(parseChecks);
  if (!links) {
    return parseLocal;
  }
  return (input, options) => {
    const parsers = encodingParsers ??= links.map((link) => compile(link.to));
    let current = input;
    let result = parsers[parsers.length - 1](input, options);
    for (let i = links.length - 1;i >= 0; i--) {
      result = transformations[i](result, current, options);
      if (i !== 0) {
        const next = parsers[i - 1];
        if (result._tag === "Success") {
          current = result[args];
          result = next(current, options);
        } else {
          result = flatMapEager2(result, (value) => {
            const nextResult = next(value, options);
            return isSameExit(nextResult) ? succeed6(value) : nextResult;
          });
        }
      }
    }
    if (result._tag === "Success") {
      const value = result[args];
      const local = parseLocal(value, options);
      return isSameExit(local) ? result : local;
    }
    result = wrapEncoding(ast, input, options, result);
    return flatMapEager2(result, (value) => {
      const local = parseLocal(value, options);
      return isSameExit(local) ? succeed6(value) : local;
    });
  };
}

var invalid2 = /* @__PURE__ */ Symbol();
var cache = /* @__PURE__ */ new WeakMap;
var compiler;
var compilerAdaptersEnabled = false;
var decodeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve3, ast, "parser") : resolve3(ast).parser;
var makeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve3, ast, "makeEffect") : resolve3(ast).makeEffect;
var makeField = (ast) => compileField(ast, makeChild);

class InterpretedEntry {
  ast;
  constructor(ast) {
    this.ast = ast;
  }
  get decodeEffect() {
    return this.cachedDecodeEffect ??= compile(this.ast, decodeChild);
  }
  get parser() {
    return this.decodeEffect;
  }
  get makeEffect() {
    return this.cachedMakeEffect ??= compile(this.ast, makeChild, makeField);
  }
}

class CompilerEntry extends InterpretedEntry {
  compiled;
  resolve;
  constructor(ast, compiled, resolve) {
    super(ast);
    this.compiled = compiled;
    this.resolve = resolve;
  }
  save(key, value) {
    Object.defineProperty(this, key, {
      value
    });
    return value;
  }
  operation(key) {
    const compiled = this.compiled;
    return typeof compiled === "function" ? compiled(this.ast, this.resolve, key) : compiled?.[key];
  }
  get is() {
    return this.save("is", this.operation("is"));
  }
  get decode() {
    return this.save("decode", this.operation("decode"));
  }
  get make() {
    return this.save("make", this.operation("make"));
  }
  get compiledMakeEffect() {
    return this.save("compiledMakeEffect", this.operation("makeEffect"));
  }
  get decodeEffect() {
    return this.save("decodeEffect", this.operation("decodeEffect") ?? compile(this.ast, (ast) => lazyParser(this.resolve, ast, "parser")));
  }
  get parser() {
    const decode = this.decode;
    return decode === undefined ? this.decodeEffect : this.save("parser", withDecode(decode, () => this.decodeEffect));
  }
  get makeEffect() {
    const makeEffect = this.compiledMakeEffect;
    if (makeEffect !== undefined)
      return this.save("makeEffect", makeEffect);
    const child = (ast) => lazyParser(this.resolve, ast, "makeEffect");
    return this.save("makeEffect", compile(this.ast, child, (ast) => compileField(ast, child)));
  }
}
function withDecode(fastDecode, decodeEffect) {
  let detailed;
  return (input, options) => {
    if (input !== missing) {
      try {
        const value = fastDecode(input, options);
        if (value !== invalid2)
          return value === input ? sameExit : succeed6(value);
      } catch (error) {
        return die3(error);
      }
    }
    return (detailed ??= decodeEffect())(input, options);
  };
}
function lazyParser(resolve, ast, operation) {
  const entry = resolve(ast);
  if (entry.compiled === undefined || Object.hasOwn(entry, operation)) {
    return entry[operation];
  }
  let parser;
  return (input, options) => (parser ??= entry[operation])(input, options);
}
function resolve3(ast) {
  const cached = cache.get(ast);
  if (cached !== undefined)
    return cached;
  const entry = compiler === undefined ? new InterpretedEntry(ast) : new CompilerEntry(ast, compiler(ast, resolve3), resolve3);
  cache.set(ast, entry);
  return entry;
}

function makeEffect(schema) {
  const ast = schema.ast;
  let parser;
  return (input, options) => {
    return (parser ??= runWithCompiler(constructorCompiler, toType(ast)))(input, options?.disableChecks ? options?.parseOptions ? {
      ...options.parseOptions,
      disableChecks: true
    } : {
      disableChecks: true
    } : options?.parseOptions);
  };
}
function makeOption(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit = runSyncExit2(parser(input, options));
    if (isSuccess3(exit)) {
      return some2(exit.value);
    }
    getSchemaIssueOrThrow(exit.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function make4(schema) {
  return makeConstructorSync(toType(schema.ast));
}
function is(schema) {
  return _is(schema.ast);
}
function makeIs(ast) {
  if (!compilerAdaptersEnabled) {
    const parser = asExit(run(ast));
    return (input) => {
      const exit = parser(input, defaultParseOptions);
      if (isSuccess3(exit))
        return true;
      getSchemaIssueOrThrow(exit.cause, "Type guard adapter can only return false for schema issues");
      return false;
    };
  }
  const entry = resolve3(ast);
  const guard = entry.is;
  if (guard !== undefined) {
    return (input) => {
      try {
        return guard(input, defaultParseOptions);
      } catch (error) {
        getSchemaIssueOrThrow(die2(error), "Type guard adapter can only return false for schema issues");
        return false;
      }
    };
  }
  const parser = entry.parser;
  return (input) => {
    const exit = runSyncExit2(parserResult(parser(input, defaultParseOptions), input));
    if (isSuccess3(exit))
      return true;
    getSchemaIssueOrThrow(exit.cause, "Type guard adapter can only return false for schema issues");
    return false;
  };
}
function _is(ast) {
  const typeAST = toType(ast);
  let guard = (input) => {
    guard = makeIs(typeAST);
    return guard(input);
  };
  return (input) => {
    return guard(input);
  };
}
function decodeUnknownEffect(schema, options) {
  const parser = run(schema.ast);
  return options === undefined ? parser : (input, overrideOptions) => parser(input, mergeParseOptions(options, overrideOptions));
}
function decodeUnknownResult(schema, options) {
  return asResult(decodeUnknownEffect(schema, options));
}
var mergeParseOptions = (options, overrideOptions) => overrideOptions ? {
  ...options,
  ...overrideOptions
} : options;
var getValue = (value) => {
  if (value === missing) {
    return fail5(new InvalidValue);
  }
  return succeed5(value);
};
function run(ast) {
  return runWithCompiler(normalCompiler, ast);
}
function parserResult(result, input) {
  if (isSameExit(result)) {
    return succeed5(input);
  }
  if (!effectIsExit(result)) {
    return flatMapEager2(result, getValue);
  }
  return result[args] === missing ? getValue(missing) : result;
}
function runWithCompiler(compiler, ast) {
  let parser;
  return (input, options) => {
    const result = (parser ??= compiler(ast))(input, options ?? defaultParseOptions);
    if (isSameExit(result)) {
      return succeed5(input);
    }
    if (!effectIsExit(result)) {
      return flatMapEager2(result, getValue);
    }
    return result[args] === missing ? getValue(missing) : result;
  };
}
function asExit(parser) {
  return (input, options) => runSyncExit2(parser(input, options));
}
function asResult(parser) {
  const parserExit = asExit(parser);
  return (input, options) => {
    const exit = parserExit(input, options);
    if (isSuccess3(exit)) {
      return succeed2(exit.value);
    }
    return fail2(getSchemaIssueOrThrow(exit.cause, "Result adapter can only return schema issues"));
  };
}
function runSync2(effect, message) {
  const exit = runSyncExit2(effect);
  if (isSuccess3(exit)) {
    return exit.value;
  }
  const issue = getSchemaIssueOrThrow(exit.cause, message);
  throw new Error("Schema validation failed", {
    cause: issue
  });
}
var constructorDefectMessage = "Constructor adapter can only throw schema issues";
function throwConstructorDefect(error) {
  throw new Error(constructorDefectMessage, {
    cause: die2(error)
  });
}
function makeConstructorSync(ast) {
  let entry;
  return (input, options) => constructSync(entry ??= resolve3(ast), input, options);
}
function constructSync(entry, input, options) {
  const parseOptions = options?.disableChecks ? options.parseOptions ? {
    ...options.parseOptions,
    disableChecks: true
  } : {
    disableChecks: true
  } : options?.parseOptions ?? defaultParseOptions;
  const make = entry.make;
  if (make !== undefined && input !== missing) {
    let output;
    try {
      output = make(input, parseOptions);
    } catch (error) {
      throwConstructorDefect(error);
    }
    if (output !== invalid2 && output !== missing)
      return output;
  }
  return runSync2(parserResult(entry.makeEffect(input, parseOptions), input), constructorDefectMessage);
}
var normalCompiler = (ast) => resolve3(ast).parser;
var constructorCompiler = (ast) => resolve3(ast).makeEffect;

var TypeId9 = "~effect/Schema/Schema";
var RebuildOptions = /* @__PURE__ */ Symbol();
var SchemaProto = {
  [TypeId9]: TypeId9,
  get make() {
    const value = make4(this);
    Object.defineProperty(this, "make", {
      value,
      enumerable: true
    });
    return value;
  },
  get makeEffect() {
    const value = makeEffect(this);
    Object.defineProperty(this, "makeEffect", {
      value,
      enumerable: true
    });
    return value;
  },
  get makeOption() {
    const value = makeOption(this);
    Object.defineProperty(this, "makeOption", {
      value,
      enumerable: true
    });
    return value;
  },
  pipe() {
    return pipeArguments(this, arguments);
  },
  annotate(annotations) {
    return this.rebuild(annotate(this.ast, annotations));
  },
  annotateKey(annotations) {
    return this.rebuild(annotateKey(this.ast, annotations));
  },
  check(...checks) {
    return this.rebuild(appendChecks(this.ast, checks));
  },
  rebuild(ast) {
    return make5(ast, this[RebuildOptions]);
  }
};
function make5(ast, options) {
  function Schema() {}
  const self = Object.setPrototypeOf(Schema, SchemaProto);
  if (options && (Object.hasOwn(options, "name") || Object.hasOwn(options, "length") || Object.hasOwn(options, "__proto__"))) {
    Object.defineProperties(self, Object.getOwnPropertyDescriptors({
      ...options
    }));
  } else {
    Object.assign(self, options);
  }
  self[RebuildOptions] = options;
  self.ast = ast;
  return self;
}

function getSubschemaKind(keyword) {
  switch (keyword) {
    case "$defs":
    case "properties":
    case "patternProperties":
    case "dependentSchemas":
      return "map";
    case "allOf":
    case "anyOf":
    case "oneOf":
    case "prefixItems":
      return "array";
    case "not":
    case "additionalProperties":
    case "propertyNames":
    case "unevaluatedProperties":
    case "items":
    case "contains":
    case "unevaluatedItems":
    case "if":
    case "then":
    case "else":
    case "contentSchema":
      return "schema";
  }
}

function escapeToken(token) {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
function unescapeToken(token) {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}
function formatUriFragmentToken(token) {
  return encodeURI(escapeToken(token)).replace(/#/g, "%23");
}
function decodeUriFragment(fragment) {
  if (fragment.length === 0 || fragment === "#")
    return "";
  if (!fragment.startsWith("#"))
    return;
  const encoded = fragment.slice(1);
  try {
    if (encodeURI(encoded).replace(/%25/g, "%").replace(/#/g, "%23") !== encoded)
      return;
    const pointer = decodeURIComponent(encoded);
    return pointer.startsWith("/") && !/~(?:[^01]|$)/.test(pointer) ? pointer : undefined;
  } catch {
    return;
  }
}

function transformSchema(node, transform) {
  return walk(node, false, true);
  function walk(node, inheritedResource, isRoot = false) {
    if (!isObject(node))
      return node;
    const inEmbeddedResource = inheritedResource || !isRoot && createsResource(node.$id);
    const out = {};
    for (const key of Object.keys(node)) {
      const value = node[key];
      let transformed = value;
      switch (getSubschemaKind(key)) {
        case "map":
          transformed = mapObject(value, (value) => walk(value, inEmbeddedResource)) ?? value;
          break;
        case "array":
          transformed = Array.isArray(value) ? value.map((value) => walk(value, inEmbeddedResource)) : value;
          break;
        case "schema":
          transformed = walk(value, inEmbeddedResource);
      }
      assignProperty(out, key, transformed);
    }
    transform(out, inEmbeddedResource);
    return out;
  }
}
function rewriteRefs(schema, rewrite) {
  return transformSchema(schema, (schema) => {
    rewriteSchemaRef(schema, rewrite);
  });
}
function rewriteSchemaRef(schema, rewrite) {
  if (typeof schema.$ref === "string") {
    assignProperty(schema, "$ref", rewrite(schema.$ref, "$ref"));
  }
  if (typeof schema.$dynamicRef === "string") {
    assignProperty(schema, "$dynamicRef", rewrite(schema.$dynamicRef, "$dynamicRef"));
  }
}
function mapObject(value, f) {
  if (!isObject(value))
    return;
  const out = {};
  for (const key of Object.keys(value)) {
    assignProperty(out, key, f(value[key], key));
  }
  return out;
}
function createsResource(id) {
  return typeof id === "string" && id.length > 0 && id[0] !== "#";
}
var PRE_2020_TO_2020_COLLISIONS = ["$anchor", "$defs", "$dynamicAnchor", "$dynamicRef", "$vocabulary", "contentSchema", "dependentRequired", "dependentSchemas", "maxContains", "minContains", "prefixItems", "unevaluatedItems", "unevaluatedProperties"];
var DRAFT_07_TO_2020_COLLISIONS = [...PRE_2020_TO_2020_COLLISIONS, "deprecated"];
var OPEN_API_30_TO_2020_COLLISIONS = [...PRE_2020_TO_2020_COLLISIONS, "$comment", "$id", "$schema", "const", "contains", "contentEncoding", "contentMediaType", "else", "examples", "if", "patternProperties", "propertyNames", "then"];

var toCodecJsonAST = /* @__PURE__ */ makeCodecDerivation(toCodecJsonASTStep);
function makeCodecDerivation(step, options) {
  const deriveBody = memoize((owner) => {
    const body = replaceContext(owner, undefined);
    const out = step(body, recur);
    return out === body ? null : out;
  });
  const recur = applyToSelfOrLastLinkEncodingIdempotent((ast) => {
    const derived = deriveBody(getContextOwner(ast));
    if (derived === null)
      return ast;
    const out = replaceContext(derived, ast.context);
    return ast.context === undefined ? out : replaceContextLastLink(out, withoutConstructorDefault(ast.context));
  }, options);
  return recur;
}
function withoutConstructorDefault(context) {
  return context.constructorDefault === undefined ? context : new Context(context.isOptional, context.isMutable, undefined, context.annotations);
}
function validateCanonicalObjectPropertyNames(ast) {
  if (ast.propertySignatures.some((ps) => typeof ps.name !== "string")) {
    throw new globalThis.Error("Objects property names must be strings", {
      cause: ast
    });
  }
}
function makeReorder(getPriority) {
  return (types) => {
    const sortedTypes = [...types].sort((a, b) => getPriority(toEncoded(a)) - getPriority(toEncoded(b)));
    const orderChanged = sortedTypes.some((ast, index) => ast !== types[index]);
    if (!orderChanged)
      return types;
    return sortedTypes;
  };
}
var toCodecJsonReorder = /* @__PURE__ */ makeReorder((ast) => {
  switch (ast._tag) {
    case "BigInt":
    case "Symbol":
    case "UniqueSymbol":
      return 0;
    default:
      return 1;
  }
});
function toCodecJsonASTStep(ast, recur) {
  switch (ast._tag) {
    case "Declaration": {
      const getLink = ast.annotations?.toCodecJson ?? ast.annotations?.toCodec;
      if (!isFunction(getLink)) {
        return replaceEncoding(ast, [unknownToJson]);
      }
      const typeParameters = ast.typeParameters.map((tp) => make5(toEncoded(tp)));
      const link = getLink(typeParameters);
      return link === undefined ? ast : replaceEncoding(ast, [mapLink(link, recur)]);
    }
    case "Unknown":
      return replaceEncoding(ast, [unknownToJson]);
    case "ObjectKeyword":
      return replaceEncoding(ast, [objectKeywordToJson]);
    case "Undefined":
    case "Void":
    case "Literal":
    case "Number":
      return ast.toCodecJson();
    case "UniqueSymbol":
    case "Symbol":
    case "BigInt":
      return ast.toCodecStringTree();
    case "Objects": {
      validateCanonicalObjectPropertyNames(ast);
      return ast.recur(recur, parameterFromString);
    }
    case "Union": {
      const sortedTypes = toCodecJsonReorder(ast.types);
      if (sortedTypes !== ast.types) {
        return new Union(sortedTypes, ast.options, ast.annotations, ast.checks, ast.encoding, ast.context, ast.encodingChecks).recur(recur);
      }
      return ast.recur(recur);
    }
    case "Arrays":
    case "Suspend":
      return ast.recur(recur);
  }
  return ast;
}

var RegExp2 = globalThis.RegExp;
var escape = (string) => string.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

function errorWithPath(message, path) {
  if (path.length > 0) {
    message += `
  at ${formatPath(path)}`;
  }
  return new Error(message);
}

function formatDefinitionReference(key) {
  return `#/$defs/${formatUriFragmentToken(key)}`;
}
var jsonSchemaAnnotationExcludedKeys = /* @__PURE__ */ new Set([...annotationExcludedKeys, IDENTIFIER_FALLBACK_KEY, ...jsonSchemaAnnotationKeys]);
function collectJsonSchemaAnnotations(annotations, options) {
  if (annotations === undefined)
    return;
  const out = {};
  for (const key of ["title", "description", "format", "contentEncoding", "contentMediaType"]) {
    const value = annotations[key];
    if (typeof value === "string")
      out[key] = value;
  }
  for (const key of ["readOnly", "writeOnly"]) {
    const value = annotations[key];
    if (typeof value === "boolean")
      out[key] = value;
  }
  const expected = annotations.expected;
  if (out.description === undefined && options?.generateDescriptions === true && typeof expected === "string") {
    out.description = expected;
  }
  const defaultValue = annotations.default;
  if (isJson(defaultValue))
    out.default = defaultValue;
  const examples = annotations.examples;
  if (Array.isArray(examples) && isJson(examples))
    out.examples = examples;
  const contentSchema = annotations.contentSchema;
  if (isJson(contentSchema))
    out.contentSchema = contentSchema;
  if (options?.includeAnnotationKey !== undefined) {
    for (const [key, value] of Object.entries(annotations)) {
      if (jsonSchemaAnnotationExcludedKeys.has(key) || !options.includeAnnotationKey(key)) {
        continue;
      }
      if (isJson(value))
        assignProperty(out, key, value);
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
function extractJsonSchemaNumberType(schema) {
  let type = schema.type === "number" || schema.type === "integer" ? schema.type : undefined;
  let out = schema;
  if (type !== undefined) {
    out = {
      ...schema
    };
    delete out.type;
  }
  if (Array.isArray(out.allOf)) {
    const members = [];
    let changed = false;
    for (const member of out.allOf) {
      const extracted = extractJsonSchemaNumberType(member);
      if (extracted.type !== undefined) {
        changed = true;
        if (type === undefined || extracted.type === "integer")
          type = extracted.type;
      }
      if (Object.keys(extracted.schema).length > 0)
        members.push(extracted.schema);
    }
    if (changed) {
      const {
        allOf: _,
        ...rest
      } = out;
      out = members.length === 0 ? rest : {
        ...rest,
        allOf: members
      };
    }
  }
  return {
    type,
    schema: out
  };
}
function isJsonSchemaNumberEncoding(schema) {
  if (!Array.isArray(schema.anyOf) || schema.anyOf.length !== 2 || schema.anyOf[0]?.type !== "number")
    return false;
  const special = schema.anyOf[1];
  return special?.type === "string" && Array.isArray(special.enum) && special.enum.length === 3 && special.enum.includes("NaN") && special.enum.includes("Infinity") && special.enum.includes("-Infinity");
}
var inlineableCheckKeywords = "|type|format|pattern|multipleOf|minimum|maximum|exclusiveMinimum|exclusiveMaximum|minLength|maxLength|minItems|maxItems|uniqueItems|minProperties|maxProperties|propertyNames|";
function hasOnlyKeywords(schema, allowed) {
  return Object.keys(schema).every((key) => allowed.includes(`|${key}|`));
}
function hasNoCollisions(left, rightKeys) {
  return typeof left.$ref !== "string" && rightKeys.every((key) => !Object.hasOwn(left, key));
}
var lowerBoundKeywords = "|minimum|exclusiveMinimum|minLength|minItems|minProperties|";
var upperBoundKeywords = "|maximum|exclusiveMaximum|maxLength|maxItems|maxProperties|";
function mergeInlineCheck(left, right, rightKeys) {
  if (typeof left.$ref === "string")
    return;
  const out = {
    ...left,
    ...right
  };
  for (const key of rightKeys) {
    if (!Object.hasOwn(left, key))
      continue;
    const a = left[key];
    const b = right[key];
    if (typeof a !== "number" || typeof b !== "number")
      return;
    if (lowerBoundKeywords.includes(`|${key}|`))
      out[key] = Math.max(a, b);
    else if (upperBoundKeywords.includes(`|${key}|`))
      out[key] = Math.min(a, b);
    else
      return;
  }
  if (typeof out.minimum === "number" && typeof out.exclusiveMinimum === "number") {
    delete out[out.exclusiveMinimum >= out.minimum ? "minimum" : "exclusiveMinimum"];
  }
  if (typeof out.maximum === "number" && typeof out.exclusiveMaximum === "number") {
    delete out[out.exclusiveMaximum <= out.maximum ? "maximum" : "exclusiveMaximum"];
  }
  return out;
}
var promotableAnnotationKeywords = "|title|description|default|examples|readOnly|writeOnly|";
var inlineableAnnotatedCheckKeywords = inlineableCheckKeywords + promotableAnnotationKeywords;
function appendJsonSchema(left, right, inlineCheck) {
  if (Object.keys(left).length === 0)
    return right;
  const rightKeys = Object.keys(right);
  if (rightKeys.length === 0)
    return left;
  const leftType = left.type === "number" || left.type === "integer" ? left.type : undefined;
  const isNumberEncoding = isJsonSchemaNumberEncoding(left);
  if (leftType !== undefined || isNumberEncoding) {
    const extracted = extractJsonSchemaNumberType(right);
    if (extracted.type !== undefined) {
      const type = leftType === "integer" || extracted.type === "integer" ? "integer" : "number";
      const base = {
        ...left,
        type
      };
      if (isNumberEncoding)
        delete base.anyOf;
      const extractedKeys = Object.keys(extracted.schema);
      if (extractedKeys.length === 0)
        return base;
      return hasOnlyKeywords(extracted.schema, promotableAnnotationKeywords) && hasNoCollisions(base, extractedKeys) ? {
        ...base,
        ...extracted.schema
      } : appendJsonSchema(base, extracted.schema, inlineCheck);
    }
  }
  if (inlineCheck) {
    const merged = mergeInlineCheck(left, right, rightKeys);
    if (merged !== undefined)
      return merged;
  }
  const members = Array.isArray(right.allOf) && rightKeys.length === 1 ? right.allOf : [right];
  if (Array.isArray(left.allOf)) {
    return {
      ...left,
      allOf: [...left.allOf, ...members]
    };
  }
  if (typeof left.$ref === "string") {
    return {
      allOf: [left, ...members]
    };
  }
  return {
    ...left,
    allOf: members
  };
}
function isExact(exactness, seen = new Set) {
  if (typeof exactness === "boolean")
    return exactness;
  if (seen.has(exactness))
    return true;
  seen.add(exactness);
  return exactness.every((dependency) => isExact(dependency, seen));
}
function isApproximateCheckOutput(output) {
  return Array.isArray(output);
}
function compileJsonSchema(representations, rootPaths, references, options) {
  const numberKeyPattern = `^(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)$`;
  const compiledDefinitions = new Map;
  const definitionAliases = new Map;
  const compiledRepresentations = new WeakMap;
  const pendingOneOf = new Map;
  const fallbackDefinitions = new Map;
  const referenceKeys = Object.keys(references);
  for (const key of referenceKeys) {
    compileDefinition(key, ["references", key]);
  }
  const compiledSchemas = map(representations, (representation, index) => recur(representation, rootPaths[index], []));
  for (const {
    branches,
    schemas
  } of pendingOneOf.values()) {
    if (!isExact(branches)) {
      for (const schema of schemas) {
        if (Array.isArray(schema.oneOf)) {
          schema.anyOf = schema.oneOf;
          delete schema.oneOf;
        }
      }
    }
  }
  for (const key of referenceKeys) {
    const representation = references[key];
    const fallback = getIdentifierFallback(representation);
    if (fallback === undefined)
      continue;
    const schema = compiledDefinitions.get(key).schema;
    const candidates = fallbackDefinitions.get(fallback);
    const match = candidates?.find((candidate) => equals(compiledDefinitions.get(candidate).schema, schema));
    if (match === undefined) {
      if (candidates === undefined)
        fallbackDefinitions.set(fallback, [key]);
      else
        candidates.push(key);
    } else {
      definitionAliases.set(key, match);
    }
  }
  const schemas = map(compiledSchemas, finalizeJsonSchema);
  const definitions = {};
  for (const key of referenceKeys) {
    if (!definitionAliases.has(key)) {
      assignProperty(definitions, key, finalizeJsonSchema(compiledDefinitions.get(key).schema));
    }
  }
  return {
    dialect: "draft-2020-12",
    schemas,
    definitions
  };
  function registerPendingOneOf(schema) {
    if (Array.isArray(schema.oneOf))
      pendingOneOf.get(schema.oneOf)?.schemas.push(schema);
    return schema;
  }
  function compileAnnotatedMember(member, path, dependencies) {
    const schema = recur(member.type, [...path, "type"], dependencies);
    const annotations = collectJsonSchemaAnnotations(member.annotations, options);
    return annotations === undefined ? schema : registerPendingOneOf(appendJsonSchema(schema, annotations));
  }
  function compileDefinition(key, path) {
    if (!Object.hasOwn(references, key)) {
      throw errorWithPath(`Invalid reference ${key}`, [...path, "$ref"]);
    }
    const cached = compiledDefinitions.get(key);
    if (cached !== undefined)
      return cached;
    const result = {
      schema: {},
      dependencies: []
    };
    compiledDefinitions.set(key, result);
    result.schema = recur(references[key], ["references", key], result.dependencies);
    return result;
  }
  function finalizeJsonSchema(schema) {
    return rewriteRefs(schema, ($ref) => {
      const pointer = decodeUriFragment($ref);
      if (pointer === undefined) {
        if (/^#(?:\/|%2f)/i.test($ref)) {
          throw new Error(`Invalid JSON Pointer URI fragment ${JSON.stringify($ref)}`);
        }
        return $ref;
      }
      if (!pointer.startsWith("/$defs/"))
        return $ref;
      const separator = pointer.indexOf("/", 7);
      const canonical = definitionAliases.get(unescapeToken(pointer.slice(7, separator < 0 ? undefined : separator)));
      if (canonical === undefined)
        return $ref;
      return $ref.replace(/^#(?:\/|%2f).*?(?:\/|%2f).*?(?=\/|%2f|$)/i, formatDefinitionReference(canonical));
    });
  }
  function getIdentifierFallback(representation) {
    if (representation._tag === "Reference")
      return;
    const annotations = representation.checks.length === 0 ? representation.annotations : representation.checks[representation.checks.length - 1].annotations;
    return typeof annotations?.identifier !== "string" && typeof annotations?.[IDENTIFIER_FALLBACK_KEY] === "string" ? annotations[IDENTIFIER_FALLBACK_KEY] : undefined;
  }
  function compileCheck(check, type, path, dependencies) {
    const annotations = check.annotations;
    const callback = annotations?.toJsonSchema;
    if (callback !== undefined) {
      const schemas = check.representation?.schemas?.map((schema, index) => recur(schema, [...path, "representation", "schemas", index], dependencies)) ?? [];
      const result = callback({
        type,
        schemas
      });
      const approximate = isApproximateCheckOutput(result);
      if (approximate) {
        dependencies.push(false);
      }
      const fragment = approximate ? result[0] : result;
      const ordinary = collectJsonSchemaAnnotations(annotations, options);
      const schema = ordinary === undefined ? fragment : {
        ...fragment,
        ...ordinary
      };
      const allowed = ordinary === undefined ? inlineableCheckKeywords : inlineableAnnotatedCheckKeywords;
      return [schema, check._tag === "Filter" && hasOnlyKeywords(schema, allowed) && (ordinary === undefined || hasOnlyKeywords(ordinary, promotableAnnotationKeywords)) ? true : undefined];
    }
    if (check._tag === "Filter") {
      dependencies.push(false);
      return;
    }
    const schemas = check.checks.flatMap((child, index) => {
      const result = compileCheck(child, type, [...path, "checks", index], dependencies);
      return result === undefined ? [] : [result[0]];
    });
    if (schemas.length === 0)
      return;
    const ordinary = collectJsonSchemaAnnotations(annotations, options);
    const schema = {
      allOf: schemas
    };
    return [ordinary === undefined ? schema : {
      ...schema,
      ...ordinary
    }];
  }
  function recur(representation, path, dependencies) {
    if (representation._tag === "Reference") {
      dependencies.push(compileDefinition(representation.$ref, path).dependencies);
      return {
        $ref: formatDefinitionReference(representation.$ref)
      };
    }
    const cached = compiledRepresentations.get(representation);
    if (cached !== undefined) {
      dependencies.push(cached.dependencies);
      return cached.schema;
    }
    const local = [];
    dependencies.push(local);
    let output = {
      ...on(representation, path, local),
      ...collectJsonSchemaAnnotations(representation.annotations, options)
    };
    if (representation._tag === "String" && representation.content !== undefined) {
      const content = representation.content;
      output.contentMediaType = content.mediaType;
      delete output.contentSchema;
      if (content.schema !== undefined) {
        output.contentSchema = recur(content.schema, [...path, "content", "schema"], []);
      }
    }
    for (let index = 0;index < representation.checks.length; index++) {
      const type = typeof output.type === "string" && isJsonSchemaType(output.type) ? output.type : undefined;
      const check = compileCheck(representation.checks[index], type, [...path, "checks", index], local);
      if (check !== undefined)
        output = appendJsonSchema(output, ...check);
    }
    compiledRepresentations.set(representation, {
      schema: output,
      dependencies: local
    });
    return registerPendingOneOf(output);
  }
  function on(representation, path, dependencies) {
    switch (representation._tag) {
      case "Any":
      case "Unknown":
        return {};
      case "ObjectKeyword":
        return {
          anyOf: [{
            type: "object"
          }, {
            type: "array"
          }]
        };
      case "Void":
      case "Undefined":
      case "Null":
        return {
          type: "null"
        };
      case "BigInt":
        return {
          type: "string",
          allOf: [{
            pattern: "^-?\\d+$"
          }]
        };
      case "Symbol":
        return {
          type: "string",
          allOf: [{
            pattern: "^Symbol\\(([\\s\\S]*)\\)$"
          }]
        };
      case "UniqueSymbol":
        return globalThis.Symbol.keyFor(representation.symbol) === undefined ? {
          not: {}
        } : {
          type: "string",
          enum: [globalThis.String(representation.symbol)]
        };
      case "Declaration":
        dependencies.push(false);
        return {};
      case "Suspend":
        return recur(representation.thunk, [...path, "thunk"], dependencies);
      case "Never":
        return {
          not: {}
        };
      case "String":
        return {
          type: "string"
        };
      case "Number":
        return {
          anyOf: [{
            type: "number"
          }, {
            type: "string",
            enum: ["NaN", "Infinity", "-Infinity"]
          }]
        };
      case "Boolean":
        return {
          type: "boolean"
        };
      case "Literal": {
        const literal = representation.literal;
        return typeof literal === "bigint" ? {
          type: "string",
          enum: [globalThis.String(literal)]
        } : {
          type: typeof literal,
          enum: [literal]
        };
      }
      case "Enum": {
        const types = representation.enums.map(([title, literal]) => ({
          type: typeof literal,
          enum: [literal],
          title
        }));
        return types.length === 0 ? {
          not: {}
        } : {
          anyOf: types
        };
      }
      case "TemplateLiteral": {
        const {
          exact,
          pattern
        } = getTemplateLiteralPattern(representation.parts);
        if (!exact)
          dependencies.push(false);
        return {
          type: "string",
          pattern
        };
      }
      case "Arrays": {
        const out = {
          type: "array"
        };
        let minItems = representation.elements.length;
        const prefixItems = representation.elements.map((element, index) => {
          if (element.isOptional)
            minItems--;
          return compileAnnotatedMember(element, [...path, "elements", index], dependencies);
        });
        if (prefixItems.length > 0) {
          out.prefixItems = prefixItems;
          out.maxItems = representation.elements.length;
          if (minItems > 0)
            out.minItems = minItems;
        } else {
          out.items = false;
        }
        if (representation.rest.length === 1) {
          delete out.maxItems;
          const rest = recur(representation.rest[0], [...path, "rest", 0], dependencies);
          if (Object.keys(rest).length > 0)
            out.items = rest;
          else
            delete out.items;
        } else if (representation.rest.length > 1) {
          delete out.maxItems;
          delete out.items;
          out.minItems = minItems + representation.rest.length - 1;
          dependencies.push(false);
        }
        return out;
      }
      case "Objects":
        return compileObjects(representation, path, dependencies);
      case "Union": {
        const branches = [];
        const types = representation.types.map((type, index) => recur(type, [...path, "types", index], branches));
        dependencies.push(branches);
        if (types.length === 0)
          return {
            not: {}
          };
        if (representation.options?.mode === "oneOf") {
          pendingOneOf.set(types, {
            branches,
            schemas: []
          });
          return {
            oneOf: types
          };
        }
        if (types.length > 1) {
          const compacted = compactEnums(types);
          if (compacted !== undefined)
            return compacted;
        }
        return {
          anyOf: types.flatMap((type) => Array.isArray(type.anyOf) && Object.keys(type).length === 1 ? type.anyOf : [type])
        };
      }
    }
  }
  function compileObjects(representation, path, dependencies) {
    const {
      indexSignatures,
      propertySignatures
    } = representation;
    if (propertySignatures.length === 0 && indexSignatures.length === 0)
      return {
        not: {
          type: "null"
        }
      };
    const out = {
      type: "object"
    };
    const properties = {};
    const required = [];
    for (const [index, property] of propertySignatures.entries()) {
      const propertyPath = [...path, "propertySignatures", index];
      if (typeof property.name !== "string") {
        throw errorWithPath("Objects property names must be strings", [...propertyPath, "name"]);
      }
      assignProperty(properties, property.name, compileAnnotatedMember(property, propertyPath, dependencies));
      if (!property.isOptional)
        required.push(property.name);
    }
    if (propertySignatures.length > 0)
      out.properties = properties;
    if (required.length > 0)
      out.required = required;
    const indexes = indexSignatures.map((signature, index) => {
      const indexPath = [...path, "indexSignatures", index];
      const schema = recur(signature.type, [...indexPath, "type"], dependencies);
      const type = equals(schema, {
        not: {}
      }) ? false : schema;
      const patterns = getParameterPatterns(signature.parameter, [...indexPath, "parameter"], new Set);
      if (patterns === undefined)
        dependencies.push(false);
      return {
        type,
        patterns
      };
    });
    const patternProperties = {};
    for (const {
      patterns,
      type
    } of indexes) {
      for (const pattern of patterns ?? []) {
        const previous = patternProperties[pattern];
        assignProperty(patternProperties, pattern, previous === undefined ? type : previous === false || type === false ? false : registerPendingOneOf(appendJsonSchema(previous, type)));
      }
    }
    const hasPatternProperties = Object.keys(patternProperties).length > 0;
    if (hasPatternProperties)
      out.patternProperties = patternProperties;
    const additionalPropertySchemas = indexes.filter(({
      patterns
    }) => patterns?.length === 0).map(({
      type
    }) => type);
    const hasUnrepresentableIndexPattern = indexes.some(({
      patterns
    }) => patterns === undefined);
    if (hasUnrepresentableIndexPattern && options?.onExcessProperty === "error") {
      const propertyNames = [];
      if (propertySignatures.length > 0)
        propertyNames.push({
          enum: Object.keys(properties)
        });
      for (const [index, signature] of indexSignatures.entries()) {
        propertyNames.push(getPropertyNameSchema(signature.parameter, [...path, "indexSignatures", index, "parameter"], dependencies, new Set));
      }
      out.propertyNames = propertyNames.length === 1 ? propertyNames[0] : {
        anyOf: propertyNames
      };
      const values = indexes.map(({
        type
      }) => type);
      out.additionalProperties = values.length === 1 ? values[0] : {
        anyOf: values
      };
      if (additionalPropertySchemas.length > 0) {
        out.allOf = additionalPropertySchemas.map((type) => ({
          type: "object",
          additionalProperties: type
        }));
      }
    } else if (additionalPropertySchemas.length === 0) {
      out.additionalProperties = hasUnrepresentableIndexPattern || options?.onExcessProperty !== "error";
    } else if (additionalPropertySchemas.length === 1 && propertySignatures.length === 0 && !hasPatternProperties) {
      out.additionalProperties = additionalPropertySchemas[0];
    } else {
      out.allOf = additionalPropertySchemas.map((type) => ({
        type: "object",
        additionalProperties: type
      }));
    }
    if (typeof out.additionalProperties === "object" && out.additionalProperties !== null && Object.keys(out.additionalProperties).length === 0) {
      delete out.additionalProperties;
    }
    return out;
  }
  function getPropertyNameSchema(parameter, path, dependencies, seenReferences) {
    switch (parameter._tag) {
      case "Number":
        return {
          type: "string",
          pattern: numberKeyPattern
        };
      case "Reference": {
        if (seenReferences.has(parameter.$ref))
          return {
            type: "string"
          };
        return getPropertyNameSchema(references[parameter.$ref], ["references", parameter.$ref], dependencies, new Set(seenReferences).add(parameter.$ref));
      }
      case "Union":
        return {
          anyOf: parameter.types.map((type) => getPropertyNameSchema(type, path, dependencies, seenReferences))
        };
      default:
        return recur(parameter, path, dependencies);
    }
  }
  function getParameterPatterns(parameter, path, seenReferences) {
    switch (parameter._tag) {
      case "Reference": {
        compileDefinition(parameter.$ref, path);
        if (seenReferences.has(parameter.$ref))
          return;
        const next = new Set(seenReferences).add(parameter.$ref);
        return getParameterPatterns(references[parameter.$ref], ["references", parameter.$ref], next);
      }
      case "String": {
        if (parameter.checks.length === 0)
          return [];
        if (parameter.checks.length !== 1 || parameter.checks[0]._tag !== "Filter" || parameter.checks[0].annotations?.toJsonSchema === undefined) {
          return;
        }
        const dependencies = [];
        const schema = recur(parameter, path, dependencies);
        if (!isExact(dependencies))
          return;
        return schema.type === "string" && typeof schema.pattern === "string" && hasOnlyKeywords(schema, "|type|pattern|title|description|default|examples|readOnly|writeOnly|") ? [schema.pattern] : undefined;
      }
      case "TemplateLiteral": {
        if (parameter.checks.length > 0)
          return;
        const {
          exact,
          pattern
        } = getTemplateLiteralPattern(parameter.parts);
        return exact ? [pattern] : undefined;
      }
      case "Union": {
        if (parameter.types.length === 0 || parameter.checks.length > 0 || parameter.options?.mode === "oneOf") {
          return;
        }
        const patterns = [];
        for (let index = 0;index < parameter.types.length; index++) {
          const memberPatterns = getParameterPatterns(parameter.types[index], [...path, "types", index], seenReferences);
          if (memberPatterns === undefined)
            return;
          if (memberPatterns.length === 0)
            return [];
          patterns.push(...memberPatterns);
        }
        return patterns;
      }
      case "Number":
        return parameter.checks.length === 0 ? [numberKeyPattern] : undefined;
      default:
        throw errorWithPath(`Invalid index signature parameter ${parameter._tag}`, path);
    }
  }
  function getTemplateLiteralPattern(parts) {
    const activeReferences = new Set;
    let exact = true;
    const pattern = `^${parts.map(getPartPattern).join("")}$`;
    return {
      pattern,
      exact
    };
    function getPartPattern(part) {
      if (part._tag !== "Reference" && part.checks.length > 0)
        exact = false;
      switch (part._tag) {
        case "Reference": {
          if (!Object.hasOwn(references, part.$ref)) {
            throw errorWithPath(`Invalid reference ${part.$ref}`, []);
          }
          if (activeReferences.has(part.$ref)) {
            throw errorWithPath(`Invalid recursive TemplateLiteral part ${part.$ref}`, []);
          }
          activeReferences.add(part.$ref);
          const pattern = getPartPattern(references[part.$ref]);
          activeReferences.delete(part.$ref);
          return pattern;
        }
        case "Literal":
          return escape(globalThis.String(part.literal));
        case "String":
          return STRING_PATTERN;
        case "Number":
          return FINITE_PATTERN;
        case "BigInt":
          return "-?\\d+";
        case "TemplateLiteral":
          return part.parts.map(getPartPattern).join("");
        case "Union":
          if (part.types.length === 0)
            return "(?!)";
          if (part.options?.mode === "oneOf")
            exact = false;
          return `(?:${part.types.map(getPartPattern).join("|")})`;
        default:
          throw errorWithPath(`Invalid TemplateLiteral part ${part._tag}`, []);
      }
    }
  }
}
function isJsonSchemaType(input) {
  return input === "string" || input === "number" || input === "boolean" || input === "array" || input === "object" || input === "null" || input === "integer";
}
function compactEnums(schemas) {
  let sharedType = undefined;
  const values = [];
  for (const schema of schemas) {
    const keys = Object.keys(schema);
    if (keys.length !== 2 || schema.type === undefined || !Array.isArray(schema.enum) || schema.enum.length === 0) {
      return;
    }
    if (sharedType === undefined)
      sharedType = schema.type;
    else if (schema.type !== sharedType)
      return;
    for (const value of schema.enum) {
      if (values.includes(value))
        return;
      values.push(value);
    }
  }
  return {
    type: sharedType,
    enum: values
  };
}
function toJsonSchemaDocument(document, options) {
  const output = compileJsonSchema([document.representation], [["representation"]], document.references, options);
  return {
    dialect: output.dialect,
    schema: output.schemas[0],
    definitions: output.definitions
  };
}

var defaultReferencePolicy = ({
  identifier
}) => identifier;
function annotationsField(annotations) {
  return annotations === undefined ? undefined : {
    annotations
  };
}
function toRepresentation(ast, options) {
  const {
    references,
    representations
  } = toRepresentations([ast], options);
  return {
    representation: representations[0],
    references
  };
}
function toRepresentations(asts, options) {
  const references = {};
  const usedReferences = new Set;
  const candidates = new Map;
  for (const ast of asts)
    visit(ast);
  const referencePolicy = options?.referencePolicy ?? defaultReferencePolicy;
  for (const variants of candidates.values()) {
    for (const candidate of variants) {
      const requestedReference = referencePolicy({
        ast: candidate.ast,
        occurrences: candidate.occurrences,
        identifier: candidate.identifier
      });
      if (requestedReference !== undefined) {
        const separator = requestedReference === candidate.identifier || !requestedReference.endsWith("_") ? "_" : "";
        candidate.reference = getReference(requestedReference, separator);
      } else if (candidate.isRecursive) {
        candidate.reference = getReference(`${candidate.ast._tag}_`, "");
      }
    }
  }
  const representations = map(asts, recur);
  return {
    representations,
    references
  };
  function getReference(prefix, separator) {
    let candidate = prefix;
    let suffix = 0;
    while (usedReferences.has(candidate)) {
      candidate = `${prefix}${separator}${++suffix}`;
    }
    usedReferences.add(candidate);
    return candidate;
  }
  function annotateReference(ast, candidate, reference) {
    const fallback = candidate.fallback;
    if (fallback !== undefined) {
      return resolveIdentifierFallback(ast) === fallback ? ast : annotate(ast, {
        [IDENTIFIER_FALLBACK_KEY]: fallback
      });
    }
    return reference === candidate.identifier ? ast : annotate(ast, {
      identifier: reference
    });
  }
  function getCandidate(input, encodingLength = input.encoding?.length ?? 0) {
    let ast = input;
    let content;
    while (ast.encoding !== undefined && encodingLength > 0) {
      const last = ast.encoding[encodingLength - 1];
      if (last.to.encoding === undefined && last.to._tag === "String") {
        const metadata = getContent(last.transformation.encode);
        if (metadata !== undefined) {
          content = {
            mediaType: metadata.mediaType,
            schema: metadata.preserveSchema ? getCandidate(ast, encodingLength - 1) : undefined
          };
        }
      }
      ast = last.to;
      encodingLength = ast.encoding?.length ?? 0;
    }
    const owner = getContextOwner(ast);
    let identifier = resolveIdentifier(ast);
    const fallback = identifier === undefined ? (ast !== input ? resolveIdentifier(input) : undefined) ?? resolveIdentifierFallback(ast) : undefined;
    if (fallback !== undefined)
      identifier = `${fallback}Encoded`;
    let variants = candidates.get(owner);
    if (variants === undefined) {
      variants = [];
      candidates.set(owner, variants);
    }
    let candidate = variants.find((candidate) => candidate.identifier === identifier && candidate.content?.mediaType === content?.mediaType && candidate.content?.schema === content?.schema);
    if (candidate === undefined) {
      candidate = {
        ast: owner,
        identifier,
        fallback,
        content,
        occurrences: 0
      };
      variants.push(candidate);
    }
    return candidate;
  }
  function visit(input) {
    visitCandidate(getCandidate(input));
    return input;
  }
  function visitCandidate(candidate) {
    const ast = candidate.ast;
    candidate.occurrences++;
    if (candidate.visiting) {
      candidate.isRecursive = true;
      return;
    }
    if (candidate.occurrences > 1)
      return;
    candidate.visiting = true;
    if (candidate.content?.schema !== undefined)
      visitCandidate(candidate.content.schema);
    visitChecks(ast.checks);
    switch (ast._tag) {
      default:
        if ("recur" in ast)
          ast.recur(visit);
        break;
      case "TemplateLiteral":
        ast.parts.forEach(visit);
        break;
      case "Suspend":
        visit(ast.thunk());
        break;
    }
    candidate.visiting = false;
  }
  function visitChecks(checks) {
    checks?.forEach((check) => {
      check.annotations?.representation?.schemas?.forEach((schema) => visit(toType(schema)));
      if (check._tag === "FilterGroup")
        visitChecks(check.checks);
    });
  }
  function recur(input) {
    return recurCandidate(getCandidate(input));
  }
  function recurCandidate(candidate) {
    const ast = candidate.ast;
    const reference = candidate.reference;
    if (reference !== undefined) {
      if (!candidate.emitted) {
        candidate.emitted = true;
        const annotated = candidate.identifier === undefined ? ast : annotateReference(ast, candidate, reference);
        const representation = on(annotated, candidate.content);
        assignProperty(references, reference, representation);
      }
      return {
        _tag: "Reference",
        $ref: reference
      };
    }
    return on(ast, candidate.content);
  }
  function on(ast, content) {
    const common = {
      checks: ast.checks?.map(fromCheck) ?? [],
      ...ast._tag === "Declaration" ? fromAnnotations(ast.annotations) : annotationsField(ast.annotations)
    };
    switch (ast._tag) {
      case "Declaration":
        return {
          _tag: ast._tag,
          typeParameters: ast.typeParameters.map(recur),
          ...common
        };
      default:
        return {
          _tag: ast._tag,
          ...content === undefined ? undefined : {
            content: {
              mediaType: content.mediaType,
              ...content.schema === undefined ? undefined : {
                schema: recurCandidate(content.schema)
              }
            }
          },
          ...common
        };
      case "Literal":
        return {
          _tag: ast._tag,
          literal: ast.literal,
          ...common
        };
      case "UniqueSymbol":
        return {
          _tag: ast._tag,
          symbol: ast.symbol,
          ...common
        };
      case "Enum":
        return {
          _tag: ast._tag,
          enums: ast.enums,
          ...common
        };
      case "TemplateLiteral":
        return {
          _tag: ast._tag,
          parts: ast.parts.map(recur),
          ...common
        };
      case "Arrays":
        return {
          _tag: ast._tag,
          elements: ast.elements.map((element) => {
            const projected = getLastEncoding(element);
            const annotations = projected.context?.annotations;
            return {
              isOptional: isOptional(projected),
              type: recur(element),
              ...annotationsField(annotations)
            };
          }),
          rest: ast.rest.map(recur),
          ...common
        };
      case "Objects":
        return {
          _tag: ast._tag,
          propertySignatures: ast.propertySignatures.map((property) => {
            const projected = getLastEncoding(property.type);
            const annotations = projected.context?.annotations;
            return {
              name: property.name,
              type: recur(property.type),
              isOptional: isOptional(projected),
              isMutable: isMutable(projected),
              ...annotationsField(annotations)
            };
          }),
          indexSignatures: ast.indexSignatures.map((index) => ({
            parameter: recur(index.parameter),
            type: recur(index.type)
          })),
          ...common
        };
      case "Union":
        return {
          _tag: ast._tag,
          types: ast.types.map(recur),
          ...ast.options === undefined ? {} : {
            options: ast.options
          },
          ...common
        };
      case "Suspend":
        return {
          _tag: ast._tag,
          ...common,
          checks: [],
          thunk: recur(ast.thunk())
        };
    }
  }
  function fromCheck(check) {
    return {
      ...check._tag === "Filter" ? {
        _tag: check._tag,
        aborted: check.aborted
      } : {
        _tag: check._tag,
        checks: map(check.checks, fromCheck)
      },
      ...fromAnnotations(check.annotations, true)
    };
  }
  function fromAnnotations(annotations, projectSchemas = false) {
    if (annotations === undefined)
      return;
    const {
      representation,
      ...ordinary
    } = annotations;
    const projected = projectSchemas && representation?.schemas !== undefined ? {
      ...representation,
      schemas: representation.schemas.map((schema) => recur(toType(schema)))
    } : representation;
    return {
      ...projected === undefined ? undefined : {
        representation: projected
      },
      ...Object.keys(ordinary).length === 0 ? undefined : {
        annotations: ordinary
      }
    };
  }
}

var omit2 = /* @__PURE__ */ dual(2, (self, keys) => {
  return buildStruct(self, (k, v) => !hasPropertyKey(keys, k) ? [k, v] : undefined);
});
var lambda = (f) => f;
var map7 = /* @__PURE__ */ dual(2, (self, lambda) => {
  return buildStruct(self, (k, v) => [k, lambda(v)]);
});
function hasPropertyKey(keys, key) {
  return keys.some((candidate) => candidate === key || typeof candidate === "number" && String(candidate) === key);
}
function buildStruct(source, f) {
  const out = {};
  for (const k of Reflect.ownKeys(source)) {
    if (!Object.prototype.propertyIsEnumerable.call(source, k))
      continue;
    const res = f(k, source[k]);
    if (res) {
      const [nk, nv] = res;
      assignProperty(out, nk, nv);
    }
  }
  return out;
}

var SchemaErrorTypeId = "~effect/Schema/SchemaError";
function isSchemaError(u) {
  return hasProperty(u, SchemaErrorTypeId) && u[SchemaErrorTypeId] === SchemaErrorTypeId;
}

function declareConstructor() {
  return (typeParameters, run, annotations) => {
    return make6(new Declaration(typeParameters.map(getAST), (typeParameters) => run(typeParameters.map((ast) => make6(ast))), annotations));
  };
}
function declare(is, annotations) {
  return declareConstructor()([], () => (input, ast, options) => is(input) ? succeed5(input) : fail5(new InvalidType(ast, input, options)), annotations);
}
class SchemaError extends (/* @__PURE__ */ TaggedError2("SchemaError")) {
  [SchemaErrorTypeId] = SchemaErrorTypeId;
  constructor(issue) {
    const stackTraceLimit = getStackTraceLimit();
    setStackTraceLimit(0);
    try {
      super({
        issue
      });
    } finally {
      setStackTraceLimit(stackTraceLimit);
    }
  }
  get message() {
    return defaultFormatter(this.issue);
  }
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message
    };
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  toString() {
    return `SchemaError(${this.message})`;
  }
}
function isSchemaError2(u) {
  return isSchemaError(u);
}
function fromIssueEffect(self) {
  if (effectIsExit(self)) {
    return fromIssueExit(self);
  }
  return catchCause2(self, (cause) => failCauseSync2(() => map3(cause, (issue) => new SchemaError(issue))));
}
function fromIssueExit(exit) {
  return isSuccess3(exit) ? exit : failCause2(map3(exit.cause, (issue) => new SchemaError(issue)));
}
function getSchemaErrorOrThrow(cause, message) {
  let schemaError;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isSchemaError2(reason.error)) {
      throw new globalThis.Error(message, {
        cause
      });
    }
    schemaError ??= reason.error;
  }
  if (schemaError === undefined) {
    throw new globalThis.Error(message, {
      cause
    });
  }
  return schemaError;
}
function runSchemaErrorSync(self) {
  const exit = runSyncExit2(self);
  if (isSuccess3(exit)) {
    return exit.value;
  }
  throw getSchemaErrorOrThrow(exit.cause, "Sync adapter can only throw schema errors");
}
var is2 = is;
function decodeUnknownEffect2(schema, options) {
  const parser = decodeUnknownEffect(schema, options);
  return (input, options) => {
    return fromIssueEffect(parser(input, options));
  };
}
function decodeUnknownResult2(schema, options) {
  const parser = decodeUnknownResult(schema, options);
  return (input, options) => {
    return mapError(parser(input, options), (issue) => new SchemaError(issue));
  };
}
function decodeUnknownSync(schema, options) {
  const parser = decodeUnknownEffect2(schema, options);
  return (input, options) => {
    return runSchemaErrorSync(parser(input, options));
  };
}
var make6 = make5;
var optional2 = /* @__PURE__ */ lambda((self) => {
  const schema = UndefinedOr(self);
  return make6(optional(self.ast), {
    schema
  });
});
var mutableKey2 = /* @__PURE__ */ lambda((schema) => make6(mutableKey(schema.ast), {
  schema
}));
var toType2 = /* @__PURE__ */ lambda((schema) => make6(toType(schema.ast), {
  schema
}));
var toEncoded2 = /* @__PURE__ */ lambda((schema) => make6(toEncoded(schema.ast), {
  schema
}));
function Literal2(literal) {
  const out = make6(new Literal(literal), {
    literal,
    transform(to) {
      return out.pipe(decodeTo2(Literal2(to), {
        decode: transform(() => to),
        encode: transform(() => literal)
      }));
    }
  });
  return out;
}
var Unknown2 = /* @__PURE__ */ make6(unknown);
var Null2 = /* @__PURE__ */ make6(null_);
var Undefined2 = /* @__PURE__ */ make6(undefined_2);
var String4 = /* @__PURE__ */ make6(string2);
var Number5 = /* @__PURE__ */ make6(number2);
var Boolean3 = /* @__PURE__ */ make6(boolean);
function makeStruct(ast, fields) {
  return make6(ast, {
    fields,
    mapFields(f, options) {
      const fields = f(this.fields);
      return makeStruct(struct(fields, options?.unsafePreserveChecks ? this.ast.checks : undefined), fields);
    }
  });
}
function Struct(fields) {
  return makeStruct(struct(fields, undefined), fields);
}
function Record(key, value) {
  return make6(record2(key.ast, value.ast), {
    key,
    value
  });
}
function StructWithRest(schema, records) {
  return make6(structWithRest(schema.ast, records.map(getAST)), {
    schema,
    records
  });
}
function makeTuple(ast, elements) {
  return make6(ast, {
    elements,
    mapElements(f, options) {
      const elements = f(this.elements);
      return makeTuple(tuple(elements, options?.unsafePreserveChecks ? this.ast.checks : undefined), elements);
    }
  });
}
function Tuple(elements) {
  return makeTuple(tuple(elements), elements);
}
function TupleWithRest(schema, rest) {
  return make6(tupleWithRest(schema.ast, rest.map(getAST)), {
    schema,
    rest
  });
}
var ArraySchema = /* @__PURE__ */ lambda((schema) => make6(new Arrays(false, [], [schema.ast]), {
  value: schema
}));
var mutable2 = /* @__PURE__ */ lambda((schema) => make6(mutable(schema.ast), {
  schema
}));
function makeUnion(ast, members) {
  return make6(ast, {
    members,
    mapMembers(f, options) {
      const members = f(this.members);
      return makeUnion(union(members, this.ast.options, options?.unsafePreserveChecks ? this.ast.checks : undefined), members);
    }
  });
}
function Union2(members, options) {
  return makeUnion(union(members, options, undefined), members);
}
function Literals(literals) {
  const members = literals.map(Literal2);
  return make6(union(members, undefined, undefined), {
    literals,
    members,
    mapMembers(f) {
      return Union2(f(this.members));
    },
    pick(literals) {
      return Literals(literals);
    },
    transform(to) {
      return Union2(members.map((member, index) => member.transform(to[index])));
    }
  });
}
var NullOr = /* @__PURE__ */ lambda((self) => Union2([self, Null2]));
var UndefinedOr = /* @__PURE__ */ lambda((self) => Union2([self, Undefined2]));
function middlewareDecoding2(decode) {
  return (schema) => make6(middlewareDecoding(schema.ast, new Middleware(decode, identity)), {
    schema
  });
}
function catchDecoding(f) {
  return catchDecodingWithContext(f);
}
function catchDecodingWithContext(f) {
  return (self) => middlewareDecoding2(catchEager2(f))(self);
}
function decodeTo2(to, transformation) {
  return (from) => {
    return make6(decodeTo(from.ast, to.ast, transformation ? makeTransformation(transformation) : passthrough3()), {
      from,
      to
    });
  };
}
function withConstructorDefault2(defaultValue) {
  return (schema) => make6(withConstructorDefault(schema.ast, defaultValue), {
    schema
  });
}
function toIssueEffect(self) {
  if (effectIsExit(self) && self._tag === "Success") {
    return self;
  }
  return catchCause2(self, (cause) => failCauseSync2(() => map3(cause, (error) => error.issue)));
}
function withDecodingDefault(defaultValue, options) {
  const encode = options?.encodingStrategy === "omit" ? omit() : passthrough2();
  return (self) => {
    return optional2(toEncoded2(self)).pipe(decodeTo2(self, {
      decode: withDefault(toIssueEffect(defaultValue)),
      encode
    }));
  };
}
function tag(literal) {
  return Literal2(literal).pipe(withConstructorDefault2(succeed5(literal)));
}
function TaggedStruct(value, fields) {
  return Struct({
    _tag: tag(value),
    ...fields
  });
}
function instanceOf(constructor, annotations) {
  return declare((u) => u instanceof constructor, annotations);
}
function link() {
  return (encodeTo, transformation) => {
    return new Link(encodeTo.ast, makeTransformation(transformation));
  };
}
var makeFilter2 = makeFilter;
function isPattern2(regExp, annotations) {
  const source = regExp.source;
  const flags = regExp.flags;
  const canExport = /^[dg]*uy?$/.test(flags);
  const runtimeRegExp = flags === "" ? `new globalThis.RegExp(${format(source)})` : `new globalThis.RegExp(${format(source)}, ${format(flags)})`;
  return isPattern(regExp, {
    toJsonSchema: () => canExport ? {
      pattern: flags.endsWith("y") ? `^(?:${source})` : source
    } : [{}, true],
    toCode: () => ({
      runtime: `Schema.isPattern(${runtimeRegExp})`
    }),
    ...annotations
  });
}
function isBase64(annotations) {
  const pattern = "^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$";
  const regExp = /^[0-9a-zA-Z+/]*={0,2}$/;
  return makeFilter2((s) => s.length % 4 === 0 && regExp.test(s), {
    expected: "a base64 encoded string",
    representation: {
      id: "effect/schema/isBase64",
      payload: null
    },
    toJsonSchema: () => ({
      pattern
    }),
    arbitraryConstraint: {
      patterns: [{
        source: pattern,
        flags: ""
      }]
    },
    toCode: () => ({
      runtime: "Schema.isBase64()"
    }),
    ...annotations
  });
}
var Finite = /* @__PURE__ */ make6(finite);
function makeIsGreaterThan(options) {
  const gt = isGreaterThan(options.order);
  const formatter = options.formatter ?? format;
  return (exclusiveMinimum, annotations) => {
    return makeFilter2((input) => gt(input, exclusiveMinimum), {
      expected: `a value greater than ${formatter(exclusiveMinimum)}`,
      arbitraryConstraint: {
        order: options.order,
        minimum: exclusiveMinimum,
        exclusiveMinimum: true
      },
      ...options.annotate?.(exclusiveMinimum),
      ...annotations
    });
  };
}
function makeIsGreaterThanOrEqualTo(options) {
  const gte = isGreaterThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (minimum, annotations) => {
    return makeFilter2((input) => gte(input, minimum), {
      expected: `a value greater than or equal to ${formatter(minimum)}`,
      arbitraryConstraint: {
        order: options.order,
        minimum
      },
      ...options.annotate?.(minimum),
      ...annotations
    });
  };
}
function makeIsLessThanOrEqualTo(options) {
  const lte = isLessThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (maximum, annotations) => {
    return makeFilter2((input) => lte(input, maximum), {
      expected: `a value less than or equal to ${formatter(maximum)}`,
      arbitraryConstraint: {
        order: options.order,
        maximum
      },
      ...options.annotate?.(maximum),
      ...annotations
    });
  };
}
function encodeNumberPayload(number) {
  if (!globalThis.Number.isFinite(number)) {
    throw new globalThis.RangeError(`Expected a finite number, got ${format(number)}`);
  }
  return number;
}
var isGreaterThan2 = /* @__PURE__ */ makeIsGreaterThan({
  order: Number2,
  annotate: (exclusiveMinimum) => ({
    representation: {
      id: "effect/schema/isGreaterThan",
      payload: {
        exclusiveMinimum: encodeNumberPayload(exclusiveMinimum)
      }
    },
    toJsonSchema: () => ({
      exclusiveMinimum
    }),
    toCode: () => ({
      runtime: `Schema.isGreaterThan(${format(exclusiveMinimum)})`
    })
  })
});
var isGreaterThanOrEqualTo2 = /* @__PURE__ */ makeIsGreaterThanOrEqualTo({
  order: Number2,
  annotate: (minimum) => ({
    representation: {
      id: "effect/schema/isGreaterThanOrEqualTo",
      payload: {
        minimum: encodeNumberPayload(minimum)
      }
    },
    toJsonSchema: () => ({
      minimum
    }),
    toCode: () => ({
      runtime: `Schema.isGreaterThanOrEqualTo(${format(minimum)})`
    })
  })
});
var isLessThanOrEqualTo3 = /* @__PURE__ */ makeIsLessThanOrEqualTo({
  order: Number2,
  annotate: (maximum) => ({
    representation: {
      id: "effect/schema/isLessThanOrEqualTo",
      payload: {
        maximum: encodeNumberPayload(maximum)
      }
    },
    toJsonSchema: () => ({
      maximum
    }),
    toCode: () => ({
      runtime: `Schema.isLessThanOrEqualTo(${format(maximum)})`
    })
  })
});
function isInt(annotations) {
  return makeFilter2((n) => globalThis.Number.isSafeInteger(n), {
    expected: "an integer",
    representation: {
      id: "effect/schema/isInt",
      payload: null
    },
    toJsonSchema: () => ({
      type: "integer",
      minimum: globalThis.Number.MIN_SAFE_INTEGER,
      maximum: globalThis.Number.MAX_SAFE_INTEGER
    }),
    toCode: () => ({
      runtime: "Schema.isInt()"
    }),
    arbitraryConstraint: {
      number: "integer"
    },
    ...annotations
  });
}
var Int = /* @__PURE__ */ Number5.check(/* @__PURE__ */ isInt());
function isMinLength(minLength, annotations) {
  minLength = normalizeCardinality(minLength);
  return makeIsMinLength(minLength, Math.ceil(minLength / 2), annotations);
}
function makeIsMinLength(minLength, minCodePoints, annotations) {
  return makeFilter2((input) => input.length >= minLength, {
    expected: `a value with a length of at least ${minLength}`,
    representation: {
      id: "effect/schema/isMinLength",
      payload: {
        minLength
      }
    },
    toJsonSchema: ({
      type
    }) => type === "string" ? minLength <= 1 ? {
      minLength: minCodePoints
    } : [{
      minLength: minCodePoints
    }, true] : type === "array" ? {
      minItems: minLength
    } : type === undefined ? [{
      minLength: minCodePoints,
      minItems: minLength
    }, true] : [{}, true],
    toCode: () => ({
      runtime: `Schema.isMinLength(${minLength})`
    }),
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitraryConstraint: {
      minLength
    },
    ...annotations
  });
}
function isMaxLength(maxLength, annotations) {
  maxLength = normalizeCardinality(maxLength);
  return makeFilter2((input) => input.length <= maxLength, {
    expected: `a value with a length of at most ${maxLength}`,
    representation: {
      id: "effect/schema/isMaxLength",
      payload: {
        maxLength
      }
    },
    toJsonSchema: ({
      type
    }) => type === "string" ? maxLength === 0 ? {
      maxLength
    } : [{
      maxLength
    }, true] : type === "array" ? {
      maxItems: maxLength
    } : type === undefined ? [{
      maxLength,
      maxItems: maxLength
    }, true] : [{}, true],
    toCode: () => ({
      runtime: `Schema.isMaxLength(${maxLength})`
    }),
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitraryConstraint: {
      maxLength
    },
    ...annotations
  });
}
function normalizeCardinality(value) {
  if (!globalThis.Number.isFinite(value)) {
    throw new globalThis.RangeError(`Expected a finite number, got ${value}`);
  }
  return Math.max(0, Math.floor(value));
}
var RegExp3 = /* @__PURE__ */ instanceOf(globalThis.RegExp, {
  representation: {
    id: "effect/schema/RegExp",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.RegExp`,
    Type: `globalThis.RegExp`
  }),
  expected: "RegExp",
  toCodecJson: () => link()(Struct({
    source: String4,
    flags: String4
  }), transformEffect2({
    decode: (e, options) => try_3({
      try: () => new globalThis.RegExp(e.source, e.flags),
      catch: () => new InvalidValue({
        expected: "valid RegExp source and flags"
      }, e, options)
    }),
    encode: (regExp) => succeed5({
      source: regExp.source,
      flags: regExp.flags
    })
  }))
});
var URLString = /* @__PURE__ */ String4.annotate({
  expected: "a string that will be decoded as a URL"
});
var URL2 = /* @__PURE__ */ instanceOf(globalThis.URL, {
  representation: {
    id: "effect/schema/URL",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URL`,
    Type: `globalThis.URL`
  }),
  expected: "URL",
  toCodecJson: () => link()(URLString, urlFromString)
});
var File = /* @__PURE__ */ instanceOf(globalThis.File, {
  representation: {
    id: "effect/schema/File",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.File`,
    Type: `globalThis.File`
  }),
  expected: "File",
  toCodecJson: () => link()(Struct({
    data: String4.check(isBase64()),
    type: String4,
    name: String4,
    lastModified: Int
  }), transformEffect2({
    decode: (e, options) => match(decode(e.data), {
      onFailure: () => fail5(new InvalidValue({
        expected: "a valid Base64 string"
      }, e.data, options)),
      onSuccess: (bytes) => {
        const buffer = new globalThis.Uint8Array(bytes);
        return succeed5(new globalThis.File([buffer], e.name, {
          type: e.type,
          lastModified: e.lastModified
        }));
      }
    }),
    encode: (file, options) => tryPromise2({
      try: async () => {
        const bytes = new globalThis.Uint8Array(await file.arrayBuffer());
        return {
          data: encode(bytes),
          type: file.type,
          name: file.name,
          lastModified: file.lastModified
        };
      },
      catch: () => new InvalidValue({
        expected: "a readable File"
      }, file, options)
    })
  }))
});
var URLSearchParams2 = /* @__PURE__ */ instanceOf(globalThis.URLSearchParams, {
  representation: {
    id: "effect/schema/URLSearchParams",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URLSearchParams`,
    Type: `globalThis.URLSearchParams`
  }),
  expected: "URLSearchParams",
  toCodecJson: () => link()(String4.annotate({
    expected: "a query string that will be decoded as URLSearchParams"
  }), transform2({
    decode: (e) => new globalThis.URLSearchParams(e),
    encode: (params) => params.toString()
  }))
});
var Base64String = /* @__PURE__ */ String4.annotate({
  expected: "a base64 encoded string that will be decoded as Uint8Array",
  format: "byte",
  contentEncoding: "base64"
});
var Uint8Array2 = /* @__PURE__ */ instanceOf(globalThis.Uint8Array, {
  representation: {
    id: "effect/schema/Uint8Array",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.Uint8Array`,
    Type: `globalThis.Uint8Array`
  }),
  expected: "Uint8Array",
  toCodecJson: () => link()(Base64String, uint8ArrayFromBase64String)
});
var arbitraryMinimumDateTimestamp = -8640000000000000;
var arbitraryMaximumDateTimestamp = 8640000000000000;
var arbitraryMinimumZonedDateTimeTimestamp = arbitraryMinimumDateTimestamp + 14 * 60 * 60 * 1000;
var arbitraryMaximumZonedDateTimeTimestamp = arbitraryMaximumDateTimestamp - 14 * 60 * 60 * 1000;
var arbitraryMinimumTimeZoneOffset = -12 * 60 * 60 * 1000;
var arbitraryMaximumTimeZoneOffset = 14 * 60 * 60 * 1000;
function toJsonSchemaDocument2(schema, options) {
  const document = toRepresentation(toCodecJsonAST(schema.ast), options);
  return toJsonSchemaDocument(document, options);
}
function mutableStruct(fields) {
  return Struct(fields).mapFields(map7(mutableKey2));
}
function strictStruct(fields) {
  const structure = mutableStruct(fields);
  const kept = StructWithRest(structure.mapFields(map7(toEncoded2)), [
    Record(String4, mutableKey2(Unknown2))
  ]);
  const schema = kept.check(makeFilter2((value) => {
    const extra = Object.keys(value).filter((key) => !Object.hasOwn(fields, key));
    return extra.length ? extra.map((key) => ({ path: [key], issue: new UnexpectedKey(structure.ast) })) : true;
  }, { toJsonSchema: () => ({ propertyNames: { enum: Object.keys(fields) } }) })).pipe(decodeTo2(structure));
  return Object.assign(schema, { fields: structure.fields });
}
function mutableArray(item) {
  return mutable2(ArraySchema(item));
}
function decodeSync(schema, value) {
  return decodeUnknownSync(schema, { errors: "all" })(value);
}
function safeDecode(schema, value) {
  return match(decodeUnknownResult2(schema, { errors: "all" })(value), {
    onSuccess: (data) => ({ success: true, data, error: undefined }),
    onFailure: (error) => ({
      success: false,
      data: undefined,
      error: Object.assign(error, { issues: schemaIssues(error) })
    })
  });
}
var issueDetails = new WeakMap;
function issueOf(issue) {
  const value = new InvalidValue({ message: issue.message });
  issueDetails.set(value, issue);
  return issue.path?.length ? new Pointer(issue.path, value) : value;
}
function refined(schema, check, message = "Invalid value") {
  return schema.check(makeFilter2((value) => Boolean(check(value)) || (typeof message === "string" ? message : issueOf(message))));
}
function mapped(schema, output, map, encode) {
  return schema.pipe(decodeTo2(output, {
    decode: transformEffect((value) => suspend2(() => {
      const issues = [];
      const result = map(value, { addIssue: (issue) => issues.push(issueOf(issue)) });
      const [first, ...rest] = issues;
      return first ? fail5(new Composite(schema.ast, [first, ...rest])) : succeed5(result);
    })),
    encode: transform(encode)
  }));
}
function schemaIssues(error) {
  const output = [];
  function visit(issue, path) {
    if (issue._tag === "Pointer") {
      visit(issue.issue, [...path, ...issue.path]);
      return;
    }
    if ("issues" in issue && issue.issues.length) {
      for (const child of issue.issues)
        visit(child, path);
      return;
    }
    if ("issue" in issue) {
      visit(issue.issue, path);
      return;
    }
    const detail = issueDetails.get(issue);
    if (issue._tag === "UnexpectedKey") {
      const key = String(path.at(-1));
      output.push({
        code: "unrecognized_keys",
        keys: [key],
        path: path.slice(0, -1),
        message: `Unrecognized key: "${key}"`
      });
    } else {
      output.push({
        code: detail?.code ?? "invalid",
        path,
        message: makeFormatterDefault()(issue),
        ...detail?.params ? { params: detail.params } : {}
      });
    }
  }
  visit(error.issue, []);
  return output;
}
function mutableRecord(key, value) {
  const record = Record(key, mutableKey2(value));
  const kept = StructWithRest(Record(key, mutableKey2(toEncoded2(value))), [
    Record(String4, mutableKey2(Unknown2))
  ]);
  const validKey = is2(toType2(key));
  return kept.check(makeFilter2((values) => {
    const issues = Object.keys(values).filter((name) => !validKey(name)).map((name) => new Pointer([name], new InvalidValue({ message: "Invalid record key" })));
    return issues.length ? issues : true;
  }, { toJsonSchema: () => ({ propertyNames: toJsonSchemaDocument2(key).schema }) })).pipe(decodeTo2(record));
}
var numberFromInput = mapped(Unknown2, Finite, (value) => Number(value), (value) => value);
function matchesPattern(pattern, annotations) {
  return isPattern2(pattern, { ...annotations, toJsonSchema: () => ({ pattern: pattern.source }) });
}

var diagnosticCodes = [
  "invalid-manifest",
  "unsupported",
  "cycle",
  "duplicate-identity",
  "unknown-reference",
  "versioned-reference",
  "binding-missing",
  "binding-not-dispatchable",
  "wildcard-ref",
  "each-package-input",
  "required-uncovered",
  "version-file-missing",
  "reserved-operation",
  "credential-undeclared",
  "grant-missing",
  "registry-setup",
  "license-missing",
  "package-metadata",
  "legacy",
  "invalid-configuration",
  "configuration-drift",
  "lookup-failed",
  "unconfigured",
  "version-tagged",
  "release-unchecked",
  "companion-module",
  "package-tag"
];
var diagnosticSubject = Union2([
  mutableStruct({ kind: Literal2("file"), path: String4 }),
  mutableStruct({ kind: Literal2("package"), key: String4 }),
  mutableStruct({ kind: Literal2("stream"), name: String4 }),
  mutableStruct({ kind: Literal2("binding"), stream: String4, operation: String4 }),
  mutableStruct({ kind: Literal2("credential"), alias: String4 })
]);
var diagnostic = mutableStruct({
  code: Literals(diagnosticCodes),
  severity: Literals(["blocking", "warning"]),
  subject: optional2(diagnosticSubject),
  message: String4
});

function decodeWith(schema, value, reject) {
  return decodeUnknownEffect2(schema, { errors: "all" })(value).pipe(mapError3(reject));
}
function parseWith(reject) {
  return (schema, value) => decodeWith(schema, value, reject);
}

var resources = [
  "repository",
  "execution",
  "credential",
  "grant",
  "route",
  "security-key",
  "release-event",
  "destination",
  "stream",
  "workflow"
];
var conflictKinds = ["stale-plan", "stale-revision", "stale-version", "override-digest", "protocol"];
var services = ["github", "registry", "d1", "oidc"];
var issue = mutableStruct({
  path: mutableArray(Union2([String4, Finite])),
  message: String4
});
var apiError = Union2([
  mutableStruct({ code: Literal2("unauthenticated") }),
  mutableStruct({ code: Literal2("forbidden"), reason: String4 }),
  mutableStruct({
    code: Literal2("not-found"),
    resource: Literals(resources),
    id: optional2(String4)
  }),
  mutableStruct({
    code: Literal2("method-not-allowed"),
    allowed: mutableArray(Literals(["GET", "POST"]))
  }),
  mutableStruct({ code: Literal2("invalid"), issues: mutableArray(issue) }),
  mutableStruct({
    code: Literal2("conflict"),
    kind: Literals(conflictKinds),
    expected: optional2(String4),
    actual: optional2(String4)
  }),
  mutableStruct({ code: Literal2("precondition"), diagnostics: mutableArray(diagnostic) }),
  mutableStruct({
    code: Literal2("upstream"),
    service: Literals(services),
    retryable: Literal2(true)
  }),
  mutableStruct({ code: Literal2("internal"), incident: String4 })
]);
var errorEnvelope = mutableStruct({ error: String4, problem: optional2(apiError) });
var resourceLabels = {
  repository: "Repository",
  execution: "Execution",
  credential: "Stored value",
  grant: "Grant",
  route: "Route",
  "security-key": "Security key",
  "release-event": "Release event",
  destination: "Destination",
  stream: "Release stream",
  workflow: "Workflow"
};
function messageOf(problem) {
  switch (problem.code) {
    case "unauthenticated":
      return "Administrator authentication required";
    case "forbidden":
      return problem.reason;
    case "not-found":
      return `${resourceLabels[problem.resource]} not found`;
    case "method-not-allowed":
      return "Method not allowed";
    case "invalid":
      return problem.issues.map((entry) => entry.path.length ? `${entry.path.join(".")}: ${entry.message}` : entry.message).join("; ") || "Invalid request";
    case "conflict":
      return `Request conflicts with current state (${problem.kind})`;
    case "precondition":
      return problem.diagnostics.map((entry) => entry.message).join(`
`) || "Precondition failed";
    case "upstream":
      return `${problem.service} is unavailable; try again`;
    case "internal":
      return `Internal error ${problem.incident}`;
  }
}

class DomainError extends TaggedError2("DomainError") {
}
function domainError(problem, message = messageOf(problem)) {
  return new DomainError({ problem, message });
}
function precondition(message) {
  return domainError({ code: "precondition", diagnostics: [{ code: "legacy", severity: "blocking", message }] });
}

var stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function parseChecksums(source) {
  return gen3(function* () {
    const result = new Map;
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (!line)
        continue;
      const match = /^([a-fA-F0-9]{64}) [ *](\S+)$/.exec(line);
      if (!match?.[1] || !match[2])
        return yield* precondition(`Malformed checksum line ${index + 1}`);
      if (result.has(match[2]))
        return yield* precondition(`Duplicate checksum for ${match[2]}`);
      result.set(match[2], match[1].toLowerCase());
    }
    return result;
  });
}
function expand(value, variables) {
  const unknown = [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1] ?? "").find((key) => !Object.hasOwn(variables, key));
  return unknown === undefined ? succeed5(value.replace(/\{([^{}]+)\}/g, (_match, key) => variables[key] ?? "")) : fail5(precondition(`Unknown template variable ${unknown}`));
}
function https(value) {
  return sync2(() => URL.parse(value)).pipe(filterOrFail2((url) => url !== null && url.protocol === "https:" && !url.username && !url.password && !url.hash, () => precondition("Expected an HTTPS release URL")), as2(value));
}
function releaseTag(version, tag) {
  const resolved = tag ?? `v${version}`;
  if (!stableVersion.test(version))
    return fail5(precondition("Expected stable MAJOR.MINOR.PATCH version"));
  if (!resolved || [...resolved].some((character) => character <= " " || character === "?" || character === "#")) {
    return fail5(precondition("Invalid release tag"));
  }
  return succeed5(resolved);
}
function assetName(template, variables) {
  return expand(template, variables).pipe(filterOrFail2((asset) => Boolean(asset) && !/[\\/]/.test(asset) && asset !== "." && asset !== "..", () => precondition("Expected an asset filename")));
}
function checksumOf(checksums, asset) {
  const digest = checksums.get(asset);
  return digest ? succeed5(digest) : fail5(precondition(`Checksum missing for ${asset}`));
}

var d1Failure = /^D1_ERROR\b/;
var rpcDomainError = TaggedStruct("DomainError", {
  problem: apiError,
  message: String4
});
function classify(error, incident) {
  if (error instanceof DomainError)
    return { problem: error.problem, message: error.message };
  if (error instanceof Error) {
    const decoded = safeDecode(rpcDomainError, error);
    if (decoded.success)
      return { problem: decoded.data.problem, message: decoded.data.message };
  }
  if (error instanceof SchemaError) {
    const problem = { code: "internal", incident };
    return { problem, message: messageOf(problem) };
  }
  if (error instanceof Error && d1Failure.test(error.message)) {
    const problem = { code: "upstream", service: "d1", retryable: true };
    return { problem, message: messageOf(problem) };
  }
  if (error instanceof SyntaxError) {
    const message = "Invalid JSON in request or configuration";
    return { problem: { code: "invalid", issues: [{ path: [], message }] }, message };
  }
  const problem = { code: "internal", incident };
  return { problem, message: messageOf(problem) };
}
function toDomainError(error) {
  if (error instanceof DomainError)
    return error;
  const { problem, message } = classify(error, crypto.randomUUID());
  const detail = error instanceof SchemaError ? error.message : error instanceof Error ? error.message : String(error);
  return new DomainError({ problem, message, detail, cause: error });
}
function fromSync(run) {
  return suspend2(() => match(try_(run), {
    onSuccess: succeed5,
    onFailure: (error) => error instanceof DomainError || error instanceof SchemaError || error instanceof SyntaxError ? fail5(toDomainError(error)) : die3(error)
  }));
}

var text = String4.check(isMinLength(1));
var stagedPath = refined(text, (path) => !path.startsWith("/") && !path.split("/").some((part) => part === ".." || part === ""), "Expected a relative path inside the staged cask");
var platform = strictStruct({ arm: text, intel: text, caveats: optional2(text) });
var shells = ["bash", "zsh", "fish", "pwsh"];
var completionDirectories = {
  bash: "etc/bash_completion.d",
  zsh: "share/zsh/site-functions",
  fish: "share/fish/vendor_completions.d",
  pwsh: "share/pwsh/completions"
};
var homebrewConfiguration = refined(strictStruct({
  token: String4.check(matchesPattern(/^[a-z0-9][a-z0-9-]*$/)),
  name: text,
  desc: text,
  homepage: text,
  url: text,
  verified: optional2(text),
  macos: optional2(platform),
  linux: optional2(platform),
  naked: optional2(strictStruct({ glob: text, name: stagedPath })),
  binaries: mutableArray(strictStruct({ path: stagedPath, target: optional2(stagedPath) })).check(isMinLength(1)),
  completions: optional2(strictStruct({
    executable: stagedPath,
    arguments: mutableArray(text).check(isMinLength(1)),
    shells: mutableArray(Literals(shells)).check(isMinLength(1))
  })),
  caveats: optional2(text)
}), (config) => config.macos !== undefined || config.linux !== undefined, "Expected macos or linux assets");
var symbolicVersion = "#{version}";
function ruby(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', "\\\"").replaceAll("#{", "\\#{")}"`;
}
function nest(lines) {
  return lines.map((line) => line ? `  ${line}` : line);
}
function block(head, body) {
  return [`${head} do`, ...nest(body), "end"];
}
function sections(...groups) {
  return groups.filter((group) => group.length).flatMap((group, index) => index ? ["", ...group] : [...group]);
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function livecheck(version, tag) {
  const [prefix = "", suffix = ""] = tag.split(version);
  const plain = suffix === "" && (prefix === "" || prefix === "v");
  return block("livecheck", [
    "url :url",
    ...plain ? [] : [`regex(/^${escapeRegex(prefix)}(\\d+(?:\\.\\d+)+)${escapeRegex(suffix)}$/i)`],
    "strategy :github_latest"
  ]);
}
function variant(config, asset, checksums, version, tag) {
  return gen3(function* () {
    const name = yield* assetName(asset, { version });
    const sha256 = yield* checksumOf(checksums, name);
    yield* https(yield* expand(config.url, { version, tag: encodeURIComponent(tag), asset: encodeURIComponent(name) }));
    const url = yield* expand(config.url, {
      version: symbolicVersion,
      tag: encodeURIComponent(tag).replaceAll(version, symbolicVersion),
      asset: encodeURIComponent(yield* assetName(asset, { version: symbolicVersion })).replaceAll(encodeURIComponent(symbolicVersion), symbolicVersion)
    });
    return [
      `version ${ruby(version)}`,
      `sha256 ${ruby(sha256)}`,
      ...config.verified ? [
        `url ${ruby(url).replaceAll(`\\${symbolicVersion}`, symbolicVersion)},`,
        `    verified: ${ruby(config.verified)}`
      ] : [`url ${ruby(url).replaceAll(`\\${symbolicVersion}`, symbolicVersion)}`]
    ];
  });
}
function generateCask(options) {
  return gen3(function* () {
    const config = yield* fromSync(() => decodeSync(homebrewConfiguration, options.configuration));
    const version = options.version;
    const tag = yield* releaseTag(version, options.tag);
    if (!tag.includes(version))
      return yield* precondition(`Release tag ${tag} does not contain ${version}`);
    const checksums = yield* parseChecksums(options.checksums);
    yield* https(config.homepage);
    const platforms = [];
    for (const [os, assets] of [["on_macos", config.macos], ["on_linux", config.linux]]) {
      if (!assets)
        continue;
      const arm = yield* variant(config, assets.arm, checksums, version, tag);
      const intel = yield* variant(config, assets.intel, checksums, version, tag);
      platforms.push(...block(os, [
        ...block("on_arm", arm),
        ...block("on_intel", intel),
        ...assets.caveats ? [`caveats ${ruby(assets.caveats)}`] : []
      ]));
    }
    const completions = config.completions;
    const call = "generate_completions_from_executable";
    const artifacts = [
      ...config.naked ? ["container type: :naked"] : [],
      ...config.binaries.map((binary) => `binary ${ruby(binary.path)}${binary.target ? `, target: ${ruby(binary.target)}` : ""}`),
      ...completions ? [
        `${call} ${[completions.executable, ...completions.arguments].map(ruby).join(", ")},`,
        `${" ".repeat(call.length + 1)}base_name: ${ruby(completions.executable.split("/").at(-1) ?? "")},`,
        `${" ".repeat(call.length + 1)}shells:    [${completions.shells.map((shell) => `:${shell}`).join(", ")}]`
      ] : []
    ];
    const steps = [
      ...config.naked ? [
        `move ${ruby(config.naked.glob)}, ${ruby(config.naked.name)}, source_glob: true`,
        `set_permissions ${ruby(config.naked.name)}, "755", recursive: false`
      ] : [],
      ...(completions?.shells ?? []).map((shell) => `mkdir_p ${ruby(completionDirectories[shell])}, base: :homebrew_prefix`),
      ...config.macos ? block("on_macos", ['run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{staged_path}}"]']) : []
    ];
    const body = sections(platforms, [`name ${ruby(config.name)}`, `desc ${ruby(config.desc)}`, `homepage ${ruby(config.homepage)}`], livecheck(version, tag), artifacts, steps.length ? block("preflight_steps", steps) : [], config.caveats ? [`caveats ${ruby(config.caveats)}`] : [], ["zap :not_required"]);
    return ["# frozen_string_literal: true", "", ...block(`cask ${ruby(config.token)}`, body), ""].join(`
`);
  });
}

import { readFile, writeFile } from "fs/promises";
import { join, resolve as resolve4 } from "path";

import { appendFileSync } from "fs";
class OutputFailure extends TaggedError2("OutputFailure") {
}
function outputEntry(name, value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) {
    return fail2(new OutputFailure({ message: `Invalid output name: ${name}` }));
  }
  const marker = `value_${crypto.randomUUID()}`;
  return succeed2(`${name}<<${marker}
${value}
${marker}
`);
}
function writeOutput(name, value) {
  return suspend2(() => writeOutputTo(process.env.GITHUB_OUTPUT, name, value));
}
function writeOutputTo(file, name, value) {
  return gen3(function* () {
    if (!file)
      return yield* new OutputFailure({ message: "GITHUB_OUTPUT is required" });
    const entry = yield* fromResult2(outputEntry(name, value));
    yield* try_3({
      try: () => appendFileSync(file, entry),
      catch: (error) => new OutputFailure({ message: error instanceof Error ? error.message : String(error) })
    });
  });
}

function terminate(child) {
  return promise2(async () => {
    if (child.exitCode !== null || child.signalCode !== null)
      return;
    child.kill("SIGTERM");
    const escalation = setTimeout(() => child.kill("SIGKILL"), 1000);
    try {
      await child.exited;
    } finally {
      clearTimeout(escalation);
    }
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function failWith(refusal) {
  return (message) => fail5(refusal(message));
}
function rejectWith(refusal) {
  return (message) => fail2(refusal(message));
}
function attemptWith(refusal) {
  return (run) => try_({ try: run, catch: (error) => refusal(errorMessage(error)) });
}
function awaitWith(refusal) {
  return (run) => tryPromise2({ try: run, catch: (error) => refusal(errorMessage(error), error) });
}

class ToolFailure extends TaggedError2("ToolFailure") {
}
function message(cause) {
  if (cause instanceof AggregateError)
    return [cause.message, ...cause.errors.map(message)].join(`
`);
  return cause instanceof Error ? cause.message : String(cause);
}
function toolFailure(cause) {
  return new ToolFailure({ message: message(cause), cause });
}
var refuse = failWith((text) => new ToolFailure({ message: text }));
function attemptPromise(run) {
  return tryPromise2({ try: run, catch: toolFailure });
}
var parse2 = parseWith(toolFailure);
function readJson(path) {
  return attemptPromise(() => Bun.file(path).json());
}

function releaseChecksums(path) {
  return attemptPromise(() => readFile(path, "utf8"));
}
function writeRendered(directory, rendered, log) {
  return gen3(function* () {
    const { name, content } = yield* rendered.pipe(mapError3((error) => new ToolFailure({ message: error.detail ?? error.message, cause: error })));
    const path = join(resolve4(directory), name);
    yield* attemptPromise(() => writeFile(path, content, { flag: "wx" }));
    log(path);
    const entry = process.env.GITHUB_OUTPUT ? writeOutput("file", path) : fromResult2(outputEntry("file", path)).pipe(flatMap3((text) => sync2(() => {
      process.stderr.write(text);
    })));
    yield* entry.pipe(mapError3((error) => new ToolFailure({ message: error.message, cause: error })));
  });
}

var generate = command("generate").description("Write a Homebrew cask for a published release").flag("config", flag.path({ type: "file" }).env().required().describe("Cask metadata JSON file")).flag("version", flag.string({ pattern: stableVersion }).env().required().describe("Stable release version, MAJOR.MINOR.PATCH")).flag("tag", flag.string().env().describe("Release tag; defaults to v followed by the version")).flag("checksums", flag.path({ type: "file" }).env().required().describe("Release SHA-256 checksums file")).flag("out", flag.path({ type: "directory", create: true }).env().required().describe("Directory for the generated cask")).action(({ flags, out }) => runPromise2(gen3(function* () {
  const configuration = yield* parse2(homebrewConfiguration, yield* readJson(flags.config));
  const checksums = yield* releaseChecksums(flags.checksums);
  yield* writeRendered(flags.out, generateCask({ configuration, version: flags.version, tag: flags.tag || undefined, checksums }).pipe(map4((content) => ({ name: `${configuration.token}.rb`, content }))), (line) => out.log(line));
})));
var app = cli("beepboop-homebrew").envPrefix("HOMEBREW_CASK_").help({ flagSpelling: "kebab" }).description("Generate a Homebrew cask from cask metadata and release checksums").default(generate, { route: true });

await app.run();
