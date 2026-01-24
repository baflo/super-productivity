import { createActionGroup, props } from '@ngrx/store';
import { Task } from '../../../tasks/task.model';
import { LogseqBlock } from './logseq-issue.model';
import { DiscrepancyType } from './logseq-common-interfaces.service';

/* eslint-disable @typescript-eslint/naming-convention */

export interface DiscrepancyResolution {
  taskId: string;
  action: 'superprod' | 'logseq';
  discrepancyType: DiscrepancyType;
  task: Task;
  block: LogseqBlock;
}

export interface ActiveTaskSelection {
  selectedTaskId: string | '__none__';
  allActiveTasks: Task[];
}

export const LogseqIssueActions = createActionGroup({
  source: 'Logseq Issue',
  events: {
    // Discrepancy resolution actions
    'Resolve Discrepancies': props<{
      resolutions: DiscrepancyResolution[];
      activeTaskSelection?: ActiveTaskSelection;
    }>(),
    'Apply SuperProd State': props<{
      task: Task;
      discrepancyType: DiscrepancyType;
    }>(),
    'Apply Logseq State': props<{
      task: Task;
      block: LogseqBlock;
      discrepancyType: DiscrepancyType;
    }>(),
    'Set Active Task From Selection': props<ActiveTaskSelection>(),
  },
});
