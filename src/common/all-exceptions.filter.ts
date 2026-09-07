import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.resolveMessage(exception);
    const detail = `${request.method} ${request.originalUrl}`;

    if (status >= 500) {
      this.logger.error(
        `${detail} ${status} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${detail} ${status} ${message}`);
    }

    if (response.headersSent) {
      return;
    }

    response.status(status).json({
      statusCode: status,
      code: this.resolveCode(exception),
      message,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }

  private resolveMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return body;
      }

      if (body && typeof body === 'object') {
        const message = (body as { message?: unknown }).message;

        if (Array.isArray(message)) {
          return message.join(', ');
        }

        if (typeof message === 'string') {
          return message;
        }
      }
    }

    if (exception instanceof Error) {
      return exception.message;
    }

    return 'Internal server error';
  }

  private resolveCode(exception: unknown): string | undefined {
    if (!(exception instanceof HttpException)) {
      return undefined;
    }

    const body = exception.getResponse();

    if (typeof body === 'string') {
      return body;
    }

    if (body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;

      if (typeof message === 'string') {
        return message;
      }
    }

    return undefined;
  }
}
