# Contributing

Thanks for your interest. This plugin is deliberately small and opinionated, and I'd like to keep it that way. A little coordination up front saves everyone time.

## Before you start

- **Open an issue before writing code for anything beyond a small fix.** Describe the problem you're solving, not only the solution.
- **One issue per feature.** Please don't split an idea into a series of linked issues. Start with one, and if it grows, we'll split it together.
- **Big or open-ended ideas** belong in Discussions first, not in issues.
- I may say no to good ideas. The answer is usually about scope, not quality.

## Design principle

This plugin exists to help learners do the thinking. The path provides **structure, prompts and feedback**. The learner generates the understanding. A change fits when it moves work from the system to the learner (for example, asking a question instead of stating an answer). A change usually doesn't fit when it has the system produce conclusions the learner could have produced themselves.

This doesn't mean leaving learners alone with a blank page. Novices need guidance, worked examples and feedback. The aim is guided generation that fades as the learner gains skill. The reasoning, with references to the learning science, is in [FRAMEWORK.md](FRAMEWORK.md).

## Branches

- `main` is stable and is what people install.
- `experimental` is where new, unsettled features land first. Open PRs against `experimental` unless the maintainer says otherwise.
- Features on `experimental` should sit behind a setting, default off, until they are promoted.

## Pull requests

- Keep PRs small and focused on one issue. Use `Refs #n` rather than `Closes #n` unless the PR fully resolves the issue.
- Draft PRs are welcome for early feedback.
- Run `npm test`, `npm run typecheck` and `npm run build` before asking for review, and say in the PR what you ran.
- **Show evidence of the change.** For anything a learner or user can see, include screenshots or a short screen recording (before and after where it helps). For behaviour changes, describe the outcome you observed, such as the steps you took and what happened. For agent or prompt changes, include a short example of the resulting conversation. Evidence helps me review faster and is often more convincing than test output alone.
- Use the public plugin SDK only. No private host imports, and no writes to host-owned data.

## Scope

Not planned: scheduling or study calendars, gamification, automatic changes to a learner's path without their approval, and claims about a learner's mastery based on indirect evidence.
