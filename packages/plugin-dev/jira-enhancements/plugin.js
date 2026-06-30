// Jira Enhancements – a small, self-contained workflow engine.
//
// A "rule" is: trigger → conditions (all must match) → actions (run in order).
// The three registries below (TRIGGERS / CONDITIONS / ACTIONS) make the engine
// extensible: to add a capability, drop a new entry into the matching registry
// and reference its id from a rule (and add the id to config-schema.json so it
// shows up in the settings form).
//
// Ships with two default rules (see DEFAULT_RULES) so it works out of the box:
//   1. Don't auto-schedule imported Jira tasks to "Today".
//   2. On manual Jira import inside a project view, offer a project-picker dialog.
// Both are fully editable via the plugin config (Settings → Plugins → Configure).

// ── helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Lazily-loaded, per-event cache for projects/tags so a rule batch only fetches once.
function createDataCache() {
  let projects = null;
  let tags = null;
  return {
    async getProjects() {
      if (!projects) projects = await PluginAPI.getAllProjects();
      return projects;
    },
    async getTags() {
      if (!tags) tags = await PluginAPI.getAllTags();
      return tags;
    },
  };
}

// ── trigger registry ──────────────────────────────────────────────────────────
// `hook` is the Super Productivity plugin hook to subscribe to (declare it in
// manifest.json too). `matches` lets one hook back several logical triggers.

const TRIGGERS = {
  taskCreated: {
    name: 'Task created',
    hook: 'taskCreated',
    matches: (event) => event.type === 'taskCreated',
  },
};

// ── condition registry ─────────────────────────────────────────────────────────
// check(ctx, task, value) => boolean | Promise<boolean>

const CONDITIONS = {
  isFromProvider: {
    name: 'Imported from issue provider',
    // value = provider key (e.g. "JIRA", "GITHUB"); empty = any provider
    check: (ctx, task, value) => (value ? task.issueType === value : !!task.issueType),
  },
  hasProject: {
    name: 'Is in a project',
    // value = optional project title; empty = any project (i.e. not the inbox)
    check: async (ctx, task, value) => {
      if (!task.projectId) return false;
      if (!value) return true;
      const projects = await ctx.cache.getProjects();
      const project = projects.find((p) => p.id === task.projectId);
      return !!project && project.title === value;
    },
  },
  titleContains: {
    name: 'Title contains',
    check: (ctx, task, value) =>
      !!value && task.title.toLowerCase().includes(value.toLowerCase()),
  },
  hasTag: {
    name: 'Has tag',
    // value = tag title
    check: async (ctx, task, value) => {
      if (!value || !task.tagIds || !task.tagIds.length) return false;
      const tags = await ctx.cache.getTags();
      const tag = tags.find((t) => t.title === value);
      return !!tag && task.tagIds.includes(tag.id);
    },
  },
};

// ── action registry ────────────────────────────────────────────────────────────
// execute(ctx, task, value) => Promise<void>

const ACTIONS = {
  unschedule: {
    name: 'Remove from Today / unschedule',
    execute: async (ctx, task) => {
      await PluginAPI.updateTask(task.id, { dueDay: null, dueWithTime: null });
      PluginAPI.log.info(`[JiraEnh] Unscheduled task "${task.title}"`);
    },
  },
  scheduleToday: {
    name: 'Schedule for Today',
    execute: async (ctx, task) => {
      await PluginAPI.updateTask(task.id, { dueDay: todayStr() });
      PluginAPI.log.info(`[JiraEnh] Scheduled task "${task.title}" for today`);
    },
  },
  addTag: {
    name: 'Add tag',
    // value = tag title (must already exist)
    execute: async (ctx, task, value) => {
      if (!value) return;
      const tags = await ctx.cache.getTags();
      const tag = tags.find((t) => t.title === value);
      if (!tag) {
        PluginAPI.log.warn(`[JiraEnh] Tag "${value}" not found`);
        return;
      }
      if (task.tagIds && task.tagIds.includes(tag.id)) return;
      await PluginAPI.updateTask(task.id, {
        tagIds: [...(task.tagIds || []), tag.id],
      });
    },
  },
  showSnack: {
    name: 'Show snack message',
    execute: (ctx, task, value) => {
      if (value) PluginAPI.showSnack({ msg: value, type: 'SUCCESS' });
    },
  },
  moveToProjectViaDialog: {
    name: 'Offer project picker dialog',
    execute: async (ctx, task) => {
      const projects = await ctx.cache.getProjects();
      const activeProjects = projects.filter((p) => !p.isArchived);
      const currentProject = activeProjects.find((p) => p.id === task.projectId);
      if (!currentProject) return;

      const otherProjects = activeProjects.filter((p) => p.id !== task.projectId);
      const optionsHtml = otherProjects
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)}</option>`)
        .join('');

      await PluginAPI.openDialog({
        htmlContent: `
          <p>
            Jira task <strong>&ldquo;${escapeHtml(task.title)}&rdquo;</strong>
            was added to project <strong>${escapeHtml(currentProject.title)}</strong>.
          </p>
          ${
            otherProjects.length > 0
              ? `<p style="margin-top:12px">Move to a different project?</p>
                 <select id="jira-enh-project-select"
                         style="width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px">
                   <option value="">— Keep in ${escapeHtml(currentProject.title)} —</option>
                   ${optionsHtml}
                 </select>`
              : '<p style="color:gray;margin-top:8px"><em>No other projects available.</em></p>'
          }
        `,
        buttons: [
          {
            label: 'OK',
            color: 'primary',
            onClick: async () => {
              const select = document.getElementById('jira-enh-project-select');
              const pickedProjectId = select ? select.value : null;
              if (pickedProjectId) {
                await PluginAPI.moveTaskToProject(task.id, pickedProjectId);
              }
            },
          },
        ],
      });
    },
  },
};

// ── default rules (used when no custom rules are configured) ────────────────────

const DEFAULT_RULES = [
  {
    name: "Don't schedule Jira imports to Today",
    enabled: true,
    trigger: 'taskCreated',
    conditions: [{ type: 'isFromProvider', value: 'JIRA' }],
    actions: [{ type: 'unschedule' }],
  },
  {
    name: 'Project picker on Jira import in a project',
    enabled: true,
    trigger: 'taskCreated',
    conditions: [{ type: 'isFromProvider', value: 'JIRA' }, { type: 'hasProject' }],
    actions: [{ type: 'moveToProjectViaDialog' }],
  },
];

// ── engine ──────────────────────────────────────────────────────────────────────

async function runRule(rule, event) {
  const cache = createDataCache();
  const ctx = { cache };
  const task = event.task;
  if (!task) return;

  // All conditions must pass (logical AND).
  for (const cond of rule.conditions || []) {
    const def = CONDITIONS[cond.type];
    if (!def) {
      PluginAPI.log.warn(`[JiraEnh] Unknown condition "${cond.type}"`);
      return;
    }
    const ok = await def.check(ctx, task, cond.value);
    if (!ok) return;
  }

  // Run actions in declared order.
  for (const act of rule.actions || []) {
    const def = ACTIONS[act.type];
    if (!def) {
      PluginAPI.log.warn(`[JiraEnh] Unknown action "${act.type}"`);
      continue;
    }
    try {
      await def.execute(ctx, task, act.value);
    } catch (e) {
      PluginAPI.log.error(`[JiraEnh] Action "${act.type}" failed: ${e}`);
    }
  }
}

(async () => {
  const cfg = (await PluginAPI.getConfig()) || {};
  const rules = Array.isArray(cfg.rules) && cfg.rules.length ? cfg.rules : DEFAULT_RULES;

  const activeRules = rules.filter((r) => r && r.enabled !== false);
  if (!activeRules.length) return;

  // Register one hook handler per distinct hook used by the active rules.
  const hooks = new Set();
  for (const rule of activeRules) {
    const trigger = TRIGGERS[rule.trigger];
    if (trigger) hooks.add(trigger.hook);
    else PluginAPI.log.warn(`[JiraEnh] Unknown trigger "${rule.trigger}"`);
  }

  for (const hook of hooks) {
    PluginAPI.registerHook(hook, async (event) => {
      // Normalize: hook payloads pass { taskId, task }, engine expects event.type.
      const normalized = { type: hook, task: event.task, taskId: event.taskId };
      for (const rule of activeRules) {
        const trigger = TRIGGERS[rule.trigger];
        if (trigger && trigger.matches(normalized)) {
          await runRule(rule, normalized);
        }
      }
    });
  }

  PluginAPI.log.info(
    `[JiraEnh] Workflow engine started with ${activeRules.length} rule(s)`,
  );
})();
