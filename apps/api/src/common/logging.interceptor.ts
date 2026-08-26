import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { RequestContext } from './request-context';

// Fase 18 (item 8/9): uma linha de log por requisição HTTP — método, rota
// (path, nunca query string: poderia carregar PII, ex: ?search=email@... em
// GET /customers), status e duração, mais o requestId pra correlacionar com
// qualquer log emitido pelos services durante a mesma requisição. Nunca loga
// headers, body ou o texto de erros internos não tratados de forma alguma
// diferente do que os services já fazem — só acrescenta o "envelope" da
// requisição em volta do que já é logado.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const startedAt = Date.now();
    const requestId = RequestContext.getRequestId();

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          `${request.method} ${request.path} ${response.statusCode} ${Date.now() - startedAt}ms requestId=${requestId}`,
        );
      }),
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        // Erros 4xx são operação normal do produto (validação, 404, 403 por
        // IDOR bloqueado etc.) — log em nível `log`, nunca `error`, pra não
        // poluir alertas de erro real com tráfego malicioso já bloqueado.
        const logFn =
          status >= 500 ? this.logger.error.bind(this.logger) : this.logger.log.bind(this.logger);
        logFn(
          `${request.method} ${request.path} ${status} ${Date.now() - startedAt}ms requestId=${requestId}` +
            (status >= 500 && error instanceof Error ? ` erro=${error.message}` : ''),
        );
        return throwError(() => error);
      }),
    );
  }
}
