import { Command } from '@commander-js/extra-typings';
import { mwEndCommand } from './end';
import { mwListCommand } from './list';
import { mwStartCommand } from './start';

export const mwCommand = new Command('mw')
  .alias('maintenance-window')
  .description("Start, end and list a project's maintenance windows")
  .addCommand(mwStartCommand)
  .addCommand(mwEndCommand)
  .addCommand(mwListCommand);
