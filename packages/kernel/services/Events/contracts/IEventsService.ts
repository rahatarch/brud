export interface IEventsService {
  emit(name: string, payload: unknown): void;
  pull(subscriptionId: string): readonly unknown[];
  close(subscriptionId: string): void;
  list(): readonly string[];
}