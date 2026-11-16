import type { KernelCallAuthority } from '../../../src/contracts/index.js';
import type { IEventsService } from '../contracts/IEventsService.js';

export class EventsService implements IEventsService {
  private authority: KernelCallAuthority | undefined;

  public bindAuthority(value: KernelCallAuthority): void {
    this.authority = value;
  }

  public emit(name: string, payload: unknown): void {
    void name;
    void payload;
  }

  public pull(subscriptionId: string): readonly unknown[] {
    void subscriptionId;
    return [];
  }

  public close(subscriptionId: string): void {
    void subscriptionId;
  }

  public list(): readonly string[] {
    return [];
  }
}