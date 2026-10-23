import { createRequire } from "node:module";
import { initial, project } from "../experience-runtime/engine.mjs";
import { validateSpec, components } from "../experience-runtime/semantics.mjs";
const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { parse } = require("@babel/parser");
export function compile(input) {
  let location;
  const fail = (code, node) => {
    location = node?.loc?.start;
    throw Error(code);
  };
  try {
    if (input.sdk_version !== "experience-sdk.v1") fail("SDK_VERSION");
    if (
      !Array.isArray(input.files) ||
      input.files.length !== 1 ||
      input.files[0].path !== "experience.tsx"
    )
      fail("FILES");
    const source = input.files[0].content;
    if (typeof source !== "string" || Buffer.byteLength(source) > 131072)
      fail("SOURCE_SIZE");
    const ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
    let count = 0;
    const scan = (v, d = 0) => {
      if (d > 90 || ++count > 50000) fail("AST_LIMIT", v);
      if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v))
          if (
            !["loc", "start", "end", "extra", "comments", "tokens"].includes(k)
          ) {
            if (Array.isArray(x)) x.forEach((a) => scan(a, d + 1));
            else if (x && typeof x === "object") scan(x, d + 1);
          }
    };
    scan(ast);
    const body = ast.program.body;
    if (ast.program.directives.length || body.length !== 2)
      fail("TOP_LEVEL", ast.program);
    const imp = body[0],
      exp = body[1],
      names = new Set();
    if (
      imp.type !== "ImportDeclaration" ||
      imp.source.value !== "@cardspace/experience" ||
      imp.importKind === "type" ||
      !imp.specifiers.length
    )
      fail("IMPORT", imp);
    for (const s of imp.specifiers) {
      if (
        s.type !== "ImportSpecifier" ||
        s.importKind === "type" ||
        s.imported.name !== s.local.name ||
        !["defineExperience", ...components].includes(s.local.name) ||
        names.has(s.local.name)
      )
        fail("IMPORT", s);
      names.add(s.local.name);
    }
    if (
      exp.type !== "ExportDefaultDeclaration" ||
      exp.declaration.type !== "CallExpression" ||
      exp.declaration.callee.type !== "Identifier" ||
      exp.declaration.callee.name !== "defineExperience" ||
      !names.has("defineExperience") ||
      exp.declaration.arguments.length !== 1 ||
      exp.declaration.typeParameters
    )
      fail("ENTRY", exp);
    const read = (n, depth = 0) => {
      if (!n || depth > 40) fail("VALUE_DEPTH", n);
      if (
        ["StringLiteral", "NumericLiteral", "BooleanLiteral"].includes(n.type)
      )
        return n.value;
      if (n.type === "NullLiteral") return null;
      if (
        n.type === "UnaryExpression" &&
        n.operator === "-" &&
        n.argument.type === "NumericLiteral"
      )
        return -n.argument.value;
      if (n.type === "ArrayExpression")
        return n.elements.map((v) => read(v, depth + 1));
      if (n.type === "ObjectExpression") {
        const o = Object.create(null);
        for (const p of n.properties) {
          if (
            p.type !== "ObjectProperty" ||
            p.computed ||
            p.shorthand ||
            !["Identifier", "StringLiteral"].includes(p.key.type)
          )
            fail("PROPERTY", p);
          const key = p.key.name ?? p.key.value;
          if (
            ["__proto__", "constructor", "prototype"].includes(key) ||
            Object.hasOwn(o, key)
          )
            fail("PROPERTY", p);
          o[key] = read(p.value, depth + 1);
        }
        return o;
      }
      if (n.type === "JSXElement") {
        const tag = n.openingElement.name;
        if (
          tag.type !== "JSXIdentifier" ||
          !components.includes(tag.name) ||
          !names.has(tag.name)
        )
          fail("COMPONENT", n);
        const o = { kind: tag.name };
        for (const p of n.openingElement.attributes) {
          if (
            p.type !== "JSXAttribute" ||
            p.name.type !== "JSXIdentifier" ||
            [
              "kind",
              "children",
              "__proto__",
              "constructor",
              "prototype",
            ].includes(p.name.name) ||
            Object.hasOwn(o, p.name.name)
          )
            fail("JSX_PROP", p);
          o[p.name.name] =
            p.value?.type === "JSXExpressionContainer"
              ? read(p.value.expression, depth + 1)
              : read(p.value, depth + 1);
        }
        const children = n.children.filter(
          (c) => c.type !== "JSXText" || c.value.trim(),
        );
        if (children.length)
          o.children = children.map((c) => {
            if (c.type !== "JSXElement") fail("JSX_CHILD", c);
            return read(c, depth + 1);
          });
        return o;
      }
      fail("UNSUPPORTED_AST", n);
    };
    const spec = read(exp.declaration.arguments[0]);
    validateSpec(spec, input.source_ref_allowlist || []);
    project(spec, initial(spec));
    return { spec, diagnostics: [] };
  } catch (e) {
    return {
      spec: null,
      diagnostics: [
        {
          code: String(e.message).slice(0, 300),
          line: location?.line || e.loc?.line || 1,
          column: location?.column || e.loc?.column || 0,
        },
      ],
    };
  }
}
