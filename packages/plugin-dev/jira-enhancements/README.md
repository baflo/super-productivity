# Jira Enhancements

A small, self-contained **workflow engine** plugin for Super Productivity.

A rule is: **trigger → conditions (all must match) → actions (run in order)**.

## Managing rules

Open the plugin from the menu (it appears once enabled). You get a table of rules
where you can:

- **Add** a new named rule
- **Edit** an existing rule (trigger, conditions, actions)
- **Enable / disable** a rule via the checkbox
- **Delete** a rule

Two rules are seeded on first run, **disabled** by default (enable them if you
want the classic behavior); both can be edited or deleted:

1. **Don't schedule imports to Today** – clears the auto-set due date on imported
   tasks so they don't land in Today.
2. **Project picker on import in a project** – when a task is imported while a
   project is open, a dialog offers to move it to another project.

Rules are stored via `persistDataSynced`, so they sync with your data. The
background engine re-reads them on every event, so edits apply immediately.

## Vocabulary

| Triggers      | Conditions       | Actions                  |
| ------------- | ---------------- | ------------------------ |
| `taskCreated` | `isFromProvider` | `unschedule`             |
|               | `hasProject`     | `scheduleToday`          |
|               | `titleContains`  | `addTag`                 |
|               | `hasTag`         | `showSnack`              |
|               |                  | `moveToProjectViaDialog` |

`moveToProjectViaDialog` uses `PluginAPI.moveTaskToProject(taskId, projectId)`.

## Files

- `plugin.js` – background engine: the `TRIGGERS` / `CONDITIONS` / `ACTIONS`
  registries, rule evaluation, and hook registration.
- `index.html` – the rule-management UI (vanilla JS, no build step).
- `manifest.json` – declares `iFrame: true` and the `taskCreated` hook.

## Extending

Add an entry to the matching registry in `plugin.js`, then add the same option to
`SHARED_DEFS` in `index.html` so it shows up in the editor dropdowns. `ctx.cache`
provides lazily-loaded, per-event `getProjects()` / `getTags()`.
