import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { nanoid } from 'nanoid';
import {
  Workflow,
  WorkflowAction,
  WorkflowCondition,
  WorkflowTrigger,
} from './workflow.model';
import {
  addWorkflow,
  deleteWorkflow,
  triggerManualWorkflow,
  updateWorkflow,
} from './store/workflow.actions';
import {
  selectAllWorkflows,
  selectEnabledManualWorkflows,
} from './store/workflow.reducer';

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private readonly _store = inject(Store);

  readonly allWorkflows$ = this._store.select(selectAllWorkflows);
  readonly enabledManualWorkflows$ = this._store.select(selectEnabledManualWorkflows);

  add(params: {
    title: string;
    trigger: WorkflowTrigger;
    condition?: WorkflowCondition | null;
    actions?: WorkflowAction[];
  }): void {
    const workflow: Workflow = {
      id: nanoid(),
      title: params.title,
      isEnabled: true,
      trigger: params.trigger,
      condition: params.condition ?? null,
      actions: params.actions ?? [],
      created: Date.now(),
      modified: Date.now(),
    };
    this._store.dispatch(addWorkflow({ workflow }));
  }

  update(id: string, changes: Partial<Omit<Workflow, 'id' | 'created'>>): void {
    this._store.dispatch(
      updateWorkflow({
        workflow: { id, changes: { ...changes, modified: Date.now() } },
      }),
    );
  }

  delete(id: string): void {
    this._store.dispatch(deleteWorkflow({ id }));
  }

  triggerManual(workflowId: string, taskId: string): void {
    this._store.dispatch(triggerManualWorkflow({ workflowId, taskId }));
  }
}
