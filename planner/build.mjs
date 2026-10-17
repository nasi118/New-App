// Inline planner/index.html and its local CSS/JS into one self-contained file.
//
//   node planner/build.mjs              -> dist/tax-master.html
//   node planner/build.mjs --artifact   -> also dist/tax-master.artifact.html
//                                          (body fragment for claude.ai Artifact publishing)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (rel) => readFileSync(join(here, rel), "utf8");

let html = read("index.html");
html = html.replace(/<link rel="stylesheet" href="(src\/[^"]+)">/g, (_, href) => "<style>\n" + read(href) + "\n</style>");
html = html.replace(/<script src="(src\/[^"]+)"><\/script>/g, (_, src) => "<script>\n" + read(src).replace(/<\/script/gi, "<\\/script") + "\n</script>");
if (/(href|src)="src\//.test(html)) throw new Error("A local asset was not inlined");

mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", "tax-master.html");
writeFileSync(out, html);
console.log("wrote", out, Math.round(Buffer.byteLength(html) / 1024), "KB");

if (process.argv.includes("--artifact")) {
  // The Artifact publisher supplies doctype/html/head/body; keep title, fonts, styles, body and scripts.
  const head = html.slice(html.indexOf("<head>") + 6, html.indexOf("</head>"));
  // Report templates contain a literal </body> inside JavaScript strings.
  // The document's closing tag is the final one, after every inlined module.
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  const keep = head.split("\n").filter((l) => /<title>|fonts\.g|<style>|<\/style>/.test(l) || !/^<(meta|link)/.test(l)).join("\n");
  const frag = join(root, "dist", "tax-master.artifact.html");
  writeFileSync(frag, keep + "\n" + body);
  console.log("wrote", frag);
}
