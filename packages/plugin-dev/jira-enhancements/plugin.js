// Jira Enhancements – a small, self-contained workflow engine (background).
//
// A "rule" is: trigger → conditions (all must match) → actions (run in order).
// Rules are managed in the plugin UI (index.html) and stored via
// persistDataSynced. This background script reads them fresh on every event so
// edits in the UI take effect immediately without a reload.
//
// The three registries below (TRIGGERS / CONDITIONS / ACTIONS) are the engine's
// vocabulary. To add a capability, add an entry here and the matching option in
// index.html's dropdowns (see SHARED_DEFS there).

const STORE_VERSION = 1;

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

// The two built-in rules. Seeded DISABLED so nothing changes until the user
// opts in; both are editable and deletable in the UI.
function defaultRules() {
  return [
    {
      id: 'default-no-today',
      name: "Don't schedule imports to Today",
      enabled: false,
      trigger: 'taskCreated',
      conditions: [{ type: 'isFromProvider', value: 'JIRA' }],
      actions: [{ type: 'unschedule' }],
    },
    {
      id: 'default-project-picker',
      name: 'Project picker on import in a project',
      enabled: false,
      trigger: 'taskCreated',
      conditions: [{ type: 'isFromProvider', value: 'JIRA' }, { type: 'hasProject' }],
      actions: [{ type: 'moveToProjectViaDialog' }],
    },
  ];
}

// Lazily-loaded, per-event cache for projects/tags so a rule batch fetches once.
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
            Task <strong>&ldquo;${escapeHtml(task.title)}&rdquo;</strong>
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

// ── store ─────────────────────────────────────────────────────────────────────

async function loadRules() {
  const raw = await PluginAPI.loadSyncedData();
  if (!raw) {
    // First run: seed the (disabled) defaults so they show up in the UI.
    const data = { version: STORE_VERSION, rules: defaultRules() };
    await PluginAPI.persistDataSynced(JSON.stringify(data));
    return data.rules;
  }
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data.rules) ? data.rules : [];
  } catch (e) {
    PluginAPI.log.error(`[JiraEnh] Failed to parse stored rules: ${e}`);
    return [];
  }
}

// ── engine ──────────────────────────────────────────────────────────────────────

async function runRule(rule, task) {
  const cache = createDataCache();
  const ctx = { cache };

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

async function handleEvent(hook, event) {
  const task = event.task;
  if (!task) return;

  const rules = await loadRules();
  const normalized = { type: hook, task };
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const trigger = TRIGGERS[rule.trigger];
    if (trigger && trigger.matches(normalized)) {
      await runRule(rule, task);
    }
  }
}

(async () => {
  // Ensure defaults are seeded on first run (so the UI is never empty).
  await loadRules();

  // Register every hook the engine knows about (currently just taskCreated).
  const hooks = new Set(Object.values(TRIGGERS).map((t) => t.hook));
  for (const hook of hooks) {
    PluginAPI.registerHook(hook, (event) => handleEvent(hook, event));
  }

  PluginAPI.log.info('[JiraEnh] Workflow engine started');
})();
