import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { WorkflowService } from '../workflow.service';
import { Workflow } from '../workflow.model';
import { WorkflowEditorComponent } from '../workflow-editor/workflow-editor.component';

@Component({
  selector: 'workflow-list',
  imports: [
    AsyncPipe,
    MatIcon,
    MatIconButton,
    MatButton,
    MatSlideToggle,
    TranslateModule,
  ],
  templateUrl: './workflow-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkflowListComponent {
  private readonly _matDialog = inject(MatDialog);
  readonly workflowService = inject(WorkflowService);
  protected readonly T = T;

  openEditor(workflow?: Workflow): void {
    this._matDialog.open(WorkflowEditorComponent, {
      data: workflow ?? null,
      width: '640px',
    });
  }

  toggleEnabled(workflow: Workflow): void {
    this.workflowService.update(workflow.id, { isEnabled: !workflow.isEnabled });
  }

  delete(workflow: Workflow): void {
    this.workflowService.delete(workflow.id);
  }
}
