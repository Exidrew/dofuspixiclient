#!/usr/bin/env python3
"""For every @Inject(Token) found in gameserver-ts, check that Token is
actually provided somewhere (a `@Injectable()` class, a `provide: Token`
entry, or a well-known Nest token)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "apps" / "gameserver-ts" / "src"

INJECT_RE = re.compile(r"@Inject\(([^)]+)\)")
PROVIDE_RE = re.compile(r"provide:\s*([A-Za-z_][\w.]*)")
INJECTABLE_CLASS_RE = re.compile(
    r"@Injectable\((?:[^)]*)\)\s*(?:@[\w.()]+\s*)*(?:export\s+)?class\s+(\w+)"
)
KNOWN_NEST = {
    "ConfigService",
    "EventEmitter2",
    "DiscoveryService",
    "MetadataScanner",
    "Reflector",
    "TransactionHost",
    "ModuleRef",
    "HttpService",
    "REQUEST",
}


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def main() -> int:
    files = [p for p in ROOT.rglob("*.ts") if ".spec." not in p.name]
    sources = {p: strip_comments(p.read_text()) for p in files}

    provided: set[str] = set()
    for src in sources.values():
        provided |= set(PROVIDE_RE.findall(src))
        provided |= set(INJECTABLE_CLASS_RE.findall(src))

    tokens_used: dict[str, list[str]] = {}
    for p, src in sources.items():
        for t in INJECT_RE.findall(src):
            t = t.strip()
            # skip string / symbol literal tokens
            if t.startswith('"') or t.startswith("'") or "Symbol" in t:
                continue
            tokens_used.setdefault(t, []).append(str(p.relative_to(ROOT)))

    unresolved = {
        t: locs
        for t, locs in tokens_used.items()
        if t not in provided and t not in KNOWN_NEST
    }

    print(f"tokens used: {len(tokens_used)}")
    print(f"provided classes/tokens: {len(provided)}")
    if unresolved:
        print("\nUNRESOLVED @Inject tokens (no provider found):")
        for t, locs in sorted(unresolved.items()):
            print(f"  {t}: {len(locs)} use(s), e.g. {locs[0]}")
    else:
        print("\nAll @Inject tokens resolve to a provider. OK")
    return 1 if unresolved else 0


if __name__ == "__main__":
    raise SystemExit(main())
