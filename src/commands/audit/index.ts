import { Command } from '@commander-js/extra-typings';
import { auditLatestCommand } from './latest';
import { auditRunCommand } from './run';

export const auditCommand = new Command('audit')
  .description('Run audits and read results for a monitored URL')
  .addCommand(auditRunCommand)
  .addCommand(auditLatestCommand);
