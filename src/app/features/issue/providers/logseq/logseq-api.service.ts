import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { LogseqCfg } from './logseq.model';
import { LogseqBlock } from './logseq-issue.model';
import { LOGSEQ_MARKER_REGEX } from './logseq.const';
import { SnackService } from '../../../../core/snack/snack.service';
import { Observable, from, throwError } from 'rxjs';
import { switchMap, catchError, retry } from 'rxjs/operators';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';

@Injectable({
  providedIn: 'root',
})
export class LogseqApiService {
  private readonly _http = inject(HttpClient);
  private readonly _snackService = inject(SnackService);

  private _sendRequest$<T>(cfg: LogseqCfg, method: string, args: any[]): Observable<T> {
    const url = cfg.apiUrl || 'http://localhost:12315/api';

    if (!cfg.authToken) {
      return throwError(() => new Error('Logseq: No auth token configured'));
    }

    return this._http
      .post<T>(
        url,
        { method, args },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.authToken}`,
          },
        },
      )
      .pipe(
        // Retry failed requests up to 2 times with 1 second delay
        retry({ count: 2, delay: 1000 }),
        catchError((err: HttpErrorResponse) => this._handleError(err, method)),
      );
  }

  queryBlocks$(cfg: LogseqCfg, query: string): Observable<LogseqBlock[]> {
    return this._sendRequest$<any[]>(cfg, 'logseq.DB.datascriptQuery', [query]).pipe(
      switchMap((results) => {
        // Datascript returns nested arrays, we need to flatten
        const blocks = results.flat().filter((item) => item && typeof item === 'object');
        return from([this._normalizeBlocks(blocks)]);
      }),
    );
  }

  getPage$(pageId: number, cfg: LogseqCfg): Observable<any> {
    return this._sendRequest$<any>(cfg, 'logseq.Editor.getPage', [pageId]);
  }

  getBlockByUuid$(uuid: string, cfg: LogseqCfg): Observable<LogseqBlock> {
    return this._sendRequest$<any>(cfg, 'logseq.Editor.getBlock', [uuid]).pipe(
      switchMap((rawBlock) => {
        const normalized = this._normalizeBlock(rawBlock);

        // Fetch page name if page ID exists
        if (normalized.page && normalized.page.id) {
          return this.getPage$(normalized.page.id, cfg).pipe(
            switchMap((page) => {
              const pageName =
                page?.originalName || page?.['original-name'] || page?.name;
              const result = { ...normalized, pageName };
              return from([result]);
            }),
            catchError(() => {
              // If page fetch fails, return block without page name
              return from([normalized]);
            }),
          );
        }

        return from([normalized]);
      }),
    );
  }

  /**
   * Batch fetch multiple blocks by their UUIDs in a single request.
   * Much more efficient than calling getBlockByUuid$ for each block.
   */
  getBlocksByUuids$(uuids: string[], cfg: LogseqCfg): Observable<LogseqBlock[]> {
    if (uuids.length === 0) {
      return from([[]]);
    }

    // Build a Datascript query using OR clauses with UUID literals
    // Logseq uses #uuid "..." syntax for UUID matching
    const orClauses = uuids.map((uuid) => `[?b :block/uuid #uuid "${uuid}"]`).join(' ');
    const query = `[:find (pull ?b [*]) :where (or ${orClauses})]`;

    return this.queryBlocks$(cfg, query);
  }

  updateBlock$(uuid: string, content: string, cfg: LogseqCfg): Observable<void> {
    return this._sendRequest$<void>(cfg, 'logseq.Editor.updateBlock', [uuid, content]);
  }

  insertChildBlock$(
    parentUuid: string,
    content: string,
    cfg: LogseqCfg,
  ): Observable<LogseqBlock> {
    return this._sendRequest$<any>(cfg, 'logseq.Editor.insertBlock', [
      parentUuid,
      content,
      { sibling: false },
    ]).pipe(switchMap((block) => from([this._normalizeBlock(block)])));
  }

  getBlockChildren$(parentUuid: string, cfg: LogseqCfg): Observable<LogseqBlock[]> {
    return this.getBlockByUuid$(parentUuid, cfg).pipe(
      switchMap((block) => {
        const children = block.properties?.children || [];

        if (children.length === 0 || !Array.isArray(children)) {
          return from([[]]);
        }

        // Normalize all children and filter out invalid ones (those with empty uuid)
        const normalized = children
          .map((child: any) => this._normalizeBlock(child))
          .filter((normalizedBlock) => normalizedBlock.uuid !== '');

        return from([normalized]);
      }),
    );
  }

  private _normalizeBlock(raw: any): LogseqBlock {
    // Defensive check: if raw data is invalid, create placeholder
    if (!raw || typeof raw !== 'object' || !raw.uuid || raw.content === undefined) {
      // Return a placeholder block that will be filtered out later
      return {
        id: '',
        uuid: '',
        content: '',
        marker: null,
        page: { id: -1 },
        parent: null,
        properties: {},
      };
    }

    // Extract marker from content if not provided by API
    let marker = raw.marker || null;

    if (!marker && raw.content) {
      const markerMatch = raw.content.match(LOGSEQ_MARKER_REGEX);
      if (markerMatch) {
        marker = markerMatch[1].toUpperCase();
      }
    }

    return {
      id: raw.uuid, // Use UUID as id so tasks store UUID as issueId
      uuid: raw.uuid,
      content: raw.content || '',
      marker,
      page: raw.page || { id: -1 },
      parent: raw.parent || null,
      properties: raw.properties || {},
    };
  }

  private _normalizeBlocks(blocks: any[]): LogseqBlock[] {
    // Normalize all blocks and filter out invalid ones (those with empty uuid)
    return blocks
      .map((block) => this._normalizeBlock(block))
      .filter((normalizedBlock) => normalizedBlock.uuid !== '');
  }

  private _handleError(error: HttpErrorResponse | Error, operation: string): Observable<never> {
    // Handle HTTP errors (from HttpClient)
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401 || error.status === 403) {
        this._snackService.open({
          type: 'ERROR',
          msg: 'Logseq: Invalid API token. Please check your settings.',
        });
      } else if (error.status === 404) {
        this._snackService.open({
          type: 'CUSTOM',
          msg: `Logseq: ${operation} - Resource not found`,
        });
      } else if (
        error.status === 0 ||
        !navigator.onLine ||
        error.message?.includes('ECONNREFUSED')
      ) {
        // status 0 means network error in HttpClient
        this._snackService.open({
          type: 'CUSTOM',
          msg: 'Logseq: Cannot connect. Is Logseq running with HTTP API enabled?',
        });
        // Mark as offline for potential queuing
        return throwError(() => ({
          [HANDLED_ERROR_PROP_STR]: `Logseq: ${operation} failed`,
          offline: true,
          operation,
        }));
      }
    }

    return throwError(() => ({
      [HANDLED_ERROR_PROP_STR]: `Logseq: ${operation} failed`,
    }));
  }
}
