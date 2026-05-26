import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { WorkflowService } from '../workflow.service';
import {
  Workflow,
  WorkflowAction,
  WorkflowActionType,
  WorkflowCondition,
  WorkflowTrigger,
  WorkflowTriggerType,
} from '../workflow.model';
import { Store } from '@ngrx/store';
import { selectAllTags } from '../../tag/store/tag.reducer';
import { selectAllProjects } from '../../project/store/project.selectors';
import { toSignal } from '@angular/core/rxjs-interop';
import { AsyncPipe } from '@angular/common';

const TRIGGER_TYPES: WorkflowTriggerType[] = [
  'TASK_CREATED',
  'TASK_CREATED_FROM_PROVIDER',
  'TAG_ADDED',
  'TAG_REMOVED',
  'TASK_COMPLETED',
  'TASK_SCHEDULED',
  'TASK_MOVED_TO_PROJECT',
  'MANUAL',
];

const ACTION_TYPES: WorkflowActionType[] = [
  'ADD_TAG',
  'REMOVE_TAG',
  'SCHEDULE_TODAY',
  'SCHEDULE_TOMORROW',
  'SCHEDULE_DAY_OFFSET',
  'UNSCHEDULE',
  'MOVE_TO_PROJECT',
  'SET_ESTIMATE',
  'ADD_SUBTASK',
  'MARK_DONE',
  'SHOW_NOTIFICATION',
];

@Component({
  selector: 'workflow-editor',
  imports: [
    FormsModule,
    MatButton,
    MatFormField,
    MatLabel,
    MatInput,
    MatOption,
    MatSelect,
    MatSlideToggle,
    TranslateModule,
    AsyncPipe,
  ],
  templateUrl: './workflow-editor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowEditorComponent {
  private readonly _dialogRef = inject(MatDialogRef<WorkflowEditorComponent>);
  private readonly _data: Workflow | null = inject(MAT_DIALOG_DATA);
  private readonly _workflowService = inject(WorkflowService);
  private readonly _store = inject(Store);

  protected readonly T = T;
  protected readonly TRIGGER_TYPES = TRIGGER_TYPES;
  protected readonly ACTION_TYPES = ACTION_TYPES;

  readonly allTags = toSignal(this._store.select(selectAllTags), { initialValue: [] });
  readonly allProjects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [],
  });

  // Form state
  readonly title = signal(this._data?.title ?? '');
  readonly isEnabled = signal(this._data?.isEnabled ?? true);
  readonly trigger = signal<WorkflowTrigger>(
    this._data?.trigger ?? { type: 'TASK_CREATED' },
  );
  readonly conditionJson = signal<string>(
    this._data?.condition ? JSON.stringify(this._data.condition, null, 2) : '',
  );
  readonly isJsonMode = signal(false);
  readonly jsonError = signal<string | null>(null);
  readonly actions = signal<WorkflowAction[]>(this._data?.actions ?? []);

  readonly isEdit = !!this._data;

  readonly triggerTagId = computed(() => {
    const t = this.trigger();
    return t.type === 'TAG_ADDED' || t.type === 'TAG_REMOVED' ? t.tagId : '';
  });

  readonly triggerProjectId = computed(() => {
    const t = this.trigger();
    return t.type === 'TASK_MOVED_TO_PROJECT' ? t.projectId : '';
  });

  readonly triggerProviderId = computed(() => {
    const t = this.trigger();
    return t.type === 'TASK_CREATED_FROM_PROVIDER' ? t.providerId : '';
  });

  setTriggerType(type: WorkflowTriggerType): void {
    switch (type) {
      case 'TAG_ADDED':
      case 'TAG_REMOVED':
        this.trigger.set({ type, tagId: '' });
        break;
      case 'TASK_MOVED_TO_PROJECT':
        this.trigger.set({ type, projectId: '' });
        break;
      case 'TASK_CREATED_FROM_PROVIDER':
        this.trigger.set({ type, providerId: '' });
        break;
      default:
        this.trigger.set({ type } as WorkflowTrigger);
    }
  }

  setTriggerTagId(tagId: string): void {
    const t = this.trigger();
    if (t.type === 'TAG_ADDED' || t.type === 'TAG_REMOVED') {
      this.trigger.set({ ...t, tagId });
    }
  }

  setTriggerProjectId(projectId: string): void {
    const t = this.trigger();
    if (t.type === 'TASK_MOVED_TO_PROJECT') {
      this.trigger.set({ ...t, projectId });
    }
  }

  setTriggerProviderId(providerId: string): void {
    const t = this.trigger();
    if (t.type === 'TASK_CREATED_FROM_PROVIDER') {
      this.trigger.set({ ...t, providerId });
    }
  }

  addAction(type: WorkflowActionType): void {
    const action = this._defaultAction(type);
    if (action) {
      this.actions.update((acts) => [...acts, action]);
    }
  }

  removeAction(index: number): void {
    this.actions.update((acts) => acts.filter((_, i) => i !== index));
  }

  updateActionField(index: number, field: string, value: unknown): void {
    this.actions.update((acts) =>
      acts.map((a, i) => (i === index ? { ...a, [field]: value } : a)),
    );
  }

  onConditionJsonChange(json: string): void {
    this.conditionJson.set(json);
    if (!json.trim()) {
      this.jsonError.set(null);
      return;
    }
    try {
      JSON.parse(json);
      this.jsonError.set(null);
    } catch {
      this.jsonError.set('Invalid JSON');
    }
  }

  save(): void {
    const condition = this._parseCondition();
    if (this.isJsonMode() && this.jsonError()) return;

    const params = {
      title: this.title(),
      trigger: this.trigger(),
      condition,
      actions: this.actions(),
    };

    if (this.isEdit && this._data) {
      this._workflowService.update(this._data.id, {
        ...params,
        isEnabled: this.isEnabled(),
      });
    } else {
      this._workflowService.add(params);
    }
    this._dialogRef.close();
  }

  cancel(): void {
    this._dialogRef.close();
  }

  private _parseCondition(): WorkflowCondition | null {
    const json = this.conditionJson().trim();
    if (!json) return null;
    try {
      return JSON.parse(json) as WorkflowCondition;
    } catch {
      return null;
    }
  }

  private _defaultAction(type: WorkflowActionType): WorkflowAction | null {
    switch (type) {
      case 'ADD_TAG':
        return { type, tagId: '' };
      case 'REMOVE_TAG':
        return { type, tagId: '' };
      case 'SCHEDULE_TODAY':
        return { type };
      case 'SCHEDULE_TOMORROW':
        return { type };
      case 'SCHEDULE_DAY_OFFSET':
        return { type, days: 2 };
      case 'UNSCHEDULE':
        return { type };
      case 'MOVE_TO_PROJECT':
        return { type, projectId: '' };
      case 'SET_ESTIMATE':
        return { type, minutes: 30 };
      case 'ADD_SUBTASK':
        return { type, titleTemplate: '{{task.title}}' };
      case 'MARK_DONE':
        return { type };
      case 'SHOW_NOTIFICATION':
        return { type, message: '' };
    }
  }
}
