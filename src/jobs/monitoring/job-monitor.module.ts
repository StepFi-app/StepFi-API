import { Global, Module } from '@nestjs/common';
import { JobMonitorService } from './job-monitor.service';

@Global()
@Module({
  providers: [JobMonitorService],
  exports: [JobMonitorService],
})
export class JobMonitorModule {}
