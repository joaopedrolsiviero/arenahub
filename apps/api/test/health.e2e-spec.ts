import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
  });

  it('/v1/health (GET) — liveness, sem autenticação', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);
    const body = response.body as {
      status: string;
      service: string;
      timestamp: string;
    };

    expect(body).toMatchObject({
      status: 'ok',
      service: 'arenahub-api',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('/v1/health/ready (GET) — readiness, confirma conectividade real com o Postgres', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health/ready').expect(200);
    const body = response.body as {
      status: string;
      service: string;
      database: string;
      timestamp: string;
    };

    expect(body).toMatchObject({
      status: 'ok',
      service: 'arenahub-api',
      database: 'ok',
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
