import { Task } from '../tasks/task.model';
import {
  WorkflowAtomicCondition,
  WorkflowCondition,
  WorkflowInnerCondition,
} from './workflow.model';

export const evaluateWorkflowCondition = (
  condition: WorkflowCondition | null,
  task: Task,
): boolean => {
  if (condition === null) return true;
  return _eval(condition, task);
};

const _eval = (
  condition: WorkflowCondition | WorkflowInnerCondition,
  task: Task,
): boolean => {
  switch (condition.type) {
    case 'HAS_TAG':
      return task.tagIds.includes(condition.tagId);

    case 'IN_PROJECT':
      return task.projectId === condition.projectId;

    case 'FROM_PROVIDER':
      return task.issueProviderId === condition.providerId;

    case 'TITLE_MATCHES':
      if (condition.isRegex) {
        try {
          return new RegExp(condition.pattern).test(task.title);
        } catch {
          return false;
        }
      }
      return task.title.includes(condition.pattern);

    case 'NOT':
      return !_eval(condition.condition, task);

    case 'AND':
      // vacuously true for empty array (mirrors Array.every)
      return condition.conditions.every((c) => _eval(c as WorkflowAtomicCondition, task));

    case 'OR':
      // vacuously false for empty array (mirrors Array.some)
      return condition.conditions.some((c) => _eval(c as WorkflowAtomicCondition, task));
  }
};
