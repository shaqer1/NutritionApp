import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
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
      return next(authReq);
    }),
  );
};
