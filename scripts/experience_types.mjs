import fs from "node:fs";
const s = JSON.parse(
  fs.readFileSync("packages/experience-contracts/experience.v1.schema.json"),
);
const type = (v) => {
  if (v.$ref) return v.$ref.split("/").at(-1);
  if ("const" in v) return JSON.stringify(v.const);
  if (v.enum) return v.enum.map(JSON.stringify).join(" | ");
  if (v.oneOf) return v.oneOf.map((x) => "(" + type(x) + ")").join(" | ");
  if (v.type === "array") return `Array<${type(v.items)}>`;
  if (v.type === "object") {
    const entries = Object.entries(v.properties || {});
    if (!entries.length && typeof v.additionalProperties === "object")
      return `Record<string,${type(v.additionalProperties)}>`;
    return (
      "{" +
      entries
        .map(
          ([k, x]) =>
            `${JSON.stringify(k)}${v.required?.includes(k) ? "" : "?"}:${type(x)}`,
        )
        .join(";") +
      "}"
    );
  }
  return (
    {
      number: "number",
      integer: "number",
      string: "string",
      boolean: "boolean",
      null: "null",
    }[v.type] || "unknown"
  );
};
fs.writeFileSync(
  "packages/experience-contracts/spec.ts",
  "// Generated from experience.v1.schema.json by scripts/experience_types.mjs.\n" +
    Object.entries(s.$defs)
      .map(([k, v]) => `export type ${k}=${type(v)};`)
      .join("\n") +
    `\nexport type ExperienceSpec=${type(s)};\n`,
);
