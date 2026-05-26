import { evaluateWorkflowCondition } from './workflow-condition.util';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { WorkflowCondition } from './workflow.model';

const BASE: Task = {
  ...DEFAULT_TASK,
  id: 't1',
  title: 'Fix JIRA-123',
  tagIds: ['tag-review', 'tag-wip'],
  projectId: 'proj-a',
  issueProviderId: 'jira-instance-1',
} as Task;

describe('evaluateWorkflowCondition', () => {
  it('returns true for null condition', () => {
    expect(evaluateWorkflowCondition(null, BASE)).toBeTrue();
  });

  describe('HAS_TAG', () => {
    it('matches when tag is present', () => {
      expect(
        evaluateWorkflowCondition({ type: 'HAS_TAG', tagId: 'tag-review' }, BASE),
      ).toBeTrue();
    });

    it('does not match when tag is absent', () => {
      expect(
        evaluateWorkflowCondition({ type: 'HAS_TAG', tagId: 'tag-done' }, BASE),
      ).toBeFalse();
    });
  });

  describe('IN_PROJECT', () => {
    it('matches correct project', () => {
      expect(
        evaluateWorkflowCondition({ type: 'IN_PROJECT', projectId: 'proj-a' }, BASE),
      ).toBeTrue();
    });

    it('does not match wrong project', () => {
      expect(
        evaluateWorkflowCondition({ type: 'IN_PROJECT', projectId: 'proj-b' }, BASE),
      ).toBeFalse();
    });
  });

  describe('FROM_PROVIDER', () => {
    it('matches when issueProviderId matches', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'FROM_PROVIDER', providerId: 'jira-instance-1' },
          BASE,
        ),
      ).toBeTrue();
    });

    it('does not match different provider', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'FROM_PROVIDER', providerId: 'github-instance-1' },
          BASE,
        ),
      ).toBeFalse();
    });

    it('does not match task without provider', () => {
      const task = { ...BASE, issueProviderId: undefined };
      expect(
        evaluateWorkflowCondition(
          { type: 'FROM_PROVIDER', providerId: 'jira-instance-1' },
          task as Task,
        ),
      ).toBeFalse();
    });
  });

  describe('TITLE_MATCHES', () => {
    it('matches substring', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'TITLE_MATCHES', pattern: 'JIRA', isRegex: false },
          BASE,
        ),
      ).toBeTrue();
    });

    it('does not match missing substring', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'TITLE_MATCHES', pattern: 'GITHUB', isRegex: false },
          BASE,
        ),
      ).toBeFalse();
    });

    it('matches regex pattern', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'TITLE_MATCHES', pattern: '^Fix', isRegex: true },
          BASE,
        ),
      ).toBeTrue();
    });

    it('returns false for invalid regex', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'TITLE_MATCHES', pattern: '[invalid', isRegex: true },
          BASE,
        ),
      ).toBeFalse();
    });
  });

  describe('NOT', () => {
    it('negates a matching condition', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'NOT', condition: { type: 'HAS_TAG', tagId: 'tag-review' } },
          BASE,
        ),
      ).toBeFalse();
    });

    it('negates a non-matching condition', () => {
      expect(
        evaluateWorkflowCondition(
          { type: 'NOT', condition: { type: 'HAS_TAG', tagId: 'tag-done' } },
          BASE,
        ),
      ).toBeTrue();
    });
  });

  describe('AND', () => {
    it('returns true when all conditions match', () => {
      const c: WorkflowCondition = {
        type: 'AND',
        conditions: [
          { type: 'HAS_TAG', tagId: 'tag-review' },
          { type: 'IN_PROJECT', projectId: 'proj-a' },
        ],
      };
      expect(evaluateWorkflowCondition(c, BASE)).toBeTrue();
    });

    it('returns false when one condition does not match', () => {
      const c: WorkflowCondition = {
        type: 'AND',
        conditions: [
          { type: 'HAS_TAG', tagId: 'tag-review' },
          { type: 'IN_PROJECT', projectId: 'proj-b' },
        ],
      };
      expect(evaluateWorkflowCondition(c, BASE)).toBeFalse();
    });

    it('returns true for empty AND (vacuously true)', () => {
      expect(evaluateWorkflowCondition({ type: 'AND', conditions: [] }, BASE)).toBeTrue();
    });
  });

  describe('OR', () => {
    it('returns true when one condition matches', () => {
      const c: WorkflowCondition = {
        type: 'OR',
        conditions: [
          { type: 'HAS_TAG', tagId: 'tag-done' },
          { type: 'IN_PROJECT', projectId: 'proj-a' },
        ],
      };
      expect(evaluateWorkflowCondition(c, BASE)).toBeTrue();
    });

    it('returns false when no condition matches', () => {
      const c: WorkflowCondition = {
        type: 'OR',
        conditions: [
          { type: 'HAS_TAG', tagId: 'tag-done' },
          { type: 'IN_PROJECT', projectId: 'proj-b' },
        ],
      };
      expect(evaluateWorkflowCondition(c, BASE)).toBeFalse();
    });

    it('returns false for empty OR (vacuously false)', () => {
      expect(evaluateWorkflowCondition({ type: 'OR', conditions: [] }, BASE)).toBeFalse();
    });
  });

  describe('nested conditions (2 levels)', () => {
    it('supports NOT(AND(...))', () => {
      const c: WorkflowCondition = {
        type: 'NOT',
        condition: {
          type: 'AND',
          conditions: [
            { type: 'HAS_TAG', tagId: 'tag-review' },
            { type: 'HAS_TAG', tagId: 'tag-done' },
          ],
        },
      };
      expect(evaluateWorkflowCondition(c, BASE)).toBeTrue();
    });

    it('supports OR([HAS_TAG, NOT(HAS_TAG)])', () => {
      const c: WorkflowCondition = {
        type: 'OR',
        conditions: [
          { type: 'HAS_TAG', tagId: 'tag-done' },
          { type: 'NOT', condition: { type: 'HAS_TAG', tagId: 'tag-done' } },
        ],
      };
      expect(evaluateWorkflowCondition(c, BASE)).toBeTrue();
    });
  });
});
