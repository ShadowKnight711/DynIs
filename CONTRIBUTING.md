# Contributing to DynIs

Thanks for wanting to help. DynIs is a desktop Dynamic Island built with Tauri: a Rust core and a React/TypeScript UI. It's based on [Bloom](https://github.com/SehajveerSingh2005/bloom) by Sehajveer Singh.

## Before you start

- **Issues first.** Bugs and ideas go through the issue templates. For anything large (new features, behaviour changes, refactors, new dependencies), open an issue and agree on the approach before writing code.
- Small fixes (typos, docs, crash fixes with an obvious cause) can go straight to a pull request.

## Setup

Requirements: [Bun](https://bun.sh) 1.4+, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform (Linux packages: see [docs/LINUX-BUILD.md](docs/LINUX-BUILD.md)).

```bash
bun install
bun run tauri dev
```

| Command | What it does |
| --- | --- |
| `bun run build` | Typecheck and build the frontend |
| `bun test` | Frontend unit tests |
| `cargo test --locked` (in `src-tauri`) | Rust unit tests |
| `bun run tauri build` | Build an installer |
| `bun scripts/build-extension.mjs` | Rebuild the Firefox copy of the extension |
| `bun run bump <ver>` | Bump the version in every manifest |

## Making changes

- Branch from `main` and keep each pull request to one change. Match the existing style; don't add dependencies unless they're really needed.
- Commits follow conventional commits (`feat:`, `fix:`, `docs:` …).
- Platform code lives in `src-tauri/src` (Windows), `src-tauri/src/linux` and `src-tauri/src/mac`; pure parsing goes in `linuxparse.rs` / `macparse.rs` so it's tested everywhere.
- Run both test suites before opening a PR, and describe how you tested on a real desktop.

## License

DynIs is licensed under GPL-3.0. By contributing, you agree that your contributions are licensed under the same terms.
