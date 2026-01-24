import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  filter,
  concatMap,
  withLatestFrom,
  mergeMap,
  switchMap,
  debounceTime,
  tap,
  buffer,
  map,
} from 'rxjs/operators';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { setCurrentTask, unsetCurrentTask } from '../../../tasks/store/task.actions';
import { PlannerActions } from '../../../planner/store/planner.actions';
import { TaskService } from '../../../tasks/task.service';
import {
  LogseqCommonInterfacesService,
  DiscrepancyItem,
  DiscrepancyType,
} from './logseq-common-interfaces.service';
import { IssueProviderService } from '../../issue-provider.service';
import { IssueService } from '../../issue.service';
import { EMPTY, concat, of, Observable, firstValueFrom } from 'rxjs';
import { LogseqTaskWorkflow, LogseqCfg } from './logseq.model';
import { LOGSEQ_TYPE } from './logseq.const';
import { LogseqLog } from '../../../../core/log';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { Task } from '../../../tasks/task.model';
import { LogseqIssueActions } from './logseq-issue.actions';
import { LogseqDiscrepancyDialogComponent } from './logseq-discrepancy-dialog/logseq-discrepancy-dialog.component';

@Injectable()
export class LogseqIssueEffects {
  private readonly _actions$ = inject(Actions);
  private readonly _taskService = inject(TaskService);
  private readonly _logseqCommonService = inject(LogseqCommonInterfacesService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _issueService = inject(IssueService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _store = inject(Store);
  private readonly _destroyRef = inject(DestroyRef);
  private _previousTaskId: string | null = null;
  private _isDialogOpen = false;

  private _getMarkers(workflow: LogseqTaskWorkflow): {
    active: 'DOING' | 'NOW';
    stopped: 'TODO' | 'LATER';
    done: 'DONE';
  } {
    return workflow === 'NOW_LATER'
      ? { active: 'NOW', stopped: 'LATER', done: 'DONE' }
      : { active: 'DOING', stopped: 'TODO', done: 'DONE' };
  }

  private async _performLogseqAction(
    discrepancyType: DiscrepancyType,
    task: Task,
  ): Promise<void> {
    if (!task.issueId || !task.issueProviderId) {
      return;
    }

    let updatedMarker: string | null = null;

    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        // Reset Logseq block to TODO/LATER
        const cfg1 = await firstValueFrom(
          this._issueProviderService.getCfgOnce$(task.issueProviderId, LOGSEQ_TYPE),
        );
        if (cfg1) {
          const markers = this._getMarkers((cfg1 as LogseqCfg).taskWorkflow);
          updatedMarker = markers.stopped;
          await this._logseqCommonService.updateBlockMarker(
            task.issueId as string,
            task.issueProviderId,
            markers.stopped,
          );
        }
        break;

      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        // Mark block as DONE in Logseq
        updatedMarker = 'DONE';
        await this._logseqCommonService.updateBlockMarker(
          task.issueId as string,
          task.issueProviderId,
          'DONE',
        );
        break;

      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        // Set block to NOW/DOING in Logseq
        const cfg2 = await firstValueFrom(
          this._issueProviderService.getCfgOnce$(task.issueProviderId, LOGSEQ_TYPE),
        );
        if (cfg2) {
          const markers = this._getMarkers((cfg2 as LogseqCfg).taskWorkflow);
          updatedMarker = markers.active;
          await this._logseqCommonService.updateBlockMarker(
            task.issueId as string,
            task.issueProviderId,
            markers.active,
          );
        }
        break;
    }

    // Update :SP: drawer and task state to prevent false positives on next poll
    if (updatedMarker !== null) {
      // Update :SP: drawer with current sync state
      await this._logseqCommonService.updateSpDrawer(
        task.issueId as string,
        task.issueProviderId,
      );

      // Fetch updated block to refresh task details display
      const updatedBlock = await this._logseqCommonService.getById(
        task.issueId as string,
        task.issueProviderId,
      );

      // Refresh issue data in task detail panel
      if (updatedBlock) {
        this._issueService.refreshIssueData(
          task.issueProviderId,
          task.issueId as string,
          updatedBlock,
        );
      }

      this._taskService.update(task.id, {
        isDone: updatedMarker === 'DONE',
        // Don't mark as "updated" for marker-only changes
        issueWasUpdated: false,
      });
    }
  }

  private _performSuperProdAction(discrepancyType: DiscrepancyType, task: Task): void {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        // Mark task as done in SuperProd
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { isDone: true },
            },
          }),
        );
        break;

      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        // Unmark task as done in SuperProd
        this._store.dispatch(
          TaskSharedActions.updateTask({
            task: {
              id: task.id,
              changes: { isDone: false },
            },
          }),
        );
        break;

      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        // Activate task in SuperProd
        this._store.dispatch(setCurrentTask({ id: task.id }));
        break;

      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        // Deactivate task in SuperProd
        this._store.dispatch(unsetCurrentTask());
        break;
    }
  }

  // Effect: Start a new task (and stop previous task if any)
  updateBlockOnTaskStart$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setCurrentTask),
        filter(({ id }) => !!id && id !== null),
        concatMap(({ id }) => {
          const previousId = this._previousTaskId;
          this._previousTaskId = id as string;

          // Build observables
          const operations: Observable<null>[] = [];

          // Stop previous task first (if any and different from new task)
          if (previousId && previousId !== id) {
            operations.push(
              this._taskService.getByIdOnce$(previousId).pipe(
                filter(
                  (task) =>
                    task.issueType === LOGSEQ_TYPE && !!task.issueId && !task.isDone,
                ),
                switchMap((task) =>
                  this._issueProviderService
                    .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
                    .pipe(
                      mergeMap((cfg) => {
                        const markers = this._getMarkers(cfg.taskWorkflow);
                        return this._logseqCommonService
                          .updateBlockMarker(
                            task.issueId as string,
                            task.issueProviderId || '',
                            markers.stopped,
                          )
                          .then(() => of(null))
                          .catch(() => of(null));
                      }),
                    ),
                ),
                concatMap(() => of(null)),
              ),
            );
          }

          // Start new task
          operations.push(
            this._taskService.getByIdOnce$(id as string).pipe(
              filter(
                (task) =>
                  task.issueType === LOGSEQ_TYPE && !!task.issueId && !task.isDone,
              ),
              switchMap((task) =>
                this._issueProviderService
                  .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
                  .pipe(
                    mergeMap((cfg) => {
                      const markers = this._getMarkers(cfg.taskWorkflow);
                      return this._logseqCommonService
                        .updateBlockMarker(
                          task.issueId as string,
                          task.issueProviderId || '',
                          markers.active,
                        )
                        .then(() => of(null))
                        .catch(() => of(null));
                    }),
                  ),
              ),
              concatMap(() => of(null)),
            ),
          );

          // Execute sequentially
          return concat(...operations).pipe(concatMap(() => EMPTY));
        }),
      ),
    { dispatch: false },
  );

  // Effect: Stop current task when it's unset
  updateBlockOnTaskStop$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(unsetCurrentTask),
        filter(() => !!this._previousTaskId),
        concatMap(() => {
          const currentId = this._previousTaskId;
          this._previousTaskId = null;

          if (!currentId) {
            return EMPTY;
          }

          return this._taskService.getByIdOnce$(currentId).pipe(
            filter(
              (task) => task.issueType === LOGSEQ_TYPE && !!task.issueId && !task.isDone,
            ),
            switchMap((task) =>
              this._issueProviderService
                .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
                .pipe(
                  mergeMap((cfg) => {
                    const markers = this._getMarkers(cfg.taskWorkflow);
                    return this._logseqCommonService
                      .updateBlockMarker(
                        task.issueId as string,
                        task.issueProviderId || '',
                        markers.stopped,
                      )
                      .then(() => EMPTY)
                      .catch(() => this._handleOfflineError());
                  }),
                ),
            ),
          );
        }),
      ),
    { dispatch: false },
  );

  // Effect: Update Logseq block to DONE when task is marked done
  updateBlockOnTaskDone$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        // Only sync manual changes, not issue/polling updates
        filter(({ task }) => task.changes.issueWasUpdated === undefined),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => task.issueType === LOGSEQ_TYPE && !!task.issueId),
        concatMap((task) => {
          // DONE is the same for both workflows
          return this._logseqCommonService
            .updateBlockMarker(task.issueId as string, task.issueProviderId || '', 'DONE')
            .then(() => EMPTY)
            .catch(() => this._handleOfflineError());
        }),
      ),
    { dispatch: false },
  );

  // Effect: Sync due date changes to Logseq SCHEDULED (from updateTask or Planner)
  updateScheduledOnDueDateChange$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.updateTask,
          TaskSharedActions.scheduleTaskWithTime,
          TaskSharedActions.reScheduleTaskWithTime,
          PlannerActions.planTaskForDay,
          PlannerActions.transferTask,
        ),
        concatMap((action) => {
          // Special handling for updateTask - only sync manual changes
          if (action.type === TaskSharedActions.updateTask.type) {
            const updateAction = action as ReturnType<
              typeof TaskSharedActions.updateTask
            >;
            const hasDueDateChange = updateAction.task.changes.dueDay !== undefined;
            const hasDueTimeChange = updateAction.task.changes.dueWithTime !== undefined;
            // Skip if no due date change, or if this is an issue/polling update
            if (
              (!hasDueDateChange && !hasDueTimeChange) ||
              updateAction.task.changes.issueWasUpdated !== undefined
            ) {
              return EMPTY;
            }
          }

          return this._taskService.getByIdOnce$((action as any).task.id);
        }),
        filter((task) => task.issueType === LOGSEQ_TYPE && !!task.issueId),
        concatMap((task) =>
          this._logseqCommonService
            .updateIssueFromTask(task)
            .then(() => EMPTY)
            .catch(() => this._handleOfflineError()),
        ),
      ),
    { dispatch: false },
  );

  // Effect: Update Logseq block to stopped or active state when task is un-done
  updateBlockOnTaskUndone$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === false),
        // Only sync manual changes, not issue/polling updates
        // issueWasUpdated is undefined for manual actions, false for marker polling, true for content polling
        filter(({ task }) => task.changes.issueWasUpdated === undefined),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => task.issueType === LOGSEQ_TYPE && !!task.issueId),
        withLatestFrom(this._taskService.currentTaskId$),
        switchMap(([task, currentTaskId]) =>
          this._issueProviderService
            .getCfgOnce$(task.issueProviderId || '', LOGSEQ_TYPE)
            .pipe(
              mergeMap((cfg) => {
                const markers = this._getMarkers(cfg.taskWorkflow);
                // If this is the current task, set to active (NOW/DOING), otherwise stopped (LATER/TODO)
                const marker =
                  currentTaskId === task.id ? markers.active : markers.stopped;
                return this._logseqCommonService
                  .updateBlockMarker(
                    task.issueId as string,
                    task.issueProviderId || '',
                    marker as 'TODO' | 'DOING' | 'LATER' | 'NOW' | 'DONE',
                  )
                  .then(() => EMPTY)
                  .catch(() => this._handleOfflineError());
              }),
            ),
        ),
      ),
    { dispatch: false },
  );


  // Effect: Buffer discrepancies from polling and show them in a dialog
  showDiscrepancyDialog$ = createEffect(
    () =>
      this._logseqCommonService.discrepancies$.pipe(
        takeUntilDestroyed(this._destroyRef),
        buffer(this._logseqCommonService.discrepancies$.pipe(debounceTime(500))),
        filter((discrepancies) => discrepancies.length > 0),
        filter(() => !this._isDialogOpen),
        switchMap((discrepancies) => {
          this._isDialogOpen = true;
          
          LogseqLog.debug(
            '[LOGSEQ] Opening discrepancy dialog with',
            discrepancies.length,
            'items',
          );

          // Remove duplicates by task ID
          const uniqueDiscrepancies = discrepancies.reduce((acc, curr) => {
            if (!acc.find((d) => d.task.id === curr.task.id)) {
              acc.push(curr);
            }
            return acc;
          }, [] as DiscrepancyItem[]);

          const dialogRef = this._matDialog.open(LogseqDiscrepancyDialogComponent, {
            restoreFocus: true,
            width: '600px',
            data: { discrepancies: uniqueDiscrepancies },
          });

          return dialogRef.afterClosed().pipe(
            tap(() => {
              this._isDialogOpen = false;
            }),
            map((result) => result || null),
          );
        }),
        filter((result) => result !== null),
        map((result) =>
          LogseqIssueActions.resolveDiscrepancies({
            resolutions: result.resolutions,
            activeTaskSelection: result.activeTaskSelection,
          }),
        ),
      ),
  );

  // Effect: Handle discrepancy resolutions
  resolveDiscrepancies$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(LogseqIssueActions.resolveDiscrepancies),
        tap(({ resolutions, activeTaskSelection }) => {
          LogseqLog.debug('[LOGSEQ] Resolving discrepancies:', {
            count: resolutions.length,
            hasActiveSelection: !!activeTaskSelection,
          });

          // Handle active task selection first (if present)
          if (activeTaskSelection) {
            this._store.dispatch(
              LogseqIssueActions.setActiveTaskFromSelection(activeTaskSelection),
            );
          }

          // Process each resolution
          for (const resolution of resolutions) {
            if (resolution.action === 'superprod') {
              this._store.dispatch(
                LogseqIssueActions.applySuperProdState({
                  task: resolution.task,
                  discrepancyType: resolution.discrepancyType,
                }),
              );
            } else {
              this._store.dispatch(
                LogseqIssueActions.applyLogseqState({
                  task: resolution.task,
                  block: resolution.block,
                  discrepancyType: resolution.discrepancyType,
                }),
              );
            }
          }
        }),
      ),
    { dispatch: false },
  );

  // Effect: Apply SuperProd state
  applySuperProdState$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(LogseqIssueActions.applySuperProdState),
        tap(({ task, discrepancyType }) => {
          LogseqLog.debug('[LOGSEQ] Applying SuperProd state:', {
            taskId: task.id,
            type: discrepancyType,
          });
          this._performSuperProdAction(discrepancyType, task);
        }),
      ),
    { dispatch: false },
  );

  // Effect: Apply Logseq state
  applyLogseqState$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(LogseqIssueActions.applyLogseqState),
        concatMap(async ({ task, discrepancyType }) => {
          LogseqLog.debug('[LOGSEQ] Applying Logseq state:', {
            taskId: task.id,
            type: discrepancyType,
          });
          await this._performLogseqAction(discrepancyType, task);
          return EMPTY;
        }),
      ),
    { dispatch: false },
  );

  // Effect: Set active task from selection
  setActiveTaskFromSelection$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(LogseqIssueActions.setActiveTaskFromSelection),
        tap(async ({ selectedTaskId, allActiveTasks }) => {
          LogseqLog.debug('[LOGSEQ] Setting active task:', selectedTaskId);

          if (selectedTaskId === '__none__') {
            // Deactivate all tasks in Logseq
            for (const task of allActiveTasks) {
              await this._performLogseqAction(
                'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
                task,
              );
            }
          } else {
            // Activate selected task in SuperProd
            this._store.dispatch(setCurrentTask({ id: selectedTaskId }));

            // Deactivate all other tasks in Logseq
            for (const task of allActiveTasks) {
              if (task.id !== selectedTaskId) {
                await this._performLogseqAction(
                  'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
                  task,
                );
              }
            }
          }
        }),
      ),
    { dispatch: false },
  );

  private _handleOfflineError(): typeof EMPTY {
    // Silently handle offline errors (already logged by API service)
    return EMPTY;
  }
}
