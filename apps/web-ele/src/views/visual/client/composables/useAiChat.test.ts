/**
 * AI 会话跨路由生命周期回归测试。
 * @author yanch
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sseMock = vi.hoisted(() => ({
  handlers: undefined as any,
  requests: [] as any[],
}));

vi.mock('#/api/ai/agent', () => ({
  cancelAgentRun: vi.fn(() => Promise.resolve()),
  listConversationMessages: vi.fn(() => Promise.resolve({ data: [] })),
  streamAgentChat: vi.fn((request: any, handlers: any) => {
    sseMock.requests.push(request);
    sseMock.handlers = handlers;
    return vi.fn();
  }),
}));

import { useAiChat } from './useAiChat';

describe('AI 会话跨路由保持', () => {
  beforeEach(() => {
    sseMock.handlers = undefined;
    sseMock.requests = [];
  });

  it('页面重新挂载后复用正在响应的消息和 SSE 状态', () => {
    const firstPage = useAiChat(() => ({
      allowSampleData: false,
      dbConfigId: 1,
      instanceName: 'db_one',
      modelId: 10,
    }));
    firstPage.newConversation();
    firstPage.send('查询用户数量', 'sql');
    sseMock.handlers.onEvent('message.delta', { text: '正在查询' });

    // 模拟切走路由后重新进入：组件会再次调用 useAiChat。
    const returnedPage = useAiChat(() => ({
      allowSampleData: true,
      dbConfigId: 1,
      instanceName: 'db_one',
      modelId: 10,
    }));

    expect(returnedPage.messages).toBe(firstPage.messages);
    expect(returnedPage.running.value).toBe(true);
    expect(returnedPage.messages.value.at(-1)?.text).toBe('正在查询');

    // 原 SSE 后续增量仍应写入返回页面正在使用的同一条消息。
    sseMock.handlers.onEvent('message.delta', { text: '完成' });
    expect(returnedPage.messages.value.at(-1)?.text).toBe('正在查询完成');
    sseMock.handlers.onClose();
  });
});
