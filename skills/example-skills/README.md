# Example Skills for 9 Router CLI

These example skills demonstrate the skill format for the 9 Router CLI.

## Available Skills

| Skill | ID | Command | Description |
|---|---|---|---|
| Summarizer | `example-summarize` | `/skills execute example-summarize` | Summarizes long text into bullet points |
| Code Reviewer | `example-code-review` | `/skills execute example-code-review` | Reviews code for bugs and style issues |
| Translator | `example-translate` | `/skills execute example-translate` | Translates text between languages |

## Installing

In the 9 Router CLI:

```
/skills install skills/example-skills/summarize.skill
/skills install skills/example-skills/code-review.skill
/skills install skills/example-skills/translate.skill
```

Then list installed skills:

```
/skills list
```

## Auto-Discovery

Skills placed in the `skills/` directory are automatically loaded on startup.
