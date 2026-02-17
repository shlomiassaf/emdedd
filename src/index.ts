#!/usr/bin/env node
// embed-sync — Live-links TypeScript/C# symbols into Markdown documentation.
// Usage: npx emdedd "docs/GLOB,specs/GLOB"
// Markers: <!-- ts-embed: path#Symbol --> ... <!-- /ts-embed -->
//          <!-- cs-embed: path#Symbol --> ... <!-- /cs-embed -->

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { glob } from "glob";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmbedDirective {
  kind: "ts" | "cs";
  sourcePath: string; // raw path from marker
  symbolName: string;
  lineNumber: number; // 1-based line in the markdown file
  startIndex: number; // char offset of marker start
  endIndex: number; // char offset of closing marker end (or -1 if missing)
}

interface EmbedResult {
  directive: EmbedDirective;
  code: string | null;
  error: string | null;
}

interface ErrorReport {
  mdFile: string;
  lineNumber: number;
  reason: string;
  sourcePath: string;
  symbolName: string;
}

// ─── Markdown Scanning ──────────────────────────────────────────────────────

function findDirectives(content: string): EmbedDirective[] {
  const directives: EmbedDirective[] = [];
  let match: RegExpExecArray | null;

  // First pass: collect all open markers
  const openMarkers: { index: number; length: number; kind: "ts" | "cs"; sourcePath: string; symbolName: string }[] = [];
  const markerRe = /<!--\s*(ts-embed|cs-embed)\s*:\s*([^#]+)#(\S+?)\s*-->/g;
  while ((match = markerRe.exec(content)) !== null) {
    openMarkers.push({
      index: match.index,
      length: match[0].length,
      kind: match[1].startsWith("ts") ? "ts" : "cs",
      sourcePath: match[2].trim(),
      symbolName: match[3].trim(),
    });
  }

  // Second pass: for each marker, find its close tag only within the window
  // between this marker and the next open marker
  for (let i = 0; i < openMarkers.length; i++) {
    const m = openMarkers[i];
    const searchStart = m.index + m.length;
    const searchEnd = i + 1 < openMarkers.length ? openMarkers[i + 1].index : content.length;
    const searchRegion = content.substring(searchStart, searchEnd);

    const closeTag = `<!-- /${m.kind}-embed -->`;
    const closeRelIdx = searchRegion.indexOf(closeTag);
    const endIndex =
      closeRelIdx !== -1
        ? searchStart + closeRelIdx + closeTag.length
        : -1;

    const lineNumber = content.substring(0, m.index).split("\n").length;

    directives.push({
      kind: m.kind,
      sourcePath: m.sourcePath,
      symbolName: m.symbolName,
      lineNumber,
      startIndex: m.index,
      endIndex,
    });
  }

  return directives;
}

// ─── TypeScript Symbol Extraction ───────────────────────────────────────────

const tsFileCache = new Map<string, ts.SourceFile>();

function getTsSourceFile(filePath: string): ts.SourceFile | null {
  if (tsFileCache.has(filePath)) return tsFileCache.get(filePath)!;
  if (!fs.existsSync(filePath)) return null;

  const source = fs.readFileSync(filePath, "utf-8");
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  tsFileCache.set(filePath, sf);
  return sf;
}

function extractTsSymbol(filePath: string, symbolName: string): string | null {
  const sf = getTsSourceFile(filePath);
  if (!sf) return null;

  const source = sf.getFullText();

  // Walk top-level statements looking for the symbol
  for (const stmt of sf.statements) {
    const name = getNodeDeclaredName(stmt);
    if (name === symbolName) {
      return extractNodeText(source, stmt);
    }

    // Check inside namespaces/modules
    if (
      ts.isModuleDeclaration(stmt) &&
      ts.isIdentifier(stmt.name) &&
      stmt.body &&
      ts.isModuleBlock(stmt.body)
    ) {
      // Support Namespace.Symbol via dot notation
      if (symbolName.startsWith(stmt.name.text + ".")) {
        const innerName = symbolName.slice(stmt.name.text.length + 1);
        for (const inner of stmt.body.statements) {
          if (getNodeDeclaredName(inner) === innerName) {
            return extractNodeText(source, inner);
          }
        }
      }
    }
  }

  return null;
}

function getNodeDeclaredName(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name?.text ?? null;
  }
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}

function extractNodeText(source: string, node: ts.Node): string {
  // Include leading JSDoc/comments
  const fullStart = node.getFullStart();
  const start = node.getStart();
  const leading = source.substring(fullStart, start);

  // Only keep comment lines (JSDoc, //), skip blank lines before them
  const commentLines = leading
    .split("\n")
    .filter((l) => l.trim().startsWith("*") || l.trim().startsWith("/") || l.trim().startsWith("/**"));
  const commentBlock =
    commentLines.length > 0
      ? leading.trimStart()
      : "";

  const body = source.substring(start, node.getEnd());
  return (commentBlock ? commentBlock + "\n" : "") + body.trimEnd();
}

// ─── C# Symbol Extraction (regex-based) ─────────────────────────────────────

const csFileCache = new Map<string, string>();

function getCsSource(filePath: string): string | null {
  if (csFileCache.has(filePath)) return csFileCache.get(filePath)!;
  if (!fs.existsSync(filePath)) return null;
  const source = fs.readFileSync(filePath, "utf-8");
  csFileCache.set(filePath, source);
  return source;
}

function extractCsSymbol(filePath: string, symbolName: string): string | null {
  const source = getCsSource(filePath);
  if (source === null) return null;

  // Match class, interface, struct, enum, record, or method declarations
  // We look for the symbol name preceded by common C# declaration keywords
  const declPattern = new RegExp(
    // Optional XML doc comments + attributes before the declaration
    `((?:\\s*///[^\\n]*\\n)*` +          // /// XML doc lines
    `(?:\\s*\\[[^\\]]*\\]\\s*\\n)*)` +   // [Attribute] lines
    `([ \\t]*` +                          // indentation
    `(?:(?:public|private|protected|internal|static|abstract|sealed|partial|async|virtual|override|readonly|new)\\s+)*` +
    `(?:class|interface|struct|enum|record|delegate)\\s+` +
    `${escapeRegex(symbolName)}` +        // the symbol name
    `[^{;]*` +                            // generics, base types, constraints
    `)`,
    "m"
  );

  const match = declPattern.exec(source);
  if (!match) {
    // Try method/property match
    return extractCsMethod(source, symbolName);
  }

  const preamble = match[1] || "";
  const declStart = match.index + preamble.length - preamble.trimStart().length;

  // Check whether this is a semicolon-terminated decl (record, delegate)
  // or a brace-delimited decl (class, interface, enum)
  const afterMatch = match.index + match[0].length;
  const braceStart = source.indexOf("{", afterMatch);
  const semiStart = source.indexOf(";", afterMatch);

  // If semicolon comes before brace (or no brace), it's a simple decl
  if (semiStart !== -1 && (braceStart === -1 || semiStart < braceStart)) {
    return source.substring(declStart, semiStart + 1).trimEnd();
  }

  if (braceStart === -1) return null;

  const endIdx = findMatchingBrace(source, braceStart);
  if (endIdx === -1) return null;

  return source.substring(declStart, endIdx + 1).trimEnd();
}

function extractCsMethod(source: string, symbolName: string): string | null {
  const methodPattern = new RegExp(
    `((?:\\s*///[^\\n]*\\n)*)` +
    `([ \\t]*` +
    `(?:(?:public|private|protected|internal|static|abstract|sealed|partial|async|virtual|override|new)\\s+)*` +
    `[\\w<>\\[\\],\\s\\.\\?]+\\s+` + // return type
    `${escapeRegex(symbolName)}` +
    `\\s*(?:<[^>]*>)?` +              // optional generic params
    `\\s*\\([^)]*\\)` +               // parameter list
    `[^{;]*)`,                         // constraints etc
    "m"
  );

  const match = methodPattern.exec(source);
  if (!match) return null;

  const preamble = match[1] || "";
  const declStart =
    match.index + preamble.length - preamble.trimStart().length;

  const braceStart = source.indexOf("{", match.index + match[0].length);
  if (braceStart === -1) {
    // Expression-bodied or abstract
    const semi = source.indexOf(";", match.index + match[0].length);
    if (semi === -1) return null;
    return source.substring(declStart, semi + 1).trimEnd();
  }

  const endIdx = findMatchingBrace(source, braceStart);
  if (endIdx === -1) return null;

  return source.substring(declStart, endIdx + 1).trimEnd();
}

function findMatchingBrace(source: string, openPos: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let inLineComment = false;
  let inBlockComment = false;
  let inVerbatim = false;

  for (let i = openPos; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inVerbatim) {
      if (ch === '"' && next === '"') {
        i++; // escaped quote in verbatim
        continue;
      }
      if (ch === '"') inVerbatim = false;
      continue;
    }
    if (inString) {
      if (ch === "\\" && stringChar !== "`") {
        i++; // skip escaped char
        continue;
      }
      if (ch === stringChar) inString = false;
      continue;
    }

    // Not in any string/comment
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "@" && next === '"') {
      inVerbatim = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Resolve & Replace ──────────────────────────────────────────────────────

function resolveEmbed(
  directive: EmbedDirective,
  mdFilePath: string
): EmbedResult {
  const mdDir = path.dirname(mdFilePath);
  const absSource = path.resolve(mdDir, directive.sourcePath);

  if (!fs.existsSync(absSource)) {
    return {
      directive,
      code: null,
      error: `File not found: ${absSource}`,
    };
  }

  const extractor =
    directive.kind === "ts" ? extractTsSymbol : extractCsSymbol;
  const code = extractor(absSource, directive.symbolName);

  if (code === null) {
    return {
      directive,
      code: null,
      error: `Symbol '${directive.symbolName}' not found in ${absSource}`,
    };
  }

  return { directive, code, error: null };
}

function applyEmbeds(content: string, mdFilePath: string): {
  output: string;
  errors: ErrorReport[];
} {
  const directives = findDirectives(content);
  if (directives.length === 0) return { output: content, errors: [] };

  const errors: ErrorReport[] = [];

  // Process in REVERSE order so character offsets remain valid
  const sorted = [...directives].sort((a, b) => b.startIndex - a.startIndex);

  let result = content;

  for (const dir of sorted) {
    const resolved = resolveEmbed(dir, mdFilePath);
    const lang = dir.kind === "ts" ? "ts" : "csharp";
    const tag = `${dir.kind}-embed`;

    if (resolved.error) {
      errors.push({
        mdFile: path.resolve(mdFilePath),
        lineNumber: dir.lineNumber,
        reason: resolved.error,
        sourcePath: dir.sourcePath,
        symbolName: dir.symbolName,
      });
      continue;
    }

    const codeBlock = [
      "```" + lang,
      `// @generated by embed-sync — do not edit`,
      resolved.code!,
      "```",
      `<!-- /${tag} -->`,
    ].join("\n");

    // The open marker spans from startIndex to end of the match
    const openMarkerRe = new RegExp(
      `<!--\\s*${escapeRegex(tag)}\\s*:\\s*${escapeRegex(dir.sourcePath)}#${escapeRegex(dir.symbolName)}\\s*-->`
    );
    const openMatch = openMarkerRe.exec(result.substring(dir.startIndex));
    if (!openMatch) continue;

    const absOpenEnd = dir.startIndex + openMatch.index + openMatch[0].length;

    let replaceEnd: number;

    if (dir.endIndex !== -1) {
      // Closing marker was found during initial scan — use it
      replaceEnd = dir.endIndex;
    } else {
      // No closing marker — insert right after the open marker
      replaceEnd = absOpenEnd;
    }

    const before = result.substring(0, absOpenEnd);
    const after = result.substring(replaceEnd);
    const insertion = "\n" + codeBlock;

    result = before + insertion + after;
  }

  return { output: result, errors };
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

async function main() {
  const patterns = process.argv[2];
  if (!patterns) {
    console.error(
      "Usage: npx emdedd <comma-separated-globs>\n" +
        '  e.g. npx emdedd "docs/**/*.md,specs/*.md"'
    );
    process.exit(1);
  }

  const globs = patterns.split(",").map((g: string) => g.trim());
  const allFiles = new Set<string>();

  for (const g of globs) {
    const matches = await glob(g, { nodir: true, absolute: true });
    matches.forEach((f: string) => allFiles.add(f));
  }

  if (allFiles.size === 0) {
    console.warn("⚠  No files matched the given patterns.");
    process.exit(0);
  }

  const allErrors: ErrorReport[] = [];
  let totalDirectives = 0;
  let totalUpdated = 0;

  for (const mdFile of allFiles) {
    const content = fs.readFileSync(mdFile, "utf-8");
    const directives = findDirectives(content);
    if (directives.length === 0) continue;

    totalDirectives += directives.length;
    console.log(`📄 ${path.relative(process.cwd(), mdFile)} — ${directives.length} embed(s)`);

    const { output, errors } = applyEmbeds(content, mdFile);
    allErrors.push(...errors);

    if (output !== content) {
      fs.writeFileSync(mdFile, output, "utf-8");
      totalUpdated++;
      console.log(`   ✅ Updated`);
    } else if (errors.length === 0) {
      console.log(`   — No changes`);
    }
  }

  // ─── Error Report ──────────────────────────────────────────────────────
  if (allErrors.length > 0) {
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║  EMBED ERRORS                                        ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    for (const err of allErrors) {
      console.error(`  ❌ ${err.reason}`);
      console.error(`     Source: ${err.sourcePath}#${err.symbolName}`);
      console.error(`     Location: ${err.mdFile}:${err.lineNumber}`);
      console.error("");
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────
  console.log("─".repeat(56));
  console.log(
    `📊 ${totalDirectives} directive(s) across ${allFiles.size} file(s) | ` +
      `${totalUpdated} updated | ${allErrors.length} error(s)`
  );

  if (allErrors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
