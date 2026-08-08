import { HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Per-request timeout override (ms). Slow AI-generation endpoints (recipe/grocery
 * suggestions can take 30-45s on Gemini's "smart" model) set this higher than the
 * default so they aren't killed early by the network-hang guard below. */
export const REQUEST_TIMEOUT_MS = new HttpContextToken<number>(() => 20000);

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
      // indefinitely. Fail it after the request's timeout so callers' error
      // handlers can run.
      return next(authReq).pipe(timeout(req.context.get(REQUEST_TIMEOUT_MS)));
    }),
  );
};
