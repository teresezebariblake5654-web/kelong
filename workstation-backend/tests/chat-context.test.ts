import { describe, expect, it } from 'vitest';
import { buildRecentConversationContext } from '../src/services/chat.service';

describe('buildRecentConversationContext', () => {
  it('keeps only the most recent messages in chronological order', () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message-${index + 1}`,
    }));

    expect(buildRecentConversationContext(messages, 4, 1_000)).toEqual(messages.slice(-4));
  });

  it('drops the oldest content when the character budget is exceeded', () => {
    const context = buildRecentConversationContext(
      [
        { role: 'user', content: 'old-question' },
        { role: 'assistant', content: 'old-answer' },
        { role: 'user', content: 'new-question' },
      ],
      20,
      15,
    );

    expect(context).toEqual([{ role: 'user', content: 'new-question' }]);
  });

  it('does not mutate the source message list', () => {
    const messages = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: 'second' },
    ];

    buildRecentConversationContext(messages, 1, 3);

    expect(messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
  });
});
