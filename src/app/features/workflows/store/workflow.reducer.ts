import { createEntityAdapter, EntityAdapter } from '@ngrx/entity';
import { createFeatureSelector, createReducer, createSelector, on } from '@ngrx/store';
import { Workflow, WorkflowState } from '../workflow.model';
import { addWorkflow, deleteWorkflow, updateWorkflow } from './workflow.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';

export const WORKFLOW_FEATURE_NAME = 'workflow';

export const workflowAdapter: EntityAdapter<Workflow> = createEntityAdapter<Workflow>();

export const initialWorkflowState: WorkflowState = workflowAdapter.getInitialState();

const { selectAll, selectEntities } = workflowAdapter.getSelectors();

export const selectWorkflowFeatureState =
  createFeatureSelector<WorkflowState>(WORKFLOW_FEATURE_NAME);

export const selectAllWorkflows = createSelector(selectWorkflowFeatureState, selectAll);

export const selectWorkflowEntities = createSelector(
  selectWorkflowFeatureState,
  selectEntities,
);

export const selectEnabledWorkflows = createSelector(selectAllWorkflows, (workflows) =>
  workflows.filter((wf) => wf.isEnabled),
);

export const selectEnabledManualWorkflows = createSelector(
  selectEnabledWorkflows,
  (workflows) => workflows.filter((wf) => wf.trigger.type === 'MANUAL'),
);

export const selectWorkflowById = createSelector(
  selectWorkflowFeatureState,
  (state: WorkflowState, props: { id: string }): Workflow | undefined =>
    state.entities[props.id],
);

export const workflowReducer = createReducer<WorkflowState>(
  initialWorkflowState,

  on(loadAllData, (oldState, { appDataComplete }) =>
    (appDataComplete as any).workflow
      ? { ...(appDataComplete as any).workflow }
      : oldState,
  ),

  on(addWorkflow, (state, { workflow }) => workflowAdapter.addOne(workflow, state)),

  on(updateWorkflow, (state, { workflow }) => workflowAdapter.updateOne(workflow, state)),

  on(deleteWorkflow, (state, { id }) => workflowAdapter.removeOne(id, state)),
);
