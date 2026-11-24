import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { runCli } from "../lib/cli.js";

const reference = JSON.parse(
  readFileSync(
    new URL("../docs/service-reference.json", import.meta.url),
    "utf8",
  ),
);

test("service and parameter help match the standard descriptions", async () => {
  let program;
  const original = Command.prototype.parseAsync;
  Command.prototype.parseAsync = async function () {
    program = this;
    return this;
  };
  try {
    await runCli([]);
  } finally {
    Command.prototype.parseAsync = original;
  }
  for (const service of reference.services) {
    const command = program.commands.find(
      (entry) => entry.name() === service.name,
    );
    assert.equal(command.description(), service.description, service.name);
    const expected = Object.fromEntries(
      service.parameters.map((key) => [
        reference.parameters[key].name,
        reference.parameters[key].description,
      ]),
    );
    const actual = Object.fromEntries([
      ...command.registeredArguments.map((arg) => [
        arg.name(),
        arg.description,
      ]),
      ...command.options
        .filter(
          (option) =>
            !["help", "token", "json"].includes(option.attributeName()) &&
            // A --no-x flag paired with --x documents only the negation.
            !(
              option.negate &&
              command.options.some(
                (other) =>
                  !other.negate &&
                  other.attributeName() === option.attributeName(),
              )
            ),
        )
        .map((option) => [option.attributeName(), option.description]),
    ]);
    assert.deepEqual(actual, expected, service.name);
    assert.equal(
      command.options.find((option) => option.attributeName() === "token")
        .description,
      reference.parameters.token.description,
    );
  }
});
