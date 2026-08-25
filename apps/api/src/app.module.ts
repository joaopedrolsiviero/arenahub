import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ArenaMembersModule } from './modules/arena-members/arena-members.module';
import { ArenasModule } from './modules/arenas/arenas.module';
import { CourtsModule } from './modules/courts/courts.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { OperatingHoursModule } from './modules/operating-hours/operating-hours.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AiModule } from './modules/ai/ai.module';
import { CustomersModule } from './modules/customers/customers.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    UsersModule,
    WebhooksModule,
    ArenaMembersModule,
    ArenasModule,
    CourtsModule,
    IdempotencyModule,
    OperatingHoursModule,
    BookingsModule,
    AvailabilityModule,
    DashboardModule,
    InvitationsModule,
    AiModule,
    CustomersModule,
  ],
})
export class AppModule {}
