#!/usr/bin/env python3
"""Report @Injectable() classes whose constructor still has a typed parameter
without an explicit @Inject decorator (Bun cannot resolve those).

A parameter is considered decorated if its declaration is preceded by an
@Inject(...) decorator (possibly on the same or a previous line)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "apps" / "gameserver-ts" / "src"
INJECTABLE_RE = re.compile(
    r"@Injectable\((?:[^)]*)\)\s*(?:@[\w.()]+\s*)*(?:export\s+)?class\s+(\w+)"
)
CONSTRUCTOR_RE = re.compile(r"constructor\s*\(", re.MULTILINE)


def find_matching_paren(text: str, open_idx: int) -> int:
    depth = 0
    i = open_idx
    while i < len(text):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError


def split_params(params: str) -> list[str]:
    out: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    n = len(params)
    while i < n:
        c = params[i]
        if c == "/" and i + 1 < n and params[i + 1] == "/":
            j = params.find("\n", i)
            j = n if j == -1 else j
            buf.append(params[i:j])
            i = j
            continue
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


PARAM_LINE_RE = re.compile(
    r"^\s*(?:(?:public|private|protected|readonly|override)\s+)*"
    r"[A-Za-z_]\w*\s*:\s*[A-Za-z_]"
)


def main() -> int:
    problems: list[str] = []
    for path in sorted(ROOT.rglob("*.ts")):
        if ".spec." in path.name:
            continue
        src = path.read_text()
        for m in INJECTABLE_RE.finditer(src):
            cls = m.group(1)
            brace = src.find("{", m.end())
            cm = CONSTRUCTOR_RE.search(src, brace)
            if not cm:
                continue
            close = find_matching_paren(src, cm.end() - 1)
            body = src[cm.end() : close]
            for raw in split_params(body):
                code_lines = [
                    ln.strip()
                    for ln in raw.splitlines()
                    if ln.strip()
                    and not ln.strip().startswith("//")
                    and not ln.strip().startswith("*")
                    and not ln.strip().startswith("/*")
                ]
                if not code_lines:
                    continue
                has_decorator = any(ln.startswith("@") for ln in code_lines)
                # The declaration is the last non-decorator code line.
                decl_lines = [ln for ln in code_lines if not ln.startswith("@")]
                if not decl_lines:
                    continue
                if PARAM_LINE_RE.match(decl_lines[-1]) and not has_decorator:
                    problems.append(
                        f"{path.relative_to(ROOT)} :: {cls} :: {decl_lines[-1]}"
                    )
    for p in problems:
        print(p)
    print(f"\n{len(problems)} un-injected typed param(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
