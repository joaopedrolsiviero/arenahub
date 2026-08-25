import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildAiContext } from './ai-context';
import { AskAiDto } from './dto/ask-ai.dto';
import { OperationalMetricsService } from './operational-metrics.service';
import { AI_SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import {
  AiInvalidResponseError,
  AiProvider,
  AiProviderUnavailableError,
  AiTimeoutError,
} from './providers/ai-provider';

export interface AskAiResponse {
  answer: string;
  period: { from: string; to: string };
  timezone: string;
  generatedAt: string;
}

/**
 * Orquestra uma pergunta ao assistente de IA (Fase 12): resolve o período,
 * calcula métricas reais (OperationalMetricsService), monta o contexto
 * estruturado (nunca o banco inteiro, nunca PII) e delega ao AiProvider. A
 * autorização (OWNER/ADMIN da arena) já foi decidida pelos guards antes
 * deste service ser chamado — aqui dentro não existe mais nenhuma checagem
 * de acesso, só o pipeline de dados→contexto→modelo.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: OperationalMetricsService,
    private readonly aiProvider: AiProvider,
  ) {}

  async ask(arenaId: string, dto: AskAiDto): Promise<AskAiResponse> {
    const arena = await this.prisma.arena.findUniqueOrThrow({
      where: { id: arenaId },
      select: { name: true, timezone: true },
    });

    const period = this.metricsService.resolvePeriod(arena.timezone, dto.period);
    const previousPeriod = this.metricsService.previousPeriod(period, arena.timezone);

    const [metrics, previousMetrics] = await Promise.all([
      this.metricsService.getMetrics(arenaId, period),
      this.metricsService.getMetrics(arenaId, previousPeriod),
    ]);

    const comparison = this.metricsService.buildComparison(metrics, previousMetrics);
    const context = buildAiContext(
      { name: arena.name, timezone: arena.timezone },
      metrics,
      comparison,
    );
    const userPrompt = buildUserPrompt(context, dto.question);

    const startedAt = Date.now();
    try {
      const result = await this.aiProvider.generate({
        systemPrompt: AI_SYSTEM_PROMPT,
        userPrompt,
      });

      this.logger.log(
        `IA respondeu para arena=${arenaId} em ${Date.now() - startedAt}ms ` +
          `(questionLength=${dto.question.length})`,
      );

      return {
        answer: result.text,
        period: { from: period.fromLabel, to: period.toLabel },
        timezone: arena.timezone,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof AiTimeoutError) {
        this.logger.error(`Timeout do provedor de IA para arena=${arenaId}.`);
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof AiInvalidResponseError) {
        this.logger.error(`Resposta inválida do provedor de IA para arena=${arenaId}.`);
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof AiProviderUnavailableError) {
        this.logger.error(`Provedor de IA indisponível para arena=${arenaId}.`);
        throw new ServiceUnavailableException(error.message);
      }
      // Erro inesperado (bug no adapter, etc.) — nunca deixa vazar detalhe
      // interno pro cliente, mas também nunca finge que foi um caso
      // conhecido (item 18 do prompt: nunca 500 genérico sem contexto).
      this.logger.error(
        `Erro inesperado no pipeline de IA para arena=${arenaId}: ` +
          (error instanceof Error ? error.message : 'erro desconhecido'),
      );
      throw new ServiceUnavailableException('Assistente de IA temporariamente indisponível.');
    }
  }
}
