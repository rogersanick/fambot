import { describe, expect, test } from "bun:test";
import { splitListItems } from "./list-items";

describe("splitListItems", () => {
  test("keeps a single line", () => {
    expect(splitListItems("milk")).toEqual(["milk"]);
  });

  test("splits pasted lines and strips bullets", () => {
    expect(splitListItems("- milk\n* eggs\n1. bread\n2) butter\n• coffee\n")).toEqual([
      "milk",
      "eggs",
      "bread",
      "butter",
      "coffee",
    ]);
  });

  test("drops blank lines", () => {
    expect(splitListItems("milk\n\n  \neggs")).toEqual(["milk", "eggs"]);
  });
});
