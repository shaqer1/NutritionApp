import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Attaches the Firebase ID token to requests going to our own API. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.useAuth || !req.url.startsWith(environment.apiBase)) {
    return next(req);
  }
  const auth = inject(AuthService);
  return from(auth.getIdToken()).pipe(
    switchMap((token) => {
      const authReq = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        : req;
      // fetch() has no built-in timeout, so a request started right before/
      // during a network change (WiFi switch, DNS hiccup) can hang forever
      // instead of erroring — which otherwise leaves the UI stuck loading
      // indefinitely. Fail it after 20s so callers' error handlers can run.
      return next(authReq).pipe(timeout(20000));
    }),
  );
};
