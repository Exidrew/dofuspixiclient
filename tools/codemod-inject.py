#!/usr/bin/env python3
"""One-shot codemod: add explicit @Inject(<Type>) to every constructor
parameter of NestJS @Injectable() classes in gameserver-ts.

Rationale: Bun's runtime ignores tsconfig `emitDecoratorMetadata`, and
`--legacy-decorators` does not emit `design:paramtypes`. NestJS therefore
cannot resolve constructor params by type and hands every provider
`undefined`. Explicit @Inject decorators (whose token is the class itself)
make DI independent of decorator metadata.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "apps" / "gameserver-ts" / "src"

INJECTABLE_RE = re.compile(
    r"@Injectable\((?:[^)]*)\)\s*(?:@[\w.()]+\s*)*(?:export\s+)?class\s+(\w+)"
)
CONSTRUCTOR_RE = re.compile(r"constructor\s*\(", re.MULTILINE)
TYPE_RE = re.compile(r":\s*([A-Za-z_][\w.]*)")


def find_matching_paren(text: str, open_idx: int) -> int:
    depth = 0
    i = open_idx
    while i < len(text):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("unbalanced parens")


def split_params(params: str) -> list[str]:
    """Split a constructor param list on top-level commas, ignoring commas
    inside brackets and inside line/block comments."""
    out: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    n = len(params)
    while i < n:
        c = params[i]
        # Line comment: copy verbatim until newline.
        if c == "/" and i + 1 < n and params[i + 1] == "/":
            j = params.find("\n", i)
            if j == -1:
                j = n
            buf.append(params[i:j])
            i = j
            continue
        # Block comment: copy verbatim.
        if c == "/" and i + 1 < n and params[i + 1] == "*":
            j = params.find("*/", i + 2)
            j = n if j == -1 else j + 2
            buf.append(params[i:j])
            i = j
            continue
        if c in "([{<":
            depth += 1
        elif c in ")]}>":
            depth -= 1
        if c == "," and depth == 0:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(c)
        i += 1
    if "".join(buf).strip():
        out.append("".join(buf))
    return out


def ensure_inject_import(out: str) -> str:
    m = re.search(r'import\s*\{([^}]*)\}\s*from\s*"@nestjs/common"', out)
    if m:
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        if "Inject" not in names:
            names.append("Inject")
        # Keep original order but drop duplicates, preserving first occurrence.
        seen: list[str] = []
        for n in names:
            if n not in seen:
                seen.append(n)
        out = out[: m.start(1)] + " " + ", ".join(seen) + " " + out[m.end(1) :]
        return out
    # No @nestjs/common import: add one after the first import line.
    lines = out.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith("import "):
            lines.insert(i, 'import { Inject } from "@nestjs/common";\n')
            break
    return "".join(lines)


PARAM_LINE_RE = re.compile(
    r"^\s*(?:(?:public|private|protected|readonly|override)\s+)*"
    r"([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w.]*)\s*$"
)

# Types that must never be turned into @Inject tokens: they are DI-injected
# via an explicit @Inject(Token) already, or genuinely not injectable
# (classes instantiated by hand, plain data).
NON_INJECTABLE_TYPES = frozenset(
    {
        "string",
        "number",
        "boolean",
        "bigint",
        "symbol",
        "object",
        "unknown",
        "any",
        "void",
        "null",
        "undefined",
        "never",
        "Uint8Array",
        "Date",
        "Map",
        "Set",
        "Array",
        "Promise",
    }
)


def _is_decorated(raw: str) -> bool:
    """True if the parameter declaration already carries a decorator."""
    # Strip comment lines, then look at the first real code line.
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("//") or s.startswith("*") or s.startswith("/*"):
            continue
        return s.startswith("@")
    return False


def rewrite_params(body: str) -> tuple[str, bool]:
    params = split_params(body)
    if not params:
        return body, False
    # Whitespace between the last param and the closing paren (usually
    # "\n  " for a multiline list, or "" for a one-liner).
    trailing = body[len(body.rstrip()) :]
    new_params: list[str] = []
    changed = False
    for raw in params:
        if _is_decorated(raw):
            new_params.append(raw)
            continue
        lines = raw.splitlines(keepends=True)
        # Locate the declaration line (last non-empty, non-comment line).
        decl_idx = None
        for idx in range(len(lines) - 1, -1, -1):
            s = lines[idx].strip()
            if not s or s.startswith("//") or s.startswith("*") or s.startswith("/*"):
                continue
            decl_idx = idx
            break
        if decl_idx is None:
            new_params.append(raw)
            continue
        decl = lines[decl_idx]
        m = PARAM_LINE_RE.match(decl.rstrip("\n"))
        if not m:
            new_params.append(raw)
            continue
        type_name = m.group(2)
        # Skip primitives / non-injectable types: those are either plain
        # values or providers that already require an explicit @Inject token
        # supplied elsewhere; auto-injecting the type name would be wrong.
        if type_name in NON_INJECTABLE_TYPES:
            new_params.append(raw)
            continue
        indent = decl[: len(decl) - len(decl.lstrip())]
        lines[decl_idx] = f"{indent}@Inject({type_name}) {decl.lstrip()}"
        new_params.append("".join(lines))
        changed = True
    if not changed:
        return body, False
    # The last param may already carry the trailing whitespace (e.g. a
    # multiline list whose last entry ends with "\n  "); don't duplicate it.
    if new_params and new_params[-1] != new_params[-1].rstrip():
        trailing = ""
    return ",".join(new_params) + trailing, True


def process_file(path: Path) -> bool:
    src = path.read_text()
    if "@Injectable(" not in src:
        return False

    # Collect constructor spans belonging to @Injectable classes.
    spans: list[tuple[int, int]] = []
    for m in INJECTABLE_RE.finditer(src):
        brace = src.find("{", m.end())
        if brace == -1:
            continue
        cm = CONSTRUCTOR_RE.search(src, brace)
        if not cm:
            continue
        spans.append((cm.start(), cm.end() - 1))

    if not spans:
        return False

    out = src
    changed = False
    for _ctor_start, open_paren in sorted(spans, key=lambda s: -s[0]):
        close = find_matching_paren(out, open_paren)
        body = out[open_paren + 1 : close]
        new_body, local = rewrite_params(body)
        if not local:
            continue
        out = out[:open_paren] + "(" + new_body + ")" + out[close + 1 :]
        changed = True

    if not changed:
        return False

    out = ensure_inject_import(out)
    path.write_text(out)
    return True


def main() -> int:
    changed_files = []
    for path in sorted(ROOT.rglob("*.ts")):
        if ".spec." in path.name:
            continue
        try:
            if process_file(path):
                changed_files.append(path.relative_to(ROOT))
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {path}: {e}", file=sys.stderr)
    print(f"patched {len(changed_files)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
