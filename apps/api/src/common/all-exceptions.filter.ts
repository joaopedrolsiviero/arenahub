import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { RequestContext } from './request-context';

// Fase 18 (itens 7/8): rede de segurança GLOBAL contra vazamento de detalhe
// interno — nunca deveria ser a PRIMEIRA linha de defesa (cada service já
// trata os próprios erros esperados, ver AiService/PaymentsService/
// WhatsAppService), mas garante que um erro não previsto (bug, erro do
// Prisma não capturado num service novo, etc.) nunca devolve stack trace,
// mensagem de driver de banco ou qualquer outro detalhe interno pro
// cliente — só um 500/409/404 genérico, com o detalhe completo indo pro log
// do servidor (correlacionável pelo requestId).
//
// HttpException (a imensa maioria dos erros do app — já são intencionais e
// já têm mensagem segura) passa direto pelo comportamento padrão do Nest,
// preservando o código HTTP e o corpo exatos que cada controller/service já
// decidiu — este filtro nunca re-normaliza um erro que já era seguro.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const requestId = RequestContext.getRequestId();

    if (exception instanceof HttpException) {
      httpAdapter.reply(ctx.getResponse(), exception.getResponse(), exception.getStatus());
      return;
    }

    const { status, message } = this.mapUnknownError(exception);
    this.logger.error(
      `Erro não tratado (requestId=${requestId}): ${
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)
      }`,
    );
    httpAdapter.reply(ctx.getResponse(), { statusCode: status, message }, status);
  }

  private mapUnknownError(exception: unknown): { status: number; message: string } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025: registro esperado não encontrado (ex: um `findUniqueOrThrow`
      // sem tratamento dedicado num service novo). P2002: violação de
      // unicidade não capturada explicitamente. Qualquer outro código do
      // Prisma cai no 500 genérico — nunca repassa `exception.message`
      // (contém nomes de coluna/constraint do schema).
      if (exception.code === 'P2025') {
        return { status: 404, message: 'Recurso não encontrado.' };
      }
      if (exception.code === 'P2002') {
        return {
          status: 409,
          message: 'Conflito: recurso já existe ou viola uma restrição única.',
        };
      }
      return { status: 500, message: 'Erro interno do servidor.' };
    }

    return { status: 500, message: 'Erro interno do servidor.' };
  }
}
