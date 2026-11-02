import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize } from "./canonicalize.ts";

// Los vectores son los del RFC 8785.
const sample = String.raw`{
  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
  "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
  "literals": [null, true, false]
}`;

test("RFC 8785 §3.2.3: muestra de §3.2.2 canonicalizada", () => {
  assert.equal(
    canonicalize(JSON.parse(sample)),
    String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
  );
});

test("RFC 8785 §3.2.4: bytes UTF-8 de la muestra", () => {
  const expected =
    "7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72 " +
    "75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a " +
    "5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31 " +
    "65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37 " +
    "5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30 " +
    "30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d";
  const bytes = Buffer.from(canonicalize(JSON.parse(sample)), "utf8");
  assert.equal(bytes.toString("hex"), expected.replaceAll(" ", ""));
});

test("RFC 8785 §3.2.3: orden de propiedades por unidades UTF-16", () => {
  const input = JSON.parse(String.raw`{
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis"
  }`);
  // Object.values reordenaría la clave "1" (índice entero): se lee el orden del texto canónico.
  const sorted = [...canonicalize(input).matchAll(/:"([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(sorted, [
    "Carriage Return",
    "One",
    "Control",
    "Latin Small Letter O With Diaeresis",
    "Euro Sign",
    "Emoji: Grinning Face",
    "Hebrew Letter Dalet With Dagesh",
  ]);
});

const double = (hex: string) => Buffer.from(hex, "hex").readDoubleBE(0);

// RFC 8785 Apéndice B, tabla 1: [IEEE 754 en hex, serialización JSON].
const appendixB: [string, string][] = [
  ["0000000000000000", "0"],
  ["8000000000000000", "0"],
  ["0000000000000001", "5e-324"],
  ["8000000000000001", "-5e-324"],
  ["7fefffffffffffff", "1.7976931348623157e+308"],
  ["ffefffffffffffff", "-1.7976931348623157e+308"],
  ["4340000000000000", "9007199254740992"],
  ["c340000000000000", "-9007199254740992"],
  ["4430000000000000", "295147905179352830000"],
  ["44b52d02c7e14af5", "9.999999999999997e+22"],
  ["44b52d02c7e14af6", "1e+23"],
  ["44b52d02c7e14af7", "1.0000000000000001e+23"],
  ["444b1ae4d6e2ef4e", "999999999999999700000"],
  ["444b1ae4d6e2ef4f", "999999999999999900000"],
  ["444b1ae4d6e2ef50", "1e+21"],
  ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
  ["3eb0c6f7a0b5ed8d", "0.000001"],
  ["41b3de4355555553", "333333333.3333332"],
  ["41b3de4355555554", "333333333.33333325"],
  ["41b3de4355555555", "333333333.3333333"],
  ["41b3de4355555556", "333333333.3333334"],
  ["41b3de4355555557", "333333333.33333343"],
  ["becbf647612f3696", "-0.0000033333333333333333"],
  ["43143ff3c1cb0959", "1424953923781206.2"],
];

for (const [hex, json] of appendixB) {
  test(`RFC 8785 Apéndice B: ${hex} -> ${json}`, () => {
    assert.equal(canonicalize(double(hex)), json);
  });
}

test("RFC 8785 Apéndice B y §3.2.2.3: NaN e Infinity lanzan error", () => {
  assert.throws(() => canonicalize(double("7fffffffffffffff")), TypeError);
  assert.throws(() => canonicalize(double("7ff0000000000000")), TypeError);
});

test("RFC 8785 §3.2.2.2: un sustituto suelto (U+DEAD) lanza error", () => {
  const lone = String.fromCharCode(0xdead);
  assert.throws(() => canonicalize(lone), TypeError);
  assert.throws(() => canonicalize({ [lone]: 1 }), TypeError);
});
