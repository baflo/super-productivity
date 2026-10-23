import {
  computed,
  Directive,
  HostBinding,
  HostListener,
  inject,
  input,
} from '@angular/core';
import { IS_ELECTRON } from '../../../../app.constants';
import { TaskAttachmentType } from '../task-attachment.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';

@Directive({ selector: '[taskAttachmentLink]' })
export class TaskAttachmentLinkDirective {
  private _snackService = inject(SnackService);

  readonly type = input<TaskAttachmentType>();
  readonly href = input<string>();

  /**
   * Web link attachments navigate as a real link (`target="_blank"` from the
   * template) instead of `window.open`: only a user-followed link is handed to
   * an installed PWA that captures its URL, and middle/ctrl-click or "copy
   * link" work as usual. Electron, images and local files keep the click
   * handler.
   */
  readonly nativeHref = computed(() => {
    const href = this.href();
    if (IS_ELECTRON || this.type() !== 'LINK' || !href || this._isLocalFileUrl(href)) {
      return null;
    }
    return this._normalizeUrl(href);
  });

  // The `href` input takes the host's `[href]` binding, so the element itself
  // only gets an href through these attribute bindings.
  @HostBinding('attr.href') get hrefAttr(): string | null {
    return this.nativeHref();
  }

  @HostBinding('attr.rel') get relAttr(): string | null {
    return this.nativeHref() ? 'noopener' : null;
  }

  @HostListener('click', ['$event']) onClick(ev: Event): void {
    const href = this.href();
    if (!href) {
      throw new Error('No href');
    }

    if (ev.target) {
      const el = ev.target as HTMLElement;
      el.blur();
    }

    if (!IS_ELECTRON && this._isLocalFileUrl(href)) {
      ev.preventDefault();
      this._snackService.open({
        msg: T.F.ATTACHMENT.LOCAL_FILE_UNAVAILABLE,
        type: 'ERROR',
      });
      return;
    }

    if (IS_ELECTRON) {
      ev.preventDefault();
      const type = this.type();
      if (!type || type === 'LINK') {
        this._openExternalUrl(href);
      } else if (type === 'FILE') {
        window.ea.openPath(href);
      } else if (type === 'COMMAND') {
        // COMMAND attachments can no longer run shell commands: the exec IPC was
        // removed to close GHSA-256q. Legacy/imported COMMAND attachments still
        // render but are inert on click.
        this._snackService.open({
          msg: T.F.ATTACHMENT.COMMAND_UNSUPPORTED,
          type: 'ERROR',
        });
      }
    }
    // Web link attachments: the browser follows the native href (nativeHref).
  }

  private _isLocalFileUrl(url: string): boolean {
    return url.toLowerCase().startsWith('file://');
  }

  // try to account for jira(?) adding a second http to the url
  private _normalizeUrl(rawUrl: string): string {
    return rawUrl
      .replace('https://https://', 'https://')
      .replace('http://http://', 'http://');
  }

  private _openExternalUrl(rawUrl: string): void {
    if (!rawUrl) {
      return;
    }
    window.ea.openExternalUrl(this._normalizeUrl(rawUrl));
  }
}
