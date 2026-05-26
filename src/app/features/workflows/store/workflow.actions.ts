import { createAction, props } from '@ngrx/store';
import { Update } from '@ngrx/entity';
import { Workflow } from '../workflow.model';

export const addWorkflow = createAction(
  '[Workflow] Add Workflow',
  props<{ workflow: Workflow }>(),
);

export const updateWorkflow = createAction(
  '[Workflow] Update Workflow',
  props<{ workflow: Update<Workflow> }>(),
);

export const deleteWorkflow = createAction(
  '[Workflow] Delete Workflow',
  props<{ id: string }>(),
);

export const triggerManualWorkflow = createAction(
  '[Workflow] Trigger Manual',
  props<{ workflowId: string; taskId: string }>(),
);
