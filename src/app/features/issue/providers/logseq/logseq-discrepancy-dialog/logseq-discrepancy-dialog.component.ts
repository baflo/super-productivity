import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DiscrepancyItem, DiscrepancyType } from '../logseq-common-interfaces.service';
import { T } from '../../../../../t.const';
import {
  ActiveTaskSelection,
  DiscrepancyResolution,
} from '../logseq-issue.actions';

export interface LogseqDiscrepancyDialogData {
  discrepancies: DiscrepancyItem[];
}

export interface LogseqDiscrepancyDialogResult {
  resolutions: DiscrepancyResolution[];
  activeTaskSelection?: ActiveTaskSelection;
}

interface DiscrepancyWithAction extends DiscrepancyItem {
  selectedAction: 'superprod' | 'logseq';
}

@Component({
  selector: 'logseq-discrepancy-dialog',
  templateUrl: './logseq-discrepancy-dialog.component.html',
  styleUrls: ['./logseq-discrepancy-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatRadioGroup,
    MatRadioButton,
    FormsModule,
    TranslatePipe,
  ],
})
export class LogseqDiscrepancyDialogComponent {
  private readonly _dialogRef =
    inject<MatDialogRef<LogseqDiscrepancyDialogComponent>>(MatDialogRef);
  private readonly _translateService = inject(TranslateService);
  readonly data = inject<LogseqDiscrepancyDialogData>(MAT_DIALOG_DATA);

  readonly T: typeof T = T;

  // Separate discrepancies by type
  readonly activeDiscrepancies = computed(() =>
    this.data.discrepancies.filter(
      (d) =>
        d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE' ||
        d.discrepancyType === 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE',
    ),
  );

  readonly doneDiscrepancies = computed(() =>
    this.data.discrepancies.filter(
      (d) =>
        d.discrepancyType === 'LOGSEQ_DONE_SUPERPROD_NOT_DONE' ||
        d.discrepancyType === 'SUPERPROD_DONE_LOGSEQ_NOT_DONE',
    ),
  );

  // Multiple tasks are active in Logseq (user needs to pick which one)
  readonly logseqActiveDiscrepancies = computed(() =>
    this.activeDiscrepancies().filter(
      (d) => d.discrepancyType === 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE',
    ),
  );

  readonly hasMultipleLogseqActive = computed(
    () => this.logseqActiveDiscrepancies().length >= 1,
  );

  // Signals for form state
  readonly selectedActiveTaskId = signal<string | '__none__'>(
    this.logseqActiveDiscrepancies().length > 0
      ? this.logseqActiveDiscrepancies()[0].task.id
      : '__none__',
  );

  // Map of task ID to selected action for each discrepancy
  readonly discrepancyActions = signal<Map<string, 'superprod' | 'logseq'>>(
    this._initializeDiscrepancyActions(),
  );

  readonly dialogTitle = computed(() => {
    const count = this.data.discrepancies.length;
    return count === 1
      ? 'Logseq Diskrepanz gefunden'
      : `${count} Logseq Diskrepanzen gefunden`;
  });

  private _initializeDiscrepancyActions(): Map<string, 'superprod' | 'logseq'> {
    const map = new Map<string, 'superprod' | 'logseq'>();
    // Default to accepting Logseq values (superprod action)
    for (const d of this.data.discrepancies) {
      map.set(d.task.id, 'superprod');
    }
    return map;
  }

  setDiscrepancyAction(taskId: string, action: 'superprod' | 'logseq'): void {
    const current = this.discrepancyActions();
    const newMap = new Map(current);
    newMap.set(taskId, action);
    this.discrepancyActions.set(newMap);
  }

  getDiscrepancyAction(taskId: string): 'superprod' | 'logseq' {
    return this.discrepancyActions().get(taskId) || 'superprod';
  }

  getActionLabel(
    discrepancyType: DiscrepancyType,
    action: 'superprod' | 'logseq',
  ): string {
    if (action === 'superprod') {
      return this._getSuperProdActionLabel(discrepancyType);
    } else {
      return this._getLogseqActionLabel(discrepancyType);
    }
  }

  getStatusText(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.STATUS_LOGSEQ_DONE_SP_OPEN,
        );
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.STATUS_SP_DONE_LOGSEQ_OPEN,
        );
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.STATUS_LOGSEQ_DOING_SP_INACTIVE,
        );
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.STATUS_SP_ACTIVE_LOGSEQ_TODO,
        );
    }
  }

  private _getSuperProdActionLabel(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.COMPLETE);
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return this._translateService.instant(
          T.F.LOGSEQ.DISCREPANCY.SET_SUPERPROD_NOT_DONE,
        );
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.ACTIVATE);
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.DEACTIVATE_TASK);
    }
  }

  private _getLogseqActionLabel(discrepancyType: DiscrepancyType): string {
    switch (discrepancyType) {
      case 'LOGSEQ_DONE_SUPERPROD_NOT_DONE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_TODO);
      case 'SUPERPROD_DONE_LOGSEQ_NOT_DONE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_DONE);
      case 'LOGSEQ_ACTIVE_SUPERPROD_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_TODO);
      case 'SUPERPROD_ACTIVE_LOGSEQ_NOT_ACTIVE':
        return this._translateService.instant(T.F.LOGSEQ.DISCREPANCY.SET_LOGSEQ_DOING);
    }
  }

  onApply(): void {
    const result: LogseqDiscrepancyDialogResult = {
      resolutions: this._buildResolutions(),
    };

    // Add active task selection if applicable
    if (this.hasMultipleLogseqActive()) {
      result.activeTaskSelection = {
        selectedTaskId: this.selectedActiveTaskId(),
        allActiveTasks: this.logseqActiveDiscrepancies().map((d) => d.task),
      };
    }

    this._dialogRef.close(result);
  }

  onSyncAllToLogseq(): void {
    const result: LogseqDiscrepancyDialogResult = {
      resolutions: this.data.discrepancies.map((d) => ({
        taskId: d.task.id,
        action: 'logseq',
        discrepancyType: d.discrepancyType,
        task: d.task,
        block: d.block,
      })),
    };
    this._dialogRef.close(result);
  }

  onCancel(): void {
    this._dialogRef.close(null);
  }

  private _buildResolutions(): DiscrepancyResolution[] {
    return this.data.discrepancies.map((d) => ({
      taskId: d.task.id,
      action: this.getDiscrepancyAction(d.task.id),
      discrepancyType: d.discrepancyType,
      task: d.task,
      block: d.block,
    }));
  }
}
