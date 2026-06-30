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

Open _Settings → Plugins → Jira Enhancements → Configure_. The form lets you add
rules; each rule has a trigger, a list of conditions, and a list of actions.
Configuring any rule replaces the defaults.

## Extending

Everything is driven by three registries in `plugin.js`:

- `TRIGGERS` – `{ id: { name, hook, matches(event) } }`
  (`hook` must also be listed in `manifest.json` `hooks`)
- `CONDITIONS` – `{ id: { name, check(ctx, task, value) } }`
- `ACTIONS` – `{ id: { name, execute(ctx, task, value) } }`

To add a capability: add an entry to the matching registry, then add its `id` to
the corresponding `enum` in `config-schema.json` so it appears in the settings
form. `ctx.cache` provides lazily-loaded, per-event `getProjects()` / `getTags()`.

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
