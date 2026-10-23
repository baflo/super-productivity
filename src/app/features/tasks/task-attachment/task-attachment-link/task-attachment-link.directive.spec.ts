import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { TaskAttachmentType } from '../task-attachment.model';
import { TaskAttachmentLinkDirective } from './task-attachment-link.directive';

@Component({
  template: `
    <a
      taskAttachmentLink
      [href]="href"
      [type]="type"
    >
      Open
    </a>
  `,
  imports: [TaskAttachmentLinkDirective],
})
class TestHostComponent {
  href = 'https://example.com';
  type: TaskAttachmentType = 'LINK';
}

describe('TaskAttachmentLinkDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(async () => {
    snackService = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [{ provide: SnackService, useValue: snackService }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
  });

  it('should block local file urls outside electron', () => {
    fixture.componentInstance.href =
      'file://c:/Users/Youss/AppData/Roaming/superProductivity/clipboard-images/test.png';
    fixture.detectChanges();
    spyOn(window, 'open');

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBeTrue();
    expect(window.open).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.F.ATTACHMENT.LOCAL_FILE_UNAVAILABLE,
      type: 'ERROR',
    });
  });

  it('should block local file urls before browser navigation for image attachments', () => {
    fixture.componentInstance.href = 'file:///home/user/clipboard-images/test.png';
    fixture.componentInstance.type = 'IMG';
    fixture.detectChanges();
    spyOn(window, 'open');

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBeTrue();
    expect(window.open).not.toHaveBeenCalled();
    expect(snackService.open).toHaveBeenCalledWith({
      msg: T.F.ATTACHMENT.LOCAL_FILE_UNAVAILABLE,
      type: 'ERROR',
    });
  });

  it('should open regular links outside electron as a native link', () => {
    fixture.detectChanges();
    spyOn(window, 'open');

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    // Record what the directive did, then stop the real navigation the native
    // href would start inside the test runner.
    let isPreventedByDirective: boolean | undefined;
    const stopNavigation = (e: Event): void => {
      isPreventedByDirective = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener('click', stopNavigation);

    link.dispatchEvent(ev);
    document.removeEventListener('click', stopNavigation);

    // A user-followed link (not window.open) is what an installed PWA that
    // captures the URL takes over.
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(isPreventedByDirective).toBeFalse();
    expect(window.open).not.toHaveBeenCalled();
    expect(snackService.open).not.toHaveBeenCalled();
  });

  it('should normalize a doubled scheme in the native href', () => {
    fixture.componentInstance.href = 'https://https://example.com/x';
    fixture.detectChanges();

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;

    expect(link.getAttribute('href')).toBe('https://example.com/x');
  });

  it('should not give image attachments a native href', () => {
    fixture.componentInstance.href = 'https://example.com/a.png';
    fixture.componentInstance.type = 'IMG';
    fixture.detectChanges();

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;

    expect(link.hasAttribute('href')).toBeFalse();
    expect(link.hasAttribute('rel')).toBeFalse();
  });

  it('should not give local file links a native href', () => {
    fixture.componentInstance.href = 'file:///home/user/a.txt';
    fixture.detectChanges();

    const link = fixture.debugElement.query(By.css('a'))
      .nativeElement as HTMLAnchorElement;

    expect(link.hasAttribute('href')).toBeFalse();
  });
});
