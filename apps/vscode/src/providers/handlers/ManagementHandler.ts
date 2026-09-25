import { BrudMainWindowManager } from '../MainWindowProvider';

export class ManagementHandler {
  constructor(private mainWindowManager: BrudMainWindowManager) {}

  public async handle(tab?: string, subView?: string): Promise<void> {
    this.mainWindowManager.openMainWindow(tab, subView);
  }
}