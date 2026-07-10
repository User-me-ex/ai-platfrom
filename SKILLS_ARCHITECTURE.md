# Self-Evolving Skills Architecture

## Overview

The Skills Architecture enables the 9 Router CLI to execute user-created skills AND intelligently evolve its own framework when a skill requires capabilities that don't yet exist.

## Two Skill Categories

### 1. Runtime Skills
Execute immediately without changing CLI source code. Examples: prompt templates, workflows, multi-step agents, file processors, refactoring assistants.

### 2. Framework Extension Skills
Require new capabilities. The CLI detects insufficiency, plans changes, evolves itself, then installs the skill.

## Architecture

```
src/skills/
├── types.ts              # Type definitions
├── engine.ts             # Skill execution engine
├── inspector.ts          # Project structure analysis
├── planner.ts            # Implementation plan generation  
├── evolver.ts            # Framework self-modification
├── installer.ts          # Installation pipeline
├── safety.ts             # Safety validation
├── reporter.ts           # Change reporting
├── git.ts                # Version control integration
├── docs.ts               # Documentation automation
```

## Pipeline

1. Analyze skill → 2. Detect capability gap → 3. Generate plan → 4. Safety check → 5. User approval (interactive) or Auto-execute (autonomous) → 6. Git checkpoint → 7. Modify framework → 8. Install skill → 9. Validate → 10. Run tests → 11. Generate change report → 12. Update docs → 13. Git commit
