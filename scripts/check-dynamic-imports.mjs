// Checks `const { a, b } = await import(<relative path>)` against the named
// exports of the target file. ESLint does not check these, and a missing name
// is just `undefined` until that code path runs.
// Usage: node scripts/check-dynamic-imports.mjs [repoRoot]   (exits 1 on problems)
import fs from 'fs';
import path from 'path';

const root = path.resolve(process.argv[2] || '.');
const SKIP_DIRS = new Set(['node_modules', '.git', 'logs', 'coverage', 'uploads', '.superpowers']);

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const skills = path.join('.claude', 'skills');
      const inClaude = rel.startsWith(`.claude${path.sep}`);
      if (inClaude && rel !== skills && !rel.startsWith(skills + path.sep)) continue;
      out.push(...listFiles(full));
    } else if (/\.m?js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const importRe = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*await\s+import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
let checked = 0;
const problems = [];

for (const file of listFiles(root)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(importRe)) {
    checked++;
    const where = `${path.relative(root, file)}:${src.slice(0, m.index).split('\n').length}`;
    const target = path.resolve(path.dirname(file), m[2]);
    if (!fs.existsSync(target)) {
      problems.push(`${where}\tcannot find ${m[2]}`);
      continue;
    }
    const t = fs.readFileSync(target, 'utf8');
    if (/^\s*export\s*\*\s*from/m.test(t)) continue; // re-exports: cannot check by text
    for (const raw of m[1].split(',')) {
      const name = raw.split(/[:=]/)[0].trim();
      if (!name) continue;
      const found =
        name === 'default'
          ? /export\s+default\b/.test(t)
          : new RegExp(`export\\s+(async\\s+)?(const|let|var|function\\*?|class)\\s+${name}\\b`).test(t) ||
            new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(t);
      if (!found) problems.push(`${where}\t'${name}' is not exported by ${m[2]}`);
    }
  }
}

for (const p of problems) console.error(p);
console.log(`dynamic imports: checked ${checked}, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
