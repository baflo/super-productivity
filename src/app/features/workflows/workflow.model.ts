import { EntityState } from '@ngrx/entity';

export type WorkflowAtomicCondition =
  | { type: 'HAS_TAG'; tagId: string }
  | { type: 'IN_PROJECT'; projectId: string }
  | { type: 'FROM_PROVIDER'; providerId: string }
  | { type: 'TITLE_MATCHES'; pattern: string; isRegex: boolean };

export type WorkflowInnerCondition =
  | WorkflowAtomicCondition
  | { type: 'NOT'; condition: WorkflowAtomicCondition }
  | { type: 'AND'; conditions: WorkflowAtomicCondition[] }
  | { type: 'OR'; conditions: WorkflowAtomicCondition[] };

// Root condition: max 2 levels of nesting
export type WorkflowCondition =
  | WorkflowInnerCondition
  | { type: 'NOT'; condition: WorkflowInnerCondition }
  | { type: 'AND'; conditions: WorkflowInnerCondition[] }
  | { type: 'OR'; conditions: WorkflowInnerCondition[] };

export type WorkflowTrigger =
  | { type: 'TASK_CREATED' }
  | { type: 'TASK_CREATED_FROM_PROVIDER'; providerId: string }
  | { type: 'TAG_ADDED'; tagId: string }
  | { type: 'TAG_REMOVED'; tagId: string }
  | { type: 'TASK_COMPLETED' }
  | { type: 'TASK_SCHEDULED' }
  | { type: 'TASK_MOVED_TO_PROJECT'; projectId: string }
  | { type: 'MANUAL' };

export type WorkflowTriggerType = WorkflowTrigger['type'];

export type WorkflowAction =
  | { type: 'ADD_TAG'; tagId: string }
  | { type: 'REMOVE_TAG'; tagId: string }
  | { type: 'SCHEDULE_TODAY' }
  | { type: 'SCHEDULE_TOMORROW' }
  | { type: 'SCHEDULE_DAY_OFFSET'; days: number }
  | { type: 'UNSCHEDULE' }
  | { type: 'MOVE_TO_PROJECT'; projectId: string }
  | { type: 'SET_ESTIMATE'; minutes: number }
  | { type: 'ADD_SUBTASK'; titleTemplate: string }
  | { type: 'MARK_DONE' }
  | { type: 'SHOW_NOTIFICATION'; message: string };

export type WorkflowActionType = WorkflowAction['type'];

export interface Workflow {
  id: string;
  title: string;
  isEnabled: boolean;
  trigger: WorkflowTrigger;
  condition: WorkflowCondition | null;
  actions: WorkflowAction[];
  created: number;
  modified: number;
}

export type WorkflowState = EntityState<Workflow>;
