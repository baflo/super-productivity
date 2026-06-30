# Jira Enhancements

A small, self-contained **workflow engine** plugin for Super Productivity.

A rule is: **trigger → conditions (all must match) → actions (run in order)**.

## Default behavior

If you don't configure any rules, two defaults are active:

1. **Don't schedule Jira imports to Today** – clears the auto-set `dueDay` on
   imported Jira tasks.
2. **Project picker on Jira import in a project** – when a Jira task is imported
   while you're in a project view, a dialog offers to move it to another project.

## Configuration

Open _Settings → Plugins → Jira Enhancements → Configure_:

- **Don't schedule imports to Today** – toggles rule 1 (default on)
- **Project picker on import in a project** – toggles rule 2 (default on)
- **Issue provider key** – which provider the rules apply to (default `JIRA`;
  also works for `GITHUB`, `GITLAB`, `REDMINE`, …)
- **Custom rules (advanced)** – an optional JSON array of extra rules (see below)

> The config form only supports flat fields, so the two built-in rules are
> toggles. Anything more advanced goes through the `customRulesJson` field.

### Custom rules

```json
[
  {
    "name": "Tag urgent bugs",
    "trigger": "taskCreated",
    "conditions": [{ "type": "titleContains", "value": "bug" }],
    "actions": [{ "type": "addTag", "value": "urgent" }]
  }
]
```

## Extending

Everything is driven by three registries in `plugin.js`:

- `TRIGGERS` – `{ id: { name, hook, matches(event) } }`
  (`hook` must also be listed in `manifest.json` `hooks`)
- `CONDITIONS` – `{ id: { name, check(ctx, task, value) } }`
- `ACTIONS` – `{ id: { name, execute(ctx, task, value) } }`

To add a capability, add an entry to the matching registry; it's then usable from
`customRulesJson` immediately. `ctx.cache` provides lazily-loaded, per-event
`getProjects()` / `getTags()`.

## Built-in primitives

| Triggers      | Conditions       | Actions                  |
| ------------- | ---------------- | ------------------------ |
| `taskCreated` | `isFromProvider` | `unschedule`             |
|               | `hasProject`     | `scheduleToday`          |
|               | `titleContains`  | `addTag`                 |
|               | `hasTag`         | `showSnack`              |
|               |                  | `moveToProjectViaDialog` |

`moveToProjectViaDialog` uses the `PluginAPI.moveTaskToProject(taskId, projectId)`
API.
