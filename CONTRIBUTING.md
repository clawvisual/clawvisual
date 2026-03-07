# Contributing to clawvisual

Thanks for contributing to clawvisual.

## Before You Start

- Create an issue first for major changes.
- Keep changes focused and small when possible.
- Use English for code comments, commit messages, and error messages.

## Development Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.local.template .env.local
```

3. Start development server:

```bash
npm run dev
```

## Quality Checks

Run these before opening a PR:

```bash
npm run typecheck
npm run lint
```

If you changed behavior, add/update tests or evaluation cases when relevant.

## Branch and Commit

- Use clear branch names, for example: `feat/landscape-ratio` or `fix/mcp-timeout`.
- Write concise commit messages in imperative mood.
- Prefer one logical change per commit.

## Pull Request Guidelines

Include in your PR:

- What changed
- Why it changed
- Any breaking changes
- How to test locally

For UI changes, include screenshots.
For API changes, include example request/response.

## Documentation

When changing behavior, update related docs in:

- `README.md`
- `README.zh-CN.md`
- `docs/`

## Security

- Never commit real API keys, tokens, or private data.
- Report vulnerabilities privately to maintainers instead of opening public issues.
