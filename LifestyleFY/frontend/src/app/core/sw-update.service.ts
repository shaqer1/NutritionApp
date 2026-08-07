import { Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private swUpdate = inject(SwUpdate);

  init(): void {
    if (!this.swUpdate.isEnabled) return;

    // A new version finished downloading — activate it and reload so the
    // phone never keeps running against stale hashed asset filenames.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        this.swUpdate.activateUpdate().then(() => window.location.reload());
      });

    // The SW detected it can't recover (e.g. a cached chunk 404'd because
    // it was replaced by a newer deploy). Force a hard reload.
    this.swUpdate.unrecoverable.subscribe(() => {
      window.location.reload();
    });

    // Mobile browsers rarely fully close the app, so proactively poll for
    // updates instead of waiting on the default lifecycle events.
    setInterval(() => this.swUpdate.checkForUpdate(), 60 * 60 * 1000);
  }
}
