import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EMPTY } from 'rxjs';
import { concatMap, filter, switchMap, take, tap, withLatestFrom } from 'rxjs/operators';
import { nanoid } from 'nanoid';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { addSubTask } from '../../tasks/store/task.actions';
import { selectTaskById } from '../../tasks/store/task.selectors';
import { DEFAULT_TASK, Task, TaskCopy } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { SnackService } from '../../../core/snack/snack.service';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { selectAllTasks } from '../../tasks/store/task.selectors';
import { evaluateWorkflowCondition } from '../workflow-condition.util';
import { Workflow, WorkflowAction } from '../workflow.model';
import { triggerManualWorkflow } from './workflow.actions';
import { selectEnabledWorkflows, selectWorkflowById } from './workflow.reducer';

@Injectable()
export class WorkflowEffects {
  private readonly _actions$ = inject(Actions);
  private readonly _store$ = inject(Store);
  private readonly _snackService = inject(SnackService);

  // Tracks task IDs currently being processed to prevent re-entrancy
  private readonly _activeTaskIds = new Set<string>();

  // Snapshot of task tagIds for detecting TAG_ADDED / TAG_REMOVED
  private readonly _tagSnapshot = new Map<string, readonly string[]>();

  initTagSnapshot$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(loadAllData),
        switchMap(() => this._store$.select(selectAllTasks).pipe(take(1))),
        tap((tasks) => {
          this._tagSnapshot.clear();
          for (const task of tasks) {
            this._tagSnapshot.set(task.id, task.tagIds);
          }
        }),
      ),
    { dispatch: false },
  );

  trackNewTaskTags$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.addTask),
        tap(({ task }) => {
          this._tagSnapshot.set(task.id, task.tagIds ?? []);
        }),
      ),
    { dispatch: false },
  );

  onTaskCreated$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.addTask),
        withLatestFrom(this._store$.select(selectEnabledWorkflows)),
        tap(([{ task, issue }, workflows]) => {
          for (const wf of workflows) {
            if (
              wf.trigger.type === 'TASK_CREATED' &&
              evaluateWorkflowCondition(wf.condition, task)
            ) {
              this._executeWorkflow(task, wf);
            }
            if (
              wf.trigger.type === 'TASK_CREATED_FROM_PROVIDER' &&
              issue !== undefined &&
              task.issueProviderId === wf.trigger.providerId &&
              evaluateWorkflowCondition(wf.condition, task)
            ) {
              this._executeWorkflow(task, wf);
            }
          }
        }),
      ),
    { dispatch: false },
  );

  onTaskCompleted$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        concatMap(({ task }) =>
          this._store$
            .select(selectTaskById, { id: task.id })
            .pipe(take(1))
            .pipe(
              withLatestFrom(this._store$.select(selectEnabledWorkflows)),
              tap(([currentTask, workflows]) => {
                if (!currentTask) return;
                for (const wf of workflows) {
                  if (
                    wf.trigger.type === 'TASK_COMPLETED' &&
                    evaluateWorkflowCondition(wf.condition, currentTask)
                  ) {
                    this._executeWorkflow(currentTask, wf);
                  }
                }
              }),
            ),
        ),
      ),
    { dispatch: false },
  );

  onTaskScheduled$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(PlannerActions.planTaskForDay),
        withLatestFrom(this._store$.select(selectEnabledWorkflows)),
        tap(([{ task }, workflows]) => {
          for (const wf of workflows) {
            if (
              wf.trigger.type === 'TASK_SCHEDULED' &&
              evaluateWorkflowCondition(wf.condition, task as Task)
            ) {
              this._executeWorkflow(task as Task, wf);
            }
          }
        }),
      ),
    { dispatch: false },
  );

  onTaskScheduledWithTime$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.scheduleTaskWithTime),
        withLatestFrom(this._store$.select(selectEnabledWorkflows)),
        tap(([{ task }, workflows]) => {
          for (const wf of workflows) {
            if (
              wf.trigger.type === 'TASK_SCHEDULED' &&
              evaluateWorkflowCondition(wf.condition, task)
            ) {
              this._executeWorkflow(task, wf);
            }
          }
        }),
      ),
    { dispatch: false },
  );

  onTaskMovedToProject$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.moveToOtherProject),
        concatMap(({ task, targetProjectId }) =>
          this._store$
            .select(selectTaskById, { id: task.id })
            .pipe(take(1))
            .pipe(
              withLatestFrom(this._store$.select(selectEnabledWorkflows)),
              tap(([currentTask, workflows]) => {
                if (!currentTask) return;
                for (const wf of workflows) {
                  if (
                    wf.trigger.type === 'TASK_MOVED_TO_PROJECT' &&
                    targetProjectId === wf.trigger.projectId &&
                    evaluateWorkflowCondition(wf.condition, currentTask)
                  ) {
                    this._executeWorkflow(currentTask, wf);
                  }
                }
              }),
            ),
        ),
      ),
    { dispatch: false },
  );

  onTagChange$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => Array.isArray(task.changes.tagIds)),
        concatMap(({ task }) => {
          const newTagIds = task.changes.tagIds!;
          const oldTagIds = this._tagSnapshot.get(task.id) ?? [];
          this._tagSnapshot.set(task.id, newTagIds);

          const added = newTagIds.filter((id) => !oldTagIds.includes(id));
          const removed = oldTagIds.filter((id) => !newTagIds.includes(id));

          if (
            (added.length === 0 && removed.length === 0) ||
            this._activeTaskIds.has(task.id)
          ) {
            return EMPTY;
          }

          return this._store$.select(selectTaskById, { id: task.id }).pipe(
            take(1),
            withLatestFrom(this._store$.select(selectEnabledWorkflows)),
            tap(([currentTask, workflows]) => {
              if (!currentTask) return;
              for (const wf of workflows) {
                if (
                  wf.trigger.type === 'TAG_ADDED' &&
                  added.includes(wf.trigger.tagId) &&
                  evaluateWorkflowCondition(wf.condition, currentTask)
                ) {
                  this._executeWorkflow(currentTask, wf);
                }
                if (
                  wf.trigger.type === 'TAG_REMOVED' &&
                  removed.includes(wf.trigger.tagId) &&
                  evaluateWorkflowCondition(wf.condition, currentTask)
                ) {
                  this._executeWorkflow(currentTask, wf);
                }
              }
            }),
            switchMap(() => EMPTY),
          );
        }),
      ),
    { dispatch: false },
  );

  onManualTrigger$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(triggerManualWorkflow),
        concatMap(({ taskId, workflowId }) =>
          this._store$
            .select(selectTaskById, { id: taskId })
            .pipe(take(1))
            .pipe(
              withLatestFrom(this._store$.select(selectWorkflowById, { id: workflowId })),
              tap(([task, workflow]) => {
                if (!task || !workflow || !workflow.isEnabled) return;
                if (evaluateWorkflowCondition(workflow.condition, task)) {
                  this._executeWorkflow(task, workflow);
                }
              }),
            ),
        ),
      ),
    { dispatch: false },
  );

  private _executeWorkflow(originalTask: Task, workflow: Workflow): void {
    if (this._activeTaskIds.has(originalTask.id)) return;
    this._activeTaskIds.add(originalTask.id);

    let task = { ...originalTask };
    try {
      for (const action of workflow.actions) {
        task = this._dispatchWorkflowAction(task, action);
      }
    } finally {
      // Clear after microtask so workflow-dispatched actions don't re-trigger
      Promise.resolve().then(() => this._activeTaskIds.delete(originalTask.id));
    }
  }

  private _dispatchWorkflowAction(task: Task, action: WorkflowAction): Task {
    switch (action.type) {
      case 'ADD_TAG': {
        if (task.tagIds.includes(action.tagId)) return task;
        const tagIds = [...task.tagIds, action.tagId];
        this._store$.dispatch(
          TaskSharedActions.updateTask({ task: { id: task.id, changes: { tagIds } } }),
        );
        return { ...task, tagIds };
      }

      case 'REMOVE_TAG': {
        if (!task.tagIds.includes(action.tagId)) return task;
        const tagIds = task.tagIds.filter((id) => id !== action.tagId);
        this._store$.dispatch(
          TaskSharedActions.updateTask({ task: { id: task.id, changes: { tagIds } } }),
        );
        return { ...task, tagIds };
      }

      case 'SCHEDULE_TODAY': {
        const day = getDbDateStr();
        this._store$.dispatch(
          PlannerActions.planTaskForDay({ task: task as unknown as TaskCopy, day }),
        );
        return { ...task, dueDay: day };
      }

      case 'SCHEDULE_TOMORROW': {
        const day = getDbDateStr(Date.now() + 86400000);
        this._store$.dispatch(
          PlannerActions.planTaskForDay({ task: task as unknown as TaskCopy, day }),
        );
        return { ...task, dueDay: day };
      }

      case 'SCHEDULE_DAY_OFFSET': {
        const msOffset = action.days * 86400000;
        const day = getDbDateStr(Date.now() + msOffset);
        this._store$.dispatch(
          PlannerActions.planTaskForDay({ task: task as unknown as TaskCopy, day }),
        );
        return { ...task, dueDay: day };
      }

      case 'UNSCHEDULE': {
        this._store$.dispatch(
          TaskSharedActions.unscheduleTask({
            id: task.id,
            reminderId: task.reminderId,
          }),
        );
        return { ...task, dueDay: null, dueWithTime: null };
      }

      case 'MOVE_TO_PROJECT': {
        this._store$.dispatch(
          TaskSharedActions.moveToOtherProject({
            task,
            targetProjectId: action.projectId,
          }),
        );
        return { ...task, projectId: action.projectId };
      }

      case 'SET_ESTIMATE': {
        const timeEstimate = action.minutes * 60_000;
        this._store$.dispatch(
          TaskSharedActions.updateTask({
            task: { id: task.id, changes: { timeEstimate } },
          }),
        );
        return { ...task, timeEstimate };
      }

      case 'ADD_SUBTASK': {
        // Subtasks cannot have subtasks
        if (task.parentId) return task;
        const title = action.titleTemplate.replace('{{task.title}}', task.title);
        const subTask: Task = {
          ...DEFAULT_TASK,
          id: nanoid(),
          created: Date.now(),
          title,
          projectId: task.projectId,
        } as Task;
        this._store$.dispatch(addSubTask({ task: subTask, parentId: task.id }));
        return task;
      }

      case 'MARK_DONE': {
        this._store$.dispatch(
          TaskSharedActions.updateTask({
            task: { id: task.id, changes: { isDone: true, doneOn: Date.now() } },
          }),
        );
        return { ...task, isDone: true };
      }

      case 'SHOW_NOTIFICATION': {
        this._snackService.open({ msg: action.message, type: 'INFO' });
        return task;
      }
    }
  }
}
