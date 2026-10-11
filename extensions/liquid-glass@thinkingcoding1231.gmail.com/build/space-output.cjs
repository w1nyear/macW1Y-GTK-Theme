// tsc drops the blank lines between declarations. This puts one back between
// top-level functions and classes and between class members, and drops
// trailing whitespace, in place.
// Usage: node build/space-output.cjs <file or directory>...
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function isSpaced(node) {
  return ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node) ||
    (ts.isExportAssignment(node) && ts.isClassExpression(node.expression)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d =>
      d.initializer && (ts.isFunctionExpression(d.initializer) || ts.isArrowFunction(d.initializer) ||
        ts.isClassExpression(d.initializer) || containsClass(d.initializer))));
}

function containsClass(node) {
  let found = false;
  node.forEachChild(function visit(child) {
    if (found) return;
    if (ts.isClassExpression(child)) found = true;
    else child.forEachChild(visit);
  });
  return found;
}

function spaceFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const lineStarts = new Set();

  // Where a node's own text begins, including the comments attached to it.
  const lineStartOf = node => {
    const comments = ts.getLeadingCommentRanges(text, node.pos) ?? [];
    const start = comments.length ? comments[0].pos : node.getStart(source);
    return text.lastIndexOf('\n', start - 1) + 1;
  };

  const spaceSiblings = siblings => {
    for (let i = 1; i < siblings.length; i++) {
      if (!isSpaced(siblings[i]) && !isSpaced(siblings[i - 1])) continue;
      const lineStart = lineStartOf(siblings[i]);
      if (lineStart === 0) continue;
      const previousLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
      if (text.slice(previousLineStart, lineStart).trim() !== '') lineStarts.add(lineStart);
    }
  };

  spaceSiblings(source.statements);
  source.forEachChild(function visit(node) {
    if (ts.isClassLike(node)) spaceSiblings(node.members);
    node.forEachChild(visit);
  });

  let out = text;
  for (const at of [...lineStarts].sort((a, b) => b - a)) out = `${out.slice(0, at)}\n${out.slice(at)}`;
  out = out.replace(/[ \t]+$/gm, '');
  if (out !== text) fs.writeFileSync(file, out);
}

function walk(target) {
  if (fs.statSync(target).isDirectory()) {
    for (const name of fs.readdirSync(target)) walk(path.join(target, name));
  } else if (target.endsWith('.js')) {
    spaceFile(target);
  }
}

for (const target of process.argv.slice(2)) walk(target);
