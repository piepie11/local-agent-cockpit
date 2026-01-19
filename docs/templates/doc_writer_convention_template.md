# Convention Template (Generic)

> Purpose: A reusable, generic convention template. Replace placeholders with project-specific rules.

---

## 1. Roles & Boundaries
- Who decides scope changes and how to record them.
- Who executes tasks and how to request authorization for extra work.

## 2. Workflow (Small, Verifiable Steps)
- Make changes in small, reviewable increments.
- Always verify with at least one reproducible command.
- Record results and decisions in a short note.
- Commit with a message that references the note.

## 3. Repository Structure
- Where code, docs, notes, logs, and run artifacts should live.
- What should never be committed (secrets, runtime artifacts).

## 4. Quality & Validation
- Required tests or checks for each change.
- How to handle failures and what evidence is required.

## 5. Environment & Tooling
- Required runtime versions (e.g., Node, Python).
- Required environment variables and safe handling.

## 6. Safety
- Prohibit destructive commands by default.
- Require explicit approval and a rollback plan for risky operations.

## 7. Maintenance
- Keep this convention document updated as the project evolves.
