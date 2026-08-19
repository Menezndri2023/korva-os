import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { Pagination } from '@korva/types';

interface PaginatedShape<T> {
  data: T[];
  pagination: Pagination;
}

function isPaginated<T>(value: unknown): value is PaginatedShape<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'pagination' in value &&
    Array.isArray((value as PaginatedShape<T>).data)
  );
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((payload) => {
        if (isPaginated(payload)) {
          return {
            success: true,
            data: payload.data,
            pagination: payload.pagination,
          };
        }
        return { success: true, data: payload ?? null };
      }),
    );
  }
}
