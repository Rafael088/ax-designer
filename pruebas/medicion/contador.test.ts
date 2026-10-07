import { test } from "node:test";
import assert from "node:assert/strict";
import { CARACTERES_POR_TOKEN, contarTokens } from "../../src/medicion/contador.ts";

test("el Contador es caracteres / 4, el mismo factor que usa la rúbrica", () => {
  assert.equal(CARACTERES_POR_TOKEN, 4);
  assert.equal(contarTokens(0), 0);
  assert.equal(contarTokens(100), 25);
  assert.equal(contarTokens(4), 1);
  assert.equal(contarTokens(10), 3, "redondea, no trunca: 2.5 tokens son 3");
});
