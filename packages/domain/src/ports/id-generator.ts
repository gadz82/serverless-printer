export interface IdGenerator {
  forMessage(messageId: string): string;
}
